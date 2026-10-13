// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The root layout starts the account sync, the bus and the fold timer for a
 * page that may run, and a framed proxy page can later navigate to one that
 * may not. The layout outlives that navigation, so what it started has to
 * stop when the refusal turns on, not only when the layout is destroyed.
 */
import { flushSync } from 'svelte'

import { describe, expect, it, vi } from 'vitest'

import { runWhileAllowed } from './run-while-allowed.svelte'

function started() {
  const stop = vi.fn()
  const start = vi.fn(() => stop)
  return { start, stop }
}

describe('runWhileAllowed', () => {
  it('stops what it started when the page becomes refused', () => {
    let refused = $state(false)
    const { start, stop } = started()
    const destroy = $effect.root(() => {
      runWhileAllowed(() => refused, start)
    })
    flushSync()
    expect(start).toHaveBeenCalledTimes(1)

    refused = true
    flushSync()

    expect(stop).toHaveBeenCalledTimes(1)
    destroy()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('starts nothing on a refused page', () => {
    const { start } = started()
    const destroy = $effect.root(() => {
      runWhileAllowed(() => true, start)
    })
    flushSync()

    expect(start).not.toHaveBeenCalled()
    destroy()
  })

  it('stops when the layout is destroyed', () => {
    const { start, stop } = started()
    const destroy = $effect.root(() => {
      runWhileAllowed(() => false, start)
    })
    flushSync()

    destroy()

    expect(stop).toHaveBeenCalledTimes(1)
  })
})
