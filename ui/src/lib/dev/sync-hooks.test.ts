// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * A window that closes right after an account change, as the connect window
 * does after "Go to app", takes its pending save with it: the save waits out
 * its debounce, and a closed page runs no timer. `saveNow` is what such a
 * window awaits before it closes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { saveNow, triggerSync } from './sync-hooks'

const syncAccount = vi.fn()
vi.mock('$lib/dev/sync.svelte', () => ({
  syncStore: { syncAccount: (...args: unknown[]) => syncAccount(...args) },
}))

const ACCOUNT = 'a'.repeat(40)
const WITHIN_MS = 20_000

const SAVED = { status: 'success', reference: 'ab'.repeat(32), timestamp: 1n, chunkAddresses: [] }

function deferred() {
  let resolve!: () => void
  const promise = new Promise<typeof SAVED>((done) => (resolve = () => done(SAVED)))
  return { promise, resolve }
}

describe('saveNow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    syncAccount.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs a pending save at once and answers when it has landed', async () => {
    const save = deferred()
    syncAccount.mockReturnValue(save.promise)
    triggerSync(ACCOUNT)

    const answer = saveNow(ACCOUNT, WITHIN_MS)
    expect(syncAccount).toHaveBeenCalledTimes(1)
    save.resolve()
    expect(await answer).toBe('saved')

    // The debounce it replaced does not save a second time.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(syncAccount).toHaveBeenCalledTimes(1)
  })

  it('waits for a save already running rather than starting another', async () => {
    const save = deferred()
    syncAccount.mockReturnValue(save.promise)
    triggerSync(ACCOUNT)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(syncAccount).toHaveBeenCalledTimes(1)

    const answer = saveNow(ACCOUNT, WITHIN_MS)
    save.resolve()
    expect(await answer).toBe('saved')
    expect(syncAccount).toHaveBeenCalledTimes(1)
  })

  it('answers at once when nothing is waiting to be saved', async () => {
    expect(await saveNow(ACCOUNT, WITHIN_MS)).toBe('saved')
    expect(syncAccount).not.toHaveBeenCalled()
  })

  it('gives up after the time limit, so the window can still close', async () => {
    syncAccount.mockReturnValue(new Promise(() => {}))
    triggerSync(ACCOUNT)

    const answer = saveNow(ACCOUNT, WITHIN_MS)
    await vi.advanceTimersByTimeAsync(WITHIN_MS)
    expect(await answer).toBe('not-saved')
  })

  it('says not saved when the save failed', async () => {
    syncAccount.mockResolvedValue({ status: 'error', error: 'lease refused' })
    triggerSync(ACCOUNT)
    expect(await saveNow(ACCOUNT, WITHIN_MS)).toBe('not-saved')
  })

  it('says not saved when the save threw', async () => {
    syncAccount.mockRejectedValue(new Error('gateway down'))
    triggerSync(ACCOUNT)
    expect(await saveNow(ACCOUNT, WITHIN_MS)).toBe('not-saved')
  })
})
