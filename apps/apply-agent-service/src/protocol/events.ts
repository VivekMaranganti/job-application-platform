// ---------------------------------------------------------------------------
// Control-channel protocol.
//
// This is deliberately a *separate* channel from any screen/video stream
// (see browser/screencast.ts) -- structured events here are safe to log,
// replay, and persist (as ApplicationLogEntry rows, via db/log-writer.ts);
// video frames never are (see the "no video persistence" invariant in
// browser/screencast.ts and README.md).
//
// Event names follow the issue's suggested vocabulary: agent_action,
// yield_control, user_input_needed, take_control_request, control_handback,
// ready_for_review, submitted. Directionality (who emits which) is not
// specified there, so it's made explicit below.
// ---------------------------------------------------------------------------

/**
 * Coarse category recorded on `ApplicationLogEntry.value_category`. Never a
 * raw value -- see packages/db/schema.prisma's comment on that column and
 * db/log-writer.ts, which is the only place allowed to construct one of
 * these strings into a persisted row.
 *
 * The eight `required_info_*` categories mirror the standard field_ids
 * documented in packages/db/prisma/schema.prisma (RequiredInfoAnswer) /
 * apps/web/lib/types.ts (RequiredFieldId) -- kept as a local literal union
 * rather than importing across apps (this service does not depend on
 * apps/web; packages/db's schema is the shared source of truth both read).
 */
export type FieldValueCategory =
  | "work_auth"
  | "sponsorship"
  | "veteran"
  | "disability"
  | "race_ethnicity"
  | "gender"
  | "security_clearance"
  | "criminal_history"
  | "full_name"
  | "email"
  | "phone"
  | "location"
  | "resume_upload"
  | "cover_letter"
  | "linkedin_url"
  | "portfolio_url"
  | "work_history"
  | "education"
  /**
   * An ATS account credential the agent created or reused to get past a
   * registration wall. Like every other category here this is a *label*, not
   * a value -- db/log-writer.ts writes the category and the schema has no
   * column capable of holding the password. The password itself lives only
   * in `portal_credentials.password_encrypted` (see packages/db/CREDENTIALS.md).
   */
  | "account_credentials"
  | "other";

export interface FieldRef {
  /** Human-readable label as scraped from the page (e.g. "Phone number"). */
  label: string;
  /** Best-effort CSS/DOM selector the agent used to locate the field. */
  selector: string;
}

/** One row of the summary presented at `ready_for_review`. */
export interface ReviewSummaryItem {
  field: FieldRef;
  valueCategory: FieldValueCategory;
  /** How the value ended up in the field. Mirrors LogEntrySource in the schema. */
  source: "auto" | "user-provided-live";
}

// ---------------------------------------------------------------------------
// Server -> client (human reviewer) events
// ---------------------------------------------------------------------------

export type AgentEvent =
  /** The agent filled or interacted with a field on its own. */
  | {
      type: "agent_action";
      sessionId: string;
      timestamp: string;
      field: FieldRef;
      valueCategory: FieldValueCategory;
      action:
        | "filled"
        | "selected"
        | "clicked"
        | "navigated"
        | "uploaded_resume"
        /** Registered a new account on an allowlisted ATS to get past a registration wall. */
        | "created_account"
        /** Signed in using a credential already in the vault for this ATS. */
        | "signed_in";
      confidence: number;
    }
  /**
   * The agent has stopped and is waiting on the human for this field/step.
   * Distinct from `user_input_needed` below: `yield_control` hands the
   * human the wheel (they may act directly in the live browser session);
   * it fires for manual-mode fields, low-confidence matches, and detected
   * CAPTCHAs.
   */
  | {
      type: "yield_control";
      sessionId: string;
      timestamp: string;
      reason:
        | "manual_field"
        | "low_confidence"
        | "captcha"
        | "unrecognized_field"
        | "jurisdiction_not_cleared"
        /**
         * The page is a registration wall on a domain that is NOT on the
         * ATS allowlist, so the agent will not create an account or type a
         * stored password into it. The human can register manually if they
         * trust the site. See packages/db/lib/policy/account-creation-allowlist.ts.
         */
        | "account_creation_not_allowed"
        /**
         * The site IS allowlisted, but its signup form asks for something
         * beyond username/password that the agent won't invent (security
         * questions, "how did you hear about us", a country dropdown).
         */
        | "account_form_needs_input"
        /** Registration was attempted on an allowlisted site and did not succeed. */
        | "account_creation_failed"
        | "error";
      field?: FieldRef;
      valueCategory?: FieldValueCategory;
      message: string;
    }
  /**
   * The agent needs a specific piece of information from the human (not
   * necessarily by taking over the browser) -- e.g. "what should I answer
   * for X". Distinguished from `yield_control` because the UI can offer a
   * lightweight inline prompt rather than a full take-over.
   */
  | {
      type: "user_input_needed";
      sessionId: string;
      timestamp: string;
      field: FieldRef;
      prompt: string;
    }
  /** Acknowledges a `take_control_request` (human) -- agent has paused. */
  | { type: "control_handback"; sessionId: string; timestamp: string; direction: "to_human" }
  /** Agent has resumed automation after the human sent `control_handback`. */
  | { type: "control_handback"; sessionId: string; timestamp: string; direction: "to_agent" }
  /**
   * All fields are filled (or explicitly skipped by the human) and nothing
   * further can happen without an explicit human confirmation. This is the
   * ONLY event that precedes a possible `submitted` event -- see
   * session/apply-session.ts's `confirmSubmit`, the sole code path allowed
   * to submit.
   */
  | { type: "ready_for_review"; sessionId: string; timestamp: string; summary: ReviewSummaryItem[] }
  /** Final submit happened, following an explicit human confirm_submit command. */
  | { type: "submitted"; sessionId: string; timestamp: string; submittedAt: string }
  | { type: "failed"; sessionId: string; timestamp: string; message: string }
  | { type: "session_ended"; sessionId: string; timestamp: string; reason: string };

// ---------------------------------------------------------------------------
// Client (human reviewer) -> server commands
// ---------------------------------------------------------------------------

export type HumanCommand =
  /** Human wants to drive the live browser directly, pausing the agent. */
  | { type: "take_control_request"; sessionId: string }
  /** Human is done driving manually; agent may resume automation. */
  | { type: "control_handback"; sessionId: string }
  /** Human supplies a value in response to `user_input_needed` (or a manual-mode field). */
  | { type: "field_input"; sessionId: string; selector: string; value: string }
  /** Human explicitly asks the agent to skip a field it yielded on (e.g. optional field). */
  | { type: "skip_field"; sessionId: string; selector: string }
  /**
   * The ONLY message that can result in a real submission. Requires the
   * session to already be `ready_for_review` -- see apply-session.ts.
   */
  | { type: "confirm_submit"; sessionId: string }
  | { type: "cancel_session"; sessionId: string };

/**
 * `Omit<Union, K>` does NOT distribute over union members -- `keyof` a
 * union only returns properties common to every member, so a plain `Omit`
 * on `AgentEvent` would collapse it down to just `type` (the only property
 * every variant is guaranteed to share besides the omitted ones). This
 * distributes the `Omit` over each member first, so each variant keeps its
 * own per-variant fields (e.g. `field`, `reason`, `summary`).
 */
export type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export function isHumanCommand(value: unknown): value is HumanCommand {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return (
    typeof type === "string" &&
    [
      "take_control_request",
      "control_handback",
      "field_input",
      "skip_field",
      "confirm_submit",
      "cancel_session",
    ].includes(type)
  );
}
