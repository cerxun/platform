<!--
// Copyright © 2024 Hardcore Engineering Inc.
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
  import { type Ref, type WithLookup } from '@hcengineering/core'
  import { createFileVersion, type File as DriveFile, type FileVersion } from '@hcengineering/drive'
  import { Panel } from '@hcengineering/panel'
  import { createQuery, getBlobHref, getClient } from '@hcengineering/presentation'
  import { Button, IconMoreH } from '@hcengineering/ui'
  import { showFilesUploadPopup } from '@hcengineering/uploader'
  import view from '@hcengineering/view'
  import { showMenu } from '@hcengineering/view-resources'

  import EditFile from './EditFile.svelte'
  import FileAside from './FileAside.svelte'
  import FileHeader from './FileHeader.svelte'
  import IconDownload from './icons/FileDownload.svelte'
  import IconUpload from './icons/FileUpload.svelte'

  import drive from '../plugin'

  export let _id: Ref<DriveFile>
  export let readonly: boolean = false
  export let embedded: boolean = false

  export function canClose (): boolean {
    return false
  }

  let object: WithLookup<DriveFile> | undefined = undefined
  let version: FileVersion | undefined = undefined
  let download: HTMLAnchorElement

  const client = getClient()
  const query = createQuery()

  $: query.query(
    drive.class.File,
    { _id },
    (res) => {
      ;[object] = res
      version = object?.$lookup?.file
    },
    {
      lookup: {
        file: drive.class.FileVersion
      }
    }
  )

  function handleDownloadFile (): void {
    if (object != null && download != null) {
      download.click()
    }
  }

  function handleUploadFile (): void {
    if (object != null) {
      void showFilesUploadPopup(
        { objectId: object._id, objectClass: object._class },
        {
          maxNumberOfFiles: 1,
          hideProgress: true
        },
        {},
        async (uuid, name, file, path, metadata) => {
          const data = {
            file: uuid,
            name,
            size: file.size,
            type: file.type,
            lastModified: file instanceof File ? file.lastModified : Date.now(),
            metadata
          }

          await createFileVersion(client, _id, data)
        }
      )
    }
  }
</script>

{#if object && version}
  <Panel
    {object}
    {embedded}
    allowClose={!embedded}
    isHeader={false}
    useMaxWidth={false}
    adaptive={'default'}
    on:open
    on:close
    on:update
  >
    <svelte:fragment slot="title">
      <FileHeader {object} />
    </svelte:fragment>

    <svelte:fragment slot="utils">
      {#await getBlobHref(undefined, version.file, object.name) then href}
        <a class="no-line" {href} download={object.name} bind:this={download}>
          <Button
            icon={IconDownload}
            iconProps={{ size: 'medium' }}
            kind={'icon'}
            showTooltip={{ label: drive.string.Download }}
            on:click={handleDownloadFile}
          />
        </a>
      {/await}
      <Button
        icon={IconUpload}
        iconProps={{ size: 'medium' }}
        kind={'icon'}
        showTooltip={{ label: drive.string.Upload }}
        on:click={handleUploadFile}
      />
      <Button
        icon={IconMoreH}
        iconProps={{ size: 'medium' }}
        kind={'icon'}
        showTooltip={{ label: view.string.MoreActions }}
        on:click={(ev) => {
          showMenu(ev, { object })
        }}
      />
    </svelte:fragment>

    <svelte:fragment slot="aside">
      <FileAside {object} {readonly} />
    </svelte:fragment>

    <div class="flex-col flex-grow flex-no-shrink step-tb-6">
      <EditFile {object} {readonly} />
    </div>
  </Panel>
{/if}
