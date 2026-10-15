// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * EIP-191 `personal_sign` over plain text, for the statements Swarm ID signs
 * and readers check (docs/Chat-Binding.md, docs/Wallet-Link.md). A signature
 * here is `0x` + r ‖ s ‖ v, 65 bytes, with v 27 or 28 and s in the lower half
 * of the curve order, which is what any Ethereum library recovers the same way.
 */

import { secp256k1 } from "@noble/curves/secp256k1"
import { keccak_256 } from "@noble/hashes/sha3"
import { hexToUint8Array, uint8ArrayToHex } from "./hex"

const PERSONAL_MESSAGE_PREFIX = "\x19Ethereum Signed Message:\n"
/** EIP-191 signatures carry the recovery id offset by this. */
const RECOVERY_OFFSET = 27
const SIGNATURE_HEX_PATTERN = /^0x[0-9a-fA-F]{130}$/
const COMPACT_SIGNATURE_HEX_LENGTH = 128
const ADDRESS_BYTES = 20
const UNCOMPRESSED_PREFIX_BYTES = 1
const HEX_RADIX = 16

/** The EIP-191 version 0x45 digest `personal_sign` signs. */
function personalMessageHash(message: string): Uint8Array {
  const body = new TextEncoder().encode(message)
  const prefix = new TextEncoder().encode(
    `${PERSONAL_MESSAGE_PREFIX}${body.length}`,
  )
  const whole = new Uint8Array(prefix.length + body.length)
  whole.set(prefix)
  whole.set(body, prefix.length)
  return keccak_256(whole)
}

function addressOfPublicKey(uncompressed: Uint8Array): string {
  const hash = keccak_256(uncompressed.slice(UNCOMPRESSED_PREFIX_BYTES))
  return `0x${uint8ArrayToHex(hash.slice(-ADDRESS_BYTES))}`
}

/**
 * Sign `message` as `personal_sign` does.
 *
 * @param privateKey - bare hex, 32 bytes
 * @returns `0x` + r ‖ s ‖ v, v 27 or 28, s low
 */
export function personalSign(message: string, privateKey: string): string {
  const signed = secp256k1.sign(
    personalMessageHash(message),
    hexToUint8Array(privateKey),
  )
  const recovery = (signed.recovery + RECOVERY_OFFSET).toString(HEX_RADIX)
  return `0x${signed.toCompactHex()}${recovery}`
}

/**
 * The address that signed `message`, `0x` + 40 lower-case hex characters.
 * A valid signature over a changed message recovers SOME address, so a caller
 * always compares the result with the signer it expects.
 *
 * @param subject - how errors name the signature, e.g. "Chat binding signature"
 * @throws on a signature that is not 65 bytes of 0x hex, has v other than 27
 *   or 28, has a high s, or does not recover a public key.
 */
export function recoverPersonalSigner(
  message: string,
  signature: string,
  subject: string,
): string {
  if (!SIGNATURE_HEX_PATTERN.test(signature)) {
    throw new Error(`${subject} is not 65 bytes of 0x hex.`)
  }
  const compact = signature.slice(2, 2 + COMPACT_SIGNATURE_HEX_LENGTH)
  const recovery =
    parseInt(signature.slice(2 + COMPACT_SIGNATURE_HEX_LENGTH), HEX_RADIX) -
    RECOVERY_OFFSET
  if (recovery !== 0 && recovery !== 1) {
    throw new Error(`${subject} has a recovery byte other than 27 or 28.`)
  }
  try {
    const parsed = secp256k1.Signature.fromCompact(compact)
    if (parsed.hasHighS()) {
      throw new Error("high s")
    }
    const point = parsed
      .addRecoveryBit(recovery)
      .recoverPublicKey(personalMessageHash(message))
    return addressOfPublicKey(point.toRawBytes(false))
  } catch (error) {
    throw new Error(`${subject} does not recover a signer: ${String(error)}`)
  }
}
