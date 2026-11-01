/**
 * Offline PostgreSQL to D1 Migration Converter
 *
 * Reads a PostgreSQL SQL dump file (from pg_dump --data-only --inserts)
 * and translates tables and types to D1-compatible SQLite SQL statements.
 *
 * Usage:
 *   node --experimental-strip-types scripts/migrate-postgres-to-d1.ts dump.sql > d1_seed.sql
 */

import { readFileSync } from "node:fs";

const inputFile = process.argv[2];
if (!inputFile) {
  console.error(
    "Usage: node scripts/migrate-postgres-to-d1.ts <postgres-dump.sql>",
  );
  process.exit(1);
}

const content = readFileSync(inputFile, "utf-8");
const lines = content.split("\n");

console.log("-- =================================================");
console.log("-- Converted from PostgreSQL dump for Cloudflare D1");
console.log("-- =================================================\n");

for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("INSERT INTO")) {
    continue;
  }

  // Convert table names
  let converted = trimmed
    .replace(/INSERT INTO "public"\."auth_user"/g, "INSERT INTO users")
    .replace(
      /INSERT INTO "public"\."shortener_profile"/g,
      "INSERT INTO profiles",
    )
    .replace(/INSERT INTO "public"\."shortener_link"/g, "INSERT INTO links")
    .replace(
      /INSERT INTO "public"\."shortener_apikey"/g,
      "INSERT INTO api_keys",
    )
    .replace(
      /INSERT INTO "public"\."shortener_passkey"/g,
      "INSERT INTO passkeys",
    )
    .replace(/INSERT INTO auth_user/g, "INSERT INTO users")
    .replace(/INSERT INTO shortener_profile/g, "INSERT INTO profiles")
    .replace(/INSERT INTO shortener_link/g, "INSERT INTO links")
    .replace(/INSERT INTO shortener_apikey/g, "INSERT INTO api_keys")
    .replace(/INSERT INTO shortener_passkey/g, "INSERT INTO passkeys");

  // Convert boolean literals 'true'/'false' -> 1/0
  converted = converted
    .replace(/,\s*true\s*([,\)])/gi, ", 1$1")
    .replace(/,\s*false\s*([,\)])/gi, ", 0$1")
    .replace(/\(\s*true\s*,/gi, "(1,")
    .replace(/\(\s*false\s*,/gi, "(0,");

  console.log(converted);
}
