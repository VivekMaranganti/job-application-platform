import type { Page, CDPSession } from "playwright-core";

// ---------------------------------------------------------------------------
// HARD REQUIREMENT: no video/screen-recording persistence, anywhere, ever.
//
// This module is the only place in the service that touches raw video/
// screen frames. It streams them via a CDP screencast (Chromium's
// `Page.startScreencast`) directly to an in-memory callback -- there is no
// `fs.writeFile`, no blob-storage `.put(...)`, no buffer accumulation, and
// no import of packages/db's `ResumeStorage` (or any other storage seam)
// anywhere in this file. A frame either gets handed to `onFrame` for
// immediate forwarding to the connected human reviewer's viewer, or it is
// dropped -- those are the only two things that can happen to it.
//
// This is the interim transport (CDP screencast frames relayed over a
// dedicated WebSocket topic, see control/ws-handler.ts). The issue's
// suggested production transport is noVNC/WebRTC; swapping to a real WebRTC
// media pipeline later does not change this invariant -- whatever replaces
// this file must keep the same property (frames flow through, are never
// written to disk/object storage/database).
// ---------------------------------------------------------------------------

export interface ScreencastFrame {
  /** Base64-encoded JPEG, straight from Chromium -- never decoded/re-encoded/stored here. */
  data: string;
  timestamp: number;
}

export interface ScreencastHandle {
  stop(): Promise<void>;
}

export async function startScreencast(
  page: Page,
  onFrame: (frame: ScreencastFrame) => void,
): Promise<ScreencastHandle> {
  const client: CDPSession = await page.context().newCDPSession(page);

  client.on("Page.screencastFrame", (event) => {
    // Forward immediately, then ack so Chromium sends the next frame.
    // `event.data` / `event.metadata` are consumed and discarded here --
    // nothing about this frame is retained past this callback's return.
    onFrame({ data: event.data, timestamp: event.metadata.timestamp ?? Date.now() });
    client.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
  });

  await client.send("Page.startScreencast", {
    format: "jpeg",
    quality: 50,
    maxWidth: 1280,
    maxHeight: 800,
  });

  return {
    stop: async () => {
      await client.send("Page.stopScreencast").catch(() => {});
      await client.detach().catch(() => {});
    },
  };
}
