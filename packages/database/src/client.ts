import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg';

export type TransactionIsolation = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export interface TransactionOptions {
  isolationLevel?: TransactionIsolation | undefined;
  maxRetries?: number | undefined;
  statementTimeoutMs?: number | undefined;
  lockTimeoutMs?: number | undefined;
  tenantOrganizationId?: string | undefined;
  workerBypassRls?: boolean | undefined;
}

export interface DatabaseStatus {
  connected: boolean;
  checkedAt: string;
  latencyMs?: number | undefined;
}

let sharedPool: Pool | undefined;

function defaultDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL is required');
  return value;
}

export function createDatabasePool(
  connectionString = defaultDatabaseUrl(),
  overrides: Partial<PoolConfig> = {},
): Pool {
  return new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    min: Number(process.env.DATABASE_POOL_MIN ?? 0),
    idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 5_000),
    allowExitOnIdle: process.env.NODE_ENV === 'test',
    application_name: process.env.DATABASE_APPLICATION_NAME ?? 'codeer',
    ...overrides,
  });
}

export function databasePool(): Pool {
  sharedPool ??= createDatabasePool();
  return sharedPool;
}

export async function closeDatabase(): Promise<void> {
  if (!sharedPool) return;
  const pool = sharedPool;
  sharedPool = undefined;
  await pool.end();
}

export function isRetryableDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  return code === '40001' || code === '40P01';
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? (value as number) : fallback;
}

export async function withTransaction<T>(
  operation: (client: PoolClient) => Promise<T>,
  options: TransactionOptions = {},
  pool = databasePool(),
): Promise<T> {
  const maxRetries = Math.min(positiveInteger(options.maxRetries, 3), 8);
  const isolationLevel = options.isolationLevel ?? 'READ COMMITTED';
  const statementTimeoutMs = positiveInteger(options.statementTimeoutMs, 15_000);
  const lockTimeoutMs = positiveInteger(options.lockTimeoutMs, 5_000);

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
      await client.query("SELECT set_config('statement_timeout', $1, true)", [
        String(statementTimeoutMs),
      ]);
      await client.query("SELECT set_config('lock_timeout', $1, true)", [String(lockTimeoutMs)]);
      if (options.tenantOrganizationId) {
        await client.query("SELECT set_config('app.current_organization_id', $1, true)", [
          options.tenantOrganizationId,
        ]);
      }
      if (options.workerBypassRls) {
        await client.query("SELECT set_config('app.codeer_worker_bypass', 'true', true)");
      }
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (attempt < maxRetries && isRetryableDatabaseError(error)) continue;
      throw error;
    } finally {
      client.release();
    }
  }

  throw new Error('Database transaction retry budget exhausted');
}

export async function queryOne<T extends QueryResultRow>(
  client: Pick<PoolClient, 'query'>,
  text: string,
  values: readonly unknown[] = [],
): Promise<T | undefined> {
  const result = await client.query<T>(text, [...values]);
  return result.rows[0];
}

export async function queryMany<T extends QueryResultRow>(
  client: Pick<PoolClient, 'query'>,
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await client.query<T>(text, [...values]);
  return result.rows;
}

export async function databaseStatus(pool = databasePool()): Promise<DatabaseStatus> {
  const startedAt = performance.now();
  try {
    await pool.query('SELECT 1');
    return {
      connected: true,
      checkedAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch {
    return { connected: false, checkedAt: new Date().toISOString() };
  }
}
