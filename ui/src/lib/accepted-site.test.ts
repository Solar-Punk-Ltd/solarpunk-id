// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The settings the identity UI reads the site allow list with. The list itself
 * is tested in the lib (`utils/site-allow-list.test.ts`): what matters here is
 * that a production build never takes a development origin.
 */
import { describe, expect, it } from 'vitest'

import { siteAllowListSettings } from '$lib/accepted-site'

const DEMO_ORIGINS = ['http://localhost:3500', 'http://127.0.0.1:3500', 'http://[::1]:3500']

describe('siteAllowListSettings', () => {
  it('reads solarpunkid.eth with no endpoint when nothing is set', () => {
    const settings = siteAllowListSettings({}, false)

    expect(settings).toMatchObject({
      rpcUrl: undefined,
      ensName: 'solarpunkid.eth',
      recordKey: 'buzz.solarpunk.sites',
      devOrigins: [],
    })
  })

  it('takes the endpoint, the name and the record key from the build', () => {
    const settings = siteAllowListSettings(
      {
        PUBLIC_ETHEREUM_RPC_URL: 'https://rpc.example',
        PUBLIC_SITE_ALLOW_LIST_ENS_NAME: 'sites.example.eth',
        PUBLIC_SITE_ALLOW_LIST_RECORD_KEY: 'example.sites',
      },
      false,
    )

    expect(settings).toMatchObject({
      rpcUrl: 'https://rpc.example',
      ensName: 'sites.example.eth',
      recordKey: 'example.sites',
    })
  })

  it('serves the demo in a development build when no dev origin is set', () => {
    expect(siteAllowListSettings({}, true).devOrigins).toEqual(DEMO_ORIGINS)
  })

  it('takes the dev origins a development build names, and only those', () => {
    const settings = siteAllowListSettings(
      { PUBLIC_SITE_ALLOW_LIST_DEV_ORIGINS: 'http://localhost:4000, http://localhost:4001' },
      true,
    )

    expect(settings.devOrigins).toEqual(['http://localhost:4000', 'http://localhost:4001'])
  })

  it('never takes a dev origin in a production build', () => {
    const settings = siteAllowListSettings(
      { PUBLIC_SITE_ALLOW_LIST_DEV_ORIGINS: 'http://localhost:4000' },
      false,
    )

    expect(settings.devOrigins).toEqual([])
  })
})
