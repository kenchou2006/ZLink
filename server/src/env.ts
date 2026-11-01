import type { RateLimiter } from "./durable-objects/RateLimiter";

export interface Env {
  // Bindings
  DB: D1Database;
  KV: KVNamespace;
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  ASSETS: Fetcher;

  // Vars
  ENVIRONMENT: string;
  SITE_ORIGIN?: string;
  ALLOWED_ORIGINS?: string;
  WEBAUTHN_RP_ID?: string;
  WEBAUTHN_RP_NAME?: string;
  WEBAUTHN_ORIGIN?: string;
  WEBAUTHN_ORIGINS?: string;
  GA_MEASUREMENT_ID?: string;
  /** Seconds browsers may cache a redirect; unset or 0 sends no-store. */
  REDIRECT_CACHE_TTL?: string;
  GA_API_SECRET?: string;

  // Secrets
  SECRET_KEY: string;

  // Test mocks
  TEST_MIGRATIONS?: unknown[];
}

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  isStaff: boolean;
  isSuperUser: boolean;
  isActive: boolean;
  avatarUrl: string | null;
  passwordLoginDisabled: boolean;
  dateJoined: string;
}

export interface ApiKeyPayload {
  id: number;
  name: string;
  keyHash: string;
}

export interface Variables {
  user?: AuthUser;
  userId?: number;
  authTime?: number;
  apiKey?: ApiKeyPayload;
  authMethod?: "jwt" | "apikey";
}

export type AppEnv = {
  Bindings: Env;
  Variables: Variables;
};
