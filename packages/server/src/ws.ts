import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { ConnectedSocket } from "./net.js";
import { GlobalServer, LobbyPlayer } from "./lobby.js";
import { RoomServer } from "./relay.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ServerConfig {
  httpPort: number;
  staticDir: string | null;
}

export function startServer(globalServer: GlobalServer, config: ServerConfig): http.Server {
  const staticDir = config.staticDir;
  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname === "/status.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(globalServer.getStatusHtml());
      return;
    }

    if (staticDir) {
      const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const filePath = path.normalize(path.join(staticDir, rel));
      if (filePath.startsWith(path.normalize(staticDir))) {
        try {
          const data = await fs.readFile(filePath);
          const ext = path.extname(filePath);
          const mime: Record<string, string> = {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".png": "image/png",
            ".txt": "text/plain; charset=utf-8",
            ".svg": "image/svg+xml",
            ".json": "application/json",
          };
          res.writeHead(200, { "content-type": mime[ext] || "application/octet-stream" });
          res.end(data);
          return;
        } catch {
          // fall through to 404
        }
      }
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws: WebSocket, req) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const roomMatch = url.pathname.match(/^\/room\/(\d+)$/);

    if (roomMatch) {
      const roomID = parseInt(roomMatch[1], 10);
      const room = globalServer.rooms.find((r) => r.roomID === roomID);
      if (!room || !room.relay) {
        ws.close();
        return;
      }
      wireRelay(room.relay, ws);
    } else if (url.pathname === "/" || url.pathname === "/lobby") {
      wireLobby(globalServer, ws);
    } else {
      ws.close();
    }
  });

  httpServer.listen(config.httpPort);
  return httpServer;
}

function makeSocket(ws: WebSocket, onMessage: (msg: string) => void, onClose: () => void): ConnectedSocket {
  const socket = new ConnectedSocket(onMessage, onClose);
  Object.assign(socket, {
    sendRaw: (m: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(m);
    },
    close: () => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    },
    isOpen: () => ws.readyState === WebSocket.OPEN,
  });
  return socket;
}

function wireRelay(relay: RoomServer, ws: WebSocket): void {
  let client: import("./relay.js").ClientConnection | null = null;

  const socket = makeSocket(
    ws,
    () => {},
    () => {}
  );

  ws.on("message", (data) => {
    const msg = data.toString("utf8");
    socket.receive(msg);
    if (client !== null) {
      relay.handleMessage(msg, client);
    }
  });
  ws.on("close", () => {
    if (client !== null) {
      relay.removeClient(client);
      client.disconnect();
    }
  });
  ws.on("error", () => {
    if (client !== null) {
      relay.removeClient(client);
      client.disconnect();
    }
  });

  client = relay.createClientConnection(socket);
}

function wireLobby(globalServer: GlobalServer, ws: WebSocket): void {
  let player: LobbyPlayer | null = null;
  let named = false;

  const socket = makeSocket(
    ws,
    () => {},
    () => {}
  );

  ws.on("message", (data) => {
    socket.receive(data.toString("utf8"));
    const msg = data.toString("utf8");
    if (!named) {
      named = true;
      player = globalServer.registerConnection(socket);
      globalServer.handleName(player, msg);
    } else if (player !== null) {
      globalServer.handleMessage(msg, player);
    }
  });
  ws.on("close", () => {
    if (player !== null) globalServer.removePlayer(player);
  });
  ws.on("error", () => {
    if (player !== null) globalServer.removePlayer(player);
  });
}