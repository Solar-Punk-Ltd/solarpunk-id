// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import type { SyncResult } from '@solarpunkltd/swarm-id/internal'

import { syncStore } from '$lib/dev/sync.svelte'

// How long to coalesce rapid account mutations before publishing once.
const SYNC_DEBOUNCE_MS = 2000

/** Whether a save reached Swarm. A save with nothing to write, an account with no drive, is not one. */
export type SaveAnswer = 'saved' | 'not-saved'

const syncTimers = new Map<string, ReturnType<typeof setTimeout>>()
const savesRunning = new Map<string, Promise<SaveAnswer>>()

/** Never rejects: a save is fire-and-forget for `triggerSync`, so a failure is logged, not thrown. */
function runSave(accountId: string): Promise<SaveAnswer> {
  const save = syncStore
    .syncAccount(accountId)
    .then((result: SyncResult | undefined): SaveAnswer => {
      if (result?.status === 'error') {
        console.error(`[sync] account ${accountId} failed:`, result.error)
      }
      return result?.status === 'success' || result?.status === 'success-unverified'
        ? 'saved'
        : 'not-saved'
    })
    .catch((err: unknown): SaveAnswer => {
      console.error(`[sync] account ${accountId} failed:`, err)
      return 'not-saved'
    })
    .finally(() => {
      if (savesRunning.get(accountId) === save) savesRunning.delete(accountId)
    })
  savesRunning.set(accountId, save)
  return save
}

/**
 * Trigger sync for an account with debouncing
 *
 * Multiple rapid changes are batched into a single sync
 */
export function triggerSync(accountId: string): void {
  const existingTimer = syncTimers.get(accountId)
  if (existingTimer) {
    clearTimeout(existingTimer)
  }

  const timer = setTimeout(() => {
    syncTimers.delete(accountId)
    void runSave(accountId)
  }, SYNC_DEBOUNCE_MS)

  syncTimers.set(accountId, timer)
}

/**
 * Save the account's pending change now, for a window about to close: a
 * closed page runs no timer, so a change still waiting out its debounce would
 * never reach Swarm. Waits for a save already running instead of starting a
 * second. Answers `not-saved` after `withinMs` and leaves the save running,
 * so the window can still close.
 */
export function saveNow(accountId: string, withinMs: number): Promise<SaveAnswer> {
  const pending = syncTimers.get(accountId)
  if (pending) {
    clearTimeout(pending)
    syncTimers.delete(accountId)
  }
  const save = pending ? runSave(accountId) : savesRunning.get(accountId)
  if (!save) return Promise.resolve('saved')
  return new Promise((resolve) => {
    const limit = setTimeout(() => resolve('not-saved'), withinMs)
    void save.then((answer) => {
      clearTimeout(limit)
      resolve(answer)
    })
  })
}
