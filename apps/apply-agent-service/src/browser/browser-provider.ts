import type { Browser, BrowserContext, Page } from "playwright-core";
import { chromium } from "playwright-core";
import { config } from "../config";

// ---------------------------------------------------------------------------
// Open decision 1 (see README.md): self-hosted containers vs. a managed
// browser-automation service (Browserbase, Steel, Browserless, etc).
//
// This interface is the seam. `LocalPlaywrightBrowserProvider` is the
// self-hosted default this service ships with -- it launches a local
// Chromium instance via playwright-core and hands back one isolated
// BrowserContext per session (separate cookies/storage per application,
// same-process for now). A managed-service-backed provider (connecting to a
// remote CDP endpoint the provider returns instead of launching locally)
// implements the same interface and is a drop-in replacement -- no changes
// needed anywhere in session/apply-session.ts.
// ---------------------------------------------------------------------------

export interface ProvisionedBrowserSession {
  page: Page;
  context: BrowserContext;
  /** Releases the underlying browser/context. Idempotent. */
  close(): Promise<void>;
}

export interface BrowserProvider {
  /** Provisions an isolated browser session for one Application's apply flow. */
  provision(sessionId: string): Promise<ProvisionedBrowserSession>;
}

/**
 * Self-hosted default: one Chromium process per service instance, one
 * isolated BrowserContext (fresh cookie jar / storage) per apply session.
 * Real per-session *containers* (as the issue suggests) are a deployment
 * concern layered on top of this -- run one instance of this whole service
 * per container/pod so a crashed or compromised session can't affect
 * another user's session, rather than this class spawning containers
 * itself. See README.md "Open decision 1" for the full self-hosted vs.
 * managed rationale.
 */
export class LocalPlaywrightBrowserProvider implements BrowserProvider {
  private browserPromise: Promise<Browser> | undefined;

  private async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = chromium.launch({
        headless: process.env.APPLY_AGENT_HEADLESS !== "false",
      });
    }
    return this.browserPromise;
  }

  async provision(_sessionId: string): Promise<ProvisionedBrowserSession> {
    const browser = await this.getBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();
    return {
      page,
      context,
      close: async () => {
        await context.close().catch(() => {});
      },
    };
  }
}

/**
 * Not implemented -- documents the seam for the managed-service alternative
 * flagged in README.md "Open decision 1". A real implementation would call
 * out to the managed provider's API to obtain a remote CDP websocket
 * endpoint (and possibly its own hosted live-view/streaming URL, which
 * could replace browser/screencast.ts entirely for that deployment mode)
 * and connect Playwright to it via `chromium.connectOverCDP(...)` instead
 * of `chromium.launch(...)`.
 */
export class ManagedBrowserProvider implements BrowserProvider {
  async provision(): Promise<ProvisionedBrowserSession> {
    throw new Error(
      "ManagedBrowserProvider is not implemented. This service defaults to " +
        "LocalPlaywrightBrowserProvider (self-hosted) -- see README.md open decision 1. " +
        "Implement this class against a chosen managed browser-automation provider " +
        "before setting APPLY_AGENT_BROWSER_PROVIDER=managed.",
    );
  }
}

export function createDefaultBrowserProvider(): BrowserProvider {
  if (config.browserProvider === "managed") return new ManagedBrowserProvider();
  return new LocalPlaywrightBrowserProvider();
}
