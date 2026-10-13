// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * The check a session restored from storage runs before its first write
 * (review P2-6). A revoke made while the page was closed is only on Swarm, so
 * the published account decides, and an answer that did not arrive is never
 * read as "not revoked".
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Bee } from "@ethersphere/bee-js"
import type { ConnectedApp, Device } from "../schemas"

const foldAccountFromSwarm = vi.fn()
const readRoster = vi.fn()
vi.mock("./fold-account-from-swarm", () => ({
  foldAccountFromSwarm: (...args: unknown[]) => foldAccountFromSwarm(...args),
}))
vi.mock("./device-roster", () => ({
  readRoster: (...args: unknown[]) => readRoster(...args),
}))

import { checkRestoredSession } from "./session-check"

const SITE = "https://dapp.example.com"
const CONNECTED_AT = 1_000_000
const DEVICE: Device = {
  deviceId: "d1",
  name: "d1",
  createdAt: 1,
  lastSignedInAt: 1,
}

function published(apps: ConnectedApp[]) {
  return { account: { connectedApps: apps }, devices: [DEVICE] }
}

function check() {
  return checkRestoredSession({
    bee: {} as Bee,
    derivationKey: "cd".repeat(32),
    accountId: "b".repeat(40),
    appOrigin: SITE,
    connectedAt: CONNECTED_AT,
  })
}

describe("checkRestoredSession", () => {
  beforeEach(() => {
    foldAccountFromSwarm.mockReset()
    readRoster.mockReset()
  })

  it("allows a session whose published entry is still connected", async () => {
    foldAccountFromSwarm.mockResolvedValue(
      published([
        { appUrl: SITE, appName: "dApp", lastConnectedAt: CONNECTED_AT },
      ]),
    )
    expect(await check()).toBe("allowed")
  })

  it("ends a session the account removed", async () => {
    foldAccountFromSwarm.mockResolvedValue(
      published([
        {
          appUrl: SITE,
          appName: "dApp",
          lastConnectedAt: CONNECTED_AT,
          revokedAt: CONNECTED_AT + 1,
        },
      ]),
    )
    expect(await check()).toBe("ended")
  })

  it("ends a session the account disconnected after it connected", async () => {
    foldAccountFromSwarm.mockResolvedValue(
      published([
        {
          appUrl: SITE,
          appName: "dApp",
          lastConnectedAt: CONNECTED_AT,
          disconnectedAt: CONNECTED_AT + 1,
        },
      ]),
    )
    expect(await check()).toBe("ended")
  })

  it("allows a session that reconnected after an older disconnect", async () => {
    foldAccountFromSwarm.mockResolvedValue(
      published([
        {
          appUrl: SITE,
          appName: "dApp",
          lastConnectedAt: CONNECTED_AT,
          disconnectedAt: CONNECTED_AT - 1000,
        },
      ]),
    )
    expect(await check()).toBe("allowed")
  })

  it("ends a session whose site the published account no longer has", async () => {
    foldAccountFromSwarm.mockResolvedValue(published([]))
    expect(await check()).toBe("ended")
  })

  // An account with no drive cannot publish, so it cannot have published a
  // revoke either. The roster read that says so is a confirmed absence, not
  // a failed read.
  it("allows a session of an account that has never published", async () => {
    foldAccountFromSwarm.mockResolvedValue(undefined)
    readRoster.mockResolvedValue([])
    expect(await check()).toBe("allowed")
  })

  it("cannot confirm a session when the account's state could not be read", async () => {
    foldAccountFromSwarm.mockResolvedValue(undefined)
    readRoster.mockResolvedValue([DEVICE])
    expect(await check()).toBe("unconfirmed")
  })

  it("cannot confirm a session when Swarm cannot be reached", async () => {
    foldAccountFromSwarm.mockRejectedValue(new Error("network down"))
    expect(await check()).toBe("unconfirmed")
  })

  it("cannot confirm a session when the roster read fails", async () => {
    foldAccountFromSwarm.mockResolvedValue(undefined)
    readRoster.mockRejectedValue(new Error("inconclusive"))
    expect(await check()).toBe("unconfirmed")
  })
})
