// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * The line the sync reads wait in before they reach a gateway.
 *
 * A browser keeps at most six requests open to an HTTP/1.1 origin and queues
 * the rest itself, out of sight. The public gateway, Swarm ID's default, speaks
 * HTTP/1.1 only and takes 2.8 to 5.7 s to say a chunk is missing (measured
 * 2026-10-18), so a claim's reads behind a background fold sat in that queue,
 * and the time limits around them counted the wait: reads that would have
 * answered "not found" read as timed out, and the frame went read-only. Here
 * the reads wait in a line of our own instead, with at most
 * {@link GATEWAY_READS_IN_FLIGHT} sent at once. A read's time limit then starts
 * when its request goes out, and the reads that decide whether this frame may
 * stamp now go out first.
 *
 * One line per origin, shared by every client of that origin in this document,
 * because the browser's limit is per origin. The partition lease's reads, the
 * device roster's and the device-state folds' join it. Writes, the site's own
 * content requests and two single lock reads off the claim path (the
 * coordinator's freshness check and a release's pre-read) do not, and the one
 * connection the line leaves free is theirs.
 */

import type { BeeRequestOptions } from "@ethersphere/bee-js"
import type { ChunkDownloader } from "../proxy/download-data"
import { TimeoutError, withTimeout } from "../utils/promise"

/**
 * Reads sent at once to one origin: one under the six a browser keeps open to
 * an HTTP/1.1 origin, so a write never waits behind a full line of reads.
 */
export const GATEWAY_READS_IN_FLIGHT = 5

/**
 * Who goes first. `claim` is a read that decides whether this frame may stamp
 * now: a partition's lock, its state pointer and counters, and the intent and
 * occupancy beacons, at a claim and at each lease refresh. `background` is
 * sync that can wait: the device roster and the device-state folds. Listed in
 * the order the line serves them.
 */
export const READ_PRIORITIES = ["claim", "background"] as const
export type ReadPriority = (typeof READ_PRIORITIES)[number]

/**
 * Places a `background` read may never take, so a `claim` read that arrives
 * while the background fold is reading goes out at once rather than after a
 * background read's miss, which on the public gateway takes seconds.
 */
export const PLACES_KEPT_FOR_CLAIM = 1

/**
 * At most `capacity` reads running at once, the rest waiting, a `claim` read
 * ahead of every waiting `background` one, first come first served within a
 * priority. Background reads use at most `capacity - PLACES_KEPT_FOR_CLAIM`
 * places.
 */
export class ReadLine {
  private readonly running: Record<ReadPriority, number> = {
    claim: 0,
    background: 0,
  }
  private readonly waiting: Record<ReadPriority, (() => void)[]> = {
    claim: [],
    background: [],
  }
  private readonly limits: Record<ReadPriority, number>

  constructor(private readonly capacity: number = GATEWAY_READS_IN_FLIGHT) {
    this.limits = {
      claim: capacity,
      background: Math.max(1, capacity - PLACES_KEPT_FOR_CLAIM),
    }
  }

  /** Run `read` once it has a place, and keep the place until it settles. */
  async run<T>(priority: ReadPriority, read: () => Promise<T>): Promise<T> {
    if (this.waiting[priority].length === 0 && this.hasPlaceFor(priority)) {
      this.running[priority]++
    } else {
      await new Promise<void>((resolve) => this.waiting[priority].push(resolve))
    }
    try {
      return await read()
    } finally {
      this.running[priority]--
      this.handOn()
    }
  }

  private hasPlaceFor(priority: ReadPriority): boolean {
    const total = this.running.claim + this.running.background
    return (
      total < this.capacity && this.running[priority] < this.limits[priority]
    )
  }

  /** Free places go to the waiting reads, claim reads first. */
  private handOn(): void {
    for (const priority of READ_PRIORITIES) {
      while (this.waiting[priority].length > 0 && this.hasPlaceFor(priority)) {
        this.running[priority]++
        this.waiting[priority].shift()!()
      }
    }
  }
}

const linesByOrigin = new Map<string, ReadLine>()

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

/**
 * The line for `url`'s origin, made on first use. A url that does not parse
 * gets a line of its own text, so joining the line never fails a read that
 * would otherwise have gone out and failed or not on its own.
 */
export function readLineFor(url: string): ReadLine {
  const origin = originOf(url)
  let line = linesByOrigin.get(origin)
  if (!line) {
    line = new ReadLine()
    linesByOrigin.set(origin, line)
  }
  return line
}

/**
 * {@link withTimeout} for one gateway read, with the limit counted from when
 * the read leaves the line rather than from when it was asked for. `read` is
 * handed the request options to pass to its requests: their signal aborts
 * it when the limit passes, so a gateway that never answers frees its place
 * and its browser connection, rather than holding both while nobody waits for
 * the answer. The rejection is the same {@link TimeoutError} either way.
 */
export function withReadTimeout<T>(
  bee: { url: string },
  priority: ReadPriority,
  read: (requestOptions: BeeRequestOptions) => Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return readLineFor(bee.url).run(priority, () => {
    const controller = new AbortController()
    return withTimeout(read({ signal: controller.signal }), ms, message).catch(
      (error: unknown) => {
        if (error instanceof TimeoutError) controller.abort()
        throw error
      },
    )
  })
}

/**
 * `bee` with every chunk download waiting in its origin's line at `priority`,
 * for the reads that have no time limit of their own and may make several
 * requests at once, such as a feed lookup. A read already holding a place
 * through {@link withReadTimeout} must use the plain client, or it waits for a
 * second place while holding the first.
 */
export function throughReadLine(
  bee: ChunkDownloader,
  priority: ReadPriority,
): ChunkDownloader {
  const line = readLineFor(bee.url)
  return {
    url: bee.url,
    chunk: {
      download: (...args: Parameters<ChunkDownloader["chunk"]["download"]>) =>
        line.run(priority, () => bee.chunk.download(...args)),
    },
  }
}
