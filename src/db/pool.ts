import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config';

// Check if DATABASE_URL is provided
const isDatabaseConfigured = !!config.database.url && config.database.url !== 'postgresql://postgres:postgres@localhost:5432/guardion';

export const pool = isDatabaseConfigured ? new Pool({
  connectionString: config.database.url,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // Increased timeout for cloud DB
}) : null;

if (pool) {
  pool.on('error', (err) => {
    console.error('Unexpected error on idle database client', err);
    // Don't exit - allow graceful recovery
  });
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  if (!pool) {
    throw new Error('Database not configured');
  }
  const start = Date.now();
  const result = await pool.query<T>(text, params);
  const duration = Date.now() - start;
  if (config.env === 'development') {
    console.log('Executed query', { text: text.substring(0, 100), duration, rows: result.rowCount });
  }
  return result;
}

export async function getClient(): Promise<PoolClient> {
  if (!pool) {
    throw new Error('Database not configured');
  }
  return pool.connect();
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function healthCheck(): Promise<boolean> {
  if (!pool) {
    return false;
  }
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export function isDatabaseAvailable(): boolean {
  return !!pool;
}
