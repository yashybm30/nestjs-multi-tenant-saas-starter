# Validation record ? 1 November 2026

- `npm run check`: passed (lint, strict TypeScript checking, unit tests, build).
- Real-service integration suite: passed using Docker-hosted dependencies.
- Combined coverage run: 7 tests passed.
- Compiled application coverage: 85.43% lines, 81.86% statements, 60.2% branches, 83.33% functions.
- Coverage excludes process bootstrap, external OAuth wiring, and telemetry initialization. Compiled decorator helpers affect aggregate counts; this is not a claim of equivalent source-level branch coverage.
- Production Docker image: built; container readiness returned HTTP 200.
- Gitleaks: no leaks found across committed history before publication.
- Runtime npm audit: no high or critical findings. The observability stack retains five moderate transitive findings; development toolchains also retain moderate findings.
- No paid cloud deployment was performed.

External acceptance still required: configured Google OAuth redirects where applicable, actual Sentry delivery, visual Grafana/trace-stack review, Kubernetes drain/HPA/ingress experiments for the HA lab, and deployment-specific security review. CI evidence is available on the repository Actions tab; consult the latest commit rather than assuming this local record proves a hosted run.
