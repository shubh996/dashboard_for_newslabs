import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
dotenv.config({ path: path.join(root, '.env.local') });

const password = process.env.SUPABASE_DB_PASSWORD;
const url = process.env.SUPABASE_URL || '';
const project = (url.match(/https?:\/\/([^.]+)/) || [])[1];
if (!password || !project) {
  console.error('Missing SUPABASE_DB_PASSWORD or SUPABASE_URL');
  process.exit(1);
}

const sqlPath = path.join(root, 'supabase/schema_momentum_mobile_detail.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const encoded = encodeURIComponent(password);
const candidates = [
  // Direct
  `postgresql://postgres:${encoded}@db.${project}.supabase.co:5432/postgres`,
  // Pooler session (common regions)
  `postgresql://postgres.${project}:${encoded}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${project}:${encoded}@aws-0-us-west-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${project}:${encoded}@aws-0-us-east-2.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${project}:${encoded}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${project}:${encoded}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${project}:${encoded}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${project}:${encoded}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`,
  // Transaction mode
  `postgresql://postgres.${project}:${encoded}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres.${project}:${encoded}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`,
];

async function tryConnect(connStr) {
  const client = new pg.Client({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  return client;
}

let client = null;
let used = null;
for (const c of candidates) {
  const host = c.replace(/:[^:@]+@/, ':***@').split('@')[1]?.split('/')[0];
  process.stdout.write(`Trying ${host}... `);
  try {
    client = await tryConnect(c);
    used = host;
    console.log('OK');
    break;
  } catch (e) {
    console.log('fail:', e.code || e.message?.slice(0, 80));
  }
}

if (!client) {
  console.error('Could not connect to any host');
  process.exit(1);
}

console.log('Connected via', used);
console.log('Running schema_momentum_mobile_detail.sql...');
try {
  await client.query(sql);
  console.log('SQL applied successfully.');

  const { rows } = await client.query(`
    select table_name, column_name, data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('momentum_episodes', 'momentum_episode_events')
      and column_name in (
        'last_notification_title','last_notification_body','last_notification_at',
        'giveback_ratio','giveback_pct',
        'notification_title','notification_body','notified_at','should_notify','measure'
      )
    order by table_name, column_name
  `);
  console.log('Verified columns:');
  for (const r of rows) {
    console.log(`  ${r.table_name}.${r.column_name} (${r.data_type})`);
  }
  console.log(`Total: ${rows.length} columns`);
} catch (e) {
  console.error('SQL failed:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
