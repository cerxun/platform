//
// Copyright © 2022, 2023 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import activity, { ActivityMessage, ActivityReference } from '@hcengineering/activity'
import chunter, {
  Channel,
  ChannelInfo,
  ChatMessage,
  chunterId,
  ChunterSpace,
  ThreadMessage
} from '@hcengineering/chunter'
import contact, { Person, PersonAccount } from '@hcengineering/contact'
import core, {
  Account,
  AttachedDoc,
  Class,
  concatLink,
  Doc,
  DocumentQuery,
  FindOptions,
  FindResult,
  Hierarchy,
  Ref,
  Timestamp,
  Tx,
  TxCollectionCUD,
  TxCreateDoc,
  TxCUD,
  TxMixin,
  TxProcessor,
  TxRemoveDoc,
  TxUpdateDoc,
  UserStatus
} from '@hcengineering/core'
import notification, { Collaborators, DocNotifyContext, NotificationContent } from '@hcengineering/notification'
import { getMetadata, IntlString, translate } from '@hcengineering/platform'
import serverCore, { TriggerControl } from '@hcengineering/server-core'
import {
  createCollaboratorNotifications,
  getDocCollaborators,
  getMixinTx
} from '@hcengineering/server-notification-resources'
import { markupToText, stripTags } from '@hcengineering/text'
import { workbenchId } from '@hcengineering/workbench'

import { NOTIFICATION_BODY_SIZE } from '@hcengineering/server-notification'
import { encodeObjectURI } from '@hcengineering/view'

const updateChatInfoDelay = 12 * 60 * 60 * 1000 // 12 hours
const hideChannelDelay = 7 * 24 * 60 * 60 * 1000 // 7 days

/**
 * @public
 */
export async function channelHTMLPresenter (doc: Doc, control: TriggerControl): Promise<string> {
  const channel = doc as ChunterSpace
  const front = control.branding?.front ?? getMetadata(serverCore.metadata.FrontUrl) ?? ''
  const path = `${workbenchId}/${control.workspace.workspaceUrl}/${chunterId}/${encodeObjectURI(channel._id, channel._class)}`
  const link = concatLink(front, path)
  const name = await channelTextPresenter(channel)
  return `<a href='${link}'>${name}</a>`
}

/**
 * @public
 */
export async function channelTextPresenter (doc: Doc): Promise<string> {
  const channel = doc as ChunterSpace

  if (channel._class === chunter.class.DirectMessage) {
    return await translate(chunter.string.Direct, {})
  }

  return `${channel.name}`
}

export async function ChatMessageTextPresenter (doc: ChatMessage): Promise<string> {
  return markupToText(doc.message)
}

/**
 * @public
 */
export async function CommentRemove (
  doc: Doc,
  hiearachy: Hierarchy,
  findAll: <T extends Doc>(
    clazz: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: FindOptions<T>
  ) => Promise<FindResult<T>>
): Promise<Doc[]> {
  if (!hiearachy.isDerived(doc._class, chunter.class.ChatMessage)) {
    return []
  }

  const chatMessage = doc as ChatMessage

  return await findAll(activity.class.ActivityReference, {
    srcDocId: chatMessage.attachedTo,
    srcDocClass: chatMessage.attachedToClass,
    attachedDocId: chatMessage._id
  })
}

async function OnThreadMessageCreated (originTx: TxCUD<Doc>, control: TriggerControl): Promise<Tx[]> {
  const hierarchy = control.hierarchy
  const tx = TxProcessor.extractTx(originTx) as TxCreateDoc<ThreadMessage>

  if (tx._class !== core.class.TxCreateDoc || !hierarchy.isDerived(tx.objectClass, chunter.class.ThreadMessage)) {
    return []
  }

  const threadMessage = TxProcessor.createDoc2Doc(tx)
  const message = (await control.findAll(activity.class.ActivityMessage, { _id: threadMessage.attachedTo }))[0]

  if (message === undefined) {
    return []
  }

  const lastReplyTx = control.txFactory.createTxUpdateDoc<ActivityMessage>(
    threadMessage.attachedToClass,
    threadMessage.space,
    threadMessage.attachedTo,
    {
      lastReply: originTx.modifiedOn
    }
  )

  const personAccount = control.modelDb.getObject(originTx.modifiedBy) as PersonAccount

  if ((message.repliedPersons ?? []).includes(personAccount.person)) {
    return [lastReplyTx]
  }

  const repliedPersonTx = control.txFactory.createTxUpdateDoc<ActivityMessage>(
    threadMessage.attachedToClass,
    threadMessage.space,
    threadMessage.attachedTo,
    {
      $push: { repliedPersons: personAccount.person }
    }
  )

  return [lastReplyTx, repliedPersonTx]
}

async function OnChatMessageCreated (tx: TxCUD<Doc>, control: TriggerControl): Promise<Tx[]> {
  const hierarchy = control.hierarchy
  const actualTx = TxProcessor.extractTx(tx) as TxCreateDoc<ChatMessage>

  if (
    actualTx._class !== core.class.TxCreateDoc ||
    !hierarchy.isDerived(actualTx.objectClass, chunter.class.ChatMessage)
  ) {
    return []
  }

  const message = TxProcessor.createDoc2Doc(actualTx)
  const mixin = hierarchy.classHierarchyMixin(message.attachedToClass, notification.mixin.ClassCollaborators)

  if (mixin === undefined) {
    return []
  }

  const targetDoc = (await control.findAll(message.attachedToClass, { _id: message.attachedTo }, { limit: 1 }))[0]
  if (targetDoc === undefined) {
    return []
  }
  const isChannel = hierarchy.isDerived(targetDoc._class, chunter.class.Channel)
  const res: Tx[] = []

  if (hierarchy.hasMixin(targetDoc, notification.mixin.Collaborators)) {
    const collaboratorsMixin = hierarchy.as(targetDoc, notification.mixin.Collaborators)
    if (!collaboratorsMixin.collaborators.includes(message.modifiedBy)) {
      res.push(
        control.txFactory.createTxMixin(
          targetDoc._id,
          targetDoc._class,
          targetDoc.space,
          notification.mixin.Collaborators,
          {
            $push: {
              collaborators: message.modifiedBy
            }
          }
        )
      )
    }
  } else {
    const collaborators = await getDocCollaborators(targetDoc, mixin, control)
    if (!collaborators.includes(message.modifiedBy)) {
      collaborators.push(message.modifiedBy)
    }
    res.push(getMixinTx(tx, control, collaborators))
  }

  if (isChannel && !(targetDoc as Channel).members.includes(message.modifiedBy)) {
    res.push(...joinChannel(control, targetDoc as Channel, message.modifiedBy))
  }

  return res
}

async function ChatNotificationsHandler (tx: TxCUD<Doc>, control: TriggerControl): Promise<Tx[]> {
  const actualTx = TxProcessor.extractTx(tx) as TxCreateDoc<ChatMessage>

  if (actualTx._class !== core.class.TxCreateDoc) {
    return []
  }

  const chatMessage = TxProcessor.createDoc2Doc(actualTx)

  return await createCollaboratorNotifications(control.ctx, tx, control, [chatMessage])
}

function joinChannel (control: TriggerControl, channel: Channel, user: Ref<Account>): Tx[] {
  if (channel.members.includes(user)) {
    return []
  }

  return [
    control.txFactory.createTxUpdateDoc(channel._class, channel.space, channel._id, {
      $push: { members: user }
    })
  ]
}

async function OnThreadMessageDeleted (tx: Tx, control: TriggerControl): Promise<Tx[]> {
  const hierarchy = control.hierarchy
  const removeTx = TxProcessor.extractTx(tx) as TxRemoveDoc<ThreadMessage>

  if (!hierarchy.isDerived(removeTx.objectClass, chunter.class.ThreadMessage)) {
    return []
  }

  const message = control.removedMap.get(removeTx.objectId) as ThreadMessage

  if (message === undefined) {
    return []
  }

  const messages = await control.findAll(chunter.class.ThreadMessage, {
    attachedTo: message.attachedTo
  })

  const updateTx = control.txFactory.createTxUpdateDoc<ActivityMessage>(
    message.attachedToClass,
    message.space,
    message.attachedTo,
    {
      repliedPersons: messages
        .map(({ createdBy }) =>
          createdBy !== undefined ? (control.modelDb.getObject(createdBy) as PersonAccount).person : undefined
        )
        .filter((person): person is Ref<Person> => person !== undefined),
      lastReply:
        messages.length > 0
          ? Math.max(...messages.map(({ createdOn, modifiedOn }) => createdOn ?? modifiedOn))
          : undefined
    }
  )

  return [updateTx]
}

/**
 * @public
 */
export async function ChunterTrigger (tx: TxCUD<Doc>, control: TriggerControl): Promise<Tx[]> {
  const res: Tx[] = []
  res.push(
    ...(await control.ctx.with('OnThreadMessageCreated', {}, async (ctx) => await OnThreadMessageCreated(tx, control)))
  )
  res.push(
    ...(await control.ctx.with('OnThreadMessageDeleted', {}, async (ctx) => await OnThreadMessageDeleted(tx, control)))
  )
  res.push(
    ...(await control.ctx.with(
      'OnCollaboratorsChanged',
      {},
      async (ctx) => await OnCollaboratorsChanged(tx as TxMixin<Doc, Collaborators>, control)
    ))
  )
  res.push(
    ...(await control.ctx.with('OnChatMessageCreated', {}, async (ctx) => await OnChatMessageCreated(tx, control)))
  )
  return res
}

/**
 * @public
 */
export async function getChunterNotificationContent (
  _: Doc,
  tx: TxCUD<Doc>,
  target: Ref<Account>,
  control: TriggerControl
): Promise<NotificationContent> {
  let title: IntlString = notification.string.CommonNotificationTitle
  let body: IntlString = chunter.string.Message
  const intlParams: Record<string, string | number> = {}
  let intlParamsNotLocalized: Record<string, IntlString> | undefined

  let message: string | undefined

  if (tx._class === core.class.TxCollectionCUD) {
    const ptx = tx as TxCollectionCUD<Doc, AttachedDoc>
    if (ptx.tx._class === core.class.TxCreateDoc) {
      if (control.hierarchy.isDerived(ptx.tx.objectClass, chunter.class.ChatMessage)) {
        const createTx = ptx.tx as TxCreateDoc<ChatMessage>
        message = createTx.attributes.message
      } else if (ptx.tx.objectClass === activity.class.ActivityReference) {
        const createTx = ptx.tx as TxCreateDoc<ActivityReference>
        message = createTx.attributes.message
      }
    }
  }

  if (message !== undefined) {
    intlParams.message = stripTags(message, NOTIFICATION_BODY_SIZE)

    body = chunter.string.MessageNotificationBody

    if (control.hierarchy.isDerived(tx.objectClass, chunter.class.DirectMessage)) {
      body = chunter.string.DirectNotificationBody
      title = chunter.string.DirectNotificationTitle
    }
  }

  if (control.hierarchy.isDerived(tx.objectClass, chunter.class.ChatMessage)) {
    intlParamsNotLocalized = {
      title: chunter.string.ThreadMessage
    }
  }

  return {
    title,
    body,
    intlParams,
    intlParamsNotLocalized
  }
}

async function OnChatMessageRemoved (tx: TxCollectionCUD<Doc, ChatMessage>, control: TriggerControl): Promise<Tx[]> {
  if (tx.tx._class !== core.class.TxRemoveDoc) {
    return []
  }

  const res: Tx[] = []
  const notifications = await control.findAll(notification.class.InboxNotification, { attachedTo: tx.tx.objectId })

  notifications.forEach((notification) => {
    res.push(control.txFactory.createTxRemoveDoc(notification._class, notification.space, notification._id))
  })

  return res
}

function combineAttributes (attributes: any[], key: string, operator: string, arrayKey: string): any[] {
  return Array.from(
    new Set(
      attributes.flatMap((attr) =>
        Array.isArray(attr[operator]?.[key]?.[arrayKey]) ? attr[operator]?.[key]?.[arrayKey] : attr[operator]?.[key]
      )
    )
  ).filter((v) => v != null)
}

async function OnChannelMembersChanged (tx: TxUpdateDoc<Channel>, control: TriggerControl): Promise<Tx[]> {
  const changedAttributes = Object.entries(tx.operations)
    .flatMap(([id, val]) => (['$push', '$pull'].includes(id) ? Object.keys(val) : id))
    .filter((id) => !id.startsWith('$'))

  if (!changedAttributes.includes('members')) {
    return []
  }

  const added = combineAttributes([tx.operations], 'members', '$push', '$each')
  const removed = combineAttributes([tx.operations], 'members', '$pull', '$in')

  const res: Tx[] = []
  const allContexts = await control.findAll(notification.class.DocNotifyContext, { attachedTo: tx.objectId })

  if (removed.length > 0) {
    res.push(
      control.txFactory.createTxMixin(tx.objectId, tx.objectClass, tx.objectSpace, notification.mixin.Collaborators, {
        $pull: {
          collaborators: { $in: removed }
        }
      })
    )
  }

  if (added.length > 0) {
    res.push(
      control.txFactory.createTxMixin(tx.objectId, tx.objectClass, tx.objectSpace, notification.mixin.Collaborators, {
        $push: {
          collaborators: { $each: added, $position: 0 }
        }
      })
    )
  }

  for (const addedMember of added) {
    const context = allContexts.find(({ user }) => user === addedMember)

    if (context === undefined) {
      const createTx = control.txFactory.createTxCreateDoc(notification.class.DocNotifyContext, tx.objectSpace, {
        attachedTo: tx.objectId,
        attachedToClass: tx.objectClass,
        user: addedMember,
        lastViewedTimestamp: tx.modifiedOn
      })

      await control.apply([createTx])
    } else {
      const updateTx = control.txFactory.createTxUpdateDoc(context._class, context.space, context._id, {
        lastViewedTimestamp: tx.modifiedOn
      })

      res.push(updateTx)
    }
  }

  const contextsToRemove = allContexts.filter(({ user }) => removed.includes(user))

  for (const context of contextsToRemove) {
    res.push(control.txFactory.createTxRemoveDoc(context._class, context.space, context._id))
  }

  return res
}

async function OnCollaboratorsChanged (tx: TxMixin<Doc, Collaborators>, control: TriggerControl): Promise<Tx[]> {
  if (tx._class !== core.class.TxMixin || tx.mixin !== notification.mixin.Collaborators) return []

  if (!control.hierarchy.isDerived(tx.objectClass, chunter.class.Channel)) return []

  const doc = (await control.findAll(tx.objectClass, { _id: tx.objectId }))[0] as Channel | undefined

  if (doc === undefined) return []
  if (doc.private) return []

  const added = combineAttributes([tx.attributes], 'collaborators', '$push', '$each')
  const res: Tx[] = []

  for (const addedMember of added) {
    res.push(...joinChannel(control, doc, addedMember))
  }

  return res
}

async function hideOldDirects (
  directs: DocNotifyContext[],
  control: TriggerControl,
  date: Timestamp
): Promise<TxMixin<DocNotifyContext, ChannelInfo>[]> {
  const visibleDirects = directs.filter((context) => {
    const hasMixin = control.hierarchy.hasMixin(context, chunter.mixin.ChannelInfo)
    if (!hasMixin) return true
    const info = control.hierarchy.as(context, chunter.mixin.ChannelInfo)

    return !info.hidden
  })

  const minVisibleDirects = 10

  if (visibleDirects.length <= minVisibleDirects) return []
  const canHide = visibleDirects.length - minVisibleDirects

  let toHide: DocNotifyContext[] = []

  for (const context of directs) {
    const { lastUpdateTimestamp = 0, lastViewedTimestamp = 0 } = context

    if (lastUpdateTimestamp > lastViewedTimestamp) continue
    if (date - lastUpdateTimestamp < hideChannelDelay) continue

    toHide.push(context)
  }

  if (toHide.length > canHide) {
    toHide = toHide.splice(0, toHide.length - canHide)
  }

  return await hideOldChannels(toHide, control)
}

async function hideOldActivityChannels (
  contexts: DocNotifyContext[],
  control: TriggerControl,
  date: Timestamp
): Promise<TxMixin<DocNotifyContext, ChannelInfo>[]> {
  if (contexts.length === 0) return []

  const { hierarchy } = control
  const toHide: DocNotifyContext[] = []

  for (const context of contexts) {
    const { lastUpdateTimestamp = 0, lastViewedTimestamp = 0 } = context

    if (lastUpdateTimestamp > lastViewedTimestamp) continue
    console.log({ diff: date - lastUpdateTimestamp, delay: hideChannelDelay })
    if (date - lastUpdateTimestamp < hideChannelDelay) continue

    const params = hierarchy.as(context, chunter.mixin.ChannelInfo)
    if (params.hidden) continue

    toHide.push(context)
  }

  return await hideOldChannels(toHide, control)
}

async function hideOldChannels (
  contexts: DocNotifyContext[],
  control: TriggerControl
): Promise<TxMixin<DocNotifyContext, ChannelInfo>[]> {
  const res: TxMixin<DocNotifyContext, ChannelInfo>[] = []

  for (const context of contexts) {
    const tx = control.txFactory.createTxMixin(context._id, context._class, context.space, chunter.mixin.ChannelInfo, {
      hidden: true
    })
    res.push(tx)
  }

  return res
}

async function updateChatInfo (control: TriggerControl, status: UserStatus, date: Timestamp): Promise<void> {
  const account = await control.modelDb.findOne(contact.class.PersonAccount, { _id: status.user as Ref<PersonAccount> })
  if (account === undefined) return

  const chatUpdates = await control.queryFind(chunter.class.ChatInfo, {})
  const update = chatUpdates.find(({ user }) => user === account.person)
  const shouldUpdate = update === undefined || date - update.timestamp > updateChatInfoDelay

  if (!shouldUpdate) return

  const contexts = await control.findAll(notification.class.DocNotifyContext, {
    user: account._id,
    isPinned: { $ne: true }
  })

  if (contexts.length === 0) return

  const { hierarchy } = control
  const res: Tx[] = []

  const directContexts = contexts.filter(({ attachedToClass }) =>
    hierarchy.isDerived(attachedToClass, chunter.class.DirectMessage)
  )
  const activityContexts = contexts.filter(
    ({ attachedToClass }) =>
      !hierarchy.isDerived(attachedToClass, chunter.class.DirectMessage) &&
      !hierarchy.isDerived(attachedToClass, chunter.class.Channel) &&
      !hierarchy.isDerived(attachedToClass, chunter.class.Channel)
  )

  const directTxes = await hideOldDirects(directContexts, control, date)
  const activityTxes = await hideOldActivityChannels(activityContexts, control, date)
  const mixinTxes = directTxes.concat(activityTxes)
  const hidden: Ref<DocNotifyContext>[] = mixinTxes.map((tx) => tx.objectId)

  res.push(...mixinTxes)

  if (update === undefined) {
    res.push(
      control.txFactory.createTxCreateDoc(chunter.class.ChatInfo, core.space.Workspace, {
        user: account.person,
        hidden,
        timestamp: date
      })
    )
  } else {
    res.push(
      control.txFactory.createTxUpdateDoc(update._class, update.space, update._id, {
        hidden: Array.from(new Set(update.hidden.concat(hidden))),
        timestamp: date
      })
    )
  }

  const txIds = res.map((tx) => tx._id)

  await control.apply(res)

  control.operationContext.derived.targets.docNotifyContext = (it) => {
    if (txIds.includes(it._id)) {
      return [account.email]
    }
  }
}

async function OnUserStatus (originTx: TxCUD<UserStatus>, control: TriggerControl): Promise<Tx[]> {
  const tx = TxProcessor.extractTx(originTx) as TxCUD<UserStatus>
  if (tx.objectClass !== core.class.UserStatus) return []
  if (tx._class === core.class.TxCreateDoc) {
    const createTx = tx as TxCreateDoc<UserStatus>
    const { online } = createTx.attributes
    if (online) {
      const status = TxProcessor.createDoc2Doc(createTx)
      await updateChatInfo(control, status, originTx.modifiedOn)
    }
  } else if (tx._class === core.class.TxUpdateDoc) {
    const updateTx = tx as TxUpdateDoc<UserStatus>
    const { online } = updateTx.operations
    if (online === true) {
      const status = (await control.findAll(core.class.UserStatus, { _id: updateTx.objectId }))[0]
      await updateChatInfo(control, status, originTx.modifiedOn)
    }
  }

  return []
}

async function OnContextUpdate (tx: TxUpdateDoc<DocNotifyContext>, control: TriggerControl): Promise<Tx[]> {
  const hasUpdate = 'lastUpdateTimestamp' in tx.operations && tx.operations.lastUpdateTimestamp !== undefined
  if (!hasUpdate) return []

  const chatUpdates = await control.queryFind(chunter.class.ChatInfo, {})
  for (const update of chatUpdates) {
    if (update.hidden.includes(tx.objectId)) {
      return [
        control.txFactory.createTxMixin(tx.objectId, tx.objectClass, tx.objectSpace, chunter.mixin.ChannelInfo, {
          hidden: false
        }),
        control.txFactory.createTxUpdateDoc(update._class, update.space, update._id, {
          hidden: update.hidden.filter((id) => id !== tx.objectId)
        })
      ]
    }
  }

  return []
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export default async () => ({
  trigger: {
    ChunterTrigger,
    OnChatMessageRemoved,
    OnChannelMembersChanged,
    ChatNotificationsHandler,
    OnUserStatus,
    OnContextUpdate
  },
  function: {
    CommentRemove,
    ChannelHTMLPresenter: channelHTMLPresenter,
    ChannelTextPresenter: channelTextPresenter,
    ChunterNotificationContentProvider: getChunterNotificationContent,
    ChatMessageTextPresenter
  }
})
