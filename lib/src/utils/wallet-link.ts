// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * The wallet link: one statement, signed by both keys, saying "this Swarm ID
 * account and this Ethereum wallet belong to the same person"
 * (docs/Wallet-Link.md).
 *
 * A site never learns the wallet an account is secured with, only the
 * account's own address. A person who wants readers to see their ENS name
 * turns the link on in Swarm ID. The wallet signs the message with EIP-191
 * `personal_sign`, and the account's own key countersigns the same message,
 * so neither key can claim the other alone. A reader checks both signatures
 * against the addresses the message names, then looks up the wallet's ENS
 * name itself (`resolveVerifiedEnsName`).
 *
 * The format mirrors the chat binding's (`chat-binding.ts`): plain lines, the
 * first naming the format and its version, and every other shape refused. The
 * second says in plain words what the person signs, since a wallet shows the
 * text and nothing else, so a site that asks a wallet to sign a link naming
 * someone else's account has to show that sentence to get it.
 */

import { PrivateKey } from "@ethersphere/bee-js"
import { personalSign, recoverPersonalSigner } from "./personal-sign"

/** The first line, which also versions the format. */
export const WALLET_LINK_TITLE = "Swarm ID wallet link v1"

/** The second line, what the wallet's owner agrees to, read exactly. */
export const WALLET_LINK_STATEMENT =
  "I link this wallet to the Swarm ID account below, so sites may show my ENS name beside its messages."

const ACCOUNT_PREFIX = "Account: "
const WALLET_PREFIX = "Wallet: "
const DATE_PREFIX = "Date: "
const LINE_SEPARATOR = "\n"
const LINE_COUNT = 5

const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/
const ADDRESS_INPUT_PATTERN = /^(0x)?[0-9a-fA-F]{40}$/
/**
 * One spelling per signature, lower case as `personalSign` writes it, so this
 * reader and the chat library's, which signs the link's bytes into each
 * message, accept exactly the same links.
 */
export const WALLET_LINK_SIGNATURE_PATTERN = /^0x[0-9a-f]{130}$/
/** `Date.prototype.toISOString` exactly: UTC, milliseconds, a `Z`. */
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** A signed link as it travels and is stored. */
export interface WalletLink {
  message: string
  /** The wallet's `personal_sign` of `message`, `0x` + r ‖ s ‖ v, 65 bytes. */
  walletSignature: string
  /** The account key's `personal_sign` of `message`, in the same form. */
  accountSignature: string
}

/** The three fields a link message carries, as the message spells them. */
export interface WalletLinkFields {
  /** The Swarm ID account's address, `0x` + 40 lower-case hex characters. */
  account: string
  /** The wallet's address, in the same form. */
  wallet: string
  /** ISO 8601 UTC, as `Date.prototype.toISOString` writes it. */
  date: string
}

/** A link both signatures were checked for. Its fields are what it names. */
export type VerifiedWalletLink = WalletLinkFields

/** What a link has to name for a reader to accept it. */
export interface ExpectedWalletLink {
  /** The account the reader expects, in any case, with or without `0x`. */
  account: string
}

function normalizeAddress(value: string): string {
  return value.toLowerCase().replace(/^0x/, "")
}

function recoverLinkSigner(
  message: string,
  signature: string,
  subject: string,
): string {
  if (!WALLET_LINK_SIGNATURE_PATTERN.test(signature)) {
    throw new Error(`${subject} is not 0x and 130 lower-case hex characters.`)
  }
  return recoverPersonalSigner(message, signature, subject)
}

function canonicalDate(text: string): boolean {
  if (!ISO_UTC_PATTERN.test(text)) {
    return false
  }
  const time = Date.parse(text)
  return !Number.isNaN(time) && new Date(time).toISOString() === text
}

/** Build the exact five-line message for these fields. */
export function buildWalletLinkMessage(fields: {
  account: string
  wallet: string
  date: Date
}): string {
  if (!ADDRESS_INPUT_PATTERN.test(fields.account)) {
    throw new Error("Wallet link account is not 20 bytes of hex.")
  }
  if (!ADDRESS_INPUT_PATTERN.test(fields.wallet)) {
    throw new Error("Wallet link wallet is not 20 bytes of hex.")
  }
  if (Number.isNaN(fields.date.getTime())) {
    throw new Error("Wallet link date is not a valid date.")
  }
  return [
    WALLET_LINK_TITLE,
    WALLET_LINK_STATEMENT,
    `${ACCOUNT_PREFIX}0x${normalizeAddress(fields.account)}`,
    `${WALLET_PREFIX}0x${normalizeAddress(fields.wallet)}`,
    `${DATE_PREFIX}${fields.date.toISOString()}`,
  ].join(LINE_SEPARATOR)
}

function field(line: string, prefix: string): string {
  if (!line.startsWith(prefix)) {
    throw new Error(`Wallet link line does not start with "${prefix}".`)
  }
  return line.slice(prefix.length)
}

function address(line: string, prefix: string): string {
  const value = field(line, prefix)
  if (!ADDRESS_PATTERN.test(value)) {
    throw new Error(
      `Wallet link "${prefix.trim()}" is not 0x and 40 lower-case hex characters.`,
    )
  }
  return value
}

/**
 * Read the fields out of a link message, refusing every shape but the one
 * `buildWalletLinkMessage` writes: another first line, another statement, a
 * missing or extra line, a trailing newline, an address in another spelling, a date in
 * another form.
 */
export function parseWalletLinkMessage(message: string): WalletLinkFields {
  const lines = message.split(LINE_SEPARATOR)
  if (lines.length !== LINE_COUNT) {
    throw new Error(`Wallet link has ${lines.length} lines, not ${LINE_COUNT}.`)
  }
  const [title, statement, accountLine, walletLine, dateLine] = lines
  if (title !== WALLET_LINK_TITLE) {
    throw new Error("Not a Swarm ID wallet link v1.")
  }
  if (statement !== WALLET_LINK_STATEMENT) {
    throw new Error("Wallet link statement is not the v1 statement.")
  }
  const account = address(accountLine, ACCOUNT_PREFIX)
  const wallet = address(walletLine, WALLET_PREFIX)
  const date = field(dateLine, DATE_PREFIX)
  if (!canonicalDate(date)) {
    throw new Error("Wallet link date is not ISO 8601 UTC.")
  }
  return { account, wallet, date }
}

/**
 * Check a link and return what it names, or undefined. It is accepted only
 * when the message has exactly the v1 shape, the wallet signature recovers the
 * wallet the message names, the account signature recovers the account the
 * message names, and that account is `expected.account`. Never throws.
 *
 * A wallet whose signature does not recover its own address, such as a
 * smart-contract wallet (ERC-1271), cannot make a link that passes.
 */
export function verifyWalletLink(
  link: WalletLink,
  expected: ExpectedWalletLink,
): VerifiedWalletLink | undefined {
  try {
    const fields = parseWalletLinkMessage(link.message)
    const wallet = recoverLinkSigner(
      link.message,
      link.walletSignature,
      "Wallet link wallet signature",
    )
    const account = recoverLinkSigner(
      link.message,
      link.accountSignature,
      "Wallet link account signature",
    )
    const matches =
      wallet === fields.wallet &&
      account === fields.account &&
      fields.account === `0x${normalizeAddress(expected.account)}`
    return matches ? fields : undefined
  } catch {
    return undefined
  }
}

/**
 * Countersign a message the wallet has already signed, with the account's own
 * key, after checking the message's shape, that the wallet signature recovers
 * the wallet it names, and that it names this key's account.
 *
 * @param accountKey - the account's private key (bare hex), whose address is
 *   the account's `id`
 * @param walletSignature - the wallet's `personal_sign` of `message`, already
 *   in the canonical 65-byte form with v 27 or 28
 * @throws on any of those checks failing, so no link is ever stored that a
 *   reader would refuse.
 */
export function countersignWalletLink(
  accountKey: string,
  message: string,
  walletSignature: string,
): WalletLink {
  const fields = parseWalletLinkMessage(message)
  const wallet = recoverLinkSigner(
    message,
    walletSignature,
    "Wallet link wallet signature",
  )
  if (wallet !== fields.wallet) {
    throw new Error(
      "The wallet signature does not recover the wallet the link names.",
    )
  }
  const ownAddress = `0x${new PrivateKey(accountKey).publicKey().address().toHex()}`
  if (ownAddress !== fields.account) {
    throw new Error("The link names another account than this key's.")
  }
  return {
    message,
    walletSignature,
    accountSignature: personalSign(message, accountKey),
  }
}
