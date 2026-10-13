// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The connect request is read from the window's link. A site that is not
 * accepted never becomes a request: nothing is derived, signed or stored for it.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { connectStore } from './connect.svelte'

describe('connectStore.initFromHash', () => {
  afterEach(() => {
    connectStore.clear()
  })

  it('takes a request for a clean https origin', () => {
    expect(connectStore.initFromHash('#origin=https%3A%2F%2Fviewer.example.com')).toBe(true)
    expect(connectStore.request?.appOrigin).toBe('https://viewer.example.com')
    expect(connectStore.refusedSite).toBeUndefined()
  })

  it('refuses a site with a path, and names it', () => {
    expect(connectStore.initFromHash('#origin=https%3A%2F%2Fviewer.example.com%2Fchat')).toBe(false)
    expect(connectStore.request).toBeUndefined()
    expect(connectStore.refusedSite).toBe('https://viewer.example.com/chat')
  })

  it('does not keep an earlier request when the next link names a refused site', () => {
    connectStore.initFromHash('#origin=https%3A%2F%2Fviewer.example.com')

    expect(connectStore.initFromHash('#origin=https%3A%2F%2Fevil.example.com%2F')).toBe(false)
    expect(connectStore.request).toBeUndefined()
  })
})
