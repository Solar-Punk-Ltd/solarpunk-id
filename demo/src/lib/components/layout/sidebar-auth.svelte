<!--
  Copyright 2026 The Swarm Authors. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
-->

<script lang="ts">
  import { Button } from '$lib/components/ui/button'
  import { Checkbox } from '$lib/components/ui/checkbox'
  import { Label } from '$lib/components/ui/label'
  import { Separator } from '$lib/components/ui/separator'
  import { Popover } from '$lib/components/ui/popover'
  import InfoButton from '$lib/components/ui/tooltip/info-button.svelte'
  import SwarmIdButton from '$lib/components/swarm-id-button.svelte'
  import { clientStore } from '$lib/stores/client.svelte'

  let popoverOpen = $state(false)

  // Derive whether custom Bee API URL is set
  const hasCustomBeeApiUrl = $derived(clientStore.hasCustomBeeApiUrl)

  // Close popover when auth state changes (covers the Swarm ID button's sign-in)
  let prevAuth = $state(clientStore.authenticated)
  $effect(() => {
    const auth = clientStore.authenticated
    if (auth !== prevAuth) {
      prevAuth = auth
      popoverOpen = false
    }
  })

  const libraryDescription = $derived(
    clientStore.authenticated
      ? 'Clears your session via the library.'
      : 'Opens a popup from this page, where the identity frame shares storage with it.',
  )

  const libraryTooltip = $derived(
    clientStore.authenticated
      ? 'Calls client.disconnect() to clear your session and remove the app-specific keys from memory.'
      : "Calls client.connect(), which opens a popup to the identity provider from this page. The popup writes your session to localStorage, which the embedded frame (same origin) picks up via a storage event. Where the browser partitions the frame's storage it refuses with button-required, and the Swarm ID button below is the way in.",
  )

  const buttonTooltip =
    "client.mountButton() puts Swarm ID's own button here, in a frame of its own beside the hidden one. Because the popup is opened from that frame's click, the session can be handed back to Swarm ID's frames, the path that still works when the browser partitions their storage and a storage event would never arrive."
</script>

<Popover bind:open={popoverOpen}>
  {#snippet trigger()}
    {#if clientStore.authenticated && clientStore.identity}
      <button
        class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent"
        onclick={() => (popoverOpen = !popoverOpen)}
      >
        <img src={clientStore.identity.avatar.url} alt="" class="size-8 shrink-0 rounded-md" />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-foreground truncate">
            {clientStore.identity.name}
          </div>
          <div class="text-xs font-mono text-muted-foreground truncate">
            {clientStore.identity.address.slice(0, 6)}...{clientStore.identity.address.slice(-4)}
          </div>
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="text-muted-foreground shrink-0 transition-transform duration-200 {popoverOpen
            ? 'rotate-180'
            : ''}"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    {:else}
      <Button class="w-full" size="sm" onclick={() => (popoverOpen = !popoverOpen)}
        >Connect Swarm ID</Button
      >
    {/if}
  {/snippet}

  <div class="space-y-3">
    <!-- Library API section -->
    <div>
      <div class="flex items-start gap-1.5">
        <div class="min-w-0 flex-1">
          <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider"
            >Library API</span
          >
          <p class="text-xs text-muted-foreground mt-1">
            {libraryDescription}
          </p>
        </div>
        <InfoButton text={libraryTooltip} />
      </div>
      <Button
        onclick={() => {
          clientStore.connect()
          popoverOpen = false
        }}
        size="sm"
        class="w-full mt-2"
      >
        {clientStore.authenticated ? 'Disconnect' : 'Connect'}
      </Button>
    </div>

    {#if !clientStore.authenticated}
      <Separator />

      <!-- Swarm ID button section -->
      <div>
        <div class="flex items-start gap-1.5">
          <div class="min-w-0 flex-1">
            <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider"
              >Swarm ID button</span
            >
            <p class="text-xs text-muted-foreground mt-1">
              Opens the identity popup from Swarm ID's own frame, which works even when storage is
              partitioned.
            </p>
          </div>
          <InfoButton text={buttonTooltip} />
        </div>
        <div class="mt-2">
          <!-- Mounted while the panel is open and unmounted when it closes, the
               connect window included -->
          <SwarmIdButton
            id="swarm-id-button"
            action="sign-in"
            text="Connect to Swarm"
            active={popoverOpen}
          />
        </div>
      </div>

      <Separator />

      <!-- Subsidised gateway -->
      <div class="flex items-center gap-2">
        <Checkbox
          bind:checked={clientStore.subsidisedGatewayEnabled}
          id="popover-subsidised-gateway"
          disabled={hasCustomBeeApiUrl}
        />
        <Label
          for="popover-subsidised-gateway"
          class="text-xs text-muted-foreground {hasCustomBeeApiUrl
            ? 'opacity-50'
            : 'cursor-pointer'}"
        >
          Use subsidised gateway
          {#if hasCustomBeeApiUrl}
            (custom Bee node)
          {/if}
        </Label>
      </div>
    {/if}
  </div>
</Popover>
