# Wallet link

A site that embeds Swarm ID learns the account's own address,
`identity.address` in `ConnectionInfo`, and never the wallet an account is
secured with. That is on purpose: a wallet address ties a person to everything
the wallet ever did on chain. Some people want the opposite on a site they
chat on. They want readers to see their ENS name, such as `name.eth`, beside
their messages.

The wallet link is how they say so. It is one statement, signed by both the
wallet and the account's own key: "this Swarm ID account and this wallet
belong to the same person". A site receives it only while the person has
"Show my ENS name on sites" on. A reader checks both signatures and then looks
up the wallet's ENS name itself.

## The setting

"Show my ENS name on sites" is in the identity site's Account tab, in the
Identity section. It is off by default, and only an account secured with an
Ethereum wallet on this device can turn it on. A device where the same account
is secured another way shows the setting only while it is on, so it can be
turned off there too.

Turning it on asks the wallet for two signatures, on one connection
(`ui/src/lib/crypto/wallet-link.ts`). The first is the usual unlock, which
decrypts the account's seed. A different wallet cannot decrypt it and is
never asked for the second. The second is the wallet link itself, with
EIP-191 `personal_sign`. The account's own key, from the seed just unlocked,
then countersigns the same message (`countersignWalletLink`), and the seed is
zeroed.

A wallet whose `personal_sign` signature does not recover its own address
cannot turn it on. That is how a smart-contract wallet (ERC-1271) signs, and
sign-in refuses those already. The person is told so in plain words, and
nothing is stored.

The link is kept in the account's synced state as `walletLink`, so every
device of the account has it ([Account-State.md](Account-State.md)). It has a
last-writer-wins clock of its own, `walletLinkAt`, apart from the other
settings and their `settingsAt`. Were it one of the settings, a device that
had not yet seen the link turned off would bring it back with any later
settings edit of its own, such as a new session length.

Turning it off removes the link on a newer `walletLinkAt`, so the removal
reaches every device, and only a newer turn-on can undo it. From then on no site receives it. The
setting says plainly that messages already sent keep showing the name, since
a chat that carries the link carries it inside each message.

## What a site receives

While the setting is on, the proxy frame puts the link on the connection
identity, `identity.walletLink`, as `{ message, walletSignature,
accountSignature }`. It does so only when the link verifies for the account
the frame serves (`verifyWalletLink`), so a link another account signed never
reaches a site as this one's. While the setting is off, `identity.walletLink`
is absent and the site learns no wallet at all.

A site that is signed in hears of a change at once. Turning the setting off
or on in Swarm ID reaches every open frame of the account, over the account
bus for a frame in its own storage partition and through a storage event for
one that shares Swarm ID's storage ([Account-Bus.md](Account-Bus.md)). The
frame folds it in on the link's own clock and sends the site a
`connectionInfoChanged` whose `identity.walletLink` is gone or new. A site
that puts the link in what it publishes reads it from the latest
`ConnectionInfo`, never from the one it had at sign-in.

A partitioned frame keeps what it folded across the site's reloads. The bus
keeps no mailbox, though, so a change made while no page of the site was open
reaches its frame only through what the account published. On its next load
the frame reads the link the account published, beside its check for a
session ended while it was closed, and takes it when its clock is newer
(`readPublishedWalletLink`). An account that has never published, because it
has no drive to pay for it, has nothing to read there. A page of Swarm ID that
is open answers every context joining the account's room with the account as
it stands, so a frame loaded while one is open, a site reloaded right after the
change included, takes the link from that answer. With no page of Swarm ID
open, such an account's frame learns the change at the next sign-in.

So a restored frame holds its saved link back until something confirms it: the
account's published state, read on load, an answer from an open page of Swarm
ID, or a new sign-in. Until then the site's identity carries no link, because
the frame cannot tell a saved link from one the person withdrew while the site
was closed, and a message published with a withdrawn wallet cannot be taken
back. The cost is the other way round: an account with no drive and the setting
on shows no ENS name after a reload until Swarm ID is opened or the person
signs in again.

Every connected site receives the same link. It names no site, unlike a chat
binding ([Chat-Binding.md](Chat-Binding.md)), because what it says is true of
the account on every site.

## The format

The message is plain UTF-8 text of exactly five lines, joined by a single
`\n`, with no trailing newline:

```
Swarm ID wallet link v1
I link this wallet to the Swarm ID account below, so sites may show my ENS name beside its messages.
Account: 0x<40 lower-case hex characters>
Wallet: 0x<40 lower-case hex characters>
Date: 2026-10-15T12:00:00.000Z
```

- The first line names the format and its version. Any other first line is a
  different statement and is refused.
- The second line says in plain words what the person agrees to, and is read
  exactly, byte for byte. A wallet shows the person the text it signs and
  nothing else, so this sentence is what tells them that signing links their
  wallet to an account. Without it a hostile site could ask a wallet to sign a
  link that names the site owner's account, in a prompt that looks like an
  ordinary sign-in, and then post as that wallet's ENS name. With it, the
  person reads what the signature does before giving it.
- `Account` is the account's address, its `id`: the address of the account's
  own key, the private key of its BIP-39 seed. `0x` and lower case.
- `Wallet` is the wallet's address, `0x` and lower case, never in its EIP-55
  checksummed spelling.
- `Date` is when it was signed, ISO 8601 in UTC with milliseconds, exactly as
  `Date.prototype.toISOString` writes it. It is the signer's own claim.

Both signatures are EIP-191 `personal_sign` over the same message: over
`keccak256("\x19Ethereum Signed Message:\n" + byteLength + message)`. Each is
`0x` and 65 bytes, r, s and v, with v 27 or 28 and s in the lower half of the
curve order. A wallet that answers v as 0 or 1, in the 64-byte EIP-2098
form, or with s in the upper half, is brought to this form before the link is
stored. The upper-half s is replaced by the curve order minus s, with v
flipped, which signs for the same address.

What travels is `{ message, walletSignature, accountSignature }`. This page is
the canonical description of the format. A chat library that carries the link
in its messages keeps the bytes identical to it.

## The reader's checks

`@solarpunkltd/swarm-id` exports both halves of the reader's side.

```typescript
import { resolveVerifiedEnsName, verifyWalletLink } from '@solarpunkltd/swarm-id'

// The fields, or undefined for anything that does not pass.
const linked = verifyWalletLink(link, { account: messageAccount })

if (linked) {
  // The name, or undefined. Never throws.
  const name = await resolveVerifiedEnsName(linked.wallet, {
    rpcUrl: 'https://ethereum-rpc.example',
    timeoutMs: 5000,
  })
}
```

`verifyWalletLink` accepts a link only when all of these hold:

1. The message has exactly the shape above. Another first line, another
   statement, a missing or extra line, a trailing newline, CRLF line ends, an address in another
   spelling and a date in another form are all refused.
2. The wallet signature recovers the wallet the message names.
3. The account signature recovers the account the message names.
4. That account is the one the reader expects, compared in any case and with or
   without `0x`. For a chat message that is the account its chat binding names.

A valid signature over a changed message still recovers some address, which is
why both recovered addresses are compared with what the message names, and the
account with what the reader expects. Any Ethereum library's
`recoverMessageAddress` (viem) or `verifyMessage` (ethers) recovers the same
two addresses from the same message.

`resolveVerifiedEnsName` then asks ENS's Universal Resolver for the wallet's
primary name, through viem's `getEnsName`, and answers it only when all of
these hold:

1. The wallet's reverse record names a name. The Universal Resolver reads it
   from the wallet's reverse node, `<address>.addr.reverse`.
2. That name's address record names the wallet back. The Universal Resolver
   checks this itself and refuses a name whose address record names another
   wallet.
3. The name is already in its ENSIP-15 normalised form. A name that normalises
   to something else, upper case, a zero-width joiner, full-width letters, can
   look like a different name on screen, so it is refused rather than
   normalised.

Anyone can point their own reverse record at any name, so the reverse record
alone proves nothing. Only the address record, which the name's owner
controls, makes the name the wallet's.

Names whose records live off chain are read too. A resolver that answers
through CCIP-read (EIP-3668), a wildcard (ENSIP-10) or a chain-specific
reverse record (ENSIP-19) is followed the way ENS itself follows it. For such
a name the resolver's own gateway sees the lookup, from the reader's IP
address, beside the endpoint below.

It reads over an Ethereum mainnet JSON-RPC endpoint the caller names, never a
Swarm gateway. That endpoint is trusted with two things. It decides which name
is shown: nothing checks its answers against the chain, so an endpoint that
lies can show any name it likes beside any wallet, or hide a real one. And it
sees every wallet looked up, which for a chat page is every sender with a
link, each asked from the reader's own IP address. A deployment therefore
names an endpoint it trusts with both, such as its own node or a provider it
has chosen for that. `timeoutMs` bounds the whole lookup and defaults to 10
seconds. A failed request is not retried. Everything that goes wrong, no
endpoint, an endpoint that is down or slow, an answer that does not decode, a
name's offchain gateway that fails, answers no name, never a throw. An answer,
a name or a definite no name, is kept in memory for ten minutes per endpoint
and wallet. A failed read answers no name for 30 seconds before the endpoint
is asked again, so a page that renders many messages does not query a broken
endpoint for each one. A definite no name is a wallet with no reverse record
or an empty one, a name whose address record names another wallet, and a
resolver that is not a contract or cannot answer a name. Any other refusal,
such as a resolver that reverts or an offchain gateway that fails, is a failed
read.

## What it does not do

- It never proves when it was signed. `Date` orders two links of one account,
  nothing more.
- It is not withdrawn by turning the setting off. A link already published, in
  a chat message for instance, stays valid, because it stays true. Turning it
  off stops Swarm ID handing it to sites from then on.
- It names the wallet that secured the account when it was signed. Changing
  the access method later leaves the link as it is, and it still verifies,
  because both keys still signed it. Turning the setting off and on again
  signs a fresh one with the wallet the account is secured with then.
