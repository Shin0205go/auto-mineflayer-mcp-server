/**
 * Direct obsidian mining - find the closest reachable obsidian blocks.
 * Lists all obsidian positions and tries mining each one.
 * Uses canDig=true for pathfinding.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNear } = goals;
const Vec3 = require('vec3');
const fs = require('fs');

const LOGFILE = '/tmp/mine_obs.log';
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

function getCount(name) {
  return bot.inventory.items().filter(i => i.name === name).reduce((s, i) => s + i.count, 0);
}

bot.once('spawn', async () => {
  await sleep(2000);

  const mcData = require('minecraft-data')(bot.version);
  const pos = bot.entity.position;
  log(`HP: ${bot.health} Food: ${bot.food}`);
  log(`Pos: (${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)})`);
  log(`diamond_pickaxe: ${getCount('diamond_pickaxe')}`);
  log(`book: ${getCount('book')}, diamond: ${getCount('diamond')}, obsidian: ${getCount('obsidian')}`);

  // Find all obsidian blocks
  const obsId = mcData.blocksByName['obsidian']?.id;
  if (!obsId) { log('No obsidian in mcData!'); bot.quit(); return; }

  const obsBlocks = bot.findBlocks({
    matching: obsId,
    maxDistance: 300,
    count: 30
  });

  log(`\nObsidian blocks found: ${obsBlocks.length}`);
  obsBlocks.slice(0, 20).forEach(b => {
    const dist = Math.round(new Vec3(b.x, b.y, b.z).distanceTo(pos));
    log(`  (${b.x},${b.y},${b.z}) dist=${dist}`);
  });

  if (obsBlocks.length === 0) {
    log('No obsidian found within 300 blocks!');
    bot.quit();
    return;
  }

  // Sort by distance
  const sorted = obsBlocks.sort((a, b) => {
    const da = new Vec3(a.x, a.y, a.z).distanceTo(pos);
    const db = new Vec3(b.x, b.y, b.z).distanceTo(pos);
    return da - db;
  });

  // Equip diamond pickaxe
  const pick = bot.inventory.items().find(i => i.name === 'diamond_pickaxe');
  if (!pick) { log('No diamond pickaxe!'); bot.quit(); return; }
  await bot.equip(pick, 'hand');

  let minedCount = 0;

  for (const obsPos of sorted) {
    if (getCount('obsidian') >= 4) break;

    log(`\nTrying obsidian at (${obsPos.x},${obsPos.y},${obsPos.z})...`);

    // Check the block
    const block = bot.blockAt(new Vec3(obsPos.x, obsPos.y, obsPos.z));
    if (!block || block.name !== 'obsidian') {
      log(`Block changed to: ${block?.name}`);
      continue;
    }

    // Navigate with canDig=true, high maxDropDown
    const mcMov = new Movements(bot);
    mcMov.canDig = true;
    mcMov.maxDropDown = 15; // Allow falling safely
    mcMov.allowFreeMotion = true;
    bot.pathfinder.setMovements(mcMov);

    const navResult = await Promise.race([
      bot.pathfinder.goto(new GoalNear(obsPos.x, obsPos.y, obsPos.z, 3)).then(() => true).catch(e => {
        log(`Nav err: ${e.message.substring(0, 80)}`);
        return false;
      }),
      sleep(30000).then(() => { bot.pathfinder.stop(); return false; })
    ]);

    if (!navResult) {
      log(`Could not reach (${obsPos.x},${obsPos.y},${obsPos.z}), trying next`);
      continue;
    }

    const botPos = bot.entity.position;
    log(`At: (${Math.round(botPos.x)},${Math.round(botPos.y)},${Math.round(botPos.z)})`);

    // Re-check block and mine
    const blockNow = bot.blockAt(new Vec3(obsPos.x, obsPos.y, obsPos.z));
    if (!blockNow || blockNow.name !== 'obsidian') {
      log(`Block no longer obsidian: ${blockNow?.name}`);
      continue;
    }

    // Equip diamond pickaxe before mining
    const pickNow = bot.inventory.items().find(i => i.name === 'diamond_pickaxe');
    if (pickNow) await bot.equip(pickNow, 'hand');

    log(`Mining...`);
    try {
      await bot.dig(blockNow);
      minedCount++;
      log(`Mined obsidian #${minedCount}! Total in inv: ${getCount('obsidian')}`);
      await sleep(200);
    } catch (e) {
      log(`Mining error: ${e.message}`);
    }
  }

  const obsidian = getCount('obsidian');
  log(`\n=== RESULT ===`);
  log(`Obsidian mined: ${obsidian}`);

  if (obsidian >= 4) {
    log(`\nHave enough obsidian! Now craft enchanting table...`);

    // Navigate to crafting table
    log(`Going to crafting table...`);
    const ctId = mcData.blocksByName['crafting_table'].id;
    const tables = bot.findBlocks({ matching: ctId, maxDistance: 100, count: 5 });

    let ctBlock = null;
    for (const t of tables) {
      const mcMov = new Movements(bot);
      mcMov.canDig = true;
      mcMov.maxDropDown = 10;
      bot.pathfinder.setMovements(mcMov);

      const ok = await Promise.race([
        bot.pathfinder.goto(new GoalNear(t.x, t.y, t.z, 3)).then(() => true).catch(() => false),
        sleep(30000).then(() => { bot.pathfinder.stop(); return false; })
      ]);

      if (ok) {
        ctBlock = bot.blockAt(new Vec3(t.x, t.y, t.z));
        if (ctBlock?.name === 'crafting_table') break;
      }
    }

    if (ctBlock?.name === 'crafting_table') {
      const etRecipes = bot.recipesFor(mcData.itemsByName['enchanting_table'].id, null, 1, ctBlock);
      log(`Enchanting table recipes: ${etRecipes.length}`);

      if (etRecipes.length > 0) {
        try {
          await bot.craft(etRecipes[0], 1, ctBlock);
          log(`!!! ENCHANTING TABLE CRAFTED !!!`);
          log(`Count: ${getCount('enchanting_table')}`);
          bot.chat('[報告] Phase 5 完了条件達成！ enchanting_table を作成しました！');
        } catch (e) {
          log(`Craft error: ${e.message}`);
        }
      }
    }
  } else {
    log(`Only got ${obsidian}/4 obsidian. Need more.`);
    log(`\nNearby obsidian coordinates for manual approach:`);
    sorted.slice(0, 5).forEach(b => log(`  (${b.x},${b.y},${b.z})`));
  }

  log(`\n=== FINAL INVENTORY ===`);
  bot.inventory.items().forEach(i => log(`  ${i.name} x${i.count}`));

  bot.quit();
});

bot.on('error', err => log(`Error: ${err.message}`));
bot.on('end', () => { log('Done'); process.exit(0); });
