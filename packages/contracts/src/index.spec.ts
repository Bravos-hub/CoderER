import { describe, expect, it } from 'vitest';
import {
  AdmitRepositorySchema,
  CreateIncidentSchema,
  IncidentSeverity,
  IncidentSource,
  RepositoryIntakeJobSchema,
} from './index.js';

describe('CodeER contracts', () => {
  it('applies the default incident source', () => {
    const value = CreateIncidentSchema.parse({
      repositoryId: '7f3df97f-56fa-4e9a-b3a8-c5b87df4a7bc',
      title: 'Production build failed',
      description: 'The deployment pipeline cannot build the web application.',
    });
    expect(value.source).toBe(IncidentSource.MANUAL);
  });

  it('requires a documented reason for manual severity overrides', () => {
    expect(() =>
      CreateIncidentSchema.parse({
        repositoryId: '7f3df97f-56fa-4e9a-b3a8-c5b87df4a7bc',
        title: 'Production build failed',
        description: 'The deployment pipeline cannot build the web application.',
        severity: IncidentSeverity.SEV2,
      }),
    ).toThrow();
  });

  it('accepts a valid GitHub repository admission', () => {
    const value = AdmitRepositorySchema.parse({
      repositoryUrl: 'https://github.com/Bravos-hub/CoderER',
      baseBranch: 'main',
    });
    expect(value.baseBranch).toBe('main');
  });

  it('rejects a repository outside the supported GitHub host', () => {
    expect(() =>
      AdmitRepositorySchema.parse({ repositoryUrl: 'https://example.com/team/repository' }),
    ).toThrow();
  });

  it('rejects repository URLs containing credentials, query strings, or nested paths', () => {
    for (const repositoryUrl of [
      'https://token@github.com/Bravos-hub/CoderER',
      'https://github.com/Bravos-hub/CoderER?token=secret',
      'https://github.com/Bravos-hub/CoderER/issues',
    ]) {
      expect(() => AdmitRepositorySchema.parse({ repositoryUrl })).toThrow();
    }
  });

  it('rejects unsafe Git references', () => {
    for (const baseBranch of ['../main', '-dangerous', 'main@{1}', 'feature\\escape']) {
      expect(() =>
        AdmitRepositorySchema.parse({
          repositoryUrl: 'https://github.com/Bravos-hub/CoderER',
          baseBranch,
        }),
      ).toThrow();
    }
  });

  it('validates a queued repository intake job', () => {
    const value = RepositoryIntakeJobSchema.parse({
      intakeId: 'd9428888-122b-11e1-b85c-61cd3cbb3210',
      repositoryUrl: 'https://github.com/Bravos-hub/CoderER',
      organizationId: '00000000-0000-4000-8000-000000000001',
      requestedBy: 'user:delta',
      requestId: 'req_01J2CODEERSPRINT3',
      requestedAt: '2026-07-12T00:00:00.000Z',
    });
    expect(value.intakeId).toBe('d9428888-122b-11e1-b85c-61cd3cbb3210');
  });
});
