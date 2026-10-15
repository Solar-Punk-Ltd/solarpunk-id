# Library Core (`lib/`)

Two package entries, one build: `@solarpunkltd/swarm-id` (`src/index.ts`) is the dApp API — `SwarmIdClient`, its types, a few read-back helpers — and `@solarpunkltd/swarm-id/internal` (`src/internal.ts`) is what the identity UI imports: sync, key derivation, the account bus, the proxy. A name goes on `internal.ts` because `ui/` imports it, or because the docs' "Storage Layout" page names it for a host that writes the identity UI's `localStorage` (#815); on `index.ts` because a dApp does. Nothing is exported for the lib's own sake, its modules and tests import each other directly (#801).

- **SwarmIdClient** (`swarm-id-client.ts`) — dApp-side: embeds the hidden iframe, mounts the visible button frame where the dApp asks (`mountButton`), proxies Bee API calls
- **SwarmIdButtonFrame** (`swarm-id-button-frame.ts`): the `/button` page a dApp mounts, with the click that opens the connect popup, so the popup's opener is a Swarm ID frame of the dApp's page. It tells the session frame beside it the popup's challenge (`connectWindowOpened`) and holds no session
- **SwarmIdProxy** (`swarm-id-proxy.ts`) — iframe-side: reads auth from the trusted domain's shared localStorage when the embedding page is same-site, or from the connect popup's handover when the browser partitions its storage; signs operations; a peer on the account bus either way

## Message Protocol

All cross-origin communication via `postMessage` with Zod validation.

The full unions live in `types.ts` (`ParentToIframeMessageSchema`, `IframeToParentMessageSchema`,
`PopupToIframeMessageSchema`), 41 and 46 members, one `…Response` per request. The ones worth
knowing by name:

- **Parent → Iframe**: `parentIdentify`, `checkAuth`, `disconnect`, `uploadData`,
  `downloadData`, `deriveAppSecret`, `getChatKey` (the site's chat key, whose address the
  site's chat binding names, `docs/Chat-Binding.md`), `stampChunk` (the iframe stamps a whole
  chunk and returns the stamp, so the app sends the chunk through its own Swarm access),
  `setBeeApiUrl` (the site's own Bee node for its content, which `parentIdentify` can carry
  too, held in memory by that site's frame and never stored. The proxy's `accountBee`, the
  person's own node, keeps the revocation check, the roster and the coordinator's chunks)
- **Iframe → Parent**: `proxyReady`, `initError`, `authStatusResponse`, `authSuccess`,
  `connectionInfoChanged` (what `initialize()` awaits), `uploadDataResponse`,
  `error`
- **Popup → Iframe**: `setSecret`, the partitioned handover below, posted by the connect popup the button frame opened
- **Page ↔ Button frame**: `buttonIdentify`, `buttonUpdate`, `buttonReady`, `buttonInitError`,
  `buttonWindowChanged`. **Button frame → Iframe**: `connectWindowOpened`, accepted only from a
  frame of the same parent page

Two authentication paths, decided by the storage probe (`utils/storage-probe.ts`):

- **Unpartitioned**: popup writes to localStorage → storage event fires in the iframe → the iframe authenticates from shared storage.
- **Partitioned**: the button frame opens the popup and tells the iframe its challenge, popup → `postMessage(setSecret)` to the frames beside its opener (`ui/src/lib/handover-targets.ts`) with the account's synced projection → `handlePopupMessage` hydrates an in-memory account view and keeps the handover under `partitionSessionStorageKey(parentOrigin)` — one session per dApp origin, since the store is shared by every same-site dApp (#671) — so a reload restores it. The popup's first-party write never reaches the iframe as a storage event here. Events from the partition's own store still fire, and the proxy ignores them for a partitioned session rather than letting one reset it to defaults (#580, #677). Every connect signs the site in with no stamp: the connected-app entry and the handover say `stampPending`, which is session material stripped from every channel like `appSecret`, and while it is set the proxy resolves no stamp. The same popup sends a second `setSecret` without it when the person confirms the site's drive. The proxy takes it only under that popup's challenge, for its own parent and with the secret it already holds (`isStampHandover`), so it gives the open session the confirmed stamp and nothing else.

## Account bus (`bus/`)

Live contexts of one account (proxy iframes across partitions and devices, the SwarmID tab) also talk over the account bus — `BroadcastChannel` inside a partition, an encrypted WebRTC/relay mesh via the signaling server across them. Message kinds (`bus/messages.ts`, Zod-validated on receive): `account-delta` (a snapshot, LWW-folded like a feed payload), `lease-request` / `lease-claim` / `lease-released` (partition handover fast path, scoped to one batch — a lane is `(batchId, partition)`), `presence` (20 s liveness beat feeding the rival set), and `utilization-updated` (local transport only). Durable truth stays in storage and the Swarm feeds; the bus only makes live peers converge fast. Design: [`../docs/Account-Bus.md`](../docs/Account-Bus.md).

## Testing

- **TDD for `lib/` fixes**: when fixing a bug in `lib/`, always work TDD-style if
  applicable — write a failing test that reproduces the bug first, then fix, then
  confirm the test passes (pure refactors/docs are exempt)
