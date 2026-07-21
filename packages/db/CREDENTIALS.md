# Portal credential vault

Where ATS account credentials live, why they live there, and what protects
them.

## Why this exists

Some employers won't show an application form until the candidate has an
account — Workday and iCIMS most consistently. The apply agent can't get past
that without registering, and it can't register without somewhere to put the
resulting username and password.

## Where credentials are stored

In Postgres, in `portal_credentials`, with the password as `bytea` holding
AES-256-GCM ciphertext produced by `lib/encryption.ts` — the same envelope
encryption already used for resume URLs and `required_info_answers.value`.
The database never holds a key and never sees plaintext.

The original ask for this feature was a gitignored local file. That was
reconsidered for a reason worth writing down, because "gitignored" sounds
like a security property and isn't one:

- `.gitignore` prevents exactly one leak path: `git add`. It does nothing
  about Time Machine and other backup software, Spotlight indexing, cloud
  folder sync, a `tar` of the project directory, or any other process running
  as the same user.
- A file of plaintext passwords is readable by every process you run. The
  encrypted-column approach means an attacker needs both the database
  contents *and* `FIELD_ENCRYPTION_KEY`, which live in different places.
- The database was never in git to begin with, so the "won't be pushed to
  GitHub" requirement is satisfied more completely by this route than by the
  file — there is nothing in the working tree to accidentally commit.

What is gitignored, and must stay that way: `packages/db/.env` and
`apps/web/.env.local`, which hold `FIELD_ENCRYPTION_KEY`. The tracked
`.env.example` files contain a `REPLACE_WITH_...` placeholder, never a real
key. If a real key ever lands in one of those, it's in git history and the
key must be rotated, not just deleted.

## What protects a password, in order

1. **The allowlist** (`lib/policy/account-creation-allowlist.ts`) decides
   where an account may be created at all. See below.
2. **Encryption at rest** — AES-256-GCM, key from `FIELD_ENCRYPTION_KEY`,
   never in the database.
3. **No bulk read path.** `listCredentials` explicitly `select`s the columns
   it needs, which does not include the ciphertext. The list endpoint
   physically cannot leak a password because it never loads one.
4. **Re-authentication before any reveal.** A 6-digit code, emailed, valid 10
   minutes, unlocking a 5-minute window. Five wrong attempts kills the
   challenge.
5. **Audit on every decryption.** `revealCredential` writes a
   `credential_reveal_events` row in the same transaction as the read. There
   is no way to read a password without leaving a record.
6. **Reveal is one credential at a time**, by id. There is no bulk reveal
   endpoint, deliberately.

## Why an allowlist and not "is it HTTPS?"

This is the part most worth understanding, because the intuitive check is
wrong in a way that matters.

TLS authenticates the *connection*. A valid certificate proves you're talking
to whoever controls that hostname and that nobody in between is reading the
bytes. It proves nothing about whether that party is honest. Certificates are
free and issued in seconds through ACME, so a page that clones Workday's
login screen to harvest credentials has exactly the same green padlock the
real one does.

An agent that checked only for HTTPS would type a real password into that
page and record it as a success.

So HTTPS is treated as necessary and nowhere near sufficient: the hostname
must also match a vendor named in advance in `ALLOWED_ATS_VENDORS`.

The matching itself is easy to get wrong, and the two classic bugs are both
covered by tests:

| Naive check | Wrongly accepts | Why |
| --- | --- | --- |
| `hostname.includes("greenhouse.io")` | `greenhouse.io.evil.com` | real domain is `evil.com` |
| `hostname.endsWith("greenhouse.io")` | `evil-greenhouse.io` | registrable by anyone |

The implementation requires `hostname === domain || hostname.endsWith("." + domain)`
— the character before the suffix must be a literal dot.

Failure is asymmetric on purpose. A legitimate-but-unlisted ATS gets refused
and the agent asks you to handle it: annoying, and over in seconds. A
lookalike domain getting through means real credentials go to an attacker,
silently, with no recovery. The list stays short and the check stays strict.

Adding a vendor is a code change and a PR review — the same posture as
`JURISDICTION_POLICY` in `criminal-history-jurisdiction.ts`. There is
deliberately no env var or admin toggle that widens it, because that's the
kind of setting that gets loosened at 2am to unblock a run and never
tightened again.

## Why reveal needs a second factor when you're already logged in

The session cookie lasts 30 days (`apps/web/AUTH.md`). That's a reasonable
bar for reading your job feed and a poor one for reading every password you
own — at 30 days, an unattended laptop is enough.

Magic-link auth gives no account password to re-prompt for, so
re-authenticating means re-proving control of the email address. A 6-digit
code rather than a link, because the point is that you're at the browser
right now: a link opens a new tab and a new session, a code gets typed into
the page that's already open.

The code is salted with the user id before hashing (`sha256(userId:code)`).
Unlike the 32-byte tokens in `lib/auth.ts`, a 6-digit code has a small enough
space that two users holding the same code concurrently is a live birthday
collision against the `UNIQUE` constraint on `code_hash` — and an unsalted
hash of a 6-digit code is trivially reversible with a precomputed table.

## How the agent uses the vault

`apps/apply-agent-service/src/session/account-provisioner.ts` is the only
module in the service that creates an account or types a stored password into
a page. The automation loop calls it at the top of every pass, *before* field
extraction — so the field-matcher never sees a signup form's inputs and can
never route a decision at a password field.

The decision tree, in order:

1. **No password input on the page** → not an auth wall, carry on. A job
   description saying "sign in to apply" is not enough; a password field is
   necessary evidence.
2. **Host not on the allowlist** → yield to the human, type nothing. Note
   this refuses to *sign in* as well as to register: handing an existing
   password to a lookalike page is exactly the outcome the allowlist exists
   to prevent.
3. **Credential already in the vault for this registrable domain** → sign in
   with it. This is why `domain` is eTLD+1: one Workday account covers every
   `<employer>.myworkdayjobs.com` tenant, so a new employer is not a reason
   to create a second account.
4. **Login form, no saved credential** → yield. The user has an account we
   don't know about; registering here would create a duplicate.
5. **Signup form asking for more than email + password** → yield. Guessing at
   "Country" or a security question produces a real account with wrong data
   attached to it.
6. **Signup form, email + password only** → generate a password, save it to
   the vault, fill, submit.

Step 6 saves **before** submitting, deliberately. Reversed, a signup that
succeeded server-side but crashed the browser before the save would leave a
real account whose password exists nowhere — recoverable only by password
reset. Saving first means the worst case is a vault row for an account that
doesn't exist, which is inert and one click to delete.

### Why this doesn't violate never-auto-submit

The provisioner submits a form, which sits awkwardly next to an invariant
saying the agent never submits anything. The invariant is specifically about
*the job application* — the irreversible, human-visible act of applying on
someone's behalf. A signup form creates an account the user can delete and
puts nothing in front of an employer.

The separation is structural, not just documented:

- `submitAuthForm` only ever clicks a selector produced by `detectAuthWall`,
  which returns null unless the page has a password input. It takes no
  caller-supplied selector, so it can't be repointed at an application form's
  submit button.
- The provisioner holds a `SessionControl`, which has no submit method.
- `markSubmitted` only writes `SUBMITTED` over a row currently
  `READY_FOR_REVIEW`, and is imported by `apply-session.ts` alone.

### Passwords and the event stream

`SessionControl.recordAccountAction` takes an action, a hostname, and a
username — there is no parameter a password could be passed as. Same shape of
guarantee as `ApplicationLogEntry` having no column that could hold a raw
value.

Error messages from Playwright are passed through `messageOf(err, secret)`,
which scrubs the password before the text reaches a `yield_control` event.
Playwright quotes selectors rather than values, so this shouldn't be
reachable today — but "a third-party library's exception never contains the
string we just typed" is an assumption about someone else's code that would
break silently and in the worst direction.

## Known gaps

- **No email provider is configured**, here or in the login flow. The reveal
  code is logged to stdout in development and not at all in production, which
  means the reveal flow is not usable in production until a provider is
  wired. That's the intended failure mode — the alternative (logging the code
  in production) would let anyone with log access unlock the vault.
- **`EnvKeyProvider` is not a production key manager.** No rotation, no audit
  trail, key lives wherever the process env does. This was already true for
  resume URLs; the vault raises the stakes. Swapping in a KMS-backed
  `KeyProvider` is a one-line change at the call site by design.
- **Rotation is unimplemented.** Re-saving a credential overwrites the
  password, but there's no flow that rotates a password on the ATS itself.
- **Email verification links are not handled.** Many ATSs email a
  confirmation link before the account is usable. The agent registers and
  saves the credential, but cannot click that link -- so the first
  application on a new ATS will often still need a human step.
- **The auth-wall detector is heuristic.** It keys on a password input plus
  page text, and won't recognize a multi-step signup that asks for email on
  one screen and password on the next. It fails toward yielding rather than
  toward guessing.
- **`x-forwarded-for` on audit rows is a hint, not evidence.** It's spoofable
  unless a trusted proxy sets it. Nothing makes an access-control decision
  from it.

## Running the tests

```bash
npm test                 # from the repo root
npm run test --workspace=auto-job-applier-db
```

Covers the allowlist (including both suffix/prefix confusion attacks) and the
password generator. Uses `node:test`, no framework dependency — consistent
with how this repo hand-rolls AES-GCM and auth rather than adding packages.

## After pulling this change

The Prisma client needs regenerating and the migration applying:

```bash
cd packages/db
npx prisma generate
npx prisma migrate dev
```
