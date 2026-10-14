// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { PrivateKey } from "@ethersphere/bee-js"
import { secp256k1 } from "@noble/curves/secp256k1"
import { describe, expect, it } from "vitest"
import {
  ACT_SHARING_LABEL,
  BACKUP_KEY_LABEL,
  CHAT_KEY_LABEL,
  DERIVATION_KEY_LABEL,
  POSTAGE_SIGNER_LABEL,
  SWARM_ENCRYPTION_LABEL,
  deriveChatKey,
  deriveSecret,
  deriveSecretSync,
  deriveSharingKey,
  derivePostageSignerKey,
  derivePostageSignerKeySync,
  firstValidPrivateKey,
} from "./key-derivation"
import { publicKeyFromPrivate, compressPublicKey } from "../proxy/act/crypto"
import { hexToUint8Array, uint8ArrayToHex } from "./hex"

const PARENT_KEY = "ab".repeat(32)

// Output equivalence is the whole game (#692): stored derivation keys, app
// secrets, bus topics and feed owners must not move. The Web Crypto path is
// what every stored key came from, so the noble path is held to it, and both
// to a literal so neither can drift without this test saying so.
describe("deriveSecretSync", () => {
  it("is byte-identical to deriveSecret for every label of the tree", async () => {
    for (const label of [
      DERIVATION_KEY_LABEL,
      SWARM_ENCRYPTION_LABEL,
      POSTAGE_SIGNER_LABEL,
      BACKUP_KEY_LABEL,
      ACT_SHARING_LABEL,
      "https://swarm-app.local:8080",
    ]) {
      expect(deriveSecretSync(PARENT_KEY, label)).toBe(
        await deriveSecret(PARENT_KEY, label),
      )
    }
  })

  it("matches the vector Web Crypto gave for a fixed key and label", () => {
    expect(deriveSecretSync(PARENT_KEY, ACT_SHARING_LABEL)).toBe(
      "0840849cb37e59e129a59eaf61ea8eb36c6a53914c6d91df575744e1775eedf6",
    )
    expect(deriveSecretSync(PARENT_KEY, POSTAGE_SIGNER_LABEL)).toBe(
      "12e8a6eec78c11c5ed44398aa3449119eabf89e72a01eec9662e230c2f5289d4",
    )
  })
})

describe("deriveSharingKey (#519)", () => {
  it("is a pure function of the derivation key", () => {
    const a = deriveSharingKey(PARENT_KEY)
    const b = deriveSharingKey(PARENT_KEY)
    expect(a.publicKey).toBe(b.publicKey)
    expect(a.secret).toEqual(b.secret)
    expect(deriveSharingKey("cd".repeat(32)).publicKey).not.toBe(a.publicKey)
  })

  it("is deriveSecret under the act-sharing label", async () => {
    const { secret } = deriveSharingKey(PARENT_KEY)
    expect(uint8ArrayToHex(secret)).toBe(
      await deriveSecret(PARENT_KEY, ACT_SHARING_LABEL),
    )
  })

  it("reports the public key the ACT module derives from the secret", () => {
    const { secret, publicKey } = deriveSharingKey(PARENT_KEY)
    const { x, y } = publicKeyFromPrivate(secret)
    expect(publicKey).toBe(uint8ArrayToHex(compressPublicKey(x, y)))
  })
})

describe("derivePostageSignerKeySync", () => {
  it("is derivePostageSignerKey without the await", async () => {
    expect(derivePostageSignerKeySync(PARENT_KEY)).toBe(
      await derivePostageSignerKey(PARENT_KEY),
    )
  })
})

// The chat key is what a site's chat signs with and what its chat binding
// names (docs/Chat-Binding.md). Every device that holds the account must
// arrive at the same one, so it depends on the account and the site alone.
describe("deriveChatKey", () => {
  const SITE = "https://viewer.example.com"
  const appSecretFor = (site: string, accountKey = PARENT_KEY) =>
    deriveSecretSync(accountKey, site)
  const chatKeyHex = (appSecret: string) =>
    uint8ArrayToHex(deriveChatKey(appSecret))

  it("gives the same key for the same account and site", () => {
    expect(chatKeyHex(appSecretFor(SITE))).toBe(chatKeyHex(appSecretFor(SITE)))
  })

  it("gives another site another key", () => {
    expect(chatKeyHex(appSecretFor(SITE))).not.toBe(
      chatKeyHex(appSecretFor("https://other.example.com")),
    )
  })

  it("gives another account another key on the same site", () => {
    expect(chatKeyHex(appSecretFor(SITE))).not.toBe(
      chatKeyHex(appSecretFor(SITE, "cd".repeat(32))),
    )
  })

  it("is not the app secret itself", () => {
    expect(chatKeyHex(appSecretFor(SITE))).not.toBe(appSecretFor(SITE))
  })

  it("is deriveSecret of the app secret under the chat key label", async () => {
    expect(chatKeyHex(appSecretFor(SITE))).toBe(
      await deriveSecret(appSecretFor(SITE), CHAT_KEY_LABEL),
    )
  })

  // Pinned to a literal as well as to deriveSecret, so neither the label nor
  // the derivation can move without this test saying so. The pin is the key's
  // address, which is public, rather than the key.
  it("matches the pinned address for a fixed app secret", () => {
    expect(
      new PrivateKey(deriveChatKey("11".repeat(32)))
        .publicKey()
        .address()
        .toHex(),
    ).toBe(PINNED_CHAT_ADDRESS)
  })
})

// The key under it is HMAC-SHA256 of "swarm-id chat key v1" keyed by 0x11
// repeated 32 times, which openssl computes to the same bytes.
const PINNED_CHAT_ADDRESS = "dfbdc2dad9a2fa8a79c32efbaa5e02d4d2bbc9c0"

describe("firstValidPrivateKey", () => {
  const KEY_BYTES = 32
  const ZERO = new Uint8Array(KEY_BYTES)
  const CURVE_ORDER = hexToUint8Array(
    secp256k1.CURVE.n.toString(16).padStart(KEY_BYTES * 2, "0"),
  )
  const VALID = hexToUint8Array("22".repeat(KEY_BYTES))

  function fakeDerive(outputs: Uint8Array[]) {
    const asked: string[] = []
    const derive = (label: string): Uint8Array => {
      asked.push(label)
      return outputs[asked.length - 1]
    }
    return { asked, derive }
  }

  it("takes the first candidate when it is a valid secp256k1 key", () => {
    const { asked, derive } = fakeDerive([VALID])

    expect(firstValidPrivateKey(derive, "label v1")).toEqual(VALID)
    expect(asked).toEqual(["label v1"])
  })

  it("derives again under a numbered label while the bytes are zero or not below the curve order", () => {
    const { asked, derive } = fakeDerive([ZERO, CURVE_ORDER, VALID])

    expect(firstValidPrivateKey(derive, "label v1")).toEqual(VALID)
    expect(asked).toEqual(["label v1", "label v1/1", "label v1/2"])
  })

  it("throws rather than loop forever when no candidate is a key", () => {
    expect(() => firstValidPrivateKey(() => ZERO, "label v1")).toThrow(
      /valid secp256k1/,
    )
  })
})
