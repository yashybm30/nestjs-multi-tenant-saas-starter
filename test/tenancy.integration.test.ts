import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import "reflect-metadata";
import { it, expect } from "vitest";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import request from "supertest";
const { AppModule } = require("../dist/app");
const { Database } = require("../dist/database");
const { configure } = require("../dist/platform");
it("isolates tenants at API and database levels and enforces RBAC", async () => {
  process.env.JWT_SECRET = "integration-secret-".repeat(5);
  const app = await NestFactory.create(AppModule, { logger: false });
  configure(app);
  await app.init();
  try {
    const api = request(app.getHttpServer());
    const register = () =>
      api
        .post("/v1/auth/register")
        .send({
          email: `${randomUUID()}@example.test`,
          password: "secure-password-123",
          tenantName: "Isolation test",
        })
        .expect(201);
    const a = await register(),
      b = await register();
    const headersA = { Authorization: `Bearer ${a.body.accessToken}` },
      headersB = { Authorization: `Bearer ${b.body.accessToken}` };
    const me = await api.get("/v1/auth/me").set(headersA).expect(200),
      meB = await api.get("/v1/auth/me").set(headersB).expect(200);
    const p = await api
      .post("/v1/projects")
      .set(headersA)
      .send({ name: "Tenant A private" })
      .expect(201);
    await api.get(`/v1/projects/${p.body.id}`).set(headersB).expect(404);
    await api.delete(`/v1/projects/${p.body.id}`).set(headersB).expect(404);
    expect(
      (await api.get("/v1/projects").set(headersB).expect(200)).body.items,
    ).toHaveLength(0);
    const db = app.get(Database);
    expect(
      await db.withTenant(meB.body.tenantId, (tx) =>
        tx.project.findMany({ where: { id: p.body.id } }),
      ),
    ).toHaveLength(0);
    await expect(
      db.withTenant(meB.body.tenantId, (tx) =>
        tx.project.create({
          data: { name: "Attack", tenantId: me.body.tenantId },
        }),
      ),
    ).rejects.toThrow();
    expect(await db.project.findMany()).toHaveLength(0);
    await db.user.update({
      where: { id: me.body.id },
      data: { role: "member" },
    });
    await api
      .post("/v1/projects")
      .set(headersA)
      .send({ name: "Stale admin token" })
      .expect(401);
    const owner = await db.user.findUniqueOrThrow({
      where: { id: me.body.id },
    });
    const login = await api
      .post("/v1/auth/login")
      .send({ email: owner.email, password: "secure-password-123" })
      .expect(201);
    const member = login.body.accessToken;
    await api
      .post("/v1/projects")
      .set("Authorization", `Bearer ${member}`)
      .send({ name: "Denied" })
      .expect(403);
  } finally {
    await app.close();
  }
});
