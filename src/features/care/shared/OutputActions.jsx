import { useRef, useState } from 'react';
import { Button, cx } from '../../../ui/primitives.jsx';
import Icon from '../../../ui/Icon.jsx';
import { showToast } from '../../../ui/feedback.jsx';
import { canShareFiles, downloadFiles, isIOS, renderPngFiles } from './exportImage.js';

// ============================================================
// レポートの出力: 画像を保存 / 共有 / 印刷
// ------------------------------------------------------------
// LINE への直接送信は廃止。お客様へは保存した画像を SalonOne の LINE チャットから送る。
// ============================================================

// 共有シートはボタン操作の直後にしか開けない（iOS は画像生成を待つ間に権限が切れる）ため、
// 生成した画像をしばらく覚えておき、もう一度押してもらった時はすぐ共有する
const SHARE_CACHE_MS = 2 * 60 * 1000;

/**
 * @param {React.RefObject<HTMLElement>} targetRef  画像にする要素（画面に表示されていること）
 * @param {string} fileBase      拡張子なしのファイル名
 * @param {number} [exportWidth] 保存画像のレイアウト幅（px）
 * @param {any} contentKey       レポートの内容が変わったら変わる値（共有用の画像を作り直す判定）
 */
export default function OutputActions({ targetRef, fileBase, exportWidth, contentKey, shareTitle = 'レポート', disabled = false, extra, className = '' }) {
  const [busy, setBusy] = useState(null);
  const shareCache = useRef(null);
  const shareable = canShareFiles();

  const render = () => renderPngFiles(targetRef.current, fileBase, { width: exportWidth });

  const save = async () => {
    setBusy('save');
    try {
      const files = await render();
      await downloadFiles(files);
      const count = files.length > 1 ? `${files.length}枚に分けて` : '';
      if (isIOS()) {
        showToast(`${count}「ファイル」アプリのダウンロードに保存しました。写真に保存するには「共有」から「画像を保存」を選んでください`, 'success', 6000);
      } else {
        showToast(`画像を${count}保存しました`, 'success');
      }
    } catch (e) {
      console.error('[施術ツール] 画像生成エラー:', e);
      showToast(`画像の保存に失敗しました: ${(e && e.message) || e}`, 'error', 5000);
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    const cached = shareCache.current;
    let files = cached && cached.key === contentKey && Date.now() - cached.at < SHARE_CACHE_MS ? cached.files : null;
    if (!files) {
      setBusy('share');
      try {
        files = await render();
        shareCache.current = { key: contentKey, files, at: Date.now() };
      } catch (e) {
        console.error('[施術ツール] 画像生成エラー:', e);
        showToast(`画像の作成に失敗しました: ${(e && e.message) || e}`, 'error', 5000);
        return;
      } finally {
        setBusy(null);
      }
    }
    if (!navigator.canShare({ files })) {
      showToast('この端末ではこの画像を共有できません。「画像を保存」をお使いください', 'warning', 5000);
      return;
    }
    try {
      await navigator.share({ files, title: shareTitle });
    } catch (e) {
      if (e && e.name === 'AbortError') return; // 共有シートを閉じただけ
      if (e && e.name === 'NotAllowedError') {
        showToast('画像の準備ができました。もう一度「共有」を押してください', 'info', 5000);
        return;
      }
      console.error('[施術ツール] 共有エラー:', e);
      showToast(`共有できませんでした: ${(e && e.message) || e}`, 'error', 5000);
    }
  };

  return (
    <div className={cx('no-print space-y-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon="download" loading={busy === 'save'} disabled={disabled || !!busy} onClick={save}>画像を保存</Button>
        {shareable ? (
          <Button icon="share-2" loading={busy === 'share'} disabled={disabled || !!busy} onClick={share}>共有</Button>
        ) : null}
        <Button icon="printer" disabled={disabled || !!busy} onClick={() => window.print()}>印刷</Button>
        {extra}
      </div>
      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted">
        <Icon name="message-circle" size={14} className="mt-px" />
        <span>LINEでお客様に送る場合は、保存した画像をSalonOneのLINEチャットから送信してください</span>
      </p>
    </div>
  );
}
