// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Which slot each single-owner chunk an app had stamped went to. A chat sends
 * every message as a new version of one inbox chunk, whose address never
 * changes, and a mutable batch replaces a chunk stamped at the same slot with
 * a newer timestamp. So stamping that address again reuses its slot instead
 * of filling the bucket. The record is per app origin and per stamp, in the
 * frame's own storage, and belongs to one lane of the stamp: when this device
 * holds another lane the record starts empty, and a new slot is taken.
 */

import { z } from "zod"

/** Single-owner chunk addresses remembered per app and stamp. Past it a new address takes a new slot each time */
export const SOC_RESTAMP_SLOT_LIMIT = 256

const SLOT_OFFSET = 4

/** One lane of the stamp: this device's partition and the account's partition count */
export interface StampLane {
  partition: number
  partitionCount: number
}

const SocSlotSchema = z.object({
  slot: z.number().int().nonnegative(),
  /** The newest stamp's timestamp at this slot, in milliseconds */
  timestampMs: z.number().int().nonnegative(),
})

const SocRestampSlotsSchema = z.object({
  partition: z.number().int().nonnegative(),
  partitionCount: z.number().int().positive(),
  /** By chunk address, lowercase hex */
  slots: z.record(z.string(), SocSlotSchema),
})

/** The slots one app's single-owner chunks hold in one lane of one stamp */
export type SocRestampSlots = z.infer<typeof SocRestampSlotsSchema>

export function emptySocRestampSlots(lane: StampLane): SocRestampSlots {
  return {
    partition: lane.partition,
    partitionCount: lane.partitionCount,
    slots: {},
  }
}

/**
 * The stored record for `lane`, or an empty one when there is none, it
 * belongs to another lane, or it is malformed. Only the frame writes it, so a
 * malformed one is a bug of ours and starts over, which only costs new slots.
 */
export function parseSocRestampSlots(
  raw: string | null,
  lane: StampLane,
): SocRestampSlots {
  if (raw === null) return emptySocRestampSlots(lane)
  try {
    const parsed = SocRestampSlotsSchema.safeParse(JSON.parse(raw))
    if (
      !parsed.success ||
      parsed.data.partition !== lane.partition ||
      parsed.data.partitionCount !== lane.partitionCount
    ) {
      return emptySocRestampSlots(lane)
    }
    return parsed.data
  } catch {
    return emptySocRestampSlots(lane)
  }
}

/**
 * The record once `addressHex` holds `slot` with a stamp at `timestampMs`.
 * Unchanged when the record is full and the address is new.
 */
export function recordSocSlot(
  record: SocRestampSlots,
  addressHex: string,
  slot: number,
  timestampMs: number,
): SocRestampSlots {
  const known = addressHex in record.slots
  if (!known && Object.keys(record.slots).length >= SOC_RESTAMP_SLOT_LIMIT) {
    return record
  }
  return {
    ...record,
    slots: { ...record.slots, [addressHex]: { slot, timestampMs } },
  }
}

/**
 * The timestamp for a stamp again at a slot whose last stamp had
 * `previousMs`. Bee keeps the chunk with the newer stamp, so when the clock
 * went back it is one millisecond past the last rather than now.
 */
export function restampTimestamp(previousMs: number, now: number): number {
  return Math.max(now, previousMs + 1)
}

/** The slot in a stamp's 8-byte index, which is the bucket then the slot, big-endian */
export function slotOfStampIndex(index: Uint8Array): number {
  return new DataView(
    index.buffer,
    index.byteOffset,
    index.byteLength,
  ).getUint32(SLOT_OFFSET, false)
}
