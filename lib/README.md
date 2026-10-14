# @solarpunkltd/swarm-id

TypeScript library for integrating Swarm ID authentication and Bee API operations into dApps.

## Overview

The Swarm ID library provides a secure, iframe-based authentication system for Swarm applications. It consists of two main components:

1. **SwarmIdClient** — For parent windows/dApps to interact with the authentication system
2. **SwarmIdProxy** — Runs in the iframe, handles authentication and proxies Bee API calls

Authentication is handled by the SvelteKit identity management UI ([ui](../ui/)).

The package root, `@solarpunkltd/swarm-id`, is the dApp API and the only stable surface. `@solarpunkltd/swarm-id/internal` exists for the identity UI, and for a host that writes the identity UI's `localStorage` itself (the docs' "Storage Layout" page): beyond the names that page lists it carries no stability promise, its exports change whenever the UI's needs do, and a change there is not a breaking change of the package.

## Installation

`@snaha/swarm-id` on npm is snaha's upstream package, without this fork's changes, so install this package by its own name:

```bash
pnpm add @solarpunkltd/swarm-id
# or
npm install @solarpunkltd/swarm-id
```

The docs site's Quick Start page (`docs-site/src/content/docs/getting-started.mdx`) also covers depending on a built checkout while developing, and why installing from git does not work.

## Basic Usage

```typescript
import { SwarmIdClient } from "@solarpunkltd/swarm-id"

// 1. Create the client
const client = new SwarmIdClient({
  iframeOrigin: "https://solarpunkid.bzz.link",
  metadata: {
    name: "My dApp",
    description: "A demo Swarm application",
  },
  onConnectionChange: (info) => {
    console.log(
      "Connection changed:",
      info.identity?.name,
      "canUpload=",
      info.canUpload,
    )
  },
})

// 2. Initialize (creates hidden iframe; populates client.connectionInfo)
await client.initialize()

// 3a. Option A: Use iframe authentication button
// The iframe will show a connect/disconnect button automatically

// 3b. Option B: Manual authentication with connect()
// Opens the authentication page in a new window/tab (useful for custom UI)
await client.connect()

// 4. Read current connection state synchronously
const info = client.connectionInfo

// 5. Upload data (requires authentication AND upload capability — a connected
//    user can still have canUpload=false with no postage stamp and no
//    subsidised gateway)
if (info.identity && info.canUpload) {
  const result = await client.uploadData(
    new TextEncoder().encode("Hello, Swarm!"),
  )
  console.log("Uploaded:", result.reference)
}

// 6. Cleanup when done
client.destroy()
```

## Documentation

Full documentation is in the repository, under **[docs-site/src/content/docs](https://github.com/Solar-Punk-Ltd/solarpunk-id/tree/main/docs-site/src/content/docs)**:

- [Quick Start](https://github.com/Solar-Punk-Ltd/solarpunk-id/blob/main/docs-site/src/content/docs/getting-started.mdx) — Installation and integration guide
- [Architecture](https://github.com/Solar-Punk-Ltd/solarpunk-id/blob/main/docs-site/src/content/docs/architecture.mdx) — How the system works, key hierarchy, backup & recovery
- [API Reference](https://github.com/Solar-Punk-Ltd/solarpunk-id/blob/main/docs-site/src/content/docs/api/index.mdx) — Complete SwarmIdClient API documentation

## License

[Apache 2.0](LICENSE). This package is Solar Punk's fork of [Swarm ID](https://github.com/snaha/swarm-id) by snaha, published under the same licence.
