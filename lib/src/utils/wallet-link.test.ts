// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { PrivateKey } from "@ethersphere/bee-js"
import { describe, expect, it } from "vitest"
import { personalSign } from "./personal-sign"
import {
  WALLET_LINK_STATEMENT,
  WALLET_LINK_TITLE,
  buildWalletLinkMessage,
  countersignWalletLink,
  parseWalletLinkMessage,
  verifyWalletLink,
  type WalletLink,
} from "./wallet-link"

const ACCOUNT_KEY = "ab".repeat(32)
const WALLET_KEY = "cd".repeat(32)
const OTHER_KEY = "ef".repeat(32)
const DATE = new Date("2026-10-15T12:00:00.000Z")
const DATE_TEXT = "2026-10-15T12:00:00.000Z"

const addressOf = (key: string) =>
  `0x${new PrivateKey(key).publicKey().address().toHex()}`
const ACCOUNT = addressOf(ACCOUNT_KEY)
const WALLET = addressOf(WALLET_KEY)
const OTHER = addressOf(OTHER_KEY)

const WELL_FORMED = [
  WALLET_LINK_TITLE,
  WALLET_LINK_STATEMENT,
  `Account: ${ACCOUNT}`,
  `Wallet: ${WALLET}`,
  `Date: ${DATE_TEXT}`,
].join("\n")

/** A link as the identity UI makes one: the wallet signs, the account countersigns. */
function link(message = WELL_FORMED): WalletLink {
  return {
    message,
    walletSignature: personalSign(message, WALLET_KEY),
    accountSignature: personalSign(message, ACCOUNT_KEY),
  }
}

describe("buildWalletLinkMessage", () => {
  it("writes the exact five lines", () => {
    expect(
      buildWalletLinkMessage({ account: ACCOUNT, wallet: WALLET, date: DATE }),
    ).toBe(WELL_FORMED)
  })

  it("writes addresses as 0x and lower case whatever spelling it is given", () => {
    expect(
      buildWalletLinkMessage({
        account: ACCOUNT.slice(2).toUpperCase(),
        wallet: WALLET.toUpperCase().replace("0X", "0x"),
        date: DATE,
      }),
    ).toBe(WELL_FORMED)
  })

  it.each([
    ["an account that is not 20 bytes", { account: "0x1234", wallet: WALLET }],
    [
      "a wallet that is not hex",
      { account: ACCOUNT, wallet: `0x${"zz".repeat(20)}` },
    ],
  ])("refuses %s", (_label, fields) => {
    expect(() => buildWalletLinkMessage({ ...fields, date: DATE })).toThrow()
  })

  it("refuses an invalid date", () => {
    expect(() =>
      buildWalletLinkMessage({
        account: ACCOUNT,
        wallet: WALLET,
        date: new Date(Number.NaN),
      }),
    ).toThrow()
  })
})

describe("the statement line", () => {
  it("says in plain words what the wallet signs", () => {
    expect(WALLET_LINK_STATEMENT).toBe(
      "I link this wallet to the Swarm ID account below, so sites may show my ENS name beside its messages.",
    )
    expect(WELL_FORMED.split("\n")[1]).toBe(WALLET_LINK_STATEMENT)
  })
})

describe("parseWalletLinkMessage", () => {
  it("reads the fields of a well-formed message", () => {
    expect(parseWalletLinkMessage(WELL_FORMED)).toEqual({
      account: ACCOUNT,
      wallet: WALLET,
      date: DATE_TEXT,
    })
  })

  const lines = WELL_FORMED.split("\n")
  const withLine = (index: number, text: string) =>
    lines.map((line, at) => (at === index ? text : line)).join("\n")

  it.each([
    ["another title", withLine(0, "Swarm ID wallet link v2")],
    ["the chat binding's title", withLine(0, "Swarm ID chat binding v1")],
    ["no statement line", lines.filter((_, at) => at !== 1).join("\n")],
    [
      "another statement",
      withLine(1, "I link this wallet to the Swarm ID account below."),
    ],
    ["the statement with a trailing space", withLine(1, `${lines[1]} `)],
    ["the statement in upper case", withLine(1, lines[1].toUpperCase())],
    ["a trailing newline", `${WELL_FORMED}\n`],
    ["a missing line", lines.slice(0, 4).join("\n")],
    ["an extra line", `${WELL_FORMED}\nNote: hi`],
    ["CRLF line ends", lines.join("\r\n")],
    [
      "lines in another order",
      [lines[0], lines[1], lines[3], lines[2], lines[4]].join("\n"),
    ],
    [
      "an upper-case account",
      withLine(2, `Account: 0x${ACCOUNT.slice(2).toUpperCase()}`),
    ],
    ["an account without 0x", withLine(2, `Account: ${ACCOUNT.slice(2)}`)],
    [
      "a wallet in upper case",
      withLine(3, `Wallet: 0x${WALLET.slice(2).toUpperCase()}`),
    ],
    ["a short wallet", withLine(3, `Wallet: ${WALLET.slice(0, -2)}`)],
    ["a space after the prefix", withLine(3, `Wallet:  ${WALLET}`)],
    ["a date without milliseconds", withLine(4, "Date: 2026-10-15T12:00:00Z")],
    [
      "a date with an offset",
      withLine(4, "Date: 2026-10-15T14:00:00.000+02:00"),
    ],
    [
      "a date that does not exist",
      withLine(4, "Date: 2026-02-30T12:00:00.000Z"),
    ],
    ["empty", ""],
  ])("refuses %s", (_label, message) => {
    expect(() => parseWalletLinkMessage(message)).toThrow()
  })
})

describe("verifyWalletLink", () => {
  it("accepts a link both keys signed, naming the expected account", () => {
    expect(verifyWalletLink(link(), { account: ACCOUNT })).toEqual({
      account: ACCOUNT,
      wallet: WALLET,
      date: DATE_TEXT,
    })
  })

  it("compares the expected account in any case and with or without 0x", () => {
    expect(
      verifyWalletLink(link(), { account: ACCOUNT.slice(2).toUpperCase() }),
    ).toBeDefined()
  })

  it("refuses a message changed after signing", () => {
    const tampered = {
      ...link(),
      message: WELL_FORMED.replace(DATE_TEXT, "2026-10-16T12:00:00.000Z"),
    }
    expect(verifyWalletLink(tampered, { account: ACCOUNT })).toBeUndefined()
  })

  it("refuses a link whose wallet signature another key made", () => {
    const wrongWallet = {
      ...link(),
      walletSignature: personalSign(WELL_FORMED, OTHER_KEY),
    }
    expect(verifyWalletLink(wrongWallet, { account: ACCOUNT })).toBeUndefined()
  })

  it("refuses a link whose account signature another key made", () => {
    const wrongAccount = {
      ...link(),
      accountSignature: personalSign(WELL_FORMED, OTHER_KEY),
    }
    expect(verifyWalletLink(wrongAccount, { account: ACCOUNT })).toBeUndefined()
  })

  it("refuses a valid link of another account", () => {
    const message = buildWalletLinkMessage({
      account: OTHER,
      wallet: WALLET,
      date: DATE,
    })
    const others = {
      message,
      walletSignature: personalSign(message, WALLET_KEY),
      accountSignature: personalSign(message, OTHER_KEY),
    }
    expect(verifyWalletLink(others, { account: OTHER })).toBeDefined()
    expect(verifyWalletLink(others, { account: ACCOUNT })).toBeUndefined()
  })

  it("refuses the two signatures swapped", () => {
    const signed = link()
    const swapped = {
      ...signed,
      walletSignature: signed.accountSignature,
      accountSignature: signed.walletSignature,
    }
    expect(verifyWalletLink(swapped, { account: ACCOUNT })).toBeUndefined()
  })

  it("refuses a signed message of another shape", () => {
    expect(
      verifyWalletLink(link(`${WELL_FORMED}\n`), { account: ACCOUNT }),
    ).toBeUndefined()
  })

  // A smart-contract wallet (ERC-1271) answers personal_sign with whatever its
  // contract validates, often longer than 65 bytes (ERC-6492 wraps it in a
  // deployment call), and nothing in it recovers the wallet's address.
  it("refuses a smart-contract wallet's signature that is not 65 bytes", () => {
    const contractSignature = `0x${"12".repeat(32)}${"00".repeat(96)}6492649264926492649264926492649264926492649264926492649264926492`
    const contract = { ...link(), walletSignature: contractSignature }
    expect(verifyWalletLink(contract, { account: ACCOUNT })).toBeUndefined()
  })

  it("refuses a signature with v as 0 or 1, or a high s", () => {
    const signed = link()
    const lowV = `${signed.walletSignature.slice(0, -2)}0${
      Number.parseInt(signed.walletSignature.slice(-2), 16) - 27
    }`
    expect(
      verifyWalletLink(
        { ...signed, walletSignature: lowV },
        { account: ACCOUNT },
      ),
    ).toBeUndefined()
    const order =
      0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
    const s = BigInt(`0x${signed.walletSignature.slice(66, 130)}`)
    const v = Number.parseInt(signed.walletSignature.slice(130), 16)
    const highS = `${signed.walletSignature.slice(0, 66)}${(order - s)
      .toString(16)
      .padStart(64, "0")}${(v === 27 ? 28 : 27).toString(16)}`
    expect(
      verifyWalletLink(
        { ...signed, walletSignature: highS },
        { account: ACCOUNT },
      ),
    ).toBeUndefined()
  })

  it("refuses a signature spelled in upper case, as the chat library does", () => {
    const signed = link()
    const upper = (signature: string) => `0x${signature.slice(2).toUpperCase()}`
    expect(
      verifyWalletLink(
        { ...signed, walletSignature: upper(signed.walletSignature) },
        { account: ACCOUNT },
      ),
    ).toBeUndefined()
    expect(
      verifyWalletLink(
        { ...signed, accountSignature: upper(signed.accountSignature) },
        { account: ACCOUNT },
      ),
    ).toBeUndefined()
  })

  it("refuses something that is not a link at all", () => {
    expect(
      verifyWalletLink(
        {
          message: 1,
          walletSignature: [],
          accountSignature: {},
        } as unknown as WalletLink,
        { account: ACCOUNT },
      ),
    ).toBeUndefined()
  })
})

describe("countersignWalletLink", () => {
  it("adds the account's signature to a wallet-signed message", () => {
    const walletSignature = personalSign(WELL_FORMED, WALLET_KEY)
    expect(
      countersignWalletLink(ACCOUNT_KEY, WELL_FORMED, walletSignature),
    ).toEqual(link())
  })

  it("refuses a wallet signature that does not recover the named wallet", () => {
    expect(() =>
      countersignWalletLink(
        ACCOUNT_KEY,
        WELL_FORMED,
        personalSign(WELL_FORMED, OTHER_KEY),
      ),
    ).toThrow(/wallet/)
  })

  it("refuses a wallet signature spelled in upper case", () => {
    const walletSignature = personalSign(WELL_FORMED, WALLET_KEY)
    expect(() =>
      countersignWalletLink(
        ACCOUNT_KEY,
        WELL_FORMED,
        `0x${walletSignature.slice(2).toUpperCase()}`,
      ),
    ).toThrow(/lower-case/)
  })

  it("refuses to sign a message naming another account", () => {
    const message = buildWalletLinkMessage({
      account: OTHER,
      wallet: WALLET,
      date: DATE,
    })
    expect(() =>
      countersignWalletLink(
        ACCOUNT_KEY,
        message,
        personalSign(message, WALLET_KEY),
      ),
    ).toThrow(/account/)
  })

  it("refuses a message of another shape", () => {
    const message = `${WELL_FORMED}\n`
    expect(() =>
      countersignWalletLink(
        ACCOUNT_KEY,
        message,
        personalSign(message, WALLET_KEY),
      ),
    ).toThrow()
  })
})
