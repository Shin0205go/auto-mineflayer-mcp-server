/**
 * Persistent Viewer Server
 *
 * Always-on HTTP server.
 * - Bot connected: iframes prismarine-viewer (internal port)
 * - Bot disconnected: shows status page with last-known info
 * - /status           JSON API: basic bot state
 * - /api/full-status  JSON API: status + equipment + nearby entities
 * - /api/minimap      JSON API: top-down block grid around bot
 * - /dashboard        Lightweight HTML dashboard (no WebGL)
 */
import * as http from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Vec3 } from "vec3";
import { botManager } from "./bot-manager/index.js";

const PID_FILE = path.join(os.tmpdir(), "mineflayer-viewer.pid");

// Process-global slot: survives mc_reload's module cache-busting.
// Any version of stopViewerServer() can reach the currently running server.
declare global {
  var __viewerServer: http.Server | null;
  var __minimapPin: { x: number; y: number; z: number } | null;
}
if (global.__viewerServer === undefined) global.__viewerServer = null;
if (global.__minimapPin === undefined) global.__minimapPin = null;

let internalViewerPort: number | null = null;
let viewerCloseFn: (() => void) | null = null;

// --- Minimap API -------------------------------------------------------

const MINIMAP_RADIUS = 32;

function getMinimapData(): object {
  const username = botManager.getFirstBotUsername();
  const entry = username ? botManager.getBotByUsername(username) : null;
  const bot = entry?.bot;
  if (!bot?.entity || !bot.world) {
    return { error: "bot not connected" };
  }
  const r = MINIMAP_RADIUS;
  const tiles: Array<[string, number]> = [];

  // Use pinned center if set, otherwise follow bot
  const pin = global.__minimapPin;
  const cx = pin ? Math.floor(pin.x) : Math.floor(bot.entity.position.x);
  const cy = pin ? Math.floor(pin.y) : Math.floor(bot.entity.position.y);
  const cz = pin ? Math.floor(pin.z) : Math.floor(bot.entity.position.z);

  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      let name = "air";
      let foundDy = 0;
      for (let dy = 24; dy >= -16; dy--) {
        try {
          const block = bot.blockAt(new Vec3(cx + dx, cy + dy, cz + dz));
          if (block && block.name !== "air" && block.name !== "cave_air") {
            name = block.name;
            foundDy = dy;
            break;
          }
        } catch {}
      }
      tiles.push([name, foundDy]);
    }
  }

  // Bot position relative to the scan center
  const bot_dx = Math.round(bot.entity.position.x - cx);
  const bot_dy = Math.round(bot.entity.position.y - cy);
  const bot_dz = Math.round(bot.entity.position.z - cz);

  const entities: Array<{ dx: number; dy: number; dz: number; type: string; name: string }> = [];
  try {
    for (const id of Object.keys(bot.entities)) {
      const e = bot.entities[id];
      if (!e || e === bot.entity) continue;
      const edx = Math.round(e.position.x - cx);
      const edy = Math.round(e.position.y - cy);
      const edz = Math.round(e.position.z - cz);
      if (Math.abs(edx) > r || Math.abs(edz) > r) continue;
      const hostile = /zombie|skeleton|creeper|spider|witch|phantom|drowned|enderman|pillager|ravager/i.test(e.name ?? "");
      entities.push({ dx: edx, dy: edy, dz: edz, type: hostile ? "hostile" : "passive", name: e.name ?? "unknown" });
    }
  } catch {}

  return {
    cx, cy, cz,
    bot_dx, bot_dy, bot_dz,
    pinned: !!pin,
    radius: r, tiles, entities,
  };
}

// --- Full status API ---------------------------------------------------

function getFullStatus(): object {
  const username = botManager.getFirstBotUsername();
  const entry = username ? botManager.getBotByUsername(username) : null;
  const bot = entry?.bot;

  if (!bot || !bot.entity) {
    return { connected: false, username: username ?? "", lastSeen: "unknown", lastPosition: null, lastHp: 20, lastHunger: 20, equipment: [], nearbyEntities: [] };
  }

  const equipment: Array<{ slot: string; name: string }> = [];
  try {
    const held = bot.heldItem;
    if (held) equipment.push({ slot: "hand", name: held.name });
    for (const [label, idx] of Object.entries({ head: 5, chest: 6, legs: 7, feet: 8 } as Record<string, number>)) {
      const item = bot.inventory?.slots?.[idx];
      if (item) equipment.push({ slot: label, name: item.name });
    }
  } catch {}

  const nearbyEntities: Array<{ name: string; type: string; distance: number }> = [];
  try {
    for (const id of Object.keys(bot.entities)) {
      const e = bot.entities[id];
      if (!e || e === bot.entity) continue;
      const dist = bot.entity.position.distanceTo(e.position);
      if (dist > 24) continue;
      const hostile = /zombie|skeleton|creeper|spider|witch|phantom|drowned|enderman|pillager|ravager/i.test(e.name ?? "");
      nearbyEntities.push({ name: e.name ?? "unknown", type: hostile ? "hostile" : "passive", distance: Math.round(dist) });
    }
    nearbyEntities.sort((a, b) => a.distance - b.distance);
  } catch {}

  return {
    connected: true,
    username,
    lastSeen: new Date().toISOString(),
    lastPosition: { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z },
    lastHp: bot.health ?? 20,
    lastHunger: bot.food ?? 20,
    equipment,
    nearbyEntities,
  };
}

// --- Dashboard HTML ---------------------------------------------------

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bot Dashboard</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Monaco','Menlo',monospace;background:#0e0e1a;color:#d0d0e0;font-size:13px;height:100vh;display:flex;flex-direction:column;overflow:hidden}
    #header{background:#1a1a2e;border-bottom:1px solid #2a2a4a;padding:8px 16px;display:flex;align-items:center;gap:12px;flex-shrink:0}
    #header h1{font-size:15px;color:#7af}
    #dot{width:10px;height:10px;border-radius:50%;background:#f44;flex-shrink:0}
    #dot.on{background:#0f0}
    #last-update{margin-left:auto;color:#555;font-size:11px}
    #main{display:flex;flex:1;overflow:hidden}
    #left{width:260px;flex-shrink:0;border-right:1px solid #2a2a4a;padding:10px;overflow-y:auto;display:flex;flex-direction:column;gap:10px}
    #right{flex:1;position:relative;overflow:hidden}
    #three-canvas{width:100%;height:100%;display:block}
    #three-hint{position:absolute;bottom:8px;right:8px;color:#333;font-size:10px;pointer-events:none}
    .section{background:#14142a;border:1px solid #2a2a4a;border-radius:6px;padding:10px}
    .section h2{font-size:11px;color:#7af;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
    .bar-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
    .bar-label{width:52px;color:#888;font-size:11px;flex-shrink:0}
    .bar-bg{flex:1;height:10px;background:#222;border-radius:5px;overflow:hidden}
    .bar-fill{height:100%;border-radius:5px;transition:width 0.5s}
    .bar-val{width:32px;text-align:right;font-size:11px;color:#ccc}
    .coord{color:#fa0;font-size:14px;text-align:center;letter-spacing:1px;margin-top:4px}
    .entity{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #1e1e3a}
    .entity:last-child{border-bottom:none}
    .entity .name{color:#ccc}.entity .dist{color:#555;font-size:11px}
    .entity.hostile .name{color:#f88}.entity.passive .name{color:#8f8}
    .equip-row{display:flex;gap:8px;margin-bottom:4px;align-items:center}
    .equip-slot{color:#555;font-size:11px;width:36px;flex-shrink:0}
    .equip-name{color:#dda}
    #offline{display:none;position:fixed;inset:0;background:rgba(10,10,20,0.85);align-items:center;justify-content:center;z-index:100}
    #offline.show{display:flex}
    #offline-msg{color:#f44;font-size:18px;text-align:center}
  </style>
</head>
<body>
  <div id="header">
    <div id="dot"></div>
    <h1 id="title">Bot Dashboard</h1>
    <span id="last-update">更新中...</span>
  </div>
  <div id="main">
    <div id="left">
      <div class="section">
        <h2>Vitals</h2>
        <div class="bar-row">
          <span class="bar-label">HP</span>
          <div class="bar-bg"><div class="bar-fill" id="hp-bar" style="width:0%;background:#e55"></div></div>
          <span class="bar-val" id="hp-val">-</span>
        </div>
        <div class="bar-row">
          <span class="bar-label">Hunger</span>
          <div class="bar-bg"><div class="bar-fill" id="hunger-bar" style="width:0%;background:#c93"></div></div>
          <span class="bar-val" id="hunger-val">-</span>
        </div>
      </div>
      <div class="section">
        <h2>Position</h2>
        <div class="coord" id="coords">X=? Y=? Z=?</div>
      </div>
      <div class="section">
        <h2>Equipment</h2>
        <div id="equipment"><span style="color:#555">なし</span></div>
      </div>
      <div class="section" style="flex:1;min-height:0">
        <h2>Nearby Entities <span id="entity-count" style="color:#555"></span></h2>
        <div id="entities" style="overflow-y:auto;max-height:180px"><span style="color:#555">なし</span></div>
      </div>
    </div>
    <div id="right">
      <canvas id="three-canvas"></canvas>
      <div id="three-hint">左ドラッグ:回転 右ドラッグ:移動 ホイール:ズーム</div>
      <div id="pin-bar" style="position:absolute;top:8px;left:8px;display:flex;gap:6px;align-items:center">
        <button id="pin-btn" onclick="togglePin()" style="background:#1a2a4a;border:1px solid #4a6a9a;color:#9af;font-size:11px;padding:4px 10px;border-radius:4px;cursor:pointer">📌 ビュー固定</button>
        <span id="pin-label" style="font-size:11px;color:#555"></span>
      </div>
    </div>
  </div>
  <div id="offline"><div id="offline-msg">Bot Offline<br><span style="font-size:13px;color:#888">再接続を待っています...</span></div></div>

  <script>
  // ---- Block color map ----
  const BLOCK_COLORS = {
    grass_block:0x5a8a3c, grass:0x4a7a2c, tall_grass:0x4a7a2c, fern:0x3a6a1c,
    dirt:0x7a5030, coarse_dirt:0x6a4020, podzol:0x6a4828, rooted_dirt:0x7a5030,
    stone:0x7a7a7a, cobblestone:0x6a6a6a, mossy_cobblestone:0x5a6a50,
    deepslate:0x505058, cobbled_deepslate:0x484850,
    sand:0xc8b464, sandstone:0xb8a458, red_sand:0x9a5020,
    gravel:0x706860,
    water:0x3060d0, flowing_water:0x3060d0,
    lava:0xe04800, flowing_lava:0xe04800,
    oak_log:0x7a5820, birch_log:0xc0b080, spruce_log:0x4a3010,
    oak_leaves:0x2a6a18, birch_leaves:0x5a8a30, spruce_leaves:0x1a4a10,
    jungle_leaves:0x1a7010, acacia_leaves:0x4a7820, dark_oak_leaves:0x1a5010,
    snow:0xe8e8f0, snow_block:0xe8e8f0, ice:0x90b8e0, packed_ice:0x80a8d0,
    bedrock:0x303030,
    oak_planks:0xa07840, birch_planks:0xccc080,
    crafting_table:0x8a6030, furnace:0x707070, chest:0x9a7830,
    coal_ore:0x5a5a5a, iron_ore:0x7a6a5a, gold_ore:0x9a9030,
    diamond_ore:0x509090, emerald_ore:0x308050, lapis_ore:0x405090,
    redstone_ore:0x8a3030, netherrack:0x6a2020, nether_bricks:0x3a1010,
    soul_sand:0x4a3820, end_stone:0xd0d090, obsidian:0x201828,
    _default:0x606068
  };

  // ---- Three.js setup ----
  const canvas = document.getElementById('three-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x080810);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x080810, 30, 60);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 40, 35);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  // OrbitControls (inline, no import needed for r128 CDN version)
  // Simple manual orbit since CDN r128 doesn't include OrbitControls in core
  let isPointerDown = false, pointerButton = 0;
  let lastX = 0, lastY = 0;
  let theta = 0.4, phi = 1.0, radius3d = 28;
  let targetX = 0, targetZ = 0;

  function updateCamera() {
    camera.position.set(
      targetX + radius3d * Math.sin(phi) * Math.sin(theta),
      radius3d * Math.cos(phi),
      targetZ + radius3d * Math.sin(phi) * Math.cos(theta)
    );
    camera.lookAt(targetX, 0, targetZ);
  }
  updateCamera();

  canvas.addEventListener('pointerdown', e => { isPointerDown=true; pointerButton=e.button; lastX=e.clientX; lastY=e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { isPointerDown=false; });
  canvas.addEventListener('pointermove', e => {
    if (!isPointerDown) return;
    const dx=e.clientX-lastX, dy=e.clientY-lastY; lastX=e.clientX; lastY=e.clientY;
    if (pointerButton===0) { theta -= dx*0.008; phi = Math.max(0.1,Math.min(Math.PI/2-0.05, phi+dy*0.008)); }
    else { targetX -= dx*0.05*Math.cos(theta); targetZ += dx*0.05*Math.sin(theta); }
    updateCamera();
  });
  canvas.addEventListener('wheel', e => { radius3d=Math.max(5,Math.min(80,radius3d+e.deltaY*0.05)); updateCamera(); e.preventDefault(); }, {passive:false});

  function resizeRenderer() {
    const el = document.getElementById('right');
    const w=el.clientWidth, h=el.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w/h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resizeRenderer);
  resizeRenderer();

  // ---- Block mesh pool (InstancedMesh per color) ----
  const boxGeo = new THREE.BoxGeometry(0.96, 0.96, 0.96);
  const matCache = new Map();
  function getMat(hex) {
    if (!matCache.has(hex)) matCache.set(hex, new THREE.MeshLambertMaterial({ color: hex }));
    return matCache.get(hex);
  }

  // Group for all block meshes (cleared on update)
  let blockGroup = new THREE.Group();
  scene.add(blockGroup);
  let entityGroup = new THREE.Group();
  scene.add(entityGroup);
  // Bot marker
  const botGeo = new THREE.BoxGeometry(0.7, 1.8, 0.7);
  const botMat = new THREE.MeshLambertMaterial({ color: 0xffee00 });
  const botMesh = new THREE.Mesh(botGeo, botMat);
  scene.add(botMesh);

  function buildScene(data) {
    // Remove old blocks
    scene.remove(blockGroup);
    blockGroup = new THREE.Group();
    scene.remove(entityGroup);
    entityGroup = new THREE.Group();

    if (data.error) return;

    const { radius, tiles, entities } = data;
    const n = radius * 2 + 1;

    // Collect positions per color
    const colorPositions = new Map();
    for (let zi = 0; zi < n; zi++) {
      for (let xi = 0; xi < n; xi++) {
        const [name, dy] = tiles[zi * n + xi];
        if (!name || name === 'air') continue;
        const hex = BLOCK_COLORS[name] ?? BLOCK_COLORS._default;
        const x = xi - radius;
        const z = zi - radius;
        const y = dy;
        if (!colorPositions.has(hex)) colorPositions.set(hex, []);
        colorPositions.get(hex).push(x, y, z);
      }
    }

    // Build InstancedMesh per color
    const dummy = new THREE.Object3D();
    for (const [hex, positions] of colorPositions) {
      const count = positions.length / 3;
      const mesh = new THREE.InstancedMesh(boxGeo, getMat(hex), count);
      mesh.frustumCulled = false;
      for (let i = 0; i < count; i++) {
        dummy.position.set(positions[i*3], positions[i*3+1], positions[i*3+2]);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      blockGroup.add(mesh);
    }
    scene.add(blockGroup);

    // Bot marker: use bot_dx/bot_dz offset from pin center (or 0,0 if following)
    const bx = data.bot_dx ?? 0;
    const by = data.bot_dy ?? 0;
    const bz = data.bot_dz ?? 0;
    botMesh.position.set(bx, by + 1, bz);

    // Entity dots
    const entGeo = new THREE.BoxGeometry(0.6, 1.6, 0.6);
    for (const e of (entities || [])) {
      const mat = new THREE.MeshLambertMaterial({ color: e.type === 'hostile' ? 0xff4444 : 0x44ff44 });
      const mesh = new THREE.Mesh(entGeo, mat);
      mesh.position.set(e.dx, e.dy + 1, e.dz);
      entityGroup.add(mesh);
    }
    scene.add(entityGroup);

    // Update pin label
    const label = document.getElementById('pin-label');
    const btn = document.getElementById('pin-btn');
    if (data.pinned) {
      label.textContent = 'X=' + data.cx + ' Y=' + data.cy + ' Z=' + data.cz + ' に固定中';
      label.style.color = '#9af';
      btn.textContent = '🔄 Bot追従';
      btn.style.background = '#2a1a4a';
      btn.style.borderColor = '#8a4aaa';
      btn.style.color = '#caf';
    } else {
      label.textContent = '';
      btn.textContent = '📌 ビュー固定';
      btn.style.background = '#1a2a4a';
      btn.style.borderColor = '#4a6a9a';
      btn.style.color = '#9af';
    }
  }

  // ---- Render loop ----
  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();

  // ---- Status update ----
  async function update() {
    try {
      const sr = await fetch('/api/full-status');
      const s = await sr.json();
      if (!s.connected) {
        document.getElementById('dot').className='';
        document.getElementById('title').textContent='Bot Offline';
        document.getElementById('offline').classList.add('show');
        return;
      }
      document.getElementById('offline').classList.remove('show');
      document.getElementById('dot').className='on';
      document.getElementById('title').textContent='Bot: '+s.username;
      document.getElementById('last-update').textContent='最終更新: '+new Date().toLocaleTimeString('ja-JP');

      const hp=s.lastHp??0, hunger=s.lastHunger??0;
      document.getElementById('hp-bar').style.width=(hp/20*100)+'%';
      document.getElementById('hp-val').textContent=hp;
      document.getElementById('hunger-bar').style.width=(hunger/20*100)+'%';
      document.getElementById('hunger-val').textContent=hunger;

      if (s.lastPosition) {
        const p=s.lastPosition;
        document.getElementById('coords').textContent='X='+Math.round(p.x)+'  Y='+Math.round(p.y)+'  Z='+Math.round(p.z);
      }
      const equip=s.equipment??[];
      document.getElementById('equipment').innerHTML = equip.length===0
        ? '<span style="color:#555">なし</span>'
        : equip.map(e=>'<div class="equip-row"><span class="equip-slot">'+e.slot+'</span><span class="equip-name">'+e.name.replace(/_/g,' ')+'</span></div>').join('');
      const ents=s.nearbyEntities??[];
      document.getElementById('entity-count').textContent=ents.length>0?'('+ents.length+')':'';
      document.getElementById('entities').innerHTML = ents.length===0
        ? '<span style="color:#555">なし</span>'
        : ents.slice(0,20).map(e=>'<div class="entity '+e.type+'"><span class="name">'+e.name.replace(/_/g,' ')+'</span><span class="dist">'+e.distance+'m</span></div>').join('');
    } catch {}

    try {
      const mr = await fetch('/api/minimap');
      buildScene(await mr.json());
    } catch {}
  }

  let _pinned = false;
  async function togglePin() {
    if (_pinned) {
      await fetch('/api/minimap/pin', { method: 'DELETE' });
      _pinned = false;
    } else {
      await fetch('/api/minimap/pin', { method: 'POST' });
      _pinned = true;
    }
    // Immediately refresh to reflect new state
    update();
  }

  update();
  setInterval(update, 2500);
  </script>
</body>
</html>`;

// --- Static pages ------------------------------------------------------

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
    .info { color: #888; font-size: 14px; line-height: 1.8; }
    .info strong { color: #ccc; }
    .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; }
    .dot.offline { background: #f44; }
    .dot.online { background: #0f0; }
    .btn { display: inline-block; margin-top: 16px; padding: 8px 16px; background: #27a; color: #fff; border-radius: 4px; text-decoration: none; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <h1><span class="dot {{DOT_CLASS}}"></span>{{TITLE}}</h1>
    <div class="info">{{INFO}}</div>
    <a class="btn" href="/dashboard">ダッシュボードを開く</a>
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
    .bar { position: fixed; top: 0; left: 0; right: 0; background: rgba(0,0,0,0.7); color: #0f0; font-family: monospace; font-size: 12px; padding: 4px 8px; z-index: 1000; display: flex; gap: 12px; align-items: center; }
    .bar a { color: #7af; font-size: 11px; text-decoration: none; border: 1px solid #7af; padding: 1px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <div class="bar">
    <span>Bot: {{USERNAME}} | <span id="status">loading...</span></span>
    <a href="/dashboard" target="_blank">Dashboard</a>
  </div>
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
  const username = botManager.getFirstBotUsername();
  const entry = username ? botManager.getBotByUsername(username) : null;
  const bot = entry?.bot;
  const connected = !!(bot?.entity);

  const info = connected
    ? `<strong>Username:</strong> ${username}<br>
       <strong>Status:</strong> Connected<br>
       <strong>Last update:</strong> ${new Date().toISOString()}`
    : `<strong>Username:</strong> ${username || "(none)"}<br>
       <strong>Status:</strong> Disconnected<br>
       <br><em>Auto-refreshing every 10s...</em>`;

  return STATUS_HTML
    .replace("{{DOT_CLASS}}", connected ? "online" : "offline")
    .replace("{{TITLE}}", connected ? "Bot Online" : "Bot Offline")
    .replace("{{INFO}}", info);
}

// --- HTTP Server -------------------------------------------------------

export function stopViewerServer(): Promise<void> {
  return new Promise((resolve) => {
    if (viewerCloseFn) { try { viewerCloseFn(); } catch {} viewerCloseFn = null; }
    // Clean up PID file if it's ours
    try {
      const pidStr = fs.readFileSync(PID_FILE, "utf8").trim();
      if (parseInt(pidStr) === process.pid) fs.unlinkSync(PID_FILE);
    } catch { /* ignore */ }
    // Use global reference so this works even after mc_reload replaces the module
    const srv = global.__viewerServer;
    if (srv) {
      // Forcibly kill all keep-alive connections (Node 18.2+ API + manual fallback)
      try { (srv as any).closeAllConnections?.(); } catch {}
      srv.close(() => { global.__viewerServer = null; resolve(); });
    } else {
      resolve();
    }
  });
}

function createRequestHandler(port: number): http.RequestListener {
  return (req, res) => {
    const url = req.url ?? "/";

    // Stop endpoint: allows a new process to evict a stale old process
    if (url === "/__stop") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("stopping");
      stopViewerServer();
      return;
    }

    if (url === "/status") {
      const s = getFullStatus() as any;
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(s));
      return;
    }

    if (url === "/api/full-status") {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(getFullStatus()));
      return;
    }

    if (url === "/api/minimap") {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(getMinimapData()));
      return;
    }

    if (url === "/api/minimap/pin" && req.method === "POST") {
      // Pin the minimap to the current bot position
      const username = botManager.getFirstBotUsername();
      const entry = username ? botManager.getBotByUsername(username) : null;
      const bot = entry?.bot;
      if (bot?.entity) {
        global.__minimapPin = {
          x: Math.floor(bot.entity.position.x),
          y: Math.floor(bot.entity.position.y),
          z: Math.floor(bot.entity.position.z),
        };
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ pinned: true, ...global.__minimapPin }));
      } else {
        res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ error: "bot not connected" }));
      }
      return;
    }

    if (url === "/api/minimap/pin" && req.method === "DELETE") {
      global.__minimapPin = null;
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ pinned: false }));
      return;
    }

    if (url === "/api/minimap/pin" && req.method === "OPTIONS") {
      res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS" });
      res.end();
      return;
    }

    if (url === "/dashboard") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(DASHBOARD_HTML);
      return;
    }

    const username = botManager.getFirstBotUsername();
    if (username && internalViewerPort) {
      const html = VIEWER_FRAME_HTML
        .replace("{{USERNAME}}", username)
        .replace("{{INTERNAL_PORT}}", String(internalViewerPort));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(renderStatusPage());
    }
  };
}

/** Try to stop any stale server at localhost:port via /__stop, then bind. */
export async function startViewerServer(port: number): Promise<void> {
  if (global.__viewerServer) return;

  // Stop existing viewer server gracefully via /__stop endpoint.
  // NOTE: Do NOT send SIGTERM to the PID from the PID file — multiple MCP server
  // processes run concurrently (main session + agent sub-sessions), and SIGTERMing
  // another MCP process kills it mid-operation, causing mc_connect to hang forever.
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    await fetch(`http://localhost:${port}/__stop`, { signal: controller.signal });
    clearTimeout(timeout);
    await new Promise(r => setTimeout(r, 400));
  } catch {
    // No existing server or already stopped
  }

  // Step 3: Write our own PID
  try {
    fs.writeFileSync(PID_FILE, String(process.pid));
  } catch { /* ignore */ }

  const newServer = http.createServer(createRequestHandler(port));
  global.__viewerServer = newServer;

  await new Promise<void>((resolve, reject) => {
    newServer.listen(port, () => {
      console.error(`[ViewerServer] Status server: http://localhost:${port}`);
      console.error(`[ViewerServer] Dashboard:     http://localhost:${port}/dashboard`);
      resolve();
    });

    newServer.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "EADDRINUSE") {
        console.error(`[ViewerServer] Port ${port} still in use after stop attempt – retrying once`);
        global.__viewerServer = null;
        setTimeout(() => {
          const retryServer = http.createServer(createRequestHandler(port));
          global.__viewerServer = retryServer;
          retryServer.listen(port, () => {
            console.error(`[ViewerServer] Status server (retry): http://localhost:${port}`);
            resolve();
          });
          retryServer.on("error", (e2: NodeJS.ErrnoException) => {
            console.error(`[ViewerServer] Port ${port} bind failed: ${e2.message}`);
            global.__viewerServer = null;
            resolve();
          });
        }, 800);
      } else {
        global.__viewerServer = null;
        reject(e);
      }
    });
  });
}

export async function onBotConnected(bot: any, username: string, viewerPort: number): Promise<void> {
  if (viewerCloseFn) {
    try { viewerCloseFn(); } catch {}
    viewerCloseFn = null;
  }

  internalViewerPort = viewerPort + 1; // e.g., 3099 -> 3100 internal
  console.error(`[ViewerServer] Bot connected: ${username}`);

  // Fire-and-forget: prismarine-viewer startup must NOT block or propagate errors
  setImmediate(() => {
    import("prismarine-viewer").then(({ default: prismarineViewer }) => {
      try {
        prismarineViewer.mineflayer(bot, { port: internalViewerPort!, firstPerson: false });
        console.error(`[ViewerServer] prismarine-viewer started on internal port ${internalViewerPort}`);
        viewerCloseFn = () => {
          try { (bot as any).viewer?.close(); } catch {}
        };
      } catch (e) {
        console.error(`[ViewerServer] prismarine-viewer init failed: ${e}`);
      }
    }).catch((e) => {
      console.error(`[ViewerServer] Failed to import prismarine-viewer: ${e}`);
    });
  });

  bot.once("end", () => {
    internalViewerPort = null;
    viewerCloseFn = null;
    console.error(`[ViewerServer] Bot disconnected`);
  });
}
