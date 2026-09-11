# Agent 05 – Agent Chat UI/UX

## Auftrag

Implementiere die eigenständige Agent-Chat-Oberfläche in der vorhandenen uLiquid Designsprache. Nutze vor UI-Arbeit den projektspezifischen Skill `apply-uliquid-ui-design`, wie in `AGENTS.md` gefordert.

## Navigation

Empfohlene AI-Gruppe in der Sidebar:

```text
AI
  Agent Chat
  Predictions
  Prediction Builder
```

Agent Profiles und Activity können zunächst als Unterseiten/Drawer des Agent Chat umgesetzt werden. Eine eigene Sidebar-Navigation erst hinzufügen, wenn diese Bereiche stabil genug sind.

Zu ändern:

- `apps/web/app/components/AppSidebar.tsx`
- `apps/web/app/components/AppHeader.tsx`
- `apps/web/app/components/AppBreadcrumbs.tsx`
- Navigation-i18n
- `AppIcon` nur erweitern, wenn kein passendes Icon existiert

## Desktop Layout

```text
┌──────────────────────────────────────────────────────────┐
│ Title · Context Bar · New Chat · Skills                  │
├───────────────────────────────────┬──────────────────────┤
│                                   │ Agent Activity       │
│ Conversation                      │                      │
│                                   │ Tool calls           │
│ Assistant response blocks         │ Sources / status     │
│                                   │                      │
├───────────────────────────────────┴──────────────────────┤
│ Composer                                                  │
└──────────────────────────────────────────────────────────┘
```

Skills & Permissions öffnen als rechter Drawer oder Modal. Die Activity-Spalte kann auf kleineren Desktopbreiten einklappen.

## Context Bar

Kontrollen:

- Agent Profile
- Venue
- Exchange Account – nur bei Account-Read-Profil
- Market Type
- Symbol
- Modus Badge: Public data / Read only / Drafts
- Skills Button mit Anzahl

Änderungen am Context gelten für neue Messages. Bestehende Antworten behalten ihren Run-Snapshot.

## Conversation UI

### User Message

- Text,
- Timestamp,
- kompakter Context Snapshot optional.

### Assistant Message

- klare Zusammenfassung,
- strukturierte Blocks,
- Source-/Freshness-Info,
- Degraded-Hinweis,
- Agent Activity einklappbar,
- keine scheinbaren Execution-CTAs im MVP.

Sichere Schnellaktionen:

- „Tiefere Analyse“
- „Exit-Szenarien erklären“
- „Prediction vergleichen“
- „Als Bericht kopieren“

Nicht im MVP:

- „Position reduzieren“ als direkter Button,
- „Position schließen“ als direkter Button,
- Leverage/Margin/Wallet-Aktionen.

## Empty State

Beispielprompts je Profil:

Market Analyst:

- „Analysiere BTC auf 1h und 4h.“
- „Welche Märkte zeigen steigendes Open Interest?“
- „Welche US-Termine sind heute relevant?“

Position Copilot:

- „Prüfe meine ausgewählte Position.“
- „Welche Position hat aktuell das höchste Liquidationsrisiko?“
- „Vergleiche Position und letzte Prediction.“

## Activity UI

Status:

- queued
- loading
- success
- degraded
- failed
- blocked

Beispiel:

```text
✓ ETH 4h Candles · Hyperliquid · 1.2 s
✓ Funding Rate · Hyperliquid · frisch
! News · 2 Provider eingeschränkt
✓ Position Snapshot · Main Account · read-only
```

Keine Rohargumente oder internen IDs anzeigen, wenn sie keinen Nutzwert haben.

## Mobile

- Context Bar horizontal scrollbar oder kompakter Context Button.
- Activity als Bottom Sheet.
- Skills/Permissions als Fullscreen Sheet.
- Composer bleibt sichtbar, aber überdeckt keine Antwort.
- Tabellen in Cards oder horizontal scrollbaren Bereichen.
- keine drei Spalten.

## Accessibility

- Tastaturbedienung,
- klare Focus States,
- Live Region für Tool Activity und Streaming,
- Status nicht nur durch Farbe,
- Tool-Drawer mit korrekter Dialog-Semantik,
- Reduced Motion berücksichtigen.

## Dateien

Vorschlag:

```text
apps/web/app/agent-chat/page.tsx
apps/web/components/agent-chat/AgentChatShell.tsx
apps/web/components/agent-chat/AgentContextBar.tsx
apps/web/components/agent-chat/ConversationList.tsx
apps/web/components/agent-chat/ChatMessage.tsx
apps/web/components/agent-chat/AgentActivityPanel.tsx
apps/web/components/agent-chat/SkillPermissionDrawer.tsx
apps/web/components/agent-chat/AgentComposer.tsx
apps/web/components/agent-chat/blocks/*
apps/web/src/agent-chat/contracts.ts
apps/web/src/agent-chat/viewModel.ts
```

Page nur für Datenkoordination und Layout. Keine riesige monolithische Page.

## Tests

- Navigation und Breadcrumb,
- Market Analyst ohne Account,
- Position Profile mit Account-Auswahl,
- Skill Drawer und Permission Tab,
- Loading/Empty/Error/Degraded,
- Mobile Drawer,
- Activity Reihenfolge,
- keine Execution Requests aus dem Client,
- deutsche und englische Übersetzungen vollständig.

## Akzeptanzkriterien

- visuell klar vom Prediction Builder unterscheidbar,
- Nutzer sieht Profil, Datenquelle, Konto, Markt und Rechte,
- Agent Activity schafft Transparenz,
- mobile Bedienung vollständig,
- keine irreführenden Trading-Aktionsbuttons im Read-only-MVP.
