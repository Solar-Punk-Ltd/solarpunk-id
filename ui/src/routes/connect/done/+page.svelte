<!--
  Copyright 2026 The Swarm Authors. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
-->

<!--
  Post-connect confirmation. The secret was already delivered by
  completeConnect, which signed the site in with no stamp. Every variant says
  the account is connected and offers "Go to app", which is the confirm that
  ends the site's wait for its drive. Closing the window without it leaves the
  site with no drive. What sits between the two varies:
  - the account has drives and an entry for the site: a picker for the drive
    the site uses, starting on its current one, read from the account's own
    record. A site with no drive of its own yet starts on the account default,
    offered and not given: the confirm saves whatever the picker shows as the
    site's postageStampBatchID when it differs from what the site has, and a
    frame kept apart from this window's storage is handed the drive, so the
    open site starts stamping. When that frame is gone the
    screen says the site has no drive until it connects again, and the next
    "Go to app" only closes the window.
  - the account has no drives: the drive pitch, a secondary card that opens
    the add-drive dialog.
  - the account has drives but no entry for the site: the plain confirmation,
    nothing in between.
-->
<script lang="ts">
  import { onMount } from 'svelte'

  import ArrowRight from '@lucide/svelte/icons/arrow-right'

  import { goto } from '$app/navigation'
  import { resolve } from '$app/paths'

  import {
    appStampChoice,
    appStampOptions,
    appStampValue,
    connectPickerStart,
  } from '$lib/app-stamp'
  import AccountAvatar from '$lib/components/account-avatar.svelte'
  import AppHeader from '$lib/components/app-header.svelte'
  import DriveAddDialog from '$lib/components/drive-add-dialog.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Select } from '$lib/components/ui/select'
  import { handOverPickedStamp } from '$lib/connect-handshake'
  import routes from '$lib/routes'
  import { accountsStore } from '$lib/stores/accounts.svelte'
  import { connectStore } from '$lib/stores/connect.svelte'
  import { sessionStore } from '$lib/stores/session.svelte'
  import { toastStore } from '$lib/stores/toast.svelte'
  import { truncateAddress } from '$lib/utils'

  const AVATAR_SIZE = 80

  const account = $derived(
    sessionStore.currentAccountId ? accountsStore.get(sessionStore.currentAccountId) : undefined,
  )
  const request = connectStore.request

  const drives = $derived(account?.stamps ?? [])
  const app = $derived(account?.activeApps.find((entry) => entry.appUrl === request?.appOrigin))
  const showPicker = $derived(drives.length > 0 && app !== undefined)
  const showPitch = $derived(drives.length === 0)

  const driveOptions = $derived(account ? appStampOptions(account) : [])
  /** The drive the site uses as the window opened, or none */
  const currentDriveValue = $derived(account && app ? appStampValue(app, account) : '')
  /** Where the picker starts: the site's drive, or the account default offered to it */
  const startDriveValue = $derived(account && app ? connectPickerStart(app, account) : '')
  let pickedDriveValue = $state<string | undefined>(undefined)
  const selectedDriveValue = $derived(pickedDriveValue ?? startDriveValue)
  /** The pick was confirmed but could not be carried to the open site */
  let pickNotReached = $state(false)

  let addDriveOpen = $state(false)

  onMount(() => {
    if (!account || !request) {
      goto(resolve(routes.ROOT))
      return
    }
    toastStore.show(`Connected to ${request.appName}!`)
  })

  async function goToApp() {
    if (!pickNotReached && account && request && app) {
      const changed = showPicker && selectedDriveValue !== currentDriveValue
      await account.confirmAppStamp(
        request.appOrigin,
        changed ? { batchID: appStampChoice(selectedDriveValue) } : undefined,
      )
      if (handOverPickedStamp(account, request) === 'not-reached' && showPicker) {
        pickNotReached = true
        return
      }
    }
    connectStore.clear()
    window.close()
  }
</script>

{#if account && request}
  <div class="flex min-h-svh flex-col">
    <AppHeader />

    <main class="flex w-full flex-1 flex-col items-center justify-center px-8 pb-24">
      <div class="flex w-full max-w-96 flex-col items-center gap-8">
        <div class="flex w-full flex-col items-center gap-4">
          <AccountAvatar
            value={account.id.toHex()}
            size={AVATAR_SIZE}
            class="shrink-0 overflow-hidden rounded-lg"
          />
          <div class="flex w-full flex-col items-center gap-2 text-center">
            <p class="w-full truncate text-lg leading-none font-bold">{account.name}</p>
            <p class="text-sm">{truncateAddress(account.id.toChecksum())}</p>
          </div>
        </div>

        <div class="flex w-full flex-col gap-4">
          <p class="text-center text-base">
            Your Swarm ID is now connected to {request.appName}!
          </p>

          {#if showPicker}
            <div class="flex w-full flex-col gap-2">
              <label for="connect-drive" class="text-sm">Select drive</label>
              <Select
                id="connect-drive"
                options={driveOptions}
                value={selectedDriveValue}
                disabled={pickNotReached}
                onchange={(value) => (pickedDriveValue = value)}
              />
              <p class="text-muted-foreground text-sm">Where this app will store data</p>
            </div>
          {/if}

          {#if pickNotReached}
            <p class="text-sm" role="status">
              Saved. The site has no drive until it connects again.
            </p>
          {/if}

          <Button class="w-full" onclick={goToApp}>
            Go to app
            <ArrowRight />
          </Button>
        </div>

        {#if showPitch}
          <div class="bg-muted flex w-full flex-col gap-2 rounded-xl p-2 text-center">
            <div class="flex flex-col">
              <p class="text-sm font-bold">Want the full experience?</p>
              <p class="text-sm">
                Upload data and sync your Swarm ID across devices with a Swarm drive.
              </p>
            </div>
            <Button variant="outline" class="w-full" onclick={() => (addDriveOpen = true)}>
              Set up a drive
            </Button>
          </div>
        {/if}
      </div>
    </main>

    {#if addDriveOpen}
      <DriveAddDialog {account} onClose={() => (addDriveOpen = false)} onAdded={toastStore.show} />
    {/if}
  </div>
{/if}
