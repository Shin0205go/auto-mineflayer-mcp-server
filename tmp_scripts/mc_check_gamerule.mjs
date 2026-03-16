/**
 * Check gamerule doTileDrops status
 * Also check if we can use /gamerule command
 */
import mineflayer from 'mineflayer';

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

bot.once('spawn', async () => {
  await sleep(1000);
  console.log('Pos:', bot.entity.position, 'HP:', bot.health);

  // Try to query gamerule
  console.log('\nQuerying gamerules...');
  bot.chat('/gamerule doTileDrops');
  await sleep(2000);
  bot.chat('/gamerule keepInventory');
  await sleep(2000);
  bot.chat('/gamerule doDaylightCycle');
  await sleep(1000);

  // Also send chat to human
  bot.chat('[報告] Block drops appear disabled (石を掘ってもcobblestoneが出ない)。doTileDrops=false？管理者確認要。');
  await sleep(1000);

  bot.end();
});

bot.on('message', (jsonMsg) => {
  console.log('MSG:', jsonMsg.toString());
});

bot.on('error', e => { console.error('Error:', e.message); process.exit(1); });
bot.on('end', () => process.exit(0));
