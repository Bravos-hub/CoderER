import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ActorRole, ActorType } from '@codeer/contracts';
import { PublicationStatus } from '@codeer/publication';
import type { MergeClosureStore, PublicationStore } from '@codeer/database';
import type { CodeerRequestContext } from '../security/request-context.middleware.js';
import { PublicationsService } from './publications.service.js';

const context: CodeerRequestContext = {
  requestId: 'req-1',
  correlationId: 'corr-1',
  organizationId: '00000000-0000-4000-8000-000000000001',
  actorId: 'judge@codeer.local',
  actorType: ActorType.USER,
  actorRoles: [ActorRole.INCIDENT_COMMANDER],
  trustedContext: true,
};

const publication = {
  id: '00000000-0000-4000-8000-000000290045',
  organizationId: context.organizationId,
  status: PublicationStatus.AWAITING_REVIEW,
  version: 7,
};

function serviceWith(readiness: { ready: boolean; blockers: string[] } | undefined) {
  const store = {
    getPublication: vi.fn().mockResolvedValue(publication),
    transition: vi.fn().mockResolvedValue({ ...publication, status: 'READY_FOR_HUMAN_MERGE' }),
  };
  const closureStore = {
    latestMergeReadiness: vi.fn().mockResolvedValue(readiness),
  };
  const service = new PublicationsService(
    store as unknown as PublicationStore,
    closureStore as unknown as MergeClosureStore,
  );
  return { service, store, closureStore };
}

describe('markReady human-ready gate', () => {
  it('transitions when the latest readiness decision is green', async () => {
    const { service, store } = serviceWith({ ready: true, blockers: [] });
    const result = await service.markReady(context, publication.id, { expectedVersion: 7 });
    expect(result.status).toBe('READY_FOR_HUMAN_MERGE');
    expect(store.transition).toHaveBeenCalledWith(
      context,
      publication.id,
      7,
      PublicationStatus.READY_FOR_HUMAN_MERGE,
    );
  });

  it('refuses when no readiness decision exists', async () => {
    const { service, store } = serviceWith(undefined);
    await expect(
      service.markReady(context, publication.id, { expectedVersion: 7 }),
    ).rejects.toThrow(/No merge readiness decision exists/);
    expect(store.transition).not.toHaveBeenCalled();
  });

  it('refuses to let a human override a red readiness decision', async () => {
    const { service, store } = serviceWith({
      ready: false,
      blockers: ['Required check has not passed: test:evaluation:publication'],
    });
    await expect(
      service.markReady(context, publication.id, { expectedVersion: 7 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.markReady(context, publication.id, { expectedVersion: 7 }),
    ).rejects.toThrow(/not merge-ready/);
    expect(store.transition).not.toHaveBeenCalled();
  });

  it('still refuses non-awaiting states before evaluating readiness', async () => {
    const { service, store, closureStore } = serviceWith({ ready: true, blockers: [] });
    store.getPublication.mockResolvedValue({
      ...publication,
      status: PublicationStatus.CI_MONITORING,
    });
    await expect(
      service.markReady(context, publication.id, { expectedVersion: 7 }),
    ).rejects.toThrow(/awaiting review/);
    expect(closureStore.latestMergeReadiness).not.toHaveBeenCalled();
  });
});
