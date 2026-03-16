/**
 * Quick status check: current position, HP, hunger, inventory
 */
import mineflayer from 'mineflayer';

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});

bot.once('spawn', async () => {
  await new Promise(r => setTimeout(r, 2000));
  console.log('Position:', Math.round(bot.entity.position.x), Math.round(bot.entity.position.y), Math.round(bot.entity.position.z));
  console.log('HP:', bot.health, 'Hunger:', bot.food);

  const inv = bot.inventory.items();
  console.log('\nInventory:');
  inv.forEach(i => console.log(` ${i.name} x${i.count}`));

  // Check for animals in loaded area
  const animals = Object.values(bot.entities).filter(e =>
    ['pig', 'sheep', 'cow', 'chicken'].includes(e.name)
  );
  console.log('\nAnimals visible:', animals.length);
  animals.slice(0, 10).forEach(a => {
    const d = Math.round(a.position.distanceTo(bot.entity.position));
    console.log(` ${a.name} dist=${d} at ${Math.round(a.position.x)},${Math.round(a.position.y)},${Math.round(a.position.z)}`);
  });

  // Check sugar cane
  const sc = bot.findBlock({ matching: bot.registry.blocksByName['sugar_cane']?.id, maxDistance: 100 });
  console.log('\nSugar cane nearby:', sc ? sc.position : 'none');

  // Check crafting table
  const ct = bot.findBlock({ matching: bot.registry.blocksByName['crafting_table']?.id, maxDistance: 30 });
  console.log('Crafting table:', ct ? ct.position : 'none');

  const furnace = bot.findBlock({ matching: bot.registry.blocksByName['furnace']?.id, maxDistance: 30 });
  console.log('Furnace:', furnace ? furnace.position : 'none');

  bot.end();
});

bot.on('error', e => { console.error('Bot error:', e.message); process.exit(1); });
bot.on('end', () => { console.log('\nDone.'); process.exit(0); });
