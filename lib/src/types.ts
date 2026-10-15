// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod"
import type {
  PrivateKey as BeePrivateKey,
  Topic as BeeTopic,
} from "@ethersphere/bee-js"
import {
  BeeApiUrlSchema,
  ChatBindingSchema,
  NetworkSettingsSchemaV1,
  SyncedAccountSchemaV1,
  ReferenceSchema,
  BatchIdSchema,
  AddressSchema,
  PrivateKeySchema,
  CompressedPublicKeySchema,
  EncryptionKeySchema,
  IdentifierSchema,
  SignatureSchema,
  ChunkAddressSchema,
  MarshaledStampSchema,
  TimestampSchema,
  FeedIndexSchema,
} from "./schemas"
import type {
  Reference,
  Address,
  Identifier,
  Signature,
  Timestamp,
  FeedIndex,
} from "./schemas"
export type {
  Reference,
  BatchId,
  Address,
  PrivateKey,
  Identifier,
  Signature,
  Timestamp,
  FeedIndex,
} from "./schemas"

// ============================================================================
// Constants
// ============================================================================

// Storage keys for versioned storage managers. The account is the single nested
// document of record (it owns its connected apps and postage stamps inline), so
// there are no longer separate identity/app/stamp collection keys.
export const STORAGE_KEY_ACCOUNTS = "swarm-id-accounts"
export const STORAGE_KEY_NETWORK_SETTINGS = "swarm-id-network-settings"
export const STORAGE_CHALLENGE_KEY = "swarm-storage-challenge"
/** The cached allow list of sites (`utils/site-allow-list.ts`). */
export const STORAGE_KEY_SITE_ALLOW_LIST = "swarm-id-site-allow-list"
export const STORAGE_KEY_LEASE_CACHE_PREFIX = "swarm-id-lease-v2"
export const STORAGE_KEY_APP_STAMP_USAGE_PREFIX = "swarm-id-app-stamp-usage"
export const STORAGE_KEY_SOC_RESTAMP_SLOTS_PREFIX = "swarm-id-soc-restamp-slots"

/**
 * Key PREFIX for the handed-over session a PARTITIONED proxy keeps, so a reload
 * does not log the user out of the dApp (#635). The key itself is per dApp
 * origin — see {@link partitionSessionStorageKey}, which is what every reader
 * and writer calls.
 *
 * Its own key rather than the accounts document, and not by preference:
 * `LocalAccountSchemaV1` quarantines vault-less records, and the hydrated
 * partition account carries inert vault placeholders by design — it would fail
 * to parse on load. This is a session, and takes a session's shape.
 *
 * Written only from a partitioned context, where the store is already scoped to
 * (this origin, the embedding page's origin) by the browser. `parentOrigin` is
 * recorded anyway so a record can be refused rather than trusted on the strength
 * of where it was found.
 */
export const STORAGE_KEY_PARTITION_SESSION = "swarm-id-partition-session"

/**
 * localStorage key for the proxy's partition-lease cache (a
 * `PartitionLeaseStateSnapshot`), per account AND per batch. Same-origin tabs
 * share this, so the SwarmID UI reads it to render the *self* device's active
 * partition without a Swarm round-trip. The proxy is the sole writer.
 *
 * The batch is in the key because the lease is: a lane is one partition of one
 * batch (#589), and an account has two coordinators whenever a dApp carries a
 * per-app stamp override. Under one key per account they shared a slot and
 * overwrote each other — safe, since `PartitionLease.hydrate` refuses a
 * snapshot whose `batchId` differs, but a hint that stops hinting exactly when
 * there are two writers to hint for is no hint. The `batchId` inside the record
 * stays as the second line of that pair of braces, as `parentOrigin` does in
 * the partitioned session (#671).
 */
export function leaseCacheStorageKey(
  accountId: string,
  batchId: string,
): string {
  return `${STORAGE_KEY_LEASE_CACHE_PREFIX}:${accountId.toLowerCase()}:${batchId.toLowerCase()}`
}

/**
 * Where the frame counts what one app has stamped with one of the account's
 * stamps (`proxy/app-stamp-limits.ts`), per app origin and per batch, so the
 * limits survive a reload and a new stamp starts a new count.
 */
export function appStampUsageStorageKey(
  appOrigin: string,
  batchId: string,
): string {
  return `${STORAGE_KEY_APP_STAMP_USAGE_PREFIX}:${appOrigin}:${batchId.toLowerCase()}`
}

/**
 * Where the frame keeps which slot each single-owner chunk one app had
 * stamped went to (`proxy/soc-restamp-slots.ts`), per app origin and per
 * batch, so stamping the same address again after a reload reuses the slot.
 */
export function socRestampSlotsStorageKey(
  appOrigin: string,
  batchId: string,
): string {
  return `${STORAGE_KEY_SOC_RESTAMP_SLOTS_PREFIX}:${appOrigin}:${batchId.toLowerCase()}`
}

/**
 * Where a partitioned session is stored, per dApp origin.
 *
 * The store this lands in is partitioned by (iframe origin, top-level SITE),
 * and a site ignores subdomains and ports — so `app1.foo.com` and
 * `app2.foo.com`, or two localhost ports, share it. Under one fixed name the
 * second dApp to connect overwrote the first one's session, and the first came
 * back to a record belonging to somebody else, read it as "no session", and
 * needed the popup again — both of them, on every reload (#671). The origin
 * belongs in the key, as it already does in the stamper's.
 */
export function partitionSessionStorageKey(parentOrigin: string): string {
  return `${STORAGE_KEY_PARTITION_SESSION}:${parentOrigin}`
}

// ============================================================================
// Upload/Download Options
// ============================================================================

const UploadOptionsObjectSchema = z.object({
  pin: z.boolean().optional(),
  encrypt: z.boolean().optional(),
  encryptManifest: z.boolean().optional(),
  tag: z.number().optional(),
  deferred: z.boolean().optional(),
})

export const UploadOptionsSchema = UploadOptionsObjectSchema.optional()

export const ActPublisherSchema = z.enum(["app", "identity"])

export type ActPublisher = z.infer<typeof ActPublisherSchema>

export const ActUploadOptionsSchema = UploadOptionsObjectSchema.extend({
  beeCompatible: z.boolean().optional(),
  publisher: ActPublisherSchema.optional(),
}).optional()

export const RequestOptionsSchema = z
  .object({
    timeout: z.number().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    endlesslyRetry: z.boolean().optional(),
  })
  .optional()

export const DownloadOptionsSchema = z
  .object({
    redundancyStrategy: z
      .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
      .optional(),
    fallback: z.boolean().optional(),
    timeoutMs: z.number().optional(),
    actPublisher: z.union([z.instanceof(Uint8Array), z.string()]).optional(),
    actHistoryAddress: z
      .union([z.instanceof(Uint8Array), z.string()])
      .optional(),
    actTimestamp: z.union([z.number(), z.string()]).optional(),
  })
  .optional()

export interface UploadProgress {
  total: number
  processed: number
}

export interface UploadOptions {
  /** Pin on the user's own node. Ignored on a subsidised gateway (#752). */
  pin?: boolean
  encrypt?: boolean
  encryptManifest?: boolean
  tag?: number
  deferred?: boolean
  onProgress?: (progress: UploadProgress) => void
  /** Use WebSocket for chunk upload instead of HTTP. Per-chunk stamping is used. */
  useWebSocket?: boolean
  /** Use Web Workers for parallel stamp signing. Speeds up upload on multi-core CPUs. */
  useWorkers?: boolean
  /** Number of Web Workers to use for parallel stamp signing. Defaults to navigator.hardwareConcurrency. */
  workerCount?: number
  /** Upload concurrency (parallel in-flight chunks). HTTP default: 8, WebSocket default: 32. */
  concurrency?: number
}

export type RequestOptions = z.infer<typeof RequestOptionsSchema>
export type DownloadOptions = z.infer<typeof DownloadOptionsSchema>

/**
 * Options for `uploadFiles` (#750). Content is encrypted unless `encrypt` is
 * `false`; the manifest — and so the root reference — is encrypted unless
 * `encrypt` or `encryptManifest` is `false`. `onProgress` counts files.
 */
export interface UploadFilesOptions extends Pick<
  UploadOptions,
  | "pin"
  | "encrypt"
  | "encryptManifest"
  | "tag"
  | "deferred"
  | "onProgress"
  | "useWorkers"
  | "workerCount"
> {
  /** Served for the bare `/bzz/<reference>/` (`website-index-document`) */
  indexDocument?: string
  /** Served for a path that is not in the folder (`website-error-document`) */
  errorDocument?: string
}

/** One file to upload with `uploadFiles`, when not handing over `File`s */
export interface CollectionFileInput {
  /** Path inside the folder, `/`-separated, no leading slash */
  path: string
  file: Blob
}

const UploadFilesOptionsSchema = UploadOptionsObjectSchema.extend({
  indexDocument: z.string().optional(),
  errorDocument: z.string().optional(),
}).optional()

/** One file of a folder, as it crosses the bridge */
export const CollectionFileSchema = z.object({
  path: z.string().min(1),
  data: z.instanceof(Uint8Array),
  contentType: z.string().optional(),
})
export type CollectionFile = z.infer<typeof CollectionFileSchema>

/** One file of a listed folder. `reference` is readable with `downloadData` */
export const CollectionEntrySchema = z.object({
  path: z.string(),
  reference: ReferenceSchema,
  contentType: z.string().optional(),
})
export type CollectionEntry = z.infer<typeof CollectionEntrySchema>
export interface ActUploadOptions extends UploadOptions {
  beeCompatible?: boolean
  /**
   * Which of the user's keys publishes the ACT (default `"app"`, the
   * origin-bound app key). `"identity"` publishes with the account-wide
   * sharing key, so any of the user's apps can manage the grantees later.
   */
  publisher?: ActPublisher
}

// ============================================================================
// Upload/Download Results
// ============================================================================

export const UploadResultSchema = z.object({
  reference: ReferenceSchema,
  tagUid: z.number().optional(),
})

export const SocUploadResultSchema = UploadResultSchema.extend({
  encryptionKey: z.string().optional(),
  owner: AddressSchema,
})

export const SocRawUploadResultSchema = UploadResultSchema.extend({
  encryptionKey: z.string().optional(),
  owner: AddressSchema,
})

export const FileDataSchema = z.object({
  name: z.string(),
  data: z.instanceof(Uint8Array),
})

export const PostageBatchSchema = z.object({
  batchID: BatchIdSchema,
  /**
   * Bee's fill count of the fullest bucket — NOT a percentage. Usage is
   * `utilization / 2^(depth - bucketDepth)`, and a batch stops accepting
   * uploads when one bucket fills, before the nominal `2^depth * 4096` bytes.
   */
  utilization: z.number(),
  usable: z.boolean(),
  label: z.string(),
  depth: z.number(),
  amount: z.string(),
  bucketDepth: z.number(),
  blockNumber: z.number(),
  immutableFlag: z.boolean(),
  exists: z.boolean(),
  batchTTL: z.number().optional(),
})

export type UploadResult = z.infer<typeof UploadResultSchema>
export type SocUploadResult = z.infer<typeof SocUploadResultSchema>
export type SocRawUploadResult = z.infer<typeof SocRawUploadResultSchema>
export type FileData = z.infer<typeof FileDataSchema>
export type PostageBatch = z.infer<typeof PostageBatchSchema>

// ============================================================================
// SOC Types
// ============================================================================

export interface SingleOwnerChunk {
  data: Uint8Array
  identifier: Identifier
  signature: Signature
  span: number
  payload: Uint8Array
  address: Reference
  owner: Address
}

/**
 * The chunk `SwarmIdClient.stampChunk` asks the frame to stamp. `data` is the
 * whole chunk body, the 8-byte little-endian span followed by the payload.
 */
export type StampChunkInput =
  | { kind: "content"; data: Uint8Array }
  | {
      kind: "soc"
      identifier: Identifier | Uint8Array | string
      data: Uint8Array
      /** `"app"` signs with the site's own app secret */
      signer: "app" | { privateKey: Uint8Array | string }
    }

/** What `SwarmIdClient.stampChunk` returns, enough to send the exact chunk */
export interface StampedChunk {
  /** The chunk's address, computed by the frame */
  address: string
  /** The postage stamp as hex, the value of Bee's `swarm-postage-stamp` header */
  stamp: string
  /** For a single-owner chunk: the owner the frame signed as */
  owner?: Address
  /** For a single-owner chunk: the signature, for `/soc/<owner>/<id>?sig=` */
  signature?: Signature
}

/**
 * Interface for downloading single owner chunks (SOC).
 *
 * `download` expects an encryption key and returns decrypted content.
 * `rawDownload` returns unencrypted SOC data.
 */
export interface SOCReader {
  /**
   * Resolve SOC owner address. For SOCWriter without signer, this may be
   * resolved via the proxy.
   */
  getOwner: () => Promise<Address>
  /**
   * Download an unencrypted SOC by identifier.
   *
   * @param identifier - SOC identifier (32-byte value)
   */
  rawDownload: (
    identifier: Identifier | Uint8Array | string,
    encryptionKey?: Uint8Array | string,
  ) => Promise<SingleOwnerChunk>
  /**
   * Download and decrypt an encrypted SOC by identifier.
   *
   * @param identifier - SOC identifier (32-byte value)
   * @param encryptionKey - 32-byte encryption key returned by upload
   */
  download: (
    identifier: Identifier | Uint8Array | string,
    encryptionKey: Uint8Array | string,
  ) => Promise<SingleOwnerChunk>
}

/**
 * Interface for downloading and uploading single owner chunks (SOC).
 *
 * `upload` creates an encrypted SOC by default.
 * `rawUpload` creates an unencrypted SOC.
 */
export interface SOCWriter extends SOCReader {
  /**
   * Upload an encrypted SOC.
   *
   * @param identifier - SOC identifier (32-byte value)
   * @param data - SOC payload data (1-4096 bytes)
   * @param options - Optional upload configuration
   */
  upload: (
    identifier: Identifier | Uint8Array | string,
    data: Uint8Array,
    options?: UploadOptions,
  ) => Promise<SocUploadResult>
  /**
   * Upload an unencrypted SOC.
   *
   * @param identifier - SOC identifier (32-byte value)
   * @param data - SOC payload data (1-4096 bytes)
   * @param options - Optional upload configuration
   */
  rawUpload: (
    identifier: Identifier | Uint8Array | string,
    data: Uint8Array,
    options?: UploadOptions,
  ) => Promise<SocRawUploadResult>
}

// ============================================================================
// Feed Types
// ============================================================================

/**
 * Options for epoch feed reader creation.
 */
export interface FeedReaderOptions {
  /** Feed topic (32 bytes). */
  topic: Identifier | Uint8Array | string | BeeTopic
  /** Optional feed owner address (20 bytes). */
  owner?: Address | Uint8Array | string
}

/**
 * Options for epoch feed writer creation.
 */
export interface FeedWriterOptions {
  /** Feed topic (32 bytes). */
  topic: Identifier | Uint8Array | string | BeeTopic
  /** Optional signer private key (32 bytes). */
  signer?: BeePrivateKey | Uint8Array | string
}

/**
 * Epoch feed reader interface.
 */
export interface EpochFeedDownloadOptions {
  /** Unix timestamp (seconds). */
  at?: bigint | number | string
  /** Hint of latest known update timestamp. */
  after?: bigint | number | string
  /** Optional encryption key for encrypted feed updates. */
  encryptionKey?: Uint8Array | string
}

export interface EpochFeedUploadOptions {
  /** Unix timestamp (seconds). */
  at?: bigint | number | string
  /** Optional upload options for the payload upload. */
  uploadOptions?: UploadOptions
  /** Whether to encrypt payload uploads (defaults to true). */
  encrypt?: boolean
  /** Optional encryption key for encrypted feed updates. */
  encryptionKey?: Uint8Array | string
  /** Optional hints from previous update for stateless epoch calculation. */
  hints?: {
    lastEpoch?: { start: string; level: number }
    lastTimestamp?: string
  }
}

export interface EpochFeedDownloadPayloadResult {
  /** Downloaded payload, if available. */
  payload?: Uint8Array
  /** Reference used to download the payload, if available. */
  reference?: Reference
  /** Encryption key (hex) if the reference is encrypted. */
  encryptionKey?: string
}

export interface EpochFeedDownloadReferenceResult {
  /** Swarm reference (hex), if found. */
  reference?: Reference
  /** Encryption key (hex) if the reference is encrypted. */
  encryptionKey?: string
}

export interface EpochFeedUploadResult {
  /** SOC address for the feed update. */
  socAddress: Reference
  /** Reference stored in the feed update. */
  reference: Reference
  /** Encryption key (hex) if the reference is encrypted. */
  encryptionKey?: string
  /** Epoch used for this update (for caller to store as hint) */
  epoch: { start: string; level: number }
  /** Timestamp used (stringified bigint) */
  timestamp: string
}

/**
 * Epoch feed reader interface.
 */
export interface FeedReader {
  /** Resolve feed owner address (20 bytes). */
  getOwner: () => Promise<Address>
  /** Download the reference for the given timestamp. */
  downloadReference: (
    options?: EpochFeedDownloadOptions,
  ) => Promise<EpochFeedDownloadReferenceResult>
  /** Download the payload for the given timestamp. */
  downloadPayload: (
    options?: EpochFeedDownloadOptions,
  ) => Promise<EpochFeedDownloadPayloadResult>
  /** Download unencrypted reference (for /bzz access). */
  downloadRawReference: (
    options?: Omit<EpochFeedDownloadOptions, "encryptionKey">,
  ) => Promise<EpochFeedDownloadReferenceResult>
  /** Download unencrypted payload (for /bzz access). */
  downloadRawPayload: (
    options?: Omit<EpochFeedDownloadOptions, "encryptionKey">,
  ) => Promise<EpochFeedDownloadPayloadResult>
}

/**
 * Epoch feed writer interface.
 */
export interface FeedWriter extends FeedReader {
  /** Upload payload data and update the feed. */
  uploadPayload: (
    data: Uint8Array | string,
    options?: EpochFeedUploadOptions,
  ) => Promise<EpochFeedUploadResult>
  /** Update the feed with a reference. */
  uploadReference: (
    reference: Uint8Array | string,
    options?: EpochFeedUploadOptions,
  ) => Promise<EpochFeedUploadResult>
  /** Upload unencrypted payload (for /bzz access). */
  uploadRawPayload: (
    data: Uint8Array | string,
    options?: Omit<EpochFeedUploadOptions, "encryptionKey" | "encrypt">,
  ) => Promise<EpochFeedUploadResult>
  /** Upload unencrypted reference (for /bzz access). */
  uploadRawReference: (
    reference: Uint8Array | string,
    options?: Omit<EpochFeedUploadOptions, "encryptionKey">,
  ) => Promise<EpochFeedUploadResult>
}

// ============================================================================
// Sequential Feed Types
// ============================================================================

/**
 * Options for sequential feed reader creation.
 */
export interface SequentialFeedReaderOptions {
  /** Feed topic (32 bytes). */
  topic: Identifier | Uint8Array | string | BeeTopic
  /** Optional feed owner address (20 bytes). */
  owner?: Address | Uint8Array | string
}

/**
 * Options for sequential feed writer creation.
 */
export interface SequentialFeedWriterOptions {
  /** Feed topic (32 bytes). */
  topic: Identifier | Uint8Array | string | BeeTopic
  /** Optional signer private key (32 bytes). */
  signer?: BeePrivateKey | Uint8Array | string
}

/**
 * Options for sequential feed lookups/updates.
 */
export interface SequentialFeedUpdateOptions {
  /** Specific feed index to read/write. */
  index?: FeedIndex | bigint
  /** Timestamp (seconds) used for lookup or payload timestamp. */
  at?: Timestamp | bigint
  /** Whether payload is prefixed with timestamp (default true). */
  hasTimestamp?: boolean
  /** Timeout (ms) for sequential index lookups (default 2000). */
  lookupTimeoutMs?: number
}

/**
 * Options for sequential feed uploads.
 */
export interface SequentialFeedUploadOptions
  extends UploadOptions, SequentialFeedUpdateOptions {}

/**
 * Options for sequential feed raw download (encryptionKey in options).
 */
export interface SequentialFeedDownloadRawOptions extends SequentialFeedUpdateOptions {
  /** Optional encryption key for decrypting encrypted feed updates. */
  encryptionKey?: Uint8Array | string
}

/**
 * Options for sequential feed raw upload (encryptionKey in options).
 */
export interface SequentialFeedUploadRawOptions extends SequentialFeedUploadOptions {
  /** Optional encryption key for encrypting the payload. */
  encryptionKey?: Uint8Array | string
}

/**
 * Result from sequential payload download.
 */
export interface SequentialFeedPayloadResult {
  /** Payload bytes (timestamp removed if present). */
  payload: Uint8Array
  /** Timestamp extracted from payload, if present. */
  timestamp?: number
  /** Current feed index as a stringified uint64. */
  feedIndex: string
  /** Next feed index as a stringified uint64. */
  feedIndexNext: string
}

/**
 * Result from sequential reference download.
 */
export interface SequentialFeedReferenceResult {
  /** Swarm reference stored in the feed update. */
  reference: string
  /** Current feed index as a stringified uint64. */
  feedIndex: string
  /** Next feed index as a stringified uint64. */
  feedIndexNext: string
}

/**
 * Result from sequential feed upload.
 */
export interface SequentialFeedUploadResult {
  /** SOC address of the feed update. */
  reference: string
  /** Feed index used for the update (stringified uint64). */
  feedIndex: string
  /** Owner address for the feed update. */
  owner: string
  /** Encryption key for decrypting payload (if encrypted). */
  encryptionKey?: string
  /** Upload tag UID, if provided. */
  tagUid?: number
}

/**
 * Sequential feed reader interface.
 */
export interface SequentialFeedReader {
  /** Resolve feed owner address (20 bytes). */
  getOwner: () => Promise<Address>
  /**
   * Download and decrypt payload (requires encryption key).
   * @param encryptionKey - 32-byte encryption key.
   */
  downloadPayload: (
    encryptionKey: Uint8Array | string,
    options?: SequentialFeedUpdateOptions,
  ) => Promise<SequentialFeedPayloadResult>
  /**
   * Download raw payload or decrypt if encryptionKey is provided in options.
   */
  downloadRawPayload: (
    options?: SequentialFeedDownloadRawOptions,
  ) => Promise<SequentialFeedPayloadResult>
  /**
   * Download and decrypt reference (requires encryption key).
   * @param encryptionKey - 32-byte encryption key.
   */
  downloadReference: (
    encryptionKey: Uint8Array | string,
    options?: SequentialFeedUpdateOptions,
  ) => Promise<SequentialFeedReferenceResult>
}

/**
 * Sequential feed writer interface.
 */
export interface SequentialFeedWriter extends SequentialFeedReader {
  /**
   * Upload encrypted payload.
   */
  uploadPayload: (
    data: Uint8Array | string,
    options?: SequentialFeedUploadOptions,
  ) => Promise<SequentialFeedUploadResult>
  /**
   * Upload raw payload (or encrypted if encryptionKey provided in options).
   */
  uploadRawPayload: (
    data: Uint8Array | string,
    options?: SequentialFeedUploadRawOptions,
  ) => Promise<SequentialFeedUploadResult>
  /**
   * Upload a reference payload (encrypted by default).
   */
  uploadReference: (
    reference: Uint8Array | string,
    options?: SequentialFeedUploadOptions,
  ) => Promise<SequentialFeedUploadResult>
}

// ============================================================================
// Auth Status
// ============================================================================

export const AuthStatusSchema = z.object({
  authenticated: z.boolean(),
  origin: z.string().optional(),
  beeApiUrl: z.string().url().optional(),
})

export type AuthStatus = z.infer<typeof AuthStatusSchema>

// ============================================================================
// Connection Info
// ============================================================================

export const UploadModeSchema = z.enum([
  "user-stamp",
  "subsidised",
  "unavailable",
])

export type UploadMode = z.infer<typeof UploadModeSchema>

/**
 * Why a session cannot upload, when `uploadMode` is `"unavailable"`.
 *
 * - `no-stamp`: the site has no stamp to use. The account has no drive (or
 *   its pointers name only drives that are gone), the person set this site to
 *   no drive, or the person has not yet confirmed the site's drive in the
 *   connect window since the site signed in.
 * - `stamper-failed` — the stamp resolved and the stamper still did not build.
 *   `initializeStamper` logs and returns rather than throwing, so without this
 *   the symptom is indistinguishable from having no stamp at all.
 * - `stamp-expired` — the stamp resolved, but its stored lifetime has run out
 *   (#745). The stamper builds from the record regardless, so without this the
 *   session claimed `user-stamp` and the first refused write surfaced as
 *   partition contention.
 * - `stamp-not-usable` — the stamp resolved and is not expired, but its
 *   stored record says the node does not have the batch (`exists: false`) or
 *   cannot use it (`usable: false`). Opening the drive in the identity UI
 *   refreshes the record from the chain (#765).
 * - `subsidised`: only in a refused `stampChunk`, never in ConnectionInfo.
 *   The account is in subsidised mode, the gateway stamps every upload, so
 *   there is no stamp of the person's to hand back.
 * - `app-stamp-count`, `app-stamp-rate`, `app-bucket-share`: only in a refused
 *   `stampChunk`. The app reached one of its own limits on the account's
 *   stamp (`proxy/app-stamp-limits.ts`): its count on this stamp, its rate,
 *   or its share of the chunk's bucket.
 * - `app-slice-full`: only in a refused `stampChunk`. The chunk's bucket has
 *   no slot left for app stamps, the rest is kept for the account's own
 *   uploads (`ACCOUNT_RESERVED_LANE_SHARE`).
 * - `session-unconfirmed`: the session was restored from storage and the
 *   check that it was not ended while no page was open could not read the
 *   account's published state. Writes stay refused until a later check, made
 *   on the next write, can.
 */
export const UploadUnavailableReasonSchema = z.enum([
  "no-stamp",
  "stamper-failed",
  "stamp-expired",
  "stamp-not-usable",
  "subsidised",
  "app-stamp-count",
  "app-stamp-rate",
  "app-bucket-share",
  "app-slice-full",
  "session-unconfirmed",
])

export type UploadUnavailableReason = z.infer<
  typeof UploadUnavailableReasonSchema
>

/**
 * Where an avatar image came from. Only `generated` — derived from the
 * identity id — exists today; a union so another kind of image could be
 * added without reshaping the value.
 */
export const AvatarSourceSchema = z.enum(["generated"])

export type AvatarSource = z.infer<typeof AvatarSourceSchema>

export const AvatarSchema = z.object({
  source: AvatarSourceSchema,
  /**
   * Renderable as an `<img>` source; a `data:` URL for generated avatars. A
   * URL rather than markup, so the shape does not assume the image is an SVG
   * the caller could regenerate.
   */
  url: z.string(),
})

export type Avatar = z.infer<typeof AvatarSchema>

/** The dApp-visible identity, shared by the snapshot and the wire message. */
export const ConnectionIdentitySchema = z.object({
  id: z.string(),
  name: z.string(),
  address: AddressSchema,
  publicKey: CompressedPublicKeySchema.optional(),
  /**
   * The account-wide ACT key (#519): grant to this to share with the person
   * across every app they use, rather than with one app origin (`appKey`).
   * Every app the account connects can read what is granted to it.
   */
  sharingPublicKey: CompressedPublicKeySchema.optional(),
  /**
   * The address the account's postage signer stamps with (#815). An app that
   * funds storage for the account buys a batch with this as `createBatch`'s
   * owner; the account then adopts it in the identity UI with its own key.
   * Bare hex like `address`.
   */
  postageSignerAddress: AddressSchema.optional(),
  /** Ready-to-render account avatar — every identity has one. */
  avatar: AvatarSchema,
})

export type ConnectionIdentity = z.infer<typeof ConnectionIdentitySchema>

export const ConnectionInfoSchema = z.object({
  /** Whether uploads are available (postage batch + signer key + a built stamper, or a subsidised gateway configured) */
  canUpload: z.boolean(),
  /**
   * Whether the browser gave this proxy iframe its own partitioned store
   * (Safari ITP, strict privacy settings). Reported for UI messaging only —
   * since #277 the connect popup hands the stamps and signer keys over
   * directly, so partitioning does not decide whether uploads work.
   */
  storagePartitioned: z.boolean().optional(),
  /** Current upload mode: "user-stamp" (user has postage stamp), "subsidised" (using dApp gateway), "unavailable" (no upload capability) */
  uploadMode: UploadModeSchema.optional(),
  /**
   * Why `uploadMode` is `"unavailable"`; absent whenever uploads work.
   *
   * The two causes look identical from the dApp side without it, and they
   * call for opposite responses: `"no-stamp"` is the user's to fix (connect
   * again and confirm a drive in the connect window, adding one first if the
   * account has none), `"stamper-failed"` is ours: the stamp resolved and the
   * write path still would not build.
   *
   * Reporting it is what made the real-Safari run (#584) readable: an account
   * with no drive had been reported as a failed `window.opener` handover,
   * which is a claim about ITP rather than about the account.
   */
  uploadUnavailableReason: UploadUnavailableReasonSchema.optional(),
  /**
   * Partition number this device currently holds in the postage batch's
   * partition-lease. `undefined` when no lease is held (sign-in only,
   * pre-first-upload) or for legacy single-device accounts.
   */
  partition: z.number().int().min(0).optional(),
  identity: ConnectionIdentitySchema.optional(),
  /** App-specific key derived from identity + app origin (use publicKey for ACT grantee operations) */
  appKey: z
    .object({
      address: AddressSchema,
      publicKey: CompressedPublicKeySchema,
    })
    .optional(),
  /**
   * The account's signed statement that `appKey.address` on this site is its
   * own (docs/Chat-Binding.md). For the dApp to publish beside its chat, so a
   * reader can check it with `verifyChatBinding`. Present only on a session
   * the connect popup handed over, and only when it names this site, this app
   * key and this account. A reader trusts the newest binding per site.
   */
  chatBinding: ChatBindingSchema.optional(),
  /**
   * The Bee node the site gave (`beeApiUrl`, `setBeeApiUrl`), which its
   * content reads and stamped uploads go through. Absent when the site gave
   * none: the node the person set in Swarm ID is never reported to a site.
   * In subsidised mode the gateway is used instead (`uploadMode`).
   */
  beeApiUrl: z.string().optional(),
  /**
   * The batch id of the stamp the person gave this site in Swarm ID, which
   * `getPostageBatch` reads and `stampChunk` stamps with. Absent when the site
   * has none. Once the person has confirmed the site's drive, they can change
   * it on Swarm ID's Apps screen while the site is open, and a change arrives
   * as a new `connectionInfoChanged`.
   */
  postageBatchId: BatchIdSchema.optional(),
})

export type ConnectionInfo = z.infer<typeof ConnectionInfoSchema>

// ============================================================================
// App Metadata
// ============================================================================

export const AppMetadataSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  icon: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val) return true
        if (!val.startsWith("data:image/")) return false
        const mimeMatch = val.match(/^data:image\/(svg\+xml|png);/)
        if (!mimeMatch) return false
        const base64Match = val.match(/base64,(.+)$/)
        if (base64Match) {
          const approximateSize = (base64Match[1].length * 3) / 4
          if (approximateSize > 4096) return false
        }
        return true
      },
      { message: "Icon must be a data URL with SVG or PNG mime type, max 4KB" },
    ),
})

export type AppMetadata = z.infer<typeof AppMetadataSchema>

// ============================================================================
// Button Frame
// ============================================================================

/**
 * What a mounted Swarm ID button does. Both open the connect window: signed
 * out it signs the person in, signed in it is where they change the stamp the
 * site uses, which the window asks for on every connect.
 */
export const ButtonActionSchema = z.enum(["sign-in", "change-stamp"])
export type ButtonAction = z.infer<typeof ButtonActionSchema>

/** Hosts a font file may be served from over plain http, for local work */
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"]

/** More than a button's label could use, and a bound on what one frame fetches */
const MAX_BUTTON_FONT_FACES = 8

/**
 * A font file's URL: https, or http on a loopback host for local work. The
 * button frame takes loopback http only in a development build.
 */
export function isButtonFontUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname))
  )
}

export const ButtonFontFaceSchema = z.object({
  family: z.string().min(1),
  url: z.string().refine(isButtonFontUrl, {
    message: "A font file is served over https, or over http on localhost",
  }),
  weight: z.union([z.string(), z.number()]).optional(),
  style: z.enum(["normal", "italic", "oblique"]).optional(),
})

/**
 * A font file the button frame loads itself, so the label can use a family
 * the site serves. It is fetched cross-origin from Swarm ID's frame, so the
 * site serves it with an `Access-Control-Allow-Origin` that names Swarm ID's
 * origin. Name `family` in `fontFamily` too, ahead of a fallback.
 */
export type ButtonFontFace = z.infer<typeof ButtonFontFaceSchema>

export const ButtonConfigSchema = z.object({
  text: z.string().optional(),
  busyText: z.string().optional(),
  ariaLabel: z.string().optional(),
  disabled: z.boolean().optional(),
  busy: z.boolean().optional(),
  backgroundColor: z.string().optional(),
  color: z.string().optional(),
  borderRadius: z.string().optional(),
  borderColor: z.string().optional(),
  borderWidth: z.string().optional(),
  borderStyle: z.enum(["solid", "dashed", "dotted", "double"]).optional(),
  fontFamily: z.string().optional(),
  fontSize: z.string().optional(),
  fontWeight: z.union([z.string(), z.number()]).optional(),
  fontFaces: z
    .array(ButtonFontFaceSchema)
    .max(MAX_BUTTON_FONT_FACES)
    .optional(),
})

/**
 * How a mounted Swarm ID button looks and reads. It is painted inside Swarm
 * ID's own frame, where the site's CSS cannot reach, so everything the site
 * wants it to match is said here. The button fills the frame, which fills the
 * site's container, and text that does not fit ends in an ellipsis.
 */
export interface ButtonConfig {
  /** The label. Default: "Sign in with Swarm ID", or "Change stamp in Swarm ID" */
  text?: string
  /** The label while the connect window is open or `busy` is set. Default: "Waiting for Swarm ID" */
  busyText?: string
  /** The accessible name, where the label alone does not say what the button does. Default: the label */
  ariaLabel?: string
  /** Shown but not clickable */
  disabled?: boolean
  /** Shown as working and not clickable, for a step of the site's own, such as signing out */
  busy?: boolean
  /** CSS colour. Default: "#dd7200" */
  backgroundColor?: string
  /** CSS colour of the label. Default: "white" */
  color?: string
  /** CSS border-radius of the button and its frame. Default: "0" */
  borderRadius?: string
  /**
   * CSS colour of a border, for a secondary style. Naming this or
   * `borderWidth` draws one, kept in the busy and disabled looks. Default: the
   * label's colour
   */
  borderColor?: string
  /** CSS width of the border. Default: "1px" once a border is drawn */
  borderWidth?: string
  /** Default: "solid" */
  borderStyle?: "solid" | "dashed" | "dotted" | "double"
  /** CSS font-family. A stack falls back to the first family the frame has, not the page. Default: the frame's own */
  fontFamily?: string
  /** CSS font-size. Default: "14px" */
  fontSize?: string
  /** CSS font-weight, a keyword or a number. Default: "600" */
  fontWeight?: string | number
  /**
   * Font files the frame loads for the label, at most 8. A file that does not
   * load leaves the label in the next family of `fontFamily`, and the frame
   * says so once in the console
   */
  fontFaces?: ButtonFontFace[]
}

/** Where a mounted button's connect window is. `blocked`: the browser refused to open it */
export const ButtonWindowStateSchema = z.enum(["open", "closed", "blocked"])
export type ButtonWindowState = z.infer<typeof ButtonWindowStateSchema>

/** What `SwarmIdClient.mountButton` takes */
export interface MountButtonOptions {
  action: ButtonAction
  config?: ButtonConfig
  /**
   * Called when the button's connect window opens, closes or is blocked, for
   * example to say that the browser blocked it.
   */
  onWindowChange?: (state: ButtonWindowState) => void
}

/** A mounted Swarm ID button */
export interface MountedButton {
  /**
   * Resolves once the button is shown. Rejects with `init-failed` when Swarm
   * ID refuses the site or the frame does not answer in time.
   */
  ready: Promise<void>
  /** Change what the button does or how it looks, in place. Does nothing once unmounted */
  update(options: { action?: ButtonAction; config?: ButtonConfig }): void
  /** Remove the button. The session stays as it is, and `onWindowChange` is not called again */
  unmount(): void
}

export const ButtonIdentifyMessageSchema = z.object({
  type: z.literal("buttonIdentify"),
  action: ButtonActionSchema,
  config: ButtonConfigSchema.optional(),
  metadata: AppMetadataSchema,
  popupMode: z.enum(["popup", "window"]).optional(),
})

export const ButtonUpdateMessageSchema = z.object({
  type: z.literal("buttonUpdate"),
  action: ButtonActionSchema,
  config: ButtonConfigSchema.optional(),
})

export const ParentToButtonMessageSchema = z.discriminatedUnion("type", [
  ButtonIdentifyMessageSchema,
  ButtonUpdateMessageSchema,
])
export type ParentToButtonMessage = z.infer<typeof ParentToButtonMessageSchema>

export const ButtonToParentMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("buttonReady") }),
  z.object({ type: z.literal("buttonInitError"), error: z.string() }),
  z.object({
    type: z.literal("buttonWindowChanged"),
    state: ButtonWindowStateSchema,
  }),
])
export type ButtonToParentMessage = z.infer<typeof ButtonToParentMessageSchema>

/**
 * The button frame telling the session frames beside it that it opened a
 * connect window under this challenge, so the handover that comes back under
 * it is theirs to take.
 */
export const ConnectWindowOpenedMessageSchema = z.object({
  type: z.literal("connectWindowOpened"),
  challenge: z.string(),
})
export type ConnectWindowOpenedMessage = z.infer<
  typeof ConnectWindowOpenedMessageSchema
>

/**
 * Sent by the button frame on a wildcard origin the moment it loads, before
 * the parent has identified itself, so outside the unions above, as
 * `proxyInitialized` is.
 */
export const BUTTON_FRAME_LOADED = "buttonFrameLoaded"

// ============================================================================
// Message Types: Parent → Iframe
// ============================================================================

export const ParentIdentifyMessageSchema = z.object({
  type: z.literal("parentIdentify"),
  requestId: z.string(),
  beeApiUrl: BeeApiUrlSchema.optional(),
  metadata: AppMetadataSchema,
  subsidisedGatewayUrl: z.string().url().optional(),
})

export const CheckAuthMessageSchema = z.object({
  type: z.literal("checkAuth"),
  requestId: z.string(),
})

export const DisconnectMessageSchema = z.object({
  type: z.literal("disconnect"),
  requestId: z.string(),
})

export const UploadDataMessageSchema = z.object({
  type: z.literal("uploadData"),
  requestId: z.string(),
  data: z.instanceof(Uint8Array),
  options: UploadOptionsSchema,
  requestOptions: RequestOptionsSchema,
  enableProgress: z.boolean().optional(),
  useWebSocket: z.boolean().optional(),
  useWorkers: z.boolean().optional(),
  workerCount: z.number().int().min(1).max(32).optional(),
  concurrency: z.number().int().min(1).max(256).optional(),
})

export const DownloadDataMessageSchema = z.object({
  type: z.literal("downloadData"),
  requestId: z.string(),
  reference: ReferenceSchema,
  options: DownloadOptionsSchema,
  requestOptions: RequestOptionsSchema,
})

// Derive a stable, app-scoped secret HMAC(appSecret, label) inside the iframe.
// The raw appSecret never crosses to the parent; only the derived bytes do (#520).
export const DeriveAppSecretMessageSchema = z.object({
  type: z.literal("deriveAppSecret"),
  requestId: z.string(),
  label: z.string(),
})

/**
 * The site's own Bee address for this frame from now on, replacing the one
 * `parentIdentify` gave, for the site's session alone.
 */
export const SetBeeApiUrlMessageSchema = z.object({
  type: z.literal("setBeeApiUrl"),
  requestId: z.string(),
  beeApiUrl: BeeApiUrlSchema,
})

// The site's chat key, the key its chat binding names (docs/Chat-Binding.md).
export const GetChatKeyMessageSchema = z.object({
  type: z.literal("getChatKey"),
  requestId: z.string(),
})

/**
 * Who signs a single-owner chunk in `stampChunk`: the site's own app secret,
 * or a private key the site supplies (a chat's shared GSOC inbox key).
 */
export const StampChunkSignerSchema = z.union([
  z.literal("app"),
  z.strictObject({ privateKey: PrivateKeySchema }),
])

/**
 * The chunk `stampChunk` stamps, always whole so the frame computes its
 * address itself. `data` is span plus payload. Strict, so a chunk that also
 * carries an address, an owner or a signature is refused: the frame never
 * stamps an address it did not compute, nor a chunk somebody else signed.
 */
export const StampChunkRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("content"),
    data: z.instanceof(Uint8Array),
  }),
  z.strictObject({
    kind: z.literal("soc"),
    identifier: IdentifierSchema,
    data: z.instanceof(Uint8Array),
    signer: StampChunkSignerSchema,
  }),
])

// Stamp a chunk with the account's own stamp and hand the stamp back, so the
// app sends the chunk through the Swarm access it chose.
export const StampChunkMessageSchema = z.strictObject({
  type: z.literal("stampChunk"),
  requestId: z.string(),
  chunk: StampChunkRequestSchema,
})

export const UploadFileMessageSchema = z.object({
  type: z.literal("uploadFile"),
  requestId: z.string(),
  data: z.instanceof(Uint8Array),
  name: z.string().optional(),
  options: UploadOptionsSchema,
  requestOptions: RequestOptionsSchema,
  enableProgress: z.boolean().optional(),
  useWebSocket: z.boolean().optional(),
  useWorkers: z.boolean().optional(),
  workerCount: z.number().int().min(1).max(32).optional(),
  concurrency: z.number().int().min(1).max(256).optional(),
})

export const DownloadFileMessageSchema = z.object({
  type: z.literal("downloadFile"),
  requestId: z.string(),
  reference: ReferenceSchema,
  path: z.string().optional(),
  options: DownloadOptionsSchema,
  requestOptions: RequestOptionsSchema,
})

export const UploadFilesMessageSchema = z.object({
  type: z.literal("uploadFiles"),
  requestId: z.string(),
  files: z.array(CollectionFileSchema),
  options: UploadFilesOptionsSchema,
  requestOptions: RequestOptionsSchema,
  enableProgress: z.boolean().optional(),
  useWorkers: z.boolean().optional(),
  workerCount: z.number().int().min(1).max(32).optional(),
})

export const ListFilesMessageSchema = z.object({
  type: z.literal("listFiles"),
  requestId: z.string(),
  reference: ReferenceSchema,
  requestOptions: RequestOptionsSchema,
})

export const UploadChunkMessageSchema = z.object({
  type: z.literal("uploadChunk"),
  requestId: z.string(),
  data: z.instanceof(Uint8Array),
  options: UploadOptionsSchema,
  requestOptions: RequestOptionsSchema,
})

export const DownloadChunkMessageSchema = z.object({
  type: z.literal("downloadChunk"),
  requestId: z.string(),
  reference: ReferenceSchema,
  options: DownloadOptionsSchema,
  requestOptions: RequestOptionsSchema,
})

export const IsConnectedMessageSchema = z.object({
  type: z.literal("isConnected"),
  requestId: z.string(),
})

export const GetNodeInfoMessageSchema = z.object({
  type: z.literal("getNodeInfo"),
  requestId: z.string(),
})

export const GsocMineMessageSchema = z.object({
  type: z.literal("gsocMine"),
  requestId: z.string(),
  targetOverlay: z.string(),
  identifier: z.string(),
  proximity: z.number().optional(),
})

export const GsocSendMessageSchema = z.object({
  type: z.literal("gsocSend"),
  requestId: z.string(),
  signer: z.string(),
  identifier: z.string(),
  data: z.instanceof(Uint8Array),
  options: UploadOptionsSchema,
  requestOptions: RequestOptionsSchema,
})

// SOC (Single Owner Chunk) Message Schemas
export const SocUploadMessageSchema = z.object({
  type: z.literal("socUpload"),
  requestId: z.string(),
  identifier: IdentifierSchema,
  data: z.instanceof(Uint8Array),
  signer: PrivateKeySchema.optional(),
  options: UploadOptionsSchema,
  requestOptions: RequestOptionsSchema,
})

export const SocRawUploadMessageSchema = z.object({
  type: z.literal("socRawUpload"),
  requestId: z.string(),
  identifier: IdentifierSchema,
  data: z.instanceof(Uint8Array),
  signer: PrivateKeySchema.optional(),
  options: UploadOptionsSchema,
  requestOptions: RequestOptionsSchema,
})

export const SocDownloadMessageSchema = z.object({
  type: z.literal("socDownload"),
  requestId: z.string(),
  owner: AddressSchema.optional(),
  identifier: IdentifierSchema,
  encryptionKey: EncryptionKeySchema,
  requestOptions: RequestOptionsSchema,
})

export const SocRawDownloadMessageSchema = z.object({
  type: z.literal("socRawDownload"),
  requestId: z.string(),
  owner: AddressSchema.optional(),
  identifier: IdentifierSchema,
  encryptionKey: EncryptionKeySchema.optional(),
  requestOptions: RequestOptionsSchema,
})

export const SocGetOwnerMessageSchema = z.object({
  type: z.literal("socGetOwner"),
  requestId: z.string(),
})

export const EpochFeedDownloadReferenceMessageSchema = z.object({
  type: z.literal("epochFeedDownloadReference"),
  requestId: z.string(),
  topic: IdentifierSchema,
  owner: AddressSchema.optional(),
  at: TimestampSchema,
  after: TimestampSchema.optional(),
  encryptionKey: EncryptionKeySchema.optional(),
  requestOptions: RequestOptionsSchema,
})

// Schema for epoch hints (used for stateless epoch calculation)
export const EpochHintsSchema = z
  .object({
    lastEpoch: z
      .object({
        start: z.string(), // Stringified bigint
        level: z.number(),
      })
      .optional(),
    lastTimestamp: z.string().optional(), // Stringified bigint
  })
  .optional()

export const EpochFeedUploadReferenceMessageSchema = z.object({
  type: z.literal("epochFeedUploadReference"),
  requestId: z.string(),
  topic: IdentifierSchema,
  signer: PrivateKeySchema.optional(),
  at: TimestampSchema,
  reference: ReferenceSchema,
  encryptionKey: EncryptionKeySchema.optional(),
  hints: EpochHintsSchema,
  requestOptions: RequestOptionsSchema,
})

export const FeedGetOwnerMessageSchema = z.object({
  type: z.literal("feedGetOwner"),
  requestId: z.string(),
})

export const SequentialFeedGetOwnerMessageSchema = z.object({
  type: z.literal("seqFeedGetOwner"),
  requestId: z.string(),
})

export const SequentialFeedDownloadPayloadMessageSchema = z.object({
  type: z.literal("seqFeedDownloadPayload"),
  requestId: z.string(),
  topic: IdentifierSchema,
  owner: AddressSchema.optional(),
  index: FeedIndexSchema.optional(),
  at: TimestampSchema.optional(),
  hasTimestamp: z.boolean().optional(),
  lookupTimeoutMs: z.number().optional(),
  encryptionKey: EncryptionKeySchema,
  requestOptions: RequestOptionsSchema,
})

export const SequentialFeedDownloadRawPayloadMessageSchema = z.object({
  type: z.literal("seqFeedDownloadRawPayload"),
  requestId: z.string(),
  topic: IdentifierSchema,
  owner: AddressSchema.optional(),
  index: FeedIndexSchema.optional(),
  at: TimestampSchema.optional(),
  hasTimestamp: z.boolean().optional(),
  lookupTimeoutMs: z.number().optional(),
  encryptionKey: EncryptionKeySchema.optional(),
  requestOptions: RequestOptionsSchema,
})

export const SequentialFeedDownloadReferenceMessageSchema = z.object({
  type: z.literal("seqFeedDownloadReference"),
  requestId: z.string(),
  topic: IdentifierSchema,
  owner: AddressSchema.optional(),
  index: FeedIndexSchema.optional(),
  at: TimestampSchema.optional(),
  hasTimestamp: z.boolean().optional(),
  lookupTimeoutMs: z.number().optional(),
  encryptionKey: EncryptionKeySchema,
  requestOptions: RequestOptionsSchema,
})

export const SequentialFeedUploadPayloadMessageSchema = z.object({
  type: z.literal("seqFeedUploadPayload"),
  requestId: z.string(),
  topic: IdentifierSchema,
  signer: PrivateKeySchema.optional(),
  data: z.instanceof(Uint8Array),
  index: FeedIndexSchema.optional(),
  at: TimestampSchema.optional(),
  hasTimestamp: z.boolean().optional(),
  lookupTimeoutMs: z.number().optional(),
  options: UploadOptionsSchema,
  requestOptions: RequestOptionsSchema,
})

export const SequentialFeedUploadRawPayloadMessageSchema = z.object({
  type: z.literal("seqFeedUploadRawPayload"),
  requestId: z.string(),
  topic: IdentifierSchema,
  signer: PrivateKeySchema.optional(),
  data: z.instanceof(Uint8Array),
  index: FeedIndexSchema.optional(),
  at: TimestampSchema.optional(),
  hasTimestamp: z.boolean().optional(),
  lookupTimeoutMs: z.number().optional(),
  encryptionKey: EncryptionKeySchema.optional(),
  options: UploadOptionsSchema,
  requestOptions: RequestOptionsSchema,
})

export const SequentialFeedUploadReferenceMessageSchema = z.object({
  type: z.literal("seqFeedUploadReference"),
  requestId: z.string(),
  topic: IdentifierSchema,
  signer: PrivateKeySchema.optional(),
  reference: ReferenceSchema,
  index: FeedIndexSchema.optional(),
  at: TimestampSchema.optional(),
  hasTimestamp: z.boolean().optional(),
  lookupTimeoutMs: z.number().optional(),
  options: UploadOptionsSchema,
  requestOptions: RequestOptionsSchema,
})

// Feed Manifest Message Schema
export const CreateFeedManifestMessageSchema = z.object({
  type: z.literal("createFeedManifest"),
  requestId: z.string(),
  topic: IdentifierSchema,
  owner: AddressSchema.optional(),
  feedType: z.enum(["Sequence", "Epoch"]).optional(),
  uploadOptions: UploadOptionsSchema,
  requestOptions: RequestOptionsSchema,
})

// ACT (Access Control Tries) Message Schemas
export const ActUploadDataMessageSchema = z.object({
  type: z.literal("actUploadData"),
  requestId: z.string(),
  data: z.instanceof(Uint8Array),
  grantees: z.array(z.string()), // Compressed public keys (33 bytes = 66 hex chars)
  options: ActUploadOptionsSchema,
  requestOptions: RequestOptionsSchema,
  enableProgress: z.boolean().optional(),
})

export const ActDownloadDataMessageSchema = z.object({
  type: z.literal("actDownloadData"),
  requestId: z.string(),
  encryptedReference: ReferenceSchema,
  historyReference: ReferenceSchema,
  publisherPubKey: z.string(), // Compressed public key (33 bytes = 66 hex chars)
  timestamp: z.number().optional(), // Optional: specific ACT version
  requestOptions: RequestOptionsSchema,
})

export const ActAddGranteesMessageSchema = z.object({
  type: z.literal("actAddGrantees"),
  requestId: z.string(),
  historyReference: ReferenceSchema,
  grantees: z.array(z.string()), // Compressed public keys to add
  requestOptions: RequestOptionsSchema,
})

export const ActRevokeGranteesMessageSchema = z.object({
  type: z.literal("actRevokeGrantees"),
  requestId: z.string(),
  historyReference: ReferenceSchema,
  encryptedReference: ReferenceSchema, // Needed for key rotation
  revokeGrantees: z.array(z.string()), // Compressed public keys to revoke
  requestOptions: RequestOptionsSchema,
})

export const ActGetGranteesMessageSchema = z.object({
  type: z.literal("actGetGrantees"),
  requestId: z.string(),
  historyReference: ReferenceSchema,
  requestOptions: RequestOptionsSchema,
})

export const GetPostageBatchMessageSchema = z.object({
  type: z.literal("getPostageBatch"),
  requestId: z.string(),
})

export const ParentToIframeMessageSchema = z.discriminatedUnion("type", [
  ParentIdentifyMessageSchema,
  CheckAuthMessageSchema,
  DisconnectMessageSchema,
  UploadDataMessageSchema,
  DownloadDataMessageSchema,
  DeriveAppSecretMessageSchema,
  GetChatKeyMessageSchema,
  SetBeeApiUrlMessageSchema,
  StampChunkMessageSchema,
  UploadFileMessageSchema,
  DownloadFileMessageSchema,
  UploadFilesMessageSchema,
  ListFilesMessageSchema,
  UploadChunkMessageSchema,
  DownloadChunkMessageSchema,
  IsConnectedMessageSchema,
  GetNodeInfoMessageSchema,
  GsocMineMessageSchema,
  GsocSendMessageSchema,
  SocUploadMessageSchema,
  SocRawUploadMessageSchema,
  SocDownloadMessageSchema,
  SocRawDownloadMessageSchema,
  SocGetOwnerMessageSchema,
  EpochFeedDownloadReferenceMessageSchema,
  EpochFeedUploadReferenceMessageSchema,
  FeedGetOwnerMessageSchema,
  SequentialFeedGetOwnerMessageSchema,
  SequentialFeedDownloadPayloadMessageSchema,
  SequentialFeedDownloadRawPayloadMessageSchema,
  SequentialFeedDownloadReferenceMessageSchema,
  SequentialFeedUploadPayloadMessageSchema,
  SequentialFeedUploadRawPayloadMessageSchema,
  SequentialFeedUploadReferenceMessageSchema,
  CreateFeedManifestMessageSchema,
  ActUploadDataMessageSchema,
  ActDownloadDataMessageSchema,
  ActAddGranteesMessageSchema,
  ActRevokeGranteesMessageSchema,
  ActGetGranteesMessageSchema,
  GetPostageBatchMessageSchema,
])

export type ParentIdentifyMessage = z.infer<typeof ParentIdentifyMessageSchema>
export type CheckAuthMessage = z.infer<typeof CheckAuthMessageSchema>
export type DisconnectMessage = z.infer<typeof DisconnectMessageSchema>
export type UploadDataMessage = z.infer<typeof UploadDataMessageSchema>
export type DownloadDataMessage = z.infer<typeof DownloadDataMessageSchema>
export type DeriveAppSecretMessage = z.infer<
  typeof DeriveAppSecretMessageSchema
>
export type GetChatKeyMessage = z.infer<typeof GetChatKeyMessageSchema>
export type SetBeeApiUrlMessage = z.infer<typeof SetBeeApiUrlMessageSchema>
export type StampChunkSigner = z.infer<typeof StampChunkSignerSchema>
export type StampChunkRequest = z.infer<typeof StampChunkRequestSchema>
export type StampChunkMessage = z.infer<typeof StampChunkMessageSchema>
export type UploadFileMessage = z.infer<typeof UploadFileMessageSchema>
export type DownloadFileMessage = z.infer<typeof DownloadFileMessageSchema>
export type UploadFilesMessage = z.infer<typeof UploadFilesMessageSchema>
export type ListFilesMessage = z.infer<typeof ListFilesMessageSchema>
export type UploadChunkMessage = z.infer<typeof UploadChunkMessageSchema>
export type DownloadChunkMessage = z.infer<typeof DownloadChunkMessageSchema>
export type IsConnectedMessage = z.infer<typeof IsConnectedMessageSchema>
export type GetNodeInfoMessage = z.infer<typeof GetNodeInfoMessageSchema>
export type GsocMineMessage = z.infer<typeof GsocMineMessageSchema>
export type GsocSendMessage = z.infer<typeof GsocSendMessageSchema>
export type SocUploadMessage = z.infer<typeof SocUploadMessageSchema>
export type SocRawUploadMessage = z.infer<typeof SocRawUploadMessageSchema>
export type SocDownloadMessage = z.infer<typeof SocDownloadMessageSchema>
export type SocRawDownloadMessage = z.infer<typeof SocRawDownloadMessageSchema>
export type SocGetOwnerMessage = z.infer<typeof SocGetOwnerMessageSchema>
export type EpochFeedDownloadReferenceMessage = z.infer<
  typeof EpochFeedDownloadReferenceMessageSchema
>
export type EpochFeedUploadReferenceMessage = z.infer<
  typeof EpochFeedUploadReferenceMessageSchema
>
export type FeedGetOwnerMessage = z.infer<typeof FeedGetOwnerMessageSchema>
export type SequentialFeedGetOwnerMessage = z.infer<
  typeof SequentialFeedGetOwnerMessageSchema
>
export type SequentialFeedDownloadPayloadMessage = z.infer<
  typeof SequentialFeedDownloadPayloadMessageSchema
>
export type SequentialFeedDownloadRawPayloadMessage = z.infer<
  typeof SequentialFeedDownloadRawPayloadMessageSchema
>
export type SequentialFeedDownloadReferenceMessage = z.infer<
  typeof SequentialFeedDownloadReferenceMessageSchema
>
export type SequentialFeedUploadPayloadMessage = z.infer<
  typeof SequentialFeedUploadPayloadMessageSchema
>
export type SequentialFeedUploadRawPayloadMessage = z.infer<
  typeof SequentialFeedUploadRawPayloadMessageSchema
>
export type SequentialFeedUploadReferenceMessage = z.infer<
  typeof SequentialFeedUploadReferenceMessageSchema
>
export type CreateFeedManifestMessage = z.infer<
  typeof CreateFeedManifestMessageSchema
>
export type ActUploadDataMessage = z.infer<typeof ActUploadDataMessageSchema>
export type ActDownloadDataMessage = z.infer<
  typeof ActDownloadDataMessageSchema
>
export type ActAddGranteesMessage = z.infer<typeof ActAddGranteesMessageSchema>
export type ActRevokeGranteesMessage = z.infer<
  typeof ActRevokeGranteesMessageSchema
>
export type ActGetGranteesMessage = z.infer<typeof ActGetGranteesMessageSchema>
export type GetPostageBatchMessage = z.infer<
  typeof GetPostageBatchMessageSchema
>
export type ParentToIframeMessage = z.infer<typeof ParentToIframeMessageSchema>

// ============================================================================
// Message Types: Iframe → Parent
// ============================================================================

export const ProxyReadyMessageSchema = z.object({
  type: z.literal("proxyReady"),
  authenticated: z.boolean(),
  parentOrigin: z.string(),
  /**
   * Whether the iframe can read the trusted domain's first-party store, which
   * decides which transport `connect()` can use (#613). Optional so an older
   * deployed proxy stays wire-compatible. Absent reads as "not proven shared",
   * and `connect()` then refuses with `button-required`, since only the Swarm
   * ID button works in both modes.
   */
  storageShared: z.boolean().optional(),
})

export const InitErrorMessageSchema = z.object({
  type: z.literal("initError"),
  error: z.string(),
})

export const AuthStatusResponseMessageSchema = z.object({
  type: z.literal("authStatusResponse"),
  requestId: z.string(),
  authenticated: z.boolean(),
  origin: z.string().optional(),
  beeApiUrl: z.string().url().optional(),
})

export const DisconnectResponseMessageSchema = z.object({
  type: z.literal("disconnectResponse"),
  requestId: z.string(),
  success: z.boolean(),
})

export const AuthSuccessMessageSchema = z.object({
  type: z.literal("authSuccess"),
  origin: z.string(),
})

export const UploadDataResponseMessageSchema = z.object({
  type: z.literal("uploadDataResponse"),
  requestId: z.string(),
  reference: ReferenceSchema,
  tagUid: z.number().optional(),
})

export const DownloadDataResponseMessageSchema = z.object({
  type: z.literal("downloadDataResponse"),
  requestId: z.string(),
  data: z.instanceof(Uint8Array),
})

export const DeriveAppSecretResponseMessageSchema = z.object({
  type: z.literal("deriveAppSecretResponse"),
  requestId: z.string(),
  secret: z.instanceof(Uint8Array),
})

export const GetChatKeyResponseMessageSchema = z.object({
  type: z.literal("getChatKeyResponse"),
  requestId: z.string(),
  chatKey: z.instanceof(Uint8Array),
})

export const SetBeeApiUrlResponseMessageSchema = z.object({
  type: z.literal("setBeeApiUrlResponse"),
  requestId: z.string(),
  beeApiUrl: z.string(),
})

export const StampChunkResponseMessageSchema = z.object({
  type: z.literal("stampChunkResponse"),
  requestId: z.string(),
  address: ChunkAddressSchema,
  stamp: MarshaledStampSchema,
  /** A single-owner chunk's owner, set only for one */
  owner: AddressSchema.optional(),
  /** A single-owner chunk's signature, set only for one */
  signature: SignatureSchema.optional(),
})

export const UploadFileResponseMessageSchema = z.object({
  type: z.literal("uploadFileResponse"),
  requestId: z.string(),
  reference: ReferenceSchema,
  tagUid: z.number().optional(),
})

export const DownloadFileResponseMessageSchema = z.object({
  type: z.literal("downloadFileResponse"),
  requestId: z.string(),
  name: z.string(),
  data: z.instanceof(Uint8Array),
})

export const UploadFilesResponseMessageSchema = z.object({
  type: z.literal("uploadFilesResponse"),
  requestId: z.string(),
  reference: ReferenceSchema,
  tagUid: z.number().optional(),
})

export const ListFilesResponseMessageSchema = z.object({
  type: z.literal("listFilesResponse"),
  requestId: z.string(),
  entries: z.array(CollectionEntrySchema),
})

export const UploadChunkResponseMessageSchema = z.object({
  type: z.literal("uploadChunkResponse"),
  requestId: z.string(),
  reference: ReferenceSchema,
})

export const DownloadChunkResponseMessageSchema = z.object({
  type: z.literal("downloadChunkResponse"),
  requestId: z.string(),
  data: z.instanceof(Uint8Array),
})

export const UploadProgressMessageSchema = z.object({
  type: z.literal("uploadProgress"),
  requestId: z.string(),
  total: z.number(),
  processed: z.number(),
})

/**
 * Why a request failed, as a dApp can branch on it (#761). `error.message`
 * carries the text as before; the code is the stable part.
 *
 * - `not-authenticated` — no session for this origin
 * - `upload-unavailable` — the session refuses to stamp; `reason` says why,
 *   in the same vocabulary as `ConnectionInfo.uploadUnavailableReason`
 * - `partition-contended` — every partition of the batch is held by other
 *   devices and none yielded in time
 * - `lease-lost` — this device's partition was reclaimed mid-write
 * - `bee-rejected` — Bee or the gateway answered with a non-2xx status:
 *   `status`, `beeMessage` and `url` say which
 * - `network` — the request never got a response (a CORS preflight refusal
 *   shows as this)
 * - `timeout` — a deadline: the proxy's, or the client's round trip
 * - `invalid-request` — the message or an argument failed validation
 * - `invalid-state` — the client cannot take the call in its current state:
 *   `initialize()` has not resolved, was already called, or `destroy()` ran;
 *   a call (or an `initialize()`) still pending when `destroy()` runs rejects
 *   with it too
 * - `init-failed` — the proxy iframe did not come up: it failed to load, the
 *   proxy refused the origin, or it did not answer within
 *   `initializationTimeout`
 * - `popup-blocked` — the browser blocked the authentication popup `connect()`
 *   opens (not called from a user gesture, or a blocker)
 * - `internal` — anything else, message preserved
 */
export const SwarmIdErrorCodeSchema = z.enum([
  "not-authenticated",
  "upload-unavailable",
  "partition-contended",
  "lease-lost",
  "bee-rejected",
  "network",
  "timeout",
  "invalid-request",
  "invalid-state",
  "init-failed",
  "popup-blocked",
  "button-required",
  "internal",
])
export type SwarmIdErrorCode = z.infer<typeof SwarmIdErrorCodeSchema>

/** The fields of a `SwarmIdError` as they cross the bridge */
export const WireErrorSchema = z.object({
  error: z.string(),
  // Degrade, never drop: the client ships in dApps and meets whatever the
  // trusted domain runs (#662). A newer proxy's code or reason must land as
  // `internal` / no reason with the message intact, not as a message the
  // schema rejects and a request that never settles.
  code: SwarmIdErrorCodeSchema.catch("internal"),
  reason: UploadUnavailableReasonSchema.optional().catch(undefined),
  status: z.number().int().optional(),
  beeMessage: z.string().optional(),
  url: z.string().optional(),
})
export type WireError = z.infer<typeof WireErrorSchema>

export const ErrorMessageSchema = WireErrorSchema.extend({
  type: z.literal("error"),
  requestId: z.string(),
})

export const ConnectionInfoChangedMessageSchema = z.object({
  type: z.literal("connectionInfoChanged"),
  canUpload: z.boolean(),
  storagePartitioned: z.boolean().optional(),
  uploadMode: UploadModeSchema.optional(),
  /**
   * Tolerant on purpose: a reason this lib does not know degrades to
   * `undefined` instead of failing the message. The client drops a
   * `connectionInfoChanged` it cannot parse, and if that is the first one
   * after `proxyReady`, `initialize()` rejects on its timeout — so one
   * unrecognised enum member would stop the dApp starting at all. Reachable
   * through deploy-cache skew alone: a proxy from the #616–#642 window still
   * emits the `"download-only"` this lib removed.
   */
  uploadUnavailableReason:
    UploadUnavailableReasonSchema.optional().catch(undefined),
  identity: ConnectionIdentitySchema.optional(),
  appKey: z
    .object({
      address: AddressSchema,
      publicKey: CompressedPublicKeySchema,
    })
    .optional(),
  partition: z.number().int().min(0).optional(),
  chatBinding: ChatBindingSchema.optional(),
  beeApiUrl: z.string().optional(),
  postageBatchId: BatchIdSchema.optional(),
})

export const IsConnectedResponseMessageSchema = z.object({
  type: z.literal("isConnectedResponse"),
  requestId: z.string(),
  connected: z.boolean(),
})

export const GetNodeInfoResponseMessageSchema = z.object({
  type: z.literal("getNodeInfoResponse"),
  requestId: z.string(),
  beeMode: z.string(),
  chequebookEnabled: z.boolean(),
  swapEnabled: z.boolean(),
})

export const GsocMineResponseMessageSchema = z.object({
  type: z.literal("gsocMineResponse"),
  requestId: z.string(),
  signer: z.string(),
})

export const GsocSendResponseMessageSchema = z.object({
  type: z.literal("gsocSendResponse"),
  requestId: z.string(),
  reference: ReferenceSchema,
  tagUid: z.number().optional(),
})

export const SocUploadResponseMessageSchema = z.object({
  type: z.literal("socUploadResponse"),
  requestId: z.string(),
  reference: ReferenceSchema,
  tagUid: z.number().optional(),
  encryptionKey: z.string().optional(),
  owner: AddressSchema,
})

export const SocRawUploadResponseMessageSchema = z.object({
  type: z.literal("socRawUploadResponse"),
  requestId: z.string(),
  reference: ReferenceSchema,
  tagUid: z.number().optional(),
  encryptionKey: z.string().optional(),
  owner: AddressSchema,
})

export const SocDownloadResponseMessageSchema = z.object({
  type: z.literal("socDownloadResponse"),
  requestId: z.string(),
  data: z.instanceof(Uint8Array),
  identifier: IdentifierSchema,
  signature: SignatureSchema,
  span: z.number(),
  payload: z.instanceof(Uint8Array),
  address: ReferenceSchema,
  owner: AddressSchema,
})

export const SocRawDownloadResponseMessageSchema = z.object({
  type: z.literal("socRawDownloadResponse"),
  requestId: z.string(),
  data: z.instanceof(Uint8Array),
  identifier: IdentifierSchema,
  signature: SignatureSchema,
  span: z.number(),
  payload: z.instanceof(Uint8Array),
  address: ReferenceSchema,
  owner: AddressSchema,
})

export const SocGetOwnerResponseMessageSchema = z.object({
  type: z.literal("socGetOwnerResponse"),
  requestId: z.string(),
  owner: AddressSchema,
})

export const EpochFeedDownloadReferenceResponseMessageSchema = z.object({
  type: z.literal("epochFeedDownloadReferenceResponse"),
  requestId: z.string(),
  reference: ReferenceSchema.optional(),
})

export const EpochFeedUploadReferenceResponseMessageSchema = z.object({
  type: z.literal("epochFeedUploadReferenceResponse"),
  requestId: z.string(),
  socAddress: ReferenceSchema,
  encryptionKey: EncryptionKeySchema.optional(),
  // Epoch info for next update (stateless hints)
  epoch: z.object({
    start: z.string(), // Stringified bigint
    level: z.number(),
  }),
  timestamp: z.string(), // Stringified bigint
})

export const FeedGetOwnerResponseMessageSchema = z.object({
  type: z.literal("feedGetOwnerResponse"),
  requestId: z.string(),
  owner: AddressSchema,
})

export const SequentialFeedGetOwnerResponseMessageSchema = z.object({
  type: z.literal("seqFeedGetOwnerResponse"),
  requestId: z.string(),
  owner: AddressSchema,
})

export const SequentialFeedDownloadPayloadResponseMessageSchema = z.object({
  type: z.literal("seqFeedDownloadPayloadResponse"),
  requestId: z.string(),
  payload: z.instanceof(Uint8Array),
  timestamp: z.number().optional(),
  feedIndex: z.string(),
  feedIndexNext: z.string(),
})

export const SequentialFeedDownloadRawPayloadResponseMessageSchema = z.object({
  type: z.literal("seqFeedDownloadRawPayloadResponse"),
  requestId: z.string(),
  payload: z.instanceof(Uint8Array),
  timestamp: z.number().optional(),
  feedIndex: z.string(),
  feedIndexNext: z.string(),
})

export const SequentialFeedDownloadReferenceResponseMessageSchema = z.object({
  type: z.literal("seqFeedDownloadReferenceResponse"),
  requestId: z.string(),
  reference: ReferenceSchema,
  feedIndex: z.string(),
  feedIndexNext: z.string(),
})

export const SequentialFeedUploadPayloadResponseMessageSchema = z.object({
  type: z.literal("seqFeedUploadPayloadResponse"),
  requestId: z.string(),
  reference: ReferenceSchema,
  feedIndex: z.string(),
  owner: AddressSchema,
  encryptionKey: z.string().optional(),
  tagUid: z.number().optional(),
})

export const SequentialFeedUploadRawPayloadResponseMessageSchema = z.object({
  type: z.literal("seqFeedUploadRawPayloadResponse"),
  requestId: z.string(),
  reference: ReferenceSchema,
  feedIndex: z.string(),
  owner: AddressSchema,
  encryptionKey: z.string().optional(),
  tagUid: z.number().optional(),
})

export const SequentialFeedUploadReferenceResponseMessageSchema = z.object({
  type: z.literal("seqFeedUploadReferenceResponse"),
  requestId: z.string(),
  reference: ReferenceSchema,
  feedIndex: z.string(),
  owner: AddressSchema,
  encryptionKey: z.string().optional(),
  tagUid: z.number().optional(),
})

// Feed Manifest Response Schema
export const CreateFeedManifestResponseMessageSchema = z.object({
  type: z.literal("createFeedManifestResponse"),
  requestId: z.string(),
  reference: ReferenceSchema,
})

// ACT Response Message Schemas
export const ActUploadDataResponseMessageSchema = z.object({
  type: z.literal("actUploadDataResponse"),
  requestId: z.string(),
  encryptedReference: ReferenceSchema,
  historyReference: ReferenceSchema,
  granteeListReference: ReferenceSchema,
  publisherPubKey: z.string(), // Compressed public key
  actReference: ReferenceSchema,
  tagUid: z.number().optional(),
})

export const ActDownloadDataResponseMessageSchema = z.object({
  type: z.literal("actDownloadDataResponse"),
  requestId: z.string(),
  data: z.instanceof(Uint8Array),
})

export const ActAddGranteesResponseMessageSchema = z.object({
  type: z.literal("actAddGranteesResponse"),
  requestId: z.string(),
  historyReference: ReferenceSchema,
  granteeListReference: ReferenceSchema,
  actReference: ReferenceSchema,
})

export const ActRevokeGranteesResponseMessageSchema = z.object({
  type: z.literal("actRevokeGranteesResponse"),
  requestId: z.string(),
  encryptedReference: ReferenceSchema,
  historyReference: ReferenceSchema,
  granteeListReference: ReferenceSchema,
  actReference: ReferenceSchema,
})

export const ActGetGranteesResponseMessageSchema = z.object({
  type: z.literal("actGetGranteesResponse"),
  requestId: z.string(),
  grantees: z.array(z.string()),
})

export const GetPostageBatchResponseMessageSchema = z.object({
  type: z.literal("getPostageBatchResponse"),
  requestId: z.string(),
  postageBatch: PostageBatchSchema.optional(),
})

export const IframeToParentMessageSchema = z.discriminatedUnion("type", [
  ProxyReadyMessageSchema,
  InitErrorMessageSchema,
  AuthStatusResponseMessageSchema,
  DisconnectResponseMessageSchema,
  AuthSuccessMessageSchema,
  UploadDataResponseMessageSchema,
  DownloadDataResponseMessageSchema,
  DeriveAppSecretResponseMessageSchema,
  GetChatKeyResponseMessageSchema,
  SetBeeApiUrlResponseMessageSchema,
  StampChunkResponseMessageSchema,
  UploadFileResponseMessageSchema,
  DownloadFileResponseMessageSchema,
  UploadFilesResponseMessageSchema,
  ListFilesResponseMessageSchema,
  UploadChunkResponseMessageSchema,
  DownloadChunkResponseMessageSchema,
  UploadProgressMessageSchema,
  ErrorMessageSchema,
  ConnectionInfoChangedMessageSchema,
  IsConnectedResponseMessageSchema,
  GetNodeInfoResponseMessageSchema,
  GsocMineResponseMessageSchema,
  GsocSendResponseMessageSchema,
  SocUploadResponseMessageSchema,
  SocRawUploadResponseMessageSchema,
  SocDownloadResponseMessageSchema,
  SocRawDownloadResponseMessageSchema,
  SocGetOwnerResponseMessageSchema,
  EpochFeedDownloadReferenceResponseMessageSchema,
  EpochFeedUploadReferenceResponseMessageSchema,
  FeedGetOwnerResponseMessageSchema,
  SequentialFeedGetOwnerResponseMessageSchema,
  SequentialFeedDownloadPayloadResponseMessageSchema,
  SequentialFeedDownloadRawPayloadResponseMessageSchema,
  SequentialFeedDownloadReferenceResponseMessageSchema,
  SequentialFeedUploadPayloadResponseMessageSchema,
  SequentialFeedUploadRawPayloadResponseMessageSchema,
  SequentialFeedUploadReferenceResponseMessageSchema,
  CreateFeedManifestResponseMessageSchema,
  ActUploadDataResponseMessageSchema,
  ActDownloadDataResponseMessageSchema,
  ActAddGranteesResponseMessageSchema,
  ActRevokeGranteesResponseMessageSchema,
  ActGetGranteesResponseMessageSchema,
  GetPostageBatchResponseMessageSchema,
])

export type ProxyReadyMessage = z.infer<typeof ProxyReadyMessageSchema>
export type InitErrorMessage = z.infer<typeof InitErrorMessageSchema>
export type AuthStatusResponseMessage = z.infer<
  typeof AuthStatusResponseMessageSchema
>
export type DisconnectResponseMessage = z.infer<
  typeof DisconnectResponseMessageSchema
>
export type AuthSuccessMessage = z.infer<typeof AuthSuccessMessageSchema>
export type UploadDataResponseMessage = z.infer<
  typeof UploadDataResponseMessageSchema
>
export type DownloadDataResponseMessage = z.infer<
  typeof DownloadDataResponseMessageSchema
>
export type GetChatKeyResponseMessage = z.infer<
  typeof GetChatKeyResponseMessageSchema
>
export type SetBeeApiUrlResponseMessage = z.infer<
  typeof SetBeeApiUrlResponseMessageSchema
>
export type DeriveAppSecretResponseMessage = z.infer<
  typeof DeriveAppSecretResponseMessageSchema
>
export type StampChunkResponseMessage = z.infer<
  typeof StampChunkResponseMessageSchema
>
export type UploadFileResponseMessage = z.infer<
  typeof UploadFileResponseMessageSchema
>
export type DownloadFileResponseMessage = z.infer<
  typeof DownloadFileResponseMessageSchema
>
export type UploadFilesResponseMessage = z.infer<
  typeof UploadFilesResponseMessageSchema
>
export type ListFilesResponseMessage = z.infer<
  typeof ListFilesResponseMessageSchema
>
export type UploadChunkResponseMessage = z.infer<
  typeof UploadChunkResponseMessageSchema
>
export type DownloadChunkResponseMessage = z.infer<
  typeof DownloadChunkResponseMessageSchema
>
export type UploadProgressMessage = z.infer<typeof UploadProgressMessageSchema>
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>
export type ConnectionInfoChangedMessage = z.infer<
  typeof ConnectionInfoChangedMessageSchema
>
export type IsConnectedResponseMessage = z.infer<
  typeof IsConnectedResponseMessageSchema
>
export type GetNodeInfoResponseMessage = z.infer<
  typeof GetNodeInfoResponseMessageSchema
>
export type GsocMineResponseMessage = z.infer<
  typeof GsocMineResponseMessageSchema
>
export type GsocSendResponseMessage = z.infer<
  typeof GsocSendResponseMessageSchema
>
export type SocUploadResponseMessage = z.infer<
  typeof SocUploadResponseMessageSchema
>
export type SocRawUploadResponseMessage = z.infer<
  typeof SocRawUploadResponseMessageSchema
>
export type SocDownloadResponseMessage = z.infer<
  typeof SocDownloadResponseMessageSchema
>
export type SocRawDownloadResponseMessage = z.infer<
  typeof SocRawDownloadResponseMessageSchema
>
export type SocGetOwnerResponseMessage = z.infer<
  typeof SocGetOwnerResponseMessageSchema
>
export type EpochFeedDownloadReferenceResponseMessage = z.infer<
  typeof EpochFeedDownloadReferenceResponseMessageSchema
>
export type EpochFeedUploadReferenceResponseMessage = z.infer<
  typeof EpochFeedUploadReferenceResponseMessageSchema
>
export type FeedGetOwnerResponseMessage = z.infer<
  typeof FeedGetOwnerResponseMessageSchema
>
export type SequentialFeedGetOwnerResponseMessage = z.infer<
  typeof SequentialFeedGetOwnerResponseMessageSchema
>
export type SequentialFeedDownloadPayloadResponseMessage = z.infer<
  typeof SequentialFeedDownloadPayloadResponseMessageSchema
>
export type SequentialFeedDownloadRawPayloadResponseMessage = z.infer<
  typeof SequentialFeedDownloadRawPayloadResponseMessageSchema
>
export type SequentialFeedDownloadReferenceResponseMessage = z.infer<
  typeof SequentialFeedDownloadReferenceResponseMessageSchema
>
export type SequentialFeedUploadPayloadResponseMessage = z.infer<
  typeof SequentialFeedUploadPayloadResponseMessageSchema
>
export type SequentialFeedUploadRawPayloadResponseMessage = z.infer<
  typeof SequentialFeedUploadRawPayloadResponseMessageSchema
>
export type SequentialFeedUploadReferenceResponseMessage = z.infer<
  typeof SequentialFeedUploadReferenceResponseMessageSchema
>
export type CreateFeedManifestResponseMessage = z.infer<
  typeof CreateFeedManifestResponseMessageSchema
>
export type ActUploadDataResponseMessage = z.infer<
  typeof ActUploadDataResponseMessageSchema
>
export type ActDownloadDataResponseMessage = z.infer<
  typeof ActDownloadDataResponseMessageSchema
>
export type ActAddGranteesResponseMessage = z.infer<
  typeof ActAddGranteesResponseMessageSchema
>
export type ActRevokeGranteesResponseMessage = z.infer<
  typeof ActRevokeGranteesResponseMessageSchema
>
export type ActGetGranteesResponseMessage = z.infer<
  typeof ActGetGranteesResponseMessageSchema
>
export type GetPostageBatchResponseMessage = z.infer<
  typeof GetPostageBatchResponseMessageSchema
>
export type IframeToParentMessage = z.infer<typeof IframeToParentMessageSchema>

// ============================================================================
// Message Types: Popup → Iframe
// ============================================================================

export const AuthDataSchema = z.object({
  secret: z.string(),
  networkSettings: NetworkSettingsSchemaV1.optional(),
  /**
   * Full synced-account projection (the `serializeSyncedAccount` wire shape:
   * no vault, no app secrets) — stamps incl. signer keys, and the
   * `derivationKey` (docs/Account-Bus.md, phase 3).
   *
   * **Required**, and that requirement is the whole of the check: a handover
   * without it produces a session that cannot upload, cannot derive a bus
   * topic, and therefore cannot be told it was revoked. Refusing it here means
   * the parse fails and the `setSecret` is ignored, so no such session is ever
   * built — no mode to carry, no branch to keep in step.
   *
   * The account also carries the identity the dApp is shown, which is why
   * there are no separate `identity*` fields.
   */
  account: SyncedAccountSchemaV1,
  /**
   * The chat binding for this origin, signed in the popup with the account's
   * own key (docs/Chat-Binding.md). The handover is the one way it reaches a
   * dApp, and the proxy passes it on only when it names this parent origin,
   * this secret's address and this account.
   */
  chatBinding: ChatBindingSchema.optional(),
  /**
   * Set on the handover that signs the site in: the person has not yet
   * confirmed which drive the site uses, so the frame holds no stamp. The
   * window's second handover, sent on that confirm, leaves it out.
   */
  stampPending: z.literal(true).optional(),
})

export type AuthData = z.infer<typeof AuthDataSchema>

/**
 * A partitioned session at rest (#635), under
 * {@link partitionSessionStorageKey}.
 *
 * It holds the payload the connect popup handed over — plus the deadline the
 * session was given. In full, what is now at rest for the life of the session:
 *
 * - the **app secret**, this origin's own credential;
 * - the **narrowed stamp projection** — #578 limits it to the stamps this app
 *   can spend, signer keys included;
 * - the account's **`derivationKey`**, which `serializeSyncedAccount` carries.
 *   This one is NOT app-narrowed: it derives the bus topic and envelope keys
 *   and the Swarm encryption/backup keys, so it is the most sensitive field
 *   here. `connect-handshake.ts` names the same trade-off for the in-memory
 *   handover; persisting it widens the window, not the exposure.
 *
 * The popup hands all of it over on every load today; keeping it changes the
 * window from the life of the page to the life of the session, in a store only
 * this (SwarmID origin, dApp origin) pair can read, and sealed there.
 *
 * `connectedUntil` is the same clock the unpartitioned path enforces from
 * shared storage, so both modes end a session on the same rule. What the
 * deadline cannot see is a revoke made while the tab was closed; a restored
 * session verifies against the account's own Swarm state for that.
 */
export const PartitionSessionSchemaV1 = z.object({
  version: z.literal(1),
  parentOrigin: z.string(),
  connectedUntil: z.number(),
  /**
   * The handed-over payload's wire form, as JSON, sealed with this
   * partition's wrapping key (`utils/sealed-values.ts`), so no key in it is
   * plain text on disk. Only
   * the parts that say nothing secret, whose session this is and when it
   * ends, stay readable.
   */
  data: z.string(),
})

export type StoredPartitionSession = z.infer<typeof PartitionSessionSchemaV1>

/** A stored session once opened, with its payload parsed. */
export interface PartitionSession {
  parentOrigin: string
  connectedUntil: number
  data: AuthData
}

export const SetSecretMessageSchema = z.object({
  type: z.literal("setSecret"),
  appOrigin: z.string(),
  challenge: z.string(),
  data: AuthDataSchema,
})

/**
 * What the connect popup posts to the session frame. The popup was opened by
 * the button frame, and posts to the Swarm ID frames beside its opener
 * (`ui/src/lib/handover-targets.ts`).
 */
export const PopupToIframeMessageSchema = z.discriminatedUnion("type", [
  SetSecretMessageSchema,
])

export type SetSecretMessage = z.infer<typeof SetSecretMessageSchema>
export type PopupToIframeMessage = z.infer<typeof PopupToIframeMessageSchema>

// ============================================================================
// Client Configuration
// ============================================================================

export interface ClientOptions {
  iframeOrigin: string
  iframePath?: string
  timeout?: number
  initializationTimeout?: number
  /**
   * Invoked whenever the dApp-visible ConnectionInfo changes (identity rename,
   * default-stamp change, local↔synced account migration, postage stamp added,
   * auth transitions, etc.). Fires once on initial auth check, then on every
   * effective change. The current snapshot is also available synchronously
   * via `client.connectionInfo`.
   */
  onConnectionChange?: (info: ConnectionInfo) => void
  popupMode?: "popup" | "window" // Default: 'window'
  metadata: AppMetadata
  /** URL of a subsidised gateway for users without postage stamps. Gateway handles stamping server-side. */
  subsidisedGatewayUrl?: string
  /**
   * The Bee node this site's content reads and stamped uploads go through, in
   * place of the node the person set in Swarm ID, which keeps applying on
   * every other site. The person's account and device coordination stay on
   * their own node. An http(s) URL, optionally with a path. Change it later
   * with `setBeeApiUrl`. Held by this site's frame alone and never stored.
   */
  beeApiUrl?: string
}

export interface AuthOptions {
  masterKeyStorageKey?: string
}

/**
 * Configuration options for the connect() method.
 */
export interface ConnectOptions {
  /**
   * Override popup mode for this connect call.
   * "popup" opens a sized popup window, "window" opens a full browser tab.
   */
  popupMode?: "popup" | "window"
}

// ============================================================================
// Entity Types (derived from Zod schemas for type safety)
// ============================================================================

export type {
  Account,
  SyncedAccount,
  ConnectedApp,
  PostageStamp,
} from "./schemas"
