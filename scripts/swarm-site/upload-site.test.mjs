import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile as readText, rm, writeFile as writeText } from "node:fs/promises"
import { createRequire } from "node:module"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildSite, emptySlotRecord, planSlots, SlotOverflowError } from "./upload-site.mjs"

/** An obviously fake batch: the slot logic only fingerprints it */
const BATCH = "fa".repeat(32)
/** Four slots per bucket */
const DEPTH = 18

/** A 32-byte address in `bucket` (its first two bytes), told apart by `tag` */
function address(bucket, tag) {
  return bucket.toString(16).padStart(4, "0") + tag.toString(16).padStart(60, "0")
}

test("a new chunk takes the next slot in its bucket", () => {
  const plan = planSlots(emptySlotRecord(BATCH, DEPTH), [address(7, 1), address(7, 2), address(9, 1)])
  assert.equal(plan.slots.get(address(7, 1)), 0)
  assert.equal(plan.slots.get(address(7, 2)), 1)
  assert.equal(plan.slots.get(address(9, 1)), 0)
  assert.equal(plan.record.buckets["7"], 2)
  assert.equal(plan.record.buckets["9"], 1)
})

test("a chunk stamped by an earlier version reuses its slot", () => {
  const first = planSlots(emptySlotRecord(BATCH, DEPTH), [address(7, 1), address(7, 2)])
  const second = planSlots(first.record, [address(7, 2), address(7, 3)])
  assert.equal(second.slots.get(address(7, 2)), 1)
  assert.equal(second.slots.get(address(7, 3)), 2)
  assert.equal(second.record.buckets["7"], 3)
})

test("five chunks of one version in one bucket are refused, naming the bucket", () => {
  const five = [1, 2, 3, 4, 5].map((tag) => address(0x1234, tag))
  assert.throws(
    () => planSlots(emptySlotRecord(BATCH, DEPTH), five),
    (error) => error instanceof SlotOverflowError && error.bucket === 0x1234 && /4660/.test(error.message),
  )
})

test("four chunks of one version fill a bucket exactly", () => {
  const four = [1, 2, 3, 4].map((tag) => address(3, tag))
  const plan = planSlots(emptySlotRecord(BATCH, DEPTH), four)
  assert.deepEqual(four.map((a) => plan.slots.get(a)), [0, 1, 2, 3])
  assert.equal(plan.fullest.used, 4)
})

test("a new chunk may overwrite a slot an older version's chunk holds", () => {
  const old = [1, 2, 3, 4].map((tag) => address(5, tag))
  const first = planSlots(emptySlotRecord(BATCH, DEPTH), old)
  const second = planSlots(first.record, [address(5, 9)])
  assert.equal(second.slots.get(address(5, 9)), 0)
  assert.equal(second.record.slots[address(5, 1)], undefined)
  assert.equal(second.record.slots[address(5, 9)], 0)
})

test("a new chunk never takes a slot a chunk of this version holds", () => {
  const old = [1, 2, 3, 4].map((tag) => address(5, tag))
  const first = planSlots(emptySlotRecord(BATCH, DEPTH), old)
  // Slot 0 is next by the counter, but this version keeps the chunk there
  const second = planSlots(first.record, [address(5, 1), address(5, 9)])
  assert.equal(second.slots.get(address(5, 1)), 0)
  assert.equal(second.slots.get(address(5, 9)), 1)
  assert.equal(second.record.slots[address(5, 2)], undefined)
})

test("one address listed twice takes one slot", () => {
  const plan = planSlots(emptySlotRecord(BATCH, DEPTH), [address(8, 1), address(8, 1)])
  assert.equal(plan.slots.size, 1)
  assert.equal(plan.record.buckets["8"], 1)
})

test("planning leaves the record it was given unchanged", () => {
  const record = emptySlotRecord(BATCH, DEPTH)
  planSlots(record, [address(8, 1)])
  assert.deepEqual(record, emptySlotRecord(BATCH, DEPTH))
})

test("a record kept for another stamp is refused", () => {
  const record = emptySlotRecord("fb".repeat(32), DEPTH)
  assert.throws(() => planSlots(record, [address(8, 1)], BATCH), /another stamp/)
})

// ============================================================================
// The real build against bee-js's own directory upload, as an oracle
// ============================================================================

const FORK = fileURLToPath(new URL("../..", import.meta.url))
const BUILD = join(FORK, "ui/build")

/**
 * What bee-js's `streamDirectory` would send for `dir`, run against a stand-in
 * Bee that only records chunk addresses and answers each data upload with the
 * reference core-sdk's splitter computes for it.
 */
async function beeJsDirectoryUpload(dir) {
  const require = createRequire(join(FORK, "lib/package.json"))
  const beeJsRoot = require.resolve("@ethersphere/bee-js").replace(/index\.js$/, "")
  const { streamDirectory } = require(join(beeJsRoot, "utils", "chunk-stream.js"))
  const core = require("@ethersphere/core-sdk")
  const addresses = new Set()
  const bee = {
    chunk: {
      upload: async (_stamp, data) => {
        addresses.add(core.calculateChunkAddress(data).toHex())
      },
    },
    data: {
      upload: async (_stamp, data) => {
        const record = async (batch) => {
          for (const { chunk } of batch) addresses.add(chunk.hash().toHex())
          return []
        }
        const splitter = new core.ChunkSplitter(record)
        await splitter.append(data)
        const root = await splitter.finalize()
        addresses.add(root.hash().toHex())
        return { reference: root.hash() }
      },
    },
  }
  const result = await streamDirectory(bee, dir, "fa".repeat(32), undefined, {
    indexDocument: "index.html",
    errorDocument: "index.html",
  })
  return { reference: Buffer.from(result.reference.toUint8Array()).toString("hex"), addresses }
}

test("the real build's root and chunks match bee-js's directory upload", { skip: !existsSync(BUILD) }, async () => {
  const ours = await buildSite(BUILD)
  const theirs = await beeJsDirectoryUpload(BUILD)
  assert.equal(ours.reference, theirs.reference)
  assert.deepEqual([...ours.chunks.keys()].sort(), [...theirs.addresses].sort())
})

test("the real build's root reference is the same on a second build", { skip: !existsSync(BUILD) }, async () => {
  const first = await buildSite(BUILD)
  const second = await buildSite(BUILD)
  assert.equal(first.reference, second.reference)
  assert.equal(first.chunks.size, second.chunks.size)
})

// ============================================================================
// The send path, against a stand-in Bee on loopback
// ============================================================================

const HERE = fileURLToPath(new URL(".", import.meta.url))
/** An obviously fake signer, never a wallet anyone funds */
const FAKE_KEY = "11".repeat(32)

/**
 * A Bee stand-in that checks every stamp the way Bee would read it: 113 bytes,
 * this batch, the chunk's bucket, a slot under the bucket's size, and a
 * signature that recovers to the expected signer. `refuseAfter` answers 400
 * from that many chunks on.
 */
function standInBee({ batch, signer, refuseAfter = Infinity }) {
  const require = createRequire(join(FORK, "lib/package.json"))
  const core = require("@ethersphere/core-sdk")
  const accepted = new Map()
  const problems = []
  const server = createServer(async (request, response) => {
    if (request.method === "GET") {
      response.writeHead(accepted.size > 0 ? 200 : 404).end()
      return
    }
    const parts = []
    for await (const part of request) parts.push(part)
    const data = new Uint8Array(Buffer.concat(parts))
    const address = core.calculateChunkAddress(data).toHex()
    const stamp = Buffer.from(request.headers["swarm-postage-stamp"] ?? "", "hex")
    if (stamp.length !== 113) problems.push(`stamp length ${stamp.length}`)
    if (stamp.subarray(0, 32).toString("hex") !== batch) problems.push("wrong batch")
    const index = stamp.subarray(32, 40)
    const bucket = index.readUInt32BE(0)
    const slot = index.readUInt32BE(4)
    if (bucket !== Number.parseInt(address.slice(0, 4), 16)) problems.push(`bucket ${bucket} for ${address}`)
    if (slot >= 4) problems.push(`slot ${slot}`)
    const signature = new core.Signature(stamp.subarray(48, 113))
    const message = Buffer.concat([Buffer.from(address, "hex"), stamp.subarray(0, 48)])
    if (signature.recoverPublicKey(message).address().toHex() !== signer) problems.push("signature")
    if (accepted.size >= refuseAfter) {
      response.writeHead(400, { "content-type": "application/json" }).end('{"message":"invalid stamp"}')
      return
    }
    accepted.set(address, slot)
    response.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({ reference: address }))
  })
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ url: `http://127.0.0.1:${server.address().port}`, accepted, problems, close: () => server.close() }),
    ),
  )
}

function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(HERE, "upload-site.mjs"), ...args], {
      env: { ...process.env, ...env },
    })
    let out = ""
    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (out += d))
    child.on("close", (code) => resolve({ code, out }))
  })
}

async function tinySite() {
  await mkdir(join(HERE, "tmp-test"), { recursive: true })
  const dir = await mkdtemp(join(HERE, "tmp-test", "site-"))
  await mkdir(join(dir, "assets"))
  await writeText(join(dir, "index.html"), "<!doctype html><title>t</title>")
  await writeText(join(dir, "assets", "big.bin"), Buffer.alloc(20000, 7))
  return dir
}

test("a real run stamps every chunk validly, writes the record, and reuses slots next time", async () => {
  const require = createRequire(join(FORK, "lib/package.json"))
  const core = require("@ethersphere/core-sdk")
  const signer = new core.PrivateKey(FAKE_KEY).publicKey().address().toHex()
  const batch = "fa".repeat(32)
  const dir = await tinySite()
  const recordFile = join(dir, "..", `${dir.split("/").pop()}-slots.json`)
  const bee = await standInBee({ batch, signer })
  try {
    const env = { STAMP_KEY: FAKE_KEY }
    const first = await run(["--build", dir, "--bee", bee.url, "--batch", batch, "--depth", String(DEPTH), "--slots", recordFile], env)
    assert.equal(first.code, 0, first.out)
    assert.deepEqual(bee.problems, [])
    assert.ok(!first.out.includes(FAKE_KEY), "the key never reaches the output")
    const reference = first.out.trim().split("\n").pop()
    assert.match(reference, /^[0-9a-f]{64}$/)
    assert.ok(bee.accepted.has(reference))
    const record = JSON.parse(await readText(recordFile, "utf8"))
    assert.equal(Object.keys(record.slots).length, bee.accepted.size)
    assert.ok(!JSON.stringify(record).includes(batch), "the record holds no stamp id")
    assert.match(first.out, /check \/bzz\/<root>\/proxy: 200/)

    const slotsBefore = new Map(bee.accepted)
    bee.accepted.clear()
    const second = await run(["--build", dir, "--bee", bee.url, "--batch", batch, "--depth", String(DEPTH), "--slots", recordFile], env)
    assert.equal(second.code, 0, second.out)
    assert.deepEqual(bee.accepted, slotsBefore)
  } finally {
    bee.close()
    await rm(join(HERE, "tmp-test"), { recursive: true, force: true })
  }
})

test("a refused chunk stops the run and writes no record", async () => {
  const require = createRequire(join(FORK, "lib/package.json"))
  const core = require("@ethersphere/core-sdk")
  const signer = new core.PrivateKey(FAKE_KEY).publicKey().address().toHex()
  const batch = "fa".repeat(32)
  const dir = await tinySite()
  const recordFile = join(dir, "..", "refused-slots.json")
  const bee = await standInBee({ batch, signer, refuseAfter: 2 })
  try {
    const result = await run(["--build", dir, "--bee", bee.url, "--batch", batch, "--depth", String(DEPTH), "--slots", recordFile], {
      STAMP_KEY: FAKE_KEY,
    })
    assert.equal(result.code, 1)
    assert.match(result.out, /Bee refused chunk [0-9a-f]{64}: 400/)
    assert.ok(!existsSync(recordFile))
  } finally {
    bee.close()
    await rm(join(HERE, "tmp-test"), { recursive: true, force: true })
  }
})

test("a real run without STAMP_KEY sends nothing", async () => {
  const dir = await tinySite()
  const bee = await standInBee({ batch: "fa".repeat(32), signer: "" })
  try {
    const result = await run(["--build", dir, "--bee", bee.url, "--batch", "fa".repeat(32), "--depth", String(DEPTH), "--slots", join(dir, "none.json")], {
      STAMP_KEY: "",
    })
    assert.equal(result.code, 1)
    assert.match(result.out, /STAMP_KEY is not set/)
    assert.equal(bee.accepted.size, 0)
  } finally {
    bee.close()
    await rm(join(HERE, "tmp-test"), { recursive: true, force: true })
  }
})
