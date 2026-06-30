/**
 * Generate a Telegram user-account session key (StringSession).
 *
 * Run this ON YOUR OWN MACHINE, where Telegram delivers the login code.
 * It logs in once (phone + code, and 2FA password if you have one) and prints
 * a session key to paste into the app:
 *   Settings → Integrations → Telegram → "Connect with session key".
 *
 * Usage (from apps/api):
 *   npx tsx scripts/generate-telegram-session.ts
 */
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { computeCheck } from 'telegram/Password.js';
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
  await client.connect();

  // Request the code via the raw API so we can show HOW Telegram delivers it.
  let sent;
  try {
    sent = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId,
        apiHash,
        settings: new Api.CodeSettings({}),
      }),
    );
  } catch (err) {
    console.error('\n>>> sendCode FAILED:', (err as Error)?.message ?? err);
    console.error('(A "wait of N seconds" message = FloodWait: this number had too');
    console.error(' many code requests. Wait that long, then try once.)');
    await client.disconnect();
    process.exit(1);
  }

  // `sent` is Api.auth.SentCode (or SentCodeSuccess for some flows).
  const anySent = sent as unknown as {
    phoneCodeHash?: string;
    type?: { className?: string };
    nextType?: { className?: string };
    timeout?: number;
  };
  console.log('\n========================================');
  console.log('  Telegram says it sent the code via:');
  console.log('   delivery type :', anySent.type?.className ?? '(unknown)');
  console.log('   next/fallback :', anySent.nextType?.className ?? '(none)');
  console.log('   timeout (s)   :', anySent.timeout ?? '(none)');
  console.log('========================================');
  console.log('  App  = look INSIDE the Telegram app (chat with "Telegram", 777000)');
  console.log('  Sms  = check your phone SMS');
  console.log('  Call = you will get a phone call reading the digits');
  console.log('========================================\n');

  const phoneCodeHash = anySent.phoneCodeHash;
  if (!phoneCodeHash) {
    console.error('No phoneCodeHash returned — cannot continue.');
    await client.disconnect();
    process.exit(1);
  }

  const code = (await rl.question('Login code (leave empty if it never arrived): ')).trim();
  if (!code) {
    console.error('\nNo code entered. See the delivery type above to find where it was sent.');
    await client.disconnect();
    process.exit(1);
  }

  try {
    await client.invoke(
      new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code }),
    );
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    if (msg.includes('SESSION_PASSWORD_NEEDED')) {
      const password = (await rl.question('2FA password: ')).trim();
      const pwd = await client.invoke(new Api.account.GetPassword());
      const check = await computeCheck(pwd, password);
      await client.invoke(new Api.auth.CheckPassword({ password: check }));
    } else {
      console.error('\nSign-in failed:', msg);
      await client.disconnect();
      process.exit(1);
    }
  }

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
