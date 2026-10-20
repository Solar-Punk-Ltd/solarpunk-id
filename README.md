# Swarm Identity Management

> **A fork of Swarm ID, in beta and experimental.** This repository is Solar Punk's fork of
> [snaha/swarm-id](https://github.com/snaha/swarm-id), taken at snaha's 0.7.0 release, commit
> [`dc70275`](https://github.com/snaha/swarm-id/commit/dc70275bb), 2026-10-12. It is an experimental
> test from Solar Punk's side, not a release of snaha's project. What changed since the fork is in the
> [changelog](./lib/CHANGELOG.md).

Cross-browser compatible authentication and identity management for Swarm dApps.

**[Documentation](./docs-site/src/content/docs)** | **[Identity UI](https://solarpunkid.bzz.link)**

## Packages

- **[lib/](./lib/README.md)** — `@solarpunkltd/swarm-id` TypeScript library for authentication and Bee API operations
- **[ui/](./ui/README.md)** — `@swarm-id/ui` SvelteKit identity UI (trusted domain)
- **[demo/](./demo/)** — Demo dApp with library integration examples
- **[docs-site/](./docs-site/)** — Starlight (Astro) documentation website
- **[signaling/](./signaling/README.md)** — `@swarm-id/signaling` account-bus signaling and relay server
- **[multichain/](./multichain/README.md)** — `@swarm-id/multichain` postage contract writes, cross-chain funding, local solver
- **[eslint-rules/](./eslint-rules/)** — `@swarm-id/eslint-rules` shared license-header lint rules

## Architecture

The project uses an OAuth-style popup authentication flow over shared localStorage — no Storage Access API and no browser extension. The proxy iframe reads the trusted domain's first-party store while the embedding page is same-site, which covers the local rig and a copy self-hosted on the app's own domain. Where the two are cross-site, as an app on another domain is with the hosted site at `solarpunkid.bzz.link`, or the browser partitions regardless (Safari's ITP, strict privacy settings elsewhere), the connect popup hands the iframe the account's upload credentials directly instead, so uploads keep working ([Account bus](./docs/Account-Bus.md)). That path is confirmed on real Safari, upload included (iOS 18.7 / Safari 26.6), see [Safari limitations](#safari-limitations).

**Key Innovation**: The popup-based authentication allows dApps to securely derive app-specific secrets from a master identity. Cross-app isolation comes from the derivation itself — every secret is an HMAC-SHA256 of the master key over the app's own origin, so one app cannot reach another's — not from storage partitioning, which the flow is designed to work with or without.

[Architecture deep-dive →](./docs-site/src/content/docs/architecture.mdx)

## Quick Start

The library is published to npm as `@solarpunkltd/swarm-id`. `@snaha/swarm-id` on npm is snaha's upstream package, without this fork's changes, so install this one by its own name.

```bash
pnpm add @solarpunkltd/swarm-id
```

[Install](./docs-site/src/content/docs/getting-started.mdx#install) has the npm command, depending on a built checkout while developing, and why installing from git does not work.

```typescript
import { SwarmIdClient } from '@solarpunkltd/swarm-id'

const client = new SwarmIdClient({
  iframeOrigin: 'https://solarpunkid.bzz.link',
  metadata: {
    name: 'My dApp',
    description: 'A demo Swarm application',
  },
  onConnectionChange: (info) => {
    console.log('Connection changed:', info.identity?.name, 'canUpload=', info.canUpload)
  },
})

await client.initialize()

// A connected user can still have canUpload=false (no postage stamp and no
// subsidised gateway), so gate uploads on both.
const info = client.connectionInfo
if (info.identity && info.canUpload) {
  const result = await client.uploadData(new TextEncoder().encode('Hello, Swarm!'))
  console.log('Uploaded:', result.reference)
}

client.destroy()
```

[Full integration guide →](./docs-site/src/content/docs/getting-started.mdx)

## Deployment

The identity site (`ui/`) is served from Swarm at https://solarpunkid.bzz.link, with the ENS name
`solarpunkid.eth` pointing at the upload. How it is built and uploaded, and why every route is
served from one `index.html`, is in
[Hosting on Swarm](./docs-site/src/content/docs/swarm-hosting.mdx).

The documentation is not hosted. It is read from
[`docs-site/src/content/docs`](./docs-site/src/content/docs) in this repository. The demo
(`demo/`) is not hosted either and runs locally with `pnpm dev`.

## Local Development

```bash
pnpm install
pnpm dev
```

Open http://localhost:3500 - that's it!

- Demo app runs on port 3500
- Identity UI runs on port 5500
- No HTTPS, certificates, or custom domains required (`localhost` is a secure context)

**Note:** On Safari the proxy iframe's storage is partitioned, so the connect popup hands the session over directly. A handover carrying no account view is refused; a session whose account has no usable postage batch connects but cannot upload, and `ConnectionInfo.uploadUnavailableReason` says why. See [Safari limitations](#safari-limitations).

### Development Mode (with hot reload)

```bash
# Start the full stack (identity UI :5500 + demo :3500 + bus signaling :5520)
pnpm dev

# Or start individually
pnpm dev:ui          # Identity UI on port 5500
pnpm dev:demo        # Demo on port 3500, connected to the identity UI (:5500)
pnpm dev:signaling   # Account-bus signaling server on port 5520
pnpm dev:lib         # Library watch mode (rebuilds on changes)
```

### Local Bee Cluster (bee-compose)

For local development with postage stamps and uploads, use [@snaha/bee-compose](https://www.npmjs.com/package/@snaha/bee-compose) to run a local Bee cluster with blockchain. Requires Docker.

```bash
# Start cluster (queen + 3 full workers)
pnpm dev:cluster:start

# View logs
pnpm dev:cluster:logs

# Stop cluster
pnpm dev:cluster stop

# Fresh start (purge data; add --pull after a bee-compose bump)
pnpm dev:cluster:start --fresh
```

**Endpoints:**

| Service        | URL                      |
| -------------- | ------------------------ |
| Queen Bee API  | `http://localhost:1633`  |
| Worker 1 API   | `http://localhost:16331` |
| Blockchain RPC | `http://localhost:9545`  |

**Getting a Postage Batch:**

The easiest way is to use the Developer Tools page in the Identity UI:

1. Navigate to http://localhost:5500/dev
2. Go to the **Chain** tab and select an account
3. Click **Create drive to test with** — it buys a real batch on the local chain, owned by that
   account's own postage signer, and attaches it as a drive

Or use the Bee API directly:

```bash
# Buy stamp (amount=500000000, depth=20)
# The amount must exceed ~414720000 — the local chain's price (24000)
# times Bee's 17280-block (~24h) minimum validity.
curl -X POST "http://localhost:1633/stamps/500000000/20"

# Wait ~30 seconds, then verify it's usable:
curl "http://localhost:1633/stamps/<batchID>"
```

See the [Local Development guide](./docs-site/src/content/docs/local-development.mdx) for client-side stamp signing, known dev keys, SSH tunnel setup, and more.

### Paying for storage locally

Buying, extending and resizing a drive all cost money. The built-in engine pays on Gnosis: the
wallet sends xDAI, WXDAI, USDC or BZZ to the drive's owner address. A shipped build has no rail for
paying from another chain, and buying a drive from one goes through the fund.bzz.limo widget.
Locally a second chain rehearses such a payment anyway: your wallet signs a genuine deposit there,
and the Gnosis-side chain's faucet plays the solver.

Where the chain carries the EIP-7702 delegate, as Gnosis mainnet does, the postage calls run as one
atomic transaction. The baked snapshot cannot carry it — a state dump only keeps storage the bake
wrote — so locally they run one at a time until something splices the delegate in, which `/dev` →
**Chain** → **Create drive to test with** does.

That is the payment dialog's **built-in** method. The other one, `Pay with crypto (fund.bzz.limo)` —
the default when buying a drive — settles on Gnosis **mainnet** only, so locally there is nothing for
it to settle against: pick the built-in method to pay on the local chain, or turn on `/dev` →
**Chain** → **Simulated purchase**, which stands in for the widget with a fabricated batch so that
method's own screens stay reachable here. (It is also offered for buying alone; its contract ABI
cannot top up or dilute, so extend and resize list the built-in method by itself.)

```bash
pnpm dev:local         # everything: cluster, both chains, solver, identity UI, demo
pnpm dev:local:fresh   # the same, from a clean chain and empty node state
pnpm dev:local:stop    # tear the containers down
```

| What                         | Where                    |
| ---------------------------- | ------------------------ |
| Identity UI                  | `http://localhost:5500`  |
| Demo                         | `http://localhost:3500`  |
| Queen Bee API                | `http://localhost:1633`  |
| Gnosis-side chain (100)      | `http://localhost:9545`  |
| Payment source chain (31337) | `http://localhost:31337` |

**The quickest way to rehearse a payment is to pay from Gnosis**, which needs no bridge: point the
wallet at `http://localhost:9545` (chain 100, offered as _Gnosis Chain (fake)_) and the payment is
a plain xDAI transfer to the batch owner — no source chain and no solver involved at all. Paying
from _Ethereum Mainnet (fake)_ on `:31337` is the bridged route, and that one does need the solver.

The containers run in the background; the solver, UI and demo run in the foreground so you can
watch each delivery land. Re-running `dev:local` is a no-op for whatever is already up.

`/dev` → **Chain** → **Wallet networks** adds the local chains to MetaMask so a balance shows before
you reach the payment screens, and the **Faucet** beside it stocks the account you connect with —
**Use connected wallet** fills its recipient with the address you would be paying from, which is the
one that has to hold something. Nothing funds the payer for you: the wallet must already hold what it
pays with.

Reach for `dev:local:fresh` when the chain has drifted — every purchase trades against a real,
thin BZZ pool, and this restores the baked snapshot (it also wipes node state, so drives you
created earlier will point at batches that no longer exist; clear the UI's site data too).

Chain id alone cannot tell the local chain from the real one — it answers as 100 deliberately — so
before anything is signed the app compares **genesis hashes**, which a chain cannot borrow, against
the endpoint's own. It refuses in words whenever the two are not the same chain: your wallet on real
Gnosis while the app is pointed at the local one, the reverse, or a wallet simply left on some third
network. That is what stops a rehearsal spending real xDAI.

**Already have the real Gnosis in MetaMask? Remove it while rehearsing.** MetaMask keys networks by
chain id, so a switch to 100 lands on whichever RPC is active for it — usually the real one. The app
detects the mismatch by genesis and offers its own RPC, but MetaMask refuses to adopt an RPC for an
id it already serves ("network already exists"), so the offer cannot repair it for you: remove the
real Gnosis network from MetaMask first (or select the local RPC by hand in that network's menu),
and add it back when you are done. The fake mainnet has no such trap — 31337 collides with nothing.

Then, once: open the UI's **`/dev`** page and pick **Use local** from the header menu. (It lives
there rather than in **Network settings**, which ships to production.)

#### From a fresh clone, end to end

Everything below runs offline against the committed chain snapshot. You need Docker and a browser
wallet (MetaMask or similar) — no funds, no testnet, no account anywhere.

```bash
pnpm install
pnpm dev:local          # first run compiles Bee from source; later runs are seconds
```

Wait for `local solver: watching for deposits to 0x…`, then in the browser:

1. **http://localhost:5500** → **Get started**, and create an identity (a password is quickest).
   Choose **Stay local for now** when offered.
2. **http://localhost:5500/dev** → **Use local** in the header menu. The banner above the tabs
   should read _Local dev chain, nothing here is real_.
3. **Chain** tab → **Create drive to test with**. That buys a real depth-20 batch on the local
   chain, owned by your account's own postage signer, and attaches it as a drive. Takes ~30s.
4. Still on the **Chain** tab, stock the wallet you will pay with: **Faucet** → **Use connected
   wallet** → send it some ETH on the source chain. Nothing funds the payer for you.
5. Back to **http://localhost:5500** → **Storage** tab → expand the drive → **Extend lifespan**.
   Pick **years** and bump it to 3 — a small extend is covered by the batch's leftover funds and
   never asks for payment, which is the most common reason the payment screens "don't appear".
6. **Proceed** → **Connect wallet** → pick your wallet, and _Ethereum Mainnet (fake)_ as the chain
   to pay from. The app offers to add it to the wallet and switch: accept. Nothing to configure,
   and no key to import.
7. Review the quote, **Pay with your wallet**, approve the transaction. Watch the `[solver]` lines
   in your terminal report the delivery, then the drive's lifespan grows.

What just happened: your wallet really signed a deposit on one chain; a separate solver process saw
it and paid out on another; that xDAI was swapped for BZZ through a real SushiSwap pool; and the
batch was topped up on the real PostageStamp contract in a single atomic EIP-7702 transaction.

To check the automated suites too:

```bash
pnpm check:all                                   # lint, types, unit tests
pnpm test:fork                                   # on-chain, needs pnpm dev:chain:detach
pnpm --filter @swarm-id/ui test:e2e              # browser, needs pnpm dev:local
```

**Where the solver fits.** The browser signs the deposit and then waits for money it does not
control, as it would on a real bridge. `multichain/src/local-solver.ts` is what watches the source
chain and pays out from the Gnosis-side faucet. The deposit carries its own delivery instruction in
its calldata, so the solver is stateless. Stop the solver and a payment hangs and then fails —
which is what a solver outage looks like.

**What this does and does not prove.** The Gnosis side is genuine — the delivered xDAI is swapped
for BZZ through a real SushiSwap pool and spent against the real PostageStamp contract, as a single
atomic EIP-7702 transaction using the same delegate contract mainnet uses. The rail
itself is not: its prices are invented, and its failure and refund behaviour is nothing like the
real one. The step shape is mirrored — paying in ETH is one signature, paying in the mock USDC is
approve-then-deposit with the solver pulling the token. It rehearses the payment
**experience** — connect, switch chain, quote, approve, progress, cancel, resume.

With no source chain running the bridged route simply is not offered; paying from Gnosis
still is, and it needs no solver. Funding never falls back to a free transfer. See
[docs/Drive-Payment-Flow.md](docs/Drive-Payment-Flow.md).

### Developer Tools (/dev route)

The Identity UI includes a Developer Tools page at http://localhost:5500/dev with utilities for local development:

A menu in the header switches the whole app between the local and production endpoints, and a
banner names the chain the configured RPC actually serves — so it is always visible whether these
tools would be spending real money.

- **Overview**: Live endpoint status, a link into the demo app's connect flow, and local-data counters
- **Chain**: Faucet, on-chain batch and test-drive creation, batch import by ID, and the mock
  purchase toggles for the **Add drive** flow
- **Node**: Stored stamps, retrievability checks, manual sync, and partition tuning
- **Devices**: The devices registered to an account and the partitions they hold

## Project Structure

```
.
├── lib/                  # @solarpunkltd/swarm-id TypeScript library
├── ui/                   # Identity UI (SvelteKit + Tailwind v4 + shadcn-svelte style)
├── demo/                 # Demo app (SvelteKit)
├── signaling/            # Account-bus signaling and relay server (ws)
├── multichain/           # Postage contract writes, cross-chain funding, local solver
├── eslint-rules/         # Shared license-header lint rules
├── scripts/              # One-off benchmarks (outside the pnpm workspace)
├── docs/                 # Design records
└── docs-site/            # Documentation website (Starlight/Astro)
```

## Troubleshooting

### Demo not loading

- Check if ports 3500 and 5500 are already in use: `lsof -i :3500 -i :5500`
- Ensure both servers are running: `pnpm dev`

### Authentication popup blocked

- Allow popups for localhost in browser settings
- Ensure popup is triggered by user action (not programmatically)

### Changes not reflecting

- Library changes: restart `pnpm dev:lib` or rebuild
- SvelteKit changes: automatic hot reload

### Safari limitations

Safari's Intelligent Tracking Prevention (ITP) partitions storage for third-party iframes, so the proxy cannot read the trusted domain's localStorage. Uploads are designed to keep working regardless: the connect popup hands the iframe the account's synced projection (postage stamps including their signer keys), and cross-context coordination rides the [account bus](./docs/Account-Bus.md) instead of storage events.

> **Status: confirmed on real Safari, upload included.** Measured on iOS 18.7 / Safari 26.6 against snaha's deployed sites of the upstream project (`swarm-demo.snaha.net` → `swarm-id.snaha.net`). ITP partitions the proxy iframe. The connect popup's `postMessage` through `window.opener` reaches it. That run measured the older path, a popup the session frame opened itself. The popup is now opened by the Swarm ID button frame and posts to the Swarm ID frames beside it, and W6.1e measures that path on a device again. The hydrated account view builds a working stamper (`uploadMode: user-stamp`), and a chunk uploads and reads back byte-identical. The device id also held across a reload, so the partitioned store survived the session ending and being re-seeded ([#584](https://github.com/snaha/swarm-id/issues/584) has the report). Apps no longer receive the device id, so this is no longer checked ([docs/Hardening.md](docs/Hardening.md)).
>
> A **private window** was measured separately and passes the same five checks, upload included, with a fresh device id each time, as expected, since the private partition is discarded when the window closes.
>
> One thing no run has settled, and it is not claimed here: the **eviction horizon**. Two loads in one sitting say nothing about how long a dormant account's storage survives ITP ([#659](https://github.com/snaha/swarm-id/issues/659)). The sources disagree. WebKit's published rule is seven days of Safari use without interaction on the site ([webkit.org, 2020-03-24](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)). A WebKit source change of 2024-02-09 added a 30-day tier for sites never reached through cross-site link decoration ([`4506123`](https://github.com/WebKit/WebKit/commit/45061230013728ec9c4900b01b12af26dc592b4b)), while its own message says it does not change current behaviour. The Safari backup prompt plans for the shorter figure ([docs/Hardening.md](docs/Hardening.md)).

What remains regardless:

- **The session outlives the page.** The handover is kept in the partition's own store until the user disconnects or the 7-day session expires, so a reload does not re-run the popup ([#635](https://github.com/snaha/swarm-id/issues/635)). A restored session reads the account's published state before its first write, and ends itself if this app was revoked while the tab was closed, which reaches it no other way. Reads start at once and writes wait for the answer. If Swarm cannot be reached the writes stay refused, with `uploadUnavailableReason` set to `session-unconfirmed`, and the next write asks again. An account with no drive has published nothing, so it cannot have published a revoke, and its session writes once the check confirms that ([docs/Hardening.md](docs/Hardening.md)).
- **Live propagation needs a signaling server.** `pnpm dev` starts one locally. The hosted site is built without one unless `PUBLIC_BUS_SIGNALING_URL` is set at build time, and a build without one leaves a partitioned iframe talking only to contexts in its own partition. Everything still works without it: a partition handover between devices waits for the 10 s lease poll instead of one bus round trip, and a synced account's changes arrive through Swarm feed sync rather than at once. How the bus works: [docs/Account-Bus.md](./docs/Account-Bus.md).
- **Safari private mode**: Sessions are ephemeral (lost when the private window closes).

See [#277](https://github.com/snaha/swarm-id/issues/277) for the background.

## Contribute

We have a separate [guide document](CONTRIBUTING.md) if you want to contribute to the project.

## License

[Apache 2.0](LICENSE)
