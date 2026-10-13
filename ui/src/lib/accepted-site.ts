// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The one gate on which sites this identity manager serves
 * (docs/Site-Allow-List.md). The connect window asks it about the site its own
 * link names, and the proxy frame about the page that embeds it, so both
 * answer from one list read with one set of settings.
 */
import {
  DEFAULT_SITE_ALLOW_LIST_ENS_NAME,
  DEFAULT_SITE_ALLOW_LIST_RECORD_KEY,
  type SiteAllowList,
  type SiteAllowListSettings,
  createSiteAllowList,
} from '@snaha/swarm-id/internal'

import { env } from '$env/dynamic/public'

/**
 * The demo app under every loopback name the local rig and its browser suite
 * browse it by. A development build serves these when it names no dev
 * origins of its own.
 */
const DEMO_DEV_ORIGINS = ['http://localhost:3500', 'http://127.0.0.1:3500', 'http://[::1]:3500']

const ORIGIN_SEPARATOR = /[\s,]+/

type PublicEnv = Record<string, string | undefined>

function devOrigins(publicEnv: PublicEnv, isDev: boolean): string[] {
  if (!isDev) {
    return []
  }
  const named = (publicEnv.PUBLIC_SITE_ALLOW_LIST_DEV_ORIGINS ?? '')
    .split(ORIGIN_SEPARATOR)
    .filter((origin) => origin !== '')
  return named.length > 0 ? named : DEMO_DEV_ORIGINS
}

/** The allow list's settings for a build, from its public env. */
export function siteAllowListSettings(publicEnv: PublicEnv, isDev: boolean): SiteAllowListSettings {
  return {
    rpcUrl: publicEnv.PUBLIC_ETHEREUM_RPC_URL || undefined,
    ensName: publicEnv.PUBLIC_SITE_ALLOW_LIST_ENS_NAME || DEFAULT_SITE_ALLOW_LIST_ENS_NAME,
    recordKey: publicEnv.PUBLIC_SITE_ALLOW_LIST_RECORD_KEY || DEFAULT_SITE_ALLOW_LIST_RECORD_KEY,
    devOrigins: devOrigins(publicEnv, isDev),
    storage: browserStorage(),
  }
}

/** Reading `localStorage` throws where the browser blocks storage, and is absent off a page. */
function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

let shared: SiteAllowList | undefined

/** This page's allow list, created on first use. */
export function siteAllowList(): SiteAllowList {
  shared ??= createSiteAllowList(siteAllowListSettings(env, import.meta.env.DEV))
  return shared
}
