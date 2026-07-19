export type NavigationItem = {
  label: string;
  href: string;
  icon: string;
  permission?: string;
};

export const primaryNavigation: NavigationItem[] = [
  { label: 'Command Center', href: '/command-center', icon: '⌁' },
  { label: 'Repositories', href: '/repositories', icon: '⌘' },
  { label: 'Incidents', href: '/incidents', icon: '!' },
  { label: 'Investigations', href: '/investigations', icon: '◇' },
  { label: 'Recoveries', href: '/recoveries', icon: '↻' },
  { label: 'Publications', href: '/publications', icon: '⇧' },
  { label: 'Approvals', href: '/approvals', icon: '✓' },
  { label: 'Audit Trail', href: '/audit', icon: '≡' },
];

export const settingsNavigation: NavigationItem[] = [
  { label: 'GitHub Integration', href: '/integrations/github', icon: 'GH' },
  { label: 'Organization', href: '/settings/organization', icon: 'O' },
  { label: 'AI Policy', href: '/settings/ai', icon: 'AI' },
  { label: 'Recovery Policy', href: '/settings/recovery', icon: 'R' },
  { label: 'Publication Policy', href: '/settings/publication', icon: 'P' },
  { label: 'Security', href: '/settings/security', icon: 'S' },
];

export const incidentSections = [
  'overview',
  'evidence',
  'triage',
  'reproduction',
  'investigation',
  'treatment-plan',
  'recovery',
  'verification',
  'publication',
  'activity',
] as const;
