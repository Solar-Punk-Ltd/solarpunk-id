// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The connect request is read from the window's link. A site the allow list
 * does not accept never becomes a request: nothing is derived, signed or
 * stored for it, and the window says why.
 */
import type { SiteCheck } from '@solarpunkltd/swarm-id/internal'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { connectStore } from './connect.svelte'

const LISTED_SITE = 'https://viewer.example.com'

const check = vi.hoisted(() =>
  vi.fn(
    async (origin: string): Promise<SiteCheck> =>
      origin === 'https://viewer.example.com'
        ? { allowed: true }
        : { allowed: false, reason: 'not-listed', message: `${origin} is not listed.` },
  ),
)

vi.mock('$lib/accepted-site', () => ({ siteAllowList: () => ({ check }) }))

const link = (origin: string) => `#origin=${encodeURIComponent(origin)}`

describe('connectStore.initFromHash', () => {
  afterEach(() => {
    connectStore.clear()
    check.mockClear()
  })

  it('takes a request for a site on the allow list', async () => {
    await expect(connectStore.initFromHash(link(LISTED_SITE))).resolves.toBe(true)
    expect(check).toHaveBeenCalledWith(LISTED_SITE)
    expect(connectStore.request?.appOrigin).toBe(LISTED_SITE)
    expect(connectStore.refusal).toBeUndefined()
  })

  it.each([
    ['another port', 'https://viewer.example.com:8443'],
    ['a subdomain', 'https://a.viewer.example.com'],
    ['a path', 'https://viewer.example.com/chat'],
  ])('refuses %s, and says which site and why', async (_case, origin) => {
    await expect(connectStore.initFromHash(link(origin))).resolves.toBe(false)
    expect(connectStore.request).toBeUndefined()
    expect(connectStore.refusal).toEqual({ site: origin, message: `${origin} is not listed.` })
  })

  it('does not keep an earlier request when the next link names a refused site', async () => {
    await connectStore.initFromHash(link(LISTED_SITE))

    await expect(connectStore.initFromHash(link('https://evil.example.com'))).resolves.toBe(false)
    expect(connectStore.request).toBeUndefined()
  })

  it('lets the newest link win when an earlier check answers late', async () => {
    let answerFirst: (check: SiteCheck) => void = () => undefined
    check.mockImplementationOnce(
      () =>
        new Promise<SiteCheck>((resolve) => {
          answerFirst = resolve
        }),
    )

    const first = connectStore.initFromHash(link(LISTED_SITE))
    await connectStore.initFromHash(link('https://evil.example.com'))
    answerFirst({ allowed: true })

    await expect(first).resolves.toBe(false)
    expect(connectStore.request).toBeUndefined()
    expect(connectStore.refusal?.site).toBe('https://evil.example.com')
  })

  it('says it is checking while the allow list is read', async () => {
    const pending = connectStore.initFromHash(link(LISTED_SITE))
    expect(connectStore.checkingSite).toBe(true)

    await pending
    expect(connectStore.checkingSite).toBe(false)
  })
})
