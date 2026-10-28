// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * What the frame tells a site about the stamp it uses: read live where the
 * chain or the Bee node answers, and never with more time left than the batch
 * really has.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { MockInstance } from "vitest"

// Rollup-only virtual module (see rollup.config.js), not resolvable in vitest
vi.mock("virtual:stamp-worker-code", () => ({ default: "" }))

import { SwarmIdProxy } from "./swarm-id-proxy"
import { allowingSites, createPostageStamp } from "./test-fixtures"
import type { PostageStamp } from "./types"

type ProxyInternals = {
  handleGetPostageBatch: (
    message: { type: "getPostageBatch"; requestId: string },
    event: MessageEvent,
  ) => Promise<void>
  lookupPostageStampForApp: () => PostageStamp | undefined
  gnosisRpcUrl: string
  siteBeeApiUrl: string | undefined
}

const internals = (p: SwarmIdProxy): ProxyInternals =>
  p as unknown as ProxyInternals

const PARENT_ORIGIN = "https://dapp.example.com"
const RPC = "https://rpc.example"
const BEE = "https://bee.example"
const DAY_SECONDS = 24 * 60 * 60
const DAY_MS = DAY_SECONDS * 1000

/** A 32-byte ABI word of zeroes, as the contract answers for each field of a batch it does not hold. */
const ZERO_WORD = "0".repeat(64)

function rpcAnswer(batchHeld: boolean): Response {
  const body = [
    {
      jsonrpc: "2.0",
      id: 0,
      result:
        "0x" +
        (batchHeld ? "1".padStart(64, "0") : ZERO_WORD) +
        ZERO_WORD.repeat(5),
    },
    { jsonrpc: "2.0", id: 1, result: "0x" + ZERO_WORD },
    { jsonrpc: "2.0", id: 2, result: "0x" + "1".padStart(64, "0") },
  ]
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response
}

const beeDoesNotTrackIt = {
  ok: false,
  status: 404,
  json: () => Promise.resolve({}),
} as Response

describe("SwarmIdProxy getPostageBatch", () => {
  let proxy: SwarmIdProxy
  let fetchSpy: MockInstance<typeof fetch>
  let source: { postMessage: ReturnType<typeof vi.fn> }

  /** The stamp as the frame reports it, for a stored record of `stamp`. */
  async function reported(stamp: PostageStamp) {
    internals(proxy).lookupPostageStampForApp = () => stamp
    await internals(proxy).handleGetPostageBatch(
      { type: "getPostageBatch", requestId: "r1" },
      { source, origin: PARENT_ORIGIN } as unknown as MessageEvent,
    )
    const [reply] = source.postMessage.mock.calls.at(-1) ?? []
    return reply.postageBatch
  }

  beforeEach(() => {
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      parent: { postMessage: vi.fn() },
      location: { origin: "https://id.example.com", pathname: "/proxy" },
    })
    proxy = new SwarmIdProxy({ siteAllowList: allowingSites(PARENT_ORIGIN) })
    internals(proxy).gnosisRpcUrl = RPC
    internals(proxy).siteBeeApiUrl = BEE
    source = { postMessage: vi.fn() }
    fetchSpy = vi.spyOn(globalThis, "fetch")
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it("reports a batch the contract no longer holds as gone, with no time left, though its record was made with days to go", async () => {
    fetchSpy.mockImplementation((url) =>
      Promise.resolve(url === RPC ? rpcAnswer(false) : beeDoesNotTrackIt),
    )

    const batch = await reported(
      createPostageStamp({ batchTTL: 14 * DAY_SECONDS, createdAt: Date.now() }),
    )

    expect(batch).toMatchObject({ exists: false, usable: false, batchTTL: 0 })
  })

  it("ages the stored lifetime to now when neither the chain nor the Bee node answers, rather than estimating from the deposit", async () => {
    fetchSpy.mockImplementation((url) =>
      url === RPC
        ? Promise.reject(new Error("rpc down"))
        : Promise.resolve(beeDoesNotTrackIt),
    )

    const batch = await reported(
      createPostageStamp({
        batchTTL: 14 * DAY_SECONDS,
        createdAt: Date.now() - 15 * DAY_MS,
      }),
    )

    expect(batch).toMatchObject({ batchTTL: 0, usable: false })
    expect(fetchSpy.mock.calls.map(([url]) => String(url))).not.toContain(
      expect.stringContaining("swarmscan"),
    )
  })

  it("says nothing of the time left when no source knows it", async () => {
    fetchSpy.mockImplementation((url) =>
      url === RPC
        ? Promise.reject(new Error("rpc down"))
        : Promise.resolve(beeDoesNotTrackIt),
    )

    const batch = await reported(createPostageStamp({ batchTTL: undefined }))

    expect(batch.batchTTL).toBeUndefined()
    expect(batch.usable).toBe(true)
  })
})
