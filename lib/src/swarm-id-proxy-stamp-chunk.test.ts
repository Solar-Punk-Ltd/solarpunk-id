// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Stamp and return: the frame stamps a chunk the app sends through its own
 * Swarm access, on the same write path an upload takes, and hands the stamp
 * back only once the counter it spent is saved.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// Rollup-only virtual module (see rollup.config.js), not resolvable in vitest
vi.mock("virtual:stamp-worker-code", () => ({ default: "" }))

import { BatchId, EthAddress, PrivateKey, Signature } from "@ethersphere/bee-js"
import { Binary } from "cafe-utility"
import { SwarmIdProxy } from "./swarm-id-proxy"
import { calculateChunkAddress } from "./chunk"
import {
  NUM_BUCKETS,
  PARTITION_COUNT,
  UtilizationAwareStamper,
} from "./utils/batch-utilization"
import {
  APP_STAMP_COUNT_LIMIT,
  appBucketCap,
  emptyAppStampUsage,
  parseAppStampUsage,
} from "./proxy/app-stamp-limits"
import {
  SOC_RESTAMP_SLOT_LIMIT,
  emptySocRestampSlots,
  parseSocRestampSlots,
  recordSocSlot,
} from "./proxy/soc-restamp-slots"
import { appStampUsageStorageKey, socRestampSlotsStorageKey } from "./types"
import type { UtilizationStoreDB } from "./storage/utilization-store"
import {
  BACKUP_KEY_LABEL,
  SWARM_ENCRYPTION_LABEL,
  deriveSecretSync,
} from "./utils/key-derivation"
import { hexToUint8Array } from "./utils/hex"

type StampChunkMessage = {
  type: "stampChunk"
  requestId: string
  chunk: unknown
}

type ProxyInternals = {
  handleStampChunk: (
    message: StampChunkMessage,
    event: MessageEvent,
  ) => Promise<void>
  authenticated: boolean
  appSecret?: string
  postageBatchId?: string
  signerKey?: string
  stamper?: UtilizationAwareStamper
  coordinator?: { withWrite: (op: (target: unknown) => unknown) => unknown }
  findConnectionForParent: () => unknown
}

const internals = (p: SwarmIdProxy): ProxyInternals =>
  p as unknown as ProxyInternals

const PARENT_ORIGIN = "https://dapp.example.com"
const OTHER_ORIGIN = "https://other-dapp.example.com"
const GATEWAY_URL = "https://gateway.example.com/"
const APP_SECRET = "11".repeat(32)
const BATCH_ID = "22".repeat(32)
const OTHER_BATCH_ID = "23".repeat(32)
const SIGNER_KEY = "33".repeat(32)
const DERIVATION_KEY = "44".repeat(32)
const ACCOUNT_ADDRESS = "55".repeat(20)
const IDENTIFIER = "66".repeat(32)
const OTHER_IDENTIFIER = "67".repeat(32)
const INBOX_KEY = "88".repeat(32)
const DEPTH = 20
const SPAN_SIZE = 8

const BATCH_ID_BYTES = 32
const INDEX_BYTES = 8
const TIMESTAMP_BYTES = 8
const SLOT_OFFSET = 4

/** The fields of a marshaled stamp, as Bee reads the `swarm-postage-stamp` header. */
function unmarshalStamp(hex: string): {
  batchId: Uint8Array
  index: Uint8Array
  timestamp: Uint8Array
  signature: Uint8Array
  slot: number
  bucket: number
  timestampNs: bigint
} {
  const bytes = hexToUint8Array(hex)
  const indexStart = BATCH_ID_BYTES
  const timestampStart = indexStart + INDEX_BYTES
  const signatureStart = timestampStart + TIMESTAMP_BYTES
  const index = bytes.slice(indexStart, timestampStart)
  const view = new DataView(index.buffer)
  return {
    batchId: bytes.slice(0, indexStart),
    index,
    timestamp: bytes.slice(timestampStart, signatureStart),
    signature: bytes.slice(signatureStart),
    bucket: view.getUint32(0, false),
    slot: view.getUint32(SLOT_OFFSET, false),
    timestampNs: new DataView(
      bytes.buffer,
      bytes.byteOffset + timestampStart,
      TIMESTAMP_BYTES,
    ).getBigUint64(0, false),
  }
}

/** The address a stamp's signature recovers to over `chunkAddress`, as Bee checks it. */
function stampSigner(stampHex: string, chunkAddress: Uint8Array): string {
  const { batchId, index, timestamp, signature } = unmarshalStamp(stampHex)
  return new Signature(signature)
    .recoverPublicKey(
      Binary.concatBytes(chunkAddress, batchId, index, timestamp),
    )
    .address()
    .toHex()
}

/** The bucket a content chunk's address lands in */
function bucketOf(data: Uint8Array): number {
  const address = calculateChunkAddress(data).toUint8Array()
  return (address[0] << 8) | address[1]
}

function spanAndPayload(text: string): Uint8Array {
  const payload = new TextEncoder().encode(text)
  const span = new Uint8Array(SPAN_SIZE)
  new DataView(span.buffer).setBigUint64(0, BigInt(payload.length), true)
  return Binary.concatBytes(span, payload)
}

describe("SwarmIdProxy stampChunk", () => {
  let proxy: SwarmIdProxy
  let source: { postMessage: ReturnType<typeof vi.fn> }
  let parentWindow: { postMessage: ReturnType<typeof vi.fn> }
  let messageListener: (event: MessageEvent) => Promise<void>
  let listeners: Record<string, unknown>
  let store: Map<string, string>
  let order: string[]

  const replies = () =>
    source.postMessage.mock.calls.map(([message]) => message)
  const lastReply = () => replies()[replies().length - 1]

  const stampChunk = (
    chunk: unknown,
    requestId = "r1",
    origin = PARENT_ORIGIN,
  ) =>
    internals(proxy).handleStampChunk(
      { type: "stampChunk", requestId, chunk },
      { source, origin } as unknown as MessageEvent,
    )

  const identify = (subsidisedGatewayUrl?: string, origin = PARENT_ORIGIN) =>
    messageListener({
      data: {
        type: "parentIdentify",
        requestId: "identify",
        metadata: { name: "Test App" },
        subsidisedGatewayUrl,
      },
      origin,
      source: parentWindow,
    } as unknown as MessageEvent)

  /** A fresh frame over the same storage, as a reload leaves it */
  const reloadProxy = () => {
    proxy = new SwarmIdProxy()
    messageListener = listeners["message"] as typeof messageListener
  }

  const storedUsage = (batchId = BATCH_ID) =>
    parseAppStampUsage(
      store.get(appStampUsageStorageKey(PARENT_ORIGIN, batchId)) ?? null,
    )

  async function userStampMode({
    batchId = BATCH_ID,
    localCounter = new Uint32Array(NUM_BUCKETS),
    saveFails = false,
    partition = 0,
    origin = PARENT_ORIGIN,
  } = {}): Promise<UtilizationAwareStamper> {
    const cache = {
      getAllChunks: async () => [],
      putChunk: async () => {
        if (saveFails) throw new Error("IndexedDB write failed")
      },
    } as unknown as UtilizationStoreDB
    const swarmEncryptionKey = deriveSecretSync(
      DERIVATION_KEY,
      SWARM_ENCRYPTION_LABEL,
    )
    const stamper = await UtilizationAwareStamper.create(
      SIGNER_KEY,
      new BatchId(batchId),
      DEPTH,
      cache,
      new EthAddress(ACCOUNT_ADDRESS),
      hexToUint8Array(swarmEncryptionKey),
    )
    stamper.bindPartition({
      partition,
      partitionCount: PARTITION_COUNT,
      localCounter,
    })
    const target = { mode: "stamper", bee: {}, stamper }
    const p = internals(proxy)
    p.authenticated = true
    p.appSecret = APP_SECRET
    p.postageBatchId = batchId
    p.signerKey = SIGNER_KEY
    p.stamper = stamper
    // Stands in for the write coordinator: the op runs under the lock, and the
    // counter publish and the state flush come after it, before it resolves.
    p.coordinator = {
      withWrite: vi.fn(async (op: (target: unknown) => unknown) => {
        order.push("lock")
        const result = await op(target)
        order.push("counter published and flushed")
        return result
      }),
    }
    vi.spyOn(p, "findConnectionForParent").mockReturnValue({
      account: {
        id: new EthAddress(ACCOUNT_ADDRESS),
        derivationKey: DERIVATION_KEY,
      },
      app: { appUrl: origin },
    })
    return stamper
  }

  beforeEach(async () => {
    vi.restoreAllMocks()
    store = new Map<string, string>()
    const localStorageFake = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    } as unknown as Storage
    vi.stubGlobal("localStorage", localStorageFake)

    listeners = {}
    parentWindow = { postMessage: vi.fn() }
    vi.stubGlobal("window", {
      addEventListener: vi.fn((type: string, listener: unknown) => {
        listeners[type] = listener
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      parent: parentWindow,
      location: { origin: "https://id.example.com", pathname: "/proxy" },
      localStorage: localStorageFake,
    })
    reloadProxy()
    order = []
    source = {
      postMessage: vi.fn((message: { type: string }) =>
        order.push(message.type),
      ),
    }
  })

  it("stamps a content chunk and returns its address and a stamp that verifies against the batch owner", async () => {
    await identify()
    await userStampMode()
    const data = spanAndPayload("hello swarm")

    await stampChunk({ kind: "content", data })

    const reply = lastReply()
    expect(reply).toMatchObject({ type: "stampChunkResponse", requestId: "r1" })
    const address = calculateChunkAddress(data).toUint8Array()
    expect(reply.address).toBe(Binary.uint8ArrayToHex(address))
    expect(unmarshalStamp(reply.stamp).batchId).toEqual(
      hexToUint8Array(BATCH_ID),
    )
    expect(stampSigner(reply.stamp, address)).toBe(
      new PrivateKey(SIGNER_KEY).publicKey().address().toHex(),
    )
    expect(reply.owner).toBeUndefined()
    expect(reply.signature).toBeUndefined()
  })

  it("replies only after the write path has saved and published the counter", async () => {
    await identify()
    await userStampMode()

    await stampChunk({ kind: "content", data: spanAndPayload("ordered") })

    expect(order).toEqual([
      "lock",
      "counter published and flushed",
      "stampChunkResponse",
    ])
  })

  it("refuses, with no stamp in the reply, when the counter it spent could not be saved", async () => {
    await identify()
    await userStampMode({ saveFails: true })
    vi.spyOn(console, "error").mockImplementation(() => undefined)

    await stampChunk({ kind: "content", data: spanAndPayload("unsaved") })

    const reply = lastReply()
    expect(reply).toMatchObject({
      type: "error",
      requestId: "r1",
      code: "internal",
      error: expect.stringContaining("could not be saved"),
    })
    expect(reply.stamp).toBeUndefined()
    expect(replies().some((r) => r.type === "stampChunkResponse")).toBe(false)
  })

  it("never returns the same bucket slot twice, nor a reserved one", async () => {
    await identify()
    await userStampMode()
    const data = spanAndPayload("the same chunk twice")

    await stampChunk({ kind: "content", data }, "r1")
    const first = unmarshalStamp(lastReply().stamp)
    await stampChunk({ kind: "content", data }, "r2")
    const second = unmarshalStamp(lastReply().stamp)

    expect(second.bucket).toBe(first.bucket)
    expect(second.slot).not.toBe(first.slot)
    expect(first.slot).toBeGreaterThanOrEqual(PARTITION_COUNT)
    expect(second.slot).toBeGreaterThanOrEqual(PARTITION_COUNT)
  })

  it("signs a single-owner chunk with the app secret and returns its owner and signature", async () => {
    await identify()
    await userStampMode()
    const data = spanAndPayload("own feed copy")

    await stampChunk({
      kind: "soc",
      identifier: IDENTIFIER,
      data,
      signer: "app",
    })

    const reply = lastReply()
    const owner = new PrivateKey(APP_SECRET).publicKey().address()
    expect(reply).toMatchObject({
      type: "stampChunkResponse",
      owner: owner.toHex(),
    })
    const socAddress = Binary.keccak256(
      Binary.concatBytes(hexToUint8Array(IDENTIFIER), owner.toUint8Array()),
    )
    expect(reply.address).toBe(Binary.uint8ArrayToHex(socAddress))
    const digest = Binary.concatBytes(
      hexToUint8Array(IDENTIFIER),
      calculateChunkAddress(data).toUint8Array(),
    )
    expect(
      new Signature(hexToUint8Array(reply.signature))
        .recoverPublicKey(digest)
        .address()
        .toHex(),
    ).toBe(owner.toHex())
    expect(stampSigner(reply.stamp, socAddress)).toBe(
      new PrivateKey(SIGNER_KEY).publicKey().address().toHex(),
    )
  })

  it("refuses a single-owner chunk owned by the account's backup signer", async () => {
    await identify()
    await userStampMode()
    const backupKey = deriveSecretSync(
      deriveSecretSync(DERIVATION_KEY, SWARM_ENCRYPTION_LABEL),
      BACKUP_KEY_LABEL,
    )

    await stampChunk({
      kind: "soc",
      identifier: IDENTIFIER,
      data: spanAndPayload("forged lock"),
      signer: { privateKey: backupKey },
    })

    expect(lastReply()).toMatchObject({
      type: "error",
      requestId: "r1",
      code: "invalid-request",
    })
  })

  it("refuses in subsidised mode, saying so", async () => {
    await identify(GATEWAY_URL)
    internals(proxy).authenticated = true
    internals(proxy).appSecret = APP_SECRET

    await stampChunk({ kind: "content", data: spanAndPayload("free ride") })

    expect(lastReply()).toMatchObject({
      type: "error",
      requestId: "r1",
      code: "upload-unavailable",
      reason: "subsidised",
      error: expect.stringContaining("subsidised mode"),
    })
  })

  it("refuses when not authenticated", async () => {
    await identify()

    await stampChunk({ kind: "content", data: spanAndPayload("anyone") })

    expect(lastReply()).toMatchObject({
      type: "error",
      code: "not-authenticated",
    })
  })

  it("never answers a pre-signed chunk that reaches it over postMessage", async () => {
    await identify()
    await userStampMode()

    await messageListener({
      data: {
        type: "stampChunk",
        requestId: "r1",
        chunk: {
          kind: "soc",
          identifier: IDENTIFIER,
          data: spanAndPayload("pre-signed"),
          signer: "app",
          signature: "77".repeat(65),
        },
      },
      origin: PARENT_ORIGIN,
      source: parentWindow,
    } as unknown as MessageEvent)

    const answered = parentWindow.postMessage.mock.calls.filter(
      ([message]) => message?.requestId === "r1",
    )
    expect(answered).toHaveLength(0)
    expect(internals(proxy).coordinator?.withWrite).not.toHaveBeenCalled()
  })

  describe("the same single-owner chunk stamped again", () => {
    const inbox = (text: string, identifier = IDENTIFIER) => ({
      kind: "soc",
      identifier,
      data: spanAndPayload(text),
      signer: { privateKey: INBOX_KEY },
    })
    const inboxAddress = (identifier = IDENTIFIER) =>
      Binary.keccak256(
        Binary.concatBytes(
          hexToUint8Array(identifier),
          new PrivateKey(INBOX_KEY).publicKey().address().toUint8Array(),
        ),
      )
    const counterCopy = (stamper: UtilizationAwareStamper) =>
      new Uint32Array(stamper.getLocalCounter() ?? new Uint32Array(NUM_BUCKETS))

    it("reuses the slot with a newer timestamp, spending no slot and no bucket share", async () => {
      await identify()
      const stamper = await userStampMode()
      const address = inboxAddress()
      const bucket = (address[0] << 8) | address[1]

      await stampChunk(inbox("first message"), "r1")
      const first = unmarshalStamp(lastReply().stamp)
      await stampChunk(inbox("second message"), "r2")
      const second = lastReply()
      const restamped = unmarshalStamp(second.stamp)

      expect(second).toMatchObject({
        type: "stampChunkResponse",
        address: Binary.uint8ArrayToHex(address),
      })
      expect(restamped.index).toEqual(first.index)
      expect(restamped.timestampNs).toBeGreaterThan(first.timestampNs)
      expect(stampSigner(second.stamp, address)).toBe(
        new PrivateKey(SIGNER_KEY).publicKey().address().toHex(),
      )
      expect(stamper.getLocalCounter()?.[bucket]).toBe(1)
      expect(storedUsage().count).toBe(1)
      expect(storedUsage().windowCount).toBe(2)
      expect(storedUsage().buckets[bucket]).toBe(1)
    })

    it("keeps the slot across a frame reload", async () => {
      await identify()
      const stamper = await userStampMode()
      await stampChunk(inbox("before reload"), "r1")
      const first = unmarshalStamp(lastReply().stamp)

      reloadProxy()
      await identify()
      await userStampMode({ localCounter: counterCopy(stamper) })
      await stampChunk(inbox("after reload"), "r2")

      expect(unmarshalStamp(lastReply().stamp).index).toEqual(first.index)
    })

    it("does not share the slot with another site or another stamp", async () => {
      await identify()
      const stamper = await userStampMode()
      await stampChunk(inbox("this site"), "r1")
      const first = unmarshalStamp(lastReply().stamp)
      const counter = counterCopy(stamper)

      reloadProxy()
      await identify(undefined, OTHER_ORIGIN)
      await userStampMode({ localCounter: counter, origin: OTHER_ORIGIN })
      await stampChunk(inbox("other site"), "r2", OTHER_ORIGIN)
      expect(unmarshalStamp(lastReply().stamp).slot).not.toBe(first.slot)

      reloadProxy()
      await identify()
      await userStampMode({ batchId: OTHER_BATCH_ID, localCounter: counter })
      await stampChunk(inbox("other stamp"), "r3")
      expect(unmarshalStamp(lastReply().stamp).slot).not.toBe(first.slot)
    })

    const storedSlot = (address: Uint8Array) =>
      parseSocRestampSlots(
        store.get(socRestampSlotsStorageKey(PARENT_ORIGIN, BATCH_ID)) ?? null,
        { partition: 0, partitionCount: PARTITION_COUNT },
      ).slots[Binary.uint8ArrayToHex(address)]

    it("records the slot before it replies", async () => {
      await identify()
      await userStampMode()
      const address = inboxAddress()
      let recordedAtReply: unknown
      source.postMessage.mockImplementation(() => {
        recordedAtReply = storedSlot(address)
      })

      await stampChunk(inbox("recorded"), "r1")

      expect(lastReply()).toMatchObject({ type: "stampChunkResponse" })
      expect(recordedAtReply).toEqual({
        slot: unmarshalStamp(lastReply().stamp).slot,
        timestampMs: expect.any(Number),
      })
    })

    it("records no slot when the counter could not be saved, and the next stamp takes a new slot", async () => {
      await identify()
      const stamper = await userStampMode({ saveFails: true })
      vi.spyOn(console, "error").mockImplementation(() => undefined)
      const address = inboxAddress()
      const bucket = (address[0] << 8) | address[1]

      await stampChunk(inbox("unsaved"), "r1")
      expect(lastReply()).toMatchObject({ type: "error", requestId: "r1" })
      expect(storedSlot(address)).toBeUndefined()

      const next = await userStampMode({ localCounter: counterCopy(stamper) })
      const spentBefore = next.getLocalCounter()?.[bucket] ?? 0
      await stampChunk(inbox("saved"), "r2")

      expect(lastReply()).toMatchObject({ type: "stampChunkResponse" })
      expect(next.getLocalCounter()?.[bucket]).toBe(spentBefore + 1)
    })

    it("records no slot when the counter could not be published, and the next stamp takes a new slot", async () => {
      await identify()
      const stamper = await userStampMode()
      const target = { mode: "stamper", bee: {}, stamper }
      internals(proxy).coordinator = {
        withWrite: vi.fn(async (op: (target: unknown) => unknown) => {
          await op(target)
          throw new Error("partition state publish failed")
        }),
      }
      const address = inboxAddress()
      const bucket = (address[0] << 8) | address[1]

      await stampChunk(inbox("unpublished"), "r1")
      expect(lastReply()).toMatchObject({ type: "error", requestId: "r1" })
      expect(storedSlot(address)).toBeUndefined()

      const next = await userStampMode({ localCounter: counterCopy(stamper) })
      const spentBefore = next.getLocalCounter()?.[bucket] ?? 0
      await stampChunk(inbox("published"), "r2")

      expect(lastReply()).toMatchObject({ type: "stampChunkResponse" })
      expect(next.getLocalCounter()?.[bucket]).toBe(spentBefore + 1)
    })

    it("takes a new slot for another address", async () => {
      await identify()
      await userStampMode()

      await stampChunk(inbox("one inbox"), "r1")
      const first = unmarshalStamp(lastReply().stamp)
      await stampChunk(inbox("another inbox", OTHER_IDENTIFIER), "r2")
      const other = unmarshalStamp(lastReply().stamp)

      expect(other.index).not.toEqual(first.index)
    })

    it("takes a new slot once this device holds another lane", async () => {
      await identify()
      const stamper = await userStampMode()
      await stampChunk(inbox("partition 0"), "r1")
      const first = unmarshalStamp(lastReply().stamp)

      await userStampMode({ partition: 1, localCounter: counterCopy(stamper) })
      await stampChunk(inbox("partition 1"), "r2")

      expect(unmarshalStamp(lastReply().stamp).slot).not.toBe(first.slot)
    })

    it("takes a new slot each time when the record is full", async () => {
      let full = emptySocRestampSlots({
        partition: 0,
        partitionCount: PARTITION_COUNT,
      })
      for (let i = 0; i < SOC_RESTAMP_SLOT_LIMIT; i++) {
        full = recordSocSlot(full, i.toString(16).padStart(64, "0"), i, 0)
      }
      store.set(
        socRestampSlotsStorageKey(PARENT_ORIGIN, BATCH_ID),
        JSON.stringify(full),
      )
      await identify()
      await userStampMode()

      await stampChunk(inbox("full one"), "r1")
      const first = unmarshalStamp(lastReply().stamp)
      await stampChunk(inbox("full two"), "r2")

      expect(unmarshalStamp(lastReply().stamp).slot).not.toBe(first.slot)
    })

    it("keeps stamping again once the app has spent its count of new slots", async () => {
      await identify()
      await userStampMode()
      await stampChunk(inbox("first message"), "r1")
      store.set(
        appStampUsageStorageKey(PARENT_ORIGIN, BATCH_ID),
        JSON.stringify({
          ...storedUsage(),
          count: APP_STAMP_COUNT_LIMIT - 1,
        }),
      )

      for (let i = 0; i < 3; i++) {
        await stampChunk(inbox(`message ${i}`), `again${i}`)
        expect(lastReply()).toMatchObject({ type: "stampChunkResponse" })
      }
      expect(storedUsage().count).toBe(APP_STAMP_COUNT_LIMIT - 1)
    })

    it("stamps one millisecond past the last when the clock went back", async () => {
      const now = 1_800_000_000_000
      const clock = vi.spyOn(Date, "now").mockReturnValue(now)
      await identify()
      await userStampMode()
      await stampChunk(inbox("on time"), "r1")
      const first = unmarshalStamp(lastReply().stamp)

      clock.mockReturnValue(now - 60_000)
      await stampChunk(inbox("clock went back"), "r2")
      const again = unmarshalStamp(lastReply().stamp)

      expect(again.index).toEqual(first.index)
      expect(first.timestampNs).toBe(BigInt(now) * 1_000_000n)
      expect(again.timestampNs).toBe(BigInt(now + 1) * 1_000_000n)
    })
  })

  describe("limits per app", () => {
    it("counts each stamp under the app's origin and the stamp it spent", async () => {
      await identify()
      await userStampMode()

      await stampChunk({ kind: "content", data: spanAndPayload("counted") })

      expect(lastReply()).toMatchObject({ type: "stampChunkResponse" })
      expect(storedUsage().count).toBe(1)
      expect(storedUsage().windowCount).toBe(1)
    })

    it("refuses past the count limit, and the count survives a reload", async () => {
      store.set(
        appStampUsageStorageKey(PARENT_ORIGIN, BATCH_ID),
        JSON.stringify({
          ...emptyAppStampUsage(),
          count: APP_STAMP_COUNT_LIMIT - 1,
        }),
      )
      await identify()
      await userStampMode()
      await stampChunk({ kind: "content", data: spanAndPayload("last one") })
      expect(lastReply()).toMatchObject({ type: "stampChunkResponse" })

      reloadProxy()
      await identify()
      await userStampMode()
      await stampChunk(
        { kind: "content", data: spanAndPayload("one too many") },
        "r2",
      )

      expect(lastReply()).toMatchObject({
        type: "error",
        requestId: "r2",
        code: "upload-unavailable",
        reason: "app-stamp-count",
        error: expect.stringContaining("count limit"),
      })
      expect(storedUsage().count).toBe(APP_STAMP_COUNT_LIMIT)
    })

    it("starts a new count on another stamp", async () => {
      store.set(
        appStampUsageStorageKey(PARENT_ORIGIN, BATCH_ID),
        JSON.stringify({
          ...emptyAppStampUsage(),
          count: APP_STAMP_COUNT_LIMIT,
        }),
      )
      await identify()
      await userStampMode({ batchId: OTHER_BATCH_ID })

      await stampChunk({ kind: "content", data: spanAndPayload("new stamp") })

      expect(lastReply()).toMatchObject({ type: "stampChunkResponse" })
      expect(storedUsage(OTHER_BATCH_ID).count).toBe(1)
    })

    it("refuses an app past its share of one bucket, without spending a slot", async () => {
      await identify()
      const stamper = await userStampMode()
      const data = spanAndPayload("the same bucket every time")
      const bucket = bucketOf(data)
      const cap = appBucketCap(stamper.laneCapacity())

      for (let i = 0; i < cap; i++) {
        await stampChunk({ kind: "content", data }, `r${i}`)
        expect(lastReply()).toMatchObject({ type: "stampChunkResponse" })
      }
      await stampChunk({ kind: "content", data }, "over")

      expect(lastReply()).toMatchObject({
        type: "error",
        requestId: "over",
        code: "upload-unavailable",
        reason: "app-bucket-share",
      })
      expect(stamper.getLocalCounter()?.[bucket]).toBe(cap)
      expect(storedUsage().count).toBe(cap)
    })

    it("refuses an app stamp in a bucket whose app slice the account has used, naming the slice", async () => {
      await identify()
      const data = spanAndPayload("a bucket the account filled")
      const bucket = bucketOf(data)
      const localCounter = new Uint32Array(NUM_BUCKETS)
      const probe = await userStampMode()
      localCounter[bucket] = probe.appSliceCapacity()
      await userStampMode({ localCounter })

      await stampChunk({ kind: "content", data })

      expect(lastReply()).toMatchObject({
        type: "error",
        code: "upload-unavailable",
        reason: "app-slice-full",
        error: expect.stringContaining("own uploads"),
      })
      expect(storedUsage().count).toBe(0)
    })
  })
})
