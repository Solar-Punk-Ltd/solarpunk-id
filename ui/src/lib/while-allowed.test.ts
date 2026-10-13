// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The root layout starts the account sync, the bus and the fold timer for a
 * page that may run, and a framed proxy page can later navigate to one that
 * may not. The layout outlives that navigation, so what it started has to
 * stop when the refusal turns on, not only when the layout is destroyed.
 */
import { describe, expect, it, vi } from 'vitest'

import { whileAllowed } from './while-allowed'

function services() {
  const stop = vi.fn()
  const start = vi.fn(() => stop)
  return { start, stop, run: whileAllowed(start) }
}

describe('whileAllowed', () => {
  it('stops what it started when the page becomes refused', () => {
    const { start, stop, run } = services()

    run.follow(false)
    run.follow(true)

    expect(start).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('starts nothing on a refused page', () => {
    const { start, run } = services()

    run.follow(true)

    expect(start).not.toHaveBeenCalled()
  })

  it('starts once however often an allowed page is followed', () => {
    const { start, run } = services()

    run.follow(false)
    run.follow(false)

    expect(start).toHaveBeenCalledTimes(1)
  })

  it('stops once, whether the page became refused or the layout went away', () => {
    const { stop, run } = services()

    run.follow(false)
    run.follow(true)
    run.stop()

    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('stops when the layout goes away on an allowed page', () => {
    const { stop, run } = services()

    run.follow(false)
    run.stop()

    expect(stop).toHaveBeenCalledTimes(1)
  })
})
