import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  ActorRole,
  ActorType,
  SaveOrganizationSettingSchema,
  type OrganizationSettingKind,
} from '@codeer/contracts';
import {
  closeDatabase,
  OrganizationSettingsStore,
  OrganizationSettingVersionConflictError,
} from '@codeer/database';
import type { CodeerRequestContext } from '../security/request-context.middleware.js';

@Injectable()
export class SettingsService implements OnModuleDestroy {
  private readonly store = new OrganizationSettingsStore();

  async get(context: CodeerRequestContext, kind: OrganizationSettingKind) {
    return this.store.getLatest(context.organizationId, kind);
  }

  async save(context: CodeerRequestContext, kind: OrganizationSettingKind, rawInput: unknown) {
    this.requireAdministrator(context);
    const parsed = SaveOrganizationSettingSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.store.save(context, kind, parsed.data);
    } catch (error) {
      if (error instanceof OrganizationSettingVersionConflictError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await closeDatabase();
  }

  private requireAdministrator(context: CodeerRequestContext): void {
    const administrator = context.actorRoles.some(
      (role) =>
        role === ActorRole.ORGANIZATION_OWNER || role === ActorRole.ORGANIZATION_ADMIN,
    );
    if (context.actorType !== ActorType.USER || !context.trustedContext || !administrator) {
      throw new ForbiddenException(
        'Settings changes require a trusted organization owner or administrator.',
      );
    }
  }
}
