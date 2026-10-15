<!--
  Copyright 2026 The Swarm Authors. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
-->

<!--
  A Swarm ID button, mounted with client.mountButton() once the client is up.
  It is Swarm ID's own frame: its click opens the connect window from inside
  Swarm ID, which is what lets a site on another site sign in.
-->
<script lang="ts">
  import type { ButtonAction } from '@solarpunkltd/swarm-id'
  import { clientStore, demoButtonConfig } from '$lib/stores/client.svelte'
  import { logStore } from '$lib/stores/log.svelte'

  interface Props {
    action: ButtonAction
    text: string
    id?: string
    class?: string
  }

  let { action, text, id, class: className = 'h-[36px] w-full' }: Props = $props()

  let container = $state<HTMLDivElement>()

  $effect(() => {
    const client = clientStore.client
    if (!container || !client || clientStore.initializing) return
    const button = client.mountButton(container, {
      action,
      config: { ...demoButtonConfig(), text },
      onWindowChange: (state) => {
        if (state === 'blocked') logStore.log('The browser blocked the Swarm ID window', 'warn')
      },
    })
    button.ready.catch((error: unknown) =>
      logStore.log(
        `Swarm ID button: ${error instanceof Error ? error.message : String(error)}`,
        'error',
      ),
    )
    return () => button.unmount()
  })
</script>

<div bind:this={container} {id} class={className}></div>
