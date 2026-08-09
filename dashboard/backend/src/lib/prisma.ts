import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

// dotenv hier laden damit DATABASE_URL verfügbar ist bevor der Singleton erstellt wird
dotenv.config();

function createPrismaClient() {
  const dbUrl = process.env.DATABASE_URL || 'file:./prisma/data/multibase.db';
  const rawPath = dbUrl.replace(/^file:/, '');
  const backendRoot = path.resolve(__dirname, '../..');
  let dbPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(backendRoot, rawPath);

  // If resolved path does not exist, check fallback paths for multibase.db
  if (!fs.existsSync(dbPath)) {
    const fallback1 = path.resolve(backendRoot, 'prisma', 'data', 'multibase.db');
    const fallback2 = path.resolve(backendRoot, 'data', 'multibase.db');
    if (fs.existsSync(fallback1)) {
      dbPath = fallback1;
    } else if (fs.existsSync(fallback2)) {
      dbPath = fallback2;
    }
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  return new PrismaClient({ adapter } as any);
}

// Singleton für die gesamte Anwendung
const prisma = createPrismaClient();

export { prisma, PrismaClient };
export default prisma;
