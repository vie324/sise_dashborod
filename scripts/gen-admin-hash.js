#!/usr/bin/env node
/**
 * 管理者パスワードの bcrypt ハッシュを生成する簡易スクリプト。
 *
 * 使い方:
 *   node scripts/gen-admin-hash.js
 *   → 対話式でパスワードを入力するとハッシュを出力
 *
 * または:
 *   node scripts/gen-admin-hash.js 'your_password'
 *   → 引数でパスワードを渡すと即出力（履歴に残るので注意）
 *
 * 出力された $2b$10$... 形式の文字列を Vercel Dashboard の
 * Environment Variables > SISE_ADMIN_PASSWORD_HASH に設定する。
 */

import bcrypt from 'bcryptjs';
import readline from 'node:readline';

const ROUNDS = 10;

async function prompt(question, { mask = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (mask) {
      // stdin を raw にして入力を隠す簡易マスキング
      process.stdout.write(question);
      const chars = [];
      const onData = (buf) => {
        const ch = buf.toString('utf8');
        if (ch === '\n' || ch === '\r' || ch === '') {
          process.stdin.off('data', onData);
          process.stdin.setRawMode(false);
          process.stdout.write('\n');
          rl.close();
          resolve(chars.join(''));
        } else if (ch === '') { // Ctrl+C
          process.stdout.write('\n');
          process.exit(130);
        } else if (ch === '' || ch === '') { // backspace
          if (chars.length) { chars.pop(); process.stdout.write('\b \b'); }
        } else {
          chars.push(ch);
          process.stdout.write('*');
        }
      };
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', onData);
    } else {
      rl.question(question, (answer) => { rl.close(); resolve(answer); });
    }
  });
}

async function main() {
  let password = process.argv[2];
  if (!password) {
    password = await prompt('管理者パスワードを入力してください: ', { mask: true });
    const confirm = await prompt('もう一度入力してください: ', { mask: true });
    if (password !== confirm) {
      console.error('\n❌ パスワードが一致しません。');
      process.exit(1);
    }
  }
  if (!password || password.length < 8) {
    console.error('❌ パスワードは 8 文字以上にしてください。');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, ROUNDS);
  console.log('\n✅ bcrypt ハッシュを生成しました:\n');
  console.log(hash);
  console.log('\n次の手順:');
  console.log('  1. 上の文字列をコピー');
  console.log('  2. Vercel Dashboard > Project Settings > Environment Variables で');
  console.log('     SISE_ADMIN_PASSWORD_HASH として設定');
  console.log('  3. 再デプロイ（次回デプロイから有効化）');
  console.log('  4. 動作確認後、REQUIRE_ADMIN_AUTH=true に切替\n');
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
