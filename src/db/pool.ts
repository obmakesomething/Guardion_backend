import pg from 'pg';
import { config } from '../config/index.js';

const { Pool } = pg;

// Lazy database connection - only connect when DATABASE_URL is configured
let pool: pg.Pool | null = null;
let poolInitialized = false;

function getPool(): pg.Pool | null {
  if (!poolInitialized) {
    poolInitialized = true;
    if (config.databaseUrl) {
      pool = new Pool({
        connectionString: config.databaseUrl,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });

      pool.on('error', (err) => {
        console.error('Unexpected error on idle client', err);
      });

      console.log('[DB] PostgreSQL pool initialized');
    } else {
      console.log('[DB] DATABASE_URL not configured, running without database');
    }
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const p = getPool();
  if (!p) {
    throw new Error('Database not configured');
  }

  const start = Date.now();
  const result = await p.query<T>(text, params);
  const duration = Date.now() - start;

  if (config.nodeEnv === 'development') {
    console.log('Executed query', { text: text.substring(0, 100), duration, rows: result.rowCount });
  }

  return result;
}

export async function getClient() {
  const p = getPool();
  if (!p) {
    throw new Error('Database not configured');
  }
  const client = await p.connect();
  return client;
}

export async function withTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const p = getPool();
  if (!p) {
    throw new Error('Database not configured');
  }

  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function healthCheck(): Promise<boolean> {
  const p = getPool();
  if (!p) {
    // No database configured - still healthy for MCP-only mode
    return true;
  }
  try {
    await p.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export function isDatabaseConfigured(): boolean {
  return !!config.databaseUrl;
}
