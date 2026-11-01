-- ZLink D1 Initial Migration
CREATE TABLE IF NOT EXISTS `users` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `username` text NOT NULL,
  `email` text NOT NULL DEFAULT '',
  `password` text NOT NULL,
  `is_staff` integer NOT NULL DEFAULT 0,
  `is_superuser` integer NOT NULL DEFAULT 0,
  `is_active` integer NOT NULL DEFAULT 1,
  `date_joined` text NOT NULL,
  `last_login` text
);
CREATE UNIQUE INDEX IF NOT EXISTS `users_username_unique` ON `users` (`username`);
CREATE INDEX IF NOT EXISTS `users_email_idx` ON `users` (`email`);

CREATE TABLE IF NOT EXISTS `profiles` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL UNIQUE REFERENCES `users`(`id`) ON DELETE CASCADE,
  `avatar_url` text,
  `password_login_disabled` integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS `profiles_user_id_unique` ON `profiles` (`user_id`);

CREATE TABLE IF NOT EXISTS `links` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `original_url` text NOT NULL,
  `short_code` text NOT NULL,
  `created_at` text NOT NULL,
  `expires_at` text
);
CREATE UNIQUE INDEX IF NOT EXISTS `links_short_code_unique` ON `links` (`short_code`);
CREATE INDEX IF NOT EXISTS `links_expires_at_idx` ON `links` (`expires_at`);
CREATE INDEX IF NOT EXISTS `links_created_at_idx` ON `links` (`created_at`);

CREATE TABLE IF NOT EXISTS `api_keys` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `prefix` text NOT NULL,
  `key_hash` text NOT NULL,
  `created_by_id` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` text NOT NULL,
  `expires_at` text,
  `last_used_at` text,
  `is_active` integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);
CREATE INDEX IF NOT EXISTS `api_keys_prefix_idx` ON `api_keys` (`prefix`);
CREATE INDEX IF NOT EXISTS `api_keys_created_by_id_idx` ON `api_keys` (`created_by_id`);

CREATE TABLE IF NOT EXISTS `passkeys` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `name` text NOT NULL DEFAULT '',
  `credential_id` text NOT NULL,
  `public_key` text NOT NULL,
  `sign_count` integer NOT NULL DEFAULT 0,
  `transports` text NOT NULL DEFAULT '[]',
  `aaguid` text NOT NULL DEFAULT '',
  `created_at` text NOT NULL,
  `last_used_at` text
);
CREATE UNIQUE INDEX IF NOT EXISTS `passkeys_credential_id_unique` ON `passkeys` (`credential_id`);
CREATE INDEX IF NOT EXISTS `passkeys_user_id_idx` ON `passkeys` (`user_id`);

CREATE TABLE IF NOT EXISTS `refresh_tokens` (
  `id` text PRIMARY KEY NOT NULL,
  `jti` text NOT NULL,
  `user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `family_id` text NOT NULL,
  `is_revoked` integer NOT NULL DEFAULT 0,
  `expires_at` text NOT NULL,
  `created_at` text NOT NULL,
  `rotated_at` text,
  `rotated_tokens` text
);
CREATE UNIQUE INDEX IF NOT EXISTS `refresh_tokens_jti_unique` ON `refresh_tokens` (`jti`);
CREATE INDEX IF NOT EXISTS `refresh_tokens_user_id_idx` ON `refresh_tokens` (`user_id`);
CREATE INDEX IF NOT EXISTS `refresh_tokens_family_id_idx` ON `refresh_tokens` (`family_id`);
