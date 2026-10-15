// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * The verified ENS name of a wallet, read over a chain endpoint. Every test
 * answers through a stub endpoint: nothing here reaches the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MockInstance } from "vitest"
import { ENS_REGISTRY_ADDRESS, ensNamehash } from "./ens"
import {
  ENS_NAME_CACHE_MS,
  ENS_NAME_FAILURE_CACHE_MS,
  resolveVerifiedEnsName,
} from "./ens-name"
import { uint8ArrayToHex } from "./hex"

const WALLET = `0x${"ab".repeat(20)}`
const OTHER_WALLET = `0x${"cd".repeat(20)}`
const NAME = "levi.eth"
const REVERSE_RESOLVER = `0x${"11".repeat(20)}`
const FORWARD_RESOLVER = `0x${"22".repeat(20)}`
const ZERO_ADDRESS = `0x${"00".repeat(20)}`
const RESOLVER_SELECTOR = "0x0178b8bf"
const NAME_SELECTOR = "0x691f3431"
const ADDR_SELECTOR = "0x3b3b57de"
const WORD_HEX = 64
const WORD_BYTES = 32
const SELECTOR_HEX = 10
const SHORT_TIMEOUT_MS = 50
const START = 1_000_000

/** ABI encoding of one `string` return value, written out independently. */
function abiString(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const hex = uint8ArrayToHex(bytes)
  const padded = hex.padEnd(Math.ceil(hex.length / WORD_HEX) * WORD_HEX, "0")
  const offset = WORD_BYTES.toString(16).padStart(WORD_HEX, "0")
  const length = bytes.length.toString(16).padStart(WORD_HEX, "0")
  return `0x${offset}${length}${padded}`
}

function addressWord(address: string): string {
  return `0x${address.slice(2).padStart(WORD_HEX, "0")}`
}

function rpcResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

const reverseNode = (wallet: string) =>
  ensNamehash(`${wallet.slice(2).toLowerCase()}.addr.reverse`)

interface StubChain {
  /** The name the reverse record holds. Unset, the reverse node has no resolver. */
  reverseName?: string
  /** What `name` answers instead of an encoded string. */
  rawName?: string
  /** Extra bytes in the `name` answer's envelope, beside a well-formed result. */
  namePadding?: number
  /** The address the forward record holds. Unset, the name has no resolver. */
  forwardAddress?: string
  status?: number
  down?: boolean
  hang?: boolean
}

let fetchSpy: MockInstance<typeof fetch>
let chain: StubChain
let now: number
/** A fresh endpoint per test, so the module's cache never carries over. */
let rpcUrl: string
let endpointCount = 0

function stubEndpoint(): void {
  fetchSpy.mockImplementation(async (_url, init) => {
    if (chain.down) {
      throw new TypeError("Failed to fetch")
    }
    if (chain.hang) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        )
      })
    }
    if (chain.status !== undefined) {
      return rpcResponse({}, chain.status)
    }
    const body = JSON.parse(init?.body as string) as {
      method: string
      params: [{ to: string; data: string }, string]
    }
    expect(body.method).toBe("eth_call")
    const [{ to, data }] = body.params
    const callSelector = data.slice(0, SELECTOR_HEX)
    const node = `0x${data.slice(SELECTOR_HEX, SELECTOR_HEX + WORD_HEX)}`
    if (to.toLowerCase() === ENS_REGISTRY_ADDRESS.toLowerCase()) {
      expect(callSelector).toBe(RESOLVER_SELECTOR)
      if (node === reverseNode(WALLET) && chain.reverseName !== undefined) {
        return rpcResponse({ result: addressWord(REVERSE_RESOLVER) })
      }
      if (
        chain.reverseName !== undefined &&
        node === ensNamehash(chain.reverseName) &&
        chain.forwardAddress !== undefined
      ) {
        return rpcResponse({ result: addressWord(FORWARD_RESOLVER) })
      }
      return rpcResponse({ result: addressWord(ZERO_ADDRESS) })
    }
    if (to === REVERSE_RESOLVER) {
      expect(callSelector).toBe(NAME_SELECTOR)
      expect(node).toBe(reverseNode(WALLET))
      return rpcResponse({
        result: chain.rawName ?? abiString(chain.reverseName ?? ""),
        ...(chain.namePadding
          ? { padding: "x".repeat(chain.namePadding) }
          : {}),
      })
    }
    if (to === FORWARD_RESOLVER) {
      expect(callSelector).toBe(ADDR_SELECTOR)
      expect(node).toBe(ensNamehash(chain.reverseName ?? ""))
      return rpcResponse({
        result: addressWord(chain.forwardAddress ?? ZERO_ADDRESS),
      })
    }
    return rpcResponse({ result: "0x" })
  })
}

const lookup = (wallet = WALLET, timeoutMs?: number) =>
  resolveVerifiedEnsName(wallet, { rpcUrl, timeoutMs })

beforeEach(() => {
  endpointCount += 1
  rpcUrl = `https://rpc${endpointCount}.example`
  chain = { reverseName: NAME, forwardAddress: WALLET }
  now = START
  vi.spyOn(Date, "now").mockImplementation(() => now)
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  fetchSpy = vi.spyOn(globalThis, "fetch")
  stubEndpoint()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("resolveVerifiedEnsName", () => {
  it("answers the name whose reverse and forward records agree", async () => {
    await expect(lookup()).resolves.toBe(NAME)
  })

  it("reads the wallet in any case and with or without 0x", async () => {
    await expect(lookup(WALLET.slice(2).toUpperCase())).resolves.toBe(NAME)
  })

  it("answers no name when the forward record names another wallet", async () => {
    chain.forwardAddress = OTHER_WALLET
    await expect(lookup()).resolves.toBeUndefined()
  })

  it("answers no name when the name has no forward resolver", async () => {
    chain.forwardAddress = undefined
    await expect(lookup()).resolves.toBeUndefined()
  })

  it("answers no name when the wallet has no reverse record", async () => {
    chain.reverseName = undefined
    await expect(lookup()).resolves.toBeUndefined()
  })

  it("answers no name when the reverse record is empty", async () => {
    chain.reverseName = ""
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
      chain.reverseName = name
      await expect(lookup()).resolves.toBeUndefined()
    },
  )

  it("keeps a name that ENSIP-15 normalises to itself, emoji included", async () => {
    chain.reverseName = "💩.eth"
    await expect(lookup()).resolves.toBe("💩.eth")
  })

  it("answers no name when the endpoint cannot be reached", async () => {
    chain.down = true
    await expect(lookup()).resolves.toBeUndefined()
  })

  it("answers no name when the endpoint answers an error status", async () => {
    chain.status = 503
    await expect(lookup()).resolves.toBeUndefined()
  })

  it("answers no name when the endpoint does not answer in time", async () => {
    chain.hang = true
    await expect(lookup(WALLET, SHORT_TIMEOUT_MS)).resolves.toBeUndefined()
  })

  it("answers no name when the name's answer is longer than any name needs", async () => {
    chain.rawName = abiString("a".repeat(4096))
    await expect(lookup()).resolves.toBeUndefined()
  })

  it("answers no name when the endpoint's body is longer than any answer needs, however small its result", async () => {
    chain.namePadding = 1024 * 1024
    await expect(lookup()).resolves.toBeUndefined()
  })

  it("answers no name when the name's answer does not decode", async () => {
    chain.rawName = "0xzz"
    await expect(lookup()).resolves.toBeUndefined()
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

    it("keeps a definite no-name answer too", async () => {
      chain.reverseName = undefined
      await lookup()
      const calls = fetchSpy.mock.calls.length
      await expect(lookup()).resolves.toBeUndefined()
      expect(fetchSpy.mock.calls.length).toBe(calls)
    })

    it("asks the chain again once the cached answer is too old", async () => {
      await lookup()
      chain.forwardAddress = OTHER_WALLET
      now = START + ENS_NAME_CACHE_MS
      await expect(lookup()).resolves.toBeUndefined()
    })

    it("keeps a failed read for 30 seconds, so a broken endpoint is not asked on every lookup", async () => {
      expect(ENS_NAME_FAILURE_CACHE_MS).toBe(30_000)
      chain.down = true
      await expect(lookup()).resolves.toBeUndefined()
      const calls = fetchSpy.mock.calls.length
      chain.down = false
      now = START + ENS_NAME_FAILURE_CACHE_MS - 1
      await expect(lookup()).resolves.toBeUndefined()
      expect(fetchSpy.mock.calls.length).toBe(calls)
      now = START + ENS_NAME_FAILURE_CACHE_MS
      await expect(lookup()).resolves.toBe(NAME)
    })

    it("keeps a read that ran out of time as a failure too", async () => {
      chain.hang = true
      await expect(lookup(WALLET, SHORT_TIMEOUT_MS)).resolves.toBeUndefined()
      const calls = fetchSpy.mock.calls.length
      chain.hang = false
      await expect(lookup()).resolves.toBeUndefined()
      expect(fetchSpy.mock.calls.length).toBe(calls)
    })

    it("shares one read between lookups that arrive together", async () => {
      const [first, second] = await Promise.all([lookup(), lookup()])
      expect(first).toBe(NAME)
      expect(second).toBe(NAME)
      const reverseCalls = fetchSpy.mock.calls.filter(([, init]) =>
        (init?.body as string).includes(REVERSE_RESOLVER),
      )
      expect(reverseCalls).toHaveLength(1)
    })

    it("keeps endpoints apart", async () => {
      await lookup()
      rpcUrl = "https://another-rpc.example"
      chain.forwardAddress = OTHER_WALLET
      await expect(lookup()).resolves.toBeUndefined()
    })
  })
})
