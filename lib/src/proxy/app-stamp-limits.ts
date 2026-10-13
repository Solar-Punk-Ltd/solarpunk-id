// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * What one app may stamp with the account's stamp through `stampChunk`. A
 * hacked or greedy app could otherwise fill the person's stamp, so each app
 * origin gets a count per stamp, a rate, and a share of any one bucket. The
 * frame keeps the usage per app origin and per stamp in its own storage, so a
 * reload of the app does not reset it. A new stamp starts a new count.
 */

import { z } from "zod"
import { SwarmIdError } from "../errors"

/** Slots one app may spend from one of the account's stamps, ever. A stamp again at a slot already held spends none */
export const APP_STAMP_COUNT_LIMIT = 10_000

/** Stamps one app may take within one {@link APP_STAMP_RATE_WINDOW_MS} */
export const APP_STAMP_RATE_LIMIT = 60

/** The rate limit's window. A window starts at the first stamp after the last one ended */
export const APP_STAMP_RATE_WINDOW_MS = 60 * 1000

/**
 * Share of a bucket's data lane one app may use. Rounded down, so at the
 * smallest usable depth (lane of 7) an app gets 2 slots in any one bucket.
 */
export const APP_BUCKET_SHARE = 1 / 3

const MS_PER_SECOND = 1000

const AppStampUsageSchema = z.object({
  count: z.number().int().nonnegative(),
  windowStart: z.number(),
  windowCount: z.number().int().nonnegative(),
  /** Stamps per bucket index */
  buckets: z.record(z.string(), z.number().int().nonnegative()),
})

/** What one app has stamped with one of the account's stamps */
export type AppStampUsage = z.infer<typeof AppStampUsageSchema>

export function emptyAppStampUsage(): AppStampUsage {
  return { count: 0, windowStart: 0, windowCount: 0, buckets: {} }
}

/**
 * The stored usage, or an empty one when there is none. Only the frame writes
 * the record, so a malformed one is a bug of ours and starts over rather than
 * locking the app out for good.
 */
export function parseAppStampUsage(raw: string | null): AppStampUsage {
  if (raw === null) return emptyAppStampUsage()
  try {
    const parsed = AppStampUsageSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : emptyAppStampUsage()
  } catch {
    return emptyAppStampUsage()
  }
}

/** Slots one app may use in one bucket of a lane this size */
export function appBucketCap(laneCapacity: number): number {
  return Math.floor(laneCapacity * APP_BUCKET_SHARE)
}

function windowIsCurrent(usage: AppStampUsage, now: number): boolean {
  return (
    now >= usage.windowStart &&
    now - usage.windowStart < APP_STAMP_RATE_WINDOW_MS
  )
}

function limitRefusal(
  reason: "app-stamp-count" | "app-stamp-rate" | "app-bucket-share",
  message: string,
): SwarmIdError {
  return new SwarmIdError("upload-unavailable", message, { reason })
}

/**
 * Why stamping a single-owner chunk again at the slot it already holds is
 * refused for this app, or undefined when it is allowed. No slot is spent, so
 * only the count and the rate apply, not the bucket share.
 */
export function appRestampRefusal(
  usage: AppStampUsage,
  now: number,
): SwarmIdError | undefined {
  if (usage.count >= APP_STAMP_COUNT_LIMIT) {
    return limitRefusal(
      "app-stamp-count",
      `This app has used its count limit of ${APP_STAMP_COUNT_LIMIT} stamps on this stamp.`,
    )
  }
  if (
    windowIsCurrent(usage, now) &&
    usage.windowCount >= APP_STAMP_RATE_LIMIT
  ) {
    return limitRefusal(
      "app-stamp-rate",
      `This app has reached its rate limit of ${APP_STAMP_RATE_LIMIT} stamps per ${APP_STAMP_RATE_WINDOW_MS / MS_PER_SECOND} seconds. Try again shortly.`,
    )
  }
  return undefined
}

/**
 * Why the next stamp for this app is refused, or undefined when it is allowed.
 *
 * @param target.bucket - The bucket the chunk's address lands in
 * @param target.laneCapacity - Data chunks the stamper's lane holds per bucket
 */
export function appStampRefusal(
  usage: AppStampUsage,
  target: { bucket: number; laneCapacity: number; now: number },
): SwarmIdError | undefined {
  const refusal = appRestampRefusal(usage, target.now)
  if (refusal) return refusal
  const cap = appBucketCap(target.laneCapacity)
  if ((usage.buckets[target.bucket] ?? 0) >= cap) {
    return limitRefusal(
      "app-bucket-share",
      `This app has used its bucket share limit of ${cap} stamps in this chunk's bucket.`,
    )
  }
  return undefined
}

/**
 * The usage once one more stamp at a slot already held is counted. It spends
 * no slot, and the count bounds slots spent, so only the rate counts it.
 */
export function recordAppRestamp(
  usage: AppStampUsage,
  now: number,
): AppStampUsage {
  const current = windowIsCurrent(usage, now)
  return {
    ...usage,
    windowStart: current ? usage.windowStart : now,
    windowCount: current ? usage.windowCount + 1 : 1,
  }
}

/** The usage once one more stamp in `bucket` is counted */
export function recordAppStamp(
  usage: AppStampUsage,
  bucket: number,
  now: number,
): AppStampUsage {
  return {
    ...recordAppRestamp(usage, now),
    count: usage.count + 1,
    buckets: { ...usage.buckets, [bucket]: (usage.buckets[bucket] ?? 0) + 1 },
  }
}
