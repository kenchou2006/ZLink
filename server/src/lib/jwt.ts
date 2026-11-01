import { SignJWT, jwtVerify } from "jose";

export type TokenType = "access" | "refresh" | "passkey_state";

export interface AccessTokenPayload {
  user_id: number;
  auth_time?: number;
}

export interface RefreshTokenPayload {
  user_id: number;
  jti: string;
  family_id: string;
  auth_time?: number;
}

export interface PasskeyStatePayload {
  challenge: string;
  user_id?: number;
}

type PayloadFor<T extends TokenType> = T extends "access"
  ? AccessTokenPayload
  : T extends "refresh"
    ? RefreshTokenPayload
    : PasskeyStatePayload;

export const TOKEN_LIFETIMES: Record<TokenType, string> = {
  access: "15m",
  refresh: "7d",
  passkey_state: "5m",
};

const MIN_SECRET_LENGTH = 32;

export interface SecretSource {
  SECRET_KEY?: string;
}

const derived = new Map<string, Promise<CryptoKey>>();

function key(source: SecretSource, type: TokenType): Promise<CryptoKey> {
  const secret = source.SECRET_KEY;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `SECRET_KEY missing or shorter than ${MIN_SECRET_LENGTH} characters`,
    );
  }
  const cacheKey = `${type}\u0000${secret}`;
  let k = derived.get(cacheKey);
  if (!k) {
    const enc = new TextEncoder();
    k = crypto.subtle
      .importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"])
      .then((master) =>
        crypto.subtle.deriveKey(
          {
            name: "HKDF",
            hash: "SHA-256",
            salt: new Uint8Array(0),
            info: enc.encode(`zlink/jwt/${type}`),
          },
          master,
          { name: "HMAC", hash: "SHA-256", length: 256 },
          false,
          ["sign", "verify"],
        ),
      );
    derived.set(cacheKey, k);
  }
  return k;
}

export async function signToken<T extends TokenType>(
  type: T,
  payload: PayloadFor<T>,
  source: SecretSource,
  expiresIn: string = TOKEN_LIFETIMES[type],
): Promise<string> {
  return new SignJWT({ ...payload, token_type: type })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setJti(
      type === "refresh"
        ? (payload as RefreshTokenPayload).jti
        : crypto.randomUUID(),
    )
    .setExpirationTime(expiresIn)
    .sign(await key(source, type));
}

export class InvalidTokenError extends Error {}

export async function verifyToken<T extends TokenType>(
  type: T,
  token: string,
  source: SecretSource,
): Promise<PayloadFor<T> & { exp: number; iat: number; jti: string }> {
  const k = await key(source, type);
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, k, { algorithms: ["HS256"] }));
  } catch (e) {
    throw new InvalidTokenError(
      e instanceof Error ? e.message : "invalid token",
    );
  }
  if (payload.token_type !== type) {
    throw new InvalidTokenError("wrong token type");
  }
  return payload as unknown as PayloadFor<T> & {
    exp: number;
    iat: number;
    jti: string;
  };
}
