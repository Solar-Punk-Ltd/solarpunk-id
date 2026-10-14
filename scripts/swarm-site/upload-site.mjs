#!/usr/bin/env node
/**
 * Uploads a static site build to Swarm as a website, every chunk stamped here
 * with a postage stamp and sent pre-stamped to a Bee node's `POST /chunks`, so
 * the Bee node does not have to own the stamp.
 *
 *   node upload-site.mjs --build <dir> --bee <url> --batch <stamp id> \
 *     --depth <stamp depth> --slots <slot record file> [--dry-run]
 *
 * A real run reads the private key of the stamp's owner from STAMP_KEY. A dry
 * run needs no key: it computes every address and the root reference, plans
 * the slots, and sends and writes nothing.
 *
 * The slot record says which slot of the stamp each chunk holds, so the next
 * version reuses those slots instead of filling the stamp. Keep one record per
 * stamp and pass the same file on every upload with that stamp. A file that
 * does not exist yet starts a new record.
 *
 * The chunking, the manifest and the stamp signature are core-sdk's, the
 * packages the solarpunk-id lib builds on, loaded from the fork's own
 * node_modules. The lib's bundled dist keeps its upload and manifest helpers
 * private, so they are not importable from here.
 */

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join, relative, sep } from 'node:path'
import { readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/** Swarm's bucket depth, the same for every stamp */
export const BUCKET_DEPTH = 16

export function slotsPerBucket(depth) {
  return 2 ** (depth - BUCKET_DEPTH)
}

const INDEX_DOCUMENT = 'index.html'
const ERROR_DOCUMENT = 'index.html'
const SEND_CONCURRENCY = 8
const SEND_ATTEMPTS = 4
const RETRY_BASE_MS = 1000
const REQUEST_TIMEOUT_MS = 60_000
const SPAN_SIZE = 8
const CHECK_PATHS = ['', 'proxy', 'connect']
const FORK_LIB =
  process.env.SOLARPUNK_ID_LIB ?? fileURLToPath(new URL('../../lib', import.meta.url))

// ============================================================================
// Stamp slots
// ============================================================================

/** Thrown when one version would need more slots in a bucket than the stamp has */
export class SlotOverflowError extends Error {
  constructor(bucket, needed, available) {
    super(
      `Bucket ${bucket} would need ${needed} slots for this version, and the stamp has ${available} per bucket. Nothing was sent.`,
    )
    this.name = 'SlotOverflowError'
    this.bucket = bucket
    this.needed = needed
  }
}

/**
 * Binds a slot record to one stamp without writing the stamp id to disk.
 * The id is public on chain, the record only needs to recognise it.
 */
function stampFingerprint(batchId) {
  return createHash('sha256').update(batchId.toLowerCase()).digest('hex')
}

/**
 * A stamp's slot record. `buckets` holds each bucket's counter, which only
 * grows, so a slot is the counter modulo the slots per bucket. `slots`
 * holds the slot of every address the stamp currently carries. Bee keeps the
 * newest stamp at an index, so `lastTimestampMs` keeps every stamp newer than
 * the last one even if the clock went back.
 */
export function emptySlotRecord(batchId, depth) {
  return {
    stamp: stampFingerprint(batchId),
    depth,
    bucketDepth: BUCKET_DEPTH,
    lastTimestampMs: 0,
    buckets: {},
    slots: {},
  }
}

/** The bucket of an address: its first BUCKET_DEPTH bits, which is the first two bytes at depth 16 */
export function bucketOf(addressHex) {
  return Number.parseInt(addressHex.slice(0, 4), 16)
}

/**
 * Assigns a slot to every address of this version. An address the record
 * already holds keeps its slot. A new address takes the next slot by its
 * bucket's counter, skipping slots this version already holds, which may
 * overwrite a chunk of an older version. Pure: returns a new record.
 *
 * @throws SlotOverflowError when a bucket would need more slots than the stamp has
 */
export function planSlots(record, addresses, batchId, depth = record.depth) {
  if (batchId !== undefined && record.stamp !== stampFingerprint(batchId)) {
    throw new Error(
      "The slot record belongs to another stamp. Pass this stamp's own record with --slots.",
    )
  }
  if (record.depth !== depth || record.bucketDepth !== BUCKET_DEPTH) {
    throw new Error(
      `The slot record was kept for depth ${record.depth}/${record.bucketDepth}, not ${depth}/${BUCKET_DEPTH}`,
    )
  }
  const available = slotsPerBucket(depth)

  const byBucket = new Map()
  for (const address of [...new Set(addresses.map((a) => a.toLowerCase()))].sort()) {
    const bucket = bucketOf(address)
    if (!byBucket.has(bucket)) byBucket.set(bucket, [])
    byBucket.get(bucket).push(address)
  }

  let fullest = { bucket: null, used: 0 }
  for (const [bucket, inBucket] of byBucket) {
    if (inBucket.length > available) throw new SlotOverflowError(bucket, inBucket.length, available)
    if (inBucket.length > fullest.used) fullest = { bucket, used: inBucket.length }
  }

  const holderAt = new Map()
  for (const [address, slot] of Object.entries(record.slots)) {
    holderAt.set(`${bucketOf(address)}:${slot}`, address)
  }

  const nextSlots = { ...record.slots }
  const buckets = { ...record.buckets }
  const slots = new Map()
  for (const [bucket, inBucket] of byBucket) {
    const held = new Set()
    for (const address of inBucket) {
      if (address in record.slots) {
        slots.set(address, record.slots[address])
        held.add(record.slots[address])
      }
    }
    let counter = buckets[bucket] ?? 0
    for (const address of inBucket) {
      if (slots.has(address)) continue
      let slot = counter % available
      while (held.has(slot)) {
        counter++
        slot = counter % available
      }
      counter++
      held.add(slot)
      const overwritten = holderAt.get(`${bucket}:${slot}`)
      if (overwritten !== undefined) delete nextSlots[overwritten]
      nextSlots[address] = slot
      slots.set(address, slot)
    }
    buckets[bucket] = counter
  }

  return { slots, fullest, record: { ...record, buckets, slots: nextSlots } }
}

async function readSlotRecord(file, batchId, depth) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return emptySlotRecord(batchId, depth)
    throw error
  }
}

async function writeSlotRecord(file, record) {
  const temporary = `${file}.tmp`
  await writeFile(temporary, JSON.stringify(record, null, 2) + '\n')
  await rename(temporary, file)
}

// ============================================================================
// Chunking and the manifest
// ============================================================================

function loadForkPackages() {
  const require = createRequire(join(FORK_LIB, 'package.json'))
  const core = require('@ethersphere/core-sdk')
  const { Strings } = require('cafe-utility')
  // bee-js's own Content-Type table, the one its directory upload uses. Its
  // package exports only the root, so the file is required by path.
  const beeJsRoot = require.resolve('@ethersphere/bee-js').replace(/index\.js$/, '')
  const { mimes } = require(join(beeJsRoot, 'utils', 'mime.js'))
  return { core, Strings, mimes }
}

/** The bytes Bee stores for a sealed chunk: span and payload, without the builder's zero padding */
function chunkBytes(builder) {
  return builder.build().slice(0, SPAN_SIZE + builder.writer.cursor)
}

/** Lowercase hex of a chunk address, checked against the padded form so a trim can never move it */
function addressOf(core, builder, bytes) {
  const address = core.calculateChunkAddress(bytes).toHex()
  if (address !== builder.hash().toHex()) throw new Error('A trimmed chunk changed its address')
  return address
}

async function listFiles(dir) {
  const files = []
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) files.push(relative(dir, full).split(sep).join('/'))
      else throw new Error(`Not a file or a folder: ${relative(dir, full)}`)
    }
  }
  await walk(dir)
  return files.sort()
}

/** Matches bee-js's directory upload, which adds a charset to HTML and CSS */
function contentTypeOf(mimes, extension) {
  const mime = mimes[extension.toLowerCase()] || 'application/octet-stream'
  return ['text/html', 'text/css'].includes(mime) ? `${mime}; charset=utf-8` : mime
}

/**
 * Every chunk of the site and its manifest, by address, and the root
 * reference. The manifest has a fork per file with its Content-Type and
 * Filename, and a `/` fork carrying the index and error documents, the shape
 * the fork's own folder upload and bee-js's directory upload both build.
 */
export async function buildSite(dir) {
  const { core, Strings, mimes } = loadForkPackages()
  const chunks = new Map()
  const keep = (builder) => {
    const bytes = chunkBytes(builder)
    chunks.set(addressOf(core, builder, bytes), bytes)
  }
  const onBatch = async (batch) => {
    for (const { chunk } of batch) keep(chunk)
    return []
  }

  const files = await listFiles(dir)
  if (!files.includes(INDEX_DOCUMENT)) throw new Error(`The build has no ${INDEX_DOCUMENT}`)

  const manifest = new core.MantarayNode()
  for (const path of files) {
    const splitter = new core.ChunkSplitter(onBatch)
    await splitter.append(new Uint8Array(await readFile(join(dir, path))))
    const root = await splitter.finalize()
    keep(root)
    const { filename, extension } = Strings.parseFilename(path)
    manifest.addFork(path, root.hash(), {
      'Content-Type': contentTypeOf(mimes, extension),
      Filename: filename,
    })
  }
  manifest.addFork('/', new Uint8Array(32), {
    'website-index-document': INDEX_DOCUMENT,
    'website-error-document': ERROR_DOCUMENT,
  })
  const saved = await manifest.saveRecursively(async (chunk) => keep(chunk))

  return { files, chunks, reference: Buffer.from(saved.reference).toString('hex') }
}

// ============================================================================
// Sending
// ============================================================================

class HardSendError extends Error {}

function isRetryable(status) {
  return status === 429 || status >= 500
}

async function sendChunk(bee, address, bytes, stampHex) {
  for (let attempt = 1; ; attempt++) {
    let status
    try {
      const response = await fetch(`${bee}/chunks`, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'swarm-postage-stamp': stampHex,
        },
        body: bytes,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      status = response.status
      const text = await response.text()
      if (response.ok) {
        const reference = JSON.parse(text).reference
        if (reference !== address) {
          throw new HardSendError(`Bee stored chunk ${address} as ${reference}`)
        }
        return
      }
      if (!isRetryable(status)) {
        throw new HardSendError(`Bee refused chunk ${address}: ${status} ${text.slice(0, 300)}`)
      }
    } catch (error) {
      if (error instanceof HardSendError) throw error
      status = error.name
    }
    if (attempt >= SEND_ATTEMPTS) {
      throw new HardSendError(`Chunk ${address} failed ${SEND_ATTEMPTS} times, last: ${status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * 2 ** (attempt - 1)))
  }
}

async function sendAll(bee, chunks, slots, signer, batchId, record) {
  const { core } = loadForkPackages()
  const queue = [...chunks.keys()]
  const total = queue.length
  let sent = 0
  let failure = null
  let lastTimestampMs = record.lastTimestampMs ?? 0

  const nextTimestamp = () => {
    lastTimestampMs = Math.max(Date.now(), lastTimestampMs + 1)
    return lastTimestampMs
  }

  async function worker() {
    while (queue.length > 0 && failure === null) {
      const address = queue.shift()
      const envelope = core.stamp(
        signer,
        batchId,
        Buffer.from(address, 'hex'),
        slots.get(address),
        nextTimestamp(),
      )
      const stampHex = core.convertEnvelopeToMarshaledStamp(envelope).toHex()
      try {
        await sendChunk(bee, address, chunks.get(address), stampHex)
      } catch (error) {
        failure ??= error
        return
      }
      sent++
      if (sent % 100 === 0 || sent === total) console.log(`sent ${sent}/${total}`)
    }
  }

  await Promise.all(Array.from({ length: SEND_CONCURRENCY }, worker))
  if (failure !== null) throw failure
  return lastTimestampMs
}

async function checkSite(bee, reference) {
  for (const path of CHECK_PATHS) {
    const url = `${bee}/bzz/${reference}/${path}`
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      await response.arrayBuffer()
      console.log(`check /bzz/<root>/${path}: ${response.status}`)
    } catch (error) {
      console.log(`check /bzz/<root>/${path}: ${error.name}`)
    }
  }
}

// ============================================================================
// Command line
// ============================================================================

function parseArgs(argv) {
  const options = { dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--build') options.build = argv[++i]
    else if (arg === '--bee') options.bee = argv[++i]
    else if (arg === '--batch') options.batch = argv[++i]
    else if (arg === '--depth') options.depth = Number(argv[++i])
    else if (arg === '--slots') options.slots = argv[++i]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!options.build) throw new Error('--build <dir> is required')
  if (!options.bee || !/^https?:\/\//.test(options.bee))
    throw new Error('--bee <http(s) url> is required')
  if (!options.batch || !/^[0-9a-fA-F]{64}$/.test(options.batch))
    throw new Error('--batch <64 hex stamp id> is required')
  if (!Number.isInteger(options.depth) || options.depth <= BUCKET_DEPTH) {
    throw new Error(`--depth <the stamp's depth, above ${BUCKET_DEPTH}> is required`)
  }
  if (!options.slots) throw new Error('--slots <slot record file> is required')
  options.bee = options.bee.replace(/\/+$/, '')
  options.batch = options.batch.toLowerCase()
  return options
}

/**
 * The stamp's signer. A parse error is replaced by a fixed message, so no
 * library message can ever carry the key's bytes to the terminal.
 */
function signerFrom(key) {
  if (!key) throw new Error("STAMP_KEY is not set to the private key of the stamp's owner")
  const { core } = loadForkPackages()
  try {
    return new core.PrivateKey(key)
  } catch {
    throw new Error('STAMP_KEY is not a 32-byte hex private key')
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const site = await buildSite(options.build)
  const record = await readSlotRecord(options.slots, options.batch, options.depth)
  const plan = planSlots(record, [...site.chunks.keys()], options.batch, options.depth)

  console.log(`files ${site.files.length}, chunks ${site.chunks.size}`)
  console.log(
    `fullest bucket ${plan.fullest.bucket} uses ${plan.fullest.used} of ${slotsPerBucket(options.depth)} slots`,
  )
  if (options.dryRun) {
    console.log(`dry run, nothing sent, no record written`)
    console.log(site.reference)
    return
  }

  const signer = signerFrom(process.env.STAMP_KEY)
  console.log(`stamp signer ${signer.publicKey().address().toHex()}`)

  const lastTimestampMs = await sendAll(
    options.bee,
    site.chunks,
    plan.slots,
    signer,
    options.batch,
    plan.record,
  )
  await writeSlotRecord(options.slots, { ...plan.record, lastTimestampMs })
  console.log(`all ${site.chunks.size} chunks accepted, slot record written`)
  await checkSite(options.bee, site.reference)
  console.log(site.reference)
}

if (
  process.argv[1] &&
  (await realpath(process.argv[1])) === (await realpath(fileURLToPath(import.meta.url)))
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
