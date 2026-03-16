/**
 * Check portal status, rebuild if needed, get leather from Nether (hoglins)
 * Portal area at approximately (-2, 111, -5)
 * Original portal was at y=110-114
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalNear, GoalBlock } = goals;

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

bot.once('spawn', async () => {
  await sleep(1500);
  console.log('Position:', bot.entity.position, 'HP:', bot.health, 'Hunger:', bot.food);

  // Look for nether portal blocks
  const portalBlock = bot.findBlock({
    matching: bot.registry.blocksByName['nether_portal']?.id,
    maxDistance: 50
  });
  console.log('Nether portal active:', portalBlock ? 'YES at ' + portalBlock.position : 'NO');

  // Look for obsidian blocks (portal frame)
  const obsidianBlocks = bot.findBlocks({
    matching: bot.registry.blocksByName['obsidian']?.id,
    maxDistance: 50,
    count: 20
  });
  console.log('\nObsidian blocks nearby:', obsidianBlocks.length);
  obsidianBlocks.forEach(p => console.log(` ${p.x},${p.y},${p.z}`));

  // Check what's at typical portal positions
  console.log('\nChecking portal area blocks:');
  for (let y = 108; y <= 116; y++) {
    for (let x = 7; x <= 11; x++) {
      const block = bot.blockAt({ x, y, z: 2 });
      if (block && block.name !== 'air') {
        console.log(` (${x},${y},2): ${block.name}`);
      }
    }
  }

  // Check inventory for obsidian
  const obs = bot.inventory.items().find(i => i.name === 'obsidian');
  console.log('\nObsidian in inventory:', obs ? obs.count : 0);
  console.log('Diamond in inventory:', bot.inventory.items().find(i => i.name === 'diamond')?.count || 0);

  bot.end();
});

bot.on('error', e => { console.error('Bot error:', e.message); process.exit(1); });
bot.on('end', () => { process.exit(0); });
