// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * The chat binding: one statement per site, signed by the account's own key,
 * saying "this chat address on this site is mine" (docs/Chat-Binding.md).
 *
 * A site only ever sees its per-origin app key (`deriveSecret(masterKey,
 * origin)`), and nothing in that key says which account it came from. The
 * binding is what lets a reader of the site's chat prove it: recover the
 * signer of the message and compare it with the account's address.
 *
 * The message is plain text signed with EIP-191 `personal_sign`, so any
 * Ethereum library recovers the signer the same way. It is the only thing the
 * account key signs through this code, and `createChatBinding` takes no text
 * of its own: the caller names a site, and the chat address is derived here.
 */

import { PrivateKey } from "@ethersphere/bee-js"
import { secp256k1 } from "@noble/curves/secp256k1"
import { keccak_256 } from "@noble/hashes/sha3"
import { hexToUint8Array, uint8ArrayToHex } from "./hex"
import { deriveSecretSync } from "./key-derivation"

/** The first line, which also versions the format. */
export const CHAT_BINDING_TITLE = "Swarm ID chat binding v1"

const SITE_PREFIX = "Site: "
const CHAT_ADDRESS_PREFIX = "Chat address: "
const DATE_PREFIX = "Date: "
const LINE_SEPARATOR = "\n"
const LINE_COUNT = 4

const PERSONAL_MESSAGE_PREFIX = "\x19Ethereum Signed Message:\n"
/** EIP-191 signatures carry the recovery id offset by this. */
const RECOVERY_OFFSET = 27
const SIGNATURE_HEX_PATTERN = /^0x[0-9a-fA-F]{130}$/
const COMPACT_SIGNATURE_HEX_LENGTH = 128
const ADDRESS_BYTES = 20
const UNCOMPRESSED_PREFIX_BYTES = 1
const CHAT_ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/
const ADDRESS_INPUT_PATTERN = /^(0x)?[0-9a-fA-F]{40}$/
/** `Date.prototype.toISOString` exactly: UTC, milliseconds, a `Z`. */
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const HEX_RADIX = 16
/**
 * A host a DNS name can spell: letters, digits, hyphens and dots, in punycode
 * form. The URL parser lets `*` and `_` through, and a site list must never
 * hold a host that reads as a pattern.
 */
const DNS_HOST_PATTERN = /^[a-z0-9.-]+$/

/** Hosts a development build may name over plain http. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
])

export interface SiteOriginOptions {
  /**
   * Also accept `http://localhost`, `http://127.0.0.1` and `http://[::1]`
   * with any port. Only a development build passes this.
   */
  allowLocalHttp?: boolean
}

/** A signed binding as it travels: the message and its signature. */
export interface ChatBinding {
  message: string
  /** `0x` + r ‖ s ‖ v, 65 bytes, v 27 or 28. */
  signature: string
}

/** The three fields a binding message carries, as the message spells them. */
export interface ChatBindingFields {
  site: string
  /** `0x` + 40 lower-case hex characters. */
  chatAddress: string
  /** ISO 8601 UTC, as `Date.prototype.toISOString` writes it. */
  date: string
}

export interface VerifiedChatBinding extends ChatBindingFields {
  /** The recovered signer, `0x` + 40 lower-case hex characters. */
  signer: string
}

/** What a binding has to name for a reader to accept it. */
export interface ExpectedChatBinding {
  site: string
  chatAddress: string
  signer: string
}

/**
 * Whether `value` is a bare https origin in the exact form the browser
 * reports one: a host and nothing else, no path, query, fragment or user
 * info, lower case, punycode, no default port. Anything a URL parser would
 * have to normalize is refused rather than normalized, so one site has one
 * spelling.
 */
export function isCleanSiteOrigin(
  value: string,
  options: SiteOriginOptions = {},
): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  const secure = url.protocol === "https:"
  const localHttp =
    options.allowLocalHttp === true &&
    url.protocol === "http:" &&
    LOCAL_HOSTS.has(url.hostname)
  if (!secure && !localHttp) {
    return false
  }
  if (!localHttp && !DNS_HOST_PATTERN.test(url.hostname)) {
    return false
  }
  return (
    url.host !== "" &&
    url.username === "" &&
    url.password === "" &&
    url.origin === value
  )
}

function normalizeAddress(value: string): string {
  return value.toLowerCase().replace(/^0x/, "")
}

function requireSite(site: string, options: SiteOriginOptions): void {
  if (!isCleanSiteOrigin(site, options)) {
    throw new Error(`Chat binding site is not a clean https origin: ${site}`)
  }
}

function canonicalDate(text: string): boolean {
  if (!ISO_UTC_PATTERN.test(text)) {
    return false
  }
  const time = Date.parse(text)
  return !Number.isNaN(time) && new Date(time).toISOString() === text
}

/** Build the exact four-line message for these fields. */
export function buildChatBindingMessage(
  fields: { site: string; chatAddress: string; date: Date },
  options: SiteOriginOptions = {},
): string {
  requireSite(fields.site, options)
  if (!ADDRESS_INPUT_PATTERN.test(fields.chatAddress)) {
    throw new Error("Chat address is not 20 bytes of hex.")
  }
  if (Number.isNaN(fields.date.getTime())) {
    throw new Error("Chat binding date is not a valid date.")
  }
  return [
    CHAT_BINDING_TITLE,
    `${SITE_PREFIX}${fields.site}`,
    `${CHAT_ADDRESS_PREFIX}0x${normalizeAddress(fields.chatAddress)}`,
    `${DATE_PREFIX}${fields.date.toISOString()}`,
  ].join(LINE_SEPARATOR)
}

function field(line: string, prefix: string): string {
  if (!line.startsWith(prefix)) {
    throw new Error(`Chat binding line does not start with "${prefix}".`)
  }
  return line.slice(prefix.length)
}

/**
 * Read the fields out of a binding message, refusing every shape but the one
 * `buildChatBindingMessage` writes: another first line, a missing or extra
 * line, a trailing newline, a site that is not a clean origin, an address in
 * another spelling, a date in another form.
 */
export function parseChatBindingMessage(
  message: string,
  options: SiteOriginOptions = {},
): ChatBindingFields {
  const lines = message.split(LINE_SEPARATOR)
  if (lines.length !== LINE_COUNT) {
    throw new Error(
      `Chat binding has ${lines.length} lines, not ${LINE_COUNT}.`,
    )
  }
  const [title, siteLine, chatLine, dateLine] = lines
  if (title !== CHAT_BINDING_TITLE) {
    throw new Error("Not a Swarm ID chat binding v1.")
  }
  const site = field(siteLine, SITE_PREFIX)
  requireSite(site, options)
  const chatAddress = field(chatLine, CHAT_ADDRESS_PREFIX)
  if (!CHAT_ADDRESS_PATTERN.test(chatAddress)) {
    throw new Error("Chat address is not 0x and 40 lower-case hex characters.")
  }
  const date = field(dateLine, DATE_PREFIX)
  if (!canonicalDate(date)) {
    throw new Error("Chat binding date is not ISO 8601 UTC.")
  }
  return { site, chatAddress, date }
}

/** The EIP-191 version 0x45 digest `personal_sign` signs. */
function personalMessageHash(message: string): Uint8Array {
  const body = new TextEncoder().encode(message)
  const prefix = new TextEncoder().encode(
    `${PERSONAL_MESSAGE_PREFIX}${body.length}`,
  )
  const whole = new Uint8Array(prefix.length + body.length)
  whole.set(prefix)
  whole.set(body, prefix.length)
  return keccak_256(whole)
}

function addressOfPublicKey(uncompressed: Uint8Array): string {
  const hash = keccak_256(uncompressed.slice(UNCOMPRESSED_PREFIX_BYTES))
  return `0x${uint8ArrayToHex(hash.slice(-ADDRESS_BYTES))}`
}

/**
 * Sign the binding for `site` with the account's own key. The chat address is
 * the address of the site's app secret, derived from that same key here, so
 * no caller can bind an address the account does not hold for that site.
 *
 * @param accountKey - the account's private key (bare hex), whose address is
 *   the account's `id`
 */
export function createChatBinding(
  accountKey: string,
  site: string,
  date: Date,
  options: SiteOriginOptions = {},
): ChatBinding {
  requireSite(site, options)
  const appSecret = deriveSecretSync(accountKey, site)
  const chatAddress = new PrivateKey(appSecret).publicKey().address().toHex()
  const message = buildChatBindingMessage({ site, chatAddress, date }, options)
  const signed = secp256k1.sign(
    personalMessageHash(message),
    hexToUint8Array(accountKey),
  )
  const recovery = (signed.recovery + RECOVERY_OFFSET).toString(HEX_RADIX)
  return {
    message,
    signature: `0x${signed.toCompactHex()}${recovery}`,
  }
}

/**
 * Check a binding's shape and recover who signed it. Throws on a message of
 * any other shape and on a signature that is not 65 bytes with v 27 or 28 and
 * a low s. A valid signature over a changed message recovers SOME address,
 * which is why a reader compares `signer` with the account it expects
 * (`acceptedChatBinding` does).
 */
export function verifyChatBinding(
  binding: ChatBinding,
  options: SiteOriginOptions = {},
): VerifiedChatBinding {
  const fields = parseChatBindingMessage(binding.message, options)
  if (!SIGNATURE_HEX_PATTERN.test(binding.signature)) {
    throw new Error("Chat binding signature is not 65 bytes of 0x hex.")
  }
  const compact = binding.signature.slice(2, 2 + COMPACT_SIGNATURE_HEX_LENGTH)
  const recovery =
    parseInt(
      binding.signature.slice(2 + COMPACT_SIGNATURE_HEX_LENGTH),
      HEX_RADIX,
    ) - RECOVERY_OFFSET
  if (recovery !== 0 && recovery !== 1) {
    throw new Error(
      "Chat binding signature has a recovery byte other than 27 or 28.",
    )
  }
  let signer: string
  try {
    const signature = secp256k1.Signature.fromCompact(compact)
    if (signature.hasHighS()) {
      throw new Error("high s")
    }
    const point = signature
      .addRecoveryBit(recovery)
      .recoverPublicKey(personalMessageHash(binding.message))
    signer = addressOfPublicKey(point.toRawBytes(false))
  } catch (error) {
    throw new Error(
      `Chat binding signature does not recover a signer: ${String(error)}`,
    )
  }
  return { signer, ...fields }
}

/**
 * The binding, if it verifies and names exactly this site, this chat address
 * and this signer, otherwise undefined. Addresses compare in any case and
 * with or without `0x`.
 */
export function acceptedChatBinding(
  binding: ChatBinding | undefined,
  expected: ExpectedChatBinding,
  options: SiteOriginOptions = {},
): ChatBinding | undefined {
  if (!binding) {
    return undefined
  }
  let verified: VerifiedChatBinding
  try {
    verified = verifyChatBinding(binding, options)
  } catch {
    return undefined
  }
  const matches =
    verified.site === expected.site &&
    normalizeAddress(verified.chatAddress) ===
      normalizeAddress(expected.chatAddress) &&
    normalizeAddress(verified.signer) === normalizeAddress(expected.signer)
  return matches ? binding : undefined
}

/**
 * The connected apps with every chat binding removed except `site`'s own.
 *
 * Each site's binding publicly links the account to its chat on that site, and
 * a proxy frame runs inside one site's page, where that page's scripts can
 * reach what the frame holds. So everything handed to a frame keeps only the
 * binding of the site it runs for. The account's own synced copy keeps all of
 * them.
 */
export function onlySiteChatBinding<
  App extends { appUrl: string; chatBinding?: ChatBinding },
>(apps: readonly App[], site: string): App[] {
  return apps.map((app) => {
    if (app.appUrl === site || app.chatBinding === undefined) {
      return app
    }
    const { chatBinding: _dropped, ...rest } = app
    return rest as App
  })
}

/** When a binding says it was signed, or minus infinity if it does not parse. */
function signedAt(binding: ChatBinding): number {
  try {
    // Local http is a development site's, and which sites a binding may name
    // is decided where it is signed, not where it is merged.
    return Date.parse(
      parseChatBindingMessage(binding.message, { allowLocalHttp: true }).date,
    )
  } catch {
    return Number.NEGATIVE_INFINITY
  }
}

/**
 * Of two bindings for one site, the one with the later date, the first on a
 * tie, and whichever is there when only one is. A binding is never withdrawn,
 * only replaced by a newer one (docs/Chat-Binding.md), so this is the whole of
 * how two copies of a connection merge theirs.
 */
export function newerChatBinding(
  first: ChatBinding | undefined,
  second: ChatBinding | undefined,
): ChatBinding | undefined {
  if (!first || !second) {
    return first ?? second
  }
  return signedAt(second) > signedAt(first) ? second : first
}
