# Multi-Tenant SaaS Backend

[![CI](https://github.com/yashybm30/nestjs-multi-tenant-saas-starter/actions/workflows/ci.yml/badge.svg)](https://github.com/yashybm30/nestjs-multi-tenant-saas-starter/actions/workflows/ci.yml)

A tenant-isolated project API that demonstrates authorization in both application code and PostgreSQL.

## Implemented features

- Tenant onboarding and owner registration; login and Google OAuth when configured
- Scrypt passwords, short-lived JWTs, rotating opaque refresh tokens, replay detection and logout
- Member/admin authorization and tenant-scoped project create/list/read/delete
- PostgreSQL forced row-level security for projects and audit records; restricted runtime role
- Transactional audit records, versioned Redis cache and hourly per-tenant audit retention job

## Architecture

```mermaid
flowchart LR
 Client --> Auth[NestJS authentication]
 Auth --> Redis
 Auth --> PostgreSQL
 Client --> Guard[JWT and role guard]
 Guard --> Projects
 Projects --> RLS[PostgreSQL tenant RLS]
 Projects --> Cache[Redis tenant cache]
```

Stack: NestJS, PostgreSQL, Prisma, Redis, Passport.js, Docker.

## Local setup

Requirements: Node.js 24, npm, Docker Engine with Compose v2. The HA cluster experiments additionally require kind, kubectl, metrics-server and k6. Examples use bash; set environment variables with the corresponding syntax in your shell.

```bash
cp .env.example .env
# Edit .env before starting. Use independent random secrets, never example values.
npm ci
npm run check
docker compose --env-file .env up --build -d
```

Run one portfolio stack at a time because development ports overlap. Docker Compose requires the CLI `--env-file` for values interpolated into configuration. For native execution, `npm start` reads `.env` automatically after `npm run build`.

For native development, start dependencies and migrate with the migration role, then use the restricted role from `.env`:

```bash
docker compose --env-file .env up -d postgres redis
DATABASE_URL=postgresql://postgres:local-migration-only@localhost:55432/portfolio npm run db:migrate
npm run build
npm start
```

The inline environment syntax above is for bash; PowerShell uses `$env:DATABASE_URL='...'`. Compose handles migration ordering automatically. Development credentials are confined to localhost; provision separate credentials and secret injection for real hosting. The database init script runs only for a fresh volume. Existing external databases must have a `portfolio_runtime` role before migrations.

## Configuration

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port, default 3000 |
| `REDIS_URL` | Redis connection; localhost for native execution, service hostname in Compose |
| `JWT_SECRET` | Required random signing key, at least 48 characters |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | Optional Google app credentials and registered callback |
| `SESSION_SECRET` | Independent random key of at least 48 characters when OAuth is enabled |
| `DATABASE_URL` | Restricted runtime PostgreSQL connection; separate migration role for schema changes |
| `POSTGRES_PORT` | Optional Compose host PostgreSQL port, default 55432 |
| `JWT_ISSUER`, `JWT_AUDIENCE` | Expected token issuer/audience; defaults `portfolio-auth` / `portfolio-api` |
| `CORS_ORIGIN` | Comma-separated browser-origin allowlist; defaults to none |

## API usage

| Method | Endpoint | Behavior |
|---|---|---|
| POST | `/v1/auth/register` | `{email,password,tenantName}` creates a workspace owner |
| POST | `/v1/auth/login` | `{email,password}` returns access and refresh tokens |
| POST | `/v1/auth/refresh` | `{refreshToken}` rotates the token once |
| POST | `/v1/auth/logout` | Bearer token; revokes its session family |
| GET | `/v1/auth/me` | Bearer token; current identity |
| GET | `/v1/auth/google` | Optional Google login redirect |
| GET | `/health/live`, `/health/ready` | Process and dependency health |
| GET | `/docs` | Swagger UI |

```bash
curl -X POST http://localhost:3000/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.test","password":"a-long-local-password","tenantName":"Demo"}'
curl http://localhost:3000/v1/auth/me -H "Authorization: Bearer $ACCESS_TOKEN"
```

Auth responses use HTTP 201 for successful POST requests, 400 for invalid DTOs, 401 for invalid/revoked sessions, 409 for duplicate accounts, and 429 for throttling. Access JWTs live 900 seconds. A refresh family expires 30 days after initial issue; rotation does not extend it. Never log either token. Google callback returns a no-store JSON token response; production frontends should use a reviewed secure session exchange.

| Method | Endpoint | Authorization |
|---|---|---|
| GET | `/v1/projects?page=1` | Member or admin; own tenant, 20 items/page |
| POST | `/v1/projects` | Admin; `{name}` |
| GET | `/v1/projects/:id` | Own tenant; foreign IDs return 404 |
| DELETE | `/v1/projects/:id` | Admin, own tenant |

Tenant identity comes only from verified JWT claims, and the stored role is checked on every request. No tenant header can override it. Writes and corresponding audit entries share a transaction. Cache keys contain tenant, version and page; writes increment the version and old keys expire after 30 seconds. Background retention removes audit entries older than 90 days in a separate tenant context per workspace.

```mermaid
erDiagram
 Tenant ||--o{ User : owns
 Tenant ||--o{ Project : contains
 Tenant ||--o{ Audit : records
 User ||--o{ RefreshSession : authenticates
```

## Validation

```bash
npm run check              # lint, strict typecheck, unit/API tests, build
npm run test:integration   # real services must be running
npm run test:coverage      # measured report; no unmeasured percentage claims
```

Tests run the compiled application so NestJS decorator metadata matches production. Integration tests create isolated identities; they require disposable databases and must never target production.

Set `DATABASE_URL` to the restricted runtime connection and `REDIS_URL` before integration tests. Migrate first. Test JWT keys are supplied within the suites. Tests exercise rotation, replay, logout, invalid input, rate limits, cross-tenant API access, forbidden writes, and database RLS.

## Deployment

Build the non-root image with `docker build -t nestjs-multi-tenant-saas-starter:local .`. Compose is the supported local deployment. For GCP, publish the image to Artifact Registry and use Cloud Run or GKE with private database connectivity and secret injection; cloud resources and credentials are intentionally not provisioned. Configure TLS, network restrictions, resource budgets and graceful termination for the target environment.

## Security

See [SECURITY.md](SECURITY.md). Never commit `.env`; `.env.example` contains configuration examples only. Dependency scanning runs in CI. Database and Redis development ports bind localhost. No production cloud resources are changed by this project. See the [threat model](docs/threat-model.md) for token replay, RLS trust boundaries and deployment assumptions.

## Trade-offs and known limitations

Identity tables share one schema and rely on application authorization. Only project and audit tables enforce tenant RLS. Registration creates a new workspace; invitations, user management, and billing are not implemented. The hourly retention job may run on every replica; deletion is idempotent but a distributed scheduler would reduce duplicate work. Cache invalidation failures can permit up to 30 seconds of stale reads. Google OAuth requires provider credentials and a real redirect test.

## Roadmap

Add invitations, distributed cron locking, key rotation, password recovery and tenant lifecycle administration.

MIT licensed. See [CONTRIBUTING.md](CONTRIBUTING.md) for the review workflow.
