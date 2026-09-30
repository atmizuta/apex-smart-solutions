import { SignJWT, jwtVerify } from "jose";

const SESSION_COOKIE = "crm_fibra_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 8; // 8 hours

function getSecretKey(): Uint8Array {
  const secret = process.env.CRM_FIBRA_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "CRM_FIBRA_SESSION_SECRET must be set and at least 32 characters long"
    );
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  consultorId: string;
  papel: "admin" | "consultor";
}

export async function createSessionToken(
  payload: SessionPayload
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (
      typeof payload.consultorId !== "string" ||
      (payload.papel !== "admin" && payload.papel !== "consultor")
    ) {
      return null;
    }
    return {
      consultorId: payload.consultorId,
      papel: payload.papel,
    };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
export const SESSION_MAX_AGE = SESSION_DURATION_SECONDS;
