import {
  integer,
  sqliteTable,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull(),
    email: text("email").notNull().default(""),
    passwordHash: text("password").notNull(),
    isStaff: integer("is_staff").notNull().default(0),
    isSuperUser: integer("is_superuser").notNull().default(0),
    isActive: integer("is_active").notNull().default(1),
    dateJoined: text("date_joined").notNull(),
    lastLogin: text("last_login"),
  },
  (t) => [
    uniqueIndex("users_username_unique").on(t.username),
    index("users_email_idx").on(t.email),
  ],
);

export const profiles = sqliteTable(
  "profiles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    avatarUrl: text("avatar_url"),
    passwordLoginDisabled: integer("password_login_disabled")
      .notNull()
      .default(0),
  },
  (t) => [uniqueIndex("profiles_user_id_unique").on(t.userId)],
);

export const links = sqliteTable(
  "links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    originalUrl: text("original_url").notNull(),
    shortCode: text("short_code").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at"),
  },
  (t) => [
    uniqueIndex("links_short_code_unique").on(t.shortCode),
    index("links_expires_at_idx").on(t.expiresAt),
    index("links_created_at_idx").on(t.createdAt),
  ],
);

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    createdById: integer("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at"),
    lastUsedAt: text("last_used_at"),
    isActive: integer("is_active").notNull().default(1),
  },
  (t) => [
    uniqueIndex("api_keys_key_hash_unique").on(t.keyHash),
    index("api_keys_prefix_idx").on(t.prefix),
    index("api_keys_created_by_id_idx").on(t.createdById),
  ],
);

export const passkeys = sqliteTable(
  "passkeys",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull().default(""),
    credentialId: text("credential_id").notNull(),
    publicKey: text("public_key").notNull(),
    signCount: integer("sign_count").notNull().default(0),
    transports: text("transports").notNull().default("[]"),
    aaguid: text("aaguid").notNull().default(""),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at"),
  },
  (t) => [
    uniqueIndex("passkeys_credential_id_unique").on(t.credentialId),
    index("passkeys_user_id_idx").on(t.userId),
  ],
);

export const refreshTokens = sqliteTable(
  "refresh_tokens",
  {
    id: text("id").primaryKey(),
    jti: text("jti").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: text("family_id").notNull(),
    isRevoked: integer("is_revoked").notNull().default(0),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    rotatedAt: text("rotated_at"),
    rotatedTokens: text("rotated_tokens"),
  },
  (t) => [
    uniqueIndex("refresh_tokens_jti_unique").on(t.jti),
    index("refresh_tokens_user_id_idx").on(t.userId),
    index("refresh_tokens_family_id_idx").on(t.familyId),
  ],
);

export type User = typeof users.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type Link = typeof links.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Passkey = typeof passkeys.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
