// si'se Dashboard — E2E smoke tests
// 目的: デプロイ直後に最小限の動作確認を自動化
//       (詳細テストは手動・ステージング環境で)
//
// 実行:
//   PLAYWRIGHT_BASE_URL=https://your-preview.vercel.app npx playwright test

import { test, expect } from '@playwright/test';

test.describe('基本起動', () => {
  test('ダッシュボードが表示される (admin mode, ?v= 無し)', async ({ page }) => {
    await page.goto('/');
    // アプリタイトルが head に入っているはず
    await expect(page).toHaveTitle(/si'se/i);
    // React がマウントして root の中身が描画されるまで待機
    // (ログイン画面 or ダッシュボードのどちらかが出るまで)
    await page.waitForFunction(() => {
      const root = document.getElementById('root');
      return root && root.children.length > 0;
    }, { timeout: 15000 });
  });

  test('manifest.json が返される', async ({ request }) => {
    const resp = await request.get('/manifest.json');
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(data.name).toContain("si'se");
    expect(data.icons.length).toBeGreaterThan(0);
  });

  test('service worker が返される', async ({ request }) => {
    const resp = await request.get('/sw.js');
    expect(resp.status()).toBe(200);
    const body = await resp.text();
    expect(body).toContain('CACHE_NAME');
  });
});

test.describe('API smoke', () => {
  test('GET /api/db?table=auth (session 状態)', async ({ request }) => {
    const resp = await request.get('/api/db?table=auth');
    // 200 + requiresAuth/authenticated フィールドが返る想定
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(data).toHaveProperty('requiresAuth');
    expect(data).toHaveProperty('authenticated');
  });

  test('GET /api/db?table=INVALID は 400', async ({ request }) => {
    const resp = await request.get('/api/db?table=NO_SUCH_TABLE');
    expect(resp.status()).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain('不明なtable');
    expect(Array.isArray(data.available)).toBeTruthy();
  });

  test('POST /api/db?table=auth action=login は未設定時 error', async ({ request }) => {
    // SISE_ADMIN_PASSWORD_HASH が未設定の環境では error が返る想定
    // 設定済み環境でも「パスワードが正しくありません」が返って 200 内 error として
    // 受け取る (login アクション自体は 200 を返し、body.error で失敗を示す)
    const resp = await request.post('/api/db?table=auth', {
      data: { action: 'login', password: 'obviously_wrong_password_' + Date.now() },
    });
    const data = await resp.json();
    // どちらのシナリオでも error フィールドがあるはず
    expect(data.error).toBeTruthy();
  });
});

test.describe('静的アセット', () => {
  test('PWA アイコン 192/512 が配信される', async ({ request }) => {
    const r192 = await request.get('/images/icon-192.png');
    expect(r192.status()).toBe(200);
    expect(r192.headers()['content-type']).toContain('image/png');
    const r512 = await request.get('/images/icon-512.png');
    expect(r512.status()).toBe(200);
  });
});

test.describe('認証・権限', () => {
  test('不正な staff token は 401', async ({ request }) => {
    // 偽造された signed token (payload.signature 不一致)
    const fakeToken = btoa(JSON.stringify({ id: 's1', n: 'fake', r: 'staff', sid: ['x'] })) + '.invalidsig';
    const resp = await request.get('/api/db?table=cashbook', {
      headers: { 'X-Staff-Token': fakeToken, 'X-Staff-Id': 's1' },
    });
    expect(resp.status()).toBe(401);
    const data = await resp.json();
    expect(data.error).toContain('認証エラー');
  });
});
