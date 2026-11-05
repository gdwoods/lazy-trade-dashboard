import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dbPath = process.env.DB_PATH || join(root, 'data/trading/cobra/cobra-trades.db');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.exec(readFileSync(join(root, 'schema.sql'), 'utf8'));
db.close();
console.log(`Initialized ${dbPath}`);
