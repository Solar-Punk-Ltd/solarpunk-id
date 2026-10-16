// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * The wallet link as the account last published it, which is how a site's
 * frame that was closed while the setting changed learns of it on its next
 * load (docs/Wallet-Link.md).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Bee } from "@ethersphere/bee-js"
import { signedWalletLink } from "../test-fixtures"

const foldAccountFromSwarm = vi.fn()
vi.mock("./fold-account-from-swarm", () => ({
  foldAccountFromSwarm: (...args: unknown[]) => foldAccountFromSwarm(...args),
}))

import { readPublishedWalletLink } from "./published-wallet-link"

const CHANGED_AT = 3_000_000

function read() {
  return readPublishedWalletLink({
    bee: {} as Bee,
    derivationKey: "cd".repeat(32),
    accountId: "b".repeat(40),
  })
}

describe("readPublishedWalletLink", () => {
  beforeEach(() => {
    foldAccountFromSwarm.mockReset()
  })

  it("answers the published link on its own clock", async () => {
    const walletLink = signedWalletLink()
    foldAccountFromSwarm.mockResolvedValue({
      account: { walletLink, walletLinkAt: CHANGED_AT },
    })
    expect(await read()).toEqual({ walletLink, walletLinkAt: CHANGED_AT })
  })

  it("answers a link turned off as no link on its clock", async () => {
    foldAccountFromSwarm.mockResolvedValue({
      account: { walletLink: undefined, walletLinkAt: CHANGED_AT },
    })
    expect(await read()).toEqual({
      walletLink: undefined,
      walletLinkAt: CHANGED_AT,
    })
  })

  it("answers nothing for an account that never published", async () => {
    foldAccountFromSwarm.mockResolvedValue(undefined)
    expect(await read()).toBeUndefined()
  })

  it("answers nothing when Swarm cannot be read", async () => {
    foldAccountFromSwarm.mockRejectedValue(new Error("unreachable"))
    expect(await read()).toBeUndefined()
  })
})
