// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * The sites this identity manager serves (docs/Site-Allow-List.md).
 *
 * The list is a text record on an ENS name, read over an Ethereum mainnet
 * JSON-RPC endpoint the build names, so adding a site is a change to the
 * record rather than a new upload. It is never read through a Swarm gateway:
 * the record decides who may ask for an identity, and a gateway that serves
 * this code is exactly the party it must not have to trust.
 *
 * Everything that goes wrong refuses. No endpoint, an endpoint that does not
 * answer, a name with no resolver, an empty or unreadable record, and no fresh
 * cached copy each leave the list unavailable, and an unavailable list allows
 * nothing.
 */

import { keccak_256 } from "@noble/hashes/sha3"
import { z } from "zod"
import { STORAGE_KEY_SITE_ALLOW_LIST } from "../types"
import { isCleanSiteOrigin } from "./chat-binding"
import { hexToUint8Array, uint8ArrayToHex } from "./hex"
import { CHAIN_READ_TIMEOUT_MS, jsonRpcCall } from "./json-rpc"

/** The name whose text record holds the list. */
export const DEFAULT_SITE_ALLOW_LIST_ENS_NAME = "solarpunkid.eth"
/** The text record key, in the reverse-domain form ENSIP-5 asks of a vendor key. */
export const DEFAULT_SITE_ALLOW_LIST_RECORD_KEY = "buzz.solarpunk.sites"
/**
 * How long a list read from the chain is trusted before it is read again. A
 * site removed from the record keeps working at most this long on a device
 * that read it before.
 */
export const SITE_ALLOW_LIST_CACHE_MS = 10 * 60 * 1000

/** The ENS registry, at the same address on every chain ENS is deployed to. */
export const ENS_REGISTRY_ADDRESS = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e"

const LOG_PREFIX = "[SiteAllowList]"
const ENTRY_SEPARATOR = /[\s,]+/
const ENS_LABEL = /^[a-z0-9-]+$/
const MIN_ENS_LABELS = 2
const WORD_BYTES = 32
const ADDRESS_BYTES = 20
const SELECTOR_BYTES = 4
const HEX_RADIX = 16

const RESOLVER_SELECTOR = selector("resolver(bytes32)")
const TEXT_SELECTOR = selector("text(bytes32,string)")

/** Why a site was refused, so a caller can word its own screen. */
export type SiteRefusal = "not-clean" | "not-listed" | "list-unavailable"

export type SiteCheck =
  | { allowed: true }
  | { allowed: false; reason: SiteRefusal; message: string }

export interface SiteAllowList {
  /** Whether `origin`, exactly as the browser reports it, may be served. */
  check(origin: string): Promise<SiteCheck>
}

export interface SiteAllowListSettings {
  /** An Ethereum mainnet JSON-RPC endpoint. Unset, every site is refused. */
  rpcUrl: string | undefined
  ensName: string
  recordKey: string
  /**
   * Origins allowed without the chain, for local work. Local http is accepted
   * here. Only a development build passes any.
   */
  devOrigins?: readonly string[]
  /** Where the read list is kept between loads. Unset, it is kept in memory. */
  storage?: Pick<Storage, "getItem" | "setItem">
  now?: () => number
}

const CachedSiteAllowListSchema = z.object({
  ensName: z.string(),
  recordKey: z.string(),
  origins: z.array(z.string()),
  fetchedAt: z.number(),
})

type CachedSiteAllowList = z.infer<typeof CachedSiteAllowListSchema>

function selector(signature: string): string {
  return uint8ArrayToHex(
    keccak_256(new TextEncoder().encode(signature)).slice(0, SELECTOR_BYTES),
  )
}

/** The EIP-137 namehash of a name already in its normalized form. */
export function ensNamehash(name: string): string {
  let node: Uint8Array = new Uint8Array(WORD_BYTES)
  const labels = name === "" ? [] : name.split(".")
  for (const label of labels.reverse()) {
    const joined = new Uint8Array(WORD_BYTES * 2)
    joined.set(node)
    joined.set(keccak_256(new TextEncoder().encode(label)), WORD_BYTES)
    node = keccak_256(joined)
  }
  return `0x${uint8ArrayToHex(node)}`
}

/**
 * Whether `name` is already in the form ENS normalization would give it, for
 * the plain names this setting is meant to hold. Anything else is refused
 * rather than normalized here, since a wrong normalization reads the record
 * of a different name.
 */
function isPlainEnsName(name: string): boolean {
  const labels = name.split(".")
  return (
    labels.length >= MIN_ENS_LABELS &&
    labels.every((label) => ENS_LABEL.test(label))
  )
}

/**
 * The origins a record names. Entries are separated by white space or commas.
 * An entry that is not a clean https origin is ignored and logged, so one bad
 * entry cannot take the whole list down, and no entry is ever read as a
 * pattern.
 */
export function parseSiteAllowList(record: string): string[] {
  const origins: string[] = []
  for (const entry of record.split(ENTRY_SEPARATOR)) {
    if (entry === "") {
      continue
    }
    if (isCleanSiteOrigin(entry)) {
      origins.push(entry)
    } else {
      console.warn(
        `${LOG_PREFIX} Ignored an entry that is not a clean https origin:`,
        entry,
      )
    }
  }
  return origins
}

function word(value: number): string {
  return value.toString(HEX_RADIX).padStart(WORD_BYTES * 2, "0")
}

function encodeTextCall(node: string, key: string): string {
  const keyBytes = new TextEncoder().encode(key)
  const keyHex = uint8ArrayToHex(keyBytes)
  const paddedLength = Math.ceil(keyBytes.length / WORD_BYTES) * WORD_BYTES * 2
  const head = word(WORD_BYTES * 2)
  return `0x${TEXT_SELECTOR}${node.slice(2)}${head}${word(keyBytes.length)}${keyHex.padEnd(paddedLength, "0")}`
}

function resultBytes(result: unknown, subject: string): Uint8Array {
  if (typeof result !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(result)) {
    throw new Error(`${subject} answered something that is not hex data.`)
  }
  return hexToUint8Array(result.slice(2))
}

function readWord(bytes: Uint8Array, offset: number): bigint {
  if (offset + WORD_BYTES > bytes.length) {
    throw new Error("The answer ends inside a word.")
  }
  return BigInt(
    `0x${uint8ArrayToHex(bytes.slice(offset, offset + WORD_BYTES))}`,
  )
}

function decodeAddress(result: unknown): string | undefined {
  const bytes = resultBytes(result, "The registry")
  if (bytes.length !== WORD_BYTES) {
    throw new Error("The registry answered a resolver that is not one word.")
  }
  const padding = bytes.slice(0, WORD_BYTES - ADDRESS_BYTES)
  if (padding.some((byte) => byte !== 0)) {
    throw new Error("The registry answered a resolver that is not an address.")
  }
  const address = bytes.slice(WORD_BYTES - ADDRESS_BYTES)
  return address.every((byte) => byte === 0)
    ? undefined
    : `0x${uint8ArrayToHex(address)}`
}

function decodeString(result: unknown): string {
  const bytes = resultBytes(result, "The resolver")
  const offset = readWord(bytes, 0)
  if (offset > BigInt(bytes.length)) {
    throw new Error("The resolver answered a string offset past its end.")
  }
  const start = Number(offset)
  const length = readWord(bytes, start)
  const end = BigInt(start + WORD_BYTES) + length
  if (end > BigInt(bytes.length)) {
    throw new Error("The resolver answered a string longer than its answer.")
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.slice(start + WORD_BYTES, Number(end)),
  )
}

async function ethCall(
  rpcUrl: string,
  to: string,
  data: string,
): Promise<unknown> {
  return jsonRpcCall(rpcUrl, "eth_call", [{ to, data }, "latest"], {
    timeoutMs: CHAIN_READ_TIMEOUT_MS,
  })
}

/**
 * The text record `key` of `name`, through the resolver the registry names.
 * @throws when the name has no resolver or the answers do not decode.
 */
async function readEnsText(
  rpcUrl: string,
  name: string,
  key: string,
): Promise<string> {
  const node = ensNamehash(name)
  const resolver = decodeAddress(
    await ethCall(
      rpcUrl,
      ENS_REGISTRY_ADDRESS,
      `0x${RESOLVER_SELECTOR}${node.slice(2)}`,
    ),
  )
  if (!resolver) {
    throw new Error(`${name} has no resolver.`)
  }
  return decodeString(
    await ethCall(rpcUrl, resolver, encodeTextCall(node, key)),
  )
}

function refusal(reason: SiteRefusal, origin: string): SiteCheck {
  const messages: Record<SiteRefusal, string> = {
    "not-clean": `${origin} is not a plain https site address, and Swarm ID serves only the sites on its allow list.`,
    "not-listed": `${origin} is not on Swarm ID's allow list of sites.`,
    "list-unavailable": `Swarm ID could not read its allow list of sites, so it refused ${origin}. It serves no site until the list can be read.`,
  }
  return { allowed: false, reason, message: messages[reason] }
}

function cleanDevOrigins(origins: readonly string[]): Set<string> {
  const clean = new Set<string>()
  for (const origin of origins) {
    if (isCleanSiteOrigin(origin, { allowLocalHttp: true })) {
      clean.add(origin)
    } else {
      console.warn(
        `${LOG_PREFIX} Ignored a dev origin that is not a clean origin:`,
        origin,
      )
    }
  }
  return clean
}

/**
 * The allow list for one setting of name, record key and endpoint. One
 * instance per page: it shares a read in flight between the checks that wait
 * on it.
 */
export function createSiteAllowList(
  settings: SiteAllowListSettings,
): SiteAllowList {
  const now = settings.now ?? Date.now
  const devOrigins = cleanDevOrigins(settings.devOrigins ?? [])
  let memory: CachedSiteAllowList | undefined
  let inFlight: Promise<readonly string[] | undefined> | undefined

  const isFresh = (entry: CachedSiteAllowList | undefined): boolean => {
    if (
      !entry ||
      entry.ensName !== settings.ensName ||
      entry.recordKey !== settings.recordKey
    ) {
      return false
    }
    const age = now() - entry.fetchedAt
    return age >= 0 && age < SITE_ALLOW_LIST_CACHE_MS
  }

  const loadStored = (): CachedSiteAllowList | undefined => {
    try {
      const raw = settings.storage?.getItem(STORAGE_KEY_SITE_ALLOW_LIST)
      if (!raw) {
        return undefined
      }
      const parsed = CachedSiteAllowListSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : undefined
    } catch {
      return undefined
    }
  }

  const store = (entry: CachedSiteAllowList): void => {
    memory = entry
    try {
      settings.storage?.setItem(
        STORAGE_KEY_SITE_ALLOW_LIST,
        JSON.stringify(entry),
      )
    } catch (error) {
      console.warn(`${LOG_PREFIX} Could not keep the list in storage:`, error)
    }
  }

  const readFromChain = async (): Promise<readonly string[] | undefined> => {
    if (!settings.rpcUrl) {
      console.warn(
        `${LOG_PREFIX} No Ethereum endpoint is set, so no site is allowed.`,
      )
      return undefined
    }
    if (!isPlainEnsName(settings.ensName)) {
      console.warn(
        `${LOG_PREFIX} The ENS name is not a plain lower-case name:`,
        settings.ensName,
      )
      return undefined
    }
    try {
      const record = await readEnsText(
        settings.rpcUrl,
        settings.ensName,
        settings.recordKey,
      )
      const origins = parseSiteAllowList(record)
      if (origins.length === 0) {
        console.warn(
          `${LOG_PREFIX} The record names no site, so no site is allowed.`,
        )
        return undefined
      }
      store({
        ensName: settings.ensName,
        recordKey: settings.recordKey,
        origins,
        fetchedAt: now(),
      })
      return origins
    } catch (error) {
      console.warn(
        `${LOG_PREFIX} Could not read the list, so no site is allowed:`,
        error,
      )
      return undefined
    }
  }

  const currentList = async (): Promise<readonly string[] | undefined> => {
    if (isFresh(memory)) {
      return memory!.origins
    }
    const stored = loadStored()
    if (isFresh(stored)) {
      memory = stored
      return stored!.origins
    }
    inFlight ??= readFromChain().finally(() => {
      inFlight = undefined
    })
    return inFlight
  }

  return {
    async check(origin) {
      if (devOrigins.has(origin)) {
        return { allowed: true }
      }
      if (!isCleanSiteOrigin(origin)) {
        return refusal("not-clean", origin)
      }
      const origins = await currentList()
      if (!origins) {
        return refusal("list-unavailable", origin)
      }
      return origins.includes(origin)
        ? { allowed: true }
        : refusal("not-listed", origin)
    },
  }
}
