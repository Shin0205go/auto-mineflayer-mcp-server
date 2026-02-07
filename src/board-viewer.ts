/**
 * Board Viewer - シンプルなHTTPサーバーで掲示板を表示
 * スマホからも閲覧可能
 */

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const BOARD_FILE = path.join(process.cwd(), "shared-board.txt");
const HTTP_PORT = parseInt(process.env.BOARD_PORT || "3001");

function getBoardContent(): string {
  try {
    return fs.readFileSync(BOARD_FILE, "utf-8");
  } catch {
    return "(掲示板ファイルが見つかりません)";
  }
}

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Minecraft Agent Board</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'Monaco', 'Menlo', monospace;
      background: #1a1a2e;
      color: #eee;
      margin: 0;
      padding: 10px;
      font-size: 12px;
    }
    h1 {
      color: #0f0;
      font-size: 16px;
      margin: 0 0 10px 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status {
      font-size: 10px;
      color: #888;
    }
    .status.live { color: #0f0; }
    #board {
      background: #0d0d1a;
      border: 1px solid #333;
      border-radius: 4px;
      padding: 10px;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: calc(100vh - 60px);
      overflow-y: auto;
      line-height: 1.4;
    }
    .line { margin: 2px 0; }
    .time { color: #666; }
    .agent { color: #0ff; font-weight: bold; }
    .tool { color: #f0f; }
    .event { color: #ff0; }
    .error { color: #f44; }
  </style>
</head>
<body>
  <h1>
    Minecraft Agent Board
    <span id="status" class="status">connecting...</span>
  </h1>
  <div id="board">Loading...</div>

  <script>
    const board = document.getElementById('board');
    const status = document.getElementById('status');
    let lastLength = 0;

    function formatLine(line) {
      // Highlight patterns
      line = line.replace(/\\[(\\d{1,2}:\\d{2}:\\d{2})\\]/g, '<span class="time">[$1]</span>');
      line = line.replace(/\\[([A-Za-z0-9_]+)\\]/g, '<span class="agent">[$1]</span>');
      line = line.replace(/(minecraft_\\w+|mcp__\\w+)/g, '<span class="tool">$1</span>');
      line = line.replace(/(Error|Failed|failed|error)/gi, '<span class="error">$1</span>');
      return '<div class="line">' + line + '</div>';
    }

    async function refresh() {
      try {
        const res = await fetch('/api/board');
        const text = await res.text();
        const lines = text.split('\\n').filter(l => l.trim());
        const html = lines.map(formatLine).join('');
        board.innerHTML = html;

        // Auto-scroll if content changed
        if (text.length !== lastLength) {
          board.scrollTop = board.scrollHeight;
          lastLength = text.length;
        }

        status.textContent = 'live';
        status.className = 'status live';
      } catch (e) {
        status.textContent = 'offline';
        status.className = 'status';
      }
    }

    // Initial load
    refresh();

    // Poll every 2 seconds
    setInterval(refresh, 2000);
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === "/api/board") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(getBoardContent());
  } else {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML_TEMPLATE);
  }
});

server.listen(HTTP_PORT, "0.0.0.0", () => {
  // Get local IP for smartphone access
  const interfaces = os.networkInterfaces();
  let localIP = "localhost";
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
  }

  console.log(`\n📱 Board Viewer Started`);
  console.log(`   Local:   http://localhost:${HTTP_PORT}`);
  console.log(`   Network: http://${localIP}:${HTTP_PORT}`);
  console.log(`\n   スマホからは Network の URL にアクセス\n`);
});
