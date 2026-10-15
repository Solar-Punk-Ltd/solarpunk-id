<!--
  Copyright 2026 The Swarm Authors. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
-->

<!--
  The Swarm ID button a site mounts with the client's mountButton(). Its click
  opens the connect window, which hands the session back through this frame to
  the hidden /proxy frame beside it.
-->
<script lang="ts">
  import { onMount } from 'svelte'

  import { initButtonFrame } from '@solarpunkltd/swarm-id/internal'

  import { siteAllowList } from '$lib/accepted-site'

  let container = $state<HTMLDivElement>()

  onMount(() => {
    if (!container) return
    const frame = initButtonFrame(
      { siteAllowList: siteAllowList(), allowLocalHttp: import.meta.env.DEV },
      container,
    )
    return () => frame.destroy()
  })
</script>

<div bind:this={container} class="h-svh w-full"></div>

<style>
  /* Embedded in the site's page, so it blends in instead of painting our theme. */
  :global(body) {
    background: transparent;
    overflow: hidden;
    margin: 0;
  }
</style>
