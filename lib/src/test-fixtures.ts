// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Shared test fixtures for envelope, account-state-snapshot, and sync tests.
 */
import { EthAddress, BatchId, PrivateKey } from "@ethersphere/bee-js"
import type {
  SyncedAccount,
  SignedInAccount,
  SignedOutAccount,
  Device,
  ConnectedApp,
  PostageStamp,
} from "./schemas"
import type { SiteAllowList } from "./utils/site-allow-list"
import { secp256k1 } from "@noble/curves/secp256k1"
import { keccak_256 } from "@noble/hashes/sha3"
import { buildChatBindingMessage } from "./utils/chat-binding"
import type { ChatBinding } from "./utils/chat-binding"
import { hexToUint8Array } from "./utils/hex"
import { deriveSecretSync } from "./utils/key-derivation"

export const TEST_ETH_ADDRESS_HEX = "a".repeat(40)
export const TEST_ETH_ADDRESS_2_HEX = "b".repeat(40)
export const TEST_IDENTITY_ADDRESS_HEX = "1".repeat(40)
export const TEST_IDENTITY_ADDRESS_2_HEX = "2".repeat(40)
export const TEST_BATCH_ID_HEX = "c".repeat(64)
export const TEST_BATCH_ID_2_HEX = "e".repeat(64)
export const TEST_PRIVATE_KEY_HEX = "d".repeat(64)
export const TEST_DERIVATION_KEY_HEX = "f".repeat(64)
// Compressed secp256k1 public key: 0x02/0x03 prefix byte + 32 bytes = 66 bare hex chars.
export const TEST_PUBLIC_KEY_HEX = "02" + "ab".repeat(32)
export const DIFFERENT_DERIVATION_KEY_HEX = "1".repeat(64)
export const TEST_DEVICE_ID = "550e8400-e29b-41d4-a716-446655440000"

export function createDevice(overrides?: Partial<Device>): Device {
  return {
    deviceId: TEST_DEVICE_ID,
    createdAt: 1700000000000,
    lastSignedInAt: 1700000000000,
    ...overrides,
  }
}

/** The synced (portable) fields both account fixtures share. */
function createSyncedAccount(): SyncedAccount {
  return {
    id: new EthAddress(TEST_ETH_ADDRESS_HEX),
    name: "Test Account",
    createdAt: 1700000000000,
    publicKey: TEST_PUBLIC_KEY_HEX,
    derivationKey: TEST_DERIVATION_KEY_HEX,
    devices: [],
    connectedApps: [],
    postageStamps: [],
  }
}

/**
 * The signed-in account fixture. Every account is a BIP-39 seed account with an
 * `access` + `encryptedSeed` vault (defaulted here to a password vault);
 * override them to model a different access method. For the signed-out variant
 * (vault wiped) use `createSignedOutAccount`.
 */
export function createAccount(
  overrides?: Partial<SignedInAccount>,
): SignedInAccount {
  return {
    ...createSyncedAccount(),
    access: { type: "password", kdfSalt: "00", kdfIterations: 100000 },
    encryptedSeed: "aabbccdd",
    ...overrides,
  }
}

/**
 * Signed-out counterpart of `createAccount`: the minimal sign-out remnant —
 * the retained vault, the encrypted state snapshot, and display fields;
 * everything synced stripped.
 */
export function createSignedOutAccount(
  overrides?: Partial<SignedOutAccount>,
): SignedOutAccount {
  return {
    id: new EthAddress(TEST_ETH_ADDRESS_HEX),
    name: "Test Account",
    createdAt: 1700000000000,
    access: { type: "password", kdfSalt: "00", kdfIterations: 100000 },
    encryptedSeed: "aabbccdd",
    encryptedState: '{"format":"test-snapshot","payload":"aabb"}',
    storageWarning: false,
    soonestDriveExpiry: 1707776000000,
    signedOutAt: 1700000000001,
    ...overrides,
  }
}

export function createConnectedApp(
  overrides?: Partial<ConnectedApp>,
): ConnectedApp {
  return {
    appUrl: "https://app.example.com",
    appName: "Test App",
    lastConnectedAt: 1700000000000,
    appSecret: "secret-should-be-stripped",
    ...overrides,
  }
}

export function createPostageStamp(
  overrides?: Partial<PostageStamp>,
): PostageStamp {
  return {
    batchID: new BatchId(TEST_BATCH_ID_HEX),
    signerKey: new PrivateKey(TEST_PRIVATE_KEY_HEX),
    utilization: 0,
    usable: true,
    depth: 20,
    amount: 100000000n,
    bucketDepth: 16,
    blockNumber: 12345678,
    immutableFlag: false,
    exists: true,
    createdAt: 1700000000000,
    ...overrides,
  }
}

const PERSONAL_MESSAGE_PREFIX = "\x19Ethereum Signed Message:\n"
const RECOVERY_OFFSET = 27
const HEX_RADIX = 16

/**
 * A binding in the shape the identity UI signed before sites had a chat key
 * of their own: correctly signed by the account, but naming the address of
 * the site's app secret. Nothing may accept it now, and the tests that say so
 * build it here, since `createChatBinding` can no longer produce one.
 */
export function appSecretAddressChatBinding(
  accountKey: string,
  site: string,
  date: Date,
): ChatBinding {
  const appSecret = deriveSecretSync(accountKey, site)
  const message = buildChatBindingMessage({
    site,
    chatAddress: new PrivateKey(appSecret).publicKey().address().toHex(),
    date,
  })
  const body = new TextEncoder().encode(message)
  const prefix = new TextEncoder().encode(
    `${PERSONAL_MESSAGE_PREFIX}${body.length}`,
  )
  const signed = secp256k1.sign(
    keccak_256(new Uint8Array([...prefix, ...body])),
    hexToUint8Array(accountKey),
  )
  const recovery = (signed.recovery + RECOVERY_OFFSET).toString(HEX_RADIX)
  return { message, signature: `0x${signed.toCompactHex()}${recovery}` }
}

/**
 * An allow list that answers from `origins` alone, for tests that are not
 * about how the list is read (`utils/site-allow-list.test.ts` is).
 */
export function allowingSites(...origins: string[]): SiteAllowList {
  return {
    check: async (origin) =>
      origins.includes(origin)
        ? { allowed: true }
        : {
            allowed: false,
            reason: "not-listed",
            message: `${origin} is not on the test allow list.`,
          },
  }
}
