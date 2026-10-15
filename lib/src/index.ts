// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * `@solarpunkltd/swarm-id` — what a dApp imports.
 *
 * The identity UI's half (sync, key derivation, the account bus, the proxy)
 * is `@solarpunkltd/swarm-id/internal`; see `internal.ts`. Nothing is exported here
 * for the lib's own sake: the proxy and the client import their modules
 * directly, and tests do the same.
 */

// The client: embeds the hidden iframe, proxies Bee API calls
export { SwarmIdClient } from "./swarm-id-client"

export type {
  ClientOptions,
  AuthStatus,
  ConnectionInfo,
  Avatar,
  AvatarSource,
  PostageBatch,
  AppMetadata,
  ButtonAction,
  ButtonConfig,
  ButtonWindowState,
  MountButtonOptions,
  MountedButton,
  RequestOptions,
  UploadOptions,
  DownloadOptions,
  UploadResult,
  UploadUnavailableReason,
  FileData,
  SingleOwnerChunk,
  SocUploadResult,
  SocRawUploadResult,
  StampChunkInput,
  StampedChunk,
  SOCReader,
  SOCWriter,
  FeedReader,
  FeedWriter,
  SequentialFeedReader,
  SequentialFeedWriter,
  SequentialFeedPayloadResult,
  SequentialFeedReferenceResult,
  SequentialFeedUploadResult,
  ActUploadOptions,
  UploadFilesOptions,
  CollectionFileInput,
  CollectionEntry,
} from "./types"
export type { Reference } from "./schemas"
export { DEFAULT_BEE_NODE_URL } from "./schemas"

// Account avatars — `SwarmIdClient.getAvatar()` resolves the one to render;
// the generator is exported for callers that want the SVG inline
export { generatedAvatar, generatedAvatarSvg } from "./utils/avatar"

// Manifests and mantaray trees, for a dApp that reads a /bzz/ upload back or
// uploads a directory tree
export {
  buildBzzManifestNode,
  extractContentFromFlatManifest,
  extractEntryFromManifest,
} from "./proxy/manifest-builder"
export { saveMantarayTreeRecursively } from "./proxy/mantaray"
export type { UploadCallback } from "./proxy/mantaray"

// The path `uploadFiles` gives a `File` picked from a folder
export { collectionPath } from "./utils/collection"

// Stamp lifetime display
export { formatTTL } from "./utils/ttl"

// Byte⇄hex, 0x-tolerant, throws on malformed input
export { hexToUint8Array, uint8ArrayToHex } from "./utils/hex"

// Every rejection a client call produces: `code` to branch on, `message` as
// before, and Bee's status and message where there was a response (#761)
export { SwarmIdError } from "./errors"
export type { SwarmIdErrorDetails } from "./errors"
export type { SwarmIdErrorCode } from "./types"

// `withTimeout` and `TimeoutError`: the one way this library bounds a wait,
// and the discriminator for it anywhere, the chain reads included
export { withTimeout, TimeoutError } from "./utils/promise"

// Checked JSON-RPC transport — the one contract for "is this an answer?"
export { jsonRpcCall, jsonRpcBatch } from "./utils/json-rpc"
export type { JsonRpcOptions } from "./utils/json-rpc"

// The chat binding (docs/Chat-Binding.md): a reader checks that a chat
// address on a site belongs to a Swarm ID account. The newest binding per
// site is the one to trust.
export {
  CHAT_BINDING_TITLE,
  acceptedChatBinding,
  buildChatBindingMessage,
  isCleanSiteOrigin,
  parseChatBindingMessage,
  verifyChatBinding,
} from "./utils/chat-binding"
export type {
  ChatBinding,
  ChatBindingFields,
  ExpectedChatBinding,
  SiteOriginOptions,
  VerifiedChatBinding,
} from "./utils/chat-binding"
