// レポートに載せるお客様名・日付の表記

/** 「山田 花子」→「山田 花子 様」（入力済みの「様」は重ねない） */
export function honorific(name) {
  const n = String(name || '').trim();
  if (!n) return '様';
  return n.includes('様') ? n : `${n} 様`;
}

/** '2026-10-16' → '2026.10.16' */
export function dotDate(date) {
  return date ? String(date).replace(/-/g, '.') : '';
}
