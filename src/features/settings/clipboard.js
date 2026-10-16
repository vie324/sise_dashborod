// ============================================================
// クリップボードへのコピー（スタッフURLの共有用）
// ------------------------------------------------------------
// iOS Safari は「タップの処理中に同期的に呼んだ」clipboard 操作しか許可しない。
// URL の発行のように通信を待ってから writeText すると NotAllowedError になるため、
// まず ClipboardItem に Promise を渡し、タップの文脈を保ったまま発行の完了を待つ。
// だめなら writeText → execCommand('copy') の順に試す。
//
// 引数: 文字列、または後から文字列に解決する Promise（呼び出し側は await せずに渡す）
// 戻り値: { ok, text }（text は解決済みの文字列。失敗時に手動コピー用に表示する）
// ============================================================

export async function copyText(textOrPromise) {
  const isPromise = !!textOrPromise && typeof textOrPromise.then === 'function';

  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && navigator.clipboard.write) {
    try {
      let resolved = '';
      const blob = Promise.resolve(textOrPromise).then((t) => {
        resolved = String(t || '');
        if (!resolved) throw new Error('empty');
        return new Blob([resolved], { type: 'text/plain' });
      });
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return { ok: true, text: resolved };
    } catch (_) {
      // 権限が無い・ClipboardItem の Promise に未対応など。次の方法を試す
    }
  }

  let text = '';
  try {
    text = String((isPromise ? await textOrPromise : textOrPromise) || '');
  } catch (_) {
    return { ok: false, text: '' };
  }
  if (!text) return { ok: false, text: '' };

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return { ok: true, text };
    }
  } catch (_) {
    // 古い WebView 向けの execCommand に回す
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return { ok, text };
  } catch (_) {
    return { ok: false, text };
  }
}
