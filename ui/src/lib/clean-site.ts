// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The clean-origin check on a site before it is used as a key (review P3-1).
 *
 * A site from the connect window's link becomes the app secret's derivation
 * label and the key its connection is stored under. `isAcceptedSite` decides
 * which sites the window serves. This is the narrower question every use of a
 * site asks on its own, so a caller that skipped the window's gate still
 * cannot derive or store under a site that is not a clean https origin in its
 * normalized form. A development build also takes local http, as the window
 * does.
 */
import { isCleanSiteOrigin } from '@snaha/swarm-id'

export function isCleanSite(site: string): boolean {
  return isCleanSiteOrigin(site, { allowLocalHttp: import.meta.env.DEV })
}

export function requireCleanSite(site: string): void {
  if (!isCleanSite(site)) {
    throw new Error(`Site ${JSON.stringify(site)} is not accepted: not a clean origin`)
  }
}
