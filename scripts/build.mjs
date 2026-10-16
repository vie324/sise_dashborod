// ============================================================
// フロントエンドのビルド
// ------------------------------------------------------------
//   node scripts/build.mjs          本番ビルド（public/assets/ に出力）
//   node scripts/build.mjs --watch  開発用（変更を監視して再ビルド）
//
// 1. src/ 内で使っているアイコン名（'chevron-down' など）を拾い、
//    lucide から必要な分だけ import する src/ui/icons.generated.js を作る
// 2. esbuild で src/main.jsx をバンドル → public/assets/app.js
// 3. Tailwind CLI で src/styles/app.css をビルド → public/assets/app.css
//
// Vercel では vercel.json の buildCommand から実行される。
// ============================================================

import * as esbuild from 'esbuild';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const outDir = path.join(root, 'public/assets');
const srcDir = path.join(root, 'src');

// ------------------------------------------------------------
// 1. アイコン
// ------------------------------------------------------------
const pascalToKebab = (s) => s
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .replace(/([A-Za-z])([0-9])/g, '$1-$2')
  .toLowerCase();

function lucideNameIndex() {
  const index = new Map(); // kebab → PascalCase export name
  const iconsDir = path.join(root, 'node_modules/lucide/dist/esm/icons');
  const kebabToPascal = (k) => k.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  for (const f of fs.readdirSync(iconsDir)) {
    if (!f.endsWith('.mjs')) continue;
    const kebab = f.slice(0, -4);
    index.set(kebab, null);
  }
  // 正規名とエイリアス（旧名）の両方を拾う: export { default as A, default as B } from './icons/x.mjs'
  const entry = fs.readFileSync(path.join(root, 'node_modules/lucide/dist/esm/lucide.mjs'), 'utf8');
  const re = /export \{([^}]+)\} from '\.\/icons\/([a-z0-9-]+)\.mjs'/g;
  let m;
  while ((m = re.exec(entry))) {
    const names = m[1].split(',').map((s) => s.trim().replace(/^default as /, ''));
    for (const name of names) {
      const kebab = pascalToKebab(name);
      if (!index.get(kebab)) index.set(kebab, name);
    }
    if (!index.get(m[2])) index.set(m[2], names[0] || kebabToPascal(m[2]));
  }
  return index;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(jsx?|mjs)$/.test(e.name) && !e.name.endsWith('.generated.js')) out.push(p);
  }
  return out;
}

export function generateIcons() {
  const index = lucideNameIndex();
  const used = new Set();
  const literal = /['"`]([a-z][a-z0-9]*(?:-[a-z0-9]+)*)['"`]/g;
  for (const file of walk(srcDir)) {
    const text = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = literal.exec(text))) {
      if (index.has(m[1]) && index.get(m[1])) used.add(m[1]);
    }
  }
  const names = [...used].sort();
  const lines = [
    '// このファイルは scripts/build.mjs が自動生成する（手で編集しない）。',
    '// src/ 内の文字列リテラルのうち lucide のアイコン名に一致するものだけを取り込む。',
    `import { ${[...new Set(names.map((k) => index.get(k)))].sort().join(', ')} } from 'lucide';`,
    '',
    'export default {',
    ...names.map((k) => `  '${k}': ${index.get(k)},`),
    '};',
    '',
  ];
  const target = path.join(srcDir, 'ui/icons.generated.js');
  const next = lines.join('\n');
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== next) fs.writeFileSync(target, next);
  return names.length;
}

// ------------------------------------------------------------
// 2. JS
// ------------------------------------------------------------
const esbuildOptions = {
  entryPoints: [path.join(srcDir, 'main.jsx')],
  bundle: true,
  format: 'iife',
  target: ['es2020', 'safari15', 'chrome90', 'firefox90'],
  outfile: path.join(outDir, 'app.js'),
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  minify: !watch,
  sourcemap: true,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  logLevel: 'info',
};

// ------------------------------------------------------------
// 3. CSS
// ------------------------------------------------------------
const tailwindBin = path.join(root, 'node_modules/.bin/tailwindcss');
const tailwindArgs = ['-c', path.join(root, 'tailwind.config.cjs'), '-i', path.join(srcDir, 'styles/app.css'), '-o', path.join(outDir, 'app.css')];

fs.mkdirSync(outDir, { recursive: true });
const iconCount = generateIcons();
console.log(`icons: ${iconCount}`);

if (watch) {
  const ctx = await esbuild.context({
    ...esbuildOptions,
    plugins: [{
      name: 'regenerate-icons',
      setup(build) { build.onStart(() => { generateIcons(); }); },
    }],
  });
  await ctx.watch();
  spawn(tailwindBin, [...tailwindArgs, '--watch'], { stdio: 'inherit' });
  console.log('watching… (Ctrl+C で終了)');
} else {
  await esbuild.build(esbuildOptions);
  const r = spawnSync(tailwindBin, [...tailwindArgs, '--minify'], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}
