// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Pure client-side SPA: the identity UI runs entirely in the browser
// (WebAuthn, wallet signing, iframe proxy), so SSR is off. No route is
// prerendered either. The build is the adapter's `index.html` fallback and the
// assets, and a host serves that one page for every route. On Swarm that is the
// website's error document. A prerendered `connect.html` beside the
// `connect/done.html` folder would instead make Bee redirect `/connect` to
// `/connect/` (see `$lib/hosting/swarm-website`).
export const ssr = false
