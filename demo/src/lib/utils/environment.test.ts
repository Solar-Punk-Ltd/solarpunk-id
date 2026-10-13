// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveProxyOrigin } from './environment'

vi.mock('$env/static/public', () => ({ PUBLIC_ID_DOMAIN: '' }))

function visit(href: string) {
  const url = new URL(href)
  vi.stubGlobal('window', { location: { search: url.search, hostname: url.hostname } })
}

describe('resolveProxyOrigin without PUBLIC_ID_DOMAIN', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the local identity site on localhost', () => {
    visit('http://localhost:3500/')
    expect(resolveProxyOrigin()).toBe('http://localhost:5500')
  })

  it('uses the Solar Punk identity site anywhere else', () => {
    visit('https://demo.example.com/')
    expect(resolveProxyOrigin()).toBe('https://solarpunkid.bzz.link')
  })

  it('takes an idDomain query parameter over both', () => {
    visit('https://demo.example.com/?idDomain=https://id.example.com')
    expect(resolveProxyOrigin()).toBe('https://id.example.com')
  })
})
