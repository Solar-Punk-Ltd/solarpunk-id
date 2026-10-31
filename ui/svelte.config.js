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
    // Split, so the frames other sites embed load only their part of the app. vite.config.ts groups the modules into
    // two chunks, so a cold load still asks for a few files rather than 36 to 62.
    output: {
      bundleStrategy: 'split',
    },
  },
}

export default config
