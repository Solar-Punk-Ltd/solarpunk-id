# Swarm Identity Management

Web-based identity and key management for decentralized applications on the Swarm network.

**Key Innovation**: Popup-based authentication flow using shared localStorage. The proxy iframe reads the trusted domain's first-party store whenever the embedding page is **same-site**, which is true of the local rig (`localhost:3500` + `localhost:5500`, ports do not affect _site_) and of a self-hosted copy on the app's own domain. The hosted site, `solarpunkid.bzz.link`, is cross-site with an app on another domain, such as an event site on `<name>.eth.limo`, so there the partitioned path below is the normal one. No Storage Access API is involved, on localhost or anywhere else.

Where the two are genuinely cross-site, or the browser partitions regardless (Safari ITP, strict privacy settings), the iframe gets its own partitioned store and the connect popup hands it the account's synced projection (stamps incl. signer keys) instead — uploads keep working, and the session is kept in that partition's own store until it is disconnected or its 7 days are up ([#635](https://github.com/snaha/swarm-id/issues/635)), rather than re-handshaking on every page load ([#277](https://github.com/snaha/swarm-id/issues/277), [docs/Account-Bus.md](docs/Account-Bus.md)). That handover needs the popup to be opened **by a Swarm ID frame**, from a click inside it, because a browser lets a frame open a window only from its own click: that is the button frame `SwarmIdClient.mountButton()` shows, a second visible frame beside the hidden one in the same partition. It opens the popup, tells the hidden frame the popup's challenge, and the popup posts the handover to the Swarm ID frames beside its opener. `SwarmIdClient.connect()` opens the popup from the dApp page only when the iframe can prove its store is shared, and otherwise refuses with `button-required`. It asks the storage, not the user agent, and shared means the iframe can open what a first-party page sealed there ([#613](https://github.com/snaha/swarm-id/issues/613), `lib/src/utils/storage-probe.ts`).

**Verified on real Safari** ([#584](https://github.com/snaha/swarm-id/issues/584)): measured on iOS 18.7 / Safari 26.6 against snaha's deployment of the upstream project, ITP partitions the iframe, the `window.opener` handover reaches it, the hydrated view builds a working stamper (`uploadMode: user-stamp`), and a chunk uploads and reads back byte-identical. That run also saw the device id hold across a reload, which the demo's Safari check no longer tests, because apps no longer receive the device id ([docs/Hardening.md](docs/Hardening.md)). A **Safari private window** passes the same five checks, upload included. Its partitioned store is still discarded when the window closes, which is by design. Still unrun on a device: how long a dormant account's storage survives ITP's deletion ([#659](https://github.com/snaha/swarm-id/issues/659)). Two loads in one sitting say nothing about it. WebKit's published rule says seven days of Safari use without interaction, and a WebKit source change of 2024-02-09 added a 30-day tier, as `docs/Hardening.md` sets out with both sources.

## Project status

**Pre-production.** While the version is `0.x` we consider the project pre-production: there are no
users to keep and no data to migrate, so backwards compatibility and migration are not required — a
schema, wire format, storage key, or protocol may change in place, and the old path is deleted
rather than kept beside the new one. `0.x` says the same thing to anyone consuming
`@solarpunkltd/swarm-id`. That changes at `1.0`, and this note with it.

## Architecture

1. **Trusted Domain Model**: A trusted domain (e.g., `id.ethswarm.org`) hosts keystore UI and management
2. **OAuth-style Popup Flow**: dApps trigger authentication popups that derive app-specific secrets from a master key
3. **Iframe Proxy**: Hidden iframe handles secure communication and proxies Bee API calls

**Security**: Master key in first-party context only, HMAC-SHA256 key derivation, all postMessage validated with Zod schemas.

### Authentication

There is exactly one kind of account: a BIP-39 seed account. What used to be distinct account
types are now just ways of protecting that seed, held in the device-local vault
(`LocalVaultSchemaV1`) as one of three **access methods**:

- **Passkey/WebAuthn**: browser-native credential
- **Ethereum wallet**: a signature from an existing wallet
- **Password**

The master key is derived from the seed entropy, not from a signed challenge.

### Key Hierarchy

```
Master Key (from the account's BIP-39 seed entropy)
    ├─> App-Specific Secret (HMAC-SHA256 with app origin)
    │       ├─> Low-stakes keys (feed, session) → shared with apps
    │       └─> High-stakes keys (stamps, ACT) → never shared, apps request signing
```

### Swarm Data Primitives

- **Chunks**: 4KB max, content-addressed or single-owner
- **Feeds**: Mutable data pointers (owner + topic → latest reference)
- **SOC**: Signed chunk with identifier
- **ACT**: Encrypted content with grantee management
- **Postage Stamps**: Required for uploads, prove payment for storage

## Packages

- **lib/** ([AGENTS.md](lib/AGENTS.md)): TypeScript library (`@solarpunkltd/swarm-id`) — auth and Bee API operations
- **ui/** ([AGENTS.md](ui/AGENTS.md)): `@swarm-id/ui` — SvelteKit identity UI (trusted domain), hosts the keystore UI and management
- **demo/**: Demo dApp showing library integration
- **docs-site/** ([AGENTS.md](docs-site/AGENTS.md)): Starlight (Astro) documentation website
- **signaling/**: `@swarm-id/signaling` — account-bus signaling and relay server
- **multichain/**: `@swarm-id/multichain` — postage contract writes, cross-chain funding, the local solver
- **eslint-rules/**: `@swarm-id/eslint-rules` — the license-header lint rules every package shares
- **scripts/**: `swarm-id-scripts` — one-off benchmarks, outside the pnpm workspace

Each package's own `AGENTS.md` holds what applies inside it, and is deliberately not repeated
here: two copies of a rule is one copy that goes stale. `CLAUDE.md` imports them so they load
with this file.

## Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Identity UI (:5500) + demo (:3500) + bus signaling (:5520)
pnpm dev:local        # …plus the Bee cluster, both chains and the payment solver
pnpm build            # Build everything
pnpm check:all        # All CI checks (format, lint, typecheck, test, knip)
pnpm clean            # Clean build outputs
```

`localhost` is a secure context — WebAuthn/Passkeys work without HTTPS.

## IMPORTANT: Pre-commit Requirements

Before committing, you MUST pass `pnpm check:all`. It runs the repo-wide `format:check`, then each
package's own `check:all` in order:

- **`@swarm-id/eslint-rules`**: `typecheck`
- **`@solarpunkltd/swarm-id`**, **`@swarm-id/multichain`**, **`@swarm-id/signaling`**: `format:check`, `lint`, `typecheck`, `test`
- **`@swarm-id/ui`**, **`@swarm-id/demo`**: `lint` (includes license headers), `check`, `knip`, `test`

Chain-backed suites are NOT in `check:all` — they need a chain running. `pnpm test:fork` (needs
`pnpm dev:chain:detach`) fails without one, naming the command; `pnpm --filter @swarm-id/ui test:e2e`
(needs `pnpm dev:local`) runs its chain-free tests anyway and skips the chain-backed ones.

## Code Style

- **Format after editing**: Run `pnpm exec prettier --write <file>` on files you modify
- **No semicolons**
- **Never use `null`** — use `undefined` (exception: external library APIs)
- **Never use `any`** — use proper types, generics, `unknown`
- **Never use dynamic imports** — static imports at top of file only
- **No magic numbers** — use SCREAMING_SNAKE_CASE constants (0, 1, -1, 2 excepted)
- **Omit file extensions** in imports
- **kebab-case** for all file and directory names
- **Conventional commits**: `feat:`, `fix:`, `docs:`, etc.
- **TypeScript execution**: Use `pnpx tsx` (not `npx ts-node`)
- **Monorepo version pinning**: toolchain versions are pinned across the monorepo (eslint 10,
  vite 7, svelte 5.48, vite-plugin-svelte 6) — do NOT bump these in one package independently
  of the rest of the monorepo
- **Recursive scripts: `pnpm -r run <script>`** — a bare `pnpm -r <script>` resolves to a
  built-in pnpm command whenever the names collide (pnpm 11 added a built-in `clean`)
- **Timeouts: use `withTimeout`** (`lib/src/utils/promise.ts`, exported from the package) — never
  `Promise.race` work against an inline `setTimeout` rejection: when the work wins, the losing
  timer stays armed and leaks its handle. `withTimeout(work, ms, message)` clears the timer and
  rejects with `TimeoutError`, so discriminate timeouts with `instanceof TimeoutError`, not by
  message.
- **JSON-RPC: use `jsonRpcCall`/`jsonRpcBatch`** (`lib/src/utils/json-rpc.ts`, exported from
  `@solarpunkltd/swarm-id`) — never a hand-rolled `fetch` + envelope read. Reach for a null-tolerant
  variant only where `null` is a real outcome. A deadline rejects with `TimeoutError`, as above,
  and every rejection from them names the endpoint, so `error.message` can be shown as-is.
  `@swarm-id/multichain` keeps its own copy of the envelope checks (`multichain/src/json-rpc.ts`)
  so the package stays self-contained; `checkedResult` and `requireValue` are still identical, the
  rest has diverged. Changing an envelope check here means checking whether it applies there too.

## Testing

- Unit tests (`*.test.ts`): Vitest
- E2E and browser tests (`tests/*.test.ts` in `ui/` and `demo/`): Playwright
- Integration tests against a local Bee cluster (`lib/test/integration/`): Vitest, run in CI by
  `integration-tests.yml`
- Live tests against a real Bee (`lib/test/live/`): Vitest, opt-in

## Version control conventions

- Use [conventional commits](https://www.conventionalcommits.org/) (e.g. `feat:`, `fix:`, `chore:`)
- Keep PR titles and descriptions concise
- Omit the issue number from branch names and titles
- When a PR resolves an issue, reference it with a closing keyword (e.g. `Closes #53`) so GitHub closes the issue automatically on merge
- Keep a **linear history**: rebase onto `main` to update a branch or resolve a conflict — never merge `main` into the branch. Rebasing a branch that is already pushed ends in `git push --force-with-lease`.

## Deployment

The identity site (`ui/`) is a Swarm website at https://solarpunkid.bzz.link, ENS name
`solarpunkid.eth`. The build and upload recipe, and the rule that no route may become a folder,
are in `docs-site/src/content/docs/swarm-hosting.mdx`. Nothing deploys it automatically.

- A production build needs `PUBLIC_ETHEREUM_RPC_URL`, or it serves no site, and an app's origin
  must be on the ENS allow list ([docs/Site-Allow-List.md](docs/Site-Allow-List.md)).
- No account-bus signaling server is part of the hosting. The build runs without one unless
  `PUBLIC_BUS_SIGNALING_URL` is set at build time, and works without it (`ui/.env.example`).
- The docs site and the demo are not hosted. The docs are read from
  `docs-site/src/content/docs`, and the demo runs locally with `pnpm dev`.
