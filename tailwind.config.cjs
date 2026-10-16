// Tailwind 設定（scripts/build.mjs から CLI で使う）
// 色はデザイントークン（src/styles/app.css の CSS 変数）に寄せているため、
// ライト/ダークの切り替えは基本的に変数側で完結する。
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

const brand = {
  50: '#eef7f1',
  100: '#d5ecdd',
  200: '#aed9bf',
  300: '#7dbf9b',
  400: '#4fa277',
  500: '#2f8559',
  600: '#236c48',
  700: '#1d573b',
  800: '#194631',
  900: '#163a29',
  950: '#0b2117',
};

module.exports = {
  content: ['./src/**/*.{js,jsx}', './public/index.html'],
  // <html data-theme="dark|light"> は index.html の先頭スクリプトが OS 設定と
  // 画面のテーマ切り替えから決めて付ける（表示前に決まるのでちらつかない）
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: token('canvas'),
        surface: {
          DEFAULT: token('surface'),
          2: token('surface-2'),
          3: token('surface-3'),
        },
        line: {
          DEFAULT: token('line'),
          strong: token('line-strong'),
        },
        ink: {
          DEFAULT: token('ink'),
          2: token('ink-2'),
        },
        muted: token('muted'),
        brand,
        // 旧コード（出納帳・施術ツール）の sise-* クラスは新しいブランド色で表示する
        sise: brand,
        gold: {
          50: '#fdf8eb',
          100: '#faedc8',
          200: '#f4d88c',
          300: '#ecbf4f',
          400: '#e2a62b',
          500: '#c98a14',
          600: '#a76c0f',
          700: '#855211',
          800: '#6d4314',
          900: '#5c3815',
        },
      },
      fontFamily: {
        sans: ['Inter', '"Noto Sans JP"', '"Hiragino Sans"', '"Hiragino Kaku Gothic ProN"', 'Meiryo', 'system-ui', 'sans-serif'],
      },
      // ダーク時の淡い塗り（12% / 18%）に使う。既定の目盛りに無いので足しておく
      opacity: {
        12: '0.12',
        18: '0.18',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      boxShadow: {
        card: '0 1px 2px rgb(16 24 20 / 0.04), 0 1px 1px rgb(16 24 20 / 0.03)',
        pop: '0 12px 32px -8px rgb(16 24 20 / 0.18), 0 2px 6px rgb(16 24 20 / 0.06)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'rise-in': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        'sheet-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'none' } },
        // transform を使うと、画面の中の position:fixed（スマホの記帳ボタンなど）の基準がずれるので不透明度だけ
        'page-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        'fade-in': 'fade-in .18s ease-out both',
        'rise-in': 'rise-in .22s cubic-bezier(.16,1,.3,1) both',
        'sheet-up': 'sheet-up .26s cubic-bezier(.16,1,.3,1) both',
        'page-in': 'page-in .22s ease-out both',
        'ping-slow': 'ping 1.8s cubic-bezier(0,0,.2,1) infinite',
      },
    },
  },
  plugins: [],
};
