import { it, expect, beforeAll } from "vitest";
import {
  hashPassword,
  verifyPassword,
  hashToken,
  signAccess,
  verifyAccess,
  config,
} from "../dist/security";
import { randomUUID } from "node:crypto";
beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-".repeat(8);
});
it("salts password hashes and rejects wrong passwords", async () => {
  const a = await hashPassword("correct-password"),
    b = await hashPassword("correct-password");
  expect(a).not.toBe(b);
  expect(await verifyPassword("correct-password", a)).toBe(true);
  expect(await verifyPassword("wrong", a)).toBe(false);
  expect(await verifyPassword("x", "invalid")).toBe(false);
});
it("validates signed issuer, audience and tampering", () => {
  const user = { id: randomUUID(), tenantId: randomUUID(), role: "member" },
    family = randomUUID();
  const token = signAccess(user, family);
  expect(verifyAccess(token).tenantId).toBe(user.tenantId);
  expect(() => verifyAccess(token.slice(0, -8) + "tampered")).toThrow();
  process.env.JWT_AUDIENCE = "wrong";
  expect(() => verifyAccess(token)).toThrow();
  delete process.env.JWT_AUDIENCE;
});
it("rejects short secrets and hashes opaque tokens", () => {
  expect(config.safeParse({ JWT_SECRET: "short" }).success).toBe(false);
  expect(hashToken("secret")).toHaveLength(64);
});
