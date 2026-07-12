import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Job, Queue, type JobsOptions } from 'bullmq';
import { loadApiConfig } from '@codeer/config';
import {
  AdmitRepositorySchema,
  REPOSITORY_INTAKE_JOB,
  RepositoryPermission,
  REPOSITORY_INTAKE_QUEUE,
  RepositoryIntakeJobSchema,
  RepositoryIntakeResultSchema,
  RepositoryIntakeStatus,
  RepositoryIntakeViewSchema,
  type RepositoryIntakeJob,
  type RepositoryIntakeView,
} from '@codeer/contracts';
import type { StoreActorContext } from '@codeer/database';
import { logger } from '@codeer/logger';
import { AuthorizationError, assertRepositoryPermission } from '@codeer/security';

function connectionFromRedisUrl(redisUrlValue: string) {
  const redisUrl = new URL(redisUrlValue);
  return {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    username: redisUrl.username || undefined,
    password: redisUrl.password || undefined,
    tls: redisUrl.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

@Injectable()
export class RepositoriesService implements OnModuleDestroy {
  private readonly queue: Queue<RepositoryIntakeJob>;

  constructor() {
    const config = loadApiConfig(process.env);
    this.queue = new Queue<RepositoryIntakeJob>(REPOSITORY_INTAKE_QUEUE, {
      connection: connectionFromRedisUrl(config.REDIS_URL),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { age: 86_400, count: 500 },
        removeOnFail: { age: 604_800, count: 500 },
      },
    });
  }

  async admit(context: StoreActorContext, rawInput: unknown): Promise<RepositoryIntakeView> {
    this.authorize(context, RepositoryPermission.ADMIT);
    const parsed = AdmitRepositorySchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    const intakeId = randomUUID();
    const payload = RepositoryIntakeJobSchema.parse({
      ...parsed.data,
      intakeId,
      organizationId: context.organizationId,
      requestedBy: context.actorId,
      requestId: context.requestId,
      requestedAt: new Date().toISOString(),
    });
    const options: JobsOptions = { jobId: intakeId };
    await this.queue.add(REPOSITORY_INTAKE_JOB, payload, options);

    return RepositoryIntakeViewSchema.parse({
      intakeId,
      status: RepositoryIntakeStatus.QUEUED,
      progress: 0,
    });
  }

  async get(context: StoreActorContext, intakeId: string): Promise<RepositoryIntakeView> {
    this.authorize(context, RepositoryPermission.READ);
    const job = await Job.fromId<RepositoryIntakeJob>(this.queue, intakeId);
    if (!job || job.data.organizationId !== context.organizationId)
      throw new NotFoundException(`Repository intake ${intakeId} was not found`);
    return await this.toView(job);
  }

  async list(context: StoreActorContext): Promise<RepositoryIntakeView[]> {
    this.authorize(context, RepositoryPermission.READ);
    const jobs = await this.queue.getJobs(
      ['active', 'waiting', 'delayed', 'completed', 'failed'],
      0,
      49,
      true,
    );
    return await Promise.all(
      jobs
        .filter((job) => job.data.organizationId === context.organizationId)
        .map((job) => this.toView(job)),
    );
  }

  private authorize(context: StoreActorContext, permission: RepositoryPermission): void {
    try {
      assertRepositoryPermission(context.actorRoles, permission);
    } catch (error) {
      if (error instanceof AuthorizationError) {
        logger.warn(
          {
            organizationId: context.organizationId,
            actorId: context.actorId,
            actorType: context.actorType,
            actorRoles: context.actorRoles,
            requestId: context.requestId,
            permission,
            outcome: 'DENIED',
          },
          'Repository authorization denied',
        );
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }

  private async toView(job: Job<RepositoryIntakeJob>): Promise<RepositoryIntakeView> {
    const state = await job.getState();
    const progressData =
      typeof job.progress === 'object' && job.progress !== null ? job.progress : {};
    const progress =
      typeof job.progress === 'number'
        ? job.progress
        : typeof (progressData as Record<string, unknown>).percent === 'number'
          ? ((progressData as Record<string, number>).percent ?? 0)
          : 0;
    const reportedStatus = (progressData as Record<string, unknown>).status;
    let status = RepositoryIntakeStatus.QUEUED;
    if (state === 'failed') status = RepositoryIntakeStatus.FAILED;
    else if (state === 'completed') status = RepositoryIntakeStatus.READY;
    else if (typeof reportedStatus === 'string') {
      status =
        RepositoryIntakeStatus[reportedStatus as keyof typeof RepositoryIntakeStatus] ?? status;
    }

    const result =
      state === 'completed' ? RepositoryIntakeResultSchema.parse(job.returnvalue) : undefined;
    return RepositoryIntakeViewSchema.parse({
      intakeId: job.data.intakeId,
      status,
      progress: Math.round(progress),
      result,
      error:
        state === 'failed'
          ? 'Repository intake failed. Use the intake ID and secure server logs for diagnosis.'
          : undefined,
    });
  }
}
