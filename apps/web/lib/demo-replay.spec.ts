import { describe, expect, it } from 'vitest';
import { DEMO_REPLAY_INCIDENT_ID, isSeededReplayIncident } from './demo-replay';

describe('seeded replay identification', () => {
  it('matches only the frozen demo incident', () => {
    expect(DEMO_REPLAY_INCIDENT_ID).toBe('00000000-0000-4000-8000-000000290004');
    expect(isSeededReplayIncident('00000000-0000-4000-8000-000000290004')).toBe(true);
    expect(isSeededReplayIncident('00000000-0000-4000-8000-000000290005')).toBe(false);
    expect(isSeededReplayIncident('')).toBe(false);
  });
});
