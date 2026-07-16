import { createServer, type IncomingMessage } from "node:http";
import { WebSocketServer } from "ws";
import { sessionManager } from "./session/session-manager";
import { attachControlChannel, attachVideoChannel } from "./control/ws-handler";
import { ApplicationNotFoundError } from "./db/context";

// ---------------------------------------------------------------------------
// Minimal HTTP + WebSocket control-plane server:
//   POST /sessions                { userId, applicationId } -> creates/reuses
//                                 a live session, fire-and-forget starts it
//   GET  /health                  liveness check
//   WS   /sessions/:id/control    structured event log (see ws-handler.ts)
//   WS   /sessions/:id/video      screencast frames (see ws-handler.ts /
//                                 browser/screencast.ts's no-persistence
//                                 invariant)
//
// No auth/session-token verification on these endpoints yet -- this
// service is not intended to be exposed directly to the internet; it
// expects to sit behind the Next.js app / an internal network boundary.
// See README.md "Out of scope".
// ---------------------------------------------------------------------------

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export function createApp() {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && req.url === "/sessions") {
      readJsonBody(req)
        .then(async (body) => {
          const { userId, applicationId } = body as { userId?: unknown; applicationId?: unknown };
          if (typeof userId !== "string" || typeof applicationId !== "string") {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "userId and applicationId (strings) are required." }));
            return;
          }
          try {
            await sessionManager.createSession(userId, applicationId);
            res.writeHead(201, { "content-type": "application/json" });
            res.end(
              JSON.stringify({
                applicationId,
                controlUrl: `/sessions/${applicationId}/control`,
                videoUrl: `/sessions/${applicationId}/video`,
              }),
            );
          } catch (err) {
            if (err instanceof ApplicationNotFoundError) {
              res.writeHead(404, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: err.message }));
              return;
            }
            const message = err instanceof Error ? err.message : String(err);
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: message }));
          }
        })
        .catch(() => {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Malformed request body." }));
        });
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found." }));
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", "http://internal");
    const match = url.pathname.match(/^\/sessions\/([^/]+)\/(control|video)$/);
    if (!match) {
      socket.destroy();
      return;
    }
    const [, applicationId, channel] = match;
    if (!applicationId || !channel) {
      socket.destroy();
      return;
    }
    const session = sessionManager.get(applicationId);
    if (!session) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      if (channel === "control") attachControlChannel(ws, session);
      else attachVideoChannel(ws, session);
    });
  });

  return server;
}
