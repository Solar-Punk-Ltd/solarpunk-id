<!--
  Copyright 2026 The Swarm Authors. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
-->

<!--
  "Show my ENS name on sites", for an account secured with a wallet
  (docs/Wallet-Link.md). On, the wallet and the account sign a wallet link that
  every connected site receives and can look the wallet's ENS name up with.
  Off, sites learn no wallet at all.
-->
<script lang="ts">
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'

  import { createAttemptTracker } from '$lib/attempt'
  import { Button } from '$lib/components/ui/button'
  import { Dialog } from '$lib/components/ui/dialog'
  import { createWalletLink } from '$lib/crypto/wallet-link'
  import { toastStore } from '$lib/stores/toast.svelte'
  import type { Account } from '$lib/types'

  interface Props {
    account: Account
  }

  let { account }: Props = $props()

  const shown = $derived(account.walletLink !== undefined)

  let dialog = $state<'turn-on' | 'pending' | 'turn-off' | undefined>(undefined)
  let error = $state<string | undefined>(undefined)
  /** Cancel/retry supersedes the in-flight ceremony: it must not complete. */
  const attempts = createAttemptTracker()

  function open(next: 'turn-on' | 'turn-off') {
    error = undefined
    dialog = next
  }

  function close() {
    // A wallet prompt cannot be aborted, so a later approval of a cancelled
    // one must not store a link.
    attempts.supersede()
    dialog = undefined
    error = undefined
  }

  async function turnOn() {
    const attempt = attempts.begin()
    error = undefined
    dialog = 'pending'
    try {
      const link = await attempt.guard(createWalletLink(account))
      if (account.isSignedOut) {
        // Signed out mid-ceremony (e.g. cross-tab): the setting would write
        // into the synced fields the sign-out just stripped.
        dialog = undefined
        return
      }
      account.setWalletLink(link)
      dialog = undefined
      toastStore.show('Sites can now show your ENS name')
    } catch (caught) {
      if (attempt.current) {
        error = caught instanceof Error ? caught.message : 'Could not link your wallet.'
        dialog = 'turn-on'
      }
    }
  }

  function turnOff() {
    account.setWalletLink(undefined)
    dialog = undefined
    toastStore.show('Sites no longer receive your ENS name')
  }
</script>

<div class="border-border flex w-full flex-col gap-2 rounded-lg border px-4 py-3">
  <div class="flex w-full items-center gap-2">
    <p class="flex-1 text-sm font-bold">Show my ENS name on sites</p>
    <Button
      variant="ghost"
      size="sm"
      class="-mr-2"
      onclick={() => open(shown ? 'turn-off' : 'turn-on')}
    >
      {shown ? 'Turn off' : 'Turn on'}
    </Button>
  </div>
  {#if shown}
    <p class="text-sm">
      On. Sites you connect to receive your wallet address and can show its ENS name beside your
      messages.
    </p>
  {:else}
    <p class="text-sm">Off. Sites see only your Swarm ID address, never your wallet.</p>
  {/if}
</div>

{#if dialog === 'pending'}
  <Dialog onclose={close} dismissable={false}>
    <div class="flex flex-col items-center gap-2 py-4 text-center">
      <LoaderCircle class="size-5 animate-spin" />
      <p class="text-sm font-bold">Confirm with wallet</p>
      <p class="text-sm">
        Approve two requests in your Ethereum wallet: one unlocks your account, the other signs the
        link.
      </p>
    </div>
    <Button variant="outline" class="w-full" onclick={close}>Cancel</Button>
  </Dialog>
{:else if dialog === 'turn-on'}
  <Dialog onclose={close} title="Show your ENS name on sites?">
    <p class="text-sm">
      Your wallet signs a short statement that it and this Swarm ID account belong together. Every
      site you connect to receives it, so it learns your wallet address and can show the wallet's
      ENS name, such as name.eth. If the wallet has no ENS name, sites show nothing new.
    </p>
    <p class="text-sm">You can turn this off at any time.</p>
    {#if error}
      <p class="text-destructive text-xs">{error}</p>
    {/if}
    <Button class="w-full" onclick={turnOn}>Confirm with wallet</Button>
  </Dialog>
{:else if dialog === 'turn-off'}
  <Dialog onclose={close} title="Stop showing your ENS name?">
    <p class="text-sm">
      Sites stop receiving your wallet address and ENS name from now on. Messages you already sent
      keep showing your name, because the link travels with each message.
    </p>
    <Button variant="destructive" class="w-full" onclick={turnOff}>Turn off</Button>
  </Dialog>
{/if}
