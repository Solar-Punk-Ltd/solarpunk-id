// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * The record of which slot each single-owner chunk an app had stamped went
 * to, so stamping the same address again reuses the slot.
 */

import { describe, it, expect } from "vitest"
import {
  SOC_RESTAMP_SLOT_LIMIT,
  emptySocRestampSlots,
  parseSocRestampSlots,
  recordSocSlot,
  restampTimestamp,
  slotOfStampIndex,
} from "./soc-restamp-slots"

const LANE = { partition: 1, partitionCount: 2 }
const ADDRESS = "aa".repeat(32)
const NOW = 1_700_000_000_000

describe("SOC restamp slots", () => {
  it("reads back what it stored for the same lane", () => {
    const slots = recordSocSlot(emptySocRestampSlots(LANE), ADDRESS, 9, NOW)

    expect(parseSocRestampSlots(JSON.stringify(slots), LANE)).toEqual(slots)
    expect(slots.slots[ADDRESS]).toEqual({ slot: 9, timestampMs: NOW })
  })

  it("is empty for another lane, nothing stored, or a malformed record", () => {
    const stored = JSON.stringify(
      recordSocSlot(emptySocRestampSlots(LANE), ADDRESS, 9, NOW),
    )

    expect(
      parseSocRestampSlots(stored, { partition: 0, partitionCount: 2 }),
    ).toEqual(emptySocRestampSlots({ partition: 0, partitionCount: 2 }))
    expect(
      parseSocRestampSlots(stored, { partition: 1, partitionCount: 4 }).slots,
    ).toEqual({})
    expect(parseSocRestampSlots(null, LANE)).toEqual(emptySocRestampSlots(LANE))
    expect(parseSocRestampSlots("not json", LANE)).toEqual(
      emptySocRestampSlots(LANE),
    )
  })

  it("records no new address once full, and still updates one it holds", () => {
    let slots = emptySocRestampSlots(LANE)
    for (let i = 0; i < SOC_RESTAMP_SLOT_LIMIT; i++) {
      slots = recordSocSlot(slots, i.toString(16).padStart(64, "0"), i, NOW)
    }
    const held = (0).toString(16).padStart(64, "0")

    expect(recordSocSlot(slots, ADDRESS, 1, NOW)).toBe(slots)
    expect(recordSocSlot(slots, held, 0, NOW + 1).slots[held]).toEqual({
      slot: 0,
      timestampMs: NOW + 1,
    })
  })

  it("takes the current time, or one past the last when the clock went back", () => {
    expect(restampTimestamp(NOW, NOW + 5)).toBe(NOW + 5)
    expect(restampTimestamp(NOW, NOW)).toBe(NOW + 1)
    expect(restampTimestamp(NOW, NOW - 1000)).toBe(NOW + 1)
  })

  it("reads the slot out of a stamp's index", () => {
    const index = new Uint8Array([0x0a, 0xbc, 0, 0, 0, 0, 0x01, 0x02])

    expect(slotOfStampIndex(index)).toBe(0x0102)
  })
})
