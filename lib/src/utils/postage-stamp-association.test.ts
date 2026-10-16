// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest"
import { BatchId } from "@ethersphere/bee-js"
import {
  resolveStampForApp,
  stampsReachableByApp,
} from "./postage-stamp-association"
import { NO_POSTAGE_STAMP } from "../schemas"
import {
  TEST_BATCH_ID_HEX,
  TEST_BATCH_ID_2_HEX,
  createPostageStamp,
} from "../test-fixtures"

const accountBatch = new BatchId(TEST_BATCH_ID_HEX)
const appBatch = new BatchId(TEST_BATCH_ID_2_HEX)
const accountStamp = createPostageStamp({ batchID: accountBatch })
const appStamp = createPostageStamp({ batchID: appBatch })

describe("resolveStampForApp", () => {
  // Levi's ruling D4, 2026-10-16: a site spends only the drive the person
  // picked for it. A drive bought after the site signed in becomes the
  // account default, and the site must not start stamping with it unasked.
  it("resolves nothing for a site with no pick, though the account has a default", () => {
    const result = resolveStampForApp({ postageStampBatchID: undefined }, [
      accountStamp,
    ])
    expect(result).toBeUndefined()
  })

  // The other half of D4: removing the picked drive leaves the site with no
  // drive until the person picks again, never on the default.
  it("resolves nothing when the site's picked drive is gone, though the account has a default", () => {
    const result = resolveStampForApp({ postageStampBatchID: appBatch }, [
      accountStamp,
    ])
    expect(result).toBeUndefined()
  })

  it("resolves the site's own pick", () => {
    const result = resolveStampForApp({ postageStampBatchID: appBatch }, [
      accountStamp,
      appStamp,
    ])
    expect(result?.batchID.toHex()).toBe(TEST_BATCH_ID_2_HEX)
  })

  it("resolves nothing when the site's picked drive is deleted", () => {
    const deleted = createPostageStamp({ batchID: appBatch, deletedAt: 1 })
    const result = resolveStampForApp({ postageStampBatchID: appBatch }, [
      accountStamp,
      deleted,
    ])
    expect(result).toBeUndefined()
  })

  // An expired drive can be renewed, and the session reports it as expired
  // rather than as having no drive (#745).
  it("still resolves an expired pick", () => {
    const expired = createPostageStamp({
      batchID: appBatch,
      batchTTL: 60,
      updatedAt: Date.now() - 120_000,
    })
    const result = resolveStampForApp({ postageStampBatchID: appBatch }, [
      accountStamp,
      expired,
    ])
    expect(result?.batchID.toHex()).toBe(TEST_BATCH_ID_2_HEX)
  })

  it("resolves nothing for a site set to no stamp", () => {
    const result = resolveStampForApp(
      { postageStampBatchID: NO_POSTAGE_STAMP },
      [accountStamp, appStamp],
    )
    expect(result).toBeUndefined()
  })
})

// A partitioned session is handed its account view by the connect popup, and
// before #578 that view carried EVERY stamp with its signer key, in a context
// embedded by an arbitrary dApp page. It can only ever spend the one resolved
// for it, so that is all it should hold (#578).
describe("stampsReachableByApp", () => {
  it("keeps the site's own pick and not the account default", () => {
    const otherStamp = createPostageStamp({
      batchID: new BatchId("dd".repeat(32)),
    })
    const result = stampsReachableByApp({ postageStampBatchID: appBatch }, [
      accountStamp,
      appStamp,
      otherStamp,
    ])
    expect(result.map((s) => s.batchID.toHex())).toEqual([TEST_BATCH_ID_2_HEX])
  })

  it("keeps nothing for a site with no pick", () => {
    const result = stampsReachableByApp({ postageStampBatchID: undefined }, [
      accountStamp,
      appStamp,
    ])
    expect(result).toEqual([])
  })

  it("keeps nothing for a site set to no stamp", () => {
    const result = stampsReachableByApp(
      { postageStampBatchID: NO_POSTAGE_STAMP },
      [accountStamp, appStamp],
    )
    expect(result).toEqual([])
  })

  it("keeps nothing while the person has not confirmed the site's drive", () => {
    const result = stampsReachableByApp(
      { postageStampBatchID: appBatch, stampPending: true },
      [accountStamp, appStamp],
    )
    expect(result).toEqual([])
  })

  // A tombstone for our own stamp is news: it is how the session learns the
  // stamp it was spending is gone.
  it("keeps a tombstoned stamp its pick still names", () => {
    const deleted = createPostageStamp({
      batchID: appBatch,
      deletedAt: 2_000_000,
    })
    const result = stampsReachableByApp({ postageStampBatchID: appBatch }, [
      deleted,
    ])
    expect(result).toHaveLength(1)
    expect(result[0].deletedAt).toBe(2_000_000)
  })
})
