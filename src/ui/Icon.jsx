import { createElement } from 'react';
import ICONS from './icons.generated.js';

// lucide のアイコンを名前（kebab-case）で描画する。
// 使える名前は src/ 内に文字列で書かれていれば scripts/build.mjs が自動で取り込む。
export default function Icon({ name, size = 18, strokeWidth = 1.75, className = '', title, style }) {
  const node = ICONS[name];
  if (!node) {
    if (process.env.NODE_ENV !== 'production' && name) console.warn(`[Icon] unknown icon: ${name}`);
    return <span className={`inline-block shrink-0 ${className}`} style={{ width: size, height: size, ...style }} aria-hidden="true" />;
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      style={style}
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {node.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}
