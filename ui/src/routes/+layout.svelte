<!--
  Copyright 2026 The Swarm Authors. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
-->

<script lang="ts">
  import { onMount, untrack } from 'svelte'

  import { isSignedOutAccount, markFirstPartyStorage } from '@snaha/swarm-id/internal'
  import type { SyncedAccount } from '@snaha/swarm-id/internal'

  import { resolve } from '$app/paths'
  import { page } from '$app/state'

  import SafariBackupPrompt from '$lib/components/safari-backup-prompt.svelte'
  import Toast from '$lib/components/toast.svelte'
  // ponytail: the sync engine lives under `$lib/dev` but operates on real account
  // data — #389 can relocate it out of `$lib/dev`; not worth the churn here.
  import { foldCurrentAccount, startFoldInterval } from '$lib/dev/account-refresh'
  import { triggerSync } from '$lib/dev/sync-hooks'
  import { LAYOUT_VIEW, isFramed, layoutView } from '$lib/frame-guard'
  import routes from '$lib/routes'
  import { accountBusStore } from '$lib/stores/account-bus'
  import { accountsLoaded, accountsStore, setAccountsSyncHook } from '$lib/stores/accounts.svelte'
  import { sessionStore } from '$lib/stores/session.svelte'
  import { themeStore } from '$lib/stores/theme.svelte'
  import { toastStore } from '$lib/stores/toast.svelte'

  import '../app.css'

  let { children } = $props()

  const framed = isFramed()
  const base = resolve(routes.ROOT).replace(/\/$/, '')
  const view = $derived(layoutView({ pathname: page.url.pathname, base, framed }))
  const refused = $derived(view === LAYOUT_VIEW.REFUSAL)

  /** The stored record for an account, once it is signed in — a signed-out one
   *  carries no `derivationKey`, and the bus topic is derived from it. */
  function signedInRecord(accountIdHex: string | undefined): SyncedAccount | undefined {
    if (!accountIdHex) return undefined
    const record = accountsStore.get(accountIdHex)?.toRecord()
    return record && !isSignedOutAccount(record) ? record : undefined
  }

  onMount(() => {
    if (refused) return
    themeStore.init()
    // Leave the marker a proxy iframe reads back to learn whether it shares
    // this store (#613) — it decides which transport the auth popup can take,
    // and it has to be known before the click. A no-op when framed, which is
    // what keeps the /proxy route (same shell, inside the iframe) from writing
    // it into a partitioned bucket and answering its own question wrong.
    markFirstPartyStorage()
    // Publish account mutations app-wide (debounced): to Swarm for durability,
    // and to the account bus for the live contexts a storage event cannot
    // reach — a partitioned dApp iframe learns about a revoke no other way
    // (docs/Account-Bus.md). Previously wired only in /dev, so the shipping app
    // never synced (#389). Owned here now.
    setAccountsSyncHook((accountIdHex) => {
      triggerSync(accountIdHex)
      const record = signedInRecord(accountIdHex)
      if (record) accountBusStore.publish(record)
    })
    // Pull peer/node state back on a periodic (cross-tab-coalesced) tick.
    const stopFolding = startFoldInterval()
    return () => {
      stopFolding()
      accountBusStore.leave()
    }
  })

  // The bus room is the CURRENT account's: join on select/switch, leave on
  // sign-out.
  $effect(() => {
    if (refused) return
    const record = signedInRecord(sessionStore.currentAccountId)
    if (record) {
      accountBusStore.join(record)
    } else {
      accountBusStore.leave()
    }
  })

  // Force a fold whenever the active account is set or switched — the page-load
  // ("reload to force") and account-switch triggers. Reads ONLY the id (which
  // applyRefreshed never changes); `untrack` keeps the fold's accountsStore reads
  // out of this effect's dependencies, avoiding an $effect re-fire loop.
  $effect(() => {
    if (refused || !sessionStore.currentAccountId) {
      return
    }
    untrack(() => void foldCurrentAccount(true))
  })
</script>

{#if refused}
  <p class="p-4 text-sm">
    This page cannot be shown inside another site. Open the Swarm ID site in its own tab.
  </p>
{:else}
  {#await accountsLoaded then}
    {@render children()}
    {#if view === LAYOUT_VIEW.PAGE_WITH_PROMPTS}
      <SafariBackupPrompt />
    {/if}
  {/await}

  <Toast message={toastStore.message} />
{/if}
