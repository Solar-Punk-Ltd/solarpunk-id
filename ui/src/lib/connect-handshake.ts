// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Completing a dApp connection from the connect popup.
 *
 * The account is the single nested record (the `@solarpunkltd/swarm-id` Zod model
 * persisted under `STORAGE_KEY_ACCOUNTS`): it owns the `connectedApps` entry
 * carrying the app secret the dApp's proxy iframe authenticates from. Writing it
 * (via `accountsStore`) fires a storage event in the iframe, which picks up the
 * session. When storage is partitioned the secret is handed to the iframe via a
 * `setSecret` postMessage instead.
 *
 * Key model (master key = the account wallet's private key): the per-app secret
 * derives straight from the master key (`deriveSecret(master, appOrigin)`).
 *
 * While the master key is unlocked here, and only here, it also signs the
 * site's chat binding (docs/Chat-Binding.md): the account's statement that the
 * address of the site's chat key, derived from that app secret, is its chat
 * address on the site. One binding per site is kept on the connection, so a
 * reconnect reuses it.
 */
import { type ChatBinding, acceptedChatBinding } from '@solarpunkltd/swarm-id'
import {
  type ConnectedApp,
  type SyncedAccount,
  appSessionDuration,
  createChatBinding,
  deriveSecret,
  onlySiteChatBinding,
  serializeSyncedAccount,
  siteChatAddress,
  stampsReachableByApp,
} from '@solarpunkltd/swarm-id/internal'

import { requireCleanSite } from '$lib/accepted-site'
import { strip0x } from '$lib/crypto/hex'
import { privateKeyFromEntropy } from '$lib/crypto/mnemonic'
import type { ConnectRequest } from '$lib/stores/connect.svelte'
import { networkSettingsStore } from '$lib/stores/network-settings.svelte'
import type { Account } from '$lib/types'

/**
 * Write the connected-app entry into the account record (this is what fires the
 * storage event the proxy iframe authenticates from).
 */
function saveConnection(
  account: Account,
  request: ConnectRequest,
  appSecret: string,
  chatBinding: ChatBinding | undefined,
): void {
  const now = Date.now()
  const connection: ConnectedApp = {
    appUrl: request.appOrigin,
    appName: request.appName,
    appIcon: request.appIcon,
    appDescription: request.appDescription,
    appSecret,
    lastConnectedAt: now,
    connectedUntil: now + appSessionDuration(account.settings),
    chatBinding,
  }
  account.connectApp(connection)
}

/**
 * The binding this account already keeps for the site, if it still names this
 * site, the address of this app secret's chat key and this account. Anything
 * else is replaced, never handed over.
 */
function keptChatBinding(
  account: Account,
  appOrigin: string,
  appSecret: string,
): ChatBinding | undefined {
  const kept = account.connectedApps.find((app) => app.appUrl === appOrigin)?.chatBinding
  return acceptedChatBinding(
    kept,
    {
      site: appOrigin,
      chatAddress: siteChatAddress(appSecret),
      signer: account.id.toHex(),
    },
    { allowLocalHttp: import.meta.env.DEV },
  )
}

/**
 * The account view handed to a partitioned proxy iframe: the synced projection
 * (no vault, no app secrets) with the stamp collection narrowed to the ones
 * THIS app can spend — its own batch override and the account default it falls
 * through to (#578).
 *
 * The iframe is on the SwarmID origin and an unpartitioned proxy reads the same
 * material out of shared storage, so this is least privilege rather than a
 * boundary being fixed. But before #547 a partitioned session held no
 * credentials at all, and it now holds real ones in a context embedded by an
 * arbitrary dApp page: anything that gains script execution there gets what it
 * was handed. It can only ever spend the one stamp resolved for it, so the rest
 * of the collection's signer keys are pure exposure with no use.
 *
 * `derivationKey` stays, and that is the honest trade-off to state rather than
 * hide: the account bus derives its topic and envelope key from it
 * (`deriveBusContext`), and the partition lease derives the Swarm encryption
 * key and the lock-SOC signer from it (`deriveSwarmEncryptionKey` →
 * `backup-key`). A partitioned session cannot write without it.
 *
 * Which means this narrows what the session HOLDS, not what it could learn: the
 * key that opens the room stays, and an `account-delta` carries the whole
 * collection (the publisher is unpartitioned and does not know its receivers'
 * apps), so script execution in that iframe can wait for one message. Bounding
 * that as well needs per-app deltas in a per-app room — out of scope for #578.
 *
 * Chat bindings are narrowed the same way, to this app's own: each one links
 * the account to its chat on another site (docs/Chat-Binding.md). The bus
 * carries none, so for them the narrowing holds on the wire too.
 */
export function partitionHandoverAccount(
  account: SyncedAccount,
  appOrigin: string,
): Record<string, unknown> {
  const app = account.connectedApps.find((entry) => entry.appUrl === appOrigin)
  return serializeSyncedAccount({
    ...account,
    connectedApps: onlySiteChatBinding(account.connectedApps, appOrigin),
    postageStamps: stampsReachableByApp(
      { postageStampBatchID: app?.postageStampBatchID },
      account,
      account.postageStamps,
    ),
  })
}

/**
 * Storage-partitioning fallback: hand the secret straight to the proxy iframe
 * (our window.opener) since it can't see our localStorage. `account` carries
 * the narrowed synced projection above — the identity the dApp is shown comes
 * off it, so nothing separate is sent for that (docs/Account-Bus.md, phase 3).
 *
 * The projection is not optional: `AuthDataSchema` requires it, and a payload
 * without one is refused rather than producing a session that cannot upload
 * and cannot be told it was revoked.
 */
function sendSecretToOpener(
  account: Account,
  request: ConnectRequest,
  appSecret: string,
  chatBinding: ChatBinding | undefined,
): void {
  if (!request.partitionChallenge || !window.opener) {
    return
  }
  const message = {
    type: 'setSecret',
    appOrigin: request.appOrigin,
    challenge: request.partitionChallenge,
    data: {
      secret: appSecret,
      account: partitionHandoverAccount(account.toSyncedRecord(), request.appOrigin),
      networkSettings: networkSettingsStore.settings,
      chatBinding,
    },
  }
  // The account collections and network settings are Svelte $state proxies,
  // which structured clone rejects (DataCloneError). The payload is already
  // the JSON wire shape, so a JSON round-trip strips the reactivity.
  window.opener.postMessage(JSON.parse(JSON.stringify(message)), window.location.origin)
}

/**
 * Derive the app secret from the unlocked account and persist the connection.
 * The proxy iframe in the dApp picks it up via storage event (or postMessage
 * when partitioned) and authenticates.
 */
export async function completeConnect(
  account: Account,
  entropy: Uint8Array,
  request: ConnectRequest,
): Promise<void> {
  requireCleanSite(request.appOrigin)
  const masterKey = strip0x(privateKeyFromEntropy(entropy))
  const appSecret = await deriveSecret(masterKey, request.appOrigin)
  const chatBinding =
    keptChatBinding(account, request.appOrigin, appSecret) ??
    createChatBinding(masterKey, request.appOrigin, new Date(), {
      allowLocalHttp: import.meta.env.DEV,
    })
  saveConnection(account, request, appSecret, chatBinding)
  sendSecretToOpener(account, request, appSecret, chatBinding)
}

/** The still-valid prior connection to this app, if the account has one. */
function findReusableConnection(account: Account, appOrigin: string): ConnectedApp | undefined {
  return account.connectedApps.find(
    (app) =>
      app.appUrl === appOrigin &&
      app.appSecret !== undefined &&
      app.revokedAt === undefined &&
      (app.connectedUntil ?? 0) > Date.now(),
  )
}

/**
 * Reconnect with the secret of a still-valid prior connection, skipping the
 * unlock ceremony. Returns false when there is none, or when the connection
 * keeps no binding that still names this site's chat key, so a full unlock +
 * derivation is required and signs a fresh binding. Only the unlock can sign.
 */
export function reuseConnection(account: Account, request: ConnectRequest): boolean {
  requireCleanSite(request.appOrigin)
  const existing = findReusableConnection(account, request.appOrigin)
  if (!existing?.appSecret) {
    return false
  }
  const chatBinding = keptChatBinding(account, request.appOrigin, existing.appSecret)
  if (!chatBinding) {
    return false
  }
  saveConnection(account, request, existing.appSecret, chatBinding)
  sendSecretToOpener(account, request, existing.appSecret, chatBinding)
  return true
}

/**
 * Hand the session over again once the person picked the site's drive on the
 * done screen, which comes after the handover above. A frame kept apart from
 * this window's storage learns of the pick this way only, so an open site
 * moves to it at once. Same challenge, secret and binding as the handover
 * before it, which is what the proxy checks before taking it. A frame that
 * reads shared storage is not sent anything, the saved pick reaches it there.
 */
export function handOverPickedStamp(account: Account, request: ConnectRequest): void {
  requireCleanSite(request.appOrigin)
  const connection = findReusableConnection(account, request.appOrigin)
  if (!connection?.appSecret) {
    return
  }
  sendSecretToOpener(
    account,
    request,
    connection.appSecret,
    keptChatBinding(account, request.appOrigin, connection.appSecret),
  )
}
