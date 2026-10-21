// ============================================================
// からだの図（お悩みの部位を光らせる）
// ------------------------------------------------------------
// 顔・頭（小顔矯正）/ 首・肩・背中（姿勢矯正）/ 腰・下半身（骨盤矯正）の 3つの部位。
// お悩みのある部位をブランドの緑で塗り、やわらかく光らせる。説明用の簡単な図。
// ============================================================

const BASE = '#e4e9e3';
// 左の腕・脚（右は左右反転して使う）
const ARM = 'M62 109 C 52 115 47 131 46 150 C 44 172 42 196 41 220 C 40 232 41 244 46 250 C 51 254 55 249 55 241 C 56 221 58 199 60 179 C 61 167 63 155 64 143 Z';
const LEG = 'M71 262 C 71 300 75 338 81 370 C 85 390 86 406 85 417 C 85 424 91 427 99 427 C 104 427 106 423 106 417 C 106 401 106 385 106 369 C 107 341 108 315 110 290 Z';
const BASE_LINE = '#cfd7cf';
const ON = '#4fa277';
const ON_DEEP = '#236c48';

function Zone({ on, children, label }) {
  return (
    <g aria-label={label} style={{ transition: 'fill .4s ease, filter .4s ease', filter: on ? 'url(#pz-glow)' : 'none' }}
      fill={on ? 'url(#pz-zone)' : BASE} stroke={on ? ON_DEEP : BASE_LINE} strokeWidth={on ? 1.5 : 1}>
      {children}
    </g>
  );
}

/**
 * @param {{ face:boolean, posture:boolean, pelvis:boolean }} active お悩みのある部位
 */
export default function BodyMap({ active = {}, className = '' }) {
  return (
    <svg viewBox="0 0 220 440" className={className} role="img"
      aria-label={`お悩みの部位: ${[active.face && '顔・頭', active.posture && '首・肩・背中', active.pelvis && '腰・下半身'].filter(Boolean).join('、') || 'なし'}`}>
      <defs>
        <linearGradient id="pz-zone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7dbf9b" />
          <stop offset="1" stopColor={ON} />
        </linearGradient>
        <filter id="pz-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="5" result="blur" />
          <feFlood floodColor={ON} floodOpacity="0.45" />
          <feComposite in2="blur" operator="in" result="glow" />
          <feMerge><feMergeNode in="glow" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* 足元の影 */}
      <ellipse cx="110" cy="430" rx="50" ry="6" fill="#dfe5de" />

      {/* 腰・下半身（骨盤・脚） */}
      <Zone on={active.pelvis} label="腰・下半身">
        <path d={LEG} />
        <path d={LEG} transform="matrix(-1 0 0 1 220 0)" />
        <path d="M82 200 L138 200 C 146 220 152 244 150 266 C 148 282 136 292 120 294 L110 295 L100 294 C 84 292 72 282 70 266 C 68 244 74 220 82 200 Z" />
      </Zone>

      {/* 首・肩・背中（上半身・腕） */}
      <Zone on={active.posture} label="首・肩・背中">
        <path d={ARM} />
        <path d={ARM} transform="matrix(-1 0 0 1 220 0)" />
        <path d="M101 68 L119 68 L121 96 L99 96 Z" />
        <path d="M100 90 C 86 94 70 97 62 107 C 56 115 57 131 61 145 C 67 165 75 184 81 204 L139 204 C 145 184 153 165 159 145 C 163 131 164 115 158 107 C 150 97 134 94 120 90 Z" />
      </Zone>

      {/* 顔・頭 */}
      <Zone on={active.face} label="顔・頭">
        <ellipse cx="110" cy="44" rx="24" ry="29" />
      </Zone>
    </svg>
  );
}
