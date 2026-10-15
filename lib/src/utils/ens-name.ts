// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * A wallet's ENS name, for a reader that checked a wallet link
 * (docs/Wallet-Link.md) and wants to show the name instead of the address.
 *
 * Anyone can point the reverse record of their own wallet at any name, so the
 * reverse record alone proves nothing. A name is answered only when both
 * directions agree: the wallet's reverse record names it, and that name's
 * `addr` record names the wallet back. The name must also be in its ENSIP-15
 * normalised form already, because a name that normalises to something else
 * can look like a different name on screen.
 *
 * Read over an Ethereum mainnet JSON-RPC endpoint the caller names, never a
 * Swarm gateway (`ens.ts` says why).
 */

import { ens_normalize } from "@adraffy/ens-normalize"
import {
  callResolverForAddress,
  callResolverForString,
  ensNamehash,
  readEnsResolver,
  selector,
  type EnsReadOptions,
} from "./ens"
import { CHAIN_READ_TIMEOUT_MS } from "./json-rpc"
import { withTimeout } from "./promise"

/**
 * How long a wallet's answer is kept before the chain is asked again. A name
 * changed on chain shows at most this long after on a page that read it.
 */
export const ENS_NAME_CACHE_MS = 10 * 60 * 1000

/**
 * The longest `name` answer read, in bytes: two ABI words and a name of 255
 * bytes fit in 352, and a longer answer is no name worth showing.
 */
const MAX_NAME_ANSWER_BYTES = 1024
/** An `address` answer is one word, so the registry and `addr` need no more. */
const MAX_ADDRESS_ANSWER_BYTES = 64

const LOG_PREFIX = "[EnsName]"
const REVERSE_SUFFIX = ".addr.reverse"
const WALLET_PATTERN = /^(0x)?[0-9a-fA-F]{40}$/

const NAME_SELECTOR = selector("name(bytes32)")
const ADDR_SELECTOR = selector("addr(bytes32)")

export interface EnsNameOptions {
  /** An Ethereum mainnet JSON-RPC endpoint. Empty, no name is ever answered. */
  rpcUrl: string
  /** Deadline for the whole lookup. Defaults to `CHAIN_READ_TIMEOUT_MS`. */
  timeoutMs?: number
}

interface CachedName {
  name: string | undefined
  fetchedAt: number
}

const cache = new Map<string, CachedName>()
const inFlight = new Map<string, Promise<string | undefined>>()

/** Whether ENSIP-15 leaves `name` exactly as it is. */
function isNormalised(name: string): boolean {
  try {
    return ens_normalize(name) === name
  } catch {
    return false
  }
}

/**
 * The verified name, or undefined when the chain says there is none.
 * @throws when the endpoint fails or an answer does not decode, which is not
 *   an answer and is therefore not cached.
 */
async function readVerifiedName(
  rpcUrl: string,
  wallet: string,
  timeoutMs: number,
): Promise<string | undefined> {
  const addressRead: EnsReadOptions = {
    timeoutMs,
    maxAnswerBytes: MAX_ADDRESS_ANSWER_BYTES,
  }
  const reverseNode = ensNamehash(`${wallet}${REVERSE_SUFFIX}`)
  const reverseResolver = await readEnsResolver(
    rpcUrl,
    reverseNode,
    addressRead,
  )
  if (!reverseResolver) {
    return undefined
  }
  const name = await callResolverForString(
    rpcUrl,
    reverseResolver,
    NAME_SELECTOR,
    reverseNode,
    { timeoutMs, maxAnswerBytes: MAX_NAME_ANSWER_BYTES },
  )
  if (name === "" || !isNormalised(name)) {
    return undefined
  }
  const forwardNode = ensNamehash(name)
  const forwardResolver = await readEnsResolver(
    rpcUrl,
    forwardNode,
    addressRead,
  )
  if (!forwardResolver) {
    return undefined
  }
  const forward = await callResolverForAddress(
    rpcUrl,
    forwardResolver,
    ADDR_SELECTOR,
    forwardNode,
    addressRead,
  )
  return forward?.toLowerCase() === `0x${wallet}` ? name : undefined
}

/**
 * The ENS name of `wallet`, when its reverse record names a name whose `addr`
 * record names the wallet back, and the name is already ENSIP-15 normalised.
 * Undefined for no such name and for everything that goes wrong: no endpoint,
 * an endpoint that does not answer in time, an answer too long or that does
 * not decode. Never throws.
 *
 * An answer, name or no name, is kept in memory for `ENS_NAME_CACHE_MS` per
 * endpoint and wallet, and lookups that arrive together share one read. A
 * failed read is not kept, so the next lookup asks again.
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
    if (age >= 0 && age < ENS_NAME_CACHE_MS) {
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
    readVerifiedName(options.rpcUrl, bare, timeoutMs),
    timeoutMs,
    `The ENS name of 0x${bare} was not read within ${timeoutMs}ms.`,
  )
    .then((name) => {
      cache.set(key, { name, fetchedAt: Date.now() })
      return name
    })
    .catch((error: unknown) => {
      console.warn(`${LOG_PREFIX} Could not read the name of 0x${bare}:`, error)
      return undefined
    })
    .finally(() => {
      inFlight.delete(key)
    })
  inFlight.set(key, read)
  return read
}
