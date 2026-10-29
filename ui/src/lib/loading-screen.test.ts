// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LOADING_SCREEN_ID, removeLoadingScreenOnceSettled } from '$lib/loading-screen'

function pageWithLoader() {
  const remove = vi.fn()
  vi.stubGlobal('document', {
    getElementById: (id: string) => (id === LOADING_SCREEN_ID ? { remove } : null),
  })
  return remove
}

async function unhandledWhile(run: () => Promise<void>): Promise<unknown[]> {
  const unhandled: unknown[] = []
  const listener = (reason: unknown) => unhandled.push(reason)
  process.on('unhandledRejection', listener)
  try {
    await run()
    await new Promise((resolve) => setTimeout(resolve, 0))
  } finally {
    process.off('unhandledRejection', listener)
  }
  return unhandled
}

describe('the loader', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('goes once the accounts are read', async () => {
    const remove = pageWithLoader()
    removeLoadingScreenOnceSettled(Promise.resolve())
    await Promise.resolve()
    await Promise.resolve()
    expect(remove).toHaveBeenCalledOnce()
  })

  it('goes when the accounts cannot be read, and leaves no unhandled rejection behind', async () => {
    const remove = pageWithLoader()
    const unhandled = await unhandledWhile(async () => {
      removeLoadingScreenOnceSettled(Promise.reject(new Error('storage would not open')))
    })
    expect(remove).toHaveBeenCalledOnce()
    expect(unhandled).toEqual([])
  })
})
