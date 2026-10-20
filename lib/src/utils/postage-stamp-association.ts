// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  NO_POSTAGE_STAMP,
  type ConnectedApp,
  type PostageStamp,
} from "../schemas"

/**
 * Resolve which postage stamp an app uploads with: the one the person picked
 * for it (`postageStampBatchID`), and nothing else.
 *
 * The account default is never a fallback. A site with no pick, a site set
 * to `NO_POSTAGE_STAMP`, and a site whose picked drive is gone all resolve to
 * no stamp, and the person picks one in Swarm ID. Falling back let a drive
 * bought after the site signed in, or the default left after the picked drive
 * was removed, pay for the site's uploads without the person choosing it.
 *
 * A deleted stamp (tombstone) resolves to nothing. An EXPIRED one still
 * resolves: it can be renewed, and the session reports it as expired (#745).
 *
 * Paired with `stampsReachableByApp` below, which decides what a partitioned
 * session may HOLD while this decides what it SPENDS, over the same pointer,
 * and deliberately differing on tombstones: this one skips them (a deleted
 * stamp cannot be spent), that one keeps them (a session learns its stamp is
 * deleted no other way). Change the pointer rule in one and the other has to
 * follow, or a session holds a stamp it cannot resolve, or resolves one it
 * was never handed.
 */
export function resolveStampForApp(
  app: Pick<ConnectedApp, "postageStampBatchID">,
  stamps: PostageStamp[],
): PostageStamp | undefined {
  const picked = app.postageStampBatchID
  if (!picked || picked === NO_POSTAGE_STAMP) return undefined
  return stamps.find((s) => !s.deletedAt && s.batchID.equals(picked))
}

/**
 * The stamps a connected app's session can ever reach: the one the person
 * picked for it, and none while that pick waits for the person to confirm it.
 *
 * This is what a PARTITIONED session is handed and allowed to keep (#578). It
 * holds its account view in memory, in a context embedded by an arbitrary dApp
 * page, and it can only ever spend the stamp `resolveStampForApp` picks, so
 * the rest of the collection is signer keys it has no use for. Least privilege
 * rather than a broken boundary: an unpartitioned proxy reads the same material
 * out of shared storage, but it does not have to be handed it.
 *
 * A tombstone the pointer still names is kept: a tombstone is how the session
 * learns the stamp it was spending is deleted.
 */
export function stampsReachableByApp(
  app: Pick<ConnectedApp, "postageStampBatchID" | "stampPending">,
  stamps: PostageStamp[],
): PostageStamp[] {
  const picked = app.postageStampBatchID
  if (app.stampPending || !picked || picked === NO_POSTAGE_STAMP) {
    return []
  }
  return stamps.filter((stamp) => stamp.batchID.equals(picked))
}
