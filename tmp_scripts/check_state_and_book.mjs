/**
 * Check bot state and explore all possible book sources:
 * 1. Check if doEntityDrops was fixed by admin
 * 2. Check inventory for any book-related items
 * 3. Look for villages nearby (librarian trader = books)
 * 4. Look for strongholds/libraries
 * 5. Check nearby structures for bookshelves
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNear, GoalBlock, GoalXZ } = goals;

const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'Claude1',
  version: '1.21.4'
});
bot.loadPlugin(pathfinder);

const log = (msg) => {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] ${msg}`);
  require('fs').appendFileSync('/tmp/check_state.log', `[${timestamp}] ${msg}\n`);
};

bot.once('spawn', async () => {
  await new Promise(r => setTimeout(r, 2000));

  const pos = bot.entity.position;
  log(`=== BOT STATE ===`);
  log(`HP: ${bot.health} Food: ${bot.food}`);
  log(`Pos: ${JSON.stringify({x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z)})}`);

  // Check inventory for books
  log(`\n=== INVENTORY ===`);
  const items = bot.inventory.items();
  items.forEach(item => log(`  ${item.name} x${item.count}`));

  // Look for book in inventory
  const book = items.find(i => i.name === 'book' || i.name === 'writable_book' || i.name === 'written_book');
  if (book) {
    log(`\n!!! HAVE BOOK: ${book.name} x${book.count} !!!`);
  }

  // Test if entity drops work now
  log(`\n=== TESTING ENTITY DROPS STATUS ===`);
  log(`Checking gamerule by spawning a fish test...`);

  // Check chat for admin messages
  bot.chat('/gamerule doEntityDrops');
  await new Promise(r => setTimeout(r, 1000));
  bot.chat('/gamerule doMobLoot');
  await new Promise(r => setTimeout(r, 1000));

  // Scan for structures - look for villages, strongholds
  log(`\n=== SCANNING FOR STRUCTURES ===`);
  log(`Scanning for bookshelves within 300 blocks...`);

  const mcData = require('minecraft-data')(bot.version);
  const bookshelfBlock = mcData.blocksByName['bookshelf'];
  const lecternBlock = mcData.blocksByName['lectern'];

  if (bookshelfBlock) {
    const bookshelves = bot.findBlocks({
      matching: bookshelfBlock.id,
      maxDistance: 300,
      count: 5
    });
    log(`Bookshelves found within 300 blocks: ${bookshelves.length}`);
    bookshelves.forEach(b => log(`  Bookshelf at ${JSON.stringify(b)}`));
  }

  if (lecternBlock) {
    const lecterns = bot.findBlocks({
      matching: lecternBlock.id,
      maxDistance: 300,
      count: 5
    });
    log(`Lecterns found: ${lecterns.length}`);
  }

  // Check for chests we haven't opened
  const chestBlock = mcData.blocksByName['chest'];
  if (chestBlock) {
    const chests = bot.findBlocks({
      matching: chestBlock.id,
      maxDistance: 200,
      count: 20
    });
    log(`\nChests within 200 blocks: ${chests.length}`);
    chests.forEach(c => log(`  Chest at ${JSON.stringify(c)}`));
  }

  // Check for villagers
  log(`\n=== NEARBY ENTITIES ===`);
  const entities = Object.values(bot.entities);
  const mobs = entities.filter(e => e.type === 'mob' || e.type === 'animal' || e.type === 'villager');
  log(`Nearby mobs/animals/villagers within render distance:`);
  mobs.slice(0, 20).forEach(e => {
    const d = e.position.distanceTo(bot.entity.position);
    if (d < 200) log(`  ${e.name || e.type} at ${JSON.stringify({x: Math.round(e.position.x), y: Math.round(e.position.y), z: Math.round(e.position.z)})} dist=${Math.round(d)}`);
  });

  // Check for enchanting table materials in inventory
  log(`\n=== PHASE 5 STATUS ===`);
  const inv = {};
  items.forEach(i => { inv[i.name] = (inv[i.name] || 0) + i.count; });
  log(`diamonds: ${inv['diamond'] || 0}/2 needed`);
  log(`obsidian: ${inv['obsidian'] || 0}/4 needed`);
  log(`book: ${inv['book'] || 0}/1 needed`);

  // If we have diamonds but not obsidian, can we find lava/water to make obsidian?
  if ((inv['obsidian'] || 0) < 4) {
    log(`\n=== LOOKING FOR LAVA ===`);
    const lavaBlock = mcData.blocksByName['lava'];
    if (lavaBlock) {
      const lava = bot.findBlocks({
        matching: lavaBlock.id,
        maxDistance: 100,
        count: 3
      });
      log(`Lava found within 100 blocks: ${lava.length}`);
      lava.forEach(l => log(`  Lava at ${JSON.stringify(l)}`));
    }
  }

  log(`\nState check complete. Disconnecting...`);
  bot.quit();
});

bot.on('message', (msg) => {
  const text = msg.toString();
  if (text.includes('doEntityDrops') || text.includes('doMobLoot') || text.includes('gamerule')) {
    log(`GAMERULE: ${text}`);
  }
});

bot.on('error', (err) => log(`Error: ${err.message}`));
bot.on('end', () => { log('Bot disconnected'); process.exit(0); });
