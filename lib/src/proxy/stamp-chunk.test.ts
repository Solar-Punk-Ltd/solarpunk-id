// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest"
import { PrivateKey, Signature } from "@ethersphere/bee-js"
import { Binary } from "cafe-utility"
import { calculateChunkAddress } from "../chunk"
import {
  accountInternalOwners,
  prepareChunkToStamp,
  type InternalOwnerKeys,
} from "./stamp-chunk"
import {
  ACT_SHARING_LABEL,
  BACKUP_KEY_LABEL,
  POSTAGE_SIGNER_LABEL,
  SWARM_ENCRYPTION_LABEL,
  deriveSecretSync,
} from "../utils/key-derivation"

const APP_SECRET = "11".repeat(32)
const SITE_KEY = "22".repeat(32)
const DERIVATION_KEY = "33".repeat(32)
const IMPORTED_POSTAGE_SIGNER_KEY = "44".repeat(32)
const ACCOUNT_ADDRESS = "55".repeat(20)
const IDENTIFIER = "66".repeat(32)
const SPAN_SIZE = 8
const MAX_PAYLOAD = 4096

const KEYS: InternalOwnerKeys = {
  accountAddress: ACCOUNT_ADDRESS,
  derivationKey: DERIVATION_KEY,
  postageSignerKey: IMPORTED_POSTAGE_SIGNER_KEY,
}

function spanAndPayload(payload: Uint8Array): Uint8Array {
  const span = new Uint8Array(SPAN_SIZE)
  new DataView(span.buffer).setBigUint64(0, BigInt(payload.length), true)
  return Binary.concatBytes(span, payload)
}

const DATA = spanAndPayload(new TextEncoder().encode("hello swarm"))

const addressOf = (key: string) =>
  new PrivateKey(key).publicKey().address().toHex()

const derived = (parent: string, label: string) =>
  deriveSecretSync(parent, label)

const prepare = (chunk: Parameters<typeof prepareChunkToStamp>[0]) =>
  prepareChunkToStamp(chunk, {
    appSecret: APP_SECRET,
    internalOwners: accountInternalOwners(KEYS),
  })

describe("prepareChunkToStamp, a content chunk", () => {
  it("computes the content address itself", () => {
    const prepared = prepare({ kind: "content", data: DATA })

    expect(Binary.uint8ArrayToHex(prepared.address)).toBe(
      calculateChunkAddress(DATA).toHex(),
    )
    expect(prepared.owner).toBeUndefined()
    expect(prepared.signature).toBeUndefined()
  })

  it("refuses data shorter than a span or longer than a span and a full payload", () => {
    expect(() =>
      prepare({ kind: "content", data: new Uint8Array(SPAN_SIZE - 1) }),
    ).toThrow(expect.objectContaining({ code: "invalid-request" }))
    expect(() =>
      prepare({
        kind: "content",
        data: new Uint8Array(SPAN_SIZE + MAX_PAYLOAD + 1),
      }),
    ).toThrow(expect.objectContaining({ code: "invalid-request" }))
  })
})

describe("prepareChunkToStamp, a single-owner chunk", () => {
  const socAddress = (owner: string) =>
    Binary.uint8ArrayToHex(
      Binary.keccak256(
        Binary.concatBytes(
          Binary.hexToUint8Array(IDENTIFIER),
          Binary.hexToUint8Array(owner),
        ),
      ),
    )

  function expectSignedBy(
    prepared: ReturnType<typeof prepareChunkToStamp>,
    key: string,
  ): void {
    const owner = addressOf(key)
    expect(prepared.owner?.toHex()).toBe(owner)
    expect(Binary.uint8ArrayToHex(prepared.address)).toBe(socAddress(owner))
    const digest = Binary.concatBytes(
      Binary.hexToUint8Array(IDENTIFIER),
      calculateChunkAddress(DATA).toUint8Array(),
    )
    const signature = new Signature(prepared.signature!.toUint8Array())
    expect(signature.recoverPublicKey(digest).address().toHex()).toBe(owner)
  }

  it("signs with the site's own app secret and computes the SOC address", () => {
    const prepared = prepare({
      kind: "soc",
      identifier: IDENTIFIER,
      data: DATA,
      signer: "app",
    })

    expectSignedBy(prepared, APP_SECRET)
  })

  it("signs with a key the site supplies, the GSOC inbox case", () => {
    const prepared = prepare({
      kind: "soc",
      identifier: IDENTIFIER,
      data: DATA,
      signer: { privateKey: SITE_KEY },
    })

    expectSignedBy(prepared, SITE_KEY)
  })

  const swarmEncryptionKey = derived(DERIVATION_KEY, SWARM_ENCRYPTION_LABEL)
  const INTERNAL_KEYS = [
    {
      name: "the backup signer that owns the lock, state, device-state and roster chunks",
      key: derived(swarmEncryptionKey, BACKUP_KEY_LABEL),
    },
    {
      name: "the derived postage signer",
      key: derived(DERIVATION_KEY, POSTAGE_SIGNER_LABEL),
    },
    { name: "the stamp's own signer", key: IMPORTED_POSTAGE_SIGNER_KEY },
    {
      name: "the account-wide ACT sharing key",
      key: derived(DERIVATION_KEY, ACT_SHARING_LABEL),
    },
    { name: "the derivation key", key: DERIVATION_KEY },
    { name: "the Swarm encryption key", key: swarmEncryptionKey },
  ]

  it.each(INTERNAL_KEYS)("refuses an owner that is $name", ({ key }) => {
    expect(() =>
      prepare({
        kind: "soc",
        identifier: IDENTIFIER,
        data: DATA,
        signer: { privateKey: key },
      }),
    ).toThrow(expect.objectContaining({ code: "invalid-request" }))
  })

  it("counts the account's own address among the internal owners", () => {
    expect(accountInternalOwners(KEYS).has(ACCOUNT_ADDRESS)).toBe(true)
  })

  it("refuses an app secret that is itself an internal key", () => {
    expect(() =>
      prepareChunkToStamp(
        { kind: "soc", identifier: IDENTIFIER, data: DATA, signer: "app" },
        {
          appSecret: DERIVATION_KEY,
          internalOwners: accountInternalOwners(KEYS),
        },
      ),
    ).toThrow(expect.objectContaining({ code: "invalid-request" }))
  })
})
