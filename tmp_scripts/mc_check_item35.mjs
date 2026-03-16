/**
 * Quick check: what is item ID 35 and check current inventory
 */
import mineflayer from 'mineflayer';

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

bot.once('spawn', async () => {
  await sleep(2000);
  console.log('Pos:', bot.entity.position, 'HP:', bot.health);

  // Look up item by ID 35
  const item35 = bot.registry.items[35];
  console.log('Item ID 35:', item35?.name, JSON.stringify(item35));

  // Check all items around ID 35
  for (let id = 30; id <= 40; id++) {
    const item = bot.registry.items[id];
    if (item) console.log(`Item ${id}: ${item.name}`);
  }

  // Check raw_iron item ID
  const rawIronId = bot.registry.itemsByName['raw_iron']?.id;
  console.log('\nraw_iron item ID:', rawIronId);
  const ironOreId = bot.registry.blocksByName['iron_ore']?.id;
  console.log('iron_ore block ID:', ironOreId);

  // Current inventory
  console.log('\nFull inventory:');
  bot.inventory.items().forEach(i => console.log(` id=${i.type} ${i.name}x${i.count}`));

  // Count raw_iron
  const raw = bot.inventory.items().find(i => i.name === 'raw_iron');
  console.log('\nraw_iron:', raw ? raw.count : 0);

  bot.end();
});

bot.on('error', e => { console.error(e.message); process.exit(1); });
bot.on('end', () => process.exit(0));
