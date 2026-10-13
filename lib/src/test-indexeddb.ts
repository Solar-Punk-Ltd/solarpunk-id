// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * The slice of IndexedDB the wrapping-key store uses, in memory, for tests
 * running under Node, which has none. Values go through `structuredClone`,
 * as the browser's store does, so a `CryptoKey` keeps its non-extractable
 * flag on the way back out.
 */

type Handler = ((event: unknown) => void) | null

interface FakeRequest<T> {
  result: T
  error: unknown
  onsuccess: Handler
  onerror: Handler
  onupgradeneeded: Handler
  onblocked: Handler
}

function request<T>(): FakeRequest<T> {
  return {
    result: undefined as T,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
    onblocked: null,
  }
}

function later(fn: () => void): void {
  setTimeout(fn, 0)
}

class FakeTransaction {
  oncomplete: Handler = null
  onerror: Handler = null
  onabort: Handler = null
  private pending = 0

  constructor(private readonly stores: Map<string, Map<unknown, unknown>>) {}

  objectStore(name: string) {
    const rows = this.stores.get(name)
    if (!rows) throw new Error(`No object store ${name}`)
    const run = <T>(work: () => T): FakeRequest<T> => {
      const req = request<T>()
      this.pending++
      later(() => {
        try {
          req.result = work()
          req.onsuccess?.({ target: req })
        } catch (error) {
          req.error = error
          req.onerror?.({ target: req })
          this.onerror?.({ target: req })
          return
        } finally {
          this.pending--
        }
        if (this.pending === 0) later(() => this.oncomplete?.({}))
      })
      return req
    }
    return {
      get: (key: unknown) =>
        run(() => (rows.has(key) ? structuredClone(rows.get(key)) : undefined)),
      add: (value: unknown, key: unknown) =>
        run(() => {
          if (rows.has(key)) throw new Error("ConstraintError")
          rows.set(key, structuredClone(value))
          return key
        }),
    }
  }
}

class FakeDatabase {
  readonly stores = new Map<string, Map<unknown, unknown>>()
  version = 0

  get objectStoreNames() {
    return { contains: (name: string) => this.stores.has(name) }
  }

  createObjectStore(name: string): void {
    this.stores.set(name, new Map())
  }

  transaction(_names: string | string[], _mode?: string): FakeTransaction {
    return new FakeTransaction(this.stores)
  }

  close(): void {}
}

/** A fresh, empty IndexedDB. Install it with `vi.stubGlobal("indexedDB", ...)`. */
export function createFakeIndexedDB() {
  const databases = new Map<string, FakeDatabase>()
  return {
    open(name: string, version = 1) {
      const req = request<FakeDatabase>()
      later(() => {
        let db = databases.get(name)
        if (!db) {
          db = new FakeDatabase()
          databases.set(name, db)
        }
        req.result = db
        if (db.version < version) {
          db.version = version
          req.onupgradeneeded?.({ target: req })
        }
        req.onsuccess?.({ target: req })
      })
      return req
    },
  }
}
