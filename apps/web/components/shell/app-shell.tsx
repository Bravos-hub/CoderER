'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { primaryNavigation, settingsNavigation } from '../../lib/navigation';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="appFrame">
      <aside className="sidebar">
        <Link href="/command-center" className="sidebarBrand">
          <span className="brandMark" aria-hidden="true" />
          <span>
            Code<span className="er">ER</span>
          </span>
        </Link>
        <nav aria-label="Primary navigation" className="sidebarNav">
          {primaryNavigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname.startsWith(item.href) ? 'active' : ''}
            >
              <span className="navIcon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebarSectionLabel">SYSTEM</div>
        <nav aria-label="Settings navigation" className="sidebarNav compact">
          {settingsNavigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname.startsWith(item.href) ? 'active' : ''}
            >
              <span className="navIcon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebarFooter">
          <span className="statusDot" />
          <div>
            <strong>Development</strong>
            <small>Control plane connected</small>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="workspaceHeader">
          <div>
            <span className="eyebrow">AI SOFTWARE EMERGENCY RESPONSE</span>
          </div>
          <div className="headerActions">
            <button className="iconButton" aria-label="Open notifications">
              ●
            </button>
            <div className="avatar">BR</div>
          </div>
        </header>
        <main className="workspaceMain">{children}</main>
      </div>
    </div>
  );
}
