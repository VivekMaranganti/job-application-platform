// ---------------------------------------------------------------------------
// Process-wide configuration. Kept tiny and explicit rather than pulling in
// a config-loading library -- this service has very few knobs.
// ---------------------------------------------------------------------------

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  /** Port the control-plane HTTP + WebSocket server listens on. */
  port: intFromEnv("APPLY_AGENT_SERVICE_PORT", 4100),

  /**
   * Below this confidence (0-1), a field match yields to the human instead
   * of being auto-filled -- see agent/field-matcher.ts. Deliberately
   * conservative: the cost of an unnecessary yield is a human clicking
   * "looks right, continue"; the cost of a wrong auto-fill on a real
   * application is much higher.
   */
  minAutoFillConfidence: Number(process.env.APPLY_AGENT_MIN_CONFIDENCE ?? "0.75"),

  /**
   * Which Anthropic model powers in-session field-filling decisions.
   * Mirrors the model already used for resume/title derivation
   * (apps/web/lib/title-derivation.ts) for consistency -- see
   * README.md "Open decision 2" for the full rationale on using Claude at
   * all vs. another provider.
   */
  fieldMatcherModel: process.env.APPLY_AGENT_MODEL ?? "claude-opus-4-8",

  /**
   * Self-hosted-container vs. managed-browser-automation-service is an open
   * decision (README.md "Open decision 1"). This flag exists so the default
   * (self-hosted Playwright via BrowserProvider) can be swapped for a
   * managed-service-backed BrowserProvider later without touching call
   * sites -- no managed implementation exists yet, this is just the seam.
   */
  browserProvider: process.env.APPLY_AGENT_BROWSER_PROVIDER ?? "self-hosted",
} as const;
