import { navigate } from '../../app/router.js';

// ホームのミッションから「インセンティブ > あなたの内訳」の該当カードへ飛ぶための受け渡し。
// ハッシュにクエリを足すとルーターの一致が崩れるので sessionStorage で渡す。
const KEY = 'sise_focus_incentive';

export function focusIncentive(key) {
  try { sessionStorage.setItem(KEY, key); } catch (_) { /* noop */ }
  navigate('/incentives');
}

/** 1回だけ取り出す（戻る・再読み込みで同じ場所へ飛ばないように消す） */
export function takeFocusIncentive() {
  try {
    const v = sessionStorage.getItem(KEY);
    if (v) sessionStorage.removeItem(KEY);
    return v;
  } catch (_) {
    return null;
  }
}

/** 対象のカードまでスクロールし、少しのあいだ枠を光らせる */
export function scrollToIncentive(key) {
  const el = document.getElementById(`incentive-${key}`);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.add('focus-flash');
  setTimeout(() => el.classList.remove('focus-flash'), 1800);
  return true;
}
