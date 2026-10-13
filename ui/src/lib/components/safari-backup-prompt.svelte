<!--
  Copyright 2026 The Swarm Authors. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
-->

<!--
  Asks a Safari visitor once, after an account is created or imported on this
  device, to save a backup before Safari's 7-day storage limit can delete the
  account here (review P2-7, `$lib/backup-prompt`). The backup itself is the
  Account tab's existing recovery phrase and backup file sections.
-->
<script lang="ts">
  import { goto } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { page } from '$app/state'

  import { BACKUP_PROMPT_TEXT, markBackupPromptShown, shouldPromptBackup } from '$lib/backup-prompt'
  import { Button } from '$lib/components/ui/button'
  import { Dialog } from '$lib/components/ui/dialog'
  import routes from '$lib/routes'
  import { accountsStore } from '$lib/stores/accounts.svelte'
  import { sessionStore } from '$lib/stores/session.svelte'

  let answeredFor = $state<string | undefined>(undefined)

  const accountId = $derived(sessionStore.currentAccountId)
  const open = $derived.by(() => {
    if (!accountId || answeredFor === accountId) return false
    const account = accountsStore.get(accountId)
    if (!account || account.isSignedOut) return false
    return shouldPromptBackup(localStorage, accountId, navigator.userAgent)
  })

  // In the connect window the backup opens beside it, so the way back to the
  // app stays where it is.
  const inConnectWindow = $derived(page.url.pathname.startsWith(resolve(routes.CONNECT)))

  function answer() {
    if (!accountId) return
    markBackupPromptShown(localStorage, accountId)
    answeredFor = accountId
  }

  function saveBackup() {
    answer()
    const backupSection = `${resolve(routes.ROOT)}#account/phrase`
    if (inConnectWindow) {
      window.open(backupSection, '_blank')
    } else {
      // eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved above, plus a hash
      void goto(backupSection)
    }
  }
</script>

{#if open}
  <Dialog title={BACKUP_PROMPT_TEXT.title} onclose={answer}>
    <p class="text-sm">{BACKUP_PROMPT_TEXT.body}</p>
    <div class="flex w-full flex-col gap-2">
      <Button class="w-full" onclick={saveBackup}>{BACKUP_PROMPT_TEXT.save}</Button>
      <Button variant="outline" class="w-full" onclick={answer}>{BACKUP_PROMPT_TEXT.later}</Button>
    </div>
  </Dialog>
{/if}
