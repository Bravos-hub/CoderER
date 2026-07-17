import { describe, expect, it } from 'vitest';
import { incidentSections, primaryNavigation, settingsNavigation } from './navigation';

describe('command center navigation', () => {
  it('exposes every primary operational workspace once', () => {
    const hrefs = primaryNavigation.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/command-center',
        '/repositories',
        '/incidents',
        '/recoveries',
        '/publications',
        '/approvals',
        '/audit',
      ]),
    );
  });
  it('exposes all incident lifecycle sections', () => {
    expect(incidentSections).toEqual(
      expect.arrayContaining([
        'evidence',
        'triage',
        'reproduction',
        'investigation',
        'treatment-plan',
        'recovery',
        'verification',
        'publication',
        'activity',
      ]),
    );
  });
  it('keeps secret-bearing integration configuration in settings navigation', () => {
    expect(settingsNavigation.some((item) => item.href === '/integrations/github')).toBe(true);
  });
});
