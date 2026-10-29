// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import staticAdapter from '@sveltejs/adapter-static'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),

  kit: {
    adapter: staticAdapter({ fallback: 'index.html' }),
    paths: {
      base: process.env.BASE_PATH || '',
    },
    // Swarm gateways such as bzz.link answer 500 to many parallel requests, and a split build makes a cold load ask
    // for 36 to 62 files at once. One bundle makes it 5.
    output: {
      bundleStrategy: 'single',
    },
  },
}

export default config
