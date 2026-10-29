// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Cross-module timing constants for the multi-device sync path.
 *
 * This module has NO imports on purpose: it is the single source of truth for
 * values several sync modules share, so it can be imported by any of them
 * (including `utils/batch-utilization`) without a circular import. Keeping the
 * values here removes the drift risk of the same literal defined independently
 * in each module.
 */

/**
 * Client-side timeout for a single cross-device SOC/feed read whose miss is
 * not the answer: a rival's partition intent, and the lock reads inside a claim.
 * {@link MISS_READ_TIMEOUT_MS} covers the reads whose miss is. Bee has no fast authoritative
 * "not found" — a retrieval of an absent chunk fails only after exhausting
 * peers — so an absent target would otherwise block for tens of seconds. A
 * present chunk in its neighborhood retrieves well under this. Each caller says
 * what a timed-out read means for it.
 */
export const SYNC_READ_TIMEOUT_MS = 2500

/**
 * Client-side timeout for a read whose miss is itself the answer: a
 * device-roster slot, a partition's lock SOC in the lease refresh, and a
 * partition's state pointer. Each is read through the account's gateway, by
 * default the public one, which answers an absent chunk with Bee's own 404 only
 * after 3.4 to 4.8 s (measured 2026-10-18) and does not route `GET /soc`. Under
 * {@link SYNC_READ_TIMEOUT_MS} such a miss timed out and read as inconclusive:
 * no device wrote its first roster entry, and a site's frame on a fresh drive
 * went read-only and never stamped. Kept under `LEASE_REFRESH_MS` (10 s), since
 * the lease refresh reads every lock with it.
 */
export const MISS_READ_TIMEOUT_MS = 8_000

/**
 * Partition-lease lifetime. A device holds its partition for this long before
 * the lease must be refreshed; if it crashes without refreshing, peers can
 * reclaim the partition.
 */
export const LEASE_TTL_MS = 30 * 1000 // 30 seconds

/**
 * Epoch length for the rotating intent/occupancy/state-pointer addresses.
 * TTL-sized (`= LEASE_TTL_MS`) so a contention round and its immediate retries
 * share a bucket (and the previous bucket covers the boundary), while every
 * fresh round rotates to an address no node has cached. The two genuinely track
 * each other — sharing this source keeps them from drifting.
 */
export const INTENT_EPOCH_MS = LEASE_TTL_MS
