// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Stamp and return: the frame stamps a chunk with the account's own stamp
 * and hands the stamp back, so the app sends the chunk through the Swarm
 * access it chose. The app sends the whole chunk and the frame computes its
 * address, so a stamp is only ever issued for bytes the frame has seen, and a
 * single-owner chunk is only ever one the frame signed in the same request.
 */

import { EthAddress, PrivateKey } from "@ethersphere/bee-js"
import type { EnvelopeWithBatchId, Signature } from "@ethersphere/bee-js"
import { convertEnvelopeToMarshaledStamp } from "@ethersphere/core-sdk"
import { Binary } from "cafe-utility"
import { SwarmIdError } from "../errors"
import {
  calculateChunkAddress,
  MAX_PAYLOAD_SIZE,
  MIN_PAYLOAD_SIZE,
  SPAN_SIZE,
} from "../chunk"
import {
  ACT_SHARING_LABEL,
  BACKUP_KEY_LABEL,
  POSTAGE_SIGNER_LABEL,
  SWARM_ENCRYPTION_LABEL,
  deriveSecretSync,
} from "../utils/key-derivation"
import { hexToUint8Array } from "../utils/hex"
import type { StampChunkRequest } from "../types"

/** What the frame stamps: the address it computed, and a SOC's owner and signature */
export interface ChunkToStamp {
  address: Uint8Array
  owner?: EthAddress
  signature?: Signature
}

/** The account keys the internal owners are derived from */
export interface InternalOwnerKeys {
  /** The account's own address */
  accountAddress: string
  derivationKey: string
  /** The resolved stamp's signer, which an imported stamp may not derive */
  postageSignerKey?: string
}

/**
 * Every owner address the account's own chunks may carry, lowercase hex. A
 * single-owner chunk owned by one of these is refused, so an app can never be
 * handed a stamp for the account's lock, partition state, device state or
 * roster chunks (owned by the backup signer), nor sign as any other key the
 * frame holds for the account.
 */
export function accountInternalOwners(keys: InternalOwnerKeys): Set<string> {
  const { derivationKey } = keys
  const swarmEncryptionKey = deriveSecretSync(
    derivationKey,
    SWARM_ENCRYPTION_LABEL,
  )
  const internalKeys = [
    derivationKey,
    swarmEncryptionKey,
    deriveSecretSync(swarmEncryptionKey, BACKUP_KEY_LABEL),
    deriveSecretSync(derivationKey, POSTAGE_SIGNER_LABEL),
    deriveSecretSync(derivationKey, ACT_SHARING_LABEL),
  ]
  if (keys.postageSignerKey) internalKeys.push(keys.postageSignerKey)

  const owners = new Set(
    internalKeys.map((key) => ownerOf(new PrivateKey(key))),
  )
  owners.add(new EthAddress(keys.accountAddress).toHex().toLowerCase())
  return owners
}

function ownerOf(key: PrivateKey): string {
  return key.publicKey().address().toHex().toLowerCase()
}

function requireChunkData(data: Uint8Array): void {
  const min = SPAN_SIZE + MIN_PAYLOAD_SIZE
  const max = SPAN_SIZE + MAX_PAYLOAD_SIZE
  if (data.length < min || data.length > max) {
    throw new SwarmIdError(
      "invalid-request",
      `Invalid chunk length: ${data.length} bytes (expected span plus payload, ${min} to ${max})`,
    )
  }
}

/**
 * Compute the address of the chunk to stamp, and sign it when it is a
 * single-owner chunk.
 *
 * @throws SwarmIdError `invalid-request` for a chunk of the wrong length, or a
 *   single-owner chunk whose owner is one of `internalOwners`
 */
export function prepareChunkToStamp(
  chunk: StampChunkRequest,
  context: { appSecret: string; internalOwners: ReadonlySet<string> },
): ChunkToStamp {
  requireChunkData(chunk.data)
  const contentAddress = calculateChunkAddress(chunk.data).toUint8Array()
  if (chunk.kind === "content") {
    return { address: contentAddress }
  }

  const signer = new PrivateKey(
    chunk.signer === "app" ? context.appSecret : chunk.signer.privateKey,
  )
  if (context.internalOwners.has(ownerOf(signer))) {
    throw new SwarmIdError(
      "invalid-request",
      "This single-owner chunk would be owned by one of the account's own keys, which never signs for an app.",
    )
  }

  const identifier = hexToUint8Array(chunk.identifier)
  const owner = signer.publicKey().address()
  return {
    address: Binary.keccak256(
      Binary.concatBytes(identifier, owner.toUint8Array()),
    ),
    owner,
    signature: signer.sign(Binary.concatBytes(identifier, contentAddress)),
  }
}

/** A stamp in the form Bee's `swarm-postage-stamp` upload header takes */
export function marshalStamp(envelope: EnvelopeWithBatchId): string {
  return convertEnvelopeToMarshaledStamp(envelope).toHex()
}
