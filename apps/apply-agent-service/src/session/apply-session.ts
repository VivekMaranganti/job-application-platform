import type { AgentEvent, DistributiveOmit, FieldRef, FieldValueCategory, HumanCommand, ReviewSummaryItem } from "../protocol/events";
import type { HumanResolution, HumanReviewActions, SessionControl } from "./types";
import type { BrowserProvider, ProvisionedBrowserSession } from "../browser/browser-provider";
import type { ScreencastFrame, ScreencastHandle } from "../browser/screencast";
import { startScreencast } from "../browser/screencast";
import type { ApplicationContext } from "../db/context";
import { advanceStatus as persistStatus, markSubmitted, type NonSubmittedStatus } from "../db/status";
import { logFieldEntry } from "../db/log-writer";
import { runAutomationLoop } from "./automation-loop";

// ---------------------------------------------------------------------------
// One live session per Application. Implements `SessionControl` (handed to
// the automation loop -- narrow, no submit capability) and
// `HumanReviewActions` (the human-facing surface, including the ONLY path
// that can submit -- `confirmSubmit`, reachable exclusively via
// `handleHumanCommand`'s `confirm_submit` case). See session/types.ts for
// why that split is a compile-time guarantee, not a convention.
// ---------------------------------------------------------------------------

export class ApplicationAlreadyEndedError extends Error {
  constructor(applicationId: string) {
    super(`Session for application ${applicationId} has already ended.`);
    this.name = "ApplicationAlreadyEndedError";
  }
}

export class NotReadyForReviewInSessionError extends Error {
  constructor(applicationId: string) {
    super(`Application ${applicationId} is not ready_for_review yet -- refusing to submit.`);
    this.name = "NotReadyForReviewInSessionError";
  }
}

type LocalStatus = NonSubmittedStatus | "submitted";

export class ApplySession implements SessionControl, HumanReviewActions {
  readonly userId: string;
  readonly applicationId: string;
  readonly hostname: string;

  private status: LocalStatus = "reviewing";
  private humanDriving = false;
  private ended = false;

  private eventListeners = new Set<(event: AgentEvent) => void>();
  private videoListeners = new Set<(frame: ScreencastFrame) => void>();

  private pendingResolution:
    | { selector: string | null; resolve: (resolution: HumanResolution) => void }
    | undefined;

  private browserSession: ProvisionedBrowserSession | undefined;
  private screencastHandle: ScreencastHandle | undefined;

  constructor(
    private readonly context: ApplicationContext,
    private readonly browserProvider: BrowserProvider,
  ) {
    this.userId = context.userId;
    this.applicationId = context.applicationId;
    this.hostname = safeHostname(context.jobListing.url);
  }

  // --- lifecycle -----------------------------------------------------------

  /** Provisions the browser, runs the automation loop, then idles awaiting human review/confirm. Never throws -- failures end the session via a `failed` event. */
  async start(): Promise<void> {
    try {
      await this.advanceStatus("reviewing");
      this.browserSession = await this.browserProvider.provision(this.applicationId);
      // Screen streaming is best-effort and independent of the control
      // channel/event log -- see browser/screencast.ts's no-persistence
      // invariant. A streaming failure (e.g. non-Chromium target) should
      // not abort the apply session itself.
      try {
        this.screencastHandle = await startScreencast(this.browserSession.page, (frame) => {
          for (const listener of this.videoListeners) listener(frame);
        });
      } catch {
        // Streaming unavailable -- the human reviewer loses the live view
        // but the structured control channel (this class's events) still works.
      }

      // The automation loop is given `this` typed as `SessionControl` --
      // narrower than `ApplySession` -- so it cannot reach `confirmSubmit`.
      const control: SessionControl = this;
      await runAutomationLoop(control, this.browserSession.page, this.context);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.advanceStatus("failed").catch(() => {});
      this.status = "failed";
      this.broadcast({ type: "failed", message });
    }
  }

  async end(reason: string): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    if (this.pendingResolution) {
      this.pendingResolution.resolve({ kind: "skip" });
      this.pendingResolution = undefined;
    }
    await this.screencastHandle?.stop().catch(() => {});
    await this.browserSession?.close().catch(() => {});
    this.broadcast({ type: "session_ended", reason });
  }

  // --- SessionControl (automation loop's view -- no submit capability) -----

  async recordAutoFill(field: FieldRef, category: FieldValueCategory, confidence: number): Promise<void> {
    await logFieldEntry({
      userId: this.userId,
      applicationId: this.applicationId,
      fieldLabel: field.label,
      valueCategory: category,
      sentTo: this.hostname,
      source: "auto",
    });
    this.broadcast({ type: "agent_action", field, valueCategory: category, action: "filled", confidence });
  }

  async recordHumanFill(field: FieldRef, category: FieldValueCategory): Promise<void> {
    await logFieldEntry({
      userId: this.userId,
      applicationId: this.applicationId,
      fieldLabel: field.label,
      valueCategory: category,
      sentTo: this.hostname,
      source: "user-provided-live",
    });
    this.broadcast({ type: "agent_action", field, valueCategory: category, action: "filled", confidence: 1 });
  }

  /**
   * Logs getting past a registration wall. See SessionControl's declaration
   * for why this method takes no value parameter.
   *
   * `fieldLabel` is a caption describing the step, not scraped field text --
   * the account action isn't tied to one input on the page. `sentTo` is the
   * auth host, which can differ from `this.hostname` (the job listing's
   * host) when an ATS bounces the candidate to a central identity domain.
   */
  async recordAccountAction(
    action: "created_account" | "signed_in",
    hostname: string,
    username: string,
  ): Promise<void> {
    const label = action === "created_account" ? "Account registration" : "Account sign-in";
    await logFieldEntry({
      userId: this.userId,
      applicationId: this.applicationId,
      fieldLabel: label,
      valueCategory: "account_credentials",
      sentTo: hostname,
      source: "auto",
    });
    // `username` reaches the event stream but never the log table. It's
    // almost always the user's own email (already in plaintext on
    // users.email), and the human watching needs to see which account was
    // used. The password is not a parameter of this method at all.
    this.broadcast({
      type: "agent_action",
      field: { label: `${label} (${username})`, selector: "" },
      valueCategory: "account_credentials",
      action,
      confidence: 1,
    });
  }

  async yieldControl(
    reason:
      | "manual_field"
      | "low_confidence"
      | "captcha"
      | "unrecognized_field"
      | "jurisdiction_not_cleared"
      | "account_creation_not_allowed"
      | "account_form_needs_input"
      | "account_creation_failed"
      | "error",
    field: FieldRef | undefined,
    category: FieldValueCategory | undefined,
    message: string,
  ): Promise<HumanResolution> {
    await this.advanceStatus("needs_input");
    this.broadcast({ type: "yield_control", reason, field, valueCategory: category, message });
    return this.waitForHumanResolution(field?.selector ?? null);
  }

  async requestUserInput(field: FieldRef, prompt: string): Promise<HumanResolution> {
    await this.advanceStatus("needs_input");
    this.broadcast({ type: "user_input_needed", field, prompt });
    return this.waitForHumanResolution(field.selector);
  }

  async requestReview(summary: ReviewSummaryItem[]): Promise<void> {
    await this.advanceStatus("ready_for_review");
    this.broadcast({ type: "ready_for_review", summary });
  }

  async advanceStatus(status: NonSubmittedStatus): Promise<void> {
    await persistStatus(this.userId, this.applicationId, status);
    this.status = status;
  }

  isHumanDriving(): boolean {
    return this.humanDriving;
  }

  // --- HumanReviewActions (human-facing surface, includes the submit path) -

  onEvent(listener: (event: AgentEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onVideoFrame(listener: (frame: ScreencastFrame) => void): () => void {
    this.videoListeners.add(listener);
    return () => this.videoListeners.delete(listener);
  }

  handleHumanCommand(cmd: HumanCommand): void {
    switch (cmd.type) {
      case "take_control_request":
        this.humanDriving = true;
        this.broadcast({ type: "control_handback", direction: "to_human" });
        return;
      case "control_handback":
        this.humanDriving = false;
        this.broadcast({ type: "control_handback", direction: "to_agent" });
        this.resolvePending(null, { kind: "handback" });
        return;
      case "field_input":
        this.resolvePending(cmd.selector, { kind: "field_input", value: cmd.value });
        return;
      case "skip_field":
        this.resolvePending(cmd.selector, { kind: "skip" });
        return;
      case "confirm_submit":
        this.confirmSubmit().catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          this.broadcast({ type: "failed", message });
        });
        return;
      case "cancel_session":
        this.advanceStatus("skipped")
          .then(() => this.end("cancelled by reviewer"))
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            this.broadcast({ type: "failed", message });
          });
        return;
    }
  }

  /**
   * The ONLY method in this class (and the ONLY code path anywhere in this
   * service) that can transition an Application to `submitted`. Requires:
   *   1. Current in-memory status is `ready_for_review` (checked here).
   *   2. db/status.ts's `markSubmitted`, which re-checks the DB row is
   *      still READY_FOR_REVIEW in the same query (defense against a race
   *      with a concurrent status change) before writing SUBMITTED.
   * It performs the real submit click in the browser BEFORE marking the
   * status, so a click failure never leaves the Application falsely marked
   * submitted.
   */
  private async confirmSubmit(): Promise<void> {
    if (this.status !== "ready_for_review") {
      throw new NotReadyForReviewInSessionError(this.applicationId);
    }
    if (!this.browserSession) {
      throw new Error("No active browser session to submit.");
    }
    await clickSubmitButton(this.browserSession.page);
    const submittedAt = await markSubmitted(this.userId, this.applicationId);
    this.status = "submitted";
    this.broadcast({ type: "submitted", submittedAt: submittedAt.toISOString() });
    await this.end("submitted");
  }

  // --- internals -------------------------------------------------------------

  private waitForHumanResolution(selector: string | null): Promise<HumanResolution> {
    return new Promise((resolve) => {
      this.pendingResolution = { selector, resolve };
    });
  }

  private resolvePending(selector: string | null, resolution: HumanResolution): void {
    if (!this.pendingResolution) return;
    if (this.pendingResolution.selector !== null && selector !== null && this.pendingResolution.selector !== selector) {
      // A field_input/skip_field for a different field than the one we're
      // waiting on -- ignore rather than misapply it.
      return;
    }
    const pending = this.pendingResolution;
    this.pendingResolution = undefined;
    pending.resolve(resolution);
  }

  private broadcast(event: DistributiveOmit<AgentEvent, "sessionId" | "timestamp">): void {
    const withEnvelope = { ...event, sessionId: this.applicationId, timestamp: new Date().toISOString() } as AgentEvent;
    for (const listener of this.eventListeners) listener(withEnvelope);
  }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

async function clickSubmitButton(page: import("playwright-core").Page): Promise<void> {
  const byType = page.locator('button[type="submit"], input[type="submit"]').first();
  if (await byType.count()) {
    await byType.click();
    return;
  }
  const byRole = page.getByRole("button", { name: /submit application|submit|apply now|apply/i }).first();
  if (await byRole.count()) {
    await byRole.click();
    return;
  }
  throw new Error("Could not find a submit button on the page.");
}
