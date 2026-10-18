import { useEffect, useRef } from 'react';
import { currentAccess } from '../../../lib/access.js';

// お客様名の引き継ぎ（カウンセリングで選んだお客様 → 姿勢分析・施術レポート）。
// 旧画面の「来店フロー」と同じ sessionStorage のキーを使う。
const CUSTOMER_KEY = 'sise_flow_customer_name';
const CUSTOMER_EVENT = 'sise:care-customer';

export function initialCustomerName() {
  try {
    return sessionStorage.getItem(CUSTOMER_KEY) || '';
  } catch (_) {
    return '';
  }
}

/** 他の施術ツールにお客様名を渡す */
export function shareCustomerName(name) {
  const n = String(name || '').trim();
  try { sessionStorage.setItem(CUSTOMER_KEY, n); } catch (_) { /* noop */ }
  window.dispatchEvent(new CustomEvent(CUSTOMER_EVENT, { detail: n }));
}

/**
 * 他のツールでお客様が選ばれたら名前の欄に入れる。
 * 手で入力した名前は上書きしない（空欄か、前に引き継いだ名前のままの時だけ差し替える）。
 */
export function useSharedCustomerName(setValue) {
  const lastShared = useRef(initialCustomerName());
  useEffect(() => {
    const on = (e) => {
      const name = String((e && e.detail) || '');
      const previous = lastShared.current;
      lastShared.current = name;
      setValue((prev) => (!prev || prev === previous ? name : prev));
    };
    window.addEventListener(CUSTOMER_EVENT, on);
    return () => window.removeEventListener(CUSTOMER_EVENT, on);
  }, [setValue]);
}

// スタッフURLで開いている時は担当者名を最初から入れておく
export function initialStaffName() {
  return currentAccess && !currentAccess.invalid ? currentAccess.name || '' : '';
}
