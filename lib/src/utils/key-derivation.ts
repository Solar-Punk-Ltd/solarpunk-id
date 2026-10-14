// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Swarm Identity - Key Derivation Utilities
 *
 * Every derived key is one HMAC-SHA256 of a parent key under a label:
 * `deriveSecret(parentKey, label)`. The labels below are the fixed points of
 * the derivation tree (docs-site: Key Derivation); an app secret uses the
 * app's origin as its label instead.
 */

import { PrivateKey } from "@ethersphere/bee-js"
import { secp256k1 } from "@noble/curves/secp256k1"
import { hmac } from "@noble/hashes/hmac"
import { sha256 } from "@noble/hashes/sha256"
import { hexToUint8Array, uint8ArrayToHex } from "./hex"

/** Master key → the stored derivation key */
export const DERIVATION_KEY_LABEL = "derivation-key"
/** Derivation key → the Swarm encryption key */
export const SWARM_ENCRYPTION_LABEL = "swarm-encryption"
/** Derivation key → the postage signer that stamps the account's uploads */
export const POSTAGE_SIGNER_LABEL = "postage-signer"
/** Swarm encryption key → the backup signer that owns every feed */
export const BACKUP_KEY_LABEL = "backup-key"
/** Derivation key → the account-wide ACT sharing key (#519) */
export const ACT_SHARING_LABEL = "act-sharing"
/**
 * App secret → the site's chat key, the key a site's chat signs with and whose
 * address the site's chat binding names (docs/Chat-Binding.md).
 *
 * The version in the label is how a leaked chat key is replaced: a new label
 * gives every account a new chat key on every site, the identity UI then signs
 * a fresh binding at the next connect because the kept one names the old
 * address, and readers stop accepting the old key because no binding names it.
 */
export const CHAT_KEY_LABEL = "swarm-id chat key v1"

/** How many numbered labels `firstValidPrivateKey` tries before giving up. */
const MAX_PRIVATE_KEY_ATTEMPTS = 16

/**
 * Derive a secret from a parent key under a label, with Web Crypto.
 *
 * HMAC-SHA256: deterministic, so the same parent key and label always give
 * the same secret. `deriveSecretSync` is the same function without the
 * `await`, for a caller that cannot have one; the test pins the two equal.
 *
 * @param parentKey - The key to derive from (hex string)
 * @param label - What the derived key is for: one of the labels above, or the
 *   app's origin (e.g. "https://swarm-app.local:8080") for a per-app secret
 * @returns The derived secret as a hex string
 */
export async function deriveSecret(
  parentKey: string,
  label: string,
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    hexToUint8Array(parentKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(label),
  )
  return uint8ArrayToHex(new Uint8Array(signature))
}

/**
 * `deriveSecret` without the `await`: the same HMAC-SHA256 computed with
 * `@noble/hashes`, for a caller that cannot await — `buildConnectionInfo` in
 * the proxy builds ConnectionInfo synchronously (#692). Byte-identical to the
 * Web Crypto path, which the test pins.
 */
export function deriveSecretSync(parentKey: string, label: string): string {
  return uint8ArrayToHex(
    hmac(sha256, hexToUint8Array(parentKey), new TextEncoder().encode(label)),
  )
}

/**
 * Derive an AES-GCM-256 key from `secretHex` under `label`.
 *
 * The three steps — HMAC to a fresh secret, hex to bytes, import as AES-GCM —
 * are one pipeline. Non-extractable and encrypt/decrypt only, which is the
 * part worth stating once (#590). The bus envelope (`deriveBusContext`) is the
 * live caller; the `.swarmid` file key is the identity UI's, derived by HKDF
 * from the recovery-phrase entropy, and never comes through here.
 */
export async function deriveAesGcmKey(
  secretHex: string,
  label: string,
): Promise<CryptoKey> {
  const keyHex = await deriveSecret(secretHex, label)
  return crypto.subtle.importKey(
    "raw",
    hexToUint8Array(keyHex),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  )
}

/**
 * Derive account derivation key from account master key
 *
 * A generic 32-byte root key stored on the account, used for deterministically
 * deriving further keys (e.g. swarmEncryptionKey) without re-authentication.
 *
 * @param accountMasterKey - Account master key (hex string)
 * @returns 32-byte derivation key (as hex string)
 */
export async function deriveAccountDerivationKey(
  accountMasterKey: string,
): Promise<string> {
  return deriveSecret(accountMasterKey, DERIVATION_KEY_LABEL)
}

/**
 * Derive Swarm encryption key from account derivation key
 *
 * Used for encrypting account snapshot data before upload to Swarm.
 * Derived from the stored derivationKey rather than the master key directly.
 *
 * @param derivationKey - Account derivation key (hex string)
 * @returns 32-byte encryption key (as hex string)
 */
export async function deriveSwarmEncryptionKey(
  derivationKey: string,
): Promise<string> {
  return deriveSecret(derivationKey, SWARM_ENCRYPTION_LABEL)
}

/**
 * Derive the account-level postage batch signer key from the account derivation
 * key. Used as the PrivateKey for signing chunks uploaded with a postage batch.
 *
 * @param derivationKey - Account derivation key (hex string)
 * @returns 32-byte signer key (as hex string)
 */
export async function derivePostageSignerKey(
  derivationKey: string,
): Promise<string> {
  return deriveSecret(derivationKey, POSTAGE_SIGNER_LABEL)
}

/**
 * `derivePostageSignerKey` without the `await`, for the proxy's ConnectionInfo
 * (#815): the signer's address is what an app buys a batch for.
 */
export function derivePostageSignerKeySync(derivationKey: string): string {
  return deriveSecretSync(derivationKey, POSTAGE_SIGNER_LABEL)
}

/**
 * The account-wide ACT key (#519): what other people grant access to when they
 * mean the person rather than one of their apps. Derived from the derivation
 * key, so every app origin and every device of the account arrives at the same
 * key — and the master key still never leaves the identity UI. Its public half
 * is `identity.sharingPublicKey`. Synchronous because ConnectionInfo is built
 * without awaiting.
 */
export function deriveSharingKey(derivationKey: string): {
  secret: Uint8Array
  publicKey: string
} {
  const secret = hexToUint8Array(
    deriveSecretSync(derivationKey, ACT_SHARING_LABEL),
  )
  return {
    secret,
    publicKey: new PrivateKey(secret).publicKey().toCompressedHex(),
  }
}

/**
 * The first output of `derive` that is a valid secp256k1 private key, a
 * number from 1 to n - 1 where n is the curve order. It asks under `label`
 * first, then under `label/1`, `label/2` and so on. An HMAC-SHA256 output
 * misses that range with a chance of about 2^-128, so in practice the first
 * answer is the key, but the rule is fixed so every device agrees even then.
 *
 * @throws if no candidate within the attempt bound is a key, which only a
 *   broken `derive` can cause
 */
export function firstValidPrivateKey(
  derive: (label: string) => Uint8Array,
  label: string,
): Uint8Array {
  for (let attempt = 0; attempt < MAX_PRIVATE_KEY_ATTEMPTS; attempt++) {
    const candidate = derive(attempt === 0 ? label : `${label}/${attempt}`)
    if (secp256k1.utils.isValidPrivateKey(candidate)) {
      return candidate
    }
  }
  throw new Error(
    `No valid secp256k1 private key under "${label}" in ${MAX_PRIVATE_KEY_ATTEMPTS} attempts.`,
  )
}

/**
 * The site's chat key, from the site's app secret
 * (`deriveSecret(masterKey, origin)`): `HMAC(appSecret, CHAT_KEY_LABEL)`, the
 * same derivation `deriveAppSecret` runs for an app's own label, held to a
 * valid secp256k1 key by `firstValidPrivateKey`. It depends on the account and
 * the site alone, so every device of the account derives the same key.
 * Synchronous because ConnectionInfo and the binding are built without
 * awaiting.
 *
 * @param appSecret - the site's app secret (bare hex)
 * @returns the 32-byte chat private key
 */
export function deriveChatKey(appSecret: string): Uint8Array {
  return firstValidPrivateKey(
    (label) => hexToUint8Array(deriveSecretSync(appSecret, label)),
    CHAT_KEY_LABEL,
  )
}

// Export utility functions for testing
export const utils = {
  hexToUint8Array,
  uint8ArrayToHex,
}
