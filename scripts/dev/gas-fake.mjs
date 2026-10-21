// ============================================================
// 疑似カウンセリング GAS（ローカル開発・テスト用。本番では使わない）
// ------------------------------------------------------------
// gas/counseling.gs と同じ形で、架空のお客様のカウンセリングシートを返す。
//   ?type=counseling&action=stores | recent&store=&limit= | search&store=&q= | detail&store=&index=|name=
// 回答の日時は「今」からの相対（一番新しい回答はいつ開いても十数分前）。
// 開発中に「新しい回答が届いた」状態を試す:  ?type=counseling&action=_submit&store=honatsugi&name=新井 ゆい
//
// 単体で動かす:
//   node scripts/dev/gas-fake.mjs --port 4200
//   COUNSELING_GAS_URL=http://127.0.0.1:4200/exec npm run dev:local
// （npm run dev:local は COUNSELING_GAS_URL が無ければ自動でこれを使う）
// ============================================================

import http from 'node:http';
import { fileURLToPath } from 'node:url';

export const FAKE_GAS_TOKEN = 'fake-gas-token';

const STORES = {
  honatsugi: 'カウンセリング回答_本厚木店',
  yamato: 'カウンセリング回答_大和店',
  yokohama: 'カウンセリング回答_横浜店',
  machida: 'カウンセリング回答_町田店',
  kawaguchi: 'カウンセリング回答_川口店',
};

const DISCLAIMER = '上記の内容を理解し、施術をうけることに同意します';
const NO = 'いいえ';

// minutesAgo: 回答した時刻（今から何分前）。シートの行の順（古い → 新しい）で並べる
const ROWS = {
  honatsugi: [
    { minutesAgo: 60 * 24 * 9, name: '佐々木 恵', concerns: ['産後の骨盤', 'その他'], birthday: '1990-02-11', occupation: '主婦', address: '厚木市', visitPurpose: ['Instagram'], improvementTimeline: '半年くらい', treatmentRequest: '', treatmentExperience: [], surgeryHistory: NO, currentTreatment: NO, allergy: NO, cosmeticSurgery: '産後3ヶ月', pregnancyCheck: NO },
    { minutesAgo: 60 * 24 * 6, name: '吉田 真央', concerns: ['眼精疲労', '頭・はちの張り', '肩こり'], birthday: '1996-11-30', occupation: 'デザイナー', address: '海老名市', visitPurpose: ['ホットペッパービューティー'], improvementTimeline: '1ヶ月以内', treatmentRequest: '目の疲れがひどいので頭まわりを重点的に', treatmentExperience: ['ヘッドスパ'], surgeryHistory: NO, currentTreatment: NO, allergy: NO, cosmeticSurgery: NO, pregnancyCheck: NO },
    { minutesAgo: 60 * 24 * 3 + 40, name: '加藤 由紀', concerns: ['反り腰', '腰痛', '股関節', 'O脚'], birthday: '1985-07-02', occupation: '看護師', address: '伊勢原市', visitPurpose: ['ご紹介'], improvementTimeline: '3ヶ月以内', treatmentRequest: '立ち仕事で腰がつらいです', treatmentExperience: ['整骨院', DISCLAIMER], surgeryHistory: NO, currentTreatment: '整形外科に通院中（腰椎）', allergy: NO, cosmeticSurgery: NO, pregnancyCheck: NO },
    { minutesAgo: 60 * 26, name: '中村 あかり', concerns: ['頬のたるみ', '食いしばり', '顔の左右差', 'むくみ'], birthday: '1993-09-21', occupation: '販売', address: '厚木市', visitPurpose: ['Instagram', 'ホームページ'], improvementTimeline: '結婚式（2ヶ月後）までに', treatmentRequest: 'フェイスラインをすっきりさせたい', treatmentExperience: ['エステ'], surgeryHistory: NO, currentTreatment: NO, allergy: NO, cosmeticSurgery: NO, pregnancyCheck: 'ヒアルロン酸注射（1年前）' },
    { minutesAgo: 60 * 24 + 30, name: '小林 美穂', concerns: ['腰痛', '骨盤の歪み', '冷え・むくみ', '下半身太り', '生理痛・生理不順'], birthday: '1988-05-14', occupation: '会社員', address: '平塚市', visitPurpose: ['ホットペッパービューティー'], improvementTimeline: '3ヶ月以内', treatmentRequest: '', treatmentExperience: ['整体', 'マッサージ'], surgeryHistory: '帝王切開（2021年）', currentTreatment: NO, allergy: 'なし', cosmeticSurgery: '該当なし', pregnancyCheck: 'なし' },
    { minutesAgo: 95, name: '高木 ゆかり', concerns: ['肩こり', '首の痛み'], birthday: '1979-12-03', occupation: '事務', address: '厚木市', visitPurpose: ['チラシ'], improvementTimeline: '', treatmentRequest: '', treatmentExperience: [], surgeryHistory: NO, currentTreatment: NO, allergy: NO, cosmeticSurgery: NO, pregnancyCheck: NO },
    { minutesAgo: 14, name: '山本 さくら', concerns: ['肩こり', '姿勢・猫背', 'ストレートネック', '頭痛'], birthday: '1992-04-18', occupation: '会社員（デスクワーク）', address: '厚木市', visitPurpose: ['ホットペッパービューティー'], improvementTimeline: '3ヶ月以内', treatmentRequest: '強すぎない圧でお願いしたいです', treatmentExperience: ['整体', 'マッサージ', DISCLAIMER], surgeryHistory: NO, currentTreatment: NO, allergy: '金属アレルギー', cosmeticSurgery: NO, pregnancyCheck: NO },
  ],
  yamato: [
    { minutesAgo: 60 * 24 * 2, name: '井上 彩', concerns: ['X脚', '下半身太り'], birthday: '2000-03-08', occupation: '学生', address: '大和市', visitPurpose: ['TikTok'], improvementTimeline: '夏までに', treatmentRequest: '', treatmentExperience: [], surgeryHistory: NO, currentTreatment: NO, allergy: NO, cosmeticSurgery: NO, pregnancyCheck: NO },
    { minutesAgo: 50, name: '松本 理沙', concerns: ['猫背', '肩こり', '腰痛'], birthday: '1991-06-25', occupation: '保育士', address: '座間市', visitPurpose: ['ホットペッパービューティー'], improvementTimeline: '3ヶ月以内', treatmentRequest: '', treatmentExperience: ['整体'], surgeryHistory: NO, currentTreatment: NO, allergy: 'ラテックス', cosmeticSurgery: NO, pregnancyCheck: NO },
  ],
  yokohama: [
    { minutesAgo: 60 * 5, name: '清水 なつみ', concerns: ['眼精疲労', '顔の左右差'], birthday: '1987-10-10', occupation: '会社員', address: '横浜市', visitPurpose: ['ホームページ'], improvementTimeline: '', treatmentRequest: '', treatmentExperience: [], surgeryHistory: NO, currentTreatment: NO, allergy: NO, cosmeticSurgery: NO, pregnancyCheck: NO },
  ],
  machida: [],
  kawaguchi: [],
};

// 開発中に「回答が届いた」行（プロセスが動いている間だけ）
const submitted = Object.fromEntries(Object.keys(STORES).map((k) => [k, []]));

function rowsOf(store) {
  const now = Date.now();
  return [...(ROWS[store] || []), ...(submitted[store] || [])].map((r, index) => ({
    ...r,
    index,
    timestamp: new Date(r.at || now - r.minutesAgo * 60 * 1000).toISOString(),
  }));
}

const listRow = (r) => ({ index: r.index, name: r.name, timestamp: r.timestamp, concerns: r.concerns });
const sortNew = (rows) => rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

/**
 * @param {URL} url
 * @param {{ token?: string }} [opts] token を指定すると、合言葉の無い呼び出しを断る（GAS の DASHBOARD_TOKEN と同じ）
 * @returns {{ status:number, body:any }}
 */
export function fakeGas(url, { token } = {}) {
  const p = url.searchParams;
  const ok = (body) => ({ status: 200, body });
  if (token && p.get('token') !== token) return ok({ error: 'unauthorized', code: 'unauthorized' });
  if ((p.get('type') || 'counseling') !== 'counseling') return ok({ error: 'このエンドポイントはカウンセリングデータ専用です (type=counseling)。' });
  const action = p.get('action') || 'list';
  if (action === 'stores') {
    return ok({ stores: Object.keys(STORES).map((id) => ({ id, name: STORES[id].replace('カウンセリング回答_', '') })) });
  }
  const store = p.get('store') || '';
  if (!STORES[store]) return ok({ error: `店舗を指定してください（store=${Object.keys(STORES).join('|')}）` });
  const _debug = { sheetName: STORES[store], headers: ['0:タイムスタンプ', '1:お名前'] };
  const rows = rowsOf(store);
  switch (action) {
    case 'list':
    case 'recent': {
      const limit = parseInt(p.get('limit'), 10) || 20;
      const customers = sortNew(rows.map(listRow)).slice(0, action === 'list' ? undefined : limit);
      return ok({ store, _debug, customers, total: customers.length, lastUpdated: new Date().toISOString() });
    }
    case 'search': {
      const q = p.get('q') || '';
      if (!q) return ok({ store, _debug, customers: [], total: 0 });
      const customers = sortNew(rows.filter((r) => r.name.includes(q)).map(listRow));
      return ok({ store, _debug, customers, total: customers.length, lastUpdated: new Date().toISOString() });
    }
    case 'detail': {
      let row = null;
      if (p.has('index') && p.get('index') !== '') row = rows[parseInt(p.get('index'), 10)] || null;
      else if (p.get('name')) row = [...rows].reverse().find((r) => r.name === p.get('name')) || null;
      if (!row) return ok({ store, _debug, error: '顧客が見つかりません', customer: null });
      const { minutesAgo, at, ...rest } = row;
      return ok({ store, _debug, customer: { ...rest, phone: '090-0000-0000', email: 'customer@example.com', _rawConcerns: rest.concerns.join(', ') } });
    }
    case '_submit': {
      const name = p.get('name') || `新規 ${submitted[store].length + 1}`;
      submitted[store].push({ at: Date.now(), name, concerns: (p.get('concerns') || '肩こり,腰痛').split(','), birthday: '', occupation: '', address: '', visitPurpose: [], improvementTimeline: '', treatmentRequest: '', treatmentExperience: [], surgeryHistory: NO, currentTreatment: NO, allergy: NO, cosmeticSurgery: NO, pregnancyCheck: NO });
      return ok({ success: true, store, name });
    }
    default:
      return ok({ error: '不明なアクション: ' + action });
  }
}

/** fetch の代わり（テストで globalThis.fetch に差し込む） */
export function fakeGasFetch(calls = [], opts = {}) {
  return async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    const res = fakeGas(url, opts);
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  };
}

// 単体起動
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf('--port');
  const port = i > 0 ? Number(process.argv[i + 1]) : 4200;
  http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const out = fakeGas(url);
    console.log(req.method, url.pathname + url.search, out.status);
    res.writeHead(out.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(out.body));
  }).listen(port, () => console.log(`疑似カウンセリング GAS: http://127.0.0.1:${port}/exec`));
}
