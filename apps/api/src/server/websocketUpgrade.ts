import crypto from "node:crypto";
import type http from "node:http";
import type { Duplex } from "node:stream";
import type WebSocket from "ws";
import type { WebSocketServer } from "ws";

export type WsAuthUser = {
  id: string;
  email: string;
};

type SessionDb = {
  session: {
    findUnique: (args: {
      where: { tokenHash: string };
      include: { user: { select: { id: true; email: true } } };
    }) => Promise<{
      id: string;
      expiresAt: Date;
      user: WsAuthUser;
    } | null>;
    update: (args: {
      where: { id: string };
      data: { lastActiveAt: Date };
    }) => Promise<unknown>;
  };
};

function readCookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const entries = header.split(";");
  for (const entry of entries) {
    const [rawName, ...rest] = entry.trim().split("=");
    if (rawName !== name) continue;
    const value = rest.join("=");
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function authenticateWsUser(db: SessionDb, req: http.IncomingMessage): Promise<WsAuthUser | null> {
  const token = readCookieValue(req.headers.cookie, "mm_session");
  if (!token) return null;

  const session = await db.session.findUnique({
    where: {
      tokenHash: hashSessionToken(token)
    },
    include: {
      user: {
        select: {
          id: true,
          email: true
        }
      }
    }
  });

  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;

  await db.session.update({
    where: { id: session.id },
    data: { lastActiveAt: new Date() }
  });

  return {
    id: session.user.id,
    email: session.user.email
  };
}

function wsReject(socket: Duplex, statusCode: number, reason: string): void {
  socket.write(`HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function registerApiWebSocketUpgrades(params: {
  server: http.Server;
  db: SessionDb;
  marketWss: WebSocketServer;
  userWss: WebSocketServer;
  handleMarketWsConnection: (socket: WebSocket, user: WsAuthUser, url: URL) => void | Promise<void>;
  handleUserWsConnection: (socket: WebSocket, user: WsAuthUser, url: URL) => void | Promise<void>;
}): void {
  params.server.on("upgrade", (req, socket, head) => {
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", `http://${host}`);

    if (url.pathname !== "/ws/market" && url.pathname !== "/ws/user") {
      wsReject(socket, 404, "Not Found");
      return;
    }

    void (async () => {
      const user = await authenticateWsUser(params.db, req);
      if (!user) {
        wsReject(socket, 401, "Unauthorized");
        return;
      }

      if (url.pathname === "/ws/market") {
        params.marketWss.handleUpgrade(req, socket, head, (ws) => {
          void params.handleMarketWsConnection(ws, user, url);
        });
        return;
      }

      params.userWss.handleUpgrade(req, socket, head, (ws) => {
        void params.handleUserWsConnection(ws, user, url);
      });
    })().catch(() => {
      wsReject(socket, 500, "Internal Server Error");
    });
  });
}
