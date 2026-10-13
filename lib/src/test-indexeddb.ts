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

/**
 * Transactions run one after another, as the browser runs read-write
 * transactions over the same store, so a read and an add in one transaction
 * see no other transaction's add in between.
 */
class FakeTransaction {
  oncomplete: Handler = null
  onerror: Handler = null
  onabort: Handler = null
  error: unknown = null
  private pending = 0
  private finish!: () => void
  readonly done = new Promise<void>((resolve) => {
    this.finish = resolve
  })

  constructor(
    private readonly stores: Map<string, Map<unknown, unknown>>,
    private readonly turn: Promise<void>,
  ) {}

  private settle(): void {
    if (this.pending > 0) return
    later(() => {
      if (this.error) this.onerror?.({})
      else this.oncomplete?.({})
      this.finish()
    })
  }

  objectStore(name: string) {
    const rows = this.stores.get(name)
    if (!rows) throw new Error(`No object store ${name}`)
    const run = <T>(work: () => T): FakeRequest<T> => {
      const req = request<T>()
      this.pending++
      void this.turn.then(() =>
        later(() => {
          try {
            req.result = work()
            req.onsuccess?.({ target: req })
          } catch (error) {
            req.error = error
            this.error = error
            req.onerror?.({ target: req })
          } finally {
            this.pending--
            this.settle()
          }
        }),
      )
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
  private last: Promise<void> = Promise.resolve()

  get objectStoreNames() {
    return { contains: (name: string) => this.stores.has(name) }
  }

  createObjectStore(name: string): void {
    this.stores.set(name, new Map())
  }

  transaction(_names: string | string[], _mode?: string): FakeTransaction {
    const tx = new FakeTransaction(this.stores, this.last)
    this.last = tx.done
    return tx
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

function failedRequest<T>(message: string): FakeRequest<T> {
  const req = request<T>()
  later(() => {
    req.error = new Error(message)
    req.onerror?.({ target: req })
  })
  return req
}

/**
 * An IndexedDB that opens and then fails every read and write, as a transient
 * error does. Install it with `vi.stubGlobal("indexedDB", ...)`.
 */
export function createUnreadableIndexedDB() {
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => undefined,
    transaction: () => {
      const tx = {
        oncomplete: null as Handler,
        onerror: null as Handler,
        onabort: null as Handler,
        error: null as unknown,
        objectStore: () => {
          const fail = <T>() => {
            const req = failedRequest<T>("IndexedDB read failed")
            later(() =>
              later(() => {
                tx.error = req.error
                tx.onerror?.({})
              }),
            )
            return req
          }
          return { get: fail, add: fail }
        },
      }
      return tx
    },
    close: () => undefined,
  }
  return {
    open() {
      const req = request<typeof database>()
      later(() => {
        req.result = database
        req.onsuccess?.({ target: req })
      })
      return req
    },
  }
}

/**
 * An IndexedDB that cannot be opened, as when the browser blocks it. Install
 * it with `vi.stubGlobal("indexedDB", ...)`.
 */
export function createUnopenableIndexedDB() {
  return {
    open: () => failedRequest<never>("IndexedDB could not be opened"),
  }
}
