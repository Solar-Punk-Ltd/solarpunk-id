// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { DEFAULT_BEE_NODE_URL } from '@solarpunkltd/swarm-id'
import { isHttpUrl } from '@solarpunkltd/swarm-id/internal'

import { env } from '$env/dynamic/public'

type PublicEnv = Record<string, string | undefined>

/**
 * The Bee node a build uses while the person has set none, from
 * `PUBLIC_DEFAULT_BEE_NODE_URL`, or `DEFAULT_BEE_NODE_URL` when the build sets
 * none. Accepted as the network settings dialog accepts a node, and written in
 * `URL.href` form, so a bare origin gets the trailing slash the built-in
 * default has: the proxy tells the default from a custom node by comparing the
 * strings.
 */
export function defaultBeeNodeUrlFrom(publicEnv: PublicEnv): string {
  const configured = publicEnv.PUBLIC_DEFAULT_BEE_NODE_URL?.trim()
  if (!configured) {
    return DEFAULT_BEE_NODE_URL
  }
  if (!isHttpUrl(configured)) {
    console.warn(
      `[network] PUBLIC_DEFAULT_BEE_NODE_URL is not an http or https URL, so the default Bee node is ${DEFAULT_BEE_NODE_URL}`,
    )
    return DEFAULT_BEE_NODE_URL
  }
  return new URL(configured).href
}

/**
 * This build's default Bee node. One reader for the network settings, their
 * dialog and the proxy frame, so they agree on which node is the default.
 */
export function defaultBeeNodeUrl(): string {
  return defaultBeeNodeUrlFrom(env)
}
