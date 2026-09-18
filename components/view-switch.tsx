'use client';
/* eslint-disable next/no-html-link-for-pages -- Keep the view switch usable through native navigation. */

import { usePathname } from 'next/navigation';

export function ViewSwitch() {
  const observer = usePathname() === '/observe';
  return (
    <nav className="view-switch" aria-label="Reading view">
      <a href="/" aria-current={!observer ? 'page' : undefined}>
        Agents
      </a>
      <a href="/observe" aria-current={observer ? 'page' : undefined}>
        Observe
      </a>
    </nav>
  );
}
