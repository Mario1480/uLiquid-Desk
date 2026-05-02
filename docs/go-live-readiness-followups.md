# Go-live Readiness Follow-ups

Stand: 2026-05-02

Dieses Dokument fasst den aktuellen Stand nach der Go-live-Security-Haertung zusammen. Es ist als operative Checkliste gedacht: Was ist im Code bereits erledigt, was muss vor dem echten Production-Go-live noch geprueft werden, und welche Verbesserungen koennen nach dem Go-live sinnvoll nachgezogen werden.

## Aktueller Status

Die kritischen Review-Findings aus dem Projekt-Review wurden technisch adressiert:

- Admin-Seeding ist in Production fail-closed:
  - `ADMIN_EMAIL` und `ADMIN_PASSWORD` sind in Production Pflicht.
  - Bekannte Default-/Platzhalter-Passwoerter wie `TempAdmin1234!` und `ChangeMe123!` werden abgelehnt.
  - Der Dev-Fallback bleibt nur ausserhalb von Production moeglich und wird klar geloggt.
- Production-Env-Validation wurde verschaerft:
  - `SECRET_MASTER_KEY`, `POSTGRES_PASSWORD`, Admin-Credentials und Python-Tokens werden geprueft.
  - Platzhalter fuer DB- und Service-Tokens werden in Production blockiert.
- Auth- und OTP-Schutz wurde ergaenzt:
  - Register, Login, Email-Verify, Register-Resend, Password-Reset-Request und Password-Reset-Confirm haben IP- und Account-/Email-basierte Rate-Limits.
  - `ReauthOtp` hat `attemptCount` und `lockedUntil`.
  - Falsche OTPs werden gezaehlt und nach 5 Fehlversuchen bis Ablauf/Resend gesperrt.
- RBAC ist serverseitig angebunden:
  - Die Systemrolle `User` ist auf minimale Rechte reduziert.
  - Neue Workspace-Ersteller bekommen Admin-Rechte fuer ihre eigene Workspace.
  - Die Migration hebt pro bestehender Workspace den ersten bisherigen `User`-Member auf `Admin`, bevor die User-Rolle reduziert wird.
  - Feature-Routen werden ueber Permission-Mapping in `requireAuth` geprueft.
- Webhook-Notifications sind gegen SSRF gehaertet:
  - Gemeinsamer Safe-Outbound-URL-Helper in `@mm/core`.
  - Production verlangt HTTPS, blockiert URL-Credentials, Private/Loopback/Link-Local/Reserved/Metadata-IP-Bereiche und Redirect-Followups.
  - Custom Headers werden normalisiert und sensitive/hop-by-hop Header werden entfernt.
  - API- und Runner-Webhook-Plugin nutzen dieselbe Haertung.
- Production-Compose ist isolierter:
  - Postgres-Passwort und `DATABASE_URL` kommen aus `${POSTGRES_PASSWORD}`.
  - API und Web binden nur an `127.0.0.1`.
  - Python-Strategy-Service wird nicht mehr oeffentlich gepublished, sondern nur Docker-intern exposed.
  - `MANUAL_TRADE_DEBUG` defaultet in Production auf `0`.
- Dependency-/Supply-Chain-Stand ist bereinigt:
  - `npm audit` meldet aktuell `found 0 vulnerabilities`.
  - Next.js, next-intl, Nodemailer, Prisma und Axios wurden aktualisiert.
  - Wallet-Modal wurde von der alten Web3Modal-Integration auf Reown AppKit migriert.
  - `apps/web/.env.local` wurde aus dem Repo entfernt und durch `.env.local.example` ersetzt.
  - `pnpm-workspace.yaml` wurde entfernt, weil das Repo npm Workspaces erzwingt.

## Bereits verifiziert

Lokal wurden folgende Checks erfolgreich ausgefuehrt:

- `npm run typecheck -- --pretty false`
- `npm -w apps/api run test:auth`
- `npm -w apps/api run test:notifications`
- `node ../../node_modules/tsx/dist/cli.mjs --test src/rbac.test.ts`
- `node ../../node_modules/tsx/dist/cli.mjs --test src/outboundSecurity.test.ts`
- `npx prisma validate`
- `npm audit --audit-level=none`
- `docker compose -f docker-compose.prod.yml config`
- `git diff --check`

Hinweis: Der Typecheck laeuft gruene durch. Forge meldet weiterhin bestehende Solidity-Lint-Notes/Warnungen, blockiert den Typecheck aber nicht. Die Notification-Tests loggen ohne lokale Postgres-DB erwartbare Prisma-Warnungen fuer best-effort Audit-Writes; die Tests selbst sind gruen.

## Vor Go-live zwingend offen

Diese Punkte sollten vor dem echten Production-Go-live erledigt oder bewusst abgehakt werden:

- Production-Secrets final setzen:
  - `ADMIN_EMAIL`
  - `ADMIN_PASSWORD`
  - `POSTGRES_PASSWORD`
  - `SECRET_MASTER_KEY`
  - `PY_STRATEGY_AUTH_TOKEN`
  - `PY_GRID_AUTH_TOKEN`
  - `CORS_ORIGINS`
  - `SIWE_ALLOWED_DOMAINS`
  - SMTP-/Telegram-/WalletConnect-/RPC-Secrets je nach aktivem Feature-Set.
- Secret-Rotation planen:
  - Alte Admin-Fallbacks duerfen in keiner `.env.prod` oder VPS-History mehr auftauchen.
  - Bestehende DB-/Service-Tokens sollten vor Go-live einmal rotiert werden.
- Migration auf Staging/Production testen:
  - Backup der Production-DB erstellen.
  - `prisma migrate deploy` gegen Staging ausfuehren.
  - Danach pruefen, dass bestehende Workspace-Creator weiterhin Admin-Rechte haben.
  - Stichprobe: normaler Zusatz-User mit Rolle `User` darf keine Admin-/Trading-/Key-Mutationen ausfuehren.
- Production-Build sauber neu installieren:
  - Frischer `npm ci` oder Docker-Build aus dem neuen Lockfile.
  - Kein altes `node_modules` aus vorherigem Web3Modal-/Prisma-/Axios-Stand weiterverwenden.
- VPS-/Docker-Smoke ausfuehren:
  - `docker compose -f docker-compose.prod.yml config`
  - Container starten.
  - `/health` ueber Caddy oeffentlich erreichbar.
  - API-Port `8080` extern nicht direkt erreichbar.
  - Web-Port `3000` extern nicht direkt erreichbar.
  - Python-Port `9000` extern nicht direkt erreichbar.
  - Postgres und Redis extern nicht erreichbar.
- Auth-Smoke in echter Umgebung:
  - Register + Email-Verify.
  - Register-Resend entsperrt OTP-Versuche.
  - Login.
  - Password-Reset-Request + Confirm.
  - Rate-Limit liefert `429 { error: "rate_limited", retryAfterSec }`.
  - OTP-Lockout bleibt generisch mit `invalid_or_expired_code`.
- RBAC-Smoke in echter Umgebung:
  - Workspace-Admin kann Bots/Grid/Exchange Keys/Risk Settings verwalten.
  - User-Rolle kann nur erlaubte Read-/Preset-Reads.
  - Manuelle Market-Order braucht `trading.manual_market`.
  - Manuelle Limit-Order braucht `trading.manual_limit`.
  - Ownership-Checks greifen weiterhin zusaetzlich.
- Webhook-Smoke:
  - Legitimer HTTPS-Webhook funktioniert.
  - `localhost`, private IPs, Link-Local, Cloud-Metadata-IP und Redirect-Ziele werden blockiert.
  - Verbotene Custom Headers werden nicht weitergereicht.
- Full Regression mit echter Infrastruktur:
  - Bot/Grid/Vault/Runner-Flows gegen DB + Redis.
  - SIWE-Link/Unlink.
  - Wallet-Verbindung mit Reown AppKit.
  - Notification-Dispatch mit realen Destination Settings.
- Go-live-Runbook finalisieren:
  - Rollback-Pfad fuer Migration und Docker-Release.
  - Admin-Zugang und Break-glass-Prozess.
  - Monitoring-Verantwortliche und Alarmwege.
  - Backup-/Restore-Probe mindestens einmal getestet.

## Empfehlung fuer kontrollierten Go-live

Ein kontrollierter Go-live ist vertretbar, wenn die Punkte aus "Vor Go-live zwingend offen" gruen sind. Empfohlen wird kein Big-Bang, sondern ein Canary:

- Zuerst nur Admin-/interne Accounts.
- Kleine Trading-/Vault-Limits.
- Webhook-Notifications mit einem bekannten HTTPS-Testziel.
- Enges Monitoring fuer Auth-429, OTP-Lockouts, RBAC-403, Webhook-Blockierungen, DB/Redis-Health und Runner-Jobs.
- Nach 24 bis 48 Stunden Canary-Auswertung erst breiter freigeben.

## Direkt nach Go-live beobachten

- Anzahl und Quelle von `rate_limited` Antworten.
- OTP-Lockouts pro Email/IP.
- `403 permission_required` nach Route und Rolle.
- Webhook-Fehlergruende, besonders `unsafe_webhook_url:*`.
- Caddy Access Logs fuer direkte Port-/Bypass-Versuche.
- Prisma/DB-Verbindungsfehler.
- Redis-Rate-Limit-Verfuegbarkeit.
- Runner- und Queue-Backlog.
- Wallet-Verbindungsfehler nach Reown-AppKit-Migration.

## Spaeter sinnvoll nachziehen

Diese Punkte sind keine harten Go-live-Blocker, wuerden die Produktreife aber klar erhoehen:

- RBAC-Ausbau:
  - Admin-UI fuer Rollen und Permissions verbessern.
  - Audit-Log fuer Rollen- und Permission-Aenderungen.
  - Integrationstests mit echten Express-Routen und Rollenmatrix.
  - Mehrere Workspaces pro User sauberer priorisieren statt "erste Membership".
- Auth-/Security-Ausbau:
  - Progressive Delays fuer Login/OTP zusaetzlich zu Rate-Limits.
  - Optional MFA fuer Admins.
  - Session-Device-Ansicht und Session-Revocation.
  - Admin-Benachrichtigung bei vielen Lockouts oder verdachtigen Login-Mustern.
- Webhook-Ausbau:
  - Allowlist pro Plan oder Workspace.
  - Signierte Webhook-Test-Events.
  - Webhook-Delivery-History mit Retry-Status in der UI.
  - Optional dedizierter Outbound-Proxy mit Egress-Policy.
- Infra-/Container-Haertung:
  - Runtime-Images mit Production-only Dependencies bauen.
  - Non-root Container-User.
  - Read-only Filesystem dort, wo moeglich.
  - Docker/Caddy Security Headers und CSP finalisieren.
  - Firewall-Regeln als dokumentiertes VPS-Bootstrap-Script.
- Supply Chain:
  - Renovate/Dependabot fuer npm und Docker Images.
  - CI-Gate fuer `npm audit --omit=dev`.
  - Separate CI-Gates fuer Full-Audit und License-Policy.
  - SBOM-Erstellung fuer Releases.
- Observability:
  - Dashboard fuer Auth, RBAC, Webhook, Queue und Runner.
  - Alert-Regeln fuer neue High-Severity-Audit-Findings.
  - Alert-Regeln fuer ungewoehnliche 403/429-Spikes.
  - Strukturierte Security Events fuer Admin-Konsole.
- Testing:
  - E2E-Test fuer Register -> Verify -> Login -> Workspace Admin -> User-Deny.
  - E2E-Test fuer Password Reset mit OTP-Lockout und Resend.
  - E2E-Test fuer Webhook-SSRF-Blockliste.
  - Staging-Smoke als wiederholbares Script.

## Bekannte Einordnung

- Dieses Dokument behandelt die Go-live-Security-Haertung aus dem Projekt-Review.
- BotVault-spezifische Canary-/Lifecycle-Punkte bleiben im separaten Dokument `docs/botvault-go-live-followups.md`.
- Im Arbeitsbaum existieren zusaetzliche Bot/Grid/Python-Aenderungen, die nicht Teil dieser Go-live-Security-Haertung sind und separat eingeordnet werden sollten.

## Entscheidung fuer den naechsten Schritt

Vor dem naechsten groesseren Feature sollte mindestens klar sein:

- Production-Secrets sind final gesetzt und rotiert.
- Migration wurde gegen Staging getestet.
- RBAC-Smoke ist mit Admin und User-Rolle erfolgreich.
- Caddy ist der einzige oeffentliche Einstieg fuer Web/API.
- Audit ist nach frischem Install weiterhin sauber.
- Canary-Limits und Monitoring sind definiert.

Wenn diese Punkte gruen sind, kann der kontrollierte Go-live vorbereitet werden. Breitere Freigabe erst nach Canary-Auswertung.
