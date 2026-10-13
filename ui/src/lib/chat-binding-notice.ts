// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * What the connect window tells the person before the account signs a chat
 * binding for a site (docs/Chat-Binding.md): the site publishes it, so anyone
 * can see which account its chat address belongs to.
 */
export function chatBindingNotice(site: string): string {
  return `Connecting publicly links your Swarm ID account to your chat on ${site}.`
}
