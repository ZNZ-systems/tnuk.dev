import { Pool, type PoolClient } from "pg";

let pool: Pool | undefined;

function connectionString(): string {
  const url =
    process.env["PRIMARY_DB_DATABASE_URL"] ??
    process.env["DATABASE_URL"] ??
    process.env["POSTGRES_URL"];
  if (!url) {
    throw new Error("Database URL not configured (PRIMARY_DB_DATABASE_URL or DATABASE_URL)");
  }
  return url;
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: connectionString() });
  }
  return pool;
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function ensureSchema(): Promise<void> {
  await withClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_codes (
        poll_token TEXT PRIMARY KEY,
        user_code TEXT NOT NULL UNIQUE,
        device_code TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        cli_token TEXT,
        user_id TEXT,
        email TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS runs (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        repo_hash TEXT
      );
    `);
  });
}
