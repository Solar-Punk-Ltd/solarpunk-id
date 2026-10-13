// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Whether a session restored from storage may still write (review P2-6).
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
 * - `ended`: the published account removed the site, disconnected it after
 *   this session connected, or no longer lists it.
 * - `unconfirmed`: the answer could not be read.
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
    // `connectedUntil` is not read: the published form strips it with
    // `appSecret`, and this session's own deadline is enforced on read.
    const app = folded.account.connectedApps.find(
      (entry) => entry.appUrl === opts.appOrigin,
    )
    const ended =
      app === undefined ||
      app.revokedAt !== undefined ||
      (app.disconnectedAt !== undefined &&
        app.disconnectedAt > (opts.connectedAt ?? 0))
    return ended ? "ended" : "allowed"
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
