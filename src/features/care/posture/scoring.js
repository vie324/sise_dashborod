// ============================================================
// 姿勢スコアリング（純粋関数）
// ------------------------------------------------------------
// MediaPipe Pose のランドマーク（x, y は画像の幅・高さに対する 0〜1、
// visibility は検出の確からしさ 0〜1）から各部位のスコア（0〜100）を出す。
// 閾値は各項目の reference にある査読付き論文に基づく。
// カメラとの距離で値が変わらないよう、長さは肩幅（側面・座位は肩〜腰の距離）で
// 正規化し、cm 表示は成人の平均肩幅・肩〜腰の距離を基準に換算した目安。
// 画面や Canvas には依存しない。
// ============================================================

export const POSTURE_LM = {
  NOSE: 0, LEFT_EYE: 1, RIGHT_EYE: 2, LEFT_EAR: 3, RIGHT_EAR: 4,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12, LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26, LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14, LEFT_WRIST: 15, RIGHT_WRIST: 16,
};

export const POSTURE_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
];

export const VIEW_MODES = ['front', 'back', 'side', 'seated'];
export const VIEW_LABELS = { front: '正面', back: '背面', side: '側面', seated: '座位' };

// 推定実寸変換用の基準値（cm）
export const REF_SHOULDER_WIDTH_CM = 38; // 成人平均肩幅
export const REF_SH_HIP_DIST_CM = 42; // 成人平均肩-腰間距離

// ------------------------------------------------------------
// 基本の幾何計算
// ------------------------------------------------------------
export function calcAngle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const m1 = Math.sqrt(ab.x ** 2 + ab.y ** 2);
  const m2 = Math.sqrt(cb.x ** 2 + cb.y ** 2);
  if (!m1 || !m2) return 0;
  return Math.acos(Math.min(1, Math.max(-1, dot / (m1 * m2)))) * (180 / Math.PI);
}

export function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** ランドマーク群の平均 visibility（信頼度） */
export function lmConfidence(...lms) {
  const vs = lms.filter((l) => l && l.visibility != null).map((l) => l.visibility);
  return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0;
}

/**
 * 左右の点を結ぶ線の水平からの傾き（度）。
 * 旧実装は |atan2| と 180° の差を取っていたため、左右のランドマークが画像上で
 * 入れ替わって写る向き（背面など）では水平な肩でも 180° 近くになり 0 点になっていた。
 * 線に向きは無いので 0° と 180° の近い方で測る（正面の結果は旧実装と同じ値になる）。
 */
function lineTilt(dx, dy) {
  const a = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));
  return Math.min(a, 180 - a);
}

// 論文ベース閾値（Fortin et al. 2011: 2°以内が正常範囲、15°以上で側弯症兆候）
function tiltScore(t) {
  if (t <= 2) return Math.round(100 - t * 5);
  if (t <= 5) return Math.round(90 - (t - 2) * 6.7);
  if (t <= 10) return Math.round(70 - (t - 5) * 6);
  return Math.round(Math.max(0, 40 - (t - 10) * 4));
}

// 肩幅で正規化した左右のズレ（%偏位）。1.5% 以内が正常範囲
function offsetScore(o) {
  if (o <= 1.5) return Math.round(100 - o * 6.7);
  if (o <= 3) return Math.round(90 - (o - 1.5) * 13.3);
  if (o <= 5) return Math.round(70 - (o - 3) * 15);
  return Math.round(Math.max(0, 40 - (o - 5) * 8));
}

// ------------------------------------------------------------
// スコアの表示色・ラベル（レポート画像や Canvas でも使う固定色）
// ------------------------------------------------------------
export function scoreColor(s) {
  return s >= 80 ? '#0F6E56' : s >= 60 ? '#639922' : s >= 40 ? '#EF9F27' : '#E24B4A';
}

/** 暗い下地（写真の上のラベル・拡大比較）に載せる文字用。scoreColor のままだと暗い緑が読めない */
export function scoreColorOnDark(s) {
  if (s == null) return '#9ca3a0';
  return s >= 80 ? '#5fd3a8' : s >= 60 ? '#a8d26b' : s >= 40 ? '#f5c36b' : '#f29a99';
}

export function scoreLabel(s) {
  return s >= 80 ? '良好' : s >= 60 ? 'やや注意' : s >= 40 ? '要改善' : '要施術';
}

export function scoreBg(s) {
  return s >= 80 ? '#E1F5EE' : s >= 60 ? '#EAF3DE' : s >= 40 ? '#FAEEDA' : '#FCEBEB';
}

export const SCORE_LEGEND = [
  { color: '#0F6E56', label: '良好' },
  { color: '#639922', label: 'やや注意' },
  { color: '#EF9F27', label: '要改善' },
  { color: '#E24B4A', label: '要施術' },
];

/** 総合スコアに応じたひとこと（施術頻度の目安） */
export function totalComment(total) {
  if (total >= 80) return '姿勢は概ね良好です。現在の状態を維持しましょう。';
  if (total >= 60) return '軽度の歪みが見られます。月2回程度の定期的なケアをおすすめします。';
  if (total >= 40) return '複数の項目で改善が必要です。月4回の集中ケアプランをご提案します。';
  return '姿勢の歪みが顕著です。早めの施術をおすすめします。月4回プランが最適です。';
}

// ------------------------------------------------------------
// 参考論文
// ------------------------------------------------------------
const PAPERS = {
  fortin2011: {
    authors: 'Fortin C, Feldman DE, Cheriet F, Labelle H',
    year: 2011,
    journal: 'Disability and Rehabilitation, 33(5):367-383',
    doi: '10.3109/09638288.2010.492066',
    pmid: '20568973',
  },
  herrington2011: {
    authors: 'Herrington L',
    year: 2011,
    journal: 'Manual Therapy, 16(6):646-648',
    doi: '10.1016/j.math.2011.04.006',
    pmid: '21658988',
  },
  singla2017Head: {
    authors: 'Singla D, Veqar Z',
    year: 2017,
    journal: 'J Chiropractic Medicine, 16(2):131-138',
    doi: '10.1016/j.jcm.2017.01.005',
    pmid: '28559753',
  },
  singla2017Shoulder: {
    authors: 'Singla D, Veqar Z',
    year: 2017,
    journal: 'J Chiropractic Medicine, 16(3):220-229',
    doi: '10.1016/j.jcm.2017.03.004',
    pmid: '29097952',
  },
  ferreira2010: {
    authors: 'Ferreira EA, Duarte M, Maldonado EP, Burke TN, Marques AP',
    year: 2010,
    journal: 'Clinics (São Paulo), 65(7):675-681',
    doi: '10.1590/S1807-59322010000700005',
    pmid: '20668624',
  },
  shaghayegh2016: {
    authors: 'Shaghayegh Fard B, Ahmadi A, Maroufi N, Sarrafzadeh J',
    year: 2016,
    journal: 'European Spine Journal, 25(11):3577-3582',
    doi: '10.1007/s00586-015-4254-x',
    pmid: '26476717',
  },
  loudon1998: {
    authors: 'Loudon JK, Goist HL, Loudon KL',
    year: 1998,
    journal: 'J Orthopaedic & Sports Physical Therapy, 27(5):361-367',
    doi: '10.2519/jospt.1998.27.5.361',
    pmid: '9580896',
  },
  kocur2019: {
    authors: 'Kocur P, Wilski M, Goliwąs M, Lewandowski J, Łochyński D',
    year: 2019,
    journal: 'Clinical Biomechanics, 67:51-56',
    doi: '10.1016/j.clinbiomech.2019.04.017',
    pmid: '31034771',
  },
  yip2008: {
    authors: 'Yip CH, Chiu TT, Poon AT',
    year: 2008,
    journal: 'Manual Therapy, 13(2):148-154',
    doi: '10.1016/j.math.2006.11.002',
    pmid: '17368075',
  },
};

const paper = (key, finding) => ({ ...PAPERS[key], finding });

// ------------------------------------------------------------
// 正面
// ------------------------------------------------------------
export function analyzeFront(lm) {
  const L = POSTURE_LM;
  const ls = lm[L.LEFT_SHOULDER];
  const rs = lm[L.RIGHT_SHOULDER];
  const lh = lm[L.LEFT_HIP];
  const rh = lm[L.RIGHT_HIP];
  const nose = lm[L.NOSE];
  const sMid = mid(ls, rs);
  const hMid = mid(lh, rh);
  // 肩幅を基準長として正規化（カメラ距離に依存しない）
  const shoulderWidth = Math.sqrt((rs.x - ls.x) ** 2 + (rs.y - ls.y) ** 2);
  const refLen = shoulderWidth > 0.01 ? shoulderWidth : 0.2;

  const shoulderDy = rs.y - ls.y;
  const shoulderTilt = lineTilt(rs.x - ls.x, shoulderDy);
  const shoulderScore = tiltScore(shoulderTilt);

  const hipDy = rh.y - lh.y;
  const hipTilt = lineTilt(rh.x - lh.x, hipDy);
  const hipScore = tiltScore(hipTilt);

  // 頭部の傾き（肩幅の 1/6 ≒ 1.5% 相当に正規化した偏位）
  const headOffsetRaw = Math.abs(nose.x - sMid.x);
  const headOffset = (headOffsetRaw / refLen) * 6;
  const headScore = offsetScore(headOffset);

  // 重心の左右ズレ
  const centerOffsetRaw = Math.abs(sMid.x - hMid.x);
  const centerOffset = (centerOffsetRaw / refLen) * 6;
  const centerScore = offsetScore(centerOffset);

  const cmPerUnit = REF_SHOULDER_WIDTH_CM / refLen;
  return {
    items: [
      {
        key: 'shoulder',
        label: '肩の左右バランス',
        score: shoulderScore,
        confidence: lmConfidence(ls, rs),
        detail: shoulderTilt < 1 ? '均等' : ls.y < rs.y ? '左肩が高い' : '右肩が高い',
        value: `${shoulderTilt.toFixed(1)}°`,
        valueCm: `${(Math.abs(shoulderDy) * cmPerUnit).toFixed(1)}cm`,
        reference: paper('fortin2011', 'フォトグラメトリーによる肩傾斜角の測定は高い信頼性（ICC>0.90）。2°以内が正常範囲、15°以上で側弯症の兆候。'),
      },
      {
        key: 'hip',
        label: '骨盤の左右バランス',
        score: hipScore,
        confidence: lmConfidence(lh, rh),
        detail: hipTilt < 1 ? '均等' : lh.y < rh.y ? '左が高い' : '右が高い',
        value: `${hipTilt.toFixed(1)}°`,
        valueCm: `${(Math.abs(hipDy) * cmPerUnit).toFixed(1)}cm`,
        reference: paper('herrington2011', '無症状者120名で骨盤傾斜角の正常値を報告。PALM法で左右差2°以内が正常範囲。骨盤の左右非対称は全身の歪み指標となる。'),
      },
      {
        key: 'head',
        label: '頭部の傾き',
        score: headScore,
        confidence: lmConfidence(nose, ls, rs),
        detail: headOffset < 1 ? '正中' : nose.x < sMid.x ? '左に傾斜' : '右に傾斜',
        value: `${headOffset.toFixed(1)}%偏位`,
        valueCm: `${(headOffsetRaw * cmPerUnit).toFixed(1)}cm`,
        reference: paper('singla2017Head', 'フォトグラメトリーによる冠状面の頭部傾斜評価は中〜高の検者内信頼性（ICC=0.82-0.95）。1.5%以内の偏位が正常範囲。'),
      },
      {
        key: 'center',
        label: '重心の左右ズレ',
        score: centerScore,
        confidence: lmConfidence(ls, rs, lh, rh),
        detail: centerOffset < 1 ? '正中' : sMid.x < hMid.x ? '左にズレ' : '右にズレ',
        value: `${centerOffset.toFixed(1)}%偏位`,
        valueCm: `${(centerOffsetRaw * cmPerUnit).toFixed(1)}cm`,
        reference: paper('ferreira2010', '姿勢評価ソフトウェアSAPOの妥当性・信頼性を検証。角度・距離ともに高い検者間・検者内信頼性を確認（ICC=0.90-0.98）。'),
      },
    ],
  };
}

// ------------------------------------------------------------
// 背面（脊柱・体幹の左右傾斜を含む）
// ------------------------------------------------------------
export function analyzeBack(lm) {
  const L = POSTURE_LM;
  const ls = lm[L.LEFT_SHOULDER];
  const rs = lm[L.RIGHT_SHOULDER];
  const lh = lm[L.LEFT_HIP];
  const rh = lm[L.RIGHT_HIP];
  const nose = lm[L.NOSE];
  const sMid = mid(ls, rs);
  const hMid = mid(lh, rh);
  const shoulderWidth = Math.sqrt((rs.x - ls.x) ** 2 + (rs.y - ls.y) ** 2);
  const refLen = shoulderWidth > 0.01 ? shoulderWidth : 0.2;

  const shoulderDy = rs.y - ls.y;
  const shoulderTilt = lineTilt(rs.x - ls.x, shoulderDy);
  const shoulderScore = tiltScore(shoulderTilt);

  const hipDy = rh.y - lh.y;
  const hipTilt = lineTilt(rh.x - lh.x, hipDy);
  const hipScore = tiltScore(hipTilt);

  // 脊柱の左右偏位: 腰中点→肩中点の線から頭（鼻）がどれだけ横に外れているか。
  // 頭が見えていない（後ろ姿で鼻の信頼度が低い）時は判定しない
  const spineCross = (() => {
    if (!nose || nose.visibility < 0.5) return null;
    const vx = sMid.x - hMid.x;
    const vy = sMid.y - hMid.y;
    const len = Math.sqrt(vx * vx + vy * vy);
    if (len < 0.001) return null;
    const hx = nose.x - sMid.x;
    const hy = nose.y - sMid.y;
    return (vx * hy - vy * hx) / len;
  })();
  const spineDeviation = spineCross == null ? 0 : (Math.abs(spineCross) / refLen) * 6;
  const spineScore = spineDeviation <= 1 ? Math.round(100 - spineDeviation * 5)
    : spineDeviation <= 2.5 ? Math.round(95 - (spineDeviation - 1) * 10)
      : spineDeviation <= 5 ? Math.round(80 - (spineDeviation - 2.5) * 12)
        : Math.round(Math.max(0, 50 - (spineDeviation - 5) * 6));

  const trunkLateral = (Math.abs(sMid.x - hMid.x) / refLen) * 6;
  const trunkScore = offsetScore(trunkLateral);

  const cmPerUnit = REF_SHOULDER_WIDTH_CM / refLen;
  return {
    items: [
      {
        key: 'shoulder',
        label: '肩の左右バランス',
        score: shoulderScore,
        confidence: lmConfidence(ls, rs),
        detail: shoulderTilt < 1 ? '均等' : ls.y < rs.y ? '左肩が高い' : '右肩が高い',
        value: `${shoulderTilt.toFixed(1)}°`,
        valueCm: `${(Math.abs(shoulderDy) * cmPerUnit).toFixed(1)}cm`,
        reference: paper('fortin2011', 'フォトグラメトリーによる肩傾斜角の測定は高い信頼性（ICC>0.90）。2°以内が正常範囲、15°以上で側弯症の兆候。'),
      },
      {
        key: 'hip',
        label: '骨盤の左右バランス',
        score: hipScore,
        confidence: lmConfidence(lh, rh),
        detail: hipTilt < 1 ? '均等' : lh.y < rh.y ? '左が高い' : '右が高い',
        value: `${hipTilt.toFixed(1)}°`,
        valueCm: `${(Math.abs(hipDy) * cmPerUnit).toFixed(1)}cm`,
        reference: paper('herrington2011', '無症状者120名で骨盤傾斜角の正常値を報告。PALM法で左右差2°以内が正常範囲。'),
      },
      {
        key: 'spine',
        label: '脊柱の左右偏位',
        score: spineScore,
        confidence: lmConfidence(nose, ls, rs, lh, rh),
        detail: spineDeviation < 1 ? '正中' : spineCross == null ? '判定不可' : spineCross > 0 ? '右に偏位' : '左に偏位',
        value: `${spineDeviation.toFixed(1)}%偏位`,
        valueCm: `${(spineCross == null ? 0 : Math.abs(spineCross) * cmPerUnit).toFixed(1)}cm`,
        reference: paper('fortin2011', '脊柱の左右偏位はフォトグラメトリーで信頼性高く測定可能。頭頂-肩中点-腰中点の直線性で評価。1%以内が正常。'),
      },
      {
        key: 'trunk',
        label: '体幹の左右傾斜',
        score: trunkScore,
        confidence: lmConfidence(ls, rs, lh, rh),
        detail: trunkLateral < 1 ? '正中' : sMid.x < hMid.x ? '左に傾斜' : '右に傾斜',
        value: `${trunkLateral.toFixed(1)}%偏位`,
        valueCm: `${(Math.abs(sMid.x - hMid.x) * cmPerUnit).toFixed(1)}cm`,
        reference: paper('ferreira2010', '姿勢評価ソフトウェアSAPOによる体幹傾斜の測定は高い信頼性（ICC=0.90-0.98）。肩-腰の水平ズレで評価。'),
      },
    ],
  };
}

// ------------------------------------------------------------
// 側面（左側から撮影）
// ------------------------------------------------------------
export function analyzeSide(lm) {
  const L = POSTURE_LM;
  const ear = lm[L.LEFT_EAR];
  const sh = lm[L.LEFT_SHOULDER];
  const hip = lm[L.LEFT_HIP];
  const knee = lm[L.LEFT_KNEE];
  const ankle = lm[L.LEFT_ANKLE];
  // 肩-腰間距離を基準長として正規化
  const shHipDist = Math.sqrt((sh.x - hip.x) ** 2 + (sh.y - hip.y) ** 2);
  const refLenSide = shHipDist > 0.01 ? shHipDist : 0.15;

  // 1. CVA（頭蓋脊椎角）: 耳-肩の前方偏位から推定。CVA 50°未満を前方頭位と定義（Shaghayegh Fard 2016）
  const headFwd = ear.x - sh.x;
  const estimatedCVA = 60 - (Math.abs(headFwd) / refLenSide) * 22;
  const cvaScore = estimatedCVA >= 55 ? Math.round(Math.min(100, 90 + (estimatedCVA - 55) * 2))
    : estimatedCVA >= 50 ? Math.round(70 + (estimatedCVA - 50) * 4)
      : estimatedCVA >= 45 ? Math.round(40 + (estimatedCVA - 45) * 6)
        : Math.round(Math.max(0, estimatedCVA * 0.9));

  // 2. 巻き肩・猫背（耳-肩-腰の角度）
  const shAngle = calcAngle(ear, sh, hip);
  const roundShoulderScore = shAngle >= 160 ? Math.round(Math.min(100, 90 + (shAngle - 160) * 0.5))
    : shAngle >= 150 ? Math.round(70 + (shAngle - 150) * 2)
      : shAngle >= 140 ? Math.round(40 + (shAngle - 140) * 3)
        : Math.round(Math.max(0, shAngle * 0.29));

  // 3. 骨盤前後傾（肩-腰-膝の角度）
  const hipAngle = calcAngle(sh, hip, knee);
  const pelvicDeviation = Math.abs(hipAngle - 170);
  const pelvicScore = pelvicDeviation <= 5 ? Math.round(100 - pelvicDeviation * 2)
    : pelvicDeviation <= 10 ? Math.round(90 - (pelvicDeviation - 5) * 4)
      : pelvicDeviation <= 15 ? Math.round(70 - (pelvicDeviation - 10) * 6)
        : Math.round(Math.max(0, 40 - (pelvicDeviation - 15) * 4));

  // 4. 膝過伸展（腰-膝-足首の角度）
  const kneeAngle = calcAngle(hip, knee, ankle);
  const kneeDeviation = Math.abs(kneeAngle - 175);
  const kneeScore = kneeDeviation <= 5 ? Math.round(100 - kneeDeviation * 2)
    : kneeDeviation <= 10 ? Math.round(90 - (kneeDeviation - 5) * 4)
      : kneeDeviation <= 15 ? Math.round(70 - (kneeDeviation - 10) * 6)
        : Math.round(Math.max(0, 40 - (kneeDeviation - 15) * 4));

  const cmPerUnit = REF_SH_HIP_DIST_CM / refLenSide;
  const roundShoulderDevCm = Math.abs(180 - shAngle) > 0 ? Math.abs(ear.x - hip.x) * cmPerUnit : 0;
  const kneeDevCm = Math.abs(hip.x - ankle.x) > 0 ? Math.abs(knee.x - (hip.x + ankle.x) / 2) * cmPerUnit : 0;
  return {
    items: [
      {
        key: 'head',
        label: '頭部前方偏位（CVA）',
        score: cvaScore,
        confidence: lmConfidence(ear, sh),
        detail: estimatedCVA >= 55 ? '正常' : estimatedCVA >= 50 ? '軽度の前方偏位' : estimatedCVA >= 45 ? '中度の前方偏位' : '重度の前方偏位（ストレートネック疑い）',
        value: `推定CVA ${Math.round(estimatedCVA)}°`,
        valueCm: `${(Math.abs(headFwd) * cmPerUnit).toFixed(1)}cm前方`,
        reference: paper('shaghayegh2016', 'FHP群と健常群25名ずつで立位・座位のCVAを比較。CVA 50°未満を前方頭位(FHP)と定義。健常群の平均CVAは立位で約55°。'),
      },
      {
        key: 'shoulder',
        label: '巻き肩・猫背',
        score: roundShoulderScore,
        confidence: lmConfidence(ear, sh, hip),
        detail: shAngle >= 160 ? '正常' : shAngle >= 150 ? '軽度の巻き肩' : shAngle >= 140 ? '中度の巻き肩' : '巻き肩傾向が強い',
        value: `${shAngle.toFixed(0)}°`,
        valueCm: `${roundShoulderDevCm.toFixed(1)}cm`,
        reference: paper('singla2017Shoulder', '前方頭位・巻き肩・胸椎後弯の関連をレビュー。矢状面での肩角160°以上が正常目安。前方頭位と巻き肩は強い相関を示す。'),
      },
      {
        key: 'hip',
        label: '骨盤の前後傾斜',
        score: pelvicScore,
        confidence: lmConfidence(sh, hip, knee),
        detail: pelvicDeviation <= 5 ? '正常範囲' : hipAngle > 170 ? '後傾傾向' : '前傾傾向',
        value: `${hipAngle.toFixed(0)}°`,
        valueCm: `${(Math.abs(sh.x - hip.x) * cmPerUnit).toFixed(1)}cm`,
        reference: paper('herrington2011', '無症状者120名の骨盤傾斜角を測定。平均前傾角13.0±4.9°（PALM法）。165-175°の範囲が正常。'),
      },
      {
        key: 'knee',
        label: '膝の過伸展',
        score: kneeScore,
        confidence: lmConfidence(hip, knee, ankle),
        detail: kneeDeviation <= 5 ? '正常範囲' : kneeAngle > 180 ? '過伸展' : 'やや屈曲',
        value: `${kneeAngle.toFixed(0)}°`,
        valueCm: `${kneeDevCm.toFixed(1)}cm`,
        reference: paper('loudon1998', '膝伸展5°超を膝過伸展(Genu Recurvatum)と定義。170-180°が正常範囲。過伸展は膝痛・靭帯不安定のリスク因子。'),
      },
    ],
  };
}

// ------------------------------------------------------------
// 座位（左側面から撮影）
// ------------------------------------------------------------
export function analyzeSeated(lm) {
  const L = POSTURE_LM;
  const ear = lm[L.LEFT_EAR];
  const sh = lm[L.LEFT_SHOULDER];
  const hip = lm[L.LEFT_HIP];
  const nose = lm[L.NOSE];
  const shHipDist = Math.sqrt((sh.x - hip.x) ** 2 + (sh.y - hip.y) ** 2);
  const refLenSeated = shHipDist > 0.01 ? shHipDist : 0.15;

  // 座位では頭が立位より前に出やすいため基準を緩める
  const headFwd = ear.x - sh.x;
  const estimatedCVA = 55 - (Math.abs(headFwd) / refLenSeated) * 18;
  const headScore = estimatedCVA >= 50 ? Math.round(Math.min(100, 85 + (estimatedCVA - 50) * 3))
    : estimatedCVA >= 45 ? Math.round(60 + (estimatedCVA - 45) * 5)
      : estimatedCVA >= 40 ? Math.round(35 + (estimatedCVA - 40) * 5)
        : Math.round(Math.max(0, estimatedCVA * 0.88));

  const shAngle = calcAngle(ear, sh, hip);
  const shoulderScore = shAngle >= 155 ? Math.round(Math.min(100, 85 + (shAngle - 155) * 3))
    : shAngle >= 145 ? Math.round(60 + (shAngle - 145) * 2.5)
      : shAngle >= 135 ? Math.round(35 + (shAngle - 135) * 2.5)
        : Math.round(Math.max(0, shAngle * 0.26));

  const trunkTilt = (Math.abs(sh.x - hip.x) / refLenSeated) * 6;
  const trunkScore = trunkTilt <= 2 ? Math.round(100 - trunkTilt * 5)
    : trunkTilt <= 4 ? Math.round(90 - (trunkTilt - 2) * 10)
      : trunkTilt <= 7 ? Math.round(70 - (trunkTilt - 4) * 10)
        : Math.round(Math.max(0, 40 - (trunkTilt - 7) * 6));

  const headVsHip = (Math.abs(nose.x - hip.x) / refLenSeated) * 6;
  const postureScore = headVsHip <= 3 ? Math.round(100 - headVsHip * 3.3)
    : headVsHip <= 6 ? Math.round(90 - (headVsHip - 3) * 6.7)
      : headVsHip <= 10 ? Math.round(70 - (headVsHip - 6) * 7.5)
        : Math.round(Math.max(0, 40 - (headVsHip - 10) * 5));

  const cmPerUnit = REF_SH_HIP_DIST_CM / refLenSeated;
  return {
    items: [
      {
        key: 'head',
        label: '頭部前方偏位（座位）',
        score: headScore,
        confidence: lmConfidence(ear, sh),
        detail: estimatedCVA >= 50 ? '正常' : estimatedCVA >= 45 ? '軽度の前方偏位' : '前方偏位',
        value: `推定CVA ${Math.round(estimatedCVA)}°`,
        valueCm: `${(Math.abs(ear.x - sh.x) * cmPerUnit).toFixed(1)}cm前方`,
        reference: paper('shaghayegh2016', '座位CVAは立位より有意に低下。FHP群の座位CVAは健常群より約8°小さい。デスクワーク時の前方頭位に注意。'),
      },
      {
        key: 'shoulder',
        label: '巻き肩・猫背（座位）',
        score: shoulderScore,
        confidence: lmConfidence(ear, sh, hip),
        detail: shAngle >= 155 ? '正常' : shAngle >= 145 ? '軽度の猫背' : '猫背傾向',
        value: `${shAngle.toFixed(0)}°`,
        valueCm: `${(Math.abs(ear.x - hip.x) * cmPerUnit).toFixed(1)}cm`,
        reference: paper('singla2017Shoulder', '座位での矢状面肩角は立位より基準がやや緩い（155°以上が正常目安）。前方頭位と巻き肩・胸椎後弯は相互に関連。'),
      },
      {
        key: 'trunk',
        label: '体幹の傾き',
        score: trunkScore,
        confidence: lmConfidence(sh, hip),
        detail: trunkTilt < 2 ? '垂直' : sh.x < hip.x ? '後方に傾斜' : '前方に傾斜',
        value: `${trunkTilt.toFixed(1)}%`,
        valueCm: `${(Math.abs(sh.x - hip.x) * cmPerUnit).toFixed(1)}cm`,
        reference: paper('kocur2019', '座位での頸椎前方偏位のある女性事務員は上部僧帽筋の硬直度が11.3%高い。座位体幹傾斜2%以内が理想。'),
      },
      {
        key: 'posture',
        label: '座位姿勢バランス',
        score: postureScore,
        confidence: lmConfidence(nose, hip),
        detail: headVsHip < 3 ? '良好' : nose.x > hip.x ? '頭部が前方' : '頭部が後方',
        value: `${headVsHip.toFixed(1)}%`,
        valueCm: `${(Math.abs(nose.x - hip.x) * cmPerUnit).toFixed(1)}cm`,
        reference: paper('yip2008', '頸部痛患者62名と健常者52名でCVA角を比較。頭部前方偏位と痛み・障害に有意な相関を確認。頭部-骨盤バランスは座位姿勢の重要指標。'),
      },
    ],
  };
}

// ------------------------------------------------------------
// まとめ
// ------------------------------------------------------------
/** viewMode に応じて分析する。ランドマークが揃っていなければ null */
export function analyzePosture(viewMode, lm) {
  if (!Array.isArray(lm) || lm.length <= POSTURE_LM.RIGHT_ANKLE) return null;
  if (viewMode === 'front') return analyzeFront(lm);
  if (viewMode === 'back') return analyzeBack(lm);
  if (viewMode === 'seated') return analyzeSeated(lm);
  return analyzeSide(lm);
}

/** 信頼度が極端に低い（< 0.5）項目。スコアは参考値として扱う */
export function isLowConfidence(item) {
  return item.confidence != null && item.confidence < 0.5;
}

/** 総合スコア。信頼度が極低の項目を除いて平均し、全部除外なら null */
export function getTotal(analysis) {
  if (!analysis || !Array.isArray(analysis.items)) return null;
  const valid = analysis.items.filter((i) => !isLowConfidence(i));
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((s, i) => s + i.score, 0) / valid.length);
}

/** 0〜100 の総合スコアを施術レポートの 0〜5 点（0.5 刻み）に換算 */
export function toFivePointScale(total) {
  if (total == null || !Number.isFinite(total)) return null;
  return Math.min(5, Math.max(0, Math.round((total / 100) * 5 * 2) / 2));
}
