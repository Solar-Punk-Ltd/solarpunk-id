// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/** Where the fork's source lives. */
export const REPOSITORY_URL = 'https://github.com/Solar-Punk-Ltd/solarpunk-id'

/**
 * The documentation, read as source in the repository: the fork does not
 * publish the docs site anywhere yet.
 */
export const DOCUMENTATION_URL = `${REPOSITORY_URL}/tree/main/docs-site/src/content/docs`

/** Who makes the fork, named in the product page's footer. */
export const MAKER = { name: 'Solar Punk', url: 'https://solarpunk.buzz' } as const
