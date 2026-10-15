// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { STORAGE_CHALLENGE_KEY } from '@solarpunkltd/swarm-id/internal'

import { siteAllowList } from '$lib/accepted-site'

/**
 * A dApp connection request, parsed from the URL hash the @solarpunkltd/swarm-id
 * client puts on the connect popup (e.g. #origin=…&appName=…&challenge=…).
 * Held in memory so it survives in-popup navigation through the account
 * creation flow; lost on reload by design (the user can retry from the dApp).
 */
export interface ConnectRequest {
  appOrigin: string
  appName: string
  appDescription?: string
  appIcon?: string
  /**
   * Set when the proxy iframe could not share localStorage with this popup
   * (storage partitioning). The app secret then goes back to the iframe via
   * a `setSecret` postMessage instead of a storage event.
   */
  partitionChallenge?: string
}

/**
 * Remembers (per popup tab) a challenge we already matched in localStorage.
 * The challenge key is consumed on first match, so without this marker a
 * reload or back-navigation re-running initFromHash would misread the missing
 * key as partitioned storage and hand the session over on a channel the dApp
 * is not listening on.
 */
const CHALLENGE_MATCHED_KEY = 'swarm-id-challenge-matched'

function deriveAppName(origin: string): string {
  try {
    return new URL(origin).hostname.split('.')[0] || origin
  } catch {
    return origin
  }
}

/** A site the allow list refused, and its reason, for the page to show. */
export interface SiteRefusalNotice {
  site: string
  message: string
}

let request = $state<ConnectRequest | undefined>(undefined)
// What the allow list said about the site the last link named, when it
// refused it, for the page to say so instead of offering accounts.
let refusal = $state<SiteRefusalNotice | undefined>(undefined)
let checkingSite = $state(false)
// Bumped by every link that names a site, so a check that answers after a
// newer link was read cannot overwrite what that link decided.
let linkGeneration = 0

export const connectStore = {
  get request() {
    return request
  },

  get refusal() {
    return refusal
  },

  get checkingSite() {
    return checkingSite
  },

  /**
   * Parse a connect request from the popup URL hash, once the allow list has
   * accepted the site it names. Keeps any previously parsed request when the
   * hash carries none (e.g. back-navigation to /connect). Resolves to whether
   * a request is active afterwards.
   */
  async initFromHash(hash: string): Promise<boolean> {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- ephemeral, parsed and discarded
    const params = new URLSearchParams(hash.slice(1))
    const appOrigin = params.get('origin')
    if (!appOrigin) {
      return request !== undefined
    }
    const generation = ++linkGeneration
    request = undefined
    refusal = undefined
    checkingSite = true
    const siteCheck = await siteAllowList().check(appOrigin)
    if (generation !== linkGeneration) {
      return false
    }
    checkingSite = false
    if (!siteCheck.allowed) {
      refusal = { site: appOrigin, message: siteCheck.message }
      return false
    }

    // Storage partitioning detection: the proxy iframe wrote this challenge
    // to localStorage right before opening the popup. If we can't read it
    // (and didn't already consume it earlier in this tab), our storage is
    // partitioned from the iframe's.
    let partitionChallenge: string | undefined = undefined
    const challenge = params.get('challenge')
    if (challenge) {
      if (localStorage.getItem(STORAGE_CHALLENGE_KEY) === challenge) {
        localStorage.removeItem(STORAGE_CHALLENGE_KEY)
        sessionStorage.setItem(CHALLENGE_MATCHED_KEY, challenge)
      } else if (sessionStorage.getItem(CHALLENGE_MATCHED_KEY) !== challenge) {
        partitionChallenge = challenge
      }
    }

    request = {
      appOrigin,
      appName: params.get('appName') ?? deriveAppName(appOrigin),
      appDescription: params.get('appDescription') ?? undefined,
      appIcon: params.get('appIcon') ?? undefined,
      partitionChallenge,
    }
    return true
  },

  clear() {
    linkGeneration++
    request = undefined
    refusal = undefined
    checkingSite = false
  },
}
