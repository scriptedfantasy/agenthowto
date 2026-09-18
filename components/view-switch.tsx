'use client';
/* eslint-disable next/no-html-link-for-pages -- Keep the view switch usable through native navigation. */

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

export function ViewSwitch() {
  const pathname = usePathname();
  const observer = pathname === '/observe';
  useEffect(() => {
    // Fragments never reach the server. Preserve old monitoring bookmarks;
    // the old anchor also retains a normal link for readers without JavaScript.
    const followMonitoring = () => {
      if (
        window.location.pathname !== '/' ||
        window.location.hash !== '#activity'
      )
        return;
      const month =
        new URLSearchParams(window.location.search).get('month') ??
        new Date().toISOString().slice(0, 7);
      window.location.replace(
        '/observe?' + new URLSearchParams({ month }) + '#activity',
      );
    };
    followMonitoring();
    window.addEventListener('hashchange', followMonitoring);
    return () => window.removeEventListener('hashchange', followMonitoring);
  }, [pathname]);
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
