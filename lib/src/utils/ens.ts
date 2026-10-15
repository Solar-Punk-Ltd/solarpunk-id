// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Reading ENS records over an Ethereum mainnet JSON-RPC endpoint the caller
 * names: the registry's resolver for a name, then one record from that
 * resolver. Never through a Swarm gateway, since what ENS says decides who a
 * page trusts, and a gateway that serves this code must not be able to say it.
 *
 * Only on-chain resolvers are read. A name whose resolver answers through
 * CCIP-read (EIP-3668) or a wildcard (ENSIP-10) reads as having no record.
 */

import { keccak_256 } from "@noble/hashes/sha3"
import { hexToUint8Array, uint8ArrayToHex } from "./hex"
import { jsonRpcCall } from "./json-rpc"

/** The ENS registry, at the same address on every chain ENS is deployed to. */
export const ENS_REGISTRY_ADDRESS = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e"

/**
 * The longest chain answer read by default, in bytes. A text record of a
 * thousand sites is a few tens of kilobytes, and an answer of millions of
 * bytes overflows the stack of the hex test, so anything longer is refused
 * before it is read.
 */
export const MAX_CHAIN_ANSWER_BYTES = 128 * 1024

const WORD_BYTES = 32
const ADDRESS_BYTES = 20
const SELECTOR_BYTES = 4
const HEX_RADIX = 16
const HEX_PREFIX_LENGTH = 2

const RESOLVER_SELECTOR = selector("resolver(bytes32)")
const TEXT_SELECTOR = selector("text(bytes32,string)")

/** How long each read may take, and how long an answer may be. */
export interface EnsReadOptions {
  timeoutMs: number
  /** Defaults to {@link MAX_CHAIN_ANSWER_BYTES}. */
  maxAnswerBytes?: number
}

/** The 4-byte function selector of a Solidity signature, bare hex. */
export function selector(signature: string): string {
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

function encodeTextCall(node: string, key: string): string {
  const keyBytes = new TextEncoder().encode(key)
  const keyHex = uint8ArrayToHex(keyBytes)
  const paddedLength = Math.ceil(keyBytes.length / WORD_BYTES) * WORD_BYTES * 2
  const head = word(WORD_BYTES * 2)
  return `0x${TEXT_SELECTOR}${node.slice(2)}${head}${word(keyBytes.length)}${keyHex.padEnd(paddedLength, "0")}`
}

function resultBytes(
  result: unknown,
  subject: string,
  maxBytes: number,
): Uint8Array {
  if (
    typeof result === "string" &&
    result.length > HEX_PREFIX_LENGTH + maxBytes * 2
  ) {
    throw new Error(
      `${subject} answered ${result.length} characters, longer than ${maxBytes} bytes of hex data.`,
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
 * One ABI-encoded `address` return value, or undefined for the zero address.
 * @throws on an answer that is not exactly one word holding an address.
 */
function decodeAddress(
  result: unknown,
  subject: string,
  maxBytes: number,
): string | undefined {
  const bytes = resultBytes(result, subject, maxBytes)
  if (bytes.length !== WORD_BYTES) {
    throw new Error(`${subject} answered an address that is not one word.`)
  }
  const padding = bytes.slice(0, WORD_BYTES - ADDRESS_BYTES)
  if (padding.some((byte) => byte !== 0)) {
    throw new Error(`${subject} answered a word that is not an address.`)
  }
  const address = bytes.slice(WORD_BYTES - ADDRESS_BYTES)
  return address.every((byte) => byte === 0)
    ? undefined
    : `0x${uint8ArrayToHex(address)}`
}

/**
 * One ABI-encoded `string` return value, strict UTF-8.
 * @throws on an offset or a length past the answer's end, or invalid UTF-8.
 */
function decodeString(
  result: unknown,
  subject: string,
  maxBytes: number,
): string {
  const bytes = resultBytes(result, subject, maxBytes)
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

async function ethCall(
  rpcUrl: string,
  to: string,
  data: string,
  timeoutMs: number,
): Promise<unknown> {
  return jsonRpcCall(rpcUrl, "eth_call", [{ to, data }, "latest"], {
    timeoutMs,
  })
}

/**
 * The resolver the registry names for `node`, or undefined when it names none.
 * @throws when the endpoint fails or the answer does not decode.
 */
export async function readEnsResolver(
  rpcUrl: string,
  node: string,
  options: EnsReadOptions,
): Promise<string | undefined> {
  return decodeAddress(
    await ethCall(
      rpcUrl,
      ENS_REGISTRY_ADDRESS,
      `0x${RESOLVER_SELECTOR}${node.slice(2)}`,
      options.timeoutMs,
    ),
    "The registry",
    options.maxAnswerBytes ?? MAX_CHAIN_ANSWER_BYTES,
  )
}

/**
 * Call a resolver function of the form `f(bytes32)` that returns an address,
 * such as `addr(bytes32)`. Undefined for the zero address.
 * @throws when the endpoint fails or the answer does not decode.
 */
export async function callResolverForAddress(
  rpcUrl: string,
  resolver: string,
  functionSelector: string,
  node: string,
  options: EnsReadOptions,
): Promise<string | undefined> {
  return decodeAddress(
    await ethCall(
      rpcUrl,
      resolver,
      `0x${functionSelector}${node.slice(2)}`,
      options.timeoutMs,
    ),
    "The resolver",
    options.maxAnswerBytes ?? MAX_CHAIN_ANSWER_BYTES,
  )
}

/**
 * Call a resolver function of the form `f(bytes32)` that returns a string,
 * such as `name(bytes32)`.
 * @throws when the endpoint fails or the answer does not decode.
 */
export async function callResolverForString(
  rpcUrl: string,
  resolver: string,
  functionSelector: string,
  node: string,
  options: EnsReadOptions,
): Promise<string> {
  return decodeString(
    await ethCall(
      rpcUrl,
      resolver,
      `0x${functionSelector}${node.slice(2)}`,
      options.timeoutMs,
    ),
    "The resolver",
    options.maxAnswerBytes ?? MAX_CHAIN_ANSWER_BYTES,
  )
}

/**
 * The text record `key` of `name`, through the resolver the registry names.
 * @throws when the name has no resolver or the answers do not decode.
 */
export async function readEnsText(
  rpcUrl: string,
  name: string,
  key: string,
  options: EnsReadOptions,
): Promise<string> {
  const node = ensNamehash(name)
  const resolver = await readEnsResolver(rpcUrl, node, options)
  if (!resolver) {
    throw new Error(`${name} has no resolver.`)
  }
  return decodeString(
    await ethCall(
      rpcUrl,
      resolver,
      encodeTextCall(node, key),
      options.timeoutMs,
    ),
    "The resolver",
    options.maxAnswerBytes ?? MAX_CHAIN_ANSWER_BYTES,
  )
}
