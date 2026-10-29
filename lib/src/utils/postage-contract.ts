// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Reads postage batch state directly from the Swarm PostageStamp contract on
 * Gnosis Chain, by batch ID, over a plain JSON-RPC `eth_call`.
 *
 * The chain is the source of truth for whether a batch exists and how long it
 * has left. This is the exact data a Bee node uses internally to compute
 * `batchTTL`, and reading it does not require the node to know about the
 * batch, so a stamp added manually (or owned by a different node), which has
 * no entry in `GET /stamps/{id}`, still gets its lifetime from the contract.
 * The Bee node answers `usable`, which the chain does not hold (see
 * {@link fetchBatchStanding}).
 *
 * The contract exposes the per-chunk normalised balance accounting used by the
 * storage-incentives system:
 *   remainingBalancePerChunk = normalisedBalance - currentTotalOutPayment()
 *   remainingBlocks          = remainingBalancePerChunk / lastPrice()
 *   ttlSeconds               = remainingBlocks * GNOSIS_BLOCK_TIME
 */

import { fetchBatchDetails, GNOSIS_BLOCK_TIME } from "./ttl"
import { CHAIN_READ_TIMEOUT_MS, jsonRpcBatch } from "./json-rpc"

/**
 * PostageStamp contract address on Gnosis Chain. Lowercased — RPC nodes accept
 * a non-checksummed `to`, and lowercasing sidesteps any checksum mistake.
 */
export const POSTAGE_STAMP_CONTRACT_ADDRESS =
  "0x45a1502382541cd610cc9068e88727426b696293"

/**
 * True when an RPC URL targets a local dev chain (bee-compose anvil). A
 * dev-deployed PostageStamp address is only valid against such a node.
 */
function isLocalRpcUrl(rpcUrl: string): boolean {
  try {
    const { hostname } = new URL(rpcUrl)
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0"
    )
  } catch {
    return false
  }
}

/**
 * Picks the PostageStamp contract address that matches the chain `rpcUrl` points
 * at. A dev-override address (bee-compose anvil) is only honoured against a local
 * RPC. Against any remote RPC (Gnosis mainnet) it would read a nonexistent
 * contract, `eth_call` would return empty, and the standing would rest on the
 * Bee node alone. Tying the address to the RPC network stops the two from
 * drifting apart, which is what produced wildly wrong estimated expiry dates
 * when a dev build read a mainnet batch (#344).
 */
export function resolvePostageStampContractAddress(
  rpcUrl: string,
  localContractAddress?: string,
): string {
  return isLocalRpcUrl(rpcUrl) && localContractAddress
    ? localContractAddress
    : POSTAGE_STAMP_CONTRACT_ADDRESS
}

/**
 * 4-byte function selectors (first 4 bytes of keccak256 of the signature).
 * Hardcoded so the library needs no keccak/ABI dependency for these fixed,
 * argument-free (or single-bytes32) calls.
 */
const SELECTOR_BATCHES = "c81e25ab" // batches(bytes32)
const SELECTOR_CURRENT_TOTAL_OUT_PAYMENT = "51b17cd0" // currentTotalOutPayment()
const SELECTOR_LAST_PRICE = "053f14da" // lastPrice()

const HEX_WORD_LENGTH = 64 // 32 bytes as hex
const ADDRESS_HEX_LENGTH = 40 // 20 bytes as hex
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

// A batch ID is exactly one 32-byte word. Compiled once, not per call.
const BATCH_ID_REGEX = new RegExp(`^[0-9a-f]{${HEX_WORD_LENGTH}}$`)

/**
 * Decoded `batches(bytes32)` tuple. Field names mirror the contract's `Batch`
 * struct. `normalisedBalance` is a per-chunk value denominated in PLUR; it is
 * the cumulative outpayment level at which this batch runs out.
 */
export interface OnChainPostageBatch {
  owner: string
  depth: number
  bucketDepth: number
  immutableFlag: boolean
  normalisedBalance: bigint
  lastUpdatedBlockNumber: bigint
}

/**
 * A consistent snapshot of one batch plus the global accounting needed to turn
 * its `normalisedBalance` into a remaining TTL.
 */
export interface OnChainBatchState {
  batch: OnChainPostageBatch
  /** Per-chunk cumulative outpayment so far, in PLUR (`currentTotalOutPayment()`). */
  currentTotalOutPayment: bigint
  /** Per-chunk per-block storage price, in PLUR (`lastPrice()`). */
  lastPrice: bigint
}

/**
 * Normalises a batch ID to 64 lowercase hex chars (no `0x`) for ABI encoding.
 * @throws if the input is not a 32-byte hex string.
 */
function normalizeBatchId(batchId: string): string {
  const stripped = batchId.startsWith("0x") ? batchId.slice(2) : batchId
  const lower = stripped.toLowerCase()
  if (!BATCH_ID_REGEX.test(lower)) {
    throw new Error(`Invalid batch ID: ${batchId}`)
  }
  return lower
}

/** Splits a `0x`-prefixed return payload into 32-byte (64-hex) words. */
function toWords(hex: string): string[] {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex
  const words: string[] = []
  for (let i = 0; i < body.length; i += HEX_WORD_LENGTH) {
    words.push(body.slice(i, i + HEX_WORD_LENGTH))
  }
  return words
}

/**
 * Decodes the ABI-encoded return of `batches(bytes32)` — a static tuple of
 * `(address, uint8, uint8, bool, uint256, uint256)`, i.e. six 32-byte words.
 * @throws if the payload is too short to hold the tuple.
 */
export function decodeBatches(hex: string): OnChainPostageBatch {
  const words = toWords(hex)
  const EXPECTED_WORDS = 6
  if (words.length < EXPECTED_WORDS) {
    throw new Error(`Unexpected batches() return length: ${hex}`)
  }
  return {
    owner: `0x${words[0].slice(HEX_WORD_LENGTH - ADDRESS_HEX_LENGTH)}`,
    depth: Number(BigInt(`0x${words[1]}`)),
    bucketDepth: Number(BigInt(`0x${words[2]}`)),
    immutableFlag: BigInt(`0x${words[3]}`) !== 0n,
    normalisedBalance: BigInt(`0x${words[4]}`),
    lastUpdatedBlockNumber: BigInt(`0x${words[5]}`),
  }
}

/** Decodes a single-`uint256` return payload to a BigInt. */
export function decodeUint(hex: string): bigint {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex
  if (body.length === 0) {
    throw new Error("Empty uint return")
  }
  return BigInt(`0x${body}`)
}

interface EthCall {
  to: string
  data: string
}

/**
 * Sends a batched `eth_call` and returns the raw hex result of each call, in
 * the same order as `calls`. Id matching lives in {@link jsonRpcBatch}; this
 * narrows its `unknown` results to the hex strings `eth_call` returns.
 * @throws if the transport fails or any sub-call returns an error/non-hex result.
 */
async function ethCallBatch(
  rpcUrl: string,
  calls: EthCall[],
): Promise<string[]> {
  const results = await jsonRpcBatch(
    rpcUrl,
    calls.map((call) => ({
      method: "eth_call",
      params: [{ to: call.to, data: call.data }, "latest"],
    })),
    { timeoutMs: CHAIN_READ_TIMEOUT_MS },
  )
  return results.map((result) => {
    if (typeof result !== "string") {
      throw new Error("eth_call returned something other than a hex string")
    }
    return result
  })
}

/**
 * Outcome of an on-chain batch read, keeping the two failure modes distinct:
 *   - `found` — the contract knows the batch (non-zero owner).
 *   - `not-found` — the contract returned an all-zero tuple; the batch
 *     authoritatively does not exist on this chain.
 *   - `error` — the RPC request failed or returned an undecodable payload, so
 *     existence is *unknown* (not the same as "does not exist").
 */
export type OnChainBatchResult =
  | { status: "found"; state: OnChainBatchState }
  | { status: "not-found" }
  | { status: "error" }

/**
 * Fetches a consistent on-chain snapshot of a postage batch from the
 * PostageStamp contract: its `batches(batchId)` tuple plus the global
 * `currentTotalOutPayment()` and `lastPrice()`, in one batched request.
 *
 * @param rpcUrl - Gnosis Chain JSON-RPC URL
 * @param batchId - 32-byte hex batch ID, with or without `0x` prefix
 * @param contractAddress - PostageStamp contract address to read from. Defaults
 *          to the Gnosis mainnet deployment. Override it for a local dev chain
 *          (bee-compose anvil deploys it at a different address).
 * @returns `found` with the decoded state, `not-found` when the contract knows
 *          no such batch (zero owner), or `error` when the request failed or
 *          its payload could not be decoded. Never throws.
 */
export async function fetchOnChainBatchStateResult(
  rpcUrl: string,
  batchId: string,
  contractAddress: string = POSTAGE_STAMP_CONTRACT_ADDRESS,
): Promise<OnChainBatchResult> {
  try {
    const id = normalizeBatchId(batchId)
    const [batchesResult, outPaymentResult, lastPriceResult] =
      await ethCallBatch(rpcUrl, [
        {
          to: contractAddress,
          data: `0x${SELECTOR_BATCHES}${id}`,
        },
        {
          to: contractAddress,
          data: `0x${SELECTOR_CURRENT_TOTAL_OUT_PAYMENT}`,
        },
        {
          to: contractAddress,
          data: `0x${SELECTOR_LAST_PRICE}`,
        },
      ])

    const batch = decodeBatches(batchesResult)
    // A non-existent batch decodes to an all-zero tuple — a definitive "no such
    // batch on this chain", distinct from an RPC error below.
    if (batch.owner === ZERO_ADDRESS) {
      return { status: "not-found" }
    }

    return {
      status: "found",
      state: {
        batch,
        currentTotalOutPayment: decodeUint(outPaymentResult),
        lastPrice: decodeUint(lastPriceResult),
      },
    }
  } catch {
    return { status: "error" }
  }
}

/**
 * Computes a batch's remaining TTL in seconds from an on-chain snapshot, using
 * the same integer math as the storage-incentives contract and Bee node.
 *
 * @returns Remaining seconds (`0` when expired), or `undefined` when the price
 *          is zero — the batch then drains at no cost and has no finite expiry,
 *          which we cannot render as a date. On mainnet the PriceOracle floor
 *          keeps `lastPrice` well above zero, so this only guards dev chains.
 */
export function calculateContractTTLSeconds(
  state: OnChainBatchState,
): number | undefined {
  const remaining = state.batch.normalisedBalance - state.currentTotalOutPayment
  if (remaining <= 0n) {
    return 0
  }
  if (state.lastPrice <= 0n) {
    return undefined
  }
  const remainingBlocks = remaining / state.lastPrice
  return Number(remainingBlocks * BigInt(GNOSIS_BLOCK_TIME))
}

/** A batch's standing as {@link fetchBatchStanding} reads it. A field is absent where no source answered for it. */
export interface BatchStanding {
  exists?: boolean
  /** Remaining seconds, `0` once expired. */
  batchTTL?: number
  usable?: boolean
}

/**
 * Resolves a batch's existence and remaining TTL, treating the on-chain contract
 * as the source of truth. A contract `not-found` is authoritative: the batch has
 * expired and been removed, or never existed, and a Bee node that still tracks
 * it cannot override the chain. The Bee node answers `usable`, which the chain
 * does not hold, and stands in for the chain only when the contract read itself
 * failed (RPC unreachable).
 *
 * @param localContractAddress - PostageStamp address for a local dev chain; only
 *          honoured against a local RPC (see {@link resolvePostageStampContractAddress}).
 */
export async function fetchBatchStanding(
  gnosisRpcUrl: string,
  beeUrl: string,
  batchId: string,
  localContractAddress?: string,
): Promise<BatchStanding> {
  const contractAddress = resolvePostageStampContractAddress(
    gnosisRpcUrl,
    localContractAddress,
  )
  const [onChain, node] = await Promise.all([
    fetchOnChainBatchStateResult(gnosisRpcUrl, batchId, contractAddress),
    fetchBatchDetails(beeUrl, batchId),
  ])
  if (onChain.status === "not-found") {
    return { exists: false, batchTTL: 0, usable: false }
  }
  if (onChain.status === "found") {
    const batchTTL = calculateContractTTLSeconds(onChain.state)
    return {
      exists: true,
      batchTTL,
      usable: batchTTL === 0 ? false : node?.usable,
    }
  }
  return node ?? {}
}
