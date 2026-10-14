// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Fails when the npm tarball would carry anything beyond the build, the
 * README, the LICENSE and package.json. `npm pack --dry-run` runs `prepack`,
 * so this builds `dist` first and checks what a publish would really send.
 */

import { execFileSync } from "child_process"

const TOP_LEVEL_FILES = new Set(["LICENSE", "README.md", "package.json"])
const TEST_ONLY = /(^|\/)test[-.]|\.test\.|\.spec\./
const NEVER_SHIPPED = /(^|\/)\.env|\.pem$|\.key$/

const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
})
const [pack] = JSON.parse(output.slice(output.indexOf("[")))
const paths = pack.files.map((file) => file.path)

const refused = paths.filter(
  (path) =>
    !(TOP_LEVEL_FILES.has(path) || path.startsWith("dist/")) ||
    TEST_ONLY.test(path) ||
    NEVER_SHIPPED.test(path),
)

if (refused.length > 0) {
  console.error(
    `the tarball would carry ${refused.length} file(s) it must not:`,
  )
  for (const path of refused) console.error(`  ${path}`)
  process.exit(1)
}

console.log(
  `${pack.filename}: ${paths.length} files, ${pack.size} bytes packed, ${pack.unpackedSize} unpacked`,
)
