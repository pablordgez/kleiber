import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import bcrypt from "bcryptjs";
import type { RemoteApiCredentials } from "@kleiber/shared";

export const AUTH_TOKEN_TTL_SECONDS = 60 * 60 * 24;

export interface AuthTokenPayload {
  sub: string;
  iat: number;
  exp: number;
}

export interface AuthenticatedPrincipal {
  username: string;
  mode: "basic" | "bearer";
}

export interface IssuedAuthToken {
  token: string;
  expiresAt: string;
}

function encodeBase64Url(value: Buffer | string): string {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Buffer {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function createSignature(input: string, signingKey: Buffer): string {
  return encodeBase64Url(createHmac("sha256", signingKey).update(input).digest());
}

export function createSigningKey(): Buffer {
  return randomBytes(32);
}

export function issueAuthToken(
  username: string,
  signingKey: Buffer,
  now: () => number = () => Date.now(),
): IssuedAuthToken {
  const issuedAtSeconds = Math.floor(now() / 1_000);
  const payload: AuthTokenPayload = {
    sub: username,
    iat: issuedAtSeconds,
    exp: issuedAtSeconds + AUTH_TOKEN_TTL_SECONDS,
  };

  const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = encodeBase64Url(JSON.stringify(payload));
  const signature = createSignature(`${header}.${body}`, signingKey);

  return {
    token: `${header}.${body}.${signature}`,
    expiresAt: new Date(payload.exp * 1_000).toISOString(),
  };
}

export function verifyAuthToken(
  token: string,
  signingKey: Buffer,
  now: () => number = () => Date.now(),
): AuthTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) {
    return null;
  }

  const expectedSignature = createSignature(`${header}.${payload}`, signingKey);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const decodedHeader = JSON.parse(decodeBase64Url(header).toString("utf8")) as {
      alg?: string;
      typ?: string;
    };
    if (decodedHeader.alg !== "HS256" || decodedHeader.typ !== "JWT") {
      return null;
    }

    const decodedPayload = JSON.parse(decodeBase64Url(payload).toString("utf8")) as Partial<AuthTokenPayload>;
    if (
      typeof decodedPayload.sub !== "string" ||
      typeof decodedPayload.iat !== "number" ||
      typeof decodedPayload.exp !== "number"
    ) {
      return null;
    }

    if (decodedPayload.exp <= Math.floor(now() / 1_000)) {
      return null;
    }

    return decodedPayload as AuthTokenPayload;
  } catch {
    return null;
  }
}

export async function verifyPassword(
  credentials: RemoteApiCredentials | null,
  username: string,
  password: string,
): Promise<boolean> {
  if (!credentials || credentials.username !== username) {
    return false;
  }

  try {
    return await bcrypt.compare(password, credentials.passwordHash);
  } catch {
    return false;
  }
}

export function parseBasicAuthHeader(authorizationHeader: string): {
  username: string;
  password: string;
} | null {
  if (!authorizationHeader.toLowerCase().startsWith("basic ")) {
    return null;
  }

  try {
    const rawValue = Buffer.from(authorizationHeader.slice(6).trim(), "base64").toString("utf8");
    const separatorIndex = rawValue.indexOf(":");
    if (separatorIndex === -1) {
      return null;
    }

    return {
      username: rawValue.slice(0, separatorIndex),
      password: rawValue.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}
