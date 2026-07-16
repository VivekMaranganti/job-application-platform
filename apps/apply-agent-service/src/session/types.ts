import type { AgentEvent, FieldRef, FieldValueCategory, ReviewSummaryItem, HumanCommand } from "../protocol/events";
import type { NonSubmittedStatus } from "../db/status";
import type { ScreencastFrame } from "../browser/screencast";

// ---------------------------------------------------------------------------
// The never-auto-submit invariant, at the type level.
//
// `SessionControl` is the ONLY handle the automation loop (session/
// automation-loop.ts) is given -- and it has no method that can submit the
// application. `ApplySession` (apply-session.ts) implements this interface
// (so the loop can call recordAutoFill/yieldControl/etc.) plus a separate
// `confirmSubmit()` method that is NOT part of `SessionControl`. Because
// the automation loop's function signature takes a `SessionControl`, not
// an `ApplySession`, calling `.confirmSubmit()` from inside it is a
// compile-time type error, not just a convention someone could forget --
// the method simply isn't visible on the type the loop holds.
//
// `confirmSubmit` is only reachable via `HumanReviewActions.handleHumanCommand`,
// which is only ever invoked by the WS control handler when an actual
// `confirm_submit` message arrives from the connected human reviewer (see
// control/ws-handler.ts). That, plus the DB-level guard in db/status.ts's
// `markSubmitted` (only writes SUBMITTED from rows currently
// READY_FOR_REVIEW), is the full defense in depth for "never auto-submits".
// ---------------------------------------------------------------------------

export type HumanResolution =
  | { kind: "field_input"; value: string }
  | { kind: "skip" }
  | { kind: "handback" };

export interface SessionControl {
  readonly userId: string;
  readonly applicationId: string;
  readonly hostname: string;

  /** Records that the agent filled a field itself: logs + broadcasts `agent_action`. */
  recordAutoFill(field: FieldRef, category: FieldValueCategory, confidence: number): Promise<void>;
  /** Records that a human-supplied (live) value was used: logs + broadcasts `agent_action`. */
  recordHumanFill(field: FieldRef, category: FieldValueCategory): Promise<void>;
  /** Broadcasts `yield_control` and blocks until the human resolves it. */
  yieldControl(
    reason: "manual_field" | "low_confidence" | "captcha" | "unrecognized_field" | "jurisdiction_not_cleared" | "error",
    field: FieldRef | undefined,
    category: FieldValueCategory | undefined,
    message: string,
  ): Promise<HumanResolution>;
  /** Broadcasts `user_input_needed` and blocks until the human answers. */
  requestUserInput(field: FieldRef, prompt: string): Promise<HumanResolution>;
  /** Broadcasts `ready_for_review` and advances Application.status. Does NOT submit anything. */
  requestReview(summary: ReviewSummaryItem[]): Promise<void>;
  /** Any non-submit status transition (matched -> ... -> ready_for_review / skipped / failed). */
  advanceStatus(status: NonSubmittedStatus): Promise<void>;
  /** True while the human has taken direct control (take_control_request, no control_handback yet). */
  isHumanDriving(): boolean;
}

/** The human-facing surface -- includes the one and only submit path. */
export interface HumanReviewActions {
  handleHumanCommand(cmd: HumanCommand): void;
  onEvent(listener: (event: AgentEvent) => void): () => void;
  onVideoFrame(listener: (frame: ScreencastFrame) => void): () => void;
  end(reason: string): Promise<void>;
}
