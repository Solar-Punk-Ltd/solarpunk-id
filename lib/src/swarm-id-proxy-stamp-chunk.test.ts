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
const GATEWAY_URL = "https://gateway.example.com/"
const APP_SECRET = "11".repeat(32)
const BATCH_ID = "22".repeat(32)
const SIGNER_KEY = "33".repeat(32)
const DERIVATION_KEY = "44".repeat(32)
const ACCOUNT_ADDRESS = "55".repeat(20)
const IDENTIFIER = "66".repeat(32)
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
  let order: string[]

  const replies = () =>
    source.postMessage.mock.calls.map(([message]) => message)
  const lastReply = () => replies()[replies().length - 1]

  const stampChunk = (chunk: unknown, requestId = "r1") =>
    internals(proxy).handleStampChunk(
      { type: "stampChunk", requestId, chunk },
      { source, origin: PARENT_ORIGIN } as unknown as MessageEvent,
    )

  const identify = (subsidisedGatewayUrl?: string) =>
    messageListener({
      data: {
        type: "parentIdentify",
        requestId: "identify",
        metadata: { name: "Test App" },
        subsidisedGatewayUrl,
      },
      origin: PARENT_ORIGIN,
      source: parentWindow,
    } as unknown as MessageEvent)

  async function userStampMode(): Promise<UtilizationAwareStamper> {
    const cache = {
      getAllChunks: async () => [],
      putChunk: async () => undefined,
    } as unknown as UtilizationStoreDB
    const swarmEncryptionKey = deriveSecretSync(
      DERIVATION_KEY,
      SWARM_ENCRYPTION_LABEL,
    )
    const stamper = await UtilizationAwareStamper.create(
      SIGNER_KEY,
      new BatchId(BATCH_ID),
      DEPTH,
      cache,
      new EthAddress(ACCOUNT_ADDRESS),
      hexToUint8Array(swarmEncryptionKey),
    )
    stamper.bindPartition({
      partition: 0,
      partitionCount: PARTITION_COUNT,
      localCounter: new Uint32Array(NUM_BUCKETS),
    })
    const target = { mode: "stamper", bee: {}, stamper }
    const p = internals(proxy)
    p.authenticated = true
    p.appSecret = APP_SECRET
    p.postageBatchId = BATCH_ID
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
      app: { appUrl: PARENT_ORIGIN },
    })
    return stamper
  }

  beforeEach(async () => {
    vi.restoreAllMocks()
    const store = new Map<string, string>()
    const localStorageFake = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    } as unknown as Storage
    vi.stubGlobal("localStorage", localStorageFake)

    const listeners: Record<string, unknown> = {}
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
    proxy = new SwarmIdProxy()
    messageListener = listeners["message"] as typeof messageListener
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
})
