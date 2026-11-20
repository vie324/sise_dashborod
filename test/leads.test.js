// 新規台帳の「契約できなかった理由」: 選択肢（タブ）とメモ、前の形の記録（理由の文にタブをつないでいた）の読み方
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOST_REASONS, cleanReasonTags, splitReasonText, reasonPartsOf } from '../shared/leads.js';

test('理由の選択肢: 追加した 5つを含む 11個', () => {
  assert.equal(LOST_REASONS.length, 11);
  for (const r of ['イベント直前', '旅行中', '仕事・家庭の都合', '開始時期を改めたい', '必要性を感じさせられなかった']) assert.ok(LOST_REASONS.includes(r), r);
});

test('タブは選択肢にあるものだけ・重なりなく・選択肢の順', () => {
  assert.deepEqual(cleanReasonTags(['旅行中', 'x', '料金が合わない', '旅行中', ' イベント直前 ']), ['料金が合わない', 'イベント直前', '旅行中']);
  assert.deepEqual(cleanReasonTags(null), []);
});

test('前の形の理由の文: タブだけの行はタブに、それ以外の行はそのままメモに', () => {
  assert.deepEqual(splitReasonText('料金が合わない・家族と相談'), { tags: ['料金が合わない', '家族と相談'], memo: '' });
  // 「・」を含む選択肢もつなぎ直して拾う
  assert.deepEqual(splitReasonText('通う時間・頻度が合わない・仕事・家庭の都合'), { tags: ['通う時間・頻度が合わない', '仕事・家庭の都合'], memo: '' });
  assert.deepEqual(splitReasonText('料金が合わない。\n家族と相談する'), { tags: [], memo: '料金が合わない。\n家族と相談する' });
  assert.deepEqual(splitReasonText('料金が合わない・月1なら考える'), { tags: [], memo: '料金が合わない・月1なら考える' });
  assert.deepEqual(splitReasonText('他店と比べたい\n来年また来るかも'), { tags: ['他店と比べたい'], memo: '来年また来るかも' });
  assert.deepEqual(splitReasonText(''), { tags: [], memo: '' });
});

test('記録の理由: 新しい記録は reasons とメモ、契約できた記録は理由なし', () => {
  assert.deepEqual(reasonPartsOf({ outcome: 'lost', reasons: ['旅行中', 'x'], reason: '来月' }), { tags: ['旅行中'], memo: '来月' });
  assert.deepEqual(reasonPartsOf({ outcome: 'lost', reason: '旅行中・家族と相談' }), { tags: ['家族と相談', '旅行中'], memo: '' });
  assert.deepEqual(reasonPartsOf({ outcome: 'contracted', plan: '月2回プラン', reasons: ['旅行中'] }), { tags: [], memo: '' });
});
