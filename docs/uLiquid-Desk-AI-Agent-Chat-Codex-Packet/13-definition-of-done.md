# 13 – Definition of Done und finale Checkliste

## Produkt

- [ ] Agent Chat ist ein eigener Bereich und nicht Teil des Prediction Builders.
- [ ] Market Analyst Profil funktioniert ohne Exchange Account.
- [ ] Position Copilot Profil funktioniert nur mit explizit freigegebenem Konto.
- [ ] Skills und Berechtigungen sind getrennt sichtbar und technisch getrennt.
- [ ] Profile, Venue, Konto, Markt und Symbol sind im Context erkennbar.
- [ ] Agent Activity zeigt verwendete Datenquellen und Status.
- [ ] Conversation History ist persistent und user-isoliert.
- [ ] Deutsch und Englisch vollständig.
- [ ] Desktop und Mobile vollständig nutzbar.

## Architektur

- [ ] keine direkte Binance-Hardcodierung im neuen Agent Chat,
- [ ] uLiquid Skill Registry vorhanden,
- [ ] normalisierte Market Data Provider,
- [ ] Source/Freshness/Degraded in jedem Tool Result,
- [ ] bestehende Exchange Packages wiederverwendet,
- [ ] Position Copilot Deterministik wiederverwendet,
- [ ] kein nested AI Tool,
- [ ] keine neue Execution-Architektur.

## Sicherheit

- [ ] kein Order-/Wallet-/Vault-/Bot-/Copier-/Admin-Tool im MVP,
- [ ] Server Feature Gates,
- [ ] Account Ownership bei jedem privaten Read,
- [ ] keine freien User IDs/Account IDs aus Modellargumenten,
- [ ] Tool Allowlist fail closed,
- [ ] Prompt Injection Tests,
- [ ] Secret Redaction Tests,
- [ ] Tool/Token/Time/Cost Budgets,
- [ ] keine stillen Venue-Fallbacks bei Account Reads,
- [ ] keine Secrets in DB, Logs oder UI.

## Qualität

- [ ] API Typecheck,
- [ ] Web Typecheck,
- [ ] Exchange Package Typechecks,
- [ ] Agent Chat Unit Tests,
- [ ] Provider Contract Tests,
- [ ] API Integration Tests,
- [ ] UI Tests,
- [ ] i18n Check,
- [ ] E2E Smoke,
- [ ] degraded/error States,
- [ ] git diff check/hygiene.

## Regression

- [ ] AI Predictions unverändert funktionsfähig,
- [ ] Prediction Builder unverändert funktionsfähig,
- [ ] Position Copilot im Trading Desk funktionsfähig,
- [ ] Prediction Copier unverändert deterministisch,
- [ ] Manual Trading unverändert,
- [ ] Paper Trading unverändert,
- [ ] Wallet/Payment unverändert,
- [ ] Grid/Vault Scope nicht versehentlich aktiviert.

## Rollout

- [ ] Feature Gate default aus in Production,
- [ ] Internal Allowlist getestet,
- [ ] Kosten-/Rate-Limits gesetzt,
- [ ] Ops Metriken sichtbar,
- [ ] Rollback dokumentiert,
- [ ] Known Issues dokumentiert,
- [ ] separate Freigabe vor Trade Draft Phase.
