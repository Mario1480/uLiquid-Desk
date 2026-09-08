# Beta Turnstile runtime configuration

Mario authorized production API configuration and an API-only restart, without public beta activation.

- Existing production revision: `36936c8d`; no source deployment, commit or push performed.
- Configured the production Turnstile widget keys, allowed hostname `desk.uliquid.vip` and web origin `https://desk.uliquid.vip` in the ignored API environment file. No credentials are recorded here.
- Preserved the previous environment in a root-only backup outside the repository. Privacy approval remained false; beta intake remained unavailable.
- Prisma reported 115 migrations and an up-to-date schema before restart.
- Recreated only API using `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-deps --no-build api`.
- API container changed from `baabf1b4eb28` to `8222a1852fce`; web, runner, PostgreSQL, Redis, Python strategy service and proxy container IDs were unchanged.
- A brief HTTP 502 occurred during startup. Subsequent public health returned `{"ok":true}`; beta configuration returned `enabled: false` with the configured public site key. Runtime checks confirmed both keys present without exposing the secret.
- No real beta email, application, account or end-to-end Turnstile challenge was submitted. Privacy review and explicit public activation remain required.
