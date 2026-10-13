// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Which sites the connect window serves. The site comes from the window's own
 * link, so it is whatever the opener wrote there: only a clean origin may
 * become a key label and the site a chat binding names.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { isAcceptedSite } from '$lib/accepted-site'

describe('isAcceptedSite', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('accepts a clean https origin', () => {
    expect(isAcceptedSite('https://viewer.example.com')).toBe(true)
  })

  it.each([
    'https://viewer.example.com/',
    'https://viewer.example.com/path',
    'https://viewer.example.com?q',
    'https://viewer.example.com#x',
    'https://user@viewer.example.com',
    'https://Viewer.example.com',
    'http://viewer.example.com',
    'javascript:alert(1)',
  ])('refuses %s', (origin) => {
    expect(isAcceptedSite(origin)).toBe(false)
  })

  it('accepts local http in a development build', () => {
    vi.stubEnv('DEV', true)
    expect(isAcceptedSite('http://localhost:3500')).toBe(true)
  })

  it('refuses local http in a production build', () => {
    vi.stubEnv('DEV', false)
    expect(isAcceptedSite('http://localhost:3500')).toBe(false)
  })
})
