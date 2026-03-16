/**
 * Report current status and plan via chat
 */
import mineflayer from 'mineflayer';

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

bot.once('spawn', async () => {
  await sleep(3000);
  console.log('Pos:', bot.entity.position, 'HP:', bot.health, 'Food:', bot.food);
  console.log('Time:', bot.time.timeOfDay);

  // Check inventory
  const inv = bot.inventory.items();
  console.log('Inventory count:', inv.length);
  const diamonds = inv.filter(i => i.name === 'diamond');
  const obsidian = inv.filter(i => i.name === 'obsidian');
  const books = inv.filter(i => i.name === 'book');
  const wool = inv.filter(i => i.name.includes('wool'));
  console.log('diamonds:', diamonds.map(i => 'x'+i.count).join(' '));
  console.log('obsidian:', obsidian.map(i => 'x'+i.count).join(' '));
  console.log('books:', books.map(i => 'x'+i.count).join(' '));
  console.log('wool:', wool.map(i => i.name+' x'+i.count).join(' '));

  // Report status
  await bot.chat('[状況] Phase5 enchanting_table作成中。book必要(0/1)。doMobLootが無効なため食料・leather取得不可');
  await sleep(1000);
  await bot.chat('[管理者へ] サーバーコンソールで /gamerule doMobLoot true の実行をお願いします');
  await sleep(1000);
  await bot.chat('[計画] sugar_cane未発見。廃坑/ダンジョン探索でbook取得を試みます');

  console.log('Messages sent');
  bot.quit();
});

bot.on('error', (err) => console.error('Bot error:', err.message));
bot.on('kicked', (reason) => console.log('Kicked:', reason));
