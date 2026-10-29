// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Reading an ENS text record over an Ethereum mainnet JSON-RPC endpoint the
 * caller names, through ENS's Universal Resolver, which finds a name's
 * resolver in ENSv2 as well as in the old registry. A name migrated to ENSv2
 * has no resolver left in the old registry, so asking that registry alone
 * reads it as having no record. Never through a Swarm gateway, since what ENS
 * says decides who a page trusts, and a gateway that serves this code must not
 * be able to say it.
 *
 * Only on-chain answers are read. A resolver that answers through CCIP-read
 * (EIP-3668) makes the Universal Resolver revert, which reads as no record.
 */

import { keccak_256 } from "@noble/hashes/sha3"
import { hexToUint8Array, uint8ArrayToHex } from "./hex"
import { jsonRpcCall } from "./json-rpc"

/** ENS's Universal Resolver on Ethereum mainnet, the deployment that reads ENSv2 names. */
export const ENS_UNIVERSAL_RESOLVER_ADDRESS =
  "0xeeeeeeee14d718c2b47d9923deab1335e144eeee"

/**
 * The longest chain answer read by default, in bytes. A text record of a
 * thousand sites is a few tens of kilobytes, and an answer of millions of
 * bytes overflows the stack of the hex test, so anything longer is refused
 * before it is read.
 */
const MAX_CHAIN_ANSWER_BYTES = 128 * 1024

const WORD_BYTES = 32
const SELECTOR_BYTES = 4
const HEX_RADIX = 16
const HEX_PREFIX_LENGTH = 2

const RESOLVE_SELECTOR = selector("resolve(bytes,bytes)")
const TEXT_SELECTOR = selector("text(bytes32,string)")
/** The longest label DNS wire format can carry, its length held in one byte. */
const MAX_LABEL_BYTES = 255

/** How long each read may take. */
export interface EnsReadOptions {
  timeoutMs: number
}

/** The 4-byte function selector of a Solidity signature, bare hex. */
function selector(signature: string): string {
  return uint8ArrayToHex(
    keccak_256(new TextEncoder().encode(signature)).slice(0, SELECTOR_BYTES),
  )
}

/** The EIP-137 namehash of a name already in its normalized form. */
export function ensNamehash(name: string): string {
  let node: Uint8Array = new Uint8Array(WORD_BYTES)
  const labels = name === "" ? [] : name.split(".")
  for (const label of labels.reverse()) {
    const joined = new Uint8Array(WORD_BYTES * 2)
    joined.set(node)
    joined.set(keccak_256(new TextEncoder().encode(label)), WORD_BYTES)
    node = keccak_256(joined)
  }
  return `0x${uint8ArrayToHex(node)}`
}

function word(value: number): string {
  return value.toString(HEX_RADIX).padStart(WORD_BYTES * 2, "0")
}

/** `name` in DNS wire format (ENSIP-10): each label behind its length, then a zero byte. */
export function dnsEncodeName(name: string): Uint8Array {
  const labels = name === "" ? [] : name.split(".")
  const parts = labels.map((label) => {
    const bytes = new TextEncoder().encode(label)
    if (bytes.length === 0 || bytes.length > MAX_LABEL_BYTES) {
      throw new Error(`${name} has a label DNS cannot carry.`)
    }
    return [bytes.length, ...bytes]
  })
  return new Uint8Array([...parts.flat(), 0])
}

/** ABI encoding of one dynamic `bytes` value: its length word, then the bytes padded to whole words. */
function encodeBytes(hex: string): string {
  const paddedLength = Math.ceil(hex.length / (WORD_BYTES * 2)) * WORD_BYTES * 2
  return `${word(hex.length / 2)}${hex.padEnd(paddedLength, "0")}`
}

/** `resolve(bytes name, bytes data)`: the Universal Resolver asks the name's resolver for `call`. */
function encodeResolveCall(name: string, call: string): string {
  const nameArgument = encodeBytes(uint8ArrayToHex(dnsEncodeName(name)))
  const callArgument = encodeBytes(call.slice(HEX_PREFIX_LENGTH))
  const firstOffset = WORD_BYTES * 2
  const secondOffset = firstOffset + nameArgument.length / 2
  return `0x${RESOLVE_SELECTOR}${word(firstOffset)}${word(secondOffset)}${nameArgument}${callArgument}`
}

function encodeTextCall(node: string, key: string): string {
  const keyBytes = new TextEncoder().encode(key)
  const keyHex = uint8ArrayToHex(keyBytes)
  const paddedLength = Math.ceil(keyBytes.length / WORD_BYTES) * WORD_BYTES * 2
  const head = word(WORD_BYTES * 2)
  return `0x${TEXT_SELECTOR}${node.slice(2)}${head}${word(keyBytes.length)}${keyHex.padEnd(paddedLength, "0")}`
}

function resultBytes(result: unknown, subject: string): Uint8Array {
  if (
    typeof result === "string" &&
    result.length > HEX_PREFIX_LENGTH + MAX_CHAIN_ANSWER_BYTES * 2
  ) {
    throw new Error(
      `${subject} answered ${result.length} characters, longer than ${MAX_CHAIN_ANSWER_BYTES} bytes of hex data.`,
    )
  }
  if (typeof result !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(result)) {
    throw new Error(`${subject} answered something that is not hex data.`)
  }
  return hexToUint8Array(result.slice(2))
}

function readWord(bytes: Uint8Array, offset: number): bigint {
  if (offset + WORD_BYTES > bytes.length) {
    throw new Error("The answer ends inside a word.")
  }
  return BigInt(
    `0x${uint8ArrayToHex(bytes.slice(offset, offset + WORD_BYTES))}`,
  )
}

/**
 * The resolver's own answer inside the Universal Resolver's `(bytes, address)`
 * return value, as hex data to decode again.
 * @throws on an offset or a length past the answer's end.
 */
function decodeResolvedBytes(result: unknown, subject: string): string {
  const bytes = resultBytes(result, subject)
  const offset = readWord(bytes, 0)
  if (offset > BigInt(bytes.length)) {
    throw new Error(`${subject} answered an offset past its end.`)
  }
  const start = Number(offset)
  const length = readWord(bytes, start)
  const end = BigInt(start + WORD_BYTES) + length
  if (end > BigInt(bytes.length)) {
    throw new Error(`${subject} answered bytes longer than its answer.`)
  }
  return `0x${uint8ArrayToHex(bytes.slice(start + WORD_BYTES, Number(end)))}`
}

/**
 * One ABI-encoded `string` return value, strict UTF-8.
 * @throws on an offset or a length past the answer's end, or invalid UTF-8.
 */
function decodeString(result: unknown, subject: string): string {
  const bytes = resultBytes(result, subject)
  const offset = readWord(bytes, 0)
  if (offset > BigInt(bytes.length)) {
    throw new Error(`${subject} answered a string offset past its end.`)
  }
  const start = Number(offset)
  const length = readWord(bytes, start)
  const end = BigInt(start + WORD_BYTES) + length
  if (end > BigInt(bytes.length)) {
    throw new Error(`${subject} answered a string longer than its answer.`)
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.slice(start + WORD_BYTES, Number(end)),
  )
}

/**
 * What a JSON-RPC envelope adds around an answer's hex: the `jsonrpc`, `id`
 * and `result` members and the `0x`, with room to spare.
 */
const ENVELOPE_ALLOWANCE_BYTES = 256

/** The response body the longest answer read arrives in, at most. */
const MAX_BODY_BYTES = MAX_CHAIN_ANSWER_BYTES * 2 + ENVELOPE_ALLOWANCE_BYTES

async function ethCall(
  rpcUrl: string,
  to: string,
  data: string,
  options: EnsReadOptions,
): Promise<unknown> {
  return jsonRpcCall(rpcUrl, "eth_call", [{ to, data }, "latest"], {
    timeoutMs: options.timeoutMs,
    maxBodyBytes: MAX_BODY_BYTES,
  })
}

/**
 * The text record `key` of `name`, through the Universal Resolver.
 * @throws when the name has no resolver, which the Universal Resolver answers
 *         with a revert, or when the answers do not decode.
 */
export async function readEnsText(
  rpcUrl: string,
  name: string,
  key: string,
  options: EnsReadOptions,
): Promise<string> {
  const textCall = encodeTextCall(ensNamehash(name), key)
  const resolved = decodeResolvedBytes(
    await ethCall(
      rpcUrl,
      ENS_UNIVERSAL_RESOLVER_ADDRESS,
      encodeResolveCall(name, textCall),
      options,
    ),
    "The Universal Resolver",
  )
  return decodeString(resolved, "The resolver")
}
