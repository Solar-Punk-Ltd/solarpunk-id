// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Key material at rest is sealed with a non-extractable AES-GCM key kept in
 * IndexedDB beside it. A value that cannot be opened is absent,
 * never read some other way.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  createBlockedIndexedDB,
  createFakeIndexedDB,
  createHangingIndexedDB,
  createUnopenableIndexedDB,
} from "../test-indexeddb"

type SealedValues = typeof import("./sealed-values")

const SECRET = "ab".repeat(32)

/** A fresh module, as a page load gets: nothing opened in memory yet. */
async function freshModule(): Promise<SealedValues> {
  vi.resetModules()
  // eslint-disable-next-line no-restricted-syntax -- a fresh module per page load is the point
  return import("./sealed-values")
}

describe("sealed values", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", createFakeIndexedDB())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("seals a value so its plain text is not in the sealed form", async () => {
    const { sealValue, isSealedValue } = await freshModule()

    const sealed = await sealValue(SECRET)

    expect(isSealedValue(sealed)).toBe(true)
    expect(sealed).not.toContain(SECRET)
  })

  it("opens what it sealed, in the same page", async () => {
    const { sealValue, openedValue } = await freshModule()

    const sealed = await sealValue(SECRET)

    expect(openedValue(sealed)).toBe(SECRET)
  })

  it("seals one value to one sealed form for the page, so rewrites are stable", async () => {
    const { sealValue } = await freshModule()

    expect(await sealValue(SECRET)).toBe(await sealValue(SECRET))
  })

  it("opens a value sealed by an earlier page once it is primed", async () => {
    const sealed = await (await freshModule()).sealValue(SECRET)
    const { primeSealedValues, openedValue } = await freshModule()

    expect(openedValue(sealed)).toBeUndefined()
    await primeSealedValues([sealed])

    expect(openedValue(sealed)).toBe(SECRET)
  })

  it("cannot open a value once the wrapping key is gone", async () => {
    const sealed = await (await freshModule()).sealValue(SECRET)
    vi.stubGlobal("indexedDB", createFakeIndexedDB())
    const { primeSealedValues, openedValue } = await freshModule()

    await primeSealedValues([sealed])

    expect(openedValue(sealed)).toBeUndefined()
  })

  it("cannot open a value that was tampered with", async () => {
    const sealed = await (await freshModule()).sealValue(SECRET)
    const flipped = sealed.slice(0, -1) + (sealed.endsWith("0") ? "1" : "0")
    const { primeSealedValues, openedValue } = await freshModule()

    await primeSealedValues([flipped])

    expect(openedValue(flipped)).toBeUndefined()
  })

  it("does not take a plain value for a sealed one", async () => {
    const { isSealedValue, openedValue } = await freshModule()

    expect(isSealedValue(SECRET)).toBe(false)
    expect(openedValue(SECRET)).toBeUndefined()
  })

  it("seals and opens for the page when indexedDB is null", async () => {
    vi.stubGlobal("indexedDB", null)
    const { sealValue, openedValue } = await freshModule()

    const sealed = await sealValue(SECRET)

    expect(openedValue(sealed)).toBe(SECRET)
  })

  it("counts an earlier page's value as unavailable, not lost, when indexedDB is null", async () => {
    const sealed = await (await freshModule()).sealValue(SECRET)
    vi.stubGlobal("indexedDB", null)
    const { primeSealedValues, openedValue, isSealedValueUnavailable } =
      await freshModule()

    await primeSealedValues([sealed])

    expect(openedValue(sealed)).toBeUndefined()
    expect(isSealedValueUnavailable(sealed)).toBe(true)
  })

  it("seals and opens for the page when IndexedDB cannot be opened", async () => {
    vi.stubGlobal("indexedDB", createUnopenableIndexedDB())
    const { sealValue, openedValue } = await freshModule()

    const sealed = await sealValue(SECRET)

    expect(openedValue(sealed)).toBe(SECRET)
  })

  it("counts an earlier page's value as unavailable, not lost, when IndexedDB cannot be opened", async () => {
    const sealed = await (await freshModule()).sealValue(SECRET)
    vi.stubGlobal("indexedDB", createUnopenableIndexedDB())
    const {
      sealValue,
      primeSealedValues,
      openedValue,
      isSealedValueUnavailable,
    } = await freshModule()
    await sealValue("written in this page")

    await primeSealedValues([sealed])

    expect(openedValue(sealed)).toBeUndefined()
    expect(isSealedValueUnavailable(sealed)).toBe(true)
  })

  it("treats a blocked IndexedDB open as one that failed, so sealing goes on for the page", async () => {
    const sealed = await (await freshModule()).sealValue(SECRET)
    vi.stubGlobal("indexedDB", createBlockedIndexedDB())
    const {
      sealValue,
      openedValue,
      primeSealedValues,
      isSealedValueUnavailable,
    } = await freshModule()

    const forThisPage = await sealValue("written in this page")
    await primeSealedValues([sealed])

    expect(openedValue(forThisPage)).toBe("written in this page")
    expect(isSealedValueUnavailable(sealed)).toBe(true)
  })

  it("gives up on an IndexedDB open that never settles, and seals for the page", async () => {
    vi.stubGlobal("indexedDB", createHangingIndexedDB())
    const { sealValue, openedValue } = await freshModule()
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })

    const sealing = sealValue(SECRET)
    await vi.runAllTimersAsync()

    expect(openedValue(await sealing)).toBe(SECRET)
  })

  it("keeps a non-extractable wrapping key, made once for every caller", async () => {
    const idb = createFakeIndexedDB()
    vi.stubGlobal("indexedDB", idb)
    // Two windows of the site, each with its own copy of the module.
    const first = await freshModule()
    const second = await freshModule()

    // Two first uses at once must agree on one key, or one of them seals
    // with a key the store does not keep.
    const [a, b] = await Promise.all([
      first.sealValue("one"),
      second.sealValue("two"),
    ])
    const { primeSealedValues, openedValue } = await freshModule()
    await primeSealedValues([a, b])

    expect(openedValue(a)).toBe("one")
    expect(openedValue(b)).toBe("two")
    const db = await new Promise<{
      transaction(s: string): {
        objectStore(s: string): {
          get(k: string): { onsuccess: (() => void) | null; result: CryptoKey }
        }
      }
    }>((resolve) => {
      const req = idb.open("swarm-id-keys", 1)
      req.onsuccess = () => resolve(req.result as never)
    })
    const key = await new Promise<CryptoKey>((resolve) => {
      const get = db
        .transaction("wrapping-keys")
        .objectStore("wrapping-keys")
        .get("at-rest-v1")
      get.onsuccess = () => resolve(get.result)
    })
    expect(key.extractable).toBe(false)
    expect(key.algorithm.name).toBe("AES-GCM")
  })
})
