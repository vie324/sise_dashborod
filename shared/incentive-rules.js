// ============================================================
// インセンティブ制度（社内規程・制度概要 2026年11月1日〜）
// ------------------------------------------------------------
// 資料「インセンティブ制度概要」の内容をそのままデータ化したもの。
// 金額・閾値を変える時はここだけを直す（計算ロジックは incentive.js）。
//
//   制度開始日 : 2026年11月1日
//   支給タイミング : 2ヶ月に1回（11-12月 / 1-2月 / 3-4月 …）
// ============================================================

export const INCENTIVE_RULES = Object.freeze({
  version: '2026-11',
  startMonth: '2026-11',
  periodMonths: 2,

  // 1回あたりの評価基準額。
  // 60分・月2回プラン 15,000円÷2 = 7,500円、75分・月2回プラン 18,000円÷2 = 9,000円
  // の平均 8,250円 を元に、分かりやすい基準額として 8,000円 に設定。
  unitPrice: 8000,

  // 1. 施術消化売上インセンティブ（SalonOne「消化売上」を評価基準とする）
  sales: {
    key: 'sales',
    label: '施術消化売上',
    tiers: [
      { min: 576000, amount: 5000 },
      { min: 688000, amount: 30000 },
      { min: 808000, amount: 40000 },
      { min: 928000, amount: 50000 },
      { min: 1048000, amount: 100000 },
    ],
  },

  // 2. 継続率インセンティブ（店舗全体の条件を満たした場合、1人あたり月額 5,000円）
  retention: {
    key: 'retention',
    label: '継続率',
    amountPerPerson: 5000,
    maxChurnRatePct: 10, // 店舗全体の退会率が 10% 以下
    minAvgTenureMonths: 3, // 店舗全体の平均継続期間が 3ヶ月以上
    minMembers: 50, // 会員数が 50名以上（都度払いはカウント対象外）
  },

  // 3. 新規契約インセンティブ
  //   既存顧客の施術消化売上が月間 400,000円以上（資料の「40,0000円」の誤記と解釈）かつ
  //   3経路（ホットペッパー・Meta広告・ホームページ）の新規初回来店数が合計 9名以上で適用。
  //   契約率 = 3経路からの新規契約数合計 ÷ 3経路からの新規初回来店数合計 × 100
  newContract: {
    key: 'newContract',
    label: '新規契約',
    channels: ['hotpepper', 'meta', 'homepage'],
    minExistingSales: 400000,
    minNewVisits: 9,
    tiers: [
      { minPct: 40, amount: 2000 },
      { minPct: 50, amount: 10000 },
      { minPct: 60, amount: 15000 },
      { minPct: 70, amount: 20000 },
      { minPct: 80, amount: 25000 },
      { minPct: 90, amount: 30000 },
    ],
  },

  // 4. Minimo・Threads・Instagram インセンティブ
  //   3媒体経由で 10名以上集客した場合、1件契約につき 2,000円
  sns: {
    key: 'sns',
    label: 'Minimo・Threads・Instagram',
    channels: ['minimo', 'threads', 'instagram'],
    minCustomers: 10,
    amountPerContract: 2000,
  },

  // 5. 紹介インセンティブ
  //   紹介した顧客が新たにサブスク契約を締結した場合 2,000円
  //   （SalonOne の専用URL/QRで管理。来店前キャンセル・既存客・シェアプランは対象外）
  referral: {
    key: 'referral',
    label: '紹介',
    amountPerContract: 2000,
  },
});
