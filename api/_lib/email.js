// ============================================================
// メール送信ヘルパー
// ------------------------------------------------------------
// Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email)
// 経由でテキスト/HTML メールを送る。依存ゼロ（fetch のみ）。
//
// 必須環境変数:
//   SISE_RESEND_API_KEY        Resend で発行する API キー（re_...）
//   SISE_DAILY_REPORT_FROM     送信元アドレス（Resend で検証済みドメイン）
//   SISE_DAILY_REPORT_TO       通知先（カンマ区切りで複数指定可）
//
// 環境変数が一つでも欠けている場合は送信せず {skipped: true} を返す
// （日報の保存自体は失敗させない設計）。
// ============================================================

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function envList(name) {
  const raw = process.env[name];
  if (!raw) return [];
  return String(raw).split(',').map(s => s.trim()).filter(Boolean);
}

export async function sendEmail({ to, subject, html, text, from }) {
  const apiKey = process.env.SISE_RESEND_API_KEY;
  const fromAddr = from || process.env.SISE_DAILY_REPORT_FROM;
  const recipients = Array.isArray(to) ? to.filter(Boolean) : envList('SISE_DAILY_REPORT_TO');

  if (!apiKey) {
    console.warn('[email] SISE_RESEND_API_KEY が未設定のため送信をスキップしました');
    return { skipped: true, reason: 'no_api_key' };
  }
  if (!fromAddr) {
    console.warn('[email] 送信元アドレス (SISE_DAILY_REPORT_FROM) が未設定のため送信をスキップ');
    return { skipped: true, reason: 'no_from' };
  }
  if (!recipients.length) {
    console.warn('[email] 送信先 (SISE_DAILY_REPORT_TO) が未設定のため送信をスキップ');
    return { skipped: true, reason: 'no_recipients' };
  }

  const body = {
    from: fromAddr,
    to: recipients,
    subject: subject || '(無題)',
  };
  if (html) body.html = html;
  if (text) body.text = text;
  if (!html && !text) body.text = '';

  try {
    const resp = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      console.error('[email] Resend API error:', resp.status, txt);
      return { error: `resend_${resp.status}`, detail: txt };
    }
    const data = await resp.json().catch(() => ({}));
    return { success: true, id: data.id };
  } catch (e) {
    console.error('[email] 送信エラー:', e);
    return { error: 'fetch_failed', detail: String(e && e.message || e) };
  }
}

// ------------------------------------------------------------
// 日報専用フォーマッタ
// ------------------------------------------------------------
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function formatDailyReportEmail(report) {
  const ts = report.timestamp ? new Date(report.timestamp) : new Date();
  const dateStr = ts.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const totalNew = (report.hpbNew || 0) + (report.metaNew || 0)
                 + (report.referralNew || 0) + (report.discountNew || 0);
  const totalContract = (report.hpbContract || 0) + (report.metaContract || 0)
                      + (report.referralContract || 0) + (report.discountContract || 0);
  const yes = (b) => b ? '✅ 完了' : '❌ 未完了';

  const lines = [
    `店舗: ${report.store || '-'}`,
    `送信者: ${report.recorder || '-'}`,
    `送信日時: ${dateStr}`,
    '',
    '【新規来店件数】',
    `  ホットペッパー: ${report.hpbNew || 0}`,
    `  Meta広告:       ${report.metaNew || 0}`,
    `  ご紹介:         ${report.referralNew || 0}`,
    `  割引クーポン:   ${report.discountNew || 0}`,
    `  合計:           ${totalNew}`,
    '',
    '【契約件数】',
    `  ホットペッパー: ${report.hpbContract || 0}`,
    `  Meta広告:       ${report.metaContract || 0}`,
    `  ご紹介:         ${report.referralContract || 0}`,
    `  割引クーポン:   ${report.discountContract || 0}`,
    `  合計:           ${totalContract}`,
    '',
    `【既存会員 施術件数】 ${report.existingTreatments || 0}`,
    `【本日の業務】 ${yes(report.taskComplete)}`,
    `【明日の準備】 ${yes(report.prepComplete)}`,
  ];
  if (report.notes) {
    lines.push('', '【メモ】', report.notes);
  }
  const text = lines.join('\n');

  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;background:#f7f9f7;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,.06)">
      <h2 style="margin:0 0 4px 0;color:#2d7a4f;font-size:18px">日報が届きました</h2>
      <p style="margin:0 0 20px 0;color:#6b6b6b;font-size:13px">${escapeHtml(report.store || '-')}・${escapeHtml(dateStr)}・送信者: ${escapeHtml(report.recorder || '-')}</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><th style="text-align:left;padding:6px;background:#f0f7f3;border-radius:6px" colspan="3">新規来店件数（合計 ${totalNew}）</th></tr>
        <tr><td style="padding:6px">ホットペッパー</td><td style="padding:6px">Meta広告</td><td style="padding:6px">ご紹介 / 割引</td></tr>
        <tr><td style="padding:6px;font-weight:700">${report.hpbNew || 0}</td><td style="padding:6px;font-weight:700">${report.metaNew || 0}</td><td style="padding:6px;font-weight:700">${report.referralNew || 0} / ${report.discountNew || 0}</td></tr>
        <tr><th style="text-align:left;padding:6px;background:#f0f7f3;border-radius:6px;margin-top:6px" colspan="3">契約件数（合計 ${totalContract}）</th></tr>
        <tr><td style="padding:6px">ホットペッパー</td><td style="padding:6px">Meta広告</td><td style="padding:6px">ご紹介 / 割引</td></tr>
        <tr><td style="padding:6px;font-weight:700">${report.hpbContract || 0}</td><td style="padding:6px;font-weight:700">${report.metaContract || 0}</td><td style="padding:6px;font-weight:700">${report.referralContract || 0} / ${report.discountContract || 0}</td></tr>
      </table>
      <div style="margin-top:14px;font-size:13px">
        <p style="margin:6px 0">既存会員 施術件数: <strong>${report.existingTreatments || 0}</strong></p>
        <p style="margin:6px 0">本日の業務: <strong>${yes(report.taskComplete)}</strong></p>
        <p style="margin:6px 0">明日の準備: <strong>${yes(report.prepComplete)}</strong></p>
        ${report.notes ? `<p style="margin:14px 0 6px 0;color:#6b6b6b">メモ:</p><pre style="white-space:pre-wrap;margin:0;padding:10px;background:#f7f7f7;border-radius:6px;font-family:inherit;font-size:13px">${escapeHtml(report.notes)}</pre>` : ''}
      </div>
    </div>
  </body></html>`;

  return { text, html, subject: `[日報] ${report.store || '不明'} - ${dateStr}` };
}
