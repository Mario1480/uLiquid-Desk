# Arbitrum-USDC-Billing: Architektur und Rollout

## Status und Geltungsbereich

Diese Dokumentation beschreibt die Ablösung des aktiven CCPayment-Flows durch direkte USDC-Zahlungen auf Arbitrum One.

Stand dieser Implementierung:

- Der Code und die Datenbankmigration sind lokal vorbereitet.
- Billing bleibt bis zum kontrollierten Cutover deaktiviert.
- Es wurde kein Deployment und keine Migration gegen eine laufende Umgebung ausgeführt.
- Es wurde keine Mainnet-Transaktion gesendet und keine Treasury-Adresse in Produktion geändert.
- Ein Sepolia-Smoke und ein Low-Value-Mainnet-Canary dürfen nur nach separater, ausdrücklicher Freigabe erfolgen.

## Feste Produktionsparameter

Der Produktionspfad akzeptiert ausschließlich:

| Parameter | Wert |
| --- | --- |
| Netzwerk | Arbitrum One |
| Chain-ID | `42161` |
| Token | natives Circle-USDC |
| USDC-Vertrag | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| Decimals | `6` |
| Bestätigungen | `12` |
| Order-Gültigkeit | `24 Stunden` |
| Karenzzeit | `3 Tage` |

Es gibt keinen eigenen Payment-Contract und keine Token-Freigabe. Die verbundene Wallet führt direkt `USDC.transfer(treasury, amountRaw)` aus. Gas bezahlt der User in ETH.

## Architektur

1. `POST /settings/subscription/checkout` legt eine Order mit einem unveränderlichen Snapshot von Sender-Wallet, Treasury, Treasury-Revision, Chain, Token und Rohbetrag an.
2. Der Browser prüft Wallet, Netzwerk sowie USDC- und ETH-Bestand und sendet den direkten ERC-20-Transfer.
3. `POST /settings/subscription/orders/:id/submit` übermittelt ausschließlich den Tx-Hash. Diese Meldung aktiviert keine Rechte.
4. Das Backend liest Transaktion, Receipt, Logs und aktuelle Blockhöhe über einen serverseitigen RPC.
5. Unterhalb von 12 Bestätigungen bleibt die Order `CONFIRMING`. Erst die vollständige serverseitige Prüfung kann sie als bezahlt abschließen.
6. Aus der bezahlten Order entsteht genau ein `SubscriptionTerm`. Der Lifecycle-Job aktiviert fällige Terms, führt die Karenzzeit und synchronisiert anschließend Abonnement-, Workspace- und Lizenzrechte.
7. Ein Hintergrund-Scanner sucht außerdem USDC-Transfers an Treasury-Snapshots offener Orders. So kann eine Zahlung wiedergefunden werden, wenn der Browser nach dem Senden geschlossen wurde.

Der Reconciler läuft regulär alle 30 Sekunden. Der Subscription-Lifecycle und die Erinnerungen laufen stündlich. Überlappende Läufe werden unterdrückt; Cursor, eindeutige Schlüssel und Wiederholungszustände sichern Idempotenz.

## Sicherheitsinvarianten

Eine Zahlung gilt nur dann als bestätigt, wenn alle folgenden Bedingungen erfüllt sind:

- Der serverseitige RPC meldet Chain-ID `42161`.
- Die Transaktion ist erfolgreich und nicht reverted.
- `transaction.from` entspricht der beim Checkout verknüpften Wallet.
- `transaction.to` ist der feste native USDC-Vertrag.
- Die Transaktion überträgt keinen nativen ETH-Wert.
- Das Receipt enthält genau ein passendes USDC-`Transfer`-Event von der erwarteten Wallet an den Treasury-Snapshot.
- Der Rohbetrag stimmt exakt mit `priceCents × 10.000` überein; es wird kein Floating Point verwendet.
- Der Tx-Hash wurde noch keiner anderen Order zugeordnet.
- Mindestens 12 Bestätigungen liegen vor.

Weitere Schutzregeln:

- Der Client ist nie die Autorität für Zahlungs- oder Entitlement-Status.
- Pro User kann es nur eine offene zahlbare Arbitrum-USDC-Order geben. Ein identischer Warenkorb wird fortgesetzt; ein anderer erfordert Abbruch oder Ablauf der bestehenden Order.
- Treasury-Adresse und Konfigurationsrevision werden pro Order gespeichert. Eine spätere Rotation verändert bestehende Orders nicht.
- RPC-Ausfälle und vorübergehend fehlende Receipts bleiben retryfähig und lösen keine falsche Aktivierung aus.
- Ein dauerhaft nicht auffindbarer, übermittelter Tx-Hash wird erst nach begrenzten Prüfversuchen und nach Order-Ablauf zur manuellen Prüfung eskaliert.
- Revert, falsche Chain, Wallet, Token, Treasury, Unter- oder Überzahlung, mehrdeutige Transfers und Tx-Replay führen zu `REVIEW_REQUIRED`.
- `REVIEW_REQUIRED` wird nicht automatisch erstattet, korrigiert oder ein zweites Mal aktiviert. Ein Operator muss zuerst Onchain-Receipt, Order-Snapshot und Audit-Trail abgleichen.

Die vorgegebenen 12 Bestätigungen beziehen sich auf Arbitrum-L2-Blöcke. Sie sind keine separate Prüfung der Sequencer-Batch-Inklusion oder Ethereum-L1-Finalität. Das ist für Version 1 eine bewusst begrenzte Soft-Finality-Annahme: Bis eine strengere Finalitätsregel ausdrücklich beschlossen und implementiert wurde, bleiben Mainnet-Canary und Hochlauf auf freigegebene Low-Value-Zahlungen begrenzt. Eine bereits als `PAID` aktivierte Order wird nicht nachträglich automatisch zurückgerollt.

## Serverkonfiguration und Readiness

Die API verwendet einen dedizierten serverseitigen RPC:

```dotenv
BILLING_ARBITRUM_RPC_URL=https://<trusted-arbitrum-one-rpc>
```

Wenn `BILLING_ARBITRUM_RPC_URL` nicht gesetzt ist, wird auf `ARBITRUM_RPC_URL` zurückgegriffen; ein explizit leerer Wert hält Billing dagegen absichtlich auf „nicht bereit“. Die Produktionsumgebung muss einen vertrauenswürdigen, rate-limit-tauglichen RPC explizit als `BILLING_ARBITRUM_RPC_URL` setzen. Der öffentliche Browser-RPC ist keine Zahlungsautorität.

Vor der Aktivierung muss die Admin-Billing-Seite Folgendes als bereit anzeigen:

- Treasury-Adresse vorhanden,
- Chain-ID `42161`,
- korrekter USDC-Vertrag und 6 Decimals,
- erfolgreiche RPC-Abfrage auf Arbitrum One,
- aktuelle letzte Blockhöhe und Prüfzeit,
- keine offene RPC-Fehlermeldung.

Die globale Billing-Aktivierung bleibt bis zum Abschluss aller Rollout-Gates ausgeschaltet. Eine vorhandene Treasury-Adresse allein ist keine Freigabe.

Das Setzen von `billingEnabled=true` ist selbst ein geschützter Cutover-Schritt: Die API verlangt Platform-Superadmin-Rechte und konsumiert eine frische Reauth-Sitzung; die Admin-UI zeigt davor eine ausdrückliche Cutover-/Canary-Bestätigung. `billingEnabled=false` bleibt als sofortiger Not-Aus für Superadmins ohne Reauth verfügbar.

## Treasury-Verwaltung

Eine Treasury-Änderung ist eine kapitalrelevante Aktion und darf ausschließlich über den geschützten Admin-Flow erfolgen:

1. Als Platform-Superadmin anmelden.
2. Eine frische Re-Authentifizierung per Passwort oder OTP an die verifizierte E-Mail durchführen.
3. Die neue Adresse in beide Felder exakt identisch eingeben. Groß-/Kleinschreibung oder eine nur semantisch gleiche Eingabe reicht für die Bestätigung nicht aus.
4. Änderung speichern und anschließend die Readiness erneut prüfen.
5. Den erzeugten `AdminAuditEvent` auf Actor, alte/neue Adresse, Revision, Chain, Token und IP kontrollieren.

Die Reauth-Sitzung ist kurzlebig und wird beim Treasury-Write atomar verbraucht. Secrets, Private Keys oder Seed-Phrases gehören weder in diesen Flow noch in Logs, Datenbankfelder oder Support-Tickets.

## Abo-Lifecycle

- Bezahlte Laufzeiten werden als `SubscriptionTerm` mit Start, Ende, Karenzende und Entitlement-Snapshot gespeichert.
- Eine Verlängerung vor Vertragsende oder während der Karenz beginnt exakt am bisherigen Vertragsende.
- Weitere Verlängerungen werden an das Ende des letzten geplanten Terms angehängt.
- Nach Ablauf der Karenz beginnt ein Neukauf zum bestätigten Zahlungszeitpunkt.
- Zukünftige Limits, Add-ons und AI-Inklusivtokens werden erst am Termstart wirksam.
- Rechte und Add-ons des alten Terms gelten in seiner dreitägigen Karenz weiter, enden aber beim Start eines Folgeterms.
- AI-Gutschriften werden je Monatszyklus über eindeutige Ledger-Schlüssel vergeben. Eine frühe Verlängerung erzeugt keine vorzeitige Gutschrift.
- `proValidUntil` bleibt ein kompatibler Cache für das Ende aller lückenlos geplanten bezahlten Laufzeiten.
- Nach drei Tagen Karenz erfolgt der atomare Wechsel auf Free mit anschließender Entitlement-Synchronisierung.

Die Migration übernimmt nur aktuell aktive Legacy-Pro-Abos als Bestandsterm bis zum vorhandenen `proValidUntil`. Sie rekonstruiert keine historischen Laufzeiten. Nur billinggebundene Legacy-Kapazitätsgrants mit Order-Bezug, deren bisheriges `validUntil` exakt dem Vertragsende entspricht, werden an den Bestandsterm gebunden und bis zu dessen Karenzende fortgeführt; unabhängig verwaltete Grants bleiben unverändert.

## Benachrichtigungen

User können `E-Mail`, `Telegram` oder `Beide` auswählen. Ohne gespeicherte Auswahl gilt:

- Telegram, wenn eine Telegram-Verbindung vorhanden ist;
- andernfalls eine verifizierte E-Mail-Adresse.

Erinnerungen werden dedupliziert je Term, Meilenstein und Kanal versendet:

- 7 Tage vor Vertragsende,
- 3 Tage vor Vertragsende,
- 1 Tag vor Vertragsende,
- beim Eintritt in die Karenz,
- nach dem Downgrade auf Free.

Bei temporären Zustellfehlern erfolgt ein begrenzter Retry mit Backoff. Fällt der gewählte Telegram-Kanal weg, wird auf eine verifizierte E-Mail zurückgegriffen. Texte verwenden die gespeicherte UI-Sprache Deutsch oder Englisch. Eine bereits geplante Anschlusslaufzeit unterdrückt überflüssige Ablaufwarnungen für den auslaufenden Term.

Verliert ein gespeicherter Kanal seine Verfügbarkeit und existiert kein Fallback, wird trotzdem ein kanalbezogener `RETRY`-/`FAILED`-Zustellnachweis erzeugt. Damit verschwinden weder Telegram-Disconnects noch der Verlust einer E-Mail-Verifikation still aus dem Monitoring.

## Monitoring und manuelle Prüfung

Während Canary und Hochlauf sind mindestens folgende Signale zu beobachten:

- Anzahl offener `PENDING`- und `CONFIRMING`-Orders sowie deren Alter,
- Bestätigungsfortschritt und Differenz zur aktuellen Arbitrum-Blockhöhe,
- Orders in `REVIEW_REQUIRED`, gruppiert nach `lastError` beziehungsweise `paymentStatusRaw`,
- Tx-Hash-Kollisionen und mehrdeutige Discovery-Kandidaten,
- RPC-Fehler, Retry-Anzahl, Backoff und letzter erfolgreicher Scan-Cursor je Treasury-Snapshot,
- Abgleich `PAID` ↔ genau ein `SubscriptionTerm` ↔ genau eine Entitlement-Aktivierung,
- fällige `SCHEDULED`, `ACTIVE`, `GRACE` und `EXPIRED` Terms,
- offene oder endgültig fehlgeschlagene Benachrichtigungszustellungen.

Relevante strukturierte Logs:

- `billing_onchain_reconcile_cycle`
- `billing_onchain_discovery_cycle_failed`
- `billing_onchain_submitted_reconcile_cycle_failed`
- `billing_subscription_lifecycle_cycle`
- `billing_subscription_lifecycle_cycle_failed`
- `subscription_reminder_cycle`
- `subscription_reminder_cycle_failed`

Bei `REVIEW_REQUIRED` niemals allein anhand eines Screenshots oder eines vom User genannten Tx-Hashs freischalten. Immer Arbiscan/RPC-Receipt, Tokenadresse, Sender, Treasury-Snapshot, Betrag, Bestätigungen und bestehende Tx-Hash-Zuordnungen gemeinsam prüfen. Es gibt in Version 1 keine automatische Rückzahlung.

Für Canary-Betrieb verantwortet der diensthabende Platform-Superadmin die Review-Queue. Die offene Queue wird mindestens vor und nach jedem Canary sowie während des Hochlaufs regelmäßig read-only abgefragt:

```sql
SELECT
  o."id",
  o."merchant_order_id",
  o."user_id",
  o."amount_cents",
  o."payment_status_raw",
  o."created_at",
  p."tx_hash",
  p."expected_sender_address",
  p."treasury_address",
  p."expected_amount_raw",
  p."block_number",
  p."confirmations",
  p."last_error",
  p."last_checked_at"
FROM "billing_orders" AS o
LEFT JOIN "billing_onchain_payments" AS p ON p."order_id" = o."id"
WHERE o."provider" = 'ARBITRUM_USDC'
  AND o."status" = 'REVIEW_REQUIRED'
ORDER BY o."updated_at" ASC;
```

Receipt, Order-Snapshot, Treasury-Revision, Entscheidung und Freigabe werden unter `docs/tasks/YYYY-MM-DD-*.md` als Evidence festgehalten. Die Order bleibt in Version 1 absichtlich `REVIEW_REQUIRED`: Es gibt keinen Admin-Endpunkt, der sie automatisch erneut aktiviert oder als bezahlt umschreibt. Refund oder eine manuelle Entitlement-Korrektur sind separate kapitalrelevante Aktionen und benötigen eine ausdrückliche Freigabe sowie einen eigenen Audit-Nachweis. Vor einem breiten Public-Go-live ist ein expliziter, idempotenter Resolve-/Refund-Workflow ein eigenes Release-Gate.

## Legacy-CCPayment

CCPayment ist aus aktivem Checkout, Webhook-Runtime, Admin-Konfiguration, Health-Checks, Env-Konfiguration und Nutzeroberfläche entfernt. Der Enum-Wert `CCPAYMENT` bleibt nur erhalten, damit bestehende Orders und Auditdaten unverändert lesbar bleiben.

Historische Orders und gespeicherte Provider-/Webhook-Daten dürfen weder gelöscht noch nachträglich umgeschrieben werden. Der neue Reconciler verarbeitet ausschließlich `ARBITRUM_USDC`-Orders.

Wichtig: Bereits bezahlte oder möglicherweise bezahlte CCPayment-Orders müssen vor dem Deployment des Runtime-Cutovers abschließend über den alten Pfad abgeglichen werden. Nach Entfernung der aktiven Integration gibt es keinen automatischen CCPayment-Reconcile mehr.

## Zwingende Cutover-Reihenfolge

Die Reihenfolge darf nicht verkürzt oder vertauscht werden:

1. **Neue CCPayment-Checkouts stoppen.** Zeitpunkt dokumentieren und alle noch offenen Legacy-Orders exportieren.
2. **Legacy-Abgleich abschließen.** Bereits bezahlte CCPayment-Orders final reconciliieren. Unklare, abgelaufene, zurückgezahlte oder potenziell bezahlte Fälle einzeln erfassen und manuell klassifizieren. Erst danach den alten Runtime-Pfad entfernen.
3. **Backup und Evidence sichern.** Datenbank-Snapshot, Orderlisten, Abgleichsergebnis und verantwortliche Freigabe dokumentieren.
4. **Migration und Anwendung deaktiviert ausrollen.** Prisma-Migration, API und Web deployen, Billing aber noch nicht aktivieren. Migrationsergebnis und Legacy-Term-Backfill prüfen.
5. **Server-RPC konfigurieren.** `BILLING_ARBITRUM_RPC_URL` setzen, API neu starten und Chain-ID, letzte Blockhöhe sowie Fehlerstatus kontrollieren.
6. **Treasury geschützt setzen.** Superadmin-Reauth durchführen, Adresse doppelt bestätigen, Audit-Event prüfen und Readiness dokumentieren.
7. **Arbitrum-Sepolia-Smoke nur nach ausdrücklicher Freigabe.** Der Produktionspfad ist absichtlich auf Arbitrum One und natives Mainnet-USDC fest verdrahtet; ein Sepolia-Smoke muss deshalb in einer isolierten Preproduction-Konfiguration beziehungsweise einem separaten Test-Build stattfinden. Das Setzen eines Sepolia-RPCs in Produktion ist unzulässig und wird als falsche Chain abgelehnt.
8. **Low-Value-Mainnet-Canary nur nach zweiter ausdrücklicher Freigabe.** Mit einem bekannten Testaccount und einer bekannten Wallet exakt eine kleine Bestellung senden. Tx-Hash, 12 Bestätigungen, Treasury-Eingang, genau einen Term, korrekten Termstart, Entitlements und Auditdaten nachvollziehen.
9. **Billing aktivieren.** Erst wenn Readiness, Legacy-Abgleich, Sepolia-Smoke, Mainnet-Canary und Operator-Freigabe vollständig dokumentiert sind.
10. **Hochlauf überwachen.** Confirmations-, RPC-, Discovery-, Review-, Lifecycle- und Notification-Signale eng beobachten; Volumen nur stufenweise erhöhen.

## Stop-Kriterien

Aktivierung oder Hochlauf sofort anhalten bei:

- falscher Chain, Token- oder Treasury-Konfiguration,
- ungeklärter CCPayment-Historie,
- RPC ohne stabile Arbitrum-One-Blockprüfung,
- einer Zahlung mit doppelter oder fehlender Term-Aktivierung,
- Tx-Replay oder nicht eindeutiger Zuordnung,
- unerwarteter Unter-/Überzahlung außerhalb von `REVIEW_REQUIRED`,
- nicht nachvollziehbarer Treasury-Rotation oder fehlendem Audit-Event,
- fehlerhaftem Grace-/Free-Downgrade oder mehrfacher AI-Gutschrift.
- unerwarteter Reorganisation nach einer bereits aktivierten 12-L2-Block-Zahlung.

Bis zur Ursachenklärung Billing nicht freigeben und keine manuellen Finanzkorrekturen ohne Onchain- und Datenbank-Reconciliation durchführen.
