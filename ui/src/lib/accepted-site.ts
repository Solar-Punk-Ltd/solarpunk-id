// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The one gate on which sites the connect window serves.
 *
 * The site arrives in the window's own link (`#origin=`), written by whoever
 * opened it, and becomes the app secret's derivation label and the site a chat
 * binding names. So it is refused unless it is a clean https origin in its
 * normalized form. A development build also serves local http, which is what
 * the local rig runs on. An allow list of sites belongs here too, so every
 * caller keeps asking this one function.
 */
import { isCleanSiteOrigin } from '@snaha/swarm-id'

export function isAcceptedSite(origin: string): boolean {
  return isCleanSiteOrigin(origin, { allowLocalHttp: import.meta.env.DEV })
}
