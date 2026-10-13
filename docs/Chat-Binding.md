# Chat binding

A site that embeds Swarm ID gets its own key for each account, the app secret
(`deriveSecret(masterKey, origin)`). Its address is what the site's chat signs
messages with. Nothing in that key says which Swarm ID account it belongs to, and
that is on purpose: two sites cannot link one person by comparing keys.

When a person wants their chat on a site to be recognisably theirs, the account
says so in a signed statement, the chat binding: "this chat address on this site
is mine". The site publishes it beside its chat. A reader recovers the signer
and compares it with the account's address.

## Who signs, and where

The binding is signed by the account's own key: the private key of the account's
BIP-39 seed, whose address is the account's `id` (`identity.address` in
`ConnectionInfo`). This is the same for every access method. A passkey, a
wallet or a password only protects that seed on the device, so a wallet-secured
account is still signed for by its seed key, not by the wallet.

It is signed only in the connect window (`ui/src/routes/connect/`), the one
place the seed is unlocked, by `completeConnect` in
`ui/src/lib/connect-handshake.ts`. The proxy frame never holds the account key
and never signs one. `createChatBinding` is the only thing the account key signs
through this code, and it takes no text: it is given a site, and derives the
chat address for that site itself.

Before the person picks an account, the window says that connecting publicly
links their account to their chat on that site, and names the site.

## The site

The site is the `origin` in the window's link (`#origin=`). The window accepts
it only when it is a clean https origin in the exact form a browser reports
one: a host and an optional port, no path, query, fragment or user info, lower
case, punycode, no default port (`isCleanSiteOrigin`). A development build also
accepts `http://localhost`, `http://127.0.0.1` and `http://[::1]`. Any other
link shows a refusal and no account is offered. `ui/src/lib/accepted-site.ts`
is the one function that decides this.

## The format

The message is plain UTF-8 text of exactly four lines, joined by a single `\n`,
with no trailing newline:

```
Swarm ID chat binding v1
Site: https://viewer.example.com
Chat address: 0x<40 lower-case hex characters>
Date: 2026-10-14T12:00:00.000Z
```

- The first line names the format and its version. Any other first line is a
  different statement and is refused.
- `Site` is the site origin as above.
- `Chat address` is the address of that site's app secret, `0x` and lower case.
- `Date` is when it was signed, ISO 8601 in UTC with milliseconds, exactly as
  `Date.prototype.toISOString` writes it.

It is signed with EIP-191 `personal_sign`: the signature is over
`keccak256("\x19Ethereum Signed Message:\n" + byteLength + message)`, never over
raw bytes or a bare hash. The signature is `0x` and 65 bytes, r, s and v, with v
27 or 28 and s in the lower half of the curve order.

What travels is the pair `{ message, signature }`.

## Verifying it

`@snaha/swarm-id` exports the reader's side:

```typescript
import { acceptedChatBinding, verifyChatBinding } from '@snaha/swarm-id'

// The fields and the recovered signer, or a throw for any other shape:
// another first line, a missing or extra line, a site with a path, an
// address in another spelling, a date in another form, a bad signature.
const { signer, site, chatAddress, date } = verifyChatBinding(binding)

// Or check it names what you expect, getting undefined otherwise.
const ok = acceptedChatBinding(binding, {
  site: 'https://viewer.example.com',
  chatAddress: messageAuthor,
  signer: accountAddress,
})
```

A valid signature over a changed message still recovers some address, so a
reader always compares `signer` with the account it expects, and `site` with
the site it is reading. Any Ethereum library's `recoverMessageAddress` (viem) or
`verifyMessage` (ethers) recovers the same signer from the same pair.

## Newest wins

There is one binding per site per account. The window keeps it on that site's
connection (`connectedApps[].chatBinding`) and reuses it on every reconnect, so
a person is not asked again. A revoke or a disconnect leaves it, because it stays
true for as long as the account and the site do. When the window signs a new one
for the same site, with a new date, it replaces the old.

A reader that sees several bindings for the same site and the same account
trusts the one with the newest `Date`, and ignores the rest.

The binding is public and is the same on every device of the account, so it
syncs with the connection, unlike the app secret.

## How it reaches the site

Only through the handover the connect window already makes: the `setSecret`
message to the proxy frame that opened it, which the frame checks against its
own challenge and its parent origin. The binding rides in that message's data
beside the secret. The frame passes it on only when it names exactly the parent
origin, the address of the secret it came with and the account it came with. It
keeps it with the session it saves, so a reload brings it back, and drops it on
disconnect.

The dApp reads it as `client.connectionInfo.chatBinding`, and
`onConnectionChange` fires when it arrives or changes.

A session the frame reads out of shared storage, where the site and the identity
site are the same site, gets no handover and so reports no binding.
