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
  import { eventToHTMLElement, Label, ModernButton, showPopup, Icon } from '@hcengineering/ui'
  import PinnedMessagesPopup from './PinnedMessagesPopup.svelte'
  import { createQuery } from '@hcengineering/presentation'
  import activity, { ActivityMessage } from '@hcengineering/activity'
  import { Class, Doc, Ref, Space } from '@hcengineering/core'
  import view from '@hcengineering/view'
  import { ThreadMessage } from '@hcengineering/chunter'
  import { createEventDispatcher } from 'svelte'

  import chunter from '../plugin'
  import { getChannelSpace } from '../utils'

  export let space: Ref<Space>
  export let _class: Ref<Class<Doc>>
  export let _id: Ref<Doc>

  const dispatch = createEventDispatcher()
  const pinnedQuery = createQuery()
  const pinnedThreadsQuery = createQuery()

  let pinnedMessagesCount = 0
  let pinnedThreadsCount = 0

  $: channelSpace = getChannelSpace(_class, _id, space)
  $: pinnedQuery.query(
    activity.class.ActivityMessage,
    { attachedTo: _id, isPinned: true, space: channelSpace },
    (res: ActivityMessage[]) => {
      pinnedMessagesCount = res.length
    },
    { projection: { _id: 1, space: 1, attachedTo: 1, isPinned: 1 } }
  )

  $: pinnedThreadsQuery.query(
    chunter.class.ThreadMessage,
    { objectId: _id, isPinned: true, space: channelSpace },
    (res: ThreadMessage[]) => {
      pinnedThreadsCount = res.length
    },
    { projection: { _id: 1, space: 1, objectId: 1, isPinned: 1 } }
  )

  function openMessagesPopup (ev: MouseEvent): void {
    showPopup(
      PinnedMessagesPopup,
      { attachedTo: _id, attachedToClass: _class, space: channelSpace },
      eventToHTMLElement(ev),
      (result) => {
        if (result == null) return
        dispatch('select', result)
      }
    )
  }

  $: count = pinnedMessagesCount + pinnedThreadsCount
</script>

{#if count > 0}
  <ModernButton size={'small'} on:click={openMessagesPopup}>
    <Icon icon={view.icon.Pin} size={'x-small'} />
    <span class="text-sm"><Label label={chunter.string.PinnedCount} params={{ count }} /></span>
  </ModernButton>
{/if}
