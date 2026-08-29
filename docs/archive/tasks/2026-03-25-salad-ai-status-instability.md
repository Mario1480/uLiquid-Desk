# Task: Salad/Ollama Verbindung instabil - `AI status` im Admin auf Error

## Kontext

Stand vom 25.03.2026:

- Im Salad-Terminal liefert `ollama run qwen3:30b` Antworten.
- In uLiquid Desk unter `/admin/system/integrations/api-keys` bleibt der Bereich `AI Provider (Global)` trotzdem auf `AI status: error`.
- Sichtbare Konfiguration im Admin:
  - Provider: `ollama`
  - Base URL: `http://salad-proxy:8088/v1`
  - Model: `qwen3:30b`
  - Stored key vorhanden

Das deutet darauf hin, dass nicht der Modellprozess selbst ausfaellt, sondern der Backend-Healthcheck zwischen API und Proxy/OpenAI-kompatiblem Endpoint fehlschlaegt.

## Reproduktion

1. In Salad pruefen, dass das Modell lokal reagiert:
   - `ollama run qwen3:30b`
2. In uLiquid Desk als Superadmin `/admin/system/integrations/api-keys` oeffnen.
3. Im Abschnitt `AI Provider (Global)` auf `Refresh status` klicken.
4. Beobachtung:
   - Container bzw. lokales Modell wirken verfuegbar
   - UI zeigt trotzdem `AI status: error`

## Technischer Befund

Der Admin-Status prueft nicht nur, ob der Proxy lebt, sondern fuehrt einen echten Request an den Chat-Endpoint aus:

- Backend-Route: [apps/api/src/admin/routes-api-keys.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/admin/routes-api-keys.ts)
- Healthcheck-Implementierung: [apps/api/src/admin/externalHealth.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/admin/externalHealth.ts)

Wichtig:

- Der Check geht auf `POST {baseUrl}/chat/completions`
- Bei `ollama` ist der Timeout laenger als bei OpenAI
- Ein gruener `/health`-Endpoint reicht nicht aus
- `ollama run ...` im Container beweist nur, dass das Modell lokal geladen ist, nicht dass `http://salad-proxy:8088/v1/chat/completions` aus Sicht des API-Backends funktioniert

## Zusatzbefund aus AI Trace Logs

Im Trace-Log-Screenshot vom 25.03.2026 sind wiederholt fehlgeschlagene Eintraege fuer `Smart Money Concept (1h/5m)` mit `qwen3:30b` zu sehen.

Auffaellig:

- `error - fallback`
- `chars: 0`
- `sentences: 0`
- `paragraphs: 0`
- `tokens: 0`
- `fallbackReason: Error: ollama_chat_completions_http_*`

Der exakte Statuscode wirkt im Screenshot wie `403`; das sollte in der Detailansicht bzw. per API-Antwort noch einmal direkt bestaetigt werden.

Gleichzeitig sind in derselben Liste auch erfolgreiche Eintraege fuer denselben Prompt-/Modellpfad sichtbar.

Das spricht fuer:

- Fehler liegt vor der eigentlichen Inhaltsverarbeitung
- kein JSON-/Schema-/Prompt-Qualitaetsproblem
- kein dauerhaft "Model not found"
- eher ein intermittierender Provider-/Proxy-/Auth-/Upstream-Fehler auf `chat/completions`

## Wahrscheinlichste Ursachen

1. `SALAD_OPENAI_UPSTREAM_HOST` ist veraltet oder falsch gesetzt.
   - Im Repo ist dokumentiert, dass ein veralteter Host typischerweise zu `503` fuehrt.
   - Referenz: [README.md](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/README.md), [docs/PRODUCTION_DEPLOY.md](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/docs/PRODUCTION_DEPLOY.md)

2. Provider-/Proxy-Auth oder Upstream-Authorisierung ist instabil oder falsch.
   - Der Trace deutet auf einen HTTP-Fehler direkt auf `ollama_chat_completions_http_*` hin.
   - Falls der Code tatsaechlich `403` ist, waere das staerker ein Hinweis auf Auth/Forbidden als auf Modell-Warmup.

3. Modellname am OpenAI-kompatiblen Endpoint passt nicht zum lokal funktionierenden Modell.
   - Lokal kann `qwen3:30b` funktionieren, waehrend der Proxy/upstream fuer `chat/completions` das Modell nicht findet oder anders mapped.
   - Der Code behandelt genau diesen Fall mit einer speziellen 404-Fehlermeldung.

4. Der Proxy antwortet auf `/health`, aber nicht stabil auf `/v1/chat/completions`.
   - Damit kann das UI rot sein, obwohl der Container selbst "gesund" wirkt.

5. Konfigurationsmismatch zwischen DB und ENV.
   - Provider, Base URL, Modell oder Key koennen effektiv aus anderer Quelle geladen werden als gedacht.
   - Die Admin-Seite zeigt dafuer bereits `source`/`DB`/`ENV`.

6. Netzwerk-/Namensaufloesungsproblem aus Sicht des API-Containers.
   - Relevant, falls Proxy oder API in unterschiedlichem Runtime-Kontext laufen.

## Konkrete Debug-Schritte

1. Rohantwort des Admin-Healthchecks pruefen:
   - `GET /admin/settings/api-keys/status`
   - Erwartung: exakte Fehlermeldung und ggf. `httpStatus` sichtbar machen

2. Im AI Trace Log einen fehlgeschlagenen Datensatz aufklappen und den exakten `fallbackReason` plus `rawResponse` sichern.
   - Ziel: bestaetigen, ob der Code wirklich `403`, `404`, `429` oder `503` ist.

3. Direkt aus dem API-Container gegen Proxy testen:
   ```sh
   wget -qO- http://salad-proxy:8088/health
   ```

4. Direkt aus dem API-Container einen echten Chat-Request schicken:
   ```sh
   curl -sS http://salad-proxy:8088/v1/chat/completions \
     -H 'Content-Type: application/json' \
     -H 'Authorization: Bearer <AI_API_KEY>' \
     -d '{"model":"qwen3:30b","messages":[{"role":"user","content":"ping"}],"temperature":0,"max_tokens":1}'
   ```

5. `SALAD_OPENAI_UPSTREAM_HOST` im aktiven `.env` / `.env.prod` mit dem aktuellen Salad-Endpoint abgleichen.

6. Im Admin vergleichen:
   - `Current effective provider`
   - `Current effective base URL`
   - `Current effective model`
   - `Source`

7. Falls `/health` gruen und `chat/completions` rot ist:
   - Modell-Mapping
   - Upstream-Host
   - Proxy-Logs
   - Antwortcode 404/503/timeout priorisieren

8. Falls der Trace-Code `403` bestaetigt wird:
   - gespeicherten Key gegen den tatsaechlich aktiven Key pruefen
   - testen, ob DB-Key und ENV-Key abweichen
   - Proxy-/Upstream-Logs auf `forbidden` / `unauthorized` / quota / policy pruefen

## Erwartete Ergebnisse / Akzeptanzkriterien

- `Refresh status` liefert im Admin stabil `AI status: OK`
- `message` im Healthcheck zeigt keine `404`, `503` oder Timeout-Fehler mehr
- `http://salad-proxy:8088/v1/chat/completions` ist aus Sicht des API-Backends erfolgreich
- Konfiguration in Admin und effektive Runtime-Werte stimmen ueberein

## Sinnvolle Anschlussarbeit

- Wenn die Ursache bestaetigt ist, den Healthcheck-Fehlertext im UI noch klarer machen
  - z. B. explizit unterscheiden zwischen:
    - `proxy healthy, chat 404`
    - `upstream host stale / 503`
    - `model not found`
    - `effective config comes from env`
- Optional einen kleinen Ops-Runbook-Abschnitt ergaenzen:
  - "Warum `ollama run` funktionieren kann, waehrend `AI status` rot bleibt"
