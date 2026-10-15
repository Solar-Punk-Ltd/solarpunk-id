// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Whether a Swarm ID frame shares the first-party store means whether it can
 * open what a first-party page sealed there: the keys in that store are
 * sealed, and a frame that sees the store but not the key that opens it sees
 * no session at all. Playwright's WebKit is such a browser for a cross-site
 * frame (measured 2026-10-15): one `localStorage`, two IndexedDBs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createFakeIndexedDB } from "../test-indexeddb"

type Probe = typeof import("./storage-probe")

/** A fresh page on `indexedDB`, as each window and frame is */
async function pageOn(
  indexedDB: ReturnType<typeof createFakeIndexedDB>,
  framed: boolean,
): Promise<Probe> {
  vi.resetModules()
  const self = {}
  vi.stubGlobal("window", { self, top: framed ? {} : self })
  vi.stubGlobal("indexedDB", indexedDB)
  // eslint-disable-next-line no-restricted-syntax -- a fresh module per page is the point
  return import("./storage-probe")
}

describe("storage probe", () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = new Map()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("is shared where the frame opens what the first-party page sealed", async () => {
    const shared = createFakeIndexedDB()
    await (await pageOn(shared, false)).markFirstPartyStorage()

    expect(await (await pageOn(shared, true)).isStorageShared()).toBe(true)
  })

  it("is not shared where the frame sees the store but not the key that opens it", async () => {
    await (await pageOn(createFakeIndexedDB(), false)).markFirstPartyStorage()

    expect(
      await (await pageOn(createFakeIndexedDB(), true)).isStorageShared(),
    ).toBe(false)
  })

  it("is not shared without a marker, or with one that is not sealed", async () => {
    const frame = await pageOn(createFakeIndexedDB(), true)
    expect(await frame.isStorageShared()).toBe(false)

    store.set(frame.STORAGE_SHARED_KEY, "1")
    expect(await frame.isStorageShared()).toBe(false)
  })

  it("leaves no marker from inside a frame", async () => {
    const frame = await pageOn(createFakeIndexedDB(), true)
    await frame.markFirstPartyStorage()

    expect(store.size).toBe(0)
  })
})
