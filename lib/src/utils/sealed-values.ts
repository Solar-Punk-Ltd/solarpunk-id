// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Key material at rest, sealed so it is not plain text on disk.
 *
 * A value is encrypted with AES-GCM under a wrapping key that WebCrypto
 * created non-extractable and that lives in IndexedDB in the same storage as
 * the value: the same origin, and in a partitioned frame the same partition.
 * Script on this origin can still use the key, so this is not a wall against
 * that. What it stops is the plain key being read off disk, out of a storage
 * dump or a backup of the profile, where the wrapping key cannot be taken
 * along as bytes.
 *
 * Opening is asynchronous, reading storage is not, so a page opens what it
 * will read first (`primeSealedValues`) and then reads it from memory
 * (`openedValue`) for the rest of the page's life. A value that cannot be
 * opened, because the wrapping key is gone or the value was altered, stays
 * unopened: callers treat the key it held as absent, never as plain text.
 * A value whose wrapping key could not be read at all, because IndexedDB
 * failed, is unavailable rather than lost (`isSealedValueUnavailable`).
 */

import { hexToUint8Array, uint8ArrayToHex } from "./hex"

/** Marks a stored string as sealed, and names the format. */
export const SEALED_VALUE_PREFIX = "sealed:v1:"

const KEY_DB_NAME = "swarm-id-keys"
const KEY_DB_VERSION = 1
const KEY_STORE = "wrapping-keys"
const WRAPPING_KEY_ID = "at-rest-v1"
const IV_BYTES = 12
/**
 * How long an IndexedDB open may take before it counts as failed. A hung open
 * would otherwise hold the storage write lock until the window closes.
 */
const KEY_DB_OPEN_TIMEOUT_MS = 10_000

/** Where the wrapping key is kept. */
interface WrappingKeyStore {
  /** The stored key, or this one stored when there is none yet. */
  getOrAdd(candidate: CryptoKey): Promise<CryptoKey>
  get(): Promise<CryptoKey | undefined>
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Opens the key database, or rejects when the open fails, is blocked, or takes
 * longer than `KEY_DB_OPEN_TIMEOUT_MS`. An open that succeeds after giving up
 * is closed at once.
 */
function openKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }
    const timer = setTimeout(
      () => fail(new Error("IndexedDB open timed out")),
      KEY_DB_OPEN_TIMEOUT_MS,
    )
    const request = indexedDB.open(KEY_DB_NAME, KEY_DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(KEY_STORE)) {
        request.result.createObjectStore(KEY_STORE)
      }
    }
    request.onsuccess = () => {
      if (settled) {
        request.result.close()
        return
      }
      settled = true
      clearTimeout(timer)
      resolve(request.result)
    }
    request.onerror = () => fail(request.error)
    request.onblocked = () => fail(new Error("IndexedDB open was blocked"))
  })
}

function indexedDbWrappingKeyStore(): WrappingKeyStore {
  return {
    async get() {
      const db = await openKeyDatabase()
      try {
        const store = db
          .transaction(KEY_STORE, "readonly")
          .objectStore(KEY_STORE)
        return (await idbRequest(store.get(WRAPPING_KEY_ID))) as
          | CryptoKey
          | undefined
      } finally {
        db.close()
      }
    },
    // One read-write transaction for the read and the add, so two windows
    // making their first key at once keep one of them, not one each.
    async getOrAdd(candidate) {
      const db = await openKeyDatabase()
      try {
        return await new Promise<CryptoKey>((resolve, reject) => {
          const tx = db.transaction(KEY_STORE, "readwrite")
          const store = tx.objectStore(KEY_STORE)
          let kept: CryptoKey = candidate
          const read = store.get(WRAPPING_KEY_ID)
          read.onsuccess = () => {
            if (read.result) {
              kept = read.result as CryptoKey
            } else {
              store.add(candidate, WRAPPING_KEY_ID)
            }
          }
          tx.oncomplete = () => resolve(kept)
          tx.onerror = () => reject(tx.error)
          tx.onabort = () => reject(tx.error)
        })
      } finally {
        db.close()
      }
    },
  }
}

/**
 * Without IndexedDB, or with one that cannot be opened, there is nowhere to
 * keep a key beside the data, so the key lasts as long as the page. What it
 * sealed cannot be opened by the next load, which then reads as signed out:
 * never plain text instead.
 */
function memoryWrappingKeyStore(): WrappingKeyStore {
  let key: CryptoKey | undefined
  return {
    async get() {
      return key
    },
    async getOrAdd(candidate) {
      key ??= candidate
      return key
    },
  }
}

interface ChosenKeyStore {
  store: WrappingKeyStore
  /**
   * The page keeps its key in memory because IndexedDB is there but could not
   * be opened. The stored values may still open on a later load, so one that
   * does not open with this key is unavailable, not lost.
   */
  standsIn: boolean
}

let keyStore: Promise<ChosenKeyStore> | undefined
let wrappingKey: Promise<CryptoKey> | undefined

async function chooseKeyStore(): Promise<ChosenKeyStore> {
  // Some browsers set indexedDB to null where it is turned off.
  if (typeof indexedDB === "undefined" || !indexedDB) {
    return { store: memoryWrappingKeyStore(), standsIn: false }
  }
  try {
    const db = await openKeyDatabase()
    db.close()
    return { store: indexedDbWrappingKeyStore(), standsIn: false }
  } catch {
    return { store: memoryWrappingKeyStore(), standsIn: true }
  }
}

/** Chosen once per page. */
function currentKeyStore(): Promise<ChosenKeyStore> {
  keyStore ??= chooseKeyStore()
  return keyStore
}

/**
 * Whether this page seals with a key of its own because IndexedDB is there but
 * could not be opened. What it seals now no later load can open.
 */
export async function sealsWithPageKey(): Promise<boolean> {
  return (await currentKeyStore()).standsIn
}

/** The wrapping key, created on first use. */
function getWrappingKey(): Promise<CryptoKey> {
  wrappingKey ??= (async () => {
    const { store } = await currentKeyStore()
    const existing = await store.get()
    if (existing) return existing
    const candidate = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    )
    return store.getOrAdd(candidate)
  })()
  // A failed attempt is not remembered, so a later use tries again.
  wrappingKey.catch(() => {
    wrappingKey = undefined
  })
  return wrappingKey
}

const openedBySealed = new Map<string, string>()
const sealedByPlain = new Map<string, string>()
const pendingOpens = new Map<string, Promise<void>>()

export function isSealedValue(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(SEALED_VALUE_PREFIX)
}

/**
 * Seal a value for storage. One value seals to one sealed form for the life of
 * the page, so rewriting an unchanged record writes the same bytes.
 */
export async function sealValue(plaintext: string): Promise<string> {
  const known = sealedByPlain.get(plaintext)
  if (known) return known
  const key = await getWrappingKey()
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  )
  const sealed = `${SEALED_VALUE_PREFIX}${uint8ArrayToHex(iv)}${uint8ArrayToHex(ciphertext)}`
  sealedByPlain.set(plaintext, sealed)
  openedBySealed.set(sealed, plaintext)
  return sealed
}

/**
 * Values this page could not reach the wrapping key for. They may open on a
 * later load, so what holds them must not be written over in this one.
 */
const unavailableThisPage = new Set<string>()

async function openOne(sealed: string): Promise<void> {
  let key: CryptoKey
  try {
    key = await getWrappingKey()
  } catch {
    unavailableThisPage.add(sealed)
    return
  }
  try {
    const bytes = hexToUint8Array(sealed.slice(SEALED_VALUE_PREFIX.length))
    const plaintext = new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytes.slice(0, IV_BYTES) },
        key,
        bytes.slice(IV_BYTES),
      ),
    )
    openedBySealed.set(sealed, plaintext)
    sealedByPlain.set(plaintext, sealed)
  } catch {
    // Left unopened: the wrapping key is gone, or the value was altered.
    if ((await currentKeyStore()).standsIn) unavailableThisPage.add(sealed)
  }
}

/**
 * Whether this page failed to reach the wrapping key for this value, as
 * opposed to reaching it and finding the value will not open. Stays true for
 * the rest of the page even if a later try opens it.
 */
export function isSealedValueUnavailable(sealed: string): boolean {
  return unavailableThisPage.has(sealed)
}

/** Open these sealed values into memory, so `openedValue` can read them. */
export async function primeSealedValues(
  sealed: Iterable<string>,
): Promise<void> {
  const opens: Promise<void>[] = []
  for (const value of sealed) {
    if (!isSealedValue(value) || openedBySealed.has(value)) continue
    let pending = pendingOpens.get(value)
    if (!pending) {
      pending = openOne(value).finally(() => pendingOpens.delete(value))
      pendingOpens.set(value, pending)
    }
    opens.push(pending)
  }
  await Promise.all(opens)
}

/** The plain value, if this page has opened it. */
export function openedValue(sealed: string): string | undefined {
  return openedBySealed.get(sealed)
}
