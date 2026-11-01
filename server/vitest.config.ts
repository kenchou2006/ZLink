import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, 'src/db/migrations'));
      return {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          assets: {
            directory: path.join(import.meta.dirname, 'test/fixtures/assets'),
            binding: 'ASSETS',
          },
          bindings: {
            TEST_MIGRATIONS: migrations,
            ENVIRONMENT: 'test',
            SECRET_KEY: 'test-secret-key-not-for-production-000000001',
            ALLOWED_ORIGINS: 'http://localhost:4200,http://127.0.0.1:4200',
            WEBAUTHN_RP_ID: 'localhost',
            WEBAUTHN_RP_NAME: 'ZLink',
          },
        },
      };
    }),
  ],
  test: {
    include: ['test/**/*.spec.ts'],
    setupFiles: ['./test/apply-migrations.ts'],
    fileParallelism: false,
  },
});
