import type { Pool } from 'pg';
import {
  OrganizationSettingSchema,
  type OrganizationSetting,
  type OrganizationSettingKind,
  type SaveOrganizationSettingInput,
} from '@codeer/contracts';
import { canonicalJson, digestPayload } from '@codeer/incidents';
import { databasePool, queryOne, withTransaction } from './client.js';
import type { StoreActorContext } from './incident-store.js';

interface SettingRow {
  id: string;
  organizationId: string;
  kind: string;
  version: number;
  enforcement: string;
  description: string;
  configuration: Record<string, unknown>;
  contentHash: string;
  createdBy: string;
  createdAt: Date;
}

function mapSetting(row: SettingRow): OrganizationSetting {
  return OrganizationSettingSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
  });
}

export class OrganizationSettingVersionConflictError extends Error {
  constructor() {
    super('The setting changed since it was read. Refresh and retry the operation.');
    this.name = 'OrganizationSettingVersionConflictError';
  }
}

export class OrganizationSettingsStore {
  constructor(private readonly pool: Pool = databasePool()) {}

  async getLatest(
    organizationId: string,
    kind: OrganizationSettingKind,
  ): Promise<OrganizationSetting | null> {
    return withTransaction(
      async (client) => {
        const row = await queryOne<SettingRow>(
          client,
          `SELECT * FROM "OrganizationSetting"
             WHERE "organizationId"=$1 AND "kind"=$2
             ORDER BY "version" DESC LIMIT 1`,
          [organizationId, kind],
        );
        return row ? mapSetting(row) : null;
      },
      { tenantOrganizationId: organizationId },
      this.pool,
    );
  }

  async save(
    context: StoreActorContext,
    kind: OrganizationSettingKind,
    input: SaveOrganizationSettingInput,
  ): Promise<OrganizationSetting> {
    return withTransaction(
      async (client) => {
        const latest = await queryOne<{ version: number }>(
          client,
          `SELECT "version" FROM "OrganizationSetting"
             WHERE "organizationId"=$1 AND "kind"=$2
             ORDER BY "version" DESC LIMIT 1 FOR UPDATE`,
          [context.organizationId, kind],
        );
        const currentVersion = latest?.version ?? 0;
        if (input.expectedVersion !== currentVersion) {
          throw new OrganizationSettingVersionConflictError();
        }
        const version = currentVersion + 1;
        const value = {
          kind,
          version,
          enforcement: input.enforcement,
          description: input.description,
          configuration: input.configuration,
        };
        const row = await queryOne<SettingRow>(
          client,
          `INSERT INTO "OrganizationSetting" (
             "organizationId","kind","version","enforcement","description","configuration",
             "contentHash","createdBy"
           ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING *`,
          [
            context.organizationId,
            kind,
            version,
            input.enforcement,
            input.description,
            canonicalJson(input.configuration),
            digestPayload(value),
            context.actorId,
          ],
        );
        if (!row) throw new Error('Organization setting was not persisted.');
        return mapSetting(row);
      },
      { tenantOrganizationId: context.organizationId, isolationLevel: 'SERIALIZABLE' },
      this.pool,
    );
  }
}
