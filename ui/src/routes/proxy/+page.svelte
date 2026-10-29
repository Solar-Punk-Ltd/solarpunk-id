<!--
  Copyright 2026 The Swarm Authors. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
-->

<!--
  Iframe proxy endpoint. dApps embed this page in a hidden iframe via the
  @solarpunkltd/swarm-id client, which handles the postMessage protocol. It
  shows nothing: the button a person clicks is the /button page.
-->
<script lang="ts">
  import { onMount } from 'svelte'

  import { initProxy } from '@solarpunkltd/swarm-id/internal'

  import { siteAllowList } from '$lib/accepted-site'
  import { busSignalingUrl } from '$lib/bus-signaling-url'
  import { defaultBeeNodeUrl } from '$lib/default-bee-node'

  // Account-bus signaling server (docs/Account-Bus.md). Shared with the SwarmID
  // tab's publisher, so a build cannot end up with a bus on one and not the other.
  const signalingUrl = busSignalingUrl()

  onMount(() => {
    initProxy({
      signalingUrl,
      siteAllowList: siteAllowList(),
      defaultBeeNodeUrl: defaultBeeNodeUrl(),
    })
  })
</script>
