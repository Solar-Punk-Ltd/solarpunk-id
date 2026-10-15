// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest"

import {
  ButtonConfigSchema,
  DownloadOptionsSchema,
  IframeToParentMessageSchema,
  ParentToButtonMessageSchema,
  ParentToIframeMessageSchema,
} from "./types"

const REFERENCE = "a".repeat(64)

describe("DownloadOptionsSchema (#420)", () => {
  it("accepts plain non-ACT options", () => {
    const options = { timeoutMs: 5000 }

    const parsed = DownloadOptionsSchema.parse(options)

    expect(parsed).toEqual(options)
  })

  it("accepts an empty options object", () => {
    expect(DownloadOptionsSchema.parse({})).toEqual({})
  })

  it("accepts omitted options", () => {
    expect(DownloadOptionsSchema.parse(undefined)).toBeUndefined()
  })

  it("round-trips the full ACT option set", () => {
    const options = {
      redundancyStrategy: 1 as const,
      fallback: true,
      timeoutMs: 5000,
      actPublisher: "02".padEnd(66, "ab"),
      actHistoryAddress: REFERENCE,
      actTimestamp: 1,
    }

    const parsed = DownloadOptionsSchema.parse(options)

    expect(parsed).toEqual(options)
  })
})

describe("download messages with plain options (#420)", () => {
  const messages = [
    { type: "downloadData", requestId: "r1", reference: REFERENCE },
    { type: "downloadFile", requestId: "r2", reference: REFERENCE },
    { type: "downloadChunk", requestId: "r3", reference: REFERENCE },
  ]

  it.each(messages)("$type validates with non-ACT options", (message) => {
    const parsed = ParentToIframeMessageSchema.parse({
      ...message,
      options: { timeoutMs: 5000 },
    })

    expect(parsed).toMatchObject({
      type: message.type,
      options: { timeoutMs: 5000 },
    })
  })
})

describe("connectionInfoChanged forward compatibility (#642)", () => {
  const MESSAGE = {
    type: "connectionInfoChanged" as const,
    canUpload: false,
    uploadMode: "unavailable" as const,
  }

  it("drops an unknown uploadUnavailableReason rather than the whole snapshot", () => {
    // A proxy deployed between #616 and #642 still emits `"download-only"`.
    // Hard-parsing the enum would fail the message, and the client drops a
    // message it cannot parse — if it is the first one after `proxyReady`,
    // `initialize()` then rejects on its timeout and the dApp never starts.
    const parsed = IframeToParentMessageSchema.parse({
      ...MESSAGE,
      uploadUnavailableReason: "download-only",
    })

    expect(parsed).toMatchObject({
      type: "connectionInfoChanged",
      canUpload: false,
    })
    expect(
      (parsed as { uploadUnavailableReason?: string }).uploadUnavailableReason,
    ).toBeUndefined()
  })

  it("still carries a reason it knows", () => {
    const parsed = IframeToParentMessageSchema.parse({
      ...MESSAGE,
      uploadUnavailableReason: "stamper-failed",
    })

    expect(parsed).toMatchObject({ uploadUnavailableReason: "stamper-failed" })
  })
})

describe("connectionInfoChanged identity (#230)", () => {
  // Wire-valid shapes: bare hex, no 0x prefix.
  const IDENTITY = {
    id: "4".repeat(40),
    name: "carol",
    address: "4".repeat(40),
    publicKey: "02" + "ef".repeat(32),
  }
  const MESSAGE = {
    type: "connectionInfoChanged" as const,
    canUpload: true,
    uploadMode: "user-stamp" as const,
    identity: IDENTITY,
  }

  it("accepts an identity carrying an avatar", () => {
    expect(() =>
      IframeToParentMessageSchema.parse({
        ...MESSAGE,
        identity: {
          ...IDENTITY,
          avatar: { source: "generated", url: "data:image/svg+xml,%3Csvg%3E" },
        },
      }),
    ).not.toThrow()
  })

  it("carries the sharing key, and still parses without it (#519)", () => {
    const avatar = { source: "generated", url: "data:image/svg+xml,%3Csvg%3E" }
    const parsed = IframeToParentMessageSchema.parse({
      ...MESSAGE,
      identity: {
        ...IDENTITY,
        avatar,
        sharingPublicKey: "03" + "ab".repeat(32),
      },
    })
    expect(parsed).toMatchObject({
      identity: { sharingPublicKey: "03" + "ab".repeat(32) },
    })
    // A proxy deployed before the field still speaks to this lib
    expect(() =>
      IframeToParentMessageSchema.parse({
        ...MESSAGE,
        identity: { ...IDENTITY, avatar },
      }),
    ).not.toThrow()
  })

  it("rejects an identity with no avatar", () => {
    // Every identity has an avatar; the proxy is the only writer and always
    // sends one, so a message without it is malformed rather than legacy.
    expect(() => IframeToParentMessageSchema.parse(MESSAGE)).toThrow()
  })
})

describe("ButtonConfigSchema typography (#779)", () => {
  const TYPOGRAPHY = {
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: "18px",
    fontWeight: "300",
  }

  it("accepts the typography fields", () => {
    expect(ButtonConfigSchema.parse(TYPOGRAPHY)).toEqual(TYPOGRAPHY)
  })

  it("accepts a numeric fontWeight, which is how CSS weights are written", () => {
    // A TypeScript caller is stopped at compile time; a plain-JS one would
    // otherwise reach `sendMessage` and fail as "Invalid message format".
    expect(ButtonConfigSchema.parse({ fontWeight: 500 })).toEqual({
      fontWeight: 500,
    })
  })

  it("leaves them optional", () => {
    expect(ButtonConfigSchema.parse({ color: "white" })).toEqual({
      color: "white",
    })
  })

  it("takes a border and refuses a border style it does not draw", () => {
    const border = {
      borderColor: "#000",
      borderWidth: "2px",
      borderStyle: "dashed",
    }
    expect(ButtonConfigSchema.parse(border)).toEqual(border)
    expect(() => ButtonConfigSchema.parse({ borderStyle: "inset" })).toThrow()
  })

  it("takes font files on https, or on loopback http for local work", () => {
    const fontFaces = [
      {
        family: "Brand",
        url: "https://site.example.com/brand.woff2",
        weight: 600,
      },
      {
        family: "Brand",
        url: "http://localhost:3500/brand.woff2",
        style: "italic",
      },
      { family: "Brand", url: "http://127.0.0.1:3500/brand.woff2" },
    ]
    expect(ButtonConfigSchema.parse({ fontFaces })).toEqual({ fontFaces })
  })

  it.each([
    ["plain http", "http://site.example.com/brand.woff2"],
    ["a data URL", "data:font/woff2;base64,AAAA"],
    ["a script URL", "javascript:alert(1)"],
    ["no URL", "brand.woff2"],
  ])("refuses a font file on %s", (_case, url) => {
    expect(() =>
      ButtonConfigSchema.parse({ fontFaces: [{ family: "Brand", url }] }),
    ).toThrow()
  })

  it("refuses more font files than a button needs", () => {
    const face = {
      family: "Brand",
      url: "https://site.example.com/brand.woff2",
    }
    expect(() =>
      ButtonConfigSchema.parse({ fontFaces: Array(9).fill(face) }),
    ).toThrow()
  })

  it("carries them to the button frame rather than stripping them", () => {
    const parsed = ParentToButtonMessageSchema.parse({
      type: "buttonIdentify",
      action: "sign-in",
      metadata: { name: "Test App" },
      config: { text: "Sign in", ...TYPOGRAPHY },
    })

    expect(parsed).toMatchObject({ config: TYPOGRAPHY })
  })
})

describe("stampChunk carries the whole chunk, never an address", () => {
  const IDENTIFIER = "1d".repeat(32)
  const PRIVATE_KEY = "2e".repeat(32)
  const SIGNATURE = "3f".repeat(65)
  const SPAN_AND_PAYLOAD = new Uint8Array([4, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4])

  const request = (chunk: unknown) => ({
    type: "stampChunk",
    requestId: "r1",
    chunk,
  })
  const accepts = (chunk: unknown) =>
    ParentToIframeMessageSchema.safeParse(request(chunk)).success

  it("accepts a content chunk as span plus payload", () => {
    expect(accepts({ kind: "content", data: SPAN_AND_PAYLOAD })).toBe(true)
  })

  it("accepts a single-owner chunk signed with the app's own key", () => {
    expect(
      accepts({
        kind: "soc",
        identifier: IDENTIFIER,
        data: SPAN_AND_PAYLOAD,
        signer: "app",
      }),
    ).toBe(true)
  })

  it("accepts a single-owner chunk signed with a key the site supplies", () => {
    expect(
      accepts({
        kind: "soc",
        identifier: IDENTIFIER,
        data: SPAN_AND_PAYLOAD,
        signer: { privateKey: PRIVATE_KEY },
      }),
    ).toBe(true)
  })

  it("refuses a bare address", () => {
    expect(accepts({ kind: "content", address: REFERENCE })).toBe(false)
    expect(accepts({ kind: "address", address: REFERENCE })).toBe(false)
  })

  it("refuses a content chunk that also names its address", () => {
    expect(
      accepts({ kind: "content", data: SPAN_AND_PAYLOAD, address: REFERENCE }),
    ).toBe(false)
  })

  it("refuses a pre-signed single-owner chunk", () => {
    expect(
      accepts({
        kind: "soc",
        identifier: IDENTIFIER,
        data: SPAN_AND_PAYLOAD,
        signer: "app",
        signature: SIGNATURE,
      }),
    ).toBe(false)
    expect(
      accepts({
        kind: "soc",
        identifier: IDENTIFIER,
        data: SPAN_AND_PAYLOAD,
        owner: "4a".repeat(20),
        signature: SIGNATURE,
      }),
    ).toBe(false)
  })

  it("refuses a signer that is neither the app nor a private key", () => {
    expect(
      accepts({
        kind: "soc",
        identifier: IDENTIFIER,
        data: SPAN_AND_PAYLOAD,
        signer: { privateKey: PRIVATE_KEY, signature: SIGNATURE },
      }),
    ).toBe(false)
    expect(
      accepts({
        kind: "soc",
        identifier: IDENTIFIER,
        data: SPAN_AND_PAYLOAD,
        signer: "account",
      }),
    ).toBe(false)
  })

  it("parses the reply: address, the stamp in the upload-header form, and a SOC's owner and signature", () => {
    const reply = {
      type: "stampChunkResponse",
      requestId: "r1",
      address: REFERENCE,
      stamp: "5b".repeat(113),
      owner: "4a".repeat(20),
      signature: SIGNATURE,
    }
    expect(IframeToParentMessageSchema.safeParse(reply).success).toBe(true)
    expect(
      IframeToParentMessageSchema.safeParse({
        ...reply,
        stamp: "5b".repeat(112),
      }).success,
    ).toBe(false)
  })
})
