import type WebSocket from "ws";
import type { HumanReviewActions } from "../session/types";
import { isHumanCommand } from "../protocol/events";

// ---------------------------------------------------------------------------
// Wires a WebSocket connection to a session's structured event stream (the
// "control" channel) or its screencast frame stream (the "video" channel).
// These are two separate connections/endpoints on purpose -- see
// browser/screencast.ts and README.md: the structured event log is safe to
// persist (as ApplicationLogEntry rows) and safe to log/replay; the video
// stream must never be persisted anywhere. Keeping them as physically
// separate channels (rather than multiplexed frames-and-events on one
// socket) makes "never let a frame leak into the persisted log" trivially
// true by construction -- attachControlChannel never even has a reference
// to a frame.
// ---------------------------------------------------------------------------

export function attachControlChannel(ws: WebSocket, session: HumanReviewActions): void {
  const unsubscribe = session.onEvent((event) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
  });

  ws.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: "failed", message: "Malformed control message (not valid JSON)." }));
      return;
    }
    if (!isHumanCommand(parsed)) {
      ws.send(JSON.stringify({ type: "failed", message: "Unrecognized control message shape." }));
      return;
    }
    session.handleHumanCommand(parsed);
  });

  ws.on("close", () => {
    unsubscribe();
  });
}

export function attachVideoChannel(ws: WebSocket, session: HumanReviewActions): void {
  const unsubscribe = session.onVideoFrame((frame) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
  });
  ws.on("close", () => {
    unsubscribe();
  });
}
