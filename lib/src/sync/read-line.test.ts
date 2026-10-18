// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest"
import {
  GATEWAY_READS_IN_FLIGHT,
  PLACES_KEPT_FOR_CLAIM,
  ReadLine,
  readLineFor,
  throughReadLine,
  withReadTimeout,
  type ReadPriority,
} from "./read-line"
import { TimeoutError } from "../utils/promise"

/**
 * A read the test answers by hand, recording when it started. An answer given
 * before the read starts is kept until it does.
 */
function heldRead(started: string[], name: string) {
  let answer: (value: string) => void = () => undefined
  const answered = new Promise<string>((resolve) => {
    answer = resolve
  })
  const read = () => {
    started.push(name)
    return answered
  }
  return { read, answer: () => answer(name) }
}

/** Let every promise continuation that is ready run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
})

describe("ReadLine", () => {
  it("runs at most its capacity at once and starts the next as one settles", async () => {
    const line = new ReadLine()
    const started: string[] = []
    const reads = Array.from({ length: GATEWAY_READS_IN_FLIGHT + 3 }, (_, i) =>
      heldRead(started, `read-${i}`),
    )
    const done = reads.map((r) => line.run("claim", r.read))
    await settle()
    expect(started).toHaveLength(GATEWAY_READS_IN_FLIGHT)

    reads[0].answer()
    await settle()
    expect(started).toHaveLength(GATEWAY_READS_IN_FLIGHT + 1)

    for (const r of reads) r.answer()
    await expect(Promise.all(done)).resolves.toEqual(
      reads.map((_, i) => `read-${i}`),
    )
  })

  it("sends a waiting claim read before every waiting background read, each in arrival order", async () => {
    const line = new ReadLine(1)
    const started: string[] = []
    const first = heldRead(started, "first")
    const queued: { name: string; priority: ReadPriority }[] = [
      { name: "background-a", priority: "background" },
      { name: "claim-a", priority: "claim" },
      { name: "background-b", priority: "background" },
      { name: "claim-b", priority: "claim" },
    ]
    const running = [line.run("background", first.read)]
    const later = queued.map(({ name, priority }) => {
      const held = heldRead(started, name)
      running.push(line.run(priority, held.read))
      return held
    })
    await settle()
    first.answer()
    for (const held of later) held.answer()
    await Promise.all(running)
    expect(started).toEqual([
      "first",
      "claim-a",
      "claim-b",
      "background-a",
      "background-b",
    ])
  })

  it("keeps a place free of background reads for a claim read", async () => {
    const line = new ReadLine()
    const started: string[] = []
    const background = Array.from({ length: GATEWAY_READS_IN_FLIGHT }, (_, i) =>
      heldRead(started, `background-${i}`),
    )
    const running = background.map((r) => line.run("background", r.read))
    await settle()
    expect(started).toHaveLength(
      GATEWAY_READS_IN_FLIGHT - PLACES_KEPT_FOR_CLAIM,
    )

    const claim = heldRead(started, "claim")
    running.push(line.run("claim", claim.read))
    await settle()
    expect(started).toContain("claim")

    claim.answer()
    for (const r of background) r.answer()
    await Promise.all(running)
  })

  it("frees the place of a read that rejects", async () => {
    const line = new ReadLine(1)
    await expect(
      line.run("claim", () => Promise.reject(new Error("gone"))),
    ).rejects.toThrow("gone")
    await expect(line.run("claim", async () => "next")).resolves.toBe("next")
  })

  it("is one line per origin", () => {
    expect(readLineFor("https://gateway.example")).toBe(
      readLineFor("https://gateway.example/"),
    )
    expect(readLineFor("https://gateway.example")).not.toBe(
      readLineFor("https://other.example"),
    )
  })
})

describe("withReadTimeout", () => {
  const LIMIT_MS = 2_500
  const SLOW_READ_MS = 7_000
  const ANSWER_MS = 1_000

  function delayed<T>(ms: number, value: T): Promise<T> {
    return new Promise((resolve) => setTimeout(() => resolve(value), ms))
  }

  it("counts the limit from when the read leaves the line", async () => {
    vi.useFakeTimers()
    const bee = { url: "https://counts-from-send.example" }
    // Fill the line with reads that take far longer than the limit.
    const ahead = Array.from({ length: GATEWAY_READS_IN_FLIGHT }, () =>
      withReadTimeout(
        bee,
        "claim",
        () => delayed(SLOW_READ_MS, "slow"),
        SLOW_READ_MS * 2,
        "ahead timed out",
      ),
    )
    // Waits 7 s in line, then answers 1 s after it is sent: inside its 2.5 s.
    const waited = withReadTimeout(
      bee,
      "claim",
      () => delayed(ANSWER_MS, "answered"),
      LIMIT_MS,
      "read timed out",
    )
    await vi.advanceTimersByTimeAsync(SLOW_READ_MS + ANSWER_MS)
    await expect(waited).resolves.toBe("answered")
    await expect(Promise.all(ahead)).resolves.toHaveLength(
      GATEWAY_READS_IN_FLIGHT,
    )
  })

  it("still times out a read that is slow once sent, and aborts its request", async () => {
    vi.useFakeTimers()
    const bee = { url: "https://times-out.example" }
    let signal: AbortSignal | undefined
    const read = withReadTimeout(
      bee,
      "claim",
      (requestOptions) => {
        signal = requestOptions.signal
        return new Promise<string>(() => undefined)
      },
      LIMIT_MS,
      "read timed out",
    )
    const outcome = read.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(LIMIT_MS)
    expect(await outcome).toBeInstanceOf(TimeoutError)
    expect(signal?.aborted).toBe(true)
    // The place it held is free again although its request never answered.
    await expect(
      readLineFor(bee.url).run("claim", async () => "next"),
    ).resolves.toBe("next")
  })
})

describe("throughReadLine", () => {
  it("sends each chunk download through the origin's line", async () => {
    const started: string[] = []
    const answers: (() => void)[] = []
    const bee = {
      url: "https://chunks.example",
      chunk: {
        download: (reference: string | Uint8Array) => {
          started.push(String(reference))
          return new Promise<Uint8Array>((resolve) =>
            answers.push(() => resolve(new Uint8Array())),
          )
        },
      },
    }
    const lined = throughReadLine(bee, "claim")
    const downloads = Array.from(
      { length: GATEWAY_READS_IN_FLIGHT + 1 },
      (_, i) => lined.chunk.download(`ref-${i}`),
    )
    await settle()
    expect(started).toHaveLength(GATEWAY_READS_IN_FLIGHT)
    answers[0]()
    await settle()
    expect(started).toHaveLength(GATEWAY_READS_IN_FLIGHT + 1)
    for (const answer of answers) answer()
    await Promise.all(downloads)
  })
})
