// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { DEFAULT_BEE_NODE_URL } from '@solarpunkltd/swarm-id'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultBeeNodeUrlFrom } from '$lib/default-bee-node'

describe('defaultBeeNodeUrlFrom', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is the built-in default when the build sets nothing', () => {
    expect(defaultBeeNodeUrlFrom({})).toBe(DEFAULT_BEE_NODE_URL)
  })

  it('is the built-in default when the build sets it empty', () => {
    expect(defaultBeeNodeUrlFrom({ PUBLIC_DEFAULT_BEE_NODE_URL: '' })).toBe(DEFAULT_BEE_NODE_URL)
    expect(defaultBeeNodeUrlFrom({ PUBLIC_DEFAULT_BEE_NODE_URL: '  ' })).toBe(DEFAULT_BEE_NODE_URL)
  })

  it('takes the node the build names', () => {
    expect(defaultBeeNodeUrlFrom({ PUBLIC_DEFAULT_BEE_NODE_URL: 'https://bee.example.com/' })).toBe(
      'https://bee.example.com/',
    )
  })

  it('writes a bare origin with the trailing slash the built-in default has', () => {
    expect(
      defaultBeeNodeUrlFrom({ PUBLIC_DEFAULT_BEE_NODE_URL: ' https://bee.example.com ' }),
    ).toBe('https://bee.example.com/')
  })

  it('takes a local http node', () => {
    expect(defaultBeeNodeUrlFrom({ PUBLIC_DEFAULT_BEE_NODE_URL: 'http://localhost:1633' })).toBe(
      'http://localhost:1633/',
    )
  })

  it.each(['not a url', 'ftp://bee.example.com/', 'javascript:alert(1)'])(
    'is the built-in default, said in the console, for %s',
    (value) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      expect(defaultBeeNodeUrlFrom({ PUBLIC_DEFAULT_BEE_NODE_URL: value })).toBe(
        DEFAULT_BEE_NODE_URL,
      )
      expect(warn).toHaveBeenCalledOnce()
    },
  )
})
