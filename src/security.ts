import {
  createHash,
  randomBytes,
  scrypt as derive,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { promisify } from "node:util";
import jwt, { JwtPayload } from "jsonwebtoken";
import { z } from "zod";
const scrypt = promisify(derive);
export const config = z.object({
  JWT_SECRET: z.string().min(48),
  JWT_ISSUER: z.string().default("portfolio-auth"),
  JWT_AUDIENCE: z.string().default("portfolio-api"),
  REDIS_URL: z.string().url(),
  DATABASE_URL: z.string().url(),
});
export type Claims = {
  sub: string;
  tenantId: string;
  role: "admin" | "member";
  familyId: string;
  jti: string;
};
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [kind, salt, hex] = encoded.split(":");
  if (kind !== "scrypt" || !salt || !hex || hex.length !== 128) return false;
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(key, Buffer.from(hex, "hex"));
}
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const refreshToken = () => randomBytes(48).toString("base64url");
export function signAccess(
  user: { id: string; tenantId: string; role: string },
  familyId: string,
) {
  return jwt.sign(
    { tenantId: user.tenantId, role: user.role, familyId },
    process.env.JWT_SECRET!,
    {
      algorithm: "HS256",
      issuer: process.env.JWT_ISSUER ?? "portfolio-auth",
      audience: process.env.JWT_AUDIENCE ?? "portfolio-api",
      subject: user.id,
      jwtid: randomUUID(),
      expiresIn: "15m",
    },
  );
}
export function verifyAccess(token: string): Claims {
  const p = jwt.verify(token, process.env.JWT_SECRET!, {
    algorithms: ["HS256"],
    issuer: process.env.JWT_ISSUER ?? "portfolio-auth",
    audience: process.env.JWT_AUDIENCE ?? "portfolio-api",
  }) as JwtPayload;
  return z
    .object({
      sub: z.string().uuid(),
      tenantId: z.string().uuid(),
      role: z.enum(["admin", "member"]),
      familyId: z.string().uuid(),
      jti: z.string().uuid(),
    })
    .parse(p);
}
