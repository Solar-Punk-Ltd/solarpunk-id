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

The link is kept in the account's synced settings, `settings.walletLink`, so
every device of the account has it ([Account-State.md](Account-State.md)).
Settings merge as one last-writer-wins value on `settingsAt`.

Turning it off removes the link from the settings, on a newer `settingsAt`,
so the removal reaches every device. From then on no site receives it. The
setting says plainly that messages already sent keep showing the name, since
a chat that carries the link carries it inside each message.

## What a site receives

While the setting is on, the proxy frame puts the link on the connection
identity, `identity.walletLink`, as `{ message, walletSignature,
accountSignature }`. It does so only when the link verifies for the account
the frame serves (`verifyWalletLink`), so a link another account signed never
reaches a site as this one's. While the setting is off, `identity.walletLink`
is absent and the site learns no wallet at all.

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
curve order. A wallet that answers v as 0 or 1, or in the 64-byte EIP-2098
form, is brought to this form before the link is stored.

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

`resolveVerifiedEnsName` then answers the wallet's ENS name only when both
directions agree:

1. The registry names a resolver for the wallet's reverse node,
   `<address>.addr.reverse`, and that resolver's `name` is not empty.
2. The name is already in its ENSIP-15 normalised form. A name that normalises
   to something else, upper case, a zero-width joiner, full-width letters, can
   look like a different name on screen, so it is refused rather than
   normalised.
3. The registry names a resolver for the name, and that resolver's `addr` is
   the wallet.

Anyone can point their own reverse record at any name, so the reverse record
alone proves nothing. Only the forward record, which the name's owner controls,
makes the name the wallet's.

It reads over an Ethereum mainnet JSON-RPC endpoint the caller names, never a
Swarm gateway. `timeoutMs` bounds the whole lookup and defaults to 10 seconds.
Every answer is capped in size before it is decoded. Everything that goes
wrong, no endpoint, an endpoint that is down or slow, an answer too long or that
does not decode, answers no name, never a throw. An answer, a name or a
definite no name, is kept in memory for ten minutes per endpoint and wallet, and
a failed read is not kept.

Only on-chain resolvers are read. A name whose resolver answers through
CCIP-read (EIP-3668) or only through a wildcard (ENSIP-10) reads as having no
name.

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
