import { useState } from 'react';
import { useSyncExternalStore } from 'react';
import { getTheme, subscribeTheme } from '../store/theme';

/** 自动收集 assets/bg-*.{webp,png}，新图加入目录即自动参与轮换 */
const bgImages = Object.values(
  import.meta.glob('../assets/bg-*.{webp,png}', { eager: true, import: 'default', query: '?url' })
) as string[];

/** 记住上次展示的图，避免连续两次回到主页看到同一张 */
let lastIndex = -1;

function pickIndex(): number {
  if (bgImages.length <= 1) return 0;
  const candidates = bgImages.map((_, i) => i).filter((i) => i !== lastIndex);
  const next = candidates[Math.floor(Math.random() * candidates.length)];
  lastIndex = next;
  return next;
}

/**
 * 全屏背景：每次进入主页（刷新 / 从其他页面返回）随机换一张。
 * 固定层覆盖整个视口，白蒙版保证内容可读。仅浅色主题渲染。
 */
export default function PageBackground() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => 'blast');
  const isLight = theme === 'light';
  const [activeIndex] = useState(() => pickIndex());

  if (!bgImages.length || !isLight) return null;

  return (
    <div className="page-bg" aria-hidden="true">
      <div
        className="page-bg-layer page-bg-active"
        style={{ backgroundImage: `url(${bgImages[activeIndex]})` }}
      />
      <div className="page-bg-mask" />
    </div>
  );
}
