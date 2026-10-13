// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Two suites over the accounts store and its live `Account` class:
 *
 * - Store-level: the persist read-merge-write (two-tab race) and tolerance of
 *   a malformed (tampered) current-account id.
 * - Class-level: the sign-out invariants — the vault (and `accessMethod`)
 *   survives a sign-out so the sign-back-in ceremony can unlock it, while
 *   every synced field (incl. the secret `derivationKey`) is stripped from
 *   memory and the projected record; a late `setAccess` (e.g. a change-method
 *   ceremony finishing after a cross-tab sign-out) may not undo the sign-out.
 */
import { BatchId, EthAddress, PrivateKey } from '@ethersphere/bee-js'
import {
  type Account as AccountRecord,
  STORAGE_KEY_ACCOUNTS,
  type SignedInAccount,
  type SignedOutAccount,
  createAccountsStorageManager,
} from '@snaha/swarm-id/internal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ACCOUNT_SAVE_FAILED_TEXT, Account, accountsStore } from './accounts.svelte'
import { toastStore } from './toast.svelte'

// The store module reads `browser` and (indirectly, via the lib storage
// manager) `window.localStorage` at import time — install both before it loads.
// `browser: false` keeps the boot-time load and the storage listener off; every
// test builds its state explicitly through `accountsStore.add()`.
vi.mock('$app/environment', () => ({ browser: false }))

vi.hoisted(() => {
  const backing = new Map<string, string>()
  const localStorageStub = {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => void backing.set(key, value),
    removeItem: (key: string) => void backing.delete(key),
    clear: () => backing.clear(),
  }
  Object.assign(globalThis, {
    window: {
      localStorage: localStorageStub,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    },
    localStorage: localStorageStub,
  })
})

const X_ID_HEX = 'a'.repeat(40)
const Y_ID_HEX = 'b'.repeat(40)

function record(idHex: string, name: string): AccountRecord {
  return {
    id: new EthAddress(idHex),
    name,
    createdAt: 1,
    derivationKey: 'f'.repeat(64),
    publicKey: '02' + 'ab'.repeat(32),
    access: { type: 'password', kdfSalt: 'a'.repeat(32), kdfIterations: 1 },
    encryptedSeed: 'ab'.repeat(44),
    devices: [],
    connectedApps: [],
    postageStamps: [],
  }
}

/**
 * Wait for every write already queued for the accounts document. Writes are
 * sealed on the way to storage, so they land asynchronously, in call order.
 */
function writesLanded(): Promise<void> {
  return createAccountsStorageManager().update(() => undefined)
}

/** Read what is actually persisted, through an independent manager instance. */
async function stored(): Promise<AccountRecord[]> {
  await writesLanded()
  const manager = createAccountsStorageManager()
  await manager.prime()
  return manager.load()
}

/**
 * Simulate another tab writing account `idHex` with a new name: mutate storage
 * through a separate manager instance. The store under test only refreshes on
 * real cross-tab `storage` events (which never fire here), so it stays stale —
 * exactly the interleaving window of the two-tab race.
 */
async function otherTabRenames(idHex: string, name: string): Promise<void> {
  await createAccountsStorageManager().update((accounts) =>
    accounts.map((account) =>
      account.id.equals(new EthAddress(idHex)) ? { ...account, name } : account,
    ),
  )
}

beforeEach(async () => {
  accountsStore.clear()
  await writesLanded()
})

describe('persist read-merge-write (two-tab race)', () => {
  it('a mutation keeps a concurrent write to ANOTHER account made by another tab', async () => {
    accountsStore.add(record(X_ID_HEX, 'x'))
    accountsStore.add(record(Y_ID_HEX, 'y'))

    await otherTabRenames(Y_ID_HEX, 'y-from-tab2')
    accountsStore.get(X_ID_HEX)?.rename('x-renamed')

    const names = new Map((await stored()).map((account) => [account.id.toHex(), account.name]))
    expect(names.get(new EthAddress(X_ID_HEX).toHex())).toBe('x-renamed')
    expect(names.get(new EthAddress(Y_ID_HEX).toHex())).toBe('y-from-tab2')
  })

  it('add() keeps a concurrent write to another account', async () => {
    accountsStore.add(record(X_ID_HEX, 'x'))
    await otherTabRenames(X_ID_HEX, 'x-from-tab2')

    accountsStore.add(record(Y_ID_HEX, 'y'))

    const names = new Map((await stored()).map((account) => [account.id.toHex(), account.name]))
    expect(names.get(new EthAddress(X_ID_HEX).toHex())).toBe('x-from-tab2')
    expect(names.get(new EthAddress(Y_ID_HEX).toHex())).toBe('y')
  })

  it('remove() keeps a concurrent write to another account', async () => {
    accountsStore.add(record(X_ID_HEX, 'x'))
    accountsStore.add(record(Y_ID_HEX, 'y'))
    await otherTabRenames(Y_ID_HEX, 'y-from-tab2')

    accountsStore.remove(X_ID_HEX)

    const records = await stored()
    expect(records).toHaveLength(1)
    expect(records[0]?.name).toBe('y-from-tab2')
  })

  it('a mutation round-trips to storage (sanity)', async () => {
    accountsStore.add(record(X_ID_HEX, 'x'))
    accountsStore.get(X_ID_HEX)?.rename('x-renamed')

    expect((await stored())[0]?.name).toBe('x-renamed')
  })
})

describe('a save that fails', () => {
  it('tells the person with a toast', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const show = vi.spyOn(toastStore, 'show')
    vi.spyOn(window.localStorage, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota exceeded')
    })

    accountsStore.add(record(X_ID_HEX, 'x'))
    await writesLanded()

    expect(show).toHaveBeenCalledWith(ACCOUNT_SAVE_FAILED_TEXT)
    vi.restoreAllMocks()
  })
})

// A connect leaves the app secret, the derivation key and every signer key
// sealed in storage, never in plain text.
describe('persist keeps no key in plain text', () => {
  it('after an account is added and an app connected', async () => {
    const APP_SECRET = '5a'.repeat(32)
    const account = accountsStore.add(record(X_ID_HEX, 'x'))
    account.connectApp({
      appUrl: 'https://app.example.com',
      appName: 'App',
      lastConnectedAt: 1,
      appSecret: APP_SECRET,
      connectedUntil: Date.now() + 60_000,
    })
    await writesLanded()

    const raw = window.localStorage.getItem(STORAGE_KEY_ACCOUNTS) ?? ''
    expect(raw).not.toBe('')
    expect(raw).not.toContain(APP_SECRET)
    expect(raw).not.toContain('f'.repeat(64))
    const [back] = await stored()
    expect(back && 'derivationKey' in back && back.derivationKey).toBe('f'.repeat(64))
  })
})

// The proxy inside the proxy iframe subscribes beside this store and publishes
// what it is told about — unless the write says peers must not hear of it.
// A regression in this plumb reintroduces the echo of #707 silently.
describe('persist tells the same-window proxy which writes not to republish', () => {
  function detailOfLastWrite(): { noRepublish?: boolean } {
    const spy = vi.mocked(window.dispatchEvent)
    const event = spy.mock.calls.at(-1)?.[0] as CustomEvent<{ noRepublish?: boolean }>
    return event.detail
  }

  beforeEach(() => {
    vi.spyOn(window, 'dispatchEvent')
  })

  it("a plain mutation is this device's change to publish", async () => {
    accountsStore.add(record(X_ID_HEX, 'x')).rename('renamed')
    await writesLanded()
    expect(detailOfLastWrite().noRepublish).toBeFalsy()
  })

  it('a skipSync commit is marked noRepublish', async () => {
    accountsStore.add(record(X_ID_HEX, 'x')).signOut(ENCRYPTED_STATE)
    await writesLanded()
    expect(detailOfLastWrite().noRepublish).toBe(true)
  })
})

describe('malformed account id (tampered current-account key)', () => {
  it('get() returns undefined instead of throwing', () => {
    accountsStore.add(record(X_ID_HEX, 'x'))

    expect(accountsStore.get('not-a-valid-address')).toBeUndefined()
  })

  it('remove() is a no-op instead of throwing', () => {
    accountsStore.add(record(X_ID_HEX, 'x'))

    expect(() => accountsStore.remove('not-a-valid-address')).not.toThrow()
    expect(accountsStore.accounts).toHaveLength(1)
  })
})

const noCommit = () => {}

function signedInRecord(): SignedInAccount {
  return {
    id: new EthAddress('a'.repeat(40)),
    name: 'Test Account',
    createdAt: 1700000000000,
    derivationKey: 'f'.repeat(64),
    publicKey: '02' + 'ab'.repeat(32),
    devices: [],
    connectedApps: [],
    postageStamps: [],
    access: { type: 'password', kdfSalt: '00', kdfIterations: 100000 },
    encryptedSeed: 'aabbccdd',
  }
}

const ENCRYPTED_STATE =
  '{"format":"swarm-id-signout-state","version":1,"salt":"00","payload":"aabb"}'

function signedOutRecord(): SignedOutAccount {
  const { id, name, createdAt, access, encryptedSeed } = signedInRecord()
  return {
    id,
    name,
    createdAt,
    access,
    encryptedSeed,
    encryptedState: ENCRYPTED_STATE,
    signedOutAt: 1700000000001,
  }
}

describe('Account sign-out state', () => {
  it('returns the vault access method while signed in', () => {
    const account = new Account(signedInRecord(), noCommit)
    expect(account.accessMethod.type).toBe('password')
  })

  it('keeps the access method readable for an account loaded as signed out', () => {
    const account = new Account(signedOutRecord(), noCommit)
    expect(account.isSignedOut).toBe(true)
    expect(account.accessMethod.type).toBe('password')
  })

  it('hydrates a signed-out record with empty synced fields', () => {
    const account = new Account(signedOutRecord(), noCommit)
    expect(account.derivationKey).toBe('')
    expect(account.publicKey).toBe('')
    expect(account.connectedApps).toEqual([])
    expect(account.postageStamps).toEqual([])
    expect(account.devices).toEqual([])
  })
})

describe('Account.signOut', () => {
  it('retains the vault and the snapshot, strips the synced fields from memory', () => {
    const account = new Account(signedInRecord(), noCommit)
    account.signOut(ENCRYPTED_STATE)
    expect(account.isSignedOut).toBe(true)
    expect(account.accessMethod.type).toBe('password')
    expect(account.vault.encryptedSeed).toBe('aabbccdd')
    expect(account.encryptedState).toBe(ENCRYPTED_STATE)
    expect(account.derivationKey).toBe('')
    expect(account.connectedApps).toEqual([])
  })

  it('projects exactly the minimal remnant record', () => {
    const account = new Account(signedInRecord(), noCommit)
    account.signOut(ENCRYPTED_STATE)
    expect(Object.keys(account.toRecord()).sort()).toEqual([
      'access',
      'createdAt',
      'encryptedSeed',
      'encryptedState',
      'id',
      'name',
      'signedOutAt',
      'soonestDriveExpiry',
      'storageWarning',
    ])
  })

  it('signs back in when a full record replaces it through accountsStore.add', () => {
    const live = accountsStore.add(record(X_ID_HEX, 'x'))
    live.signOut(ENCRYPTED_STATE)
    expect(live.isSignedOut).toBe(true)

    const restored = accountsStore.add(record(X_ID_HEX, 'x'))

    expect(restored).toBe(live) // instance reused, held references stay valid
    expect(live.isSignedOut).toBe(false)
    expect(live.signedOutAt).toBeUndefined()
    expect(live.encryptedState).toBeUndefined()
    expect(live.derivationKey).toBe('f'.repeat(64))
  })
})

describe('Account.signOut storage-warning remnant', () => {
  const DAY_S = 24 * 60 * 60
  const fullDrive = {
    batchID: new BatchId('c'.repeat(64)),
    signerKey: new PrivateKey('d'.repeat(64)),
    utilization: 1,
    usable: true,
    depth: 20,
    amount: 100000000n,
    bucketDepth: 16,
    blockNumber: 1,
    immutableFlag: false,
    exists: true,
    batchTTL: 30 * DAY_S,
    createdAt: Date.now(),
  }

  it('captures the warning flag and soonest expiry from the live drives', () => {
    const account = new Account({ ...signedInRecord(), postageStamps: [fullDrive] }, noCommit)
    account.signOut(ENCRYPTED_STATE)
    expect(account.storageWarning).toBe(true)
    expect(account.soonestDriveExpiry).toBeGreaterThan(Date.now())
    expect(account.toRecord()).toMatchObject({
      storageWarning: true,
      soonestDriveExpiry: expect.any(Number),
    })
  })

  it('records no warning for a healthy account', () => {
    const account = new Account(
      { ...signedInRecord(), postageStamps: [{ ...fullDrive, utilization: 0.1 }] },
      noCommit,
    )
    account.signOut(ENCRYPTED_STATE)
    expect(account.storageWarning).toBe(false)
    expect(account.soonestDriveExpiry).toBeGreaterThan(Date.now())
  })

  it('round-trips the remnant through a record', () => {
    const account = new Account({ ...signedInRecord(), postageStamps: [fullDrive] }, noCommit)
    account.signOut(ENCRYPTED_STATE)
    const rehydrated = new Account(account.toRecord(), noCommit)
    expect(rehydrated.storageWarning).toBe(true)
    expect(rehydrated.soonestDriveExpiry).toBe(account.soonestDriveExpiry)
  })
})

describe('Account.setAppStamp', () => {
  const APP_URL = 'https://app.example.com'
  const BATCH_HEX = 'c'.repeat(64)

  function accountWithApp(): Account {
    return new Account(
      {
        ...signedInRecord(),
        connectedApps: [{ appUrl: APP_URL, appName: 'Test App', lastConnectedAt: 1 }],
      },
      noCommit,
    )
  }

  // On its own clock, not the entry's: the choice says nothing about whether
  // the app is still connected, and ranking the entry by it discarded a revoke
  // made on another device (#681).
  it('points the app at a drive and stamps the pointer clock', () => {
    const account = accountWithApp()
    account.setAppStamp(APP_URL, new BatchId(BATCH_HEX))
    const app = account.connectedApps[0]
    expect(app.postageStampBatchID?.toHex()).toBe(BATCH_HEX)
    expect(app.postageStampBatchIDAt).toEqual(expect.any(Number))
  })

  it('clears the pointer back to the account default', () => {
    const account = accountWithApp()
    account.setAppStamp(APP_URL, new BatchId(BATCH_HEX))
    account.setAppStamp(APP_URL, undefined)
    expect(account.connectedApps[0].postageStampBatchID).toBeUndefined()
  })

  it('is a no-op for an unknown app', () => {
    const account = accountWithApp()
    account.setAppStamp('https://other.example.com', new BatchId(BATCH_HEX))
    expect(account.connectedApps[0].postageStampBatchID).toBeUndefined()
    expect(account.connectedApps).toHaveLength(1)
  })
})

// An app entry is keyed by its site, and the site comes from the connect
// window's link. Both writers that take one check it.
describe('Account refuses a site that is not a clean origin', () => {
  const DIRTY_SITE = 'https://app.example.com/path'

  it('records no connection for it', () => {
    let commits = 0
    const account = new Account(signedInRecord(), () => commits++)

    expect(() =>
      account.connectApp({ appUrl: DIRTY_SITE, appName: 'Test App', lastConnectedAt: 1 }),
    ).toThrow(/not accepted/)

    expect(account.connectedApps).toHaveLength(0)
    expect(commits).toBe(0)
  })

  it('points no drive for it, even at an entry already stored under it', () => {
    let commits = 0
    const account = new Account(
      {
        ...signedInRecord(),
        connectedApps: [{ appUrl: DIRTY_SITE, appName: 'Test App', lastConnectedAt: 1 }],
      },
      () => commits++,
    )

    account.setAppStamp(DIRTY_SITE, new BatchId('c'.repeat(64)))

    expect(account.connectedApps[0].postageStampBatchID).toBeUndefined()
    expect(commits).toBe(0)
  })
})

describe('Account.setAccess', () => {
  it('swaps the vault while signed in', () => {
    const account = new Account(signedInRecord(), noCommit)
    account.setAccess({ type: 'passkey', credentialId: 'cred' }, 'bbccddee')
    expect(account.accessMethod.type).toBe('passkey')
  })

  it('throws on a signed-out account instead of undoing the sign-out', () => {
    const account = new Account(signedInRecord(), noCommit)
    account.signOut(ENCRYPTED_STATE)
    expect(() =>
      account.setAccess({ type: 'password', kdfSalt: '11', kdfIterations: 100000 }, 'bbccddee'),
    ).toThrow(/signed out/)
    // The sign-out survived, and the original vault is untouched.
    expect(account.isSignedOut).toBe(true)
    expect(account.vault.encryptedSeed).toBe('aabbccdd')
    expect(account.toRecord()).toMatchObject({ signedOutAt: expect.any(Number) })
  })
})
