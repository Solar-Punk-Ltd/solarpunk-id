// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { BatchId, EthAddress, PrivateKey } from "@ethersphere/bee-js"
import {
  createAccountsStorageManager,
  serializeAccount,
  serializeSyncedAccount,
} from "./storage-managers"
import { createChatBinding } from "./chat-binding"
import { LocalAccountSchemaV1, isSignedOutAccount } from "../schemas"
import { STORAGE_KEY_ACCOUNTS } from "../types"
import {
  TEST_BATCH_ID_HEX,
  TEST_ETH_ADDRESS_2_HEX,
  TEST_PRIVATE_KEY_HEX,
  createAccount,
  createSignedOutAccount,
  createPostageStamp,
} from "../test-fixtures"
import {
  createFakeIndexedDB,
  createUnreadableIndexedDB,
} from "../test-indexeddb"
import { sealValue } from "./sealed-values"

describe("serializeAccount — device-local seed vault", () => {
  it("round-trips a seed-vault account through serialize + Zod parse", () => {
    const account = createAccount({
      access: { type: "passkey", credentialId: "cred-xyz" },
      encryptedSeed: "0011223344",
      defaultPostageStampBatchID: new BatchId(TEST_BATCH_ID_HEX),
      postageStamps: [
        createPostageStamp({
          batchID: new BatchId(TEST_BATCH_ID_HEX),
          signerKey: new PrivateKey(TEST_PRIVATE_KEY_HEX),
        }),
      ],
    })

    const serialized = serializeAccount(account)

    // Survives a JSON file round-trip (no class instances leak into storage).
    const reparsed = LocalAccountSchemaV1.parse(
      JSON.parse(JSON.stringify(serialized)),
    )

    expect(reparsed.access).toEqual({
      type: "passkey",
      credentialId: "cred-xyz",
    })
    expect(reparsed.encryptedSeed).toBe("0011223344")
    expect(reparsed.id.equals(account.id)).toBe(true)
    // `Account` is a union discriminated on `signedOutAt`; the synced fields
    // live only on the signed-in arm, so prove which arm parsed before reading.
    if (isSignedOutAccount(reparsed))
      throw new Error("expected a signed-in account")
    expect(reparsed.derivationKey).toBe(account.derivationKey)
    expect(
      reparsed.postageStamps[0].batchID.equals(new BatchId(TEST_BATCH_ID_HEX)),
    ).toBe(true)
  })

  it("persists each access method shape", () => {
    for (const access of [
      { type: "passkey", credentialId: "c" },
      { type: "eth-wallet", encryptionSalt: "ff" },
      { type: "password", kdfSalt: "aa", kdfIterations: 200000 },
    ] as const) {
      const serialized = serializeAccount(createAccount({ access }))
      const reparsed = LocalAccountSchemaV1.parse(
        JSON.parse(JSON.stringify(serialized)),
      )
      expect(reparsed.access).toEqual(access)
    }
  })

  it("round-trips a signed-out account (vault retained, signedOutAt set)", () => {
    const account = createSignedOutAccount({ signedOutAt: 1700000000123 })

    const serialized = serializeAccount(account)
    const reparsed = LocalAccountSchemaV1.parse(
      JSON.parse(JSON.stringify(serialized)),
    )

    expect(reparsed.access).toEqual(account.access)
    expect(reparsed.encryptedSeed).toBe(account.encryptedSeed)
    if (!isSignedOutAccount(reparsed))
      throw new Error("expected a signed-out account")
    expect(reparsed.encryptedState).toBe(account.encryptedState)
    expect(reparsed.signedOutAt).toBe(1700000000123)
  })

  // Pins the sign-out privacy contract: nothing but the vault, the encrypted
  // state snapshot, the storage-warning remnant, and the display fields
  // survives in localStorage — no plaintext derivationKey, collections, or
  // clocks.
  it("serializes a signed-out account to exactly the minimal remnant keys", () => {
    const serialized = serializeAccount(createSignedOutAccount())

    expect(Object.keys(serialized).sort()).toEqual([
      "access",
      "createdAt",
      "encryptedSeed",
      "encryptedState",
      "id",
      "name",
      "signedOutAt",
      "soonestDriveExpiry",
      "storageWarning",
    ])
  })

  it("round-trips the storage-warning fields", () => {
    const account = createSignedOutAccount({
      storageWarning: true,
      soonestDriveExpiry: 1707776000000,
    })
    const reparsed = LocalAccountSchemaV1.parse(
      JSON.parse(JSON.stringify(serializeAccount(account))),
    )
    expect(reparsed).toMatchObject({
      storageWarning: true,
      soonestDriveExpiry: 1707776000000,
    })
  })
})

describe("createAccountsStorageManager().load() — invalid records", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function stubLocalStorage(document: unknown) {
    const store = new Map<string, string>([
      [STORAGE_KEY_ACCOUNTS, JSON.stringify(document)],
    ])
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    })
  }

  /** A serialized account with its keys sealed, as the manager writes it. */
  async function sealed(record: Record<string, unknown>) {
    const key = (value: unknown) =>
      typeof value === "string" ? sealValue(value) : value
    return {
      ...record,
      derivationKey: await key(record.derivationKey),
      connectedApps: await Promise.all(
        (record.connectedApps as Record<string, unknown>[]).map(
          async (app) => ({
            ...app,
            appSecret: await key(app.appSecret),
          }),
        ),
      ),
      postageStamps: await Promise.all(
        (record.postageStamps as Record<string, unknown>[]).map(
          async (stamp) => ({
            ...stamp,
            signerKey: await key(stamp.signerKey),
          }),
        ),
      ),
    }
  }

  it("skips an invalid record instead of dropping every account", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const good = createAccount()
    const other = createAccount({
      id: new EthAddress(TEST_ETH_ADDRESS_2_HEX),
      name: "Other Account",
    })
    const corrupt = {
      ...serializeAccount(other),
      // Fails the schema's hex regex — e.g. a malformed write from a dev tool.
      encryptedSeed: "not-hex",
    }
    stubLocalStorage({
      version: 1,
      data: [await sealed(serializeAccount(good)), await sealed(corrupt)],
    })

    const loaded = createAccountsStorageManager().load()

    expect(loaded).toHaveLength(1)
    expect(loaded[0].id.equals(good.id)).toBe(true)
  })

  // A throw inside a Zod transform escapes `safeParse`: without a format check
  // ahead of `new EthAddress(s)` / `BigInt(s)`, one record with a 40-character
  // non-hex id or a non-decimal `amount` dropped the WHOLE document, and the
  // next read-merge-write erased the other accounts for real.
  it("skips a record whose transform input is malformed, not the document", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const good = createAccount()
    const other = createAccount({
      id: new EthAddress(TEST_ETH_ADDRESS_2_HEX),
      postageStamps: [createPostageStamp()],
    })
    const serialized = serializeAccount(other)
    const [stamp] = serialized.postageStamps as Record<string, unknown>[]
    const badId = { ...serialized, id: "z".repeat(40) }
    const badAmount = {
      ...serialized,
      postageStamps: [{ ...stamp, amount: "1e18" }],
    }
    stubLocalStorage({
      version: 1,
      data: [
        await sealed(badId),
        await sealed(serializeAccount(good)),
        await sealed(badAmount),
      ],
    })

    const loaded = createAccountsStorageManager().load()

    expect(loaded).toHaveLength(1)
    expect(loaded[0].id.equals(good.id)).toBe(true)
  })

  // Pre-vault-retention releases wiped the vault on sign-out; those records
  // can't be signed back into and are quarantined by the loader (pre-prod,
  // no migration).
  it("skips a vault-less signed-out record from an old release", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const good = createAccount()
    const {
      access: _access,
      encryptedSeed: _encryptedSeed,
      ...oldSignedOut
    } = serializeAccount(
      createAccount({ id: new EthAddress(TEST_ETH_ADDRESS_2_HEX) }),
    )
    stubLocalStorage({
      version: 1,
      data: [
        serializeAccount(good),
        { ...oldSignedOut, signedOutAt: 1700000000001 },
      ],
    })

    const loaded = createAccountsStorageManager().load()

    expect(loaded).toHaveLength(1)
    expect(loaded[0].id.equals(good.id)).toBe(true)
  })

  it("returns [] when the document is not an array", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    stubLocalStorage({ version: 1, data: { not: "an array" } })

    expect(createAccountsStorageManager().load()).toEqual([])
  })
})

// The chat binding is public and true on every device of the account, so it
// travels with the connection it belongs to, unlike the app secret.
describe("a connected app's chat binding", () => {
  const binding = createChatBinding(
    "5a".repeat(32),
    "https://viewer.example.com",
    new Date("2026-10-14T12:00:00.000Z"),
  )
  const account = createAccount({
    connectedApps: [
      {
        appUrl: "https://viewer.example.com",
        appName: "Viewer",
        lastConnectedAt: 1_000_000,
        appSecret: "44".repeat(32),
        chatBinding: binding,
      },
    ],
  })

  it("is kept in the device's own record", () => {
    const reparsed = LocalAccountSchemaV1.parse(
      JSON.parse(JSON.stringify(serializeAccount(account))),
    )
    if (isSignedOutAccount(reparsed))
      throw new Error("expected a signed-in account")
    expect(reparsed.connectedApps[0].chatBinding).toEqual(binding)
  })

  it("travels in the portable projection, without the app secret", () => {
    const [app] = serializeSyncedAccount(account).connectedApps as Record<
      string,
      unknown
    >[]
    expect(app.chatBinding).toEqual(binding)
    expect("appSecret" in app).toBe(false)
  })
})

// Review P2-2: key material at rest is sealed with a non-extractable key kept
// in this origin's IndexedDB, opened into memory for the page. A key that
// cannot be opened is absent, and the person signs in again.
describe("the accounts document keeps its keys sealed", () => {
  const APP_SECRET = "5a".repeat(32)
  const SIGNER_KEY = "6b".repeat(32)
  const DERIVATION_KEY = "7c".repeat(32)

  type StorageManagers = typeof import("./storage-managers")

  let store: Map<string, string>

  /** A page load: fresh modules over the same storage. */
  async function freshPage(): Promise<StorageManagers> {
    vi.resetModules()
    // eslint-disable-next-line no-restricted-syntax -- a fresh module per page load is the point
    return import("./storage-managers")
  }

  function account() {
    return createAccount({
      derivationKey: DERIVATION_KEY,
      connectedApps: [
        {
          appUrl: "https://app.example.com",
          appName: "Test App",
          lastConnectedAt: 1,
          appSecret: APP_SECRET,
          connectedUntil: 2,
        },
      ],
      postageStamps: [
        createPostageStamp({ signerKey: new PrivateKey(SIGNER_KEY) }),
      ],
    })
  }

  const raw = () => store.get(STORAGE_KEY_ACCOUNTS) ?? ""

  beforeEach(() => {
    store = new Map()
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    })
    vi.stubGlobal("indexedDB", createFakeIndexedDB())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("leaves no key in plain text in storage", async () => {
    const { createAccountsStorageManager } = await freshPage()

    await createAccountsStorageManager().save([account()])

    expect(raw()).not.toBe("")
    for (const secret of [APP_SECRET, SIGNER_KEY, DERIVATION_KEY]) {
      expect(raw()).not.toContain(secret)
    }
  })

  it("reads the keys back on a later page load", async () => {
    await (await freshPage()).createAccountsStorageManager().save([account()])
    const manager = (await freshPage()).createAccountsStorageManager()

    await manager.prime()
    const [loaded] = manager.load()

    expect(isSignedOutAccount(loaded)).toBe(false)
    if (isSignedOutAccount(loaded)) return
    expect(loaded.derivationKey).toBe(DERIVATION_KEY)
    expect(loaded.connectedApps[0].appSecret).toBe(APP_SECRET)
    expect(loaded.postageStamps[0].signerKey.toHex()).toBe(SIGNER_KEY)
  })

  it("signs the account out when the wrapping key is gone, keeping its vault", async () => {
    const original = account()
    await (await freshPage()).createAccountsStorageManager().save([original])
    vi.stubGlobal("indexedDB", createFakeIndexedDB())
    const manager = (await freshPage()).createAccountsStorageManager()

    await manager.prime()
    const [loaded] = manager.load()

    expect(isSignedOutAccount(loaded)).toBe(true)
    expect(loaded.id.equals(original.id)).toBe(true)
    expect(loaded.encryptedSeed).toBe(original.encryptedSeed)
    expect(loaded.access).toEqual(original.access)
  })

  it("keeps the sealed keys through a page whose IndexedDB read fails, and reads them once it works", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const working = createFakeIndexedDB()
    vi.stubGlobal("indexedDB", working)
    await (await freshPage()).createAccountsStorageManager().save([account()])
    const sealedKey = () =>
      (JSON.parse(raw()) as { data: { derivationKey?: string }[] }).data[0]
        .derivationKey
    const before = sealedKey()

    vi.stubGlobal("indexedDB", createUnreadableIndexedDB())
    const failing = (await freshPage()).createAccountsStorageManager()
    await failing.prime()
    expect(isSignedOutAccount(failing.load()[0])).toBe(true)
    await failing.update((stored) => [...stored])
    await failing.save(failing.load())

    expect(before).toBeDefined()
    expect(sealedKey()).toBe(before)

    vi.stubGlobal("indexedDB", working)
    const later = (await freshPage()).createAccountsStorageManager()
    await later.prime()
    const [loaded] = later.load()
    expect(isSignedOutAccount(loaded)).toBe(false)
    if (isSignedOutAccount(loaded)) return
    expect(loaded.derivationKey).toBe(DERIVATION_KEY)
  })

  it("does not read a key stored in plain text", async () => {
    store.set(
      STORAGE_KEY_ACCOUNTS,
      JSON.stringify({ version: 1, data: [serializeAccount(account())] }),
    )
    const manager = (await freshPage()).createAccountsStorageManager()

    await manager.prime()
    const [loaded] = manager.load()

    expect(isSignedOutAccount(loaded)).toBe(true)
  })

  it("keeps two writes from one window in order", async () => {
    const manager = (await freshPage()).createAccountsStorageManager()
    const renamed = { ...account(), name: "Renamed" }

    await Promise.all([manager.save([account()]), manager.save([renamed])])

    await manager.prime()
    expect(manager.load()[0].name).toBe("Renamed")
  })

  it("updates on what is stored at the time of the write", async () => {
    const manager = (await freshPage()).createAccountsStorageManager()
    const other = createAccount({
      id: new EthAddress(TEST_ETH_ADDRESS_2_HEX),
      name: "Other",
    })

    await Promise.all([
      manager.update((stored) => [...stored, account()]),
      manager.update((stored) => [...stored, other]),
    ])

    await manager.prime()
    expect(manager.load().map((a) => a.name)).toEqual(["Test Account", "Other"])
  })
})
