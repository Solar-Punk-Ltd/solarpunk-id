// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * The limits on what one app may stamp with the account's stamp: a count per
 * stamp, a rate, and a share of any one bucket. Each refusal names the limit.
 */

import { describe, it, expect } from "vitest"
import {
  APP_BUCKET_SHARE,
  APP_STAMP_COUNT_LIMIT,
  APP_STAMP_RATE_LIMIT,
  APP_STAMP_RATE_WINDOW_MS,
  appBucketCap,
  appRestampRefusal,
  appStampRefusal,
  emptyAppStampUsage,
  parseAppStampUsage,
  recordAppRestamp,
  recordAppStamp,
  type AppStampUsage,
} from "./app-stamp-limits"

const NOW = 1_700_000_000_000
const LANE_CAPACITY = 7
const BUCKET = 0x0abc
const OTHER_BUCKET = 0x0def

const at = (bucket = BUCKET, now = NOW) => ({
  bucket,
  laneCapacity: LANE_CAPACITY,
  now,
})

describe("app stamp limits", () => {
  it("allows a first stamp", () => {
    expect(appStampRefusal(emptyAppStampUsage(), at())).toBeUndefined()
  })

  it("refuses once the app has used its count on this stamp, naming the limit", () => {
    const usage: AppStampUsage = {
      ...emptyAppStampUsage(),
      count: APP_STAMP_COUNT_LIMIT - 1,
    }
    expect(appStampRefusal(usage, at())).toBeUndefined()

    const refusal = appStampRefusal(
      recordAppStamp(usage, OTHER_BUCKET, NOW),
      at(),
    )

    expect(refusal).toMatchObject({
      code: "upload-unavailable",
      reason: "app-stamp-count",
    })
    expect(refusal?.message).toContain("count limit")
    expect(refusal?.message).toContain(String(APP_STAMP_COUNT_LIMIT))
  })

  it("keeps the count when the rate window resets", () => {
    const usage: AppStampUsage = {
      ...emptyAppStampUsage(),
      count: APP_STAMP_COUNT_LIMIT,
      windowStart: NOW,
      windowCount: 1,
    }

    const later = NOW + APP_STAMP_RATE_WINDOW_MS
    expect(appStampRefusal(usage, at(BUCKET, later))).toMatchObject({
      reason: "app-stamp-count",
    })
  })

  it("refuses past the rate limit within a window, and allows again once the window has passed", () => {
    const usage: AppStampUsage = {
      ...emptyAppStampUsage(),
      windowStart: NOW,
      windowCount: APP_STAMP_RATE_LIMIT - 1,
    }
    expect(appStampRefusal(usage, at())).toBeUndefined()
    const full = recordAppStamp(usage, OTHER_BUCKET, NOW)

    const refusal = appStampRefusal(
      full,
      at(BUCKET, NOW + APP_STAMP_RATE_WINDOW_MS - 1),
    )
    expect(refusal).toMatchObject({
      code: "upload-unavailable",
      reason: "app-stamp-rate",
    })
    expect(refusal?.message).toContain("rate limit")
    expect(refusal?.message).toContain(String(APP_STAMP_RATE_LIMIT))

    const later = NOW + APP_STAMP_RATE_WINDOW_MS
    expect(appStampRefusal(full, at(BUCKET, later))).toBeUndefined()
    const next = recordAppStamp(full, BUCKET, later)
    expect(next.windowStart).toBe(later)
    expect(next.windowCount).toBe(1)
  })

  it("starts a new window when the clock went back past the window's start", () => {
    const usage: AppStampUsage = {
      ...emptyAppStampUsage(),
      windowStart: NOW,
      windowCount: APP_STAMP_RATE_LIMIT,
    }
    expect(appStampRefusal(usage, at(BUCKET, NOW - 1))).toBeUndefined()
  })

  it("caps one app at a share of a bucket's lane, and other buckets stay open", () => {
    const cap = appBucketCap(LANE_CAPACITY)
    expect(cap).toBe(Math.floor(LANE_CAPACITY * APP_BUCKET_SHARE))
    expect(cap).toBeGreaterThan(0)

    let usage = emptyAppStampUsage()
    for (let i = 0; i < cap; i++) {
      expect(appStampRefusal(usage, at())).toBeUndefined()
      usage = recordAppStamp(usage, BUCKET, NOW + i)
    }

    const refusal = appStampRefusal(usage, at())
    expect(refusal).toMatchObject({
      code: "upload-unavailable",
      reason: "app-bucket-share",
    })
    expect(refusal?.message).toContain("bucket share limit")
    expect(appStampRefusal(usage, at(OTHER_BUCKET))).toBeUndefined()
  })

  it("records a stamp in the count, the window and the bucket", () => {
    const usage = recordAppStamp(emptyAppStampUsage(), BUCKET, NOW)

    expect(usage).toEqual({
      count: 1,
      windowStart: NOW,
      windowCount: 1,
      buckets: { [BUCKET]: 1 },
    })
  })

  it("lets a stamp again at a slot already taken past the bucket share, but not past the count or the rate", () => {
    let full = emptyAppStampUsage()
    for (let i = 0; i < appBucketCap(LANE_CAPACITY); i++) {
      full = recordAppStamp(full, BUCKET, NOW)
    }
    expect(appStampRefusal(full, at())).toMatchObject({
      reason: "app-bucket-share",
    })
    expect(appRestampRefusal(full, NOW)).toBeUndefined()

    expect(
      appRestampRefusal(
        { ...emptyAppStampUsage(), count: APP_STAMP_COUNT_LIMIT },
        NOW,
      ),
    ).toMatchObject({ reason: "app-stamp-count" })
    expect(
      appRestampRefusal(
        {
          ...emptyAppStampUsage(),
          windowStart: NOW,
          windowCount: APP_STAMP_RATE_LIMIT,
        },
        NOW,
      ),
    ).toMatchObject({ reason: "app-stamp-rate" })
  })

  it("records a stamp again in the count and the window, never in a bucket", () => {
    const usage = recordAppRestamp(
      recordAppStamp(emptyAppStampUsage(), BUCKET, NOW),
      NOW + 1,
    )

    expect(usage).toEqual({
      count: 2,
      windowStart: NOW,
      windowCount: 2,
      buckets: { [BUCKET]: 1 },
    })
  })

  it("reads back what it stored, and starts fresh from nothing or a malformed record", () => {
    const usage = recordAppStamp(emptyAppStampUsage(), BUCKET, NOW)

    expect(parseAppStampUsage(JSON.stringify(usage))).toEqual(usage)
    expect(parseAppStampUsage(null)).toEqual(emptyAppStampUsage())
    expect(parseAppStampUsage("not json")).toEqual(emptyAppStampUsage())
    expect(parseAppStampUsage(JSON.stringify({ count: "many" }))).toEqual(
      emptyAppStampUsage(),
    )
  })
})
