import { currentAccess } from '../../../lib/access.js';

// 旧画面の「来店フロー」から遷移した時に入っていたお客様名（残っていれば使う）
export function initialCustomerName() {
  try {
    return sessionStorage.getItem('sise_flow_customer_name') || '';
  } catch (_) {
    return '';
  }
}

// スタッフURLで開いている時は担当者名を最初から入れておく
export function initialStaffName() {
  return currentAccess && !currentAccess.invalid ? currentAccess.name || '' : '';
}
