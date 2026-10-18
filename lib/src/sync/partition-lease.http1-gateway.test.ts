// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * A site's frame claims a share of the drive through the public gateway, Swarm
 * ID's default, which speaks HTTP/1.1 only. A browser keeps at most six
 * requests open to such an origin and queues the rest itself, and the gateway
 * takes seconds to say a chunk is missing. These tests run the claim against a
 * fake of that pair, a real `Bee` client reaching it through `fetch`, with the
 * clock faked so the seconds cost nothing.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { BatchId, Bee } from "@ethersphere/bee-js"
import { Binary } from "cafe-utility"
import { calculateChunkAddress } from "../chunk"
import { PartitionLease } from "./partition-lease"
import { readLatestDeviceState } from "./device-state"
import { PARTITION_COUNT } from "../utils/batch-utilization"
import {
  createMockStamper,
  createTestSigner,
} from "../proxy/feeds/epochs/test-utils"

const GATEWAY_URL = "https://gateway.example"
/** How many requests a browser keeps open to one HTTP/1.1 origin. */
const BROWSER_CONNECTIONS_PER_ORIGIN = 6
/**
 * The public gateway's answer times, measured 2026-10-18: a missing chunk
 * 2.8 to 5.7 s, the upper end here, a present one about 0.3 s.
 */
const MISS_MS = 5_000
const HIT_MS = 300
/**
 * Faked time the claim gets. With the production intent round it needs about
 * 36 s here once its reads go first and are timed from when they are sent.
 */
const CLAIM_BUDGET_MS = 60_000

const HTTP_OK = 200
const HTTP_CREATED = 201
const HTTP_NOT_FOUND = 404

const DEVICE = "frame-device-1"
const RIVAL = "phone-device-2"
const ACCOUNT_ID = "ac".repeat(20)
/**
 * Devices whose state the frame's background fold reads as the claim starts.
 * Each site's frame is a device of its own, so an account used on a few sites
 * carries a dozen. Their reads queue ahead of the claim's, as the 344 requests
 * a live frame made to the public gateway on 2026-10-18 did.
 */
const FOLDED_DEVICE_COUNT = 12
const FOLDED_DEVICES = Array.from(
  { length: FOLDED_DEVICE_COUNT },
  (_, i) => `folded-device-${i}`,
)
const BATCH_ID = new BatchId("ab".repeat(32))
const BATCH_DEPTH = 24
const ENCRYPTION_KEY = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff)

function abortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError")
}

/** Wait `ms`, or reject the moment `signal` aborts. */
function abortableDelay(
  ms: number,
  signal?: AbortSignal | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener("abort", () => {
      clearTimeout(timer)
      reject(abortError())
    })
  })
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

/**
 * The browser and the gateway together: at most six requests answered at
 * once, the rest waiting their turn in order, a miss answered with Bee's own
 * JSON 404 after {@link MISS_MS}. An aborted request leaves its place at once,
 * as a browser drops the connection.
 */
class Http1Gateway {
  private readonly chunks = new Map<string, Uint8Array>()
  private open = 0
  private readonly waiting: (() => void)[] = []
  mostOpen = 0

  readonly fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    await this.connect(init?.signal)
    try {
      return await this.answer(new URL(String(input)), init)
    } finally {
      this.disconnect()
    }
  }

  private connect(signal?: AbortSignal | null): Promise<void> {
    if (this.open < BROWSER_CONNECTIONS_PER_ORIGIN) {
      this.opened()
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const take = () => {
        this.opened()
        resolve()
      }
      this.waiting.push(take)
      signal?.addEventListener("abort", () => {
        const at = this.waiting.indexOf(take)
        if (at === -1) return
        this.waiting.splice(at, 1)
        reject(abortError())
      })
    })
  }

  private opened(): void {
    this.open++
    this.mostOpen = Math.max(this.mostOpen, this.open)
  }

  private disconnect(): void {
    this.open--
    this.waiting.shift()?.()
  }

  private async answer(url: URL, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? "GET").toUpperCase()
    const path = url.pathname.split("/").filter(Boolean)
    if (method === "GET" && path[0] === "chunks") {
      const data = this.chunks.get(path[1])
      await abortableDelay(data ? HIT_MS : MISS_MS, init?.signal)
      return data
        ? new Response(data, { status: HTTP_OK })
        : json(HTTP_NOT_FOUND, { code: HTTP_NOT_FOUND, message: "Not Found" })
    }
    await abortableDelay(HIT_MS, init?.signal)
    const body = new Uint8Array(
      await new Response(init?.body ?? undefined).arrayBuffer(),
    )
    if (method === "POST" && path[0] === "soc") {
      const owner = Binary.hexToUint8Array(path[1])
      const identifier = Binary.hexToUint8Array(path[2])
      const signature = Binary.hexToUint8Array(url.searchParams.get("sig")!)
      const address = Binary.uint8ArrayToHex(
        Binary.keccak256(Binary.concatBytes(identifier, owner)),
      )
      this.chunks.set(address, Binary.concatBytes(identifier, signature, body))
      return json(HTTP_CREATED, { reference: address })
    }
    if (method === "POST" && path[0] === "chunks") {
      const address = (await calculateChunkAddress(body)).toHex()
      this.chunks.set(address, body)
      return json(HTTP_CREATED, { reference: address })
    }
    if (method === "POST" && path[0] === "tags") {
      return json(HTTP_CREATED, { uid: 1 })
    }
    return json(HTTP_NOT_FOUND, { code: HTTP_NOT_FOUND, message: "Not Found" })
  }
}

/** Settle `work` within `ms` of faked time, or say it never did. */
async function settleWithin<T>(
  work: Promise<T>,
  ms: number,
): Promise<{ settled: true; value: T } | { settled: false }> {
  let outcome: { settled: true; value: T } | { settled: false } = {
    settled: false,
  }
  void work.then((value) => {
    outcome = { settled: true, value }
  })
  await vi.advanceTimersByTimeAsync(ms)
  return outcome
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("PartitionLease.acquire through a browser's six connections to an HTTP/1.1 gateway", () => {
  it("claims a fresh partition while the frame's background fold is reading", async () => {
    // The clock too: the intent round watches for rivals until a deadline.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
    const gateway = new Http1Gateway()
    vi.stubGlobal("fetch", gateway.fetch)
    const bee = new Bee(GATEWAY_URL)
    const deviceStateOwner = createTestSigner().publicKey().address()
    // Every acquire starts the device registry's refresh beside it, a fold of
    // each known device's state, so the claim's reads arrive behind those.
    const fold = Promise.all(
      FOLDED_DEVICES.map((deviceId) =>
        readLatestDeviceState({
          bee,
          accountId: ACCOUNT_ID,
          deviceId,
          owner: deviceStateOwner,
        }).catch(() => undefined),
      ),
    )
    // Built the way the coordinator builds it, after the refresh has started.
    // A known rival is what a viewer's frame has beside the person's own
    // device: its presence and occupancy reads join the lock and state
    // pointer reads, twelve misses at once.
    const lease = await PartitionLease.fromSwarmEncryptionKey({
      bee,
      deviceId: DEVICE,
      batchId: BATCH_ID,
      batchDepth: BATCH_DEPTH,
      swarmEncryptionKey: ENCRYPTION_KEY,
      stamper: createMockStamper(),
      knownDeviceIds: () => [DEVICE, RIVAL],
    })

    const claim = await settleWithin(
      lease.acquire({ partitionCount: PARTITION_COUNT }),
      CLAIM_BUDGET_MS,
    )

    await settleWithin(fold, CLAIM_BUDGET_MS)
    expect(claim.settled).toBe(true)
    if (!claim.settled) return
    expect(claim.value.isReadOnly).toBe(false)
    expect(claim.value.partition).toBeDefined()
    expect(gateway.mostOpen).toBeLessThanOrEqual(BROWSER_CONNECTIONS_PER_ORIGIN)
  })
})
