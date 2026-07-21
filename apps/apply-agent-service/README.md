# apply-agent-service

Live browser-orchestration service for the apply agent (GitHub issue #4).
Runs one Playwright session per in-progress `Application`, lets a human
reviewer watch and take over live, and writes a private structured event
log (`ApplicationLogEntry` rows, via `packages/db`) as it fills each field.
It **never auto-submits** -- see "Never-auto-submit invariant" below.

This is a new workspace app (`apps/apply-agent-service`, picked up by root
`package.json`'s existing `apps/*` workspace glob -- no change needed
there) rather than code inside `apps/web`: it's a long-running,
stateful, browser-driving process with its own lifecycle, not a Next.js
route handler.

## Architecture

```
apps/apply-agent-service/src/
  config.ts                  process config (port, confidence threshold, model, provider mode)
  index.ts / server.ts       HTTP (POST /sessions, GET /health) + WS upgrade routing
  protocol/events.ts         control-channel event/command types (both directions)
  control/ws-handler.ts      wires a WebSocket to a session's event stream / video stream
  session/
    types.ts                 SessionControl / HumanReviewActions -- the never-auto-submit split
    account-provisioner.ts   registration walls: allowlist check, reuse-or-create, save to vault
    apply-session.ts          one instance per Application: browser + state + control
    automation-loop.ts        extract -> match -> fill -> yield, one pass at a time
    session-manager.ts        in-memory registry keyed by applicationId
  browser/
    browser-provider.ts       self-hosted (default) vs. managed browser automation seam
    screencast.ts             CDP screencast -> WebSocket, NEVER touches disk/blob storage
    dom-extraction.ts         scrapes fillable fields + CAPTCHA detection off the page
    field-actions.ts          applies a decided value to a page field (fill/select/check/upload)
  agent/
    llm-client.ts             Anthropic call: classifies field labels into categories
    field-matcher.ts           deterministic keyword pass + LLM fallback + confidence gating
    resume-content.ts          reads the user's resume via packages/db's ResumeStorage
  db/
    context.ts                 loads an Application's fill context (tenant-checked)
    status.ts                  THE ONLY module allowed to write Application.status
    log-writer.ts               THE ONLY function that constructs an ApplicationLogEntry row
```

Depends on `auto-job-applier-db` (the same Prisma client, encryption
helper, and `ResumeStorage` the Next.js app uses) directly -- not on
`apps/web`'s `Repository` interface, which is Next.js-app-shaped
(snake_case domain types, etc.). `packages/db`'s own `index.ts` already
flags this as the intended integration point ("any future service -- e.g.
the browser-orchestration apply-agent -- later").

## Control protocol

A dedicated WebSocket per session (`/sessions/:id/control`) carries the
issue's suggested vocabulary as JSON messages (`protocol/events.ts`):

- Agent/server -> human: `agent_action`, `yield_control`, `user_input_needed`,
  `control_handback` (direction `to_human`), `ready_for_review`, `submitted`,
  plus `failed`/`session_ended` for operational completeness.
- Human -> agent/server: `take_control_request`, `control_handback`
  (direction `to_agent`), `field_input`, `skip_field`, `confirm_submit`,
  `cancel_session`.

**Turn-taking**: the automation loop (`session/automation-loop.ts`) yields
(blocks, waiting for a human response) whenever a field is manual-mode
(`RequiredInfoAnswer.mode === "manual"`), a match's confidence is below
`APPLY_AGENT_MIN_CONFIDENCE` (default 0.75), or a CAPTCHA is detected on the
page. It resumes on `field_input`, `skip_field`, or `control_handback`.

## Never-auto-submit invariant

This is structural, not a convention:

- `session/types.ts`'s `SessionControl` interface -- the only handle the
  automation loop is given -- has **no submit method**. `ApplySession`
  implements `SessionControl` (so the loop can fill/yield/log) plus a
  separate `confirmSubmit()` that is not part of that interface. The loop's
  function signature takes `SessionControl`, so calling `.confirmSubmit()`
  from inside it is a **compile-time type error** -- the method isn't on
  the type the loop holds a reference to, regardless of what the
  implementing class happens to have.
- `confirmSubmit()` is private and only reachable from `ApplySession.
  handleHumanCommand`'s `confirm_submit` case -- i.e. only in response to an
  explicit message from the connected human reviewer's WebSocket.
- `db/status.ts` is the only module that writes `Application.status`.
  `advanceStatus`'s type signature statically excludes `"submitted"` as a
  legal argument. `markSubmitted` takes no status argument (the transition
  it performs is hardcoded) and its `WHERE` clause requires the row to
  currently be `READY_FOR_REVIEW`, so even a duplicate/racing call can't
  double-submit or submit from an unexpected state.
- `confirmSubmit()` clicks the real submit button in the browser **before**
  calling `markSubmitted`, so a failed click never leaves the `Application`
  falsely marked `submitted`.

## No video/screen-recording persistence

`browser/screencast.ts` is the only file that touches raw frames (via
Chromium's `Page.startScreencast` CDP method). It forwards each frame
straight to an in-memory callback and acks it -- there is no `fs.writeFile`,
no call into `ResumeStorage`/blob storage, no buffering, anywhere in that
file. `control/ws-handler.ts` keeps the video channel (`/sessions/:id/video`)
and the control/event channel (`/sessions/:id/control`) as two separate
WebSocket connections specifically so the persisted event log
(`db/log-writer.ts`, `ApplicationLogEntry` rows) can never accidentally end
up with a frame in it -- the code path that persists events has no
reference to a frame at all.

The issue's suggested production transport is noVNC/WebRTC; this pass ships
a CDP-screencast-over-WebSocket transport as the interim implementation.
Swapping the transport later must preserve the same property (frames flow
through to the viewer and are never written anywhere).

## Structured event log

`db/log-writer.ts`'s `logFieldEntry` is the only function that constructs an
`ApplicationLogEntry` row, and its parameters make it impossible to pass a
raw value through: `fieldLabel` (the page's own caption, not sensitive) and
`valueCategory` (a closed `FieldValueCategory` union mirroring the schema's
`work_auth` / `veteran` / etc. categories) -- there is no `value` parameter.
This matches `packages/db/prisma/schema.prisma`'s comment on
`ApplicationLogEntry`: "no column of any kind that could hold a raw value."

Issue #6 (Activity Log) reads this same table from the other direction (a
UI/API to *display* it) -- no coordination needed beyond both following the
schema as documented; this service only ever writes.

## Open decision 1: self-hosted containers vs. a managed browser-automation service

**Default: self-hosted**, via `browser/browser-provider.ts`'s
`LocalPlaywrightBrowserProvider` (launches Chromium locally via
`playwright-core`, one isolated `BrowserContext` per session).

Rationale: this is an early-stage project with no hosting/infra decision
made yet (see `packages/db/README.md`'s own open `KeyProvider`/
`ResumeStorage` questions, both blocked on the same unmade hosting choice).
A managed browser-automation service (Browserbase, Steel, Browserless, etc.)
would remove a real operational burden (per-session container isolation,
proxy/anti-bot rotation, scaling) but adds a paid third-party dependency and
a second execution environment for *real applicant data* (resume content,
form field values in flight) to cross, before there's a chosen hosting
provider to even evaluate that vendor's data-handling posture against. Self-
hosting keeps that data inside infrastructure this project already controls
while the hosting decision is pending, at the cost of owning container
isolation/scaling later.

`BrowserProvider` is the seam: `ManagedBrowserProvider` is stubbed
(throws, clearly, if selected) so switching later is implementing one class
against a chosen vendor, not rearchitecting call sites. Real per-session
*container* isolation (the issue's suggestion) is intentionally not
implemented in-process here (spawning containers is a deployment-topology
concern) -- the recommended path is running one instance of this whole
service per container/pod, so a crashed or compromised session can't affect
another session, rather than this service shelling out to a container
runtime itself.

## Open decision 2: which LLM powers field-filling decisions

**Default: Claude**, via `@anthropic-ai/sdk` (already an `apps/web`
dependency, used today for resume/title derivation --
`apps/web/lib/title-derivation.ts`). `agent/llm-client.ts` mirrors that
file's exact pattern: a lazily-constructed client, a typed
`LlmNotConfiguredError` if `ANTHROPIC_API_KEY` is missing, and the same
`claude-opus-4-8` model identifier for consistency (reuse, not a new
integration to maintain).

Rationale: introducing a second model provider for a codebase that already
has exactly one LLM integration point, with no stated reason to prefer a
different model for form-field classification specifically, would be
adding an integration for its own sake. If a cheaper/faster/more
specialized model is wanted for this specific job later (field
classification is a much simpler task than resume analysis), the seam is
`agent/llm-client.ts` -- one file, isolated from the rest of the session
logic.

**Privacy-motivated scope limit that shaped this decision**: the LLM is
only ever asked to classify a field's *label/type/options* into the closed
`FieldValueCategory` taxonomy -- never a required-info answer's actual
value. Work authorization, veteran/disability status, race, gender,
security clearance, and criminal history values are matched against a
field's on-page options *deterministically*, entirely in-process, in
`agent/field-matcher.ts`, after classification. Those values never enter a
prompt sent to Anthropic (or any other third party). See that file's header
comment.

## Out of scope for this pass

- **Real per-session containers.** See "Open decision 1" -- this ships a
  same-process `BrowserProvider`, not container spawning.
- **noVNC/WebRTC.** The video channel is CDP-screencast-over-WebSocket
  (`browser/screencast.ts`), not the issue's suggested production
  transport. The no-persistence invariant is preserved either way.
- **Full take-control input relay.** `take_control_request`/
  `control_handback` are wired at the protocol/state level (the automation
  loop pauses via `isHumanDriving()` polling and re-extracts fields after a
  handback), but there's no mouse/keyboard input relay implemented here --
  that's the video transport's job once it's a real remote-desktop protocol
  (VNC/WebRTC), not this service's control channel.
- **Contact-detail fields.** `full_name`, `phone`, `linkedin_url`,
  `portfolio_url`, `work_history`, `education`, `cover_letter` categories
  have no data source in the current schema (`Profile` only has
  `locations`/`levels`/`target_titles`; there's no stored name/phone/URLs).
  `field-matcher.ts` correctly yields to the human for these rather than
  guessing -- adding those `Profile` columns is a schema change outside
  this issue's scope.
- **Robust dynamic-field / multi-step-wizard handling.** The automation
  loop does a small fixed number of extract-decide-fill passes
  (`MAX_PASSES` in `automation-loop.ts`) to catch fields revealed by an
  earlier answer, not a general fixed-point/mutation-observer approach.
  Custom form widgets (React-Select-style comboboxes, rich text editors,
  date pickers) are not specifically handled; a failed fill surfaces as a
  `yield_control` with reason `"error"` rather than crashing the session.
- **Auth / access control on this service's own HTTP+WS endpoints.** No
  token verification on `POST /sessions` or the WS upgrades -- this service
  is meant to sit behind the Next.js app / an internal network boundary,
  not be exposed directly. Tied to issue #3 (auth), not decided here.
- **apps/web integration.** This service is not wired into the Next.js
  UI/API yet (the `simulate-submit` stub at
  `apps/web/app/api/applications/[jobListingId]/simulate-submit/route.ts`
  is untouched) -- deliberately, to avoid unrelated churn in `apps/web`
  while four other issues' agents are working against the same base
  branch. A real integration would add a route that calls
  `POST /sessions` on this service and hands the returned
  `controlUrl`/`videoUrl` to a reviewer UI.
- **Not exercised live.** No reachable Postgres/Docker/display in the
  sandbox this was built in -- `npx tsc --noEmit` is clean and the code is
  structurally correct against the real Prisma-generated types, but no
  session has actually driven a browser against a real ATS form end-to-end.
  Before relying on this in production: run it against a real Postgres
  instance + a real job-application form, and validate the CDP screencast
  path against an actual Chromium build (`playwright-core` requires the
  container image to install browser binaries -- e.g.
  `npx playwright install --with-deps chromium` -- since this package
  intentionally does not pull the full `playwright` package's automatic
  browser download into `npm install`).

## Running locally

```
cp .env.example .env   # fill in DATABASE_URL / FIELD_ENCRYPTION_KEY / ANTHROPIC_API_KEY
npx playwright install chromium   # one-time, downloads a browser binary (not run by npm install)
npm run dev --workspace=apply-agent-service
```

Then `POST http://localhost:4100/sessions` with `{"userId": "...", "applicationId": "..."}`
(an `Application` row must already exist -- e.g. created via the Next.js
app's Job Feed flow) and connect to the returned `controlUrl` over
WebSocket to watch the structured event stream.
