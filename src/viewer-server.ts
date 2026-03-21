/**
 * Persistent Viewer Server
 *
 * Always-on HTTP server that wraps prismarine-viewer.
 * - Bot connected: iframes prismarine-viewer (internal port)
 * - Bot disconnected: shows status page with last-known info
 * - /status endpoint: JSON API for Playwright monitoring
 */
import * as http from "http";

let server: http.Server | null = null;
let internalViewerPort: number | null = null;
let botState: {
  connected: boolean;
  username: string;
  lastSeen: string;
  lastPosition?: { x: number; y: number; z: number };
  lastHp?: number;
  lastHunger?: number;
} = { connected: false, username: "", lastSeen: "never" };

// Track viewer close function
let viewerCloseFn: (() => void) | null = null;

const STATUS_HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Minecraft Bot Viewer</title>
  <meta http-equiv="refresh" content="10">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Monaco','Menlo',monospace; background: #1a1a2e; color: #eee; display: flex; align-items: center; justify-content: center; height: 100vh; }
    .card { background: #0d0d1a; border: 1px solid #333; border-radius: 8px; padding: 32px; max-width: 500px; width: 90%; }
    h1 { color: #f44; font-size: 20px; margin-bottom: 16px; }
    h1.online { color: #0f0; }
    .info { color: #888; font-size: 14px; line-height: 1.8; }
    .info strong { color: #ccc; }
    .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; }
    .dot.offline { background: #f44; }
    .dot.online { background: #0f0; }
  </style>
</head>
<body>
  <div class="card">
    <h1><span class="dot {{DOT_CLASS}}"></span>{{TITLE}}</h1>
    <div class="info">{{INFO}}</div>
  </div>
</body>
</html>`;

const VIEWER_FRAME_HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Minecraft Bot Viewer</title>
  <style>
    * { margin: 0; padding: 0; }
    body { background: #000; overflow: hidden; }
    iframe { width: 100vw; height: 100vh; border: none; }
    .bar { position: fixed; top: 0; left: 0; right: 0; background: rgba(0,0,0,0.7); color: #0f0; font-family: monospace; font-size: 12px; padding: 4px 8px; z-index: 1000; }
  </style>
</head>
<body>
  <div class="bar">Bot: {{USERNAME}} | <span id="status">loading...</span></div>
  <iframe src="http://localhost:{{INTERNAL_PORT}}/"></iframe>
  <script>
    setInterval(async () => {
      try {
        const r = await fetch('/status');
        const s = await r.json();
        document.getElementById('status').textContent =
          s.connected ? 'HP=' + (s.lastHp||'?') + ' Hunger=' + (s.lastHunger||'?') + ' Pos=(' + (s.lastPosition?Math.round(s.lastPosition.x)+','+Math.round(s.lastPosition.y)+','+Math.round(s.lastPosition.z):'?') + ')' : 'OFFLINE';
        if (!s.connected) location.reload();
      } catch {}
    }, 5000);
  </script>
</body>
</html>`;

function renderStatusPage(): string {
  const info = botState.connected
    ? `<strong>Username:</strong> ${botState.username}<br>
       <strong>Status:</strong> Connected<br>
       <strong>Last update:</strong> ${botState.lastSeen}`
    : `<strong>Username:</strong> ${botState.username || "(none)"}<br>
       <strong>Status:</strong> Disconnected<br>
       <strong>Last seen:</strong> ${botState.lastSeen}<br>
       ${botState.lastPosition ? `<strong>Last position:</strong> (${Math.round(botState.lastPosition.x)}, ${Math.round(botState.lastPosition.y)}, ${Math.round(botState.lastPosition.z)})<br>` : ""}
       ${botState.lastHp !== undefined ? `<strong>Last HP:</strong> ${botState.lastHp}<br>` : ""}
       <br><em>Auto-refreshing every 10s...</em>`;

  return STATUS_HTML
    .replace("{{DOT_CLASS}}", botState.connected ? "online" : "offline")
    .replace("{{TITLE}}", botState.connected ? "Bot Online" : "Bot Offline")
    .replace("{{INFO}}", info);
}

/**
 * Start the persistent viewer HTTP server on the given port.
 * Call once at MCP startup.
 */
export function startViewerServer(port: number): void {
  if (server) return; // Already running

  server = http.createServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(botState));
      return;
    }

    if (botState.connected && internalViewerPort) {
      // Show iframe wrapper pointing to prismarine-viewer
      const html = VIEWER_FRAME_HTML
        .replace("{{USERNAME}}", botState.username)
        .replace("{{INTERNAL_PORT}}", String(internalViewerPort));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    } else {
      // Show offline status page
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(renderStatusPage());
    }
  });

  server.listen(port, () => {
    console.error(`[ViewerServer] Status server running on http://localhost:${port}`);
  });

  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") {
      console.error(`[ViewerServer] Port ${port} already in use, skipping`);
      server = null;
    }
  });
}

/**
 * Called when bot connects - starts prismarine-viewer on internal port
 */
export async function onBotConnected(bot: any, username: string, viewerPort: number): Promise<void> {
  // Close previous viewer if any
  if (viewerCloseFn) {
    try { viewerCloseFn(); } catch {}
    viewerCloseFn = null;
  }

  internalViewerPort = viewerPort + 1; // e.g., 3007 -> 3008 internal

  botState = {
    connected: true,
    username,
    lastSeen: new Date().toISOString(),
  };

  // Update position periodically
  const updateState = () => {
    try {
      if (bot.entity) {
        botState.lastPosition = { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z };
        botState.lastHp = bot.health;
        botState.lastHunger = bot.food;
        botState.lastSeen = new Date().toISOString();
      }
    } catch {}
  };

  const interval = setInterval(updateState, 3000);
  updateState();

  // Start prismarine-viewer on internal port
  try {
    const { default: prismarineViewer } = await import("prismarine-viewer");
    prismarineViewer.mineflayer(bot, { port: internalViewerPort, firstPerson: false });
    console.error(`[ViewerServer] prismarine-viewer started on internal port ${internalViewerPort}`);

    viewerCloseFn = () => {
      clearInterval(interval);
      try { bot.viewer?.close(); } catch {}
    };
  } catch (e) {
    console.error(`[ViewerServer] Failed to start prismarine-viewer: ${e}`);
    clearInterval(interval);
  }

  // Handle bot disconnect
  bot.once("end", () => {
    clearInterval(interval);
    botState.connected = false;
    botState.lastSeen = new Date().toISOString();
    internalViewerPort = null;
    viewerCloseFn = null;
    console.error(`[ViewerServer] Bot disconnected, showing offline status`);
  });
}
