// ============================================================
// ローカル開発用のメモリ上の疑似 Supabase（本番では使わない）
// ------------------------------------------------------------
// api/_lib の各ハンドラが使うクエリビルダーの範囲だけを実装する:
//   from().select().eq().neq().in().gte().lte().gt().lt().order().range().limit()
//   .maybeSingle().single() / insert() / upsert() / update() / delete()
// データは .dev-data/db.json に保存し、再起動しても残る。
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { mandalaSeed, MANDALA_KEYS } from './mandala-seed.mjs';

const KEYS = {
  stores: ['id'],
  staff: ['id'],
  staff_stores: ['staff_id', 'store_id'],
  dash_config: ['key'],
  menu_items: ['id'],
  cashbook: ['id'],
  cashbook_log: ['id'],
  daily_close: ['date', 'store_id'],
  ...MANDALA_KEYS,
};

const DEFAULTS = {
  stores: () => ({ status: 'active', memo: '', merged_into: null, created_at: new Date().toISOString() }),
  staff: () => ({ role: 'staff', password: '', status: 'active', created_at: new Date().toISOString() }),
  menu_items: () => ({ category: '', item_type: 'menu', active: true, created_at: new Date().toISOString() }),
  cashbook: () => ({ created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted: false, notes: '', customer_name: '', member_id: '' }),
  cashbook_log: () => ({ timestamp: new Date().toISOString() }),
  daily_close: () => ({ locked: false, notes: '' }),
};

// 外部キー（存在しない店舗を参照したら 23503）
const FK = {
  staff_stores: [['store_id', 'stores', 'id'], ['staff_id', 'staff', 'id']],
  cashbook: [['store_id', 'stores', 'id']],
  daily_close: [['store_id', 'stores', 'id']],
  mandala_charts: [['staff_id', 'staff', 'id']],
  mandala_weekly_reviews: [['staff_id', 'staff', 'id']],
  mandala_daily_reports: [['staff_id', 'staff', 'id']],
  mandala_members: [['staff_id', 'staff', 'id']],
  mandala_daily_check_items: [['store_id', 'stores', 'id']],
};

export function seedData() {
  const now = new Date().toISOString();
  return {
    stores: [
      { id: 'store-1', name: '中央店', status: 'active', memo: '', merged_into: null, created_at: now },
      { id: 'store-2', name: '駅前店', status: 'active', memo: '', merged_into: null, created_at: now },
    ],
    staff: [
      { id: 'st-sato', name: '佐藤 美咲', role: 'staff', password: '', status: 'active', created_at: now },
      { id: 'st-suzuki', name: '鈴木 健太', role: 'staff', password: '', status: 'active', created_at: now },
      { id: 'st-takahashi', name: '高橋 涼子', role: 'manager', password: '', status: 'active', created_at: now },
      { id: 'st-tanaka', name: '田中 大輔', role: 'staff', password: '', status: 'active', created_at: now },
      { id: 'st-ito', name: '伊藤 さくら', role: 'staff', password: '1234', status: 'active', created_at: now },
      { id: 'st-yamada', name: '山田 本部', role: 'headquarter', password: '', status: 'active', created_at: now },
    ],
    staff_stores: [
      { staff_id: 'st-sato', store_id: 'store-1' },
      { staff_id: 'st-suzuki', store_id: 'store-1' },
      { staff_id: 'st-takahashi', store_id: 'store-1' },
      { staff_id: 'st-tanaka', store_id: 'store-2' },
      { staff_id: 'st-ito', store_id: 'store-2' },
    ],
    dash_config: [],
    menu_items: [
      { id: 'menu_1', name: '全身整体 60分', category: '整体', price: 8800, item_type: 'menu', active: true, created_at: now },
      { id: 'menu_2', name: '骨盤矯正 75分', category: '整体', price: 11000, item_type: 'menu', active: true, created_at: now },
      { id: 'menu_3', name: '初回体験', category: '体験', price: 3980, item_type: 'coupon', active: true, created_at: now },
    ],
    cashbook: [],
    cashbook_log: [],
    daily_close: [],
    ...mandalaSeed(),
  };
}

export function createMockClient(file) {
  let db;
  try {
    db = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    db = seedData();
  }
  // マンダラを追加する前に作った疑似 DB にも、デモのチャート・週報を入れる
  if (!Array.isArray(db.mandala_charts)) Object.assign(db, mandalaSeed());
  for (const t of Object.keys(KEYS)) if (!Array.isArray(db[t])) db[t] = [];
  let seq = Date.now();
  const persist = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(db, null, 1));
  };

  const same = (a, b) => a === b || (a != null && b != null && String(a) === String(b));
  const keyOf = (table, row, cols) => (cols || KEYS[table] || ['id']).map((c) => String(row[c])).join('|');

  class Query {
    constructor(table) {
      this.table = table;
      this.op = 'select';
      this.filters = [];
      this.sorts = [];
      this.returning = false;
      this.mode = 'many';
      this.cols = '*';
    }
    select(cols = '*') { this.cols = cols; if (this.op !== 'select') this.returning = true; return this; }
    eq(c, v) { this.filters.push((r) => same(r[c], v)); return this; }
    neq(c, v) { this.filters.push((r) => !same(r[c], v)); return this; }
    in(c, vals) { const set = (vals || []).map(String); this.filters.push((r) => set.includes(String(r[c]))); return this; }
    gte(c, v) { this.filters.push((r) => r[c] != null && r[c] >= v); return this; }
    lte(c, v) { this.filters.push((r) => r[c] != null && r[c] <= v); return this; }
    gt(c, v) { this.filters.push((r) => r[c] != null && r[c] > v); return this; }
    lt(c, v) { this.filters.push((r) => r[c] != null && r[c] < v); return this; }
    is(c, v) { this.filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
    order(c, { ascending = true } = {}) { this.sorts.push([c, ascending]); return this; }
    range(a, b) { this.from = a; this.to = b; return this; }
    limit(n) { this.lim = n; return this; }
    maybeSingle() { this.mode = 'maybe'; return this; }
    single() { this.mode = 'single'; return this; }
    insert(rows) { this.op = 'insert'; this.payload = rows; return this; }
    upsert(rows, opts = {}) { this.op = 'upsert'; this.payload = rows; this.conflict = opts.onConflict ? opts.onConflict.split(',').map((s) => s.trim()) : null; return this; }
    update(obj) { this.op = 'update'; this.payload = obj; return this; }
    delete() { this.op = 'delete'; return this; }

    project(rows) {
      if (!this.cols || this.cols.trim() === '*') return rows.map((r) => ({ ...r }));
      const cols = this.cols.split(',').map((s) => s.trim());
      return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] === undefined ? null : r[c]])));
    }
    checkFk(row) {
      for (const [col, refTable, refCol] of FK[this.table] || []) {
        if (row[col] == null || row[col] === '') continue;
        if (!db[refTable].some((r) => same(r[refCol], row[col]))) {
          return { code: '23503', message: `insert or update on table "${this.table}" violates foreign key constraint (${col})` };
        }
      }
      return null;
    }
    exec() {
      const table = db[this.table];
      if (!table) return { data: null, error: { message: `relation "${this.table}" does not exist` } };
      const match = (r) => this.filters.every((f) => f(r));
      if (this.op === 'select') {
        let rows = table.filter(match);
        for (const [c, asc] of [...this.sorts].reverse()) {
          rows = [...rows].sort((a, b) => (a[c] === b[c] ? 0 : (a[c] > b[c] ? 1 : -1) * (asc ? 1 : -1)));
        }
        if (this.from != null) rows = rows.slice(this.from, this.to + 1);
        if (this.lim != null) rows = rows.slice(0, this.lim);
        rows = this.project(rows);
        if (this.mode === 'single') return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
        if (this.mode === 'maybe') return { data: rows[0] || null, error: null };
        return { data: rows, error: null };
      }
      if (this.op === 'insert' || this.op === 'upsert') {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        const out = [];
        for (const raw of list) {
          const row = { ...(DEFAULTS[this.table] ? DEFAULTS[this.table]() : {}), ...raw };
          if (this.table === 'cashbook_log' && row.id == null) row.id = ++seq;
          const err = this.checkFk(row);
          if (err) return { data: null, error: err };
          const k = keyOf(this.table, row, this.conflict);
          const idx = table.findIndex((r) => keyOf(this.table, r, this.conflict) === k);
          if (idx >= 0) {
            if (this.op === 'insert') return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
            table[idx] = { ...table[idx], ...raw };
            out.push(table[idx]);
          } else {
            table.push(row);
            out.push(row);
          }
        }
        persist();
        const data = this.returning ? this.project(out) : null;
        return { data: this.mode === 'single' ? (data ? data[0] : null) : data, error: null };
      }
      if (this.op === 'update') {
        const out = [];
        for (let i = 0; i < table.length; i++) {
          if (!match(table[i])) continue;
          const next = { ...table[i], ...this.payload };
          if ('updated_at' in table[i]) next.updated_at = new Date().toISOString();
          const err = this.checkFk(next);
          if (err) return { data: null, error: err };
          table[i] = next;
          out.push(next);
        }
        persist();
        return { data: this.returning ? this.project(out) : null, error: null };
      }
      if (this.op === 'delete') {
        db[this.table] = table.filter((r) => !match(r));
        persist();
        return { data: null, error: null };
      }
      return { data: null, error: { message: 'unsupported op' } };
    }
    then(resolve, reject) {
      try { resolve(this.exec()); } catch (e) { reject(e); }
    }
  }

  return { from: (table) => new Query(table), __db: () => db };
}
