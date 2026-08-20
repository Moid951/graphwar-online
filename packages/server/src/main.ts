import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalServer, setGlobalIp } from "./lobby.js";
import { startServer } from "./ws.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const httpPort = Number(process.env.PORT || 8080);
const publicIp = process.env.PUBLIC_IP || "127.0.0.1";
setGlobalIp(publicIp);

const globalServer = new GlobalServer();
globalServer.createPublicRooms();

const staticDirEnv = process.env.STATIC_DIR;
const defaultStatic = path.resolve(__dirname, "../../client/dist");
const staticDir = staticDirEnv ? path.resolve(staticDirEnv) : existsSync(defaultStatic) ? defaultStatic : null;

startServer(globalServer, { httpPort, staticDir });

console.log(`Graphwar web server listening on port ${httpPort}`);
console.log(`  lobby:   ws://${publicIp}:${httpPort}/`);
console.log(`  rooms:   ws://${publicIp}:${httpPort}/room/<roomID>`);
console.log(`  status:  http://${publicIp}:${httpPort}/status.html`);

process.on("SIGINT", () => {
  globalServer.shutdown();
  process.exit(0);
});