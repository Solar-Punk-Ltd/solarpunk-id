// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * What the connect popup hands a PARTITIONED proxy iframe.
 *
 * Since #547 that session is a first-class writer, so the handover carries real
 * credentials — in a context embedded by an arbitrary dApp page. It can only
 * ever spend the stamp resolved for it, so that is all it should be given
 * (#578).
 */
import { BatchId, EthAddress, PrivateKey } from '@ethersphere/bee-js'
import { verifyChatBinding } from '@snaha/swarm-id'
import {
  AuthDataSchema,
  type ConnectedApp,
  type SyncedAccount,
  createChatBinding,
  deriveSecret,
} from '@snaha/swarm-id/internal'
import { type Hex, recoverMessageAddress } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { completeConnect, partitionHandoverAccount, reuseConnection } from '$lib/connect-handshake'
import { strip0x } from '$lib/crypto/hex'
import { walletFromEntropy } from '$lib/crypto/mnemonic'
import type { ConnectRequest } from '$lib/stores/connect.svelte'
import type { Account } from '$lib/types'

const APP_ORIGIN = 'https://dapp.example.com'
const DEFAULT_BATCH = 'cc'.repeat(32)
const APP_BATCH = 'dd'.repeat(32)
const UNRELATED_BATCH = 'ee'.repeat(32)

function stamp(batchIdHex: string, signerHex: string) {
  return {
    batchID: new BatchId(batchIdHex),
    signerKey: new PrivateKey(signerHex),
    utilization: 0,
    usable: true,
    depth: 24,
    amount: BigInt(100),
    bucketDepth: 16,
    blockNumber: 1,
    immutableFlag: false,
    exists: true,
    createdAt: 1_000_000,
  }
}

function makeAccount(appBatch?: BatchId): SyncedAccount {
  return {
    id: new EthAddress('aa'.repeat(20)),
    name: 'Test Account',
    createdAt: 1_000_000,
    derivationKey: '11'.repeat(32),
    publicKey: `02${'ab'.repeat(32)}`,
    defaultPostageStampBatchID: new BatchId(DEFAULT_BATCH),
    devices: [],
    connectedApps: [
      {
        appUrl: APP_ORIGIN,
        appName: 'dApp',
        lastConnectedAt: 1_000_000,
        postageStampBatchID: appBatch,
      },
    ],
    postageStamps: [
      stamp(DEFAULT_BATCH, '22'.repeat(32)),
      stamp(APP_BATCH, '33'.repeat(32)),
      stamp(UNRELATED_BATCH, '44'.repeat(32)),
    ],
    settings: undefined,
    lastModified: 1_000_000,
    partitionCount: 2,
  } as SyncedAccount
}

const batchIds = (payload: Record<string, unknown>): string[] =>
  (payload.postageStamps as { batchID: string }[]).map((s) => s.batchID)

describe('partitionHandoverAccount', () => {
  it('hands over only the stamps this app can spend', () => {
    const payload = partitionHandoverAccount(makeAccount(new BatchId(APP_BATCH)), APP_ORIGIN)

    expect(batchIds(payload).sort()).toEqual([APP_BATCH, DEFAULT_BATCH].sort())
    expect(batchIds(payload)).not.toContain(UNRELATED_BATCH)
  })

  it('hands over only the default when the app has no override', () => {
    const payload = partitionHandoverAccount(makeAccount(), APP_ORIGIN)

    expect(batchIds(payload)).toEqual([DEFAULT_BATCH])
  })

  // An app connecting for the first time has no `connectedApps` entry yet — the
  // account default is the whole answer, and nothing else may ride along.
  it('hands over only the default for an app with no entry yet', () => {
    const payload = partitionHandoverAccount(makeAccount(), 'https://other.example.com')

    expect(batchIds(payload)).toEqual([DEFAULT_BATCH])
  })

  // Everything else the synced projection carries is still needed: the topic
  // and envelope key of the account bus, and the lock-SOC signer of the
  // partition lease, all derive from `derivationKey`.
  it('still carries the derivation key and strips app secrets', () => {
    const payload = partitionHandoverAccount(makeAccount(), APP_ORIGIN)

    expect(payload.derivationKey).toBe('11'.repeat(32))
    for (const app of payload.connectedApps as Record<string, unknown>[]) {
      expect(app.appSecret).toBeUndefined()
    }
  })

  // Each connected site's entry can carry that site's chat binding, which links
  // the account to its chat there. The frame this goes to runs inside the page
  // of the site being connected, so it gets that site's binding and no other.
  it("carries only this site's chat binding", () => {
    const ACCOUNT_KEY = '5a'.repeat(32)
    const OTHER_ORIGIN = 'https://other.example.com'
    const date = new Date('2026-10-14T12:00:00.000Z')
    const own = createChatBinding(ACCOUNT_KEY, APP_ORIGIN, date)
    const other = createChatBinding(ACCOUNT_KEY, OTHER_ORIGIN, date)
    const account = makeAccount()
    account.connectedApps = [
      { ...account.connectedApps[0], chatBinding: own },
      { appUrl: OTHER_ORIGIN, appName: 'Other', lastConnectedAt: 1_000_000, chatBinding: other },
    ]

    const payload = partitionHandoverAccount(account, APP_ORIGIN)

    const apps = payload.connectedApps as Record<string, unknown>[]
    expect(apps.map((app) => app.appUrl)).toEqual([APP_ORIGIN, OTHER_ORIGIN])
    expect(apps[0].chatBinding).toEqual(own)
    expect(apps[1].chatBinding).toBeUndefined()
    expect(JSON.stringify(payload)).not.toContain(other.signature)
    expect(account.connectedApps[1].chatBinding).toEqual(other)
  })

  // The proxy REFUSES a handover whose account does not parse, so a narrowing
  // that quietly drops a required field no longer degrades the session — it
  // ends it. Nothing else checks this sender against that receiver, and the
  // JSON round-trip in `sendSecretToOpener` is part of the wire shape, so the
  // assertion runs on what actually crosses the boundary.
  it('produces an account the proxy will accept', () => {
    const wire = JSON.parse(
      JSON.stringify({
        secret: '33'.repeat(32),
        account: partitionHandoverAccount(makeAccount(new BatchId(APP_BATCH)), APP_ORIGIN),
      }),
    )

    expect(AuthDataSchema.safeParse(wire).success).toBe(true)
  })
})

/**
 * The chat binding the popup signs while it holds the unlocked key
 * (docs/Chat-Binding.md): the account's own key says the site's app key is
 * its chat address there, and the statement goes out only in the handover.
 */
describe('the chat binding at connect', () => {
  const ENTROPY = new Uint8Array(16).fill(0x5a)
  const wallet = walletFromEntropy(ENTROPY)
  const ACCOUNT_ID = new EthAddress(wallet.address)
  const CHALLENGE = 'challenge-1'
  const IDENTITY_ORIGIN = 'https://id.example.com'

  let opener: { postMessage: ReturnType<typeof vi.fn> }

  const request: ConnectRequest = {
    appOrigin: APP_ORIGIN,
    appName: 'dApp',
    partitionChallenge: CHALLENGE,
  }

  /** The parts of the live `Account` the handshake touches. */
  function fakeAccount(connectedApps: ConnectedApp[] = []): Account {
    const account = {
      id: ACCOUNT_ID,
      settings: undefined,
      connectedApps,
      connectApp(app: ConnectedApp) {
        const others = account.connectedApps.filter((entry) => entry.appUrl !== app.appUrl)
        const existing = account.connectedApps.find((entry) => entry.appUrl === app.appUrl)
        account.connectedApps = [...others, { ...existing, ...app }]
      },
      toSyncedRecord: () => ({
        ...makeAccount(),
        id: ACCOUNT_ID,
        connectedApps: account.connectedApps,
      }),
    }
    return account as unknown as Account
  }

  const savedBinding = (account: Account) =>
    account.connectedApps.find((app) => app.appUrl === APP_ORIGIN)?.chatBinding

  const handedOver = () => {
    const [message, targetOrigin] = opener.postMessage.mock.calls.at(-1) ?? []
    expect(targetOrigin).toBe(IDENTITY_ORIGIN)
    return message as { type: string; challenge: string; data: Record<string, unknown> }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-14T12:00:00.000Z'))
    opener = { postMessage: vi.fn() }
    vi.stubGlobal('window', { opener, location: { origin: IDENTITY_ORIGIN } })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("signs the site's own app key with the account's key, as a personal message", async () => {
    const account = fakeAccount()

    await completeConnect(account, ENTROPY, request)

    const binding = savedBinding(account)
    expect(binding).toBeDefined()
    const appSecret = await deriveSecret(strip0x(wallet.privateKey), APP_ORIGIN)
    const chatAddress = new PrivateKey(appSecret).publicKey().address().toHex()
    expect(verifyChatBinding(binding!)).toEqual({
      signer: `0x${ACCOUNT_ID.toHex()}`,
      site: APP_ORIGIN,
      chatAddress: `0x${chatAddress}`,
      date: '2026-10-14T12:00:00.000Z',
    })
    // An independent EIP-191 implementation recovers the same signer, so any
    // reader's library will.
    const signer = await recoverMessageAddress({
      message: binding!.message,
      signature: binding!.signature as Hex,
    })
    expect(signer.toLowerCase()).toBe(`0x${ACCOUNT_ID.toHex()}`)
  })

  it('hands it over with the secret, in a payload the proxy accepts', async () => {
    const account = fakeAccount()

    await completeConnect(account, ENTROPY, request)

    const message = handedOver()
    expect(message.type).toBe('setSecret')
    expect(message.challenge).toBe(CHALLENGE)
    expect(message.data.chatBinding).toEqual(savedBinding(account))
    const parsed = AuthDataSchema.parse(message.data)
    expect(parsed.chatBinding).toEqual(savedBinding(account))
  })

  it('keeps the binding it already has for this site on a reconnect', async () => {
    const account = fakeAccount()
    await completeConnect(account, ENTROPY, request)
    const first = savedBinding(account)

    vi.setSystemTime(new Date('2026-10-15T12:00:00.000Z'))
    await completeConnect(account, ENTROPY, request)

    expect(savedBinding(account)).toEqual(first)
    expect(handedOver().data.chatBinding).toEqual(first)
  })

  it('replaces a kept binding that does not belong to this account and site', async () => {
    const foreign = createChatBinding('6b'.repeat(32), APP_ORIGIN, new Date())
    const account = fakeAccount([
      { appUrl: APP_ORIGIN, appName: 'dApp', lastConnectedAt: 1, chatBinding: foreign },
    ])

    await completeConnect(account, ENTROPY, request)

    const binding = savedBinding(account)!
    expect(binding).not.toEqual(foreign)
    expect(verifyChatBinding(binding).signer).toBe(`0x${ACCOUNT_ID.toHex()}`)
  })

  it('hands over the kept binding when a valid session is reused', async () => {
    const account = fakeAccount()
    await completeConnect(account, ENTROPY, request)
    const kept = savedBinding(account)
    opener.postMessage.mockClear()

    expect(reuseConnection(account, request)).toBe(true)

    expect(handedOver().data.chatBinding).toEqual(kept)
    expect(savedBinding(account)).toEqual(kept)
  })
})
