# Project Review Remediation — 2026-07-28

## Scope

Lokale, nicht-produktive Abarbeitung der am 2026-07-28 reproduzierten Review-Punkte. Es wurden keine Deployments, Contract-Transaktionen, Datenbankmigrationen oder Live-Canaries ausgeführt.

## BotVault V3 Retirement

Mario hat bestätigt, dass keine alten BotVault-V3-Vaults mehr offen sind und der V3-Pfad nicht mehr benötigt wird.

- Reguläre Factory-/Treasury-Auflösung berücksichtigt BotVault V3 nicht mehr.
- Die Onchain-Reconciliation schließt Legacy-Vaults jetzt in allen Umgebungen standardmäßig aus; eine explizite Recovery-Option bleibt für historische Diagnose erhalten.
- Der veraltete V3-Exit-Gas-Test wurde aus der Capital-Flow-Regression entfernt und durch bestehende V4-Close-/Exit-Gas-Abdeckung ersetzt.
- Historische interne Namen wie `botVaultV3.service.ts` bleiben vorerst bestehen, weil sie laut `docs/botvault-runtime-naming.md` den heutigen V4-Produktpfad implementieren. Ihre Entfernung ist ein separater Rename-/Datenmodell-Refactor und darf nicht mit dem Entfernen echter V3-Vertragszweige verwechselt werden.

## Reproduzierte Fehler und Korrekturen

| Bereich | Vorher | Korrektur |
| --- | --- | --- |
| Runner-Test | `loopOnce` griff in Unit-Tests auf die lokale Postgres-Konfiguration zu. | Safety-Control-Read ist injizierbar; Unit-Tests verwenden einen deterministischen Stub. |
| Grid-End-Test | Alter Route-Test erwartete einen V3-spezifischen Lifecycle-Service-Stop, obwohl der aktuelle V4-Pfad Grid/Bot atomar stoppt. | Test auf V4-Runtime-Fassade und aktuelle Persistenzsemantik umgestellt. |
| Clean-Checkout-Typecheck | Interne Workspace-Typen wurden aus noch nicht vorhandenen `dist/*.d.ts` gelesen. | Root-Typecheck baut zuerst interne Package-Deklarationen in topologischer Reihenfolge. |
| `any`-Gate | Der Zähler suchte nur nach dem Wort `any` und zählte damit auch Text/Kommentare. | TypeScript-AST zählt nur echte `AnyKeyword`-Knoten; aktuelle Schuld wurde als neue harte Obergrenze festgeschrieben. |
| API-Vault-Suite | Die Suite konnte nach fertigen Assertions wegen offener Handles hängen. | `--test-force-exit` ist für die bekannte isolierte Testsuite gesetzt. |
| Release CI | Capital-relevante API-/Runner-/Web-Suites fehlten. | Auth, AI, Vaults, BotVault V4, Runner, Web-Verhalten und i18n sind in den Release Gates ergänzt. |

## Dependency Security

Direkte beziehungsweise sicher überschreibbare Abhängigkeiten wurden aktualisiert: Axios, Body Parser, Express, Form Data, Hono, Next.js, Nodemailer, PostCSS, qs, Sharp, Valibot, viem und ws. Hyperliquid bleibt auf `0.32.2` fixiert, weil `0.33.x` Node `>=22.12` verlangt, während dieses Projekt verbindlich Node 20 nutzt.

Next wird zusätzlich als gemeinsames Root-Buildtool fixiert. Dadurch werden Next/next-intl sowie viem workspaceübergreifend dedupliziert und die geprüften Transitiv-Overrides greifen auch nach einem frischen `npm ci`.

- `npm audit`: 0 Befunde.
- `npm audit --omit=dev`: 0 Befunde.
- Der Root-Typecheck nach frischem `npm ci` bleibt auf Node 20 grün.

Keine erzwungene Major-Downgrade-Empfehlung aus `npm audit fix --force` wurde übernommen; das Verhalten der direkten Produktpfade bleibt unverändert.

## Lokale Verifikation

Die Node-Prüfungen wurden zusätzlich in einer frischen temporären Arbeitskopie ohne vorhandene `node_modules` oder Package-Buildartefakte ausgeführt.

| Prüfung | Ergebnis |
| --- | --- |
| `npm ci` | Bestanden; 0 bekannte Vulnerabilities. |
| `npm audit` / `npm audit --omit=dev` | Jeweils 0 Befunde. |
| `npm run typecheck` | Bestanden aus dem Clean-Checkout-Zustand. |
| `npm run build` | Bestanden; Next.js 16.2.12 erzeugte 83 Seiten. |
| `npm -w apps/api run test:vaults` | 231/231 Tests bestanden. |
| Capital-Flow-Regression | 8 ausgewählte Tests bestanden, 114 nicht zum Filter gehörende Tests übersprungen. |
| `npm -w apps/runner run test` | 233/233 Tests bestanden. |
| API Hardening/Auth/AI/BotVault V4 | Alle aufgerufenen Suites mit Exit-Code 0 bestanden. |
| Web-Verhalten/i18n, Core/Futures und Prisma-Validierung | Alle aufgerufenen Gates mit Exit-Code 0 bestanden. |
| Python Strategy Service auf Python 3.13 | 78/78 Tests bestanden. Python 3.14 ist wegen der aktuellen `numba`-Unterstützungsgrenze nicht verwendbar. |
| Contracts Build/Test | Build bestanden; 24/24 Foundry-Tests bestanden. Bestehende Forge-Lint-Hinweise bleiben sichtbar. |

Die Verifikation ist lokale Release-Evidence. Sie ersetzt weder Staging-/Production-Smokes noch Onchain-, Alert- oder Langlaufnachweise.

## Noch offen

- V3-Kompatibilitätsnamen und tote V3-Helfer in API/Indexer als eigener, migrationsgestützter Refactor vollständig entfernen.
- `any`-Budgets von den neu festgeschriebenen AST-Baselines schrittweise senken; die Baseline ist kein Qualitätsziel.
- Node-22-Migration separat planen, bevor Hyperliquid 0.33+ übernommen wird; sie ist für den aktuellen Security-Fix nicht erforderlich.
- Production-/Canary-Evidence, Migrationen, Alert-Delivery und 24–48-h-Beobachtung bleiben Go-live-Arbeit und wurden in diesem lokalen Lauf nicht behauptet.
