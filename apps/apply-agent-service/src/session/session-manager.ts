import { loadApplicationContext } from "../db/context";
import { createDefaultBrowserProvider, type BrowserProvider } from "../browser/browser-provider";
import { ApplySession } from "./apply-session";
import type { HumanReviewActions } from "./types";

// ---------------------------------------------------------------------------
// In-memory registry of live sessions, keyed by applicationId. One
// Playwright browser session per Application (per the issue's "a live,
// bidirectional Playwright-based browser session per application").
//
// Deliberately in-memory / single-instance for this foundation pass -- a
// production deployment running one service instance per session container
// (see browser-provider.ts's doc comment / README.md "Open decision 1")
// wouldn't need a shared registry at all; a multi-tenant single instance
// would need this backed by something durable (Redis) to survive a
// restart. Out of scope here -- see README.md "Out of scope".
// ---------------------------------------------------------------------------

class SessionManager {
  private readonly sessions = new Map<string, ApplySession>();

  constructor(private readonly browserProvider: BrowserProvider) {}

  async createSession(userId: string, applicationId: string): Promise<HumanReviewActions & { applicationId: string }> {
    const existing = this.sessions.get(applicationId);
    if (existing) return existing;

    const context = await loadApplicationContext(userId, applicationId);
    const session = new ApplySession(context, this.browserProvider);
    this.sessions.set(applicationId, session);

    // Fire-and-forget: the HTTP request that creates the session doesn't
    // block on the whole apply flow. Errors are surfaced as a `failed`
    // event on the session's own event stream (see ApplySession.start).
    void session.start();

    return session;
  }

  get(applicationId: string): HumanReviewActions | undefined {
    return this.sessions.get(applicationId);
  }

  async endSession(applicationId: string, reason: string): Promise<void> {
    const session = this.sessions.get(applicationId);
    if (!session) return;
    await session.end(reason);
    this.sessions.delete(applicationId);
  }
}

export const sessionManager = new SessionManager(createDefaultBrowserProvider());
export type { SessionManager };
