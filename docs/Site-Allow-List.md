# Site allow list

Swarm ID serves only the sites on its allow list. A site that is not on it cannot
embed the proxy frame and cannot open the connect window: both refuse it before
anything is read, derived or signed for it, and say why.

The list is a text record on an ENS name, so adding or removing a site is a
change to that record. No new build and no new upload is needed.

## Where it is enforced

- **The proxy frame** (`lib/src/swarm-id-proxy.ts`, `handleParentIdentify`)
  checks the origin the browser reports for the embedding page, before it reads
  any stored session or answers `parentIdentify`. A refused page gets one
  `initError` whose text names the page and the reason, and its
  `SwarmIdClient.initialize()` rejects with `init-failed` carrying that text.
  The frame answers nothing else to that page until it is loaded again.
- **The connect window** (`ui/src/lib/stores/connect.svelte.ts`) checks the
  site its own link names (`#origin=`). A refused site shows "This site cannot
  connect", the site and the reason, and no account is offered.

Both ask the same function, `siteAllowList()` in `ui/src/lib/accepted-site.ts`,
which reads the list with the settings below. The list itself is
`createSiteAllowList` in `lib/src/utils/site-allow-list.ts`.

## The record

The record is a text record on the ENS name. It holds exact origins separated
by white space or commas, for example:

```
https://viewer.example.com https://chat.example.com
```

Each entry must be a clean https origin, in the exact form a browser reports an
origin: `https://`, a lower-case host in punycode, an optional port that is not
443, and nothing else. The host's labels are letters, digits and hyphens joined
by single dots, so no wildcard, no underscore and no leading, trailing or doubled
dot. No path, no trailing slash, no query, no fragment, no user info. An entry that is not clean is ignored and logged in the browser console,
and the rest of the list still applies.

A site matches only when its origin is the same string as an entry. There are no
wildcards, no suffix matching and no patterns. `https://viewer.example.com` does
not allow `https://a.viewer.example.com`, `https://viewer.example.com:8443` or
`http://viewer.example.com`.

## How the record is read

The name is resolved properly: the ENS registry
(`0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`) names the name's resolver, and
the resolver's `text(node, key)` gives the record. Both are `eth_call`s to the
Ethereum mainnet JSON-RPC endpoint the build names. The list is never read
through bzz.link or any Swarm gateway: whoever serves the code must not also be
able to answer which sites it trusts.

The name must be a plain lower-case name (letters, digits and hyphens in each
label, at least two labels). Anything else is refused rather than normalized,
since a wrong normalization would read another name's record.

## Cache

A list read from the chain is kept in the identity origin's `localStorage`
under `swarm-id-site-allow-list`, with the name, the record key and the time it
was read. It is trusted for `SITE_ALLOW_LIST_CACHE_MS`, 10 minutes. After that
the next check reads the chain again. A cached list is used only for the same
name and record key, and never when its time is in the future.

So a site removed from the record keeps working for at most 10 minutes on a
device that read the list before the change. A site added is served as soon as
a device reads the list again.

## It fails closed

The answer is "refused" when:

- no endpoint is set,
- the endpoint does not answer, or answers an error,
- an answer is longer than `MAX_CHAIN_ANSWER_BYTES`, 128 KiB of data, far more
  than any list of sites needs,
- the name has no resolver,
- the record is empty, unreadable, or names no clean origin,
- the name setting is not a plain lower-case name,

and there is no fresh cached list. A cached list past its limit is never used,
even when the chain cannot be read. The refusal reason says the list could not
be read.

## Settings

All are public env settings of the identity UI, like
`PUBLIC_WALLETCONNECT_PROJECT_ID` (see `ui/.env.example`). None is secret.
`ui/src/lib/accepted-site.ts` reads them at run time, through SvelteKit's
`$env/dynamic/public`, not as values compiled into the code. The identity UI is
a static build, so SvelteKit writes their values from the build's environment
into `_app/env.js`, and the page loads that file when it starts. A deployed copy
therefore takes new settings from a new `_app/env.js`, without rebuilding the
code.

| Setting                              | Default                                   | What it does                                                                                                   |
| ------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_ETHEREUM_RPC_URL`            | none                                      | The Ethereum mainnet JSON-RPC endpoint the record is read through. Unset, every site is refused.               |
| `PUBLIC_SITE_ALLOW_LIST_ENS_NAME`    | `solarpunkid.eth`                         | The ENS name whose text record holds the list.                                                                 |
| `PUBLIC_SITE_ALLOW_LIST_RECORD_KEY`  | `buzz.solarpunk.sites`                    | The text record key, in the reverse-domain form ENSIP-5 asks of a vendor key.                                  |
| `PUBLIC_SITE_ALLOW_LIST_DEV_ORIGINS` | the demo app, in a development build only | Origins a development build serves without the chain. Read only by a development build, ignored in production. |

The development default is the demo app under each loopback name the local rig
and its browser suite use: `http://localhost:3500`, `http://127.0.0.1:3500` and
`http://[::1]:3500`. Naming any dev origins replaces that default. A dev origin
may be local http, and it must still be a clean origin.

The cache limit is the constant `SITE_ALLOW_LIST_CACHE_MS` in
`lib/src/utils/site-allow-list.ts`, not a setting.

## Adding a site

1. Open the ENS manager for `solarpunkid.eth` with the account that controls it.
2. Edit the text record `buzz.solarpunk.sites`. Add the site's origin, exactly as
   the browser reports it (open the site and run `location.origin` in its
   console), separated from the others by a space.
3. Save the record, which is one mainnet transaction.

Devices that have a fresh cached list see the change within 10 minutes. To
remove a site, delete its origin from the record the same way.

The name needs a resolver that supports text records, such as the ENS public
resolver. A name with no resolver, or with an empty record, serves no site at
all.
