// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * The verified ENS name of a wallet, read through ENS's Universal Resolver
 * over a chain endpoint. Every test answers through a stub endpoint that
 * plays the Universal Resolver: nothing here reaches the network.
 */

import {
  decodeFunctionData,
  encodeErrorResult,
  encodeFunctionResult,
  parseAbi,
  type Hex,
} from "viem"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MockInstance } from "vitest"
import {
  ENS_NAME_CACHE_MS,
  ENS_NAME_FAILURE_CACHE_MS,
  resolveVerifiedEnsName,
} from "./ens-name"

/** ENS's Universal Resolver on Ethereum mainnet, written out independently. */
const UNIVERSAL_RESOLVER = "0xeeeeeeee14d718c2b47d9923deab1335e144eeee"
const UNIVERSAL_RESOLVER_ABI = parseAbi([
  "function reverseWithGateways(bytes lookupAddress, uint256 coinType, string[] gateways) view returns (string primary, address resolver, address reverseResolver)",
  "error ResolverNotFound(bytes name)",
  "error ReverseAddressMismatch(string primary, bytes primaryAddress)",
  "error HttpError(uint16 status, string message)",
])
/** The coin type of Ethereum itself, ENSIP-11's 60. */
const ETHEREUM_COIN_TYPE = 60n
const EXECUTION_REVERTED_CODE = 3

const WALLET = `0x${"ab".repeat(20)}`
const NAME = "levi.eth"
const RESOLVER: Hex = `0x${"22".repeat(20)}`
const REVERSE_RESOLVER: Hex = `0x${"11".repeat(20)}`
const SHORT_TIMEOUT_MS = 50
const START = 1_000_000
const SECRET_PATH = "/v3/provider-key"

type Revert = "no-reverse-record" | "forward-mismatch" | "gateway-failed"

interface StubResolver {
  /** The primary name the Universal Resolver answers, "" for none. */
  name: string
  /** A revert instead of an answer. */
  revert?: Revert
  /** What `result` holds instead of an encoded answer. */
  rawResult?: string
  status?: number
  down?: boolean
  hang?: boolean
}

let fetchSpy: MockInstance<typeof fetch>
let warnSpy: MockInstance<typeof console.warn>
let resolver: StubResolver
let now: number
/** A fresh endpoint per test, so the module's cache never carries over. */
let rpcUrl: string
let endpointCount = 0
/** The wallets the Universal Resolver was asked about, lower case. */
let asked: string[]

function rpcResponse(id: unknown, member: object, status = 200): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, ...member }), {
    status,
  })
}

function revertData(revert: Revert): Hex {
  switch (revert) {
    case "no-reverse-record":
      return encodeErrorResult({
        abi: UNIVERSAL_RESOLVER_ABI,
        errorName: "ResolverNotFound",
        args: ["0x00"],
      })
    case "forward-mismatch":
      return encodeErrorResult({
        abi: UNIVERSAL_RESOLVER_ABI,
        errorName: "ReverseAddressMismatch",
        args: [resolver.name, `0x${"cd".repeat(20)}`],
      })
    case "gateway-failed":
      return encodeErrorResult({
        abi: UNIVERSAL_RESOLVER_ABI,
        errorName: "HttpError",
        args: [500, "Internal Server Error"],
      })
  }
}

function stubEndpoint(): void {
  fetchSpy.mockImplementation(async (_url, init) => {
    if (resolver.down) {
      throw new TypeError("Failed to fetch")
    }
    if (resolver.hang) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        )
      })
    }
    const body = JSON.parse(init?.body as string) as {
      id: unknown
      method: string
      params: [{ to: string; data: Hex }, string]
    }
    if (resolver.status !== undefined) {
      return rpcResponse(body.id, {}, resolver.status)
    }
    expect(body.method).toBe("eth_call")
    const [{ to, data }] = body.params
    expect(to.toLowerCase()).toBe(UNIVERSAL_RESOLVER)
    const call = decodeFunctionData({ abi: UNIVERSAL_RESOLVER_ABI, data })
    const [lookupAddress, coinType] = call.args
    expect(coinType).toBe(ETHEREUM_COIN_TYPE)
    asked.push(lookupAddress.toLowerCase())
    if (resolver.revert) {
      return rpcResponse(body.id, {
        error: {
          code: EXECUTION_REVERTED_CODE,
          message: "execution reverted",
          data: revertData(resolver.revert),
        },
      })
    }
    return rpcResponse(body.id, {
      result:
        resolver.rawResult ??
        encodeFunctionResult({
          abi: UNIVERSAL_RESOLVER_ABI,
          functionName: "reverseWithGateways",
          result: [resolver.name, RESOLVER, REVERSE_RESOLVER],
        }),
    })
  })
}

const lookup = (wallet = WALLET, timeoutMs?: number) =>
  resolveVerifiedEnsName(wallet, { rpcUrl, timeoutMs })

beforeEach(() => {
  endpointCount += 1
  rpcUrl = `https://rpc${endpointCount}.example${SECRET_PATH}`
  resolver = { name: NAME }
  asked = []
  now = START
  vi.spyOn(Date, "now").mockImplementation(() => now)
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
  fetchSpy = vi.spyOn(globalThis, "fetch")
  stubEndpoint()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("resolveVerifiedEnsName", () => {
  it("answers the primary name the Universal Resolver verified", async () => {
    await expect(lookup()).resolves.toBe(NAME)
    expect(asked).toEqual([WALLET])
  })

  it("reads the wallet in any case and with or without 0x", async () => {
    await expect(lookup(WALLET.slice(2).toUpperCase())).resolves.toBe(NAME)
    expect(asked).toEqual([WALLET])
  })

  it("answers no name when the wallet has no primary name", async () => {
    resolver.name = ""
    await expect(lookup()).resolves.toBeUndefined()
  })

  it("answers no name when the wallet has no reverse record", async () => {
    resolver.revert = "no-reverse-record"
    await expect(lookup()).resolves.toBeUndefined()
  })

  it("answers no name when the name's address record names another wallet", async () => {
    resolver.revert = "forward-mismatch"
    await expect(lookup()).resolves.toBeUndefined()
  })

  it.each([
    ["upper case", "Levi.eth"],
    ["a space", "le vi.eth"],
    ["a zero-width joiner", "le‍vi.eth"],
    ["full-width letters", "ｌｅｖｉ.eth"],
    ["an empty label", "levi..eth"],
  ])(
    "answers no name for a name with %s, which ENSIP-15 does not keep as it is",
    async (_label, name) => {
      resolver.name = name
      await expect(lookup()).resolves.toBeUndefined()
    },
  )

  it("keeps a name that ENSIP-15 normalises to itself, emoji included", async () => {
    resolver.name = "\u{1f4a9}.eth"
    await expect(lookup()).resolves.toBe("\u{1f4a9}.eth")
  })

  it("answers no name when the endpoint cannot be reached", async () => {
    resolver.down = true
    await expect(lookup()).resolves.toBeUndefined()
  })

  it("answers no name when the endpoint answers an error status", async () => {
    resolver.status = 503
    await expect(lookup()).resolves.toBeUndefined()
  })

  it("answers no name when the endpoint does not answer in time", async () => {
    resolver.hang = true
    await expect(lookup(WALLET, SHORT_TIMEOUT_MS)).resolves.toBeUndefined()
  })

  it("answers no name when the answer does not decode", async () => {
    resolver.rawResult = "0x1234"
    await expect(lookup()).resolves.toBeUndefined()
  })

  it("answers no name when a name's offchain gateway failed", async () => {
    resolver.revert = "gateway-failed"
    await expect(lookup()).resolves.toBeUndefined()
  })

  it("asks the endpoint once, without retrying a failure", async () => {
    resolver.status = 503
    await lookup()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("never logs the endpoint's path, where a provider's key lives", async () => {
    resolver.status = 503
    await lookup()
    expect(warnSpy).toHaveBeenCalled()
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(SECRET_PATH)
  })

  it.each([
    ["too short", "0x1234"],
    ["not hex", `0x${"zz".repeat(20)}`],
  ])(
    "answers no name for a wallet %s, without asking the chain",
    async (_label, wallet) => {
      await expect(lookup(wallet)).resolves.toBeUndefined()
      expect(fetchSpy).not.toHaveBeenCalled()
    },
  )

  it("answers no name without asking anything when no endpoint is given", async () => {
    await expect(
      resolveVerifiedEnsName(WALLET, { rpcUrl: "" }),
    ).resolves.toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  describe("cache", () => {
    it("answers a second lookup for the wallet without asking the chain", async () => {
      await lookup()
      const calls = fetchSpy.mock.calls.length
      await expect(lookup()).resolves.toBe(NAME)
      expect(fetchSpy.mock.calls.length).toBe(calls)
    })

    it.each([
      ["no primary name", { name: "" }],
      ["no reverse record", { name: NAME, revert: "no-reverse-record" }],
      [
        "an address record naming another wallet",
        { name: NAME, revert: "forward-mismatch" },
      ],
    ] as const)(
      "keeps a definite no-name answer, %s, for the full time",
      async (_label, answer) => {
        resolver = { ...answer }
        await lookup()
        const calls = fetchSpy.mock.calls.length
        resolver = { name: NAME }
        now = START + ENS_NAME_CACHE_MS - 1
        await expect(lookup()).resolves.toBeUndefined()
        expect(fetchSpy.mock.calls.length).toBe(calls)
      },
    )

    it("asks the chain again once the cached answer is too old", async () => {
      await lookup()
      resolver.name = ""
      now = START + ENS_NAME_CACHE_MS
      await expect(lookup()).resolves.toBeUndefined()
    })

    it("keeps a failed read for 30 seconds, so a broken endpoint is not asked on every lookup", async () => {
      expect(ENS_NAME_FAILURE_CACHE_MS).toBe(30_000)
      resolver.down = true
      await expect(lookup()).resolves.toBeUndefined()
      const calls = fetchSpy.mock.calls.length
      resolver.down = false
      now = START + ENS_NAME_FAILURE_CACHE_MS - 1
      await expect(lookup()).resolves.toBeUndefined()
      expect(fetchSpy.mock.calls.length).toBe(calls)
      now = START + ENS_NAME_FAILURE_CACHE_MS
      await expect(lookup()).resolves.toBe(NAME)
    })

    it("keeps a failed offchain gateway as a failure, not as no name", async () => {
      resolver.revert = "gateway-failed"
      await expect(lookup()).resolves.toBeUndefined()
      resolver.revert = undefined
      now = START + ENS_NAME_FAILURE_CACHE_MS
      await expect(lookup()).resolves.toBe(NAME)
    })

    it("keeps a read that ran out of time as a failure too", async () => {
      resolver.hang = true
      await expect(lookup(WALLET, SHORT_TIMEOUT_MS)).resolves.toBeUndefined()
      const calls = fetchSpy.mock.calls.length
      resolver.hang = false
      await expect(lookup()).resolves.toBeUndefined()
      expect(fetchSpy.mock.calls.length).toBe(calls)
      now = START + ENS_NAME_FAILURE_CACHE_MS
      await expect(lookup()).resolves.toBe(NAME)
    })

    it("shares one read between lookups that arrive together", async () => {
      const [first, second] = await Promise.all([lookup(), lookup()])
      expect(first).toBe(NAME)
      expect(second).toBe(NAME)
      expect(asked).toHaveLength(1)
    })

    it("keeps endpoints apart", async () => {
      await lookup()
      rpcUrl = "https://another-rpc.example"
      resolver.name = ""
      await expect(lookup()).resolves.toBeUndefined()
    })
  })
})
