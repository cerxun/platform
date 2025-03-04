<!--
// Copyright © 2023 Hardcore Engineering Inc.
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
-->
<script lang="ts">
  import { Class, Doc, getCurrentAccount, Ref } from '@hcengineering/core'
  import notification, { DocNotifyContext } from '@hcengineering/notification'
  import activity, { ActivityMessage, ActivityMessagesFilter } from '@hcengineering/activity'
  import { getClient, isSpace } from '@hcengineering/presentation'
  import { getMessageFromLoc, messageInFocus } from '@hcengineering/activity-resources'
  import { location as locationStore } from '@hcengineering/ui'

  import chunter from '../plugin'
  import ChannelScrollView from './ChannelScrollView.svelte'
  import { ChannelDataProvider } from '../channelDataProvider'
  import { onDestroy } from 'svelte'

  export let object: Doc
  export let context: DocNotifyContext | undefined
  export let filters: Ref<ActivityMessagesFilter>[] = []
  export let isAsideOpened = false

  const client = getClient()
  const hierarchy = client.getHierarchy()

  let dataProvider: ChannelDataProvider | undefined
  let selectedMessageId: Ref<ActivityMessage> | undefined = undefined

  const unsubscribe = messageInFocus.subscribe((id) => {
    if (id !== undefined && id !== selectedMessageId) {
      selectedMessageId = id
    }

    messageInFocus.set(undefined)
  })

  const unsubscribeLocation = locationStore.subscribe((newLocation) => {
    const id = getMessageFromLoc(newLocation)
    selectedMessageId = id
    messageInFocus.set(id)
  })

  onDestroy(() => {
    unsubscribe()
    unsubscribeLocation()
    dataProvider?.destroy()
    dataProvider = undefined
  })

  $: isDocChannel = !hierarchy.isDerived(object._class, chunter.class.ChunterSpace)
  $: _class = isDocChannel ? activity.class.ActivityMessage : chunter.class.ChatMessage
  $: collection = isDocChannel ? 'comments' : 'messages'

  $: void updateDataProvider(object._id, _class, selectedMessageId)

  async function updateDataProvider (
    attachedTo: Ref<Doc>,
    _class: Ref<Class<ActivityMessage>>,
    selectedMessageId?: Ref<ActivityMessage>
  ): Promise<void> {
    if (dataProvider === undefined) {
      // For now loading all messages for documents with activity. Need to correct handle aggregation with pagination.
      // Perhaps we should load all activity messages once, and keep loading in chunks only for ChatMessages then merge them correctly with activity messages
      const loadAll = isDocChannel
      const ctx =
        context ??
        (await client.findOne(notification.class.DocNotifyContext, {
          attachedTo: object._id,
          user: getCurrentAccount()._id
        }))

      const space = isSpace(object) ? object._id : object.space
      dataProvider = new ChannelDataProvider(ctx, space, attachedTo, _class, selectedMessageId, loadAll)
    }
  }
</script>

{#if dataProvider}
  <ChannelScrollView
    objectId={object._id}
    objectClass={object._class}
    {object}
    skipLabels={!isDocChannel}
    selectedFilters={filters}
    startFromBottom
    bind:selectedMessageId
    {collection}
    provider={dataProvider}
    {isAsideOpened}
    loadMoreAllowed={!isDocChannel}
  />
{/if}
