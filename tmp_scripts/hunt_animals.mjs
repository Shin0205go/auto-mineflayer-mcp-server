/**
 * Hunt animals for leather/food.
 * - Wait for animals to spawn near current position
 * - Walk in a direction and check every 30s for new animals
 * - Kill any cow/horse/donkey for leather
 *
 * Key fix: navigate to surface y (not fixed y=80)
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNear, GoalXZ } = goals;
const Vec3 = require('vec3');
const fs = require('fs');

const LOGFILE = '/tmp/hunt_animals.log';
const log = (msg) => {
  const t = new Date().toLocaleTimeString();
  const line = `[${t}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOGFILE, line + '\n');
};

fs.writeFileSync(LOGFILE, '');

const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'Claude1',
  version: '1.21.4'
});
bot.loadPlugin(pathfinder);

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getLeatherAnimals() {
  return Object.values(bot.entities).filter(e =>
    ['cow', 'mooshroom', 'horse', 'donkey', 'mule', 'llama', 'trader_llama'].includes(e.name)
  );
}

function getAllAnimals() {
  return Object.values(bot.entities).filter(e =>
    ['cow', 'mooshroom', 'horse', 'donkey', 'mule', 'llama', 'pig', 'sheep', 'chicken', 'rabbit'].includes(e.name)
  );
}

async function killEntity(entity) {
  const invBefore = {};
  bot.inventory.items().forEach(i => { invBefore[i.name] = (invBefore[i.name] || 0) + i.count; });

  const weapons = bot.inventory.items().sort((a, b) => {
    const p = {'diamond_sword': 6, 'iron_sword': 5, 'stone_sword': 4, 'diamond_pickaxe': 3, 'iron_pickaxe': 2, 'stone_pickaxe': 1};
    return (p[b.name] || 0) - (p[a.name] || 0);
  });
  if (weapons.length > 0) await bot.equip(weapons[0], 'hand').catch(() => {});

  const mcMov = new Movements(bot);
  mcMov.canDig = false;
  mcMov.maxDropDown = 6;
  bot.pathfinder.setMovements(mcMov);

  for (let i = 0; i < 20; i++) {
    const current = bot.entities[entity.id];
    if (!current) break;

    await bot.pathfinder.goto(new GoalNear(current.position.x, current.position.y, current.position.z, 2))
      .catch(() => {});
    bot.attack(current);
    await sleep(600);
  }

  await sleep(2500);

  // Collect items
  const drops = Object.values(bot.entities).filter(e =>
    e.id !== bot.entity.id &&
    (e.name === 'item' || (e.type === 'other' && e.name === 'item'))
  );

  for (const drop of drops) {
    if (drop.position.distanceTo(bot.entity.position) < 30) {
      await bot.pathfinder.goto(new GoalNear(drop.position.x, drop.position.y, drop.position.z, 1))
        .catch(() => {});
    }
  }

  await sleep(1000);

  const invAfter = {};
  bot.inventory.items().forEach(i => { invAfter[i.name] = (invAfter[i.name] || 0) + i.count; });

  for (const [n, c] of Object.entries(invAfter)) {
    if ((invBefore[n] || 0) < c) log(`  GOT: +${n} x${c - (invBefore[n] || 0)}`);
  }
}

async function moveInDirection(dx, dz, distance, timeoutMs = 30000) {
  const pos = bot.entity.position;
  const targetX = Math.round(pos.x + dx * distance);
  const targetZ = Math.round(pos.z + dz * distance);

  log(`Moving to (${targetX},?,${targetZ})...`);

  const mcMov = new Movements(bot);
  mcMov.canDig = false;
  mcMov.maxDropDown = 8;
  bot.pathfinder.setMovements(mcMov);

  // Use GoalXZ to not care about Y
  return Promise.race([
    bot.pathfinder.goto(new GoalXZ(targetX, targetZ)).then(() => true).catch(e => { log(`Nav err: ${e.message}`); return false; }),
    sleep(timeoutMs).then(() => { bot.pathfinder.stop(); return false; })
  ]);
}

bot.once('spawn', async () => {
  await sleep(2000);
  log(`HP: ${bot.health} Food: ${bot.food}`);
  log(`Pos: ${JSON.stringify(bot.entity.position)}`);

  // List all visible animals first
  let allAnimals = getAllAnimals();
  log(`All animals in loaded chunks: ${allAnimals.length}`);
  allAnimals.forEach(a => {
    const d = Math.round(a.position.distanceTo(bot.entity.position));
    log(`  ${a.name} at (${Math.round(a.position.x)},${Math.round(a.position.y)},${Math.round(a.position.z)}) dist=${d}`);
  });

  let leather = bot.inventory.items().filter(i => i.name === 'leather').reduce((s, i) => s + i.count, 0);
  log(`Current leather: ${leather}`);

  // Directions to search: N, E, S, W, NE, NW, SE, SW
  const directions = [
    [0, 1],   // North
    [1, 0],   // East
    [0, -1],  // South
    [-1, 0],  // West
    [1, 1],   // NE
    [-1, 1],  // NW
    [1, -1],  // SE
    [-1, -1], // SW
    [0, 2],   // Far North
    [2, 0],   // Far East
  ];

  for (let pass = 0; pass < 3 && leather === 0; pass++) {
    for (const [dx, dz] of directions) {
      if (leather > 0) break;

      const dist = 80 + pass * 60;
      await moveInDirection(dx, dz, dist, 25000);
      await sleep(2000);

      allAnimals = getAllAnimals();
      const nearLeather = getLeatherAnimals().filter(a => a.position.distanceTo(bot.entity.position) < 80);

      const pos = bot.entity.position;
      log(`At (${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}): ${allAnimals.length} animals, ${nearLeather.length} leather sources`);

      if (nearLeather.length > 0) {
        for (const animal of nearLeather) {
          log(`Killing ${animal.name} at (${Math.round(animal.position.x)},${Math.round(animal.position.y)},${Math.round(animal.position.z)})`);
          await killEntity(animal);
          leather = bot.inventory.items().filter(i => i.name === 'leather').reduce((s, i) => s + i.count, 0);
          if (leather > 0) break;
        }
      }
    }
  }

  log(`\n=== FINAL STATE ===`);
  log(`HP: ${bot.health} Food: ${bot.food}`);
  log(`Leather obtained: ${leather}`);
  log(`\nInventory:`);
  bot.inventory.items().forEach(i => log(`  ${i.name} x${i.count}`));

  if (leather > 0) {
    log(`\nNext: craft book with leather + 3 paper (from sugar_cane)`);
  } else {
    log(`\nCould not find cows. Alternative: get string for fishing, or find bookshelf in structure`);
  }

  bot.quit();
});

bot.on('error', err => log(`Error: ${err.message}`));
bot.on('end', () => { log('Done'); process.exit(0); });
