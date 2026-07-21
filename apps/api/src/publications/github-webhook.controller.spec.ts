import { createHmac } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GithubWebhookStore } from '@codeer/database';
import { GithubWebhookController } from './github-webhook.controller.js';

const SECRET = 'test-webhook-secret-with-32+-characters';
const DELIVERY_ID = 'delivery-abc-123';

interface MockStore {
  reserveWebhookDelivery: ReturnType<typeof vi.fn>;
  resolveAndAssignTenant: ReturnType<typeof vi.fn>;
  markUnresolvedDeliveryStatus: ReturnType<typeof vi.fn>;
  markWebhookDeliveryStatus: ReturnType<typeof vi.fn>;
  enqueueWebhookProcessMessage: ReturnType<typeof vi.fn>;
}

function mockStore(): MockStore {
  return {
    reserveWebhookDelivery: vi.fn().mockResolvedValue('delivery-row-id'),
    resolveAndAssignTenant: vi.fn().mockResolvedValue({
      organizationId: '00000000-0000-4000-8000-000000000001',
      installationUuid: '00000000-0000-4000-8000-000000290043',
      accountLogin: 'Bravos-hub',
      repositoryId: '00000000-0000-4000-8000-000000290001',
    }),
    markUnresolvedDeliveryStatus: vi.fn().mockResolvedValue(undefined),
    markWebhookDeliveryStatus: vi.fn().mockResolvedValue(undefined),
    enqueueWebhookProcessMessage: vi.fn().mockResolvedValue(undefined),
  };
}

function requestFor(payload: unknown, signatureSecret = SECRET) {
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = `sha256=${createHmac('sha256', signatureSecret).update(rawBody).digest('hex')}`;
  return { rawBody, signature };
}

function call(
  controller: GithubWebhookController,
  args: {
    rawBody?: Buffer;
    signature?: string;
    deliveryId?: string;
    eventName?: string;
  },
) {
  return controller.receive(
    { rawBody: args.rawBody } as Request & { rawBody?: Buffer },
    args.signature,
    args.deliveryId,
    args.eventName,
  );
}

const checkRunPayload = {
  action: 'completed',
  installation: { id: 290043 },
  repository: { id: 987654321 },
  check_run: {
    id: 555,
    name: 'test:evaluation:publication',
    status: 'completed',
    conclusion: 'success',
    head_sha: 'b'.repeat(40),
  },
};

describe('GithubWebhookController', () => {
  let store: MockStore;
  let controller: GithubWebhookController;

  beforeEach(() => {
    store = mockStore();
    controller = new GithubWebhookController(store as unknown as GithubWebhookStore);
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects when the webhook secret is not configured', async () => {
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', '');
    await expect(call(controller, {})).rejects.toThrow(BadRequestException);
  });

  it('rejects when the raw body is unavailable', async () => {
    await expect(
      call(controller, { deliveryId: DELIVERY_ID, eventName: 'check_run' }),
    ).rejects.toThrow('Raw webhook body is unavailable.');
  });

  it('rejects missing or malformed delivery ids', async () => {
    const { rawBody, signature } = requestFor(checkRunPayload);
    await expect(
      call(controller, { rawBody, signature, deliveryId: '!!', eventName: 'check_run' }),
    ).rejects.toThrow(BadRequestException);
    await expect(call(controller, { rawBody, signature, eventName: 'check_run' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects an invalid signature', async () => {
    const rawBody = Buffer.from(JSON.stringify(checkRunPayload), 'utf8');
    await expect(
      call(controller, {
        rawBody,
        signature: 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
        deliveryId: DELIVERY_ID,
        eventName: 'check_run',
      }),
    ).rejects.toThrow('GitHub webhook signature is invalid.');
    expect(store.reserveWebhookDelivery).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON after signature verification', async () => {
    const rawBody = Buffer.from('not-json', 'utf8');
    const signature = `sha256=${createHmac('sha256', SECRET).update(rawBody).digest('hex')}`;
    await expect(
      call(controller, { rawBody, signature, deliveryId: DELIVERY_ID, eventName: 'check_run' }),
    ).rejects.toThrow('GitHub webhook payload is not valid JSON.');
  });

  it('returns duplicate when the delivery was already reserved', async () => {
    store.reserveWebhookDelivery.mockResolvedValue(undefined);
    const { rawBody, signature } = requestFor(checkRunPayload);
    const response = await call(controller, {
      rawBody,
      signature,
      deliveryId: DELIVERY_ID,
      eventName: 'check_run',
    });
    expect(response).toEqual({ accepted: true, duplicate: true, deliveryId: DELIVERY_ID });
    expect(store.resolveAndAssignTenant).not.toHaveBeenCalled();
    expect(store.enqueueWebhookProcessMessage).not.toHaveBeenCalled();
  });

  it('rejects deliveries without an installation context', async () => {
    const { rawBody, signature } = requestFor({ action: 'completed' });
    await expect(
      call(controller, { rawBody, signature, deliveryId: DELIVERY_ID, eventName: 'check_run' }),
    ).rejects.toThrow(BadRequestException);
    expect(store.markUnresolvedDeliveryStatus).toHaveBeenCalledWith(
      DELIVERY_ID,
      'REJECTED',
      'NO_INSTALLATION',
    );
  });

  it('rejects unknown installations', async () => {
    store.resolveAndAssignTenant.mockResolvedValue(undefined);
    const { rawBody, signature } = requestFor(checkRunPayload);
    await expect(
      call(controller, { rawBody, signature, deliveryId: DELIVERY_ID, eventName: 'check_run' }),
    ).rejects.toThrow(NotFoundException);
    expect(store.markUnresolvedDeliveryStatus).toHaveBeenCalledWith(
      DELIVERY_ID,
      'REJECTED',
      'UNKNOWN_INSTALLATION',
    );
  });

  it('ignores unsupported events after durable reservation', async () => {
    const { rawBody, signature } = requestFor({ ...checkRunPayload, action: 'created' });
    const response = await call(controller, {
      rawBody,
      signature,
      deliveryId: DELIVERY_ID,
      eventName: 'push',
    });
    expect(response).toEqual({
      accepted: true,
      duplicate: false,
      ignored: true,
      deliveryId: DELIVERY_ID,
    });
    expect(store.markWebhookDeliveryStatus).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      DELIVERY_ID,
      'IGNORED',
      'UNSUPPORTED_EVENT',
    );
    expect(store.enqueueWebhookProcessMessage).not.toHaveBeenCalled();
  });

  it('enqueues normalized work for a signed check_run delivery', async () => {
    const { rawBody, signature } = requestFor(checkRunPayload);
    const response = await call(controller, {
      rawBody,
      signature,
      deliveryId: DELIVERY_ID,
      eventName: 'check_run',
    });
    expect(response).toEqual({ accepted: true, duplicate: false, deliveryId: DELIVERY_ID });
    expect(store.enqueueWebhookProcessMessage).toHaveBeenCalledTimes(1);
    const enqueued = store.enqueueWebhookProcessMessage.mock.calls[0]?.[0] as {
      organizationId: string;
      eventName: string;
      normalized: Record<string, unknown>;
    };
    expect(enqueued.organizationId).toBe('00000000-0000-4000-8000-000000000001');
    expect(enqueued.eventName).toBe('check_run');
    expect(enqueued.normalized.externalId).toBe('555');
    expect(enqueued.normalized.repositoryId).toBe('00000000-0000-4000-8000-000000290001');
    expect(JSON.stringify(enqueued)).not.toContain(SECRET);
  });
});
