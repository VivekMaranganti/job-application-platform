# `lib/policy` — legal-adjacent gates

This directory holds technical guardrails for product behavior that touches
areas of real legal risk. It exists so those guardrails have one obvious,
auditable home, separate from ordinary product logic.

It lives in `packages/db` (not `apps/web`) because it has two real
consumers on different sides of the monorepo — `apps/web` (save-time gate)
and `apps/apply-agent-service` (per-application defense-in-depth check) —
and neither app depends on the other. `packages/db` is the one place both
already import from.

## `criminal-history-jurisdiction.ts` (issue #7)

### This is not a legal opinion

Issue #7 asks a real legal question: do "ban-the-box" / fair-chance-hiring
laws permit an automated agent to answer a criminal-history question on a
candidate's behalf, and if so, where? That question has a real, jurisdiction-
by-jurisdiction answer, and answering it requires an actual lawyer with
actual authority to sign off — not a coding agent, and not an engineer's best
guess at what a given state's law says.

**Nothing in this module should be read as encoding real ban-the-box law.**
It deliberately encodes *no* jurisdiction-specific legal research at all. Its
only job is: default everything to the safe answer ("no, not allowed"), and
make it easy — but not casual — for a human with real legal sign-off to flip
that default for one jurisdiction at a time.

If you are looking at this file wondering "does state X allow this?" — this
file will not tell you. Ask legal.

### What's here today

- `JURISDICTION_POLICY`: a `Record<string, boolean>` map, intentionally
  empty. No jurisdiction is marked `true`. A jurisdiction absent from the map
  is treated exactly like one present with `false` — "not reviewed" and
  "reviewed and disallowed" are indistinguishable on purpose, because from
  this codebase's point of view they require the same thing (a legal review)
  before auto mode is enabled.
- `isCriminalHistoryAutoModeAllowed(jurisdiction)`: reads that map. Returns
  `true` only for a jurisdiction explicitly marked `true`. Returns `false`
  for everything else, including `null`/unknown jurisdiction. As of this
  writing, this always returns `false` for every input, because the map is
  empty. Called by **both** consumers below.
- `resolveRequiredInfoModeForSave(fieldId, requestedMode)`: the save-time
  gate wired into
  [`apps/web/lib/repository/postgres.ts`](../../../../apps/web/lib/repository/postgres.ts)'s
  `saveRequiredInfoAnswer`. For `field_id = "criminal_history"`, a requested
  `mode: "auto"` is unconditionally downgraded to `"manual"` before it's
  persisted. Every other field passes through unchanged.

### Both consumers, and why there are two

1. **`apps/web`'s `saveRequiredInfoAnswer`** — the primary gate. Calls
   `resolveRequiredInfoModeForSave` so `RequiredInfoAnswer.mode` can never be
   persisted as `auto` for `criminal_history`, full stop, regardless of what
   `JURISDICTION_POLICY` says. See "The design wrinkle" below for why this
   exists even though the map is empty.
2. **`apps/apply-agent-service`'s `field-matcher.ts`** (`decideRequiredInfoField`)
   — defense-in-depth. Before treating a `criminal_history` field as
   auto-fillable, it calls `isCriminalHistoryAutoModeAllowed(job.jurisdiction)`
   (jurisdiction parsed from `JobListing.location`) in addition to checking
   `answer.mode === "manual"`. Today this check is redundant in the happy
   path — gate 1 already means `answer.mode` should never be `"auto"` for
   this field — but it protects against a raw DB write, a migration script,
   or a future code change that bypasses gate 1, without requiring the
   apply-agent to trust that gate 1 was applied correctly upstream.

### Enabling a jurisdiction (once real legal sign-off exists)

1. Get an actual legal review of that specific jurisdiction's ban-the-box /
   fair-chance-hiring rules, covering this product's actual behavior (an
   agent giving the same criminal-history answer on every application, with
   no per-posting human review) — not a general summary of the law.
2. Open a PR that adds exactly one entry to `JURISDICTION_POLICY` in
   `criminal-history-jurisdiction.ts`, e.g. `"ny": true` or
   `"philadelphia,pa": true`. Link the legal review in the PR description.
3. Get that PR reviewed and approved by a human before merging. This is
   deliberately a code change requiring review, not a runtime toggle, admin
   setting, or environment variable — enabling auto mode for a jurisdiction
   should be exactly as deliberate and visible as any other change with
   legal consequences, and should leave a paper trail (the PR, the linked
   review) that survives independently of whoever made the change.
4. Do not remove the global downgrade in `resolveRequiredInfoModeForSave`
   without first reading "The design wrinkle" below — enabling a
   jurisdiction in the policy map does **not**, by itself, make it safe to
   let `RequiredInfoAnswer.mode = auto` for `criminal_history` again, because
   that field still isn't jurisdiction-aware. See below.

### The design wrinkle: a global field vs. a per-job legal question

`RequiredInfoAnswer` (`apps/web/lib/types.ts`, `packages/db/prisma/schema.prisma`)
is one row per `(user, field_id)` — a single, global setting. It has no idea
which job or jurisdiction it will ultimately be used for. But ban-the-box
legality is a per-*job* question: it depends on where the employer/posting
is, which varies application to application, not on anything about the user.

That's a real mismatch, and there were two ways to resolve it:

**Option A — block globally at save time (chosen).** Treat
`RequiredInfoAnswer.mode = auto` for `criminal_history` as never legally
sound to store, full stop, until the data model grows a per-application
override of this field. `saveRequiredInfoAnswer` unconditionally downgrades
`auto` to `manual` for this field, regardless of what
`JURISDICTION_POLICY` says. `isCriminalHistoryAutoModeAllowed` still exists
and is exported (see below), but nothing in `apps/web` currently trusts it
to be the only thing standing between a user and an auto-answered
criminal-history question.

**Option B — defer entirely to a per-application check.** Let
`RequiredInfoAnswer.mode = auto` be saved and honored as-is; require the
apply-agent to call `isCriminalHistoryAutoModeAllowed(job.jurisdiction)`
before every auto-fill of this field, and manually re-prompt when it returns
`false`.

**Why A and not B:** B makes the entire safety property depend on every
future consumer remembering to call the check, correctly, every time, before
this field is used for anything — today that's one apply-agent, but the
surface only grows (exports, admin tooling, a future "preview my answers"
feature, a bug that reorders a check after a fill instead of before). A
missed call anywhere in that surface silently reintroduces exactly the harm
this issue exists to prevent, and — because `JURISDICTION_POLICY` starts
empty — B would also be currently indistinguishable from "fully enforced" in
testing, since every check trivially returns `false` today; the gap only
shows up once someone populates the map and simultaneously forgets a call
site. A fails safe at the one place this data is written, independent of how
many future consumers exist or whether they remember to ask.

The tradeoff: A means `criminal_history` cannot be `auto` in this product
*at all* right now, even in principle, even for a hypothetically-cleared
jurisdiction — which is more restrictive than the legal question actually
requires (a cleared jurisdiction should, in principle, be able to use auto
mode for jobs there). That's the deliberate cost of defaulting conservative:
until `RequiredInfoAnswer` (or its successor) can express "auto, but only for
jurisdiction X," there's no honest way to store "auto" for this field at all,
so we don't let the product store it.

**What this means for the apply-agent:** `resolveRequiredInfoModeForSave`
means you should never actually see `mode = "auto"` for `criminal_history`
coming back from the repository today. `field-matcher.ts` calls
`isCriminalHistoryAutoModeAllowed(job.jurisdiction)` anyway before treating
this field as auto-fillable, as defense-in-depth against: a raw DB write or
migration script that bypasses `saveRequiredInfoAnswer`, a future change to
the global gate above, or a future per-application override of this field
that intentionally reintroduces `auto` for this field once real legal
sign-off exists. It never falls back to auto-filling this field from a stale
or cached answer if the check returns `false` — it yields to the human
instead, the same way `mode = "manual"` does for every other field.

**Follow-up for a future issue:** if the product wants real per-jurisdiction
auto mode for `criminal_history` (not just "always manual"), the data model
needs a per-application (or per-job) override of this field's mode, keyed to
the job's actual jurisdiction — not just the current global
`(user, field_id)` row. That's out of scope here; this scaffold is built so
that work has a policy function to call once it exists, not to build it.

### Jurisdiction parsing from `JobListing.location`

`JobListing.location` is a free-text string from whatever ATS connector
produced the listing (e.g. `"New York, NY"`, `"Remote"`, `"San Francisco Bay
Area"`) — there's no structured state/city column. `parseJurisdiction`
(`lib/policy/jurisdiction.ts`, exported from this package's index alongside
the gate itself) turns that into a best-effort `{ state?, city? }` before
either consumer calls `isCriminalHistoryAutoModeAllowed`. It lives here
rather than in one app's tree for the same reason the gate does — both
`apps/web` (the apply-context endpoint) and `apps/apply-agent-service`
(`field-matcher.ts`) need it.
This parse is deliberately conservative: if it can't confidently extract a US
state abbreviation, it passes `undefined`/`{}` through, which
`isCriminalHistoryAutoModeAllowed` already treats as "not allowed" (see its
`if (!jurisdiction) return false` and the fact that `JURISDICTION_POLICY` is
empty regardless). A failed parse can never accidentally *allow* auto mode —
only ever fail closed.
