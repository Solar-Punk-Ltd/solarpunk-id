// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * A wallet's ENS name, for a reader that checked a wallet link
 * (docs/Wallet-Link.md) and wants to show the name instead of the address.
 *
 * Anyone can point the reverse record of their own wallet at any name, so the
 * reverse record alone proves nothing. ENS's Universal Resolver, read through
 * viem's `getEnsName`, answers a primary name only when the name's address
 * record names the wallet back, and it follows CCIP-read (EIP-3668), wildcard
 * (ENSIP-10) and chain-specific (ENSIP-19) resolvers on the way. The name
 * must also be in its ENSIP-15 normalised form already, because a name that
 * normalises to something else can look like a different name on screen.
 *
 * Read over an Ethereum mainnet JSON-RPC endpoint the caller names, never a
 * Swarm gateway (`ens.ts` says why).
 */

import {
  BaseError,
  ContractFunctionRevertedError,
  createClient,
  http,
  type Hex,
} from "viem"
import { mainnet } from "viem/chains"
import { getEnsName, normalize } from "viem/ens"
import { CHAIN_READ_TIMEOUT_MS } from "./json-rpc"
import { withTimeout } from "./promise"

/**
 * How long a wallet's answer is kept before the chain is asked again. A name
 * changed on chain shows at most this long after on a page that read it.
 */
export const ENS_NAME_CACHE_MS = 10 * 60 * 1000

/**
 * How long a failed read is kept, so a page that shows many senders does not
 * ask a broken or slow endpoint again for every message it renders, while a
 * passing outage still clears soon.
 */
export const ENS_NAME_FAILURE_CACHE_MS = 30 * 1000

/**
 * The Universal Resolver's reverts that are a definite answer of no name: no
 * reverse record, a name whose address record names another wallet, a
 * resolver that is not a contract or cannot answer a name. Every other revert,
 * such as an offchain gateway that failed (`HttpError`) or a resolver that
 * reverted (`ResolverError`), is a failed read.
 */
const NO_NAME_REVERTS = new Set([
  "ResolverNotFound",
  "ReverseAddressMismatch",
  "ResolverNotContract",
  "UnsupportedResolverProfile",
])

const LOG_PREFIX = "[EnsName]"
const WALLET_PATTERN = /^(0x)?[0-9a-fA-F]{40}$/

export interface EnsNameOptions {
  /** An Ethereum mainnet JSON-RPC endpoint. Empty, no name is ever answered. */
  rpcUrl: string
  /** Deadline for the whole lookup. Defaults to `CHAIN_READ_TIMEOUT_MS`. */
  timeoutMs?: number
}

interface CachedName {
  name: string | undefined
  fetchedAt: number
  /** How long this entry answers: `ENS_NAME_CACHE_MS` or, for a failed read, `ENS_NAME_FAILURE_CACHE_MS`. */
  keepMs: number
}

const cache = new Map<string, CachedName>()
const inFlight = new Map<string, Promise<string | undefined>>()

/** Whether ENSIP-15 leaves `name` exactly as it is. */
function isNormalised(name: string): boolean {
  try {
    return normalize(name) === name
  } catch {
    return false
  }
}

function isNoNameRevert(error: unknown): boolean {
  if (!(error instanceof BaseError)) {
    return false
  }
  const revert = error.walk(
    (cause) => cause instanceof ContractFunctionRevertedError,
  )
  return (
    revert instanceof ContractFunctionRevertedError &&
    NO_NAME_REVERTS.has(revert.data?.errorName ?? "")
  )
}

/**
 * The verified name, or undefined when the chain says there is none.
 * @throws when the endpoint fails, an answer does not decode or a name's
 *   resolver could not answer, which is not an answer and is therefore kept
 *   only for `ENS_NAME_FAILURE_CACHE_MS`.
 */
async function readVerifiedName(
  rpcUrl: string,
  wallet: Hex,
  timeoutMs: number,
): Promise<string | undefined> {
  // A retry would outlive the whole lookup's deadline and keep asking an
  // endpoint whose failure is already cached.
  const client = createClient({
    chain: mainnet,
    transport: http(rpcUrl, { timeout: timeoutMs, retryCount: 0 }),
  })
  try {
    // Strict, so a failed read throws instead of reading as no name, and only
    // the reverts above are taken as a definite no.
    const name = await getEnsName(client, { address: wallet, strict: true })
    return name && isNormalised(name) ? name : undefined
  } catch (error) {
    if (isNoNameRevert(error)) {
      return undefined
    }
    throw error
  }
}

/** viem's short message leaves out the endpoint, whose path can hold a key. */
function describeFailure(error: unknown): string {
  if (error instanceof BaseError) {
    return error.shortMessage
  }
  return error instanceof Error ? error.message : String(error)
}

/**
 * The ENS name of `wallet`, when ENS's Universal Resolver answers a primary
 * name whose address record names the wallet back, and the name is already
 * ENSIP-15 normalised. Undefined for no such name and for everything that goes
 * wrong: no endpoint, an endpoint that does not answer in time, an answer that
 * does not decode, a name's offchain gateway that fails. Never throws.
 *
 * An answer, name or no name, is kept in memory for `ENS_NAME_CACHE_MS` per
 * endpoint and wallet, and lookups that arrive together share one read. A
 * failed read answers no name for `ENS_NAME_FAILURE_CACHE_MS`, and the first
 * lookup after that asks again.
 *
 * @param wallet - the wallet's address, in any case, with or without `0x`,
 *   such as `verifyWalletLink(...).wallet`
 */
export async function resolveVerifiedEnsName(
  wallet: string,
  options: EnsNameOptions,
): Promise<string | undefined> {
  if (!options.rpcUrl || !WALLET_PATTERN.test(wallet)) {
    return undefined
  }
  const bare = wallet.toLowerCase().replace(/^0x/, "")
  const key = `${options.rpcUrl}\n${bare}`
  const cached = cache.get(key)
  if (cached) {
    const age = Date.now() - cached.fetchedAt
    if (age >= 0 && age < cached.keepMs) {
      return cached.name
    }
    cache.delete(key)
  }
  const pending = inFlight.get(key)
  if (pending) {
    return pending
  }
  const timeoutMs = options.timeoutMs ?? CHAIN_READ_TIMEOUT_MS
  const read = withTimeout(
    readVerifiedName(options.rpcUrl, `0x${bare}`, timeoutMs),
    timeoutMs,
    `The ENS name of 0x${bare} was not read within ${timeoutMs}ms.`,
  )
    .then((name) => {
      cache.set(key, {
        name,
        fetchedAt: Date.now(),
        keepMs: ENS_NAME_CACHE_MS,
      })
      return name
    })
    .catch((error: unknown) => {
      console.warn(
        `${LOG_PREFIX} Could not read the name of 0x${bare}:`,
        describeFailure(error),
      )
      cache.set(key, {
        name: undefined,
        fetchedAt: Date.now(),
        keepMs: ENS_NAME_FAILURE_CACHE_MS,
      })
      return undefined
    })
    .finally(() => {
      inFlight.delete(key)
    })
  inFlight.set(key, read)
  return read
}
