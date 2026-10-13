# Hardening

What the identity site does to close the P2 and P3 findings of the 2026-10-14
security review. Each section says what changed, where it lives, and the
constant that tunes it.

## The pages refuse to run inside a frame (P2-3)

Served from Swarm through bzz.link, the site cannot send `X-Frame-Options` or a
`frame-ancestors` header, and a meta CSP cannot carry `frame-ancestors`. So any
site could frame the connect window and lay its own buttons over it.

Every page now checks on start that it is the top window. If it is not, the
root layout renders one line of text, with nothing a person can click, and
runs none of the page's logic. The one exception is `/proxy`, the hidden frame,
which exists to be framed.

- Code: `ui/src/lib/frame-guard.ts` (`refusesToRunFramed`), used by
  `ui/src/routes/+layout.svelte`.
- The framed route is `routes.PROXY` in `ui/src/lib/routes.ts`.
- Tests: `ui/src/lib/frame-guard.test.ts`, and the browser journey
  `ui/tests/framing.test.ts`.

## Every use of the connect window's site checks it first (P3-1)

The site arrives in the connect window's own link, written by whoever opened
it, and becomes the app secret's derivation label and the key its connection
is stored under. The connect store already refused a site that is not a clean
https origin (`isAcceptedSite`). Every other use now asks the same clean-origin
question itself, so a caller that skipped the window's gate still cannot derive
or store under such a site:

- `completeConnect` and `reuseConnection` (`ui/src/lib/connect-handshake.ts`)
  refuse before deriving the app secret or handing anything to the frame.
- `Account.connectApp` refuses to record the connection, and
  `Account.setAppStamp` does nothing for such a site
  (`ui/src/lib/stores/accounts.svelte.ts`).
- Code: `ui/src/lib/clean-site.ts` (`isCleanSite`, `requireCleanSite`).

## Keys are sealed at rest (P2-2)

Key material in `localStorage` is stored encrypted:

- in `swarm-id-accounts`, every account's `derivationKey`, every connected
  app's `appSecret` and every stamp's `signerKey`
- in `swarm-id-partition-session:<origin>`, the whole handed-over payload
  (`data`), which holds the app secret, the derivation key and the stamp's
  signer key. Whose session it is and when it ends stay readable.

A sealed value is AES-GCM under a wrapping key that WebCrypto created
non-extractable. The key is kept in IndexedDB in the same storage as the data
(database `swarm-id-keys`, store `wrapping-keys`, entry `at-rest-v1`), so a
partitioned frame has its own key beside its own data. It is created on first
use, with no prompt for the person. On disk a sealed value is `sealed:v1:`
followed by the hex of the 12-byte IV and the ciphertext
(`SEALED_VALUE_PREFIX`).

Reading opens the values into memory for the life of the page. A value that
cannot be opened, because the wrapping key is gone or the value was altered, is
absent and never read as plain text:

- an account whose keys cannot be opened reads as signed out, keeping its
  vault, so the person signs in again with their access method and the account
  is restored from Swarm (it has no `encryptedState` snapshot then)
- a partitioned session that cannot be opened is no session, and is removed
- a key found in plain text counts as one that cannot be opened

Without IndexedDB there is nowhere to keep the key beside the data, so it lasts
as long as the page and the next load reads as signed out.

Writes to the accounts document now wait for sealing, so they are queued per
key in the window, in call order, and a read-modify-write runs in its own turn
(`VersionedStorageManager.update`). The identity UI renders no page until the
stored accounts are read with their keys open (`accountsLoaded`).

- Code: `lib/src/utils/sealed-values.ts`, the account fields in
  `lib/src/utils/storage-managers.ts` (`accountKeySealing`), the queue and
  hooks in `lib/src/utils/versioned-storage.ts`, the partitioned session in
  `lib/src/swarm-id-proxy.ts` (`savePartitionSession`, `readPartitionSession`).
- What this does not stop: script running on the identity origin can use the
  wrapping key. It keeps the plain keys out of the files a profile is stored
  in, out of storage dumps and out of backups of the browser profile.

## A restored session checks it was not ended before its first write, and a session lasts 7 days (P2-6)

A session the frame restores from storage, from shared storage or from a
partition's own saved session, now asks the account's published state whether
this site was removed or disconnected while no page of it was open. Reads
start at once. Writes, and the frame's own eager lease claim, wait for the
answer:

- not ended: writes go ahead
- ended: the session ends and the waiting writes are refused
- the answer could not be read (no network, a gateway that did not answer):
  writes stay refused with the reason `session-unconfirmed`, and the next write
  asks again. An outage never lets a revoked session write.

An account that has never published anything (it has no drive) cannot have
published a revoke either. The check confirms that its roster is empty, as an
answer rather than as a failed read, and allows the session.

A session the person connects in this load writes without the check.

- Code: `lib/src/sync/session-check.ts` (`checkRestoredSession`), and
  `startRestoredSessionCheck` and `ensureCanWrite` in
  `lib/src/swarm-id-proxy.ts`.
- `DEFAULT_SESSION_DURATION` in `lib/src/utils/constants.ts` is now 7 days
  (was 30). An account's own setting still overrides it.

## Apps no longer receive the device id (P2-4)

The frame's device id is how the lease and the device roster identify this
device. It was sent to every embedding page in `connectionInfoChanged`, which
gave each site a stable identifier for the browser. It now stays inside the
frame. `ConnectionInfo` has no `deviceId`, and the demo's Safari check no
longer compares it across reloads.

## A backup prompt for Safari's 7-day storage limit (P2-7)

Safari deletes everything a site's scripts stored after 7 days in which the
person did not use the site, and the account on this device goes with it.
After an account is created or imported on this device, a Safari visitor is
asked once to save their Secret Recovery Phrase or export a backup file, through
the Account tab's existing sections. Every browser on iPhone and iPad runs
Safari's engine, so they are asked too.

- Code: `ui/src/lib/backup-prompt.ts` and
  `ui/src/lib/components/safari-backup-prompt.svelte`, rendered by the root
  layout. The account is marked when it is set up, in
  `ui/src/routes/account/new/access/+page.svelte`.
- The answer is kept per account under `swarm-id-backup-prompt:<accountId>`
  (`BACKUP_PROMPT_KEY_PREFIX`), `due` once the account is set up here and
  `shown` once the prompt was answered.
