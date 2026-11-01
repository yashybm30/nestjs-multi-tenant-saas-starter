# Threat model

Trust boundaries: public client → API → PostgreSQL / Redis → Google (optional). JWT signing keys and OAuth client secrets are outside source control. HTTPS is required outside localhost.

Passwords use per-password salts and Node scrypt. Access JWTs expire after 15 minutes and validate algorithm, issuer, audience, subject, and structured claims. Refresh secrets have 384 bits of entropy and only SHA-256 digests are persisted. Refresh families have a fixed 30-day expiry; rotation is serialized by a database advisory lock. Reuse revokes the entire family and blacklists access in Redis. Redis failure makes authentication unavailable rather than bypassing checks. Database-backed revocation is also checked on every authorized request, so losing Redis keys does not restore a revoked family. Redis persistence is still recommended for rate-limit durability.

Registration creates a new isolated workspace; it never accepts a caller-supplied role or tenant ID. The first account owns that workspace. There is no public operation for promoting accounts or joining arbitrary tenants. Runtime database roles cannot bypass RLS. Project and audit transactions set a local tenant context and also include explicit tenant filters. The shared identity tables rely on application authorization and are not tenant-RLS protected.

Google authorization uses server-side Redis sessions and provider state validation. Verified email is required and automatic linking to an existing email is prohibited. OAuth callback returns tokens in a no-store JSON response, never a query string. Set secure cookies behind HTTPS; configure Express trust proxy only for explicitly trusted proxies. Login throttling keys use the direct socket IP, so reverse-proxy deployments need a reviewed proxy configuration. OAuth routes are protected by state but still need edge-level abuse limits.

No MFA, password reset, account deletion, email verification workflow, or hosted identity administration is implemented. Database administrators remain a trust boundary. Dependency scans and integration tests are evidence, not a claim of audited production security.
