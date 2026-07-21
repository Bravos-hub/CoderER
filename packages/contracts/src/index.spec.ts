import { describe, expect, it } from 'vitest';
import {
  AdmitRepositorySchema,
  CreateIncidentSchema,
  IncidentSeverity,
  IncidentSource,
  PUBLICATION_EXECUTION_JOB,
  PUBLICATION_EXECUTION_QUEUE,
  PUBLICATION_OUTBOX_TOPIC,
  PublicationExecutionJobSchema,
  PublicationExecutionResultSchema,
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

  it('validates the publication execution outbox payload shape', () => {
    const value = PublicationExecutionJobSchema.parse({
      publicationId: '11111111-1111-4111-8111-111111111111',
      organizationId: '33333333-3333-4333-8333-333333333333',
      repositoryId: '44444444-4444-4444-8444-444444444444',
      attempt: 1,
      correlationId: 'req_01J2CODEERSPRINT7',
    });
    expect(value.publicationId).toBe('11111111-1111-4111-8111-111111111111');
    expect(PUBLICATION_OUTBOX_TOPIC).toBe('publication.execute.v1');
    expect(PUBLICATION_EXECUTION_QUEUE).toBe('codeer-publication-execution');
    expect(PUBLICATION_EXECUTION_JOB).toBe('publication.execute');
  });

  it('rejects publication jobs without a correlation id and strips credential fields', () => {
    expect(() =>
      PublicationExecutionJobSchema.parse({
        publicationId: '11111111-1111-4111-8111-111111111111',
        organizationId: '33333333-3333-4333-8333-333333333333',
        repositoryId: '44444444-4444-4444-8444-444444444444',
        attempt: 1,
      }),
    ).toThrow();
    const parsed = PublicationExecutionJobSchema.parse({
      publicationId: '11111111-1111-4111-8111-111111111111',
      organizationId: '33333333-3333-4333-8333-333333333333',
      repositoryId: '44444444-4444-4444-8444-444444444444',
      attempt: 1,
      correlationId: 'req_01',
      token: 'ghs_must_not_be_here',
    });
    expect('token' in parsed).toBe(false);
  });

  it('validates a publication execution result', () => {
    const value = PublicationExecutionResultSchema.parse({
      publicationId: '11111111-1111-4111-8111-111111111111',
      organizationId: '33333333-3333-4333-8333-333333333333',
      status: 'CI_MONITORING',
      baseBranch: 'main',
      headBranch: 'codeer/recovery/fix-v1',
      baseCommitSha: 'a'.repeat(40),
      treeSha: 'b'.repeat(40),
      commitSha: 'c'.repeat(40),
      pullRequestNumber: 42,
      pullRequestUrl: 'https://github.com/Bravos-hub/CoderER/pull/42',
      branchReused: false,
      pullRequestReused: true,
      completedAt: '2026-07-20T00:00:00.000Z',
    });
    expect(value.pullRequestNumber).toBe(42);
  });
});
