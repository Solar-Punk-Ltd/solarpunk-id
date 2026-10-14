// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { PrivateKey } from "@ethersphere/bee-js"
import { secp256k1 } from "@noble/curves/secp256k1"
import { keccak_256 } from "@noble/hashes/sha3"
import { describe, expect, it } from "vitest"
import {
  CHAT_BINDING_TITLE,
  acceptedChatBinding,
  buildChatBindingMessage,
  createChatBinding,
  isCleanSiteOrigin,
  newerChatBinding,
  onlySiteChatBinding,
  parseChatBindingMessage,
  siteChatAddress,
  verifyChatBinding,
} from "./chat-binding"
import { uint8ArrayToHex } from "./hex"
import { deriveChatKey, deriveSecretSync } from "./key-derivation"
import { appSecretAddressChatBinding } from "../test-fixtures"

const ACCOUNT_KEY = "ab".repeat(32)
const SITE = "https://viewer.example.com"
const DATE = new Date("2026-10-14T12:00:00.000Z")
const DATE_TEXT = "2026-10-14T12:00:00.000Z"
const ADDRESS_BYTES = 20

const addressOf = (key: string | Uint8Array) =>
  `0x${new PrivateKey(key).publicKey().address().toHex()}`
const ACCOUNT_ADDRESS = addressOf(ACCOUNT_KEY)
const APP_SECRET = deriveSecretSync(ACCOUNT_KEY, SITE)
const CHAT_KEY = deriveChatKey(APP_SECRET)
const CHAT_ADDRESS = addressOf(CHAT_KEY)

const WELL_FORMED = [
  CHAT_BINDING_TITLE,
  `Site: ${SITE}`,
  `Chat address: ${CHAT_ADDRESS}`,
  `Date: ${DATE_TEXT}`,
].join("\n")

describe("isCleanSiteOrigin", () => {
  it("accepts a bare https origin in its normalized form", () => {
    expect(isCleanSiteOrigin("https://viewer.example.com")).toBe(true)
    expect(isCleanSiteOrigin("https://viewer.example.com:8443")).toBe(true)
    expect(isCleanSiteOrigin("https://xn--bcher-kva.example")).toBe(true)
  })

  it.each([
    ["http scheme", "http://viewer.example.com"],
    ["another scheme", "ftp://viewer.example.com"],
    ["a path", "https://viewer.example.com/chat"],
    ["a trailing slash", "https://viewer.example.com/"],
    ["a query", "https://viewer.example.com?x=1"],
    ["an empty query", "https://viewer.example.com?"],
    ["a fragment", "https://viewer.example.com#x"],
    ["an empty fragment", "https://viewer.example.com#"],
    ["user info", "https://user@viewer.example.com"],
    ["user and password", "https://user:pw@viewer.example.com"],
    ["upper case", "https://Viewer.example.com"],
    ["the default port spelled out", "https://viewer.example.com:443"],
    ["a unicode host", "https://bücher.example"],
    ["surrounding space", " https://viewer.example.com"],
    ["trailing junk", "https://viewer.example.com\n"],
    ["no host", "https://"],
    ["a wildcard host", "https://*.example.com"],
    ["a host with an underscore", "https://view_er.example.com"],
    ["a host with a leading dot", "https://.example.com"],
    ["a host with a trailing dot", "https://example.com."],
    ["a host with a doubled dot", "https://a..b"],
    ["not a URL", "viewer.example.com"],
    ["empty", ""],
  ])("refuses %s", (_label, value) => {
    expect(isCleanSiteOrigin(value)).toBe(false)
  })

  it("refuses local http unless the caller allows it", () => {
    expect(isCleanSiteOrigin("http://localhost:3500")).toBe(false)
    expect(
      isCleanSiteOrigin("http://localhost:3500", { allowLocalHttp: true }),
    ).toBe(true)
    expect(
      isCleanSiteOrigin("http://127.0.0.1:3500", { allowLocalHttp: true }),
    ).toBe(true)
  })

  it("allows only local hosts over http, even when local http is allowed", () => {
    expect(
      isCleanSiteOrigin("http://viewer.example.com", { allowLocalHttp: true }),
    ).toBe(false)
    expect(
      isCleanSiteOrigin("http://localhost:3500/", { allowLocalHttp: true }),
    ).toBe(false)
  })
})

describe("buildChatBindingMessage", () => {
  it("writes exactly the four lines of the v1 format", () => {
    expect(
      buildChatBindingMessage({
        site: SITE,
        chatAddress: CHAT_ADDRESS,
        date: DATE,
      }),
    ).toBe(WELL_FORMED)
  })

  it("writes the chat address in lower case", () => {
    const upper = `0x${CHAT_ADDRESS.slice(2).toUpperCase()}`
    expect(
      buildChatBindingMessage({ site: SITE, chatAddress: upper, date: DATE }),
    ).toBe(WELL_FORMED)
  })

  it("refuses a site that is not a clean https origin", () => {
    expect(() =>
      buildChatBindingMessage({
        site: "https://viewer.example.com/",
        chatAddress: CHAT_ADDRESS,
        date: DATE,
      }),
    ).toThrow(/site/i)
  })

  it("refuses a chat address that is not 20 bytes of hex", () => {
    expect(() =>
      buildChatBindingMessage({
        site: SITE,
        chatAddress: "0x1234",
        date: DATE,
      }),
    ).toThrow(/chat address/i)
  })

  it("refuses an invalid date", () => {
    expect(() =>
      buildChatBindingMessage({
        site: SITE,
        chatAddress: CHAT_ADDRESS,
        date: new Date(Number.NaN),
      }),
    ).toThrow(/date/i)
  })
})

describe("parseChatBindingMessage", () => {
  it("reads the fields back out of a well-formed message", () => {
    expect(parseChatBindingMessage(WELL_FORMED)).toEqual({
      site: SITE,
      chatAddress: CHAT_ADDRESS,
      date: DATE_TEXT,
    })
  })

  const [title, site, chat, date] = WELL_FORMED.split("\n")
  const upperChat = `Chat address: 0x${CHAT_ADDRESS.slice(2).toUpperCase()}`
  it.each([
    ["another first line", ["Swarm ID chat binding v2", site, chat, date]],
    ["a missing line", [title, site, chat]],
    ["an extra line", [title, site, chat, date, "Note: hello"]],
    ["a trailing newline", [title, site, chat, date, ""]],
    ["a leading blank line", ["", title, site, chat, date]],
    ["lines out of order", [title, chat, site, date]],
    ["a carriage return", [`${title}\r`, site, chat, date]],
    ["a site with a path", [title, `Site: ${SITE}/x`, chat, date]],
    ["an http site", [title, "Site: http://viewer.example.com", chat, date]],
    ["an upper case chat address", [title, site, upperChat, date]],
    [
      "a chat address without 0x",
      [title, site, `Chat address: ${CHAT_ADDRESS.slice(2)}`, date],
    ],
    ["a short chat address", [title, site, "Chat address: 0x1234", date]],
    [
      "a date without milliseconds",
      [title, site, chat, "Date: 2026-10-14T12:00:00Z"],
    ],
    [
      "a date with an offset",
      [title, site, chat, "Date: 2026-10-14T12:00:00.000+02:00"],
    ],
    [
      "an impossible date",
      [title, site, chat, "Date: 2026-02-30T12:00:00.000Z"],
    ],
    ["a doubled space", [title, `Site:  ${SITE}`, chat, date]],
  ])("refuses %s", (_label, shape) => {
    expect(() => parseChatBindingMessage(shape.join("\n"))).toThrow()
  })
})

describe("siteChatAddress", () => {
  it("is the address of the site's chat key, not of its app secret", () => {
    expect(`0x${siteChatAddress(APP_SECRET)}`).toBe(CHAT_ADDRESS)
    expect(`0x${siteChatAddress(APP_SECRET)}`).not.toBe(addressOf(APP_SECRET))
  })
})

describe("createChatBinding and verifyChatBinding", () => {
  it("names the site's chat key, never the app secret's own address", () => {
    const binding = createChatBinding(ACCOUNT_KEY, SITE, DATE)

    expect(verifyChatBinding(binding).chatAddress).toBe(CHAT_ADDRESS)
    expect(verifyChatBinding(binding).chatAddress).not.toBe(
      addressOf(APP_SECRET),
    )
  })

  // What a reader of the site's chat does: recover the author of a message
  // the site signed with its chat key, then accept the binding that names
  // that author for this account.
  it("verifies end to end for a message the chat key signed", () => {
    const binding = createChatBinding(ACCOUNT_KEY, SITE, DATE)
    const digest = keccak_256(new TextEncoder().encode("hello, chat"))
    const publicKey = secp256k1
      .sign(digest, CHAT_KEY)
      .recoverPublicKey(digest)
      .toRawBytes(false)
    const author = `0x${uint8ArrayToHex(
      keccak_256(publicKey.slice(1)).slice(-ADDRESS_BYTES),
    )}`

    expect(author).toBe(CHAT_ADDRESS)
    expect(
      acceptedChatBinding(binding, {
        site: SITE,
        chatAddress: author,
        signer: ACCOUNT_ADDRESS,
      }),
    ).toEqual(binding)
  })

  it("binds the site's own chat key and recovers the account as signer", () => {
    const binding = createChatBinding(ACCOUNT_KEY, SITE, DATE)

    expect(binding.message).toBe(WELL_FORMED)
    expect(binding.signature).toMatch(/^0x[0-9a-f]{130}$/)
    expect(verifyChatBinding(binding)).toEqual({
      signer: ACCOUNT_ADDRESS,
      site: SITE,
      chatAddress: CHAT_ADDRESS,
      date: DATE_TEXT,
    })
  })

  it("gives each site its own chat address", () => {
    const other = createChatBinding(
      ACCOUNT_KEY,
      "https://other.example.com",
      DATE,
    )
    expect(verifyChatBinding(other).chatAddress).not.toBe(CHAT_ADDRESS)
  })

  it("refuses a site that is not a clean https origin", () => {
    expect(() =>
      createChatBinding(ACCOUNT_KEY, "https://viewer.example.com/", DATE),
    ).toThrow(/site/i)
  })

  it("recovers another signer when the message was changed", () => {
    const binding = createChatBinding(ACCOUNT_KEY, SITE, DATE)
    const changed = binding.message.replace("12:00:00", "12:00:01")
    expect(
      verifyChatBinding({ message: changed, signature: binding.signature })
        .signer,
    ).not.toBe(ACCOUNT_ADDRESS)
  })

  it("refuses a malformed message even with a valid signature", () => {
    const binding = createChatBinding(ACCOUNT_KEY, SITE, DATE)
    expect(() =>
      verifyChatBinding({
        message: `${binding.message}\n`,
        signature: binding.signature,
      }),
    ).toThrow()
  })

  it.each([
    ["too short", (s: string) => s.slice(0, -2)],
    ["not hex", (s: string) => `${s.slice(0, -2)}zz`],
    ["a recovery byte of 0", (s: string) => `${s.slice(0, -2)}00`],
    ["a recovery byte of 29", (s: string) => `${s.slice(0, -2)}1d`],
    ["without 0x", (s: string) => s.slice(2)],
  ])("refuses a signature %s", (_label, mangle) => {
    const binding = createChatBinding(ACCOUNT_KEY, SITE, DATE)
    expect(() =>
      verifyChatBinding({
        message: binding.message,
        signature: mangle(binding.signature),
      }),
    ).toThrow(/signature/i)
  })

  it("refuses the high-s twin of a valid signature", () => {
    const binding = createChatBinding(ACCOUNT_KEY, SITE, DATE)
    const r = binding.signature.slice(2, 66)
    const s = BigInt(`0x${binding.signature.slice(66, 130)}`)
    const v = parseInt(binding.signature.slice(130), 16)
    const highS = (secp256k1.CURVE.n - s).toString(16).padStart(64, "0")
    const flipped = (v === 27 ? 28 : 27).toString(16)
    expect(() =>
      verifyChatBinding({
        message: binding.message,
        signature: `0x${r}${highS}${flipped}`,
      }),
    ).toThrow(/signature/i)
  })
})

describe("acceptedChatBinding", () => {
  const binding = createChatBinding(ACCOUNT_KEY, SITE, DATE)
  const expected = {
    site: SITE,
    chatAddress: CHAT_ADDRESS,
    signer: ACCOUNT_ADDRESS,
  }

  it("keeps a binding that names this site, this chat key and this account", () => {
    expect(acceptedChatBinding(binding, expected)).toEqual(binding)
  })

  it("compares addresses whatever their case or prefix", () => {
    expect(
      acceptedChatBinding(binding, {
        site: SITE,
        chatAddress: CHAT_ADDRESS.slice(2).toUpperCase(),
        signer: ACCOUNT_ADDRESS.slice(2),
      }),
    ).toEqual(binding)
  })

  it.each([
    ["another site", { ...expected, site: "https://other.example.com" }],
    ["another chat address", { ...expected, chatAddress: ACCOUNT_ADDRESS }],
    ["another signer", { ...expected, signer: CHAT_ADDRESS }],
  ])("drops a binding for %s", (_label, other) => {
    expect(acceptedChatBinding(binding, other)).toBeUndefined()
  })

  it("drops a binding that does not verify", () => {
    expect(
      acceptedChatBinding(
        { message: CHAT_BINDING_TITLE, signature: binding.signature },
        expected,
      ),
    ).toBeUndefined()
  })

  it("has nothing to keep when it was given nothing", () => {
    expect(acceptedChatBinding(undefined, expected)).toBeUndefined()
  })

  // A binding the account really signed, from before sites had a chat key,
  // naming the app secret's address. No fallback accepts it.
  it("drops a binding the account signed for the app secret's address", () => {
    const old = appSecretAddressChatBinding(ACCOUNT_KEY, SITE, DATE)

    expect(verifyChatBinding(old).signer).toBe(ACCOUNT_ADDRESS)
    expect(acceptedChatBinding(old, expected)).toBeUndefined()
  })
})

describe("onlySiteChatBinding", () => {
  const OTHER_SITE = "https://other.example.com"
  const apps = [
    {
      appUrl: SITE,
      chatBinding: createChatBinding(ACCOUNT_KEY, SITE, DATE),
    },
    {
      appUrl: OTHER_SITE,
      chatBinding: createChatBinding(ACCOUNT_KEY, OTHER_SITE, DATE),
    },
    { appUrl: "https://third.example.com" },
  ]

  it("keeps the binding of the named site and drops every other", () => {
    const kept = onlySiteChatBinding(apps, SITE)

    expect(kept.map((app) => app.appUrl)).toEqual(apps.map((a) => a.appUrl))
    expect(kept[0].chatBinding).toEqual(apps[0].chatBinding)
    expect(kept[1].chatBinding).toBeUndefined()
    expect("chatBinding" in kept[1]).toBe(false)
    expect(kept[2].chatBinding).toBeUndefined()
  })

  it("drops them all for a site with no entry", () => {
    const kept = onlySiteChatBinding(apps, "https://new.example.com")

    expect(kept.every((app) => app.chatBinding === undefined)).toBe(true)
  })
})

describe("newerChatBinding", () => {
  const older = createChatBinding(ACCOUNT_KEY, SITE, DATE)
  const newer = createChatBinding(
    ACCOUNT_KEY,
    SITE,
    new Date("2026-10-15T12:00:00.000Z"),
  )
  const FAR_FUTURE = new Date("2999-01-01T00:00:00.000Z")
  /** A far-future binding whose recovery byte is neither 27 nor 28. */
  const forged = (() => {
    const signed = createChatBinding(ACCOUNT_KEY, SITE, FAR_FUTURE)
    return { ...signed, signature: `${signed.signature.slice(0, -2)}1d` }
  })()

  it("picks the binding with the later date, whichever side it is on", () => {
    expect(newerChatBinding(older, newer, SITE, ACCOUNT_ADDRESS)).toEqual(newer)
    expect(newerChatBinding(newer, older, SITE, ACCOUNT_ADDRESS)).toEqual(newer)
  })

  it("picks the one that is there over none", () => {
    expect(newerChatBinding(undefined, older, SITE, ACCOUNT_ADDRESS)).toEqual(
      older,
    )
    expect(newerChatBinding(older, undefined, SITE, ACCOUNT_ADDRESS)).toEqual(
      older,
    )
    expect(
      newerChatBinding(undefined, undefined, SITE, ACCOUNT_ADDRESS),
    ).toBeUndefined()
  })

  it("keeps the first on a tie", () => {
    const same = { ...older }
    expect(newerChatBinding(older, same, SITE, ACCOUNT_ADDRESS)).toBe(older)
  })

  it("ranks a binding whose message does not parse below any that does", () => {
    const broken = { message: "not a binding", signature: older.signature }
    expect(newerChatBinding(broken, older, SITE, ACCOUNT_ADDRESS)).toEqual(
      older,
    )
    expect(newerChatBinding(older, broken, SITE, ACCOUNT_ADDRESS)).toEqual(
      older,
    )
  })

  it("never lets a far-future binding that does not verify beat a valid older one", () => {
    expect(newerChatBinding(forged, older, SITE, ACCOUNT_ADDRESS)).toEqual(
      older,
    )
    expect(newerChatBinding(older, forged, SITE, ACCOUNT_ADDRESS)).toEqual(
      older,
    )
  })

  it("never lets a far-future binding for another site beat this site's", () => {
    const elsewhere = createChatBinding(
      ACCOUNT_KEY,
      "https://other.example.com",
      FAR_FUTURE,
    )
    expect(newerChatBinding(elsewhere, older, SITE, ACCOUNT_ADDRESS)).toEqual(
      older,
    )
    expect(newerChatBinding(older, elsewhere, SITE, ACCOUNT_ADDRESS)).toEqual(
      older,
    )
  })

  it("never lets a copy with only its date moved later beat the original", () => {
    // The old signature over the edited message still recovers an address,
    // just not the account's.
    const dateEdited = {
      ...older,
      message: older.message.replace(DATE_TEXT, FAR_FUTURE.toISOString()),
    }
    expect(verifyChatBinding(dateEdited).site).toBe(SITE)
    expect(newerChatBinding(dateEdited, older, SITE, ACCOUNT_ADDRESS)).toEqual(
      older,
    )
    expect(newerChatBinding(older, dateEdited, SITE, ACCOUNT_ADDRESS)).toEqual(
      older,
    )
  })

  it("never lets a far-future binding another account signed beat this account's", () => {
    const otherAccount = createChatBinding("cd".repeat(32), SITE, FAR_FUTURE)
    expect(
      newerChatBinding(otherAccount, older, SITE, ACCOUNT_ADDRESS),
    ).toEqual(older)
    expect(
      newerChatBinding(older, otherAccount, SITE, ACCOUNT_ADDRESS),
    ).toEqual(older)
  })

  it("compares the account in any case and with or without 0x", () => {
    const bare = ACCOUNT_ADDRESS.slice(2).toUpperCase()
    expect(newerChatBinding(newer, older, SITE, bare)).toEqual(newer)
    expect(newerChatBinding(older, newer, SITE, bare)).toEqual(newer)
  })

  it("ranks two bindings that do not verify by date, the first on a tie", () => {
    const earlierForged = {
      ...forged,
      message: forged.message.replace("2999", "2998"),
    }
    expect(
      newerChatBinding(earlierForged, forged, SITE, ACCOUNT_ADDRESS),
    ).toEqual(forged)
    expect(
      newerChatBinding(forged, earlierForged, SITE, ACCOUNT_ADDRESS),
    ).toEqual(forged)
    const same = { ...forged }
    expect(newerChatBinding(forged, same, SITE, ACCOUNT_ADDRESS)).toBe(forged)
  })
})
