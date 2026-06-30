/**
 * Generate a Telegram user-account session key (StringSession).
 *
 * Run this ON YOUR OWN MACHINE (a normal/residential connection), where Telegram
 * delivers the login code reliably — unlike the server. It logs in once
 * (phone + code, and 2FA password if you have one) and prints a session key.
 *
 * Then paste the key into the app:
 *   Settings → Integrations → Telegram → "Connect with session key".
 *
 * Usage (from apps/api):
 *   npx tsx scripts/generate-telegram-session.ts
 */
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

async function main() {
  const rl = readline.createInterface({ input, output });

  const apiId = Number((await rl.question('apiId: ')).trim());
  const apiHash = (await rl.question('apiHash: ')).trim();
  const phone = (await rl.question('Phone number (e.g. +1234567890): ')).trim();

  if (!apiId || !apiHash || !phone) {
    console.error('apiId, apiHash and phone number are all required.');
    process.exit(1);
  }

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => phone,
    phoneCode: async () => (await rl.question('Login code from Telegram: ')).trim(),
    password: async () => (await rl.question('2FA password (leave empty if none): ')).trim(),
    onError: (err) => console.error('Login error:', (err as Error)?.message ?? err),
  });

  const sessionKey = (client.session as StringSession).save();

  console.log('\n========================================');
  console.log('  Telegram session key — paste this into the app');
  console.log('========================================');
  console.log(sessionKey);
  console.log('========================================\n');

  await client.disconnect();
  rl.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
