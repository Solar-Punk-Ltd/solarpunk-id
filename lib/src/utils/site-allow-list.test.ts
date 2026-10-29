// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * The sites the identity manager serves, read from an ENS text record over a
 * chain endpoint. Every test answers through a stub endpoint: nothing here
 * reaches the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MockInstance } from "vitest"
import { uint8ArrayToHex } from "./hex"
import {
  dnsEncodeName,
  ENS_UNIVERSAL_RESOLVER_ADDRESS,
  ensNamehash,
} from "./ens"
import {
  SITE_ALLOW_LIST_CACHE_MS,
  createSiteAllowList,
  parseSiteAllowList,
  type SiteAllowListSettings,
} from "./site-allow-list"
import { STORAGE_KEY_SITE_ALLOW_LIST } from "../types"

const RPC_URL = "https://rpc.example"
const ENS_NAME = "solarpunkid.eth"
const RECORD_KEY = "buzz.solarpunk.sites"
const RESOLVER = `0x${"11".repeat(20)}`
const SITE = "https://viewer.example.com"
const OTHER_SITE = "https://chat.example.com"
const RESOLVE_SELECTOR = "0x9061b923"
const TEXT_SELECTOR = "0x59d1d43c"
const WORD_HEX = 64
const WORD_BYTES = 32
const SELECTOR_HEX = 10
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

/**
 * The Universal Resolver's `(bytes, address)` return value around the
 * resolver's own answer, written out independently.
 */
function universalAnswer(resolved: string, resolver: string): string {
  const inner = resolved.slice(2)
  const padded = inner.padEnd(
    Math.ceil(inner.length / WORD_HEX) * WORD_HEX,
    "0",
  )
  const offset = (WORD_BYTES * 2).toString(16).padStart(WORD_HEX, "0")
  const address = resolver.slice(2).padStart(WORD_HEX, "0")
  const length = (inner.length / 2).toString(16).padStart(WORD_HEX, "0")
  return `0x${offset}${address}${length}${padded}`
}

function rpcResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

interface StubChain {
  resolver?: string
  record?: string
  /** What `text` answers instead of an encoded record. */
  rawText?: string
  status?: number
}

let fetchSpy: MockInstance<typeof fetch>
let chain: StubChain
let now: number
let storage: Map<string, string>

/** A chain endpoint holding one ENS name with one resolver and one record. */
function stubEndpoint(): void {
  fetchSpy.mockImplementation(async (_url, init) => {
    if (chain.status !== undefined) {
      return rpcResponse({}, chain.status)
    }
    const body = JSON.parse(init?.body as string) as {
      method: string
      params: [{ to: string; data: string }, string]
    }
    expect(body.method).toBe("eth_call")
    const [{ to, data }] = body.params
    const node = ensNamehash(ENS_NAME).slice(2)
    expect(to.toLowerCase()).toBe(ENS_UNIVERSAL_RESOLVER_ADDRESS.toLowerCase())
    expect(data.slice(0, SELECTOR_HEX)).toBe(RESOLVE_SELECTOR)
    expect(data).toContain(uint8ArrayToHex(dnsEncodeName(ENS_NAME)))
    expect(data).toContain(`${TEXT_SELECTOR.slice(2)}${node}`)
    expect(data).toContain(
      uint8ArrayToHex(new TextEncoder().encode(RECORD_KEY)),
    )
    if (!chain.resolver) {
      // The Universal Resolver reverts for a name with no resolver anywhere.
      return rpcResponse({
        jsonrpc: "2.0",
        id: 1,
        error: { code: 3, message: "execution reverted" },
      })
    }
    return rpcResponse({
      result: universalAnswer(
        chain.rawText ?? abiString(chain.record ?? ""),
        chain.resolver,
      ),
    })
  })
}

function settings(
  overrides: Partial<SiteAllowListSettings> = {},
): SiteAllowListSettings {
  return {
    rpcUrl: RPC_URL,
    ensName: ENS_NAME,
    recordKey: RECORD_KEY,
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value)
      },
    },
    now: () => now,
    ...overrides,
  }
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  fetchSpy = vi.spyOn(globalThis, "fetch")
  chain = { resolver: RESOLVER, record: `${SITE} ${OTHER_SITE}` }
  now = START
  storage = new Map()
  stubEndpoint()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("parseSiteAllowList", () => {
  it("reads origins separated by spaces, commas and new lines", () => {
    expect(
      parseSiteAllowList(`${SITE},${OTHER_SITE}\n https://a.example.com ,`),
    ).toEqual([SITE, OTHER_SITE, "https://a.example.com"])
  })

  it("ignores and logs every entry that is not a clean https origin", () => {
    const entries = [
      "*.example.com",
      "https://*.example.com",
      "http://viewer.example.com",
      "https://viewer.example.com/",
      "https://Viewer.example.com",
      "http://localhost:3500",
      "example.com",
    ]
    expect(parseSiteAllowList([SITE, ...entries].join(" "))).toEqual([SITE])
    expect(console.warn).toHaveBeenCalledTimes(entries.length)
  })
})

describe("createSiteAllowList", () => {
  it("allows an origin the record names exactly", async () => {
    const list = createSiteAllowList(settings())

    await expect(list.check(SITE)).resolves.toEqual({ allowed: true })
    await expect(list.check(OTHER_SITE)).resolves.toEqual({ allowed: true })
  })

  // Each is one character or one part away from a listed origin.
  it.each([
    ["another port", "https://viewer.example.com:8443", "not-listed"],
    ["plain http", "http://viewer.example.com", "not-clean"],
    ["a subdomain", "https://a.viewer.example.com", "not-listed"],
    ["a parent domain", "https://example.com", "not-listed"],
    ["a trailing slash", "https://viewer.example.com/", "not-clean"],
    ["upper case", "https://Viewer.example.com", "not-clean"],
    ["a suffix", "https://viewer.example.com.evil.example", "not-listed"],
  ])("refuses %s", async (_case, origin, reason) => {
    const list = createSiteAllowList(settings())

    const check = await list.check(origin)
    expect(check).toMatchObject({ allowed: false, reason })
    if (!check.allowed) {
      expect(check.message).toContain(origin)
    }
  })

  describe("fails closed", () => {
    const unavailable = { allowed: false, reason: "list-unavailable" }

    it("when no endpoint is set", async () => {
      const list = createSiteAllowList(settings({ rpcUrl: undefined }))

      await expect(list.check(SITE)).resolves.toMatchObject(unavailable)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it("when the endpoint is unreachable", async () => {
      fetchSpy.mockRejectedValue(new TypeError("fetch failed"))
      const list = createSiteAllowList(settings())

      await expect(list.check(SITE)).resolves.toMatchObject(unavailable)
    })

    it("when the endpoint answers an error status", async () => {
      chain.status = 503
      const list = createSiteAllowList(settings())

      await expect(list.check(SITE)).resolves.toMatchObject(unavailable)
    })

    it("when the name has no resolver", async () => {
      chain.resolver = undefined
      const list = createSiteAllowList(settings())

      await expect(list.check(SITE)).resolves.toMatchObject(unavailable)
    })

    it("when the record is empty", async () => {
      chain.record = ""
      const list = createSiteAllowList(settings())

      await expect(list.check(SITE)).resolves.toMatchObject(unavailable)
    })

    it("when the record holds no valid origin", async () => {
      chain.record = "https://*.example.com http://viewer.example.com"
      const list = createSiteAllowList(settings())

      await expect(list.check(SITE)).resolves.toMatchObject(unavailable)
    })

    it.each([
      ["no data", "0x"],
      [
        "a truncated string",
        `0x${WORD_BYTES.toString(16).padStart(WORD_HEX, "0")}`,
      ],
      ["an offset past the end", `0x${"f".repeat(WORD_HEX)}`],
    ])("when the record is unreadable: %s", async (_case, rawText) => {
      chain.rawText = rawText
      const list = createSiteAllowList(settings())

      await expect(list.check(SITE)).resolves.toMatchObject(unavailable)
    })

    it("when the record's answer is longer than any text record needs", async () => {
      // Large enough that testing it as hex overflows the regex engine's stack.
      chain.rawText = `0x${"ab".repeat(5_000_000)}`
      const list = createSiteAllowList(settings())

      await expect(list.check(SITE)).resolves.toMatchObject(unavailable)
      const warned = vi.mocked(console.warn).mock.calls.at(-1)?.[1]
      expect(warned).not.toBeInstanceOf(RangeError)
      expect(String(warned)).toContain("longer than")
    })

    it("when the ENS name is not a plain lower-case name", async () => {
      const list = createSiteAllowList(settings({ ensName: "SolarPunkID.eth" }))

      await expect(list.check(SITE)).resolves.toMatchObject(unavailable)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it("when the cached list is stale and the endpoint is unreachable", async () => {
      const list = createSiteAllowList(settings())
      await list.check(SITE)

      now += SITE_ALLOW_LIST_CACHE_MS
      fetchSpy.mockRejectedValue(new TypeError("fetch failed"))

      await expect(list.check(SITE)).resolves.toMatchObject(unavailable)
    })
  })

  describe("cache", () => {
    const readsOfTheChain = () => fetchSpy.mock.calls.length

    it("answers from a fresh cached list without asking the chain", async () => {
      const list = createSiteAllowList(settings())
      await list.check(SITE)
      const reads = readsOfTheChain()

      now += SITE_ALLOW_LIST_CACHE_MS - 1
      await expect(list.check(OTHER_SITE)).resolves.toEqual({ allowed: true })
      expect(readsOfTheChain()).toBe(reads)
    })

    it("keeps the list in storage, so the next load answers from it", async () => {
      await createSiteAllowList(settings()).check(SITE)
      expect(storage.has(STORAGE_KEY_SITE_ALLOW_LIST)).toBe(true)
      fetchSpy.mockClear()

      const nextLoad = createSiteAllowList(settings())
      await expect(nextLoad.check(SITE)).resolves.toEqual({ allowed: true })
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it("refetches a list past its limit, and a removed site is refused", async () => {
      const list = createSiteAllowList(settings())
      await list.check(OTHER_SITE)

      chain.record = SITE
      now += SITE_ALLOW_LIST_CACHE_MS
      await expect(list.check(OTHER_SITE)).resolves.toMatchObject({
        allowed: false,
        reason: "not-listed",
      })
    })

    it("does not trust a list cached in the future", async () => {
      await createSiteAllowList(settings()).check(SITE)
      now -= 1
      fetchSpy.mockRejectedValue(new TypeError("fetch failed"))

      await expect(
        createSiteAllowList(settings()).check(SITE),
      ).resolves.toMatchObject({ allowed: false, reason: "list-unavailable" })
    })

    it("does not use a list cached for another name or record key", async () => {
      await createSiteAllowList(settings()).check(SITE)
      fetchSpy.mockRejectedValue(new TypeError("fetch failed"))

      await expect(
        createSiteAllowList(settings({ recordKey: "other.key" })).check(SITE),
      ).resolves.toMatchObject({ allowed: false, reason: "list-unavailable" })
    })

    it("ignores a cache entry that does not parse", async () => {
      storage.set(STORAGE_KEY_SITE_ALLOW_LIST, "{not json")

      await expect(
        createSiteAllowList(settings()).check(SITE),
      ).resolves.toEqual({ allowed: true })
    })

    it("works without storage, keeping the list in memory", async () => {
      const list = createSiteAllowList(settings({ storage: undefined }))
      await list.check(SITE)
      const reads = readsOfTheChain()

      await expect(list.check(OTHER_SITE)).resolves.toEqual({ allowed: true })
      expect(readsOfTheChain()).toBe(reads)
    })

    it("shares one read between checks that arrive together", async () => {
      const list = createSiteAllowList(settings())

      await Promise.all([list.check(SITE), list.check(OTHER_SITE)])
      // One read of the record through the Universal Resolver.
      expect(readsOfTheChain()).toBe(1)
    })
  })

  describe("dev origins", () => {
    const DEV_ORIGIN = "http://localhost:3500"

    it("allows a listed dev origin without reading the chain", async () => {
      const list = createSiteAllowList(
        settings({ rpcUrl: undefined, devOrigins: [DEV_ORIGIN] }),
      )

      await expect(list.check(DEV_ORIGIN)).resolves.toEqual({ allowed: true })
    })

    it("still refuses another local origin", async () => {
      const list = createSiteAllowList(
        settings({ rpcUrl: undefined, devOrigins: [DEV_ORIGIN] }),
      )

      await expect(list.check("http://localhost:3501")).resolves.toMatchObject({
        allowed: false,
      })
    })

    it("ignores a dev origin that is not a clean origin", async () => {
      const list = createSiteAllowList(
        settings({ rpcUrl: undefined, devOrigins: ["http://localhost:3500/"] }),
      )

      await expect(list.check("http://localhost:3500/")).resolves.toMatchObject(
        { allowed: false },
      )
      expect(console.warn).toHaveBeenCalled()
    })
  })
})
