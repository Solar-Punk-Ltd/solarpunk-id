// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Whether a session restored from storage may still write.
 *
 * A saved session outlives the page that made it, and a revoke made while no
 * page of this site was open is written only to Swarm: the account's published
 * state is the one place a Remove or a Disconnect from another device can be
 * read. So the frame asks it before a restored session's first write, and an
 * answer that never arrived is `unconfirmed`, never "not revoked".
 */

import { Bee, PrivateKey } from "@ethersphere/bee-js"
import {
  BACKUP_KEY_LABEL,
  deriveSecret,
  deriveSwarmEncryptionKey,
} from "../utils/key-derivation"
import { readRoster } from "./device-roster"
import { foldAccountFromSwarm } from "./fold-account-from-swarm"

/**
 * - `allowed`: the published account still has this site connected, or the
 *   account has never published anything (it has no drive, so it cannot have
 *   published a revoke either).
 * - `ended`: the published account removed or disconnected the site after
 *   this session connected, or did so on an entry carrying this session's own
 *   sign-in time, which a removal keeps, so a device that had seen this sign-in
 *   ended it whatever its clock said. A site the account does not list has had
 *   nothing saved about it, its end included, because a removal keeps the
 *   entry with its mark, but only when every device's state was read.
 * - `unconfirmed`: the answer could not be read, or the site is not listed
 *   and a device that could hold its removal went unread.
 */
export type SessionVerdict = "allowed" | "ended" | "unconfirmed"

export async function checkRestoredSession(opts: {
  bee: Bee
  derivationKey: string
  accountId: string
  appOrigin: string
  /** When this session's connection was made. Missing reads as 0, so a
   *  disconnect stands rather than being explained away by a clock that does
   *  not exist. */
  connectedAt: number | undefined
}): Promise<SessionVerdict> {
  try {
    const folded = await foldAccountFromSwarm({
      bee: opts.bee,
      derivationKey: opts.derivationKey,
      accountId: opts.accountId,
    })
    if (!folded)
      return (await hasNeverPublished(opts)) ? "allowed" : "unconfirmed"
    // `connectedUntil` is not read here, because this session's own deadline
    // is enforced on read.
    const app = folded.account.connectedApps.find(
      (entry) => entry.appUrl === opts.appOrigin,
    )
    if (!app) return folded.unreadDevices > 0 ? "unconfirmed" : "allowed"
    const connectedAt = opts.connectedAt ?? 0
    const endedAt = Math.max(app.revokedAt ?? 0, app.disconnectedAt ?? 0)
    if (endedAt === 0) return "allowed"
    // The clock `mergeConnectedApps` ranks membership by: a sign-in after a
    // removal wins there, so it must win here too.
    const endedAfterSignIn = endedAt > connectedAt
    const endedThisSignIn = app.lastConnectedAt >= connectedAt
    return endedAfterSignIn || endedThisSignIn ? "ended" : "allowed"
  } catch {
    return "unconfirmed"
  }
}

/**
 * `foldAccountFromSwarm` answers `undefined` both for an account with no
 * roster and for a roster whose device states could not be read. Only the
 * first is an answer. `readRoster` itself throws when it cannot tell an empty
 * roster from an outage, so an empty list here is a confirmed absence.
 */
async function hasNeverPublished(opts: {
  bee: Bee
  derivationKey: string
  accountId: string
}): Promise<boolean> {
  const swarmEncryptionKey = await deriveSwarmEncryptionKey(opts.derivationKey)
  const owner = new PrivateKey(
    await deriveSecret(swarmEncryptionKey, BACKUP_KEY_LABEL),
  )
    .publicKey()
    .address()
  const devices = await readRoster({
    bee: opts.bee,
    accountId: opts.accountId,
    owner,
  })
  return devices.length === 0
}
