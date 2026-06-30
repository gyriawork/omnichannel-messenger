/**
 * Generate a Telegram user-account session key (StringSession) via QR login.
 *
 * No verification code is used. It prints a QR in the terminal — scan it with
 * the Telegram app (Settings → Devices → Link Desktop Device). It then prints a
 * session key to paste into the app:
 *   Settings → Integrations → Telegram → "Advanced: connect with a session key".
 *
 * (The app also has built-in QR login; this script is a local fallback.)
 *
 * Usage (from apps/api):
 *   npx tsx scripts/generate-telegram-session.ts
 */
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import QRCode from 'qrcode';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

async function main() {
  const rl = readline.createInterface({ input, output });

  const apiId = Number((await rl.question('apiId: ')).trim());
  const apiHash = (await rl.question('apiHash: ')).trim();

  if (!apiId || !apiHash) {
    console.error('apiId and apiHash are required.');
    process.exit(1);
  }

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
  });
  await client.connect();

  await client.signInUserWithQrCode(
    { apiId, apiHash },
    {
      qrCode: async (code: { token: Buffer }) => {
        const url = `tg://login?token=${Buffer.from(code.token).toString('base64url')}`;
        const ascii = await QRCode.toString(url, { type: 'terminal', small: true });
        console.log('\nScan this QR in Telegram → Settings → Devices → Link Desktop Device:\n');
        console.log(ascii);
        console.log('(The QR refreshes every ~30s; just scan the latest one.)\n');
      },
      password: async () => (await rl.question('2FA password: ')).trim(),
      onError: (err: Error) => {
        console.error('QR login error:', err?.message ?? err);
        return true;
      },
    },
  );

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
