// ============================================================
// デモデータ（SalonOne APIキー未設定時）
// ------------------------------------------------------------
// 実際の店舗・スタッフ（Supabase の stores / staff）を使い、受付明細と
// 契約を「それらしく」シミュレーションする。シード付き乱数で決定的に
// 生成するので、同じ月は何度開いても同じ数字になる。
// 本番の SalonOne データと混ざらないよう、画面には必ず「デモ」表示を出す。
// ============================================================

import { addMonths, daysInMonth, addDays, monthsBetween, weekdayOf, monthOf } from '../../../shared/dates.js';

const BASE_MONTH = '2025-09'; // シミュレーション開始月（以降を順に積み上げる）

export const DEMO_SOURCES = [
  { name: 'ホットペッパー', w: 0.36 },
  { name: 'Meta広告', w: 0.17 },
  { name: 'ホームページ', w: 0.12 },
  { name: 'Minimo', w: 0.08 },
  { name: 'Instagram', w: 0.08 },
  { name: 'Threads', w: 0.04 },
  { name: '紹介', w: 0.09 },
  { name: 'Googleマップ', w: 0.06 },
];
const SNS = new Set(['Minimo', 'Instagram', 'Threads']);

const PLANS = [
  { name: '60分・月2回プラン', monthly: 15000, unit: 7500, w: 0.55 },
  { name: '75分・月2回プラン', monthly: 18000, unit: 9000, w: 0.45 },
];
const TICKET = { name: '回数券（5回）', price: 40000, sessions: 5, unit: 8000 };
const TRIAL_PRICE = 3980;
const DROP_IN_PRICE = 8800;

const SAMPLE_SHOPS = [
  { id: 'demo-1', name: '中央店' },
  { id: 'demo-2', name: '駅前店' },
];
const SAMPLE_STAFF = [
  { id: 'demo-s1', name: '佐藤', shopId: 'demo-1' },
  { id: 'demo-s2', name: '鈴木', shopId: 'demo-1' },
  { id: 'demo-s3', name: '高橋', shopId: 'demo-1' },
  { id: 'demo-s4', name: '田中', shopId: 'demo-2' },
  { id: 'demo-s5', name: '伊藤', shopId: 'demo-2' },
];

function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rng, lo, hi) => lo + (hi - lo) * rng();
const intBetween = (rng, lo, hi) => Math.floor(between(rng, lo, hi + 1));
const pickWeighted = (rng, items) => {
  const total = items.reduce((s, it) => s + it.w, 0);
  let x = rng() * total;
  for (const it of items) { x -= it.w; if (x <= 0) return it; }
  return items[items.length - 1];
};

/**
 * デモ用の店舗・スタッフ。Supabase の店舗/スタッフがあればそれを使う。
 * 施術スタッフのいない店舗には仮のスタッフを 2 名置く（SalonOne 側にしか
 * いないスタッフ = 未連携の行として表示される）。
 */
export function demoMaster(dbStores, dbStaff) {
  const shops = (dbStores || []).filter((s) => s && s.id).map((s) => ({ id: String(s.id), name: s.name || String(s.id) }));
  if (shops.length === 0) return { shops: SAMPLE_SHOPS, staff: SAMPLE_STAFF };
  const shopIds = new Set(shops.map((s) => s.id));
  const staff = [];
  for (const st of dbStaff || []) {
    if (!st || st.status === 'inactive' || st.role === 'headquarter') continue;
    const shopId = (st.storeIds || []).map(String).find((id) => shopIds.has(id));
    if (shopId) staff.push({ id: String(st.id), name: st.name || String(st.id), shopId });
  }
  for (const shop of shops) {
    if (staff.some((s) => s.shopId === shop.id)) continue;
    staff.push({ id: `demo-${shop.id}-1`, name: `${shop.name} スタッフA`, shopId: shop.id });
    staff.push({ id: `demo-${shop.id}-2`, name: `${shop.name} スタッフB`, shopId: shop.id });
  }
  return { shops, staff };
}

function workingDays(month, rng, offDays) {
  const days = [];
  const total = daysInMonth(month);
  for (let d = 1; d <= total; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    if (weekdayOf(date) === offDays) continue; // 定休日
    if (rng() < 0.08) continue; // 個人の休み
    days.push(date);
  }
  return days;
}

/** スタッフ 1人分のシミュレーション（BASE_MONTH から untilMonth まで） */
function simulateStaff(st, untilMonth, emitMonths, out) {
  const rng = mulberry32(hashSeed(`sise-demo:${st.id}`));
  // 会員数の定常値 ≒ 月間契約数 ÷ 退会率 になるよう、開始時点の会員数を近い値にしておく
  const trait = {
    newPerMonth: between(rng, 6, 11),
    conversion: between(rng, 0.32, 0.6),
    churn: between(rng, 0.06, 0.11),
    snsExtra: rng() < 0.4 ? between(rng, 8, 11) : 0, // SNS 集客が得意なスタッフ
    offDay: rng() < 0.5 ? 2 : 3, // 火 or 水 定休
  };
  const sources = DEMO_SOURCES.filter((s) => !SNS.has(s.name));
  const snsSources = DEMO_SOURCES.filter((s) => SNS.has(s.name));
  let seq = 0;
  const newCustomerId = () => `${st.id}-c${++seq}`;

  // 開始時点の既存会員（過去 1〜18ヶ月前に入会）
  const members = [];
  const initial = intBetween(rng, 30, 44);
  for (let i = 0; i < initial; i++) {
    const plan = pickWeighted(rng, PLANS);
    const startMonth = addMonths(BASE_MONTH, -intBetween(rng, 1, 18));
    const contract = {
      id: `${st.id}-k${seq + 1}`, customerId: newCustomerId(), shopId: st.shopId, staffId: st.id,
      type: 'subscription', planName: plan.name, isSharePlan: false,
      startDate: `${startMonth}-${String(intBetween(rng, 1, 28)).padStart(2, '0')}`, endDate: null,
    };
    out.contracts.push(contract);
    members.push({ contract, plan });
  }
  const dropIns = Array.from({ length: intBetween(rng, 7, 13) }, () => newCustomerId());
  const tickets = [];

  for (let month = BASE_MONTH; monthsBetween(month, untilMonth) >= 0; month = addMonths(month, 1)) {
    const emit = emitMonths.has(month);
    const days = workingDays(month, rng, trait.offDay);
    const pickDay = () => days[Math.floor(rng() * days.length)] || `${month}-01`;
    const pay = () => (rng() < 0.4 ? '現金' : rng() < 0.65 ? 'クレジットカード' : 'PayPay');
    const push = (r) => { if (emit) out.receptions.push({ shopId: st.shopId, staffId: st.id, status: 'completed', ...r }); };

    // 退会（当月中のどこかで終了）
    for (const m of members) {
      if (m.contract.endDate) continue;
      if (m.contract.startDate >= `${month}-01`) continue;
      if (rng() < trait.churn) m.contract.endDate = pickDay();
    }

    // 会員の来店（月2回）。最初の来店で月額を計上する
    for (const m of members) {
      const c = m.contract;
      for (let v = 0; v < 2; v++) {
        const date = pickDay();
        if (date < c.startDate || (c.endDate && date >= c.endDate)) continue;
        if (rng() < 0.15) continue; // たまに来られない（月平均 1.7回）
        push({
          customerId: c.customerId, date, customerClass: 'existing', sourceName: '',
          consumedAmount: m.plan.unit, salesAmount: v === 0 ? m.plan.monthly : 0,
          paymentMethod: 'クレジットカード',
        });
      }
    }

    // 回数券の消化
    for (const t of tickets) {
      if (t.left <= 0) continue;
      const visits = Math.min(t.left, rng() < 0.5 ? 1 : 2);
      for (let v = 0; v < visits; v++) {
        const date = pickDay();
        if (date <= t.since) continue;
        t.left -= 1;
        push({ customerId: t.customerId, date, customerClass: 'existing', sourceName: '', consumedAmount: TICKET.unit, salesAmount: 0, paymentMethod: '' });
      }
    }

    // 都度払いの常連
    for (const cid of dropIns) {
      if (rng() < 0.25) continue;
      push({ customerId: cid, date: pickDay(), customerClass: 'existing', sourceName: '', consumedAmount: DROP_IN_PRICE, salesAmount: DROP_IN_PRICE, paymentMethod: pay() });
    }

    // 新規（通常の媒体 + SNS が得意なスタッフは SNS 経由を上乗せ）
    const newCount = Math.max(0, Math.round(trait.newPerMonth * between(rng, 0.75, 1.25)));
    const snsCount = Math.max(0, Math.round(trait.snsExtra * between(rng, 0.7, 1.3)));
    for (let i = 0; i < newCount + snsCount; i++) {
      const customerId = newCustomerId();
      const source = pickWeighted(rng, i < newCount ? sources : snsSources).name;
      const first = pickDay();
      push({ customerId, date: first, customerClass: 'new', sourceName: source, consumedAmount: TRIAL_PRICE, salesAmount: TRIAL_PRICE, paymentMethod: pay(), referralStaffId: source === '紹介' ? st.id : '' });
      if (rng() < trait.conversion) {
        const atSecond = rng() < 0.3;
        const contractDate = atSecond ? addDays(first, intBetween(rng, 6, 14)) : first;
        if (atSecond && monthOf(contractDate) === month) {
          push({ customerId, date: contractDate, customerClass: 'existing', sourceName: source, consumedAmount: DROP_IN_PRICE, salesAmount: DROP_IN_PRICE, paymentMethod: pay() });
        }
        if (rng() < 0.82) {
          const plan = pickWeighted(rng, PLANS);
          const share = rng() < 0.05;
          const contract = {
            id: `${st.id}-k${seq}`, customerId, shopId: st.shopId, staffId: st.id, type: 'subscription',
            planName: share ? 'シェアプラン（ご家族）' : plan.name, isSharePlan: share, startDate: contractDate, endDate: null,
          };
          out.contracts.push(contract);
          members.push({ contract, plan });
        } else {
          out.contracts.push({ id: `${st.id}-k${seq}`, customerId, shopId: st.shopId, staffId: st.id, type: 'ticket', planName: TICKET.name, isSharePlan: false, startDate: contractDate, endDate: null });
          tickets.push({ customerId, left: TICKET.sessions - 1, since: contractDate });
        }
      } else if (rng() < 0.3) {
        dropIns.push(customerId);
      }
    }
  }
}

const cache = new Map();

/**
 * @param {{ shops:Array, staff:Array, months:string[], asOf:string }} p
 * @returns {{ receptions:Array, contracts:Array }}
 */
export function simulateDemo({ shops, staff, months, asOf }) {
  const asOfMonth = monthOf(asOf);
  const wanted = months.filter((m) => monthsBetween(m, asOfMonth) >= 0);
  const untilMonth = wanted.length ? wanted.reduce((a, b) => (a > b ? a : b)) : asOfMonth;
  const key = JSON.stringify([staff.map((s) => `${s.id}@${s.shopId}`), [...wanted].sort(), asOf]);
  if (cache.has(key)) return cache.get(key);

  const out = { receptions: [], contracts: [] };
  const emitMonths = new Set(wanted);
  const shopIds = new Set(shops.map((s) => s.id));
  for (const st of staff) {
    if (!shopIds.has(st.shopId)) continue;
    simulateStaff(st, monthsBetween(untilMonth, asOfMonth) >= 0 ? untilMonth : asOfMonth, emitMonths, out);
  }
  // 基準日より後は「まだ起きていない」ので落とす
  out.receptions = out.receptions.filter((r) => r.date <= asOf).map((r, i) => ({ id: `r${i + 1}`, ...r }));
  out.contracts = out.contracts
    .filter((c) => c.startDate <= asOf)
    .map((c) => ({ ...c, endDate: c.endDate && c.endDate <= asOf ? c.endDate : null }));

  if (cache.size > 30) cache.clear();
  cache.set(key, out);
  return out;
}
