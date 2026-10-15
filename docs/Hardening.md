# Hardening

What the identity site does to keep its pages, its stored keys and its
sessions safe. Each section says why, what changed, where it lives, and the
constant that tunes it.

## The pages refuse to run inside a frame

Served from Swarm through bzz.link, the site cannot send `X-Frame-Options` or a
`frame-ancestors` header, and a meta CSP cannot carry `frame-ancestors`. So any
site could frame the connect window and lay its own buttons over it.

Every page now checks on start that it is the top window. If it is not, the
root layout renders one line of text, with nothing a person can click, and
runs none of the page's logic. The one exception is `/proxy`, the hidden frame,
which exists to be framed. The answer is worked out again on every navigation,
so a framed `/proxy` that moves to another page inside the frame is refused
there too, and the account sync, the account bus and the fold timer the layout
started for `/proxy` stop at that moment. A framed page also gets none of the layout's prompts, such as the
Safari backup prompt, because those navigate to the account pages.

- Code: `ui/src/lib/frame-guard.ts` (`layoutView`, `refusesToRunFramed`) and
  `ui/src/lib/while-allowed.ts`, used by `ui/src/routes/+layout.svelte`.
- The framed route is `routes.PROXY` in `ui/src/lib/routes.ts`.
- Tests: `ui/src/lib/frame-guard.test.ts`, `ui/src/lib/while-allowed.test.ts`,
  and the browser journey
  `ui/tests/framing.test.ts`.

## Every use of the connect window's site checks it first

The site arrives in the connect window's own link, written by whoever opened
it, and becomes the app secret's derivation label and the key its connection
is stored under. The connect store already refused a site that is not a clean
https origin (`siteAllowList`). Every other use now asks the same clean-origin
question itself, so a caller that skipped the window's gate still cannot derive
or store under such a site:

- `completeConnect`, `reuseConnection` and `handOverPickedStamp`
  (`ui/src/lib/connect-handshake.ts`) refuse before deriving the app secret or
  handing anything to the frame.
- `Account.connectApp` refuses to record the connection, and
  `Account.setAppStamp` does nothing for such a site
  (`ui/src/lib/stores/accounts.svelte.ts`).
- Code: `ui/src/lib/accepted-site.ts` (`isCleanSite`, `requireCleanSite`).

## A site's stamp is picked by the person, in Swarm ID's own window

The connect window asks which drive a site uses on every connect. What it
starts on is read from the account's own record for that site, and nothing in
the window's link or from the site can name a drive, preselect one or skip
the question.

Signing in gives the site no stamp. Every connect, first or not, marks the
site's entry `stampPending`, and the handover that signs a frame kept apart in
says `stampPending` and carries no stamp at all, signer key included. While it
is set the frame resolves no stamp, whatever the entry's pointer or an account
delta says. It is this device's session material, like the app secret: no
channel to another context carries it, and a fold keeps this context's own.
The person's choice in the record is never touched by it. Nothing else ends the
wait, a drive picked on the Apps screen included: that pick is saved, the next
connect window starts on it, and the site uses it once the person confirms
there. "Go to app" on the done screen is the confirm: one write saves a changed pick and ends the wait,
and is stored before the window closes, so a frame that reads the shared store
picks the drive up from it. A frame kept apart is handed the confirmed drive a
second time through the same opener path as the session itself. It takes that
second handover only under the challenge of the window that handed the session
over, for its own parent and with the secret it already holds, and a newer
window or the end of the session retires that challenge. It carries the same
narrowed account view as any handover, so the site learns the batch id and
nothing more. Closing the window without the confirm leaves the site signed in
with no stamp, across a reload too, since the stored session keeps the wait.

The confirm reaches a frame kept apart only while the frame that opened the
window is still there. A site that reloaded, navigated or opened another window
since gets nothing and has no stamp until it connects again. The window says so
when it can see the frame is gone (`handOverPickedStamp` answers
`not-reached`). A frame that reloaded in place keeps no challenge, drops the
message, and the window cannot tell.

- Code: `ui/src/routes/connect/done/+page.svelte`, `handOverPickedStamp` in
  `ui/src/lib/connect-handshake.ts`, `Account.confirmAppStamp`,
  `isStampHandover` and `lookupPostageStampForApp` in
  `lib/src/swarm-id-proxy.ts`, `stampsReachableByApp`.
- Tests: `ui/src/lib/connect-handshake.test.ts`,
  `lib/src/swarm-id-proxy-partition.test.ts` ("a stamp withheld until the
  person confirms it", "a stamp picked in the connect window after the
  handover") and the browser journeys `ui/tests/connect-drive-picker.test.ts`
  and `ui/tests/connect-drive-picker-shared.test.ts`.

## Keys are sealed at rest

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

A failure to read the wrapping key at all, because IndexedDB returned an
error, is not the same as a key that is gone. The account then reads as
signed out for that page only: its stored record is left exactly as it is,
no write in that page replaces it with the signed-out copy, and a later load
that can read IndexedDB opens the keys again (`isSealedValueUnavailable`). A
partitioned session in that state is no session for that page only, and its
stored record is kept for a later load to open.

Without IndexedDB there is nowhere to keep the key beside the data, so it
lasts as long as the page and the next load reads as signed out. Where the
browser has IndexedDB turned off (`indexedDB` is null) or it cannot be opened,
including an open that is blocked or takes longer than ten seconds
(`KEY_DB_OPEN_TIMEOUT_MS`), the page does the same for what it writes, and
what was stored before is unavailable rather than lost, as above, so a later
load that can open IndexedDB still reads it. Signing in to such an account on
that page would write keys sealed with the page's own key over the stored
ones, so that write fails and the person sees the toast below.

A write to the accounts document that still fails, because sealing or
`localStorage` refused it, rejects instead of only being logged, and the
identity UI shows a toast saying the change could not be saved on this device
(`ACCOUNT_SAVE_FAILED_TEXT` in `ui/src/lib/stores/accounts.svelte.ts`).

Writes to the accounts document now wait for sealing, so they are queued per
key in the window, in call order, and a read-modify-write runs in its own turn
(`VersionedStorageManager.update`). Each turn also holds a Web Lock named
`swarm-id-storage-write-<key>`, so the identity tab and a frame of the same
origin cannot interleave a read and a write and lose one window's change, such
as a disconnect. Where the Web Locks API is missing or refuses the lock
request, only the window's own queue orders the writes. The identity UI
renders no page until the stored accounts are read with their keys open
(`accountsLoaded`).

- Code: `lib/src/utils/sealed-values.ts`, the account fields in
  `lib/src/utils/storage-managers.ts` (`accountKeySealing`), the queue and
  hooks in `lib/src/utils/versioned-storage.ts`, the partitioned session in
  `lib/src/swarm-id-proxy.ts` (`savePartitionSession`, `readPartitionSession`).
- What this does not stop: script running on the identity origin can use the
  wrapping key. It keeps the plain keys out of the files a profile is stored
  in, out of storage dumps and out of backups of the browser profile.

## A restored session checks it was not ended before its first write, and a session lasts 7 days

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

## Apps no longer receive the device id

The frame's device id is how the lease and the device roster identify this
device. It was sent to every embedding page in `connectionInfoChanged`, which
gave each site a stable identifier for the browser. It now stays inside the
frame. `ConnectionInfo` has no `deviceId`, and the demo's Safari check no
longer compares it across reloads.

## A backup prompt for Safari's storage limit

Safari deletes everything a site's scripts stored after a stretch of Safari use
in which the person did not use the site, and the account on this device goes
with it. WebKit's published rule is seven days
([webkit.org, 2020-03-24](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)).
A WebKit source change of 2024-02-09
([`4506123`](https://github.com/WebKit/WebKit/commit/45061230013728ec9c4900b01b12af26dc592b4b))
added a 30-day tier for sites never reached through cross-site link decoration,
and its own message says it does not change current behaviour. No device run in
this repository has measured which applies
([#659](https://github.com/snaha/swarm-id/issues/659)). The prompt's text says
seven days, the shorter of the two.
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
