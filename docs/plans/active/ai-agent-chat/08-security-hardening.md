# Agent 08 – Security Hardening und Threat Model

## Auftrag

Härte den Agent Chat gegen Prompt Injection, Cross-User-Zugriffe, Tool-Missbrauch, Resource Abuse und gefährliche Side Effects.

## Bedrohungen und Kontrollen

### 1. Prompt Injection in User-, News- oder Tool-Text

Kontrollen:

- bestehende `buildAiAgentSystemMessage`-/`wrapUntrustedAiPayload`-Logik erweitern,
- Tool-Ergebnisse als untrusted markieren,
- keine Instruktionen aus News/Calendar/Predictions übernehmen,
- Scope und Skill Allowlist nur serverseitig.

### 2. Modell erfindet Tool oder fordert Execution

Kontrollen:

- Tool Registry Lookup fail closed,
- `AI_FORBIDDEN_EXECUTION_TOOLS` erweitern,
- unbekannte Tool Calls niemals dynamisch mappen,
- Security Event loggen.

### 3. Cross-User Account/Position Access

Kontrollen:

- User aus Session,
- Account aus serverseitigem Conversation Context,
- Ownership vor jedem Skill Call erneut prüfen,
- opaque Position Refs user-/run-gebunden,
- keine freien User IDs im Tool Schema.

### 4. Secret Leakage

Kontrollen:

- Credentials nie an Skill Runtime geben, wenn Public Data genügt,
- private Adapter nur in gekapseltem Service,
- `redactAiSafetySecrets` auf Args, Results, Logs und Errors,
- rohe Provider-Fehler normalisieren,
- kein Debug-Dump in UI.

### 5. Resource/Cost Abuse

Kontrollen:

- per-user und global Rate Limits,
- Tool-Call- und Iterationsbudget,
- Token Budget,
- Timeout/Abort,
- Payload Limits,
- Cache,
- Billing Attribution,
- Concurrent Run Limit pro User.

### 6. Stale oder falsche Daten

Kontrollen:

- observedAt/fetchedAt,
- stale/degraded flag,
- keine Antwort als „live“ markieren, wenn Daten alt sind,
- kontobezogene Daten ohne Venue-Fallback,
- klare Unsicherheit im Prompt/Output.

### 7. Side-Effect Confusion

Kontrollen:

- MVP Skill Descriptors alle `sideEffect: false`,
- keine Adapter-Execution im Runtime Context,
- UI zeigt Read-only Badge,
- keine Action-Buttons, die wie direkte Ausführung wirken.

### 8. Persistierte schädliche Profile

Kontrollen:

- Nutzerprofil darf nur Skills aus serverseitigem Base Profile wählen,
- keine freie System Prompt Eingabe im MVP,
- optionale User Instructions streng begrenzen und als untrusted preferences behandeln,
- Versionssnapshot pro Run.

### 9. Nested Agent Loops

Kontrollen:

- Skills rufen keine weitere AI-Runtime auf,
- Position Risk Skill nur deterministisch,
- AI Summaries aus Market Intelligence nicht rekursiv als Agent starten.

### 10. Spätere Draft Replay Attacks

Kontrollen für Future Phase:

- one-time Draft Token,
- expiry,
- idempotency key,
- aktueller Account-/Market-Recheck,
- Nutzer-Reauth je nach Risiko,
- Draft kann nur über normale Execution API bestätigt werden.

## Security Tests

- Prompt verlangt `place_order` → blockiert,
- News enthält „ignore previous instructions“ → als Daten behandelt,
- manipuliertes Profil mit verbotenem Skill → blockiert,
- fremde Conversation/Account/Position → 404 oder 403 ohne Information Leak,
- Tool Result mit `apiSecret` → redigiert,
- oversized OHLCV/News → begrenzt,
- Endlosschleife → Budget Exceeded,
- stale Daten → sichtbar degraded,
- Position Skill kann Risk Minimum nicht senken.

## Akzeptanzkriterien

- dokumentierte Tool Matrix aktualisiert,
- alle Scopes technisch getrennt,
- keine Side Effects im MVP,
- Security Regression Tests automatisiert,
- Threat Model in `docs/` aktualisiert.
