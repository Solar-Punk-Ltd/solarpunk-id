// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * The wallet link as the account last published it (docs/Wallet-Link.md).
 *
 * "Show my ENS name on sites" reaches an open site's frame over the account
 * bus, and the bus keeps no mailbox. A change made while no page of a site was
 * open is written only to Swarm, so a site's frame restored on its next load
 * reads it here. The read is the restored-session check's own fold, which
 * `foldAccountFromSwarm` shares between the two while both are in flight.
 */

import type { Bee } from "@ethersphere/bee-js"
import type { WalletLink } from "../utils/wallet-link"
import { foldAccountFromSwarm } from "./fold-account-from-swarm"

export interface PublishedWalletLink {
  /** Absent when the setting was last turned off */
  walletLink: WalletLink | undefined
  /** The link's own last-writer-wins clock */
  walletLinkAt: number
}

/**
 * Answers `undefined` for an account that never published and for a Swarm
 * that could not be read. Neither says anything about the setting, so the
 * frame keeps what it holds.
 */
export async function readPublishedWalletLink(opts: {
  bee: Bee
  derivationKey: string
  accountId: string
}): Promise<PublishedWalletLink | undefined> {
  try {
    const folded = await foldAccountFromSwarm(opts)
    if (!folded) return undefined
    return {
      walletLink: folded.account.walletLink,
      walletLinkAt: folded.account.walletLinkAt,
    }
  } catch {
    return undefined
  }
}
