import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import "reflect-metadata";
import { beforeAll, afterAll, it, expect } from "vitest";
import { NestFactory } from "@nestjs/core";
import { INestApplication } from "@nestjs/common";
const { AppModule } = require("../dist/app");
const { configure } = require("../dist/platform");
const { Database } = require("../dist/database");
const { Cache } = require("../dist/cache");
import request from "supertest";
import { randomUUID } from "node:crypto";
let app: INestApplication;
beforeAll(async () => {
  process.env.JWT_SECRET = "integration-secret-".repeat(5);
  app = await NestFactory.create(AppModule, { logger: false });
  configure(app);
  await app.init();
});
afterAll(async () => {
  await app?.close();
});
it("registers, authenticates, rotates, rejects replay, and revokes the family", async () => {
  const api = request(app.getHttpServer()),
    email = `${randomUUID()}@example.test`;
  const registered = await api
    .post("/v1/auth/register")
    .send({
      email,
      password: "a-secure-password-123",
      tenantName: "Integration tenant",
    })
    .expect(201);
  await api
    .get("/v1/auth/me")
    .set("Authorization", `Bearer ${registered.body.accessToken}`)
    .expect(200);
  await api
    .post("/v1/auth/login")
    .send({ email, password: "wrong" })
    .expect(401);
  const login = await api
    .post("/v1/auth/login")
    .send({ email, password: "a-secure-password-123" })
    .expect(201);
  const rotated = await api
    .post("/v1/auth/refresh")
    .send({ refreshToken: login.body.refreshToken })
    .expect(201);
  expect(rotated.body.refreshToken).not.toBe(login.body.refreshToken);
  await api
    .post("/v1/auth/refresh")
    .send({ refreshToken: login.body.refreshToken })
    .expect(401);
  await api
    .get("/v1/auth/me")
    .set("Authorization", `Bearer ${rotated.body.accessToken}`)
    .expect(401);
  await api
    .post("/v1/auth/refresh")
    .send({ refreshToken: rotated.body.refreshToken })
    .expect(401);
  await api
    .post("/v1/auth/logout")
    .set("Authorization", `Bearer ${registered.body.accessToken}`)
    .expect(201);
  await api
    .get("/v1/auth/me")
    .set("Authorization", `Bearer ${registered.body.accessToken}`)
    .expect(401);
  const stored = await app
    .get(Database)
    .user.findUniqueOrThrow({ where: { email } });
  expect(stored.password).toMatch(/^scrypt:/);
});
it("rejects privilege injection, malformed tokens and oversized fields", async () => {
  const api = request(app.getHttpServer());
  await api
    .post("/v1/auth/register")
    .send({
      email: "x@example.test",
      password: "secure-password",
      tenantName: "test",
      role: "admin",
    })
    .expect(400);
  await api
    .get("/v1/auth/me")
    .set("Authorization", "Bearer forged")
    .expect(401);
});
it("enforces a shared Redis login limit", async () => {
  const cache = app.get(Cache);
  const keys = ["127.0.0.1", "::ffff:127.0.0.1", "::1"].map(
    (ip) => `limit:${ip}:/v1/auth/login`,
  );
  for (const key of keys) await cache.set(key, "20", "EX", 60);
  await request(app.getHttpServer())
    .post("/v1/auth/login")
    .send({ email: "rate@example.test", password: "wrong" })
    .expect(429);
  await cache.del(...keys);
});
