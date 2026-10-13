// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest"
import { DAY, DEFAULT_SESSION_DURATION, appSessionDuration } from "./constants"

describe("appSessionDuration", () => {
  // A saved session is a key a revoked site keeps until it next loads, so the
  // default is a week rather than a month (review P2-6).
  it("defaults to 7 days", () => {
    expect(DEFAULT_SESSION_DURATION).toBe(7 * DAY)
    expect(appSessionDuration(undefined)).toBe(7 * DAY)
    expect(appSessionDuration({})).toBe(7 * DAY)
  })

  it("keeps the account's own setting", () => {
    expect(appSessionDuration({ appSessionDuration: 30 * DAY })).toBe(30 * DAY)
  })
})
