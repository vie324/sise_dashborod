// ========================================
// HMAC-SHA256 署名付きトークンユーティリティ
// ========================================
// トークン形式（signed）:
//   <base64url(payload JSON)>.<base64url(HMAC-SHA256(payload_b64url, SECRET))>
//
// 後方互換のための legacy 形式（unsigned, '.' を含まない）も
// auth.js 側で ALLOW_LEGACY_TOKENS=true の時のみ受理される。
//
// 秘密鍵は環境変数 SISE_AUTH_SECRET を使用する。
// 本番運用では 32バイト以上のランダム値を設定すること。例:
//   openssl rand -hex 32
// ========================================

import crypto from 'node:crypto';

// 未設定時は明示的に警告を出す（開発用のゼロ値 secret は受理するが本番では禁止）
const SECRET = process.env.SISE_AUTH_SECRET || '';
if (!SECRET) {
  console.warn('[sign] SISE_AUTH_SECRET is not set. Token signing will use an empty key (DEV ONLY).');
}

// Node の Buffer を使って base64url エンコード/デコードする。
// atob/btoa ではなく Buffer を使う理由: バイナリ safe、padding 自動処理。
function b64urlEncode(buf) {
  // Buffer or string/Uint8Array を受け付ける
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecodeToBuffer(s) {
  let str = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}
function b64urlDecodeToUtf8(s) {
  return b64urlDecodeToBuffer(s).toString('utf8');
}

// payload を JSON 化して base64url エンコード、HMAC を計算して結合する。
// ttlSeconds を渡すと payload に iat/exp を自動付与する。
export function signToken(payload, ttlSeconds = 365 * 24 * 60 * 60 /* 1 year */) {
  const now = Math.floor(Date.now() / 1000);
  const finalPayload = { ...payload };
  if (finalPayload.iat === undefined) finalPayload.iat = now;
  if (finalPayload.exp === undefined && ttlSeconds) finalPayload.exp = now + ttlSeconds;

  const payloadB64 = b64urlEncode(JSON.stringify(finalPayload));
  const sig = crypto.createHmac('sha256', SECRET).update(payloadB64).digest();
  const sigB64 = b64urlEncode(sig);
  return `${payloadB64}.${sigB64}`;
}

// 検証結果を { ok, payload, reason } で返す（throw しない）。
// reason: 'malformed' | 'bad_signature' | 'expired' | 'invalid_payload'
export function verifyToken(token) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };

  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return { ok: false, reason: 'malformed' };

  // 署名を計算して比較（timing-safe）
  const expected = crypto.createHmac('sha256', SECRET).update(payloadB64).digest();
  const provided = b64urlDecodeToBuffer(sigB64);
  // 長さが違うと timingSafeEqual がクラッシュするため先に弾く
  if (provided.length !== expected.length) return { ok: false, reason: 'bad_signature' };
  if (!crypto.timingSafeEqual(expected, provided)) return { ok: false, reason: 'bad_signature' };

  // payload を decode
  let payload;
  try {
    payload = JSON.parse(b64urlDecodeToUtf8(payloadB64));
  } catch (_) {
    return { ok: false, reason: 'invalid_payload' };
  }

  // 期限チェック
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp !== undefined && typeof payload.exp === 'number' && payload.exp < now) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, payload };
}

// 公開判定: 署名形式のトークンかどうか（legacy と区別するため）
export function looksSigned(token) {
  return typeof token === 'string' && token.includes('.');
}
