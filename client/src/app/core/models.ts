export interface User {
  id: number;
  username: string;
  email: string;
  is_staff: boolean;
  is_superuser: boolean;
  is_active: boolean;
  date_joined: string;
  avatar_url: string | null;
  password_login_disabled: boolean;
}

export interface LoginResponse {
  access: string;
  refresh: string;
  user: User;
}

export interface Link {
  id: number;
  original_url: string;
  short_code: string;
  short_url: string;
  expires_at: string | null;
  is_expired: boolean;
  created_at: string;
}

export interface UserStats {
  total: number;
  active: number;
  superusers: number;
}

export interface CacheKey {
  key: string;
  display_key: string;
  ttl: number;
  type: string;
}

export interface CacheKeysResponse {
  keys: CacheKey[];
  error: string | null;
}

export interface ApiKey {
  id: number;
  name: string;
  prefix: string;
  expires_at: string | null;
  last_used_at: string | null;
  is_active: boolean;
  created_at: string;
}

/** Returned only once, at creation time. */
export interface ApiKeyCreated extends ApiKey {
  key: string;
}

export interface Passkey {
  id: number;
  name: string;
  aaguid: string;
  created_at: string;
  last_used_at: string | null;
}
