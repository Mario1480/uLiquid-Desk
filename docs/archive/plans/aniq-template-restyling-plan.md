# Plan fuer die Uebernahme des Aniq-Templates als Design-Referenz

## Zielbild

Das Aniq-Template wird nicht als technisches Grundgeruest in `apps/web` uebernommen. Es dient als visuelle Referenz fuer Farben, Flaechen, Kanten, Glow-/Shadow-Verhalten, Typografie-Hierarchie und Motion-Prinzipien.

Die bestehende Architektur in `apps/web` bleibt erhalten:

- App Router, Routing und Seitenstruktur
- Datenfluesse und API-Anbindung
- `next-intl`-Setup und Messages
- vorhandene Komponentenstruktur
- bestehende CSS-Klassen und Zustandslogik

Leitentscheidung: kein Template-Merge, keine Tailwind-v4-Migration, keine 1:1-Codeuebernahme aus dem Marketing-Template.

## Repo-Ausgangslage

Die wichtigsten visuellen Einstiegspunkte liegen bereits an den richtigen Stellen:

- globale Tokens und viele Basisstile in [`apps/web/app/globals.css`](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/web/app/globals.css)
- App-Shell in [`apps/web/app/components/AppShell.tsx`](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/web/app/components/AppShell.tsx)
- Header in [`apps/web/app/components/AppHeader.tsx`](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/web/app/components/AppHeader.tsx)
- Sidebar in [`apps/web/app/components/AppSidebar.tsx`](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/web/app/components/AppSidebar.tsx)

Das ist guenstig fuer ein kontrolliertes Restyling, weil Buttons, Inputs, Badges, Tabellenflaechen, Header, Breadcrumbs und Sidebar heute schon ueber gemeinsame Klassen in `globals.css` laufen.

## Template-Befund

Das gekaufte ZIP ist technisch ein separates Next.js-/Tailwind-v4-Projekt und sollte nicht in die App-Struktur eingebaut werden.

Relevant als Designquelle sind vor allem:

- `src/styles/theme.css`
- `src/styles/theme.Ex-blue.css`
- `src/styles/base.css`
- `src/styles/animations.css`
- ausgewaehlte visuelle Komponenten wie `Card`, `Spotlight`, `GridBg`, `PageBackground`

Irrelevant fuer die Produkt-App sind die meisten Landingpage-Sektionen, Conversion-Blades und marketing-spezifischen Inhaltsstrukturen.

## Lizenz-Notiz

Im Paket liegt eine Lizenz mit Projektbindung:

- Personal License: nicht fuer kommerzielle Produktnutzung
- Commercial License: genau ein kommerzielles Projekt
- Extended Commercial License: mehrere Projekte

Vor Start der Umsetzung einmal festhalten:

- welche Lizenz gekauft wurde - Personal License
- fuer welches Produkt sie gilt
- dass nur Designmuster bzw. angepasste Produkt-Styles uebernommen werden - nur Designmuster bzw. angepasste Produkt-Styles übernhemen.

Wichtig: Kein Template-Quellcode in open-source-faehige Bereiche oder als wiederverwendbares Starter-Kit ausleiten.

## Umsetzungsstrategie

### 1. Design-Extraktion

Aus dem Template werden nur wiederverwendbare Designmuster extrahiert:

- Farbpalette und Kontraststufen
- Surface-Logik fuer Hintergrund, Panel, Card und Overlay
- Border- und Radius-System
- Shadow-/Glow-Prinzipien
- Typografie-Hierarchie
- Hover-, Focus- und Active-Zustaende
- sparsame Motion-Prinzipien

Ergebnis dieser Phase:

- dokumentierte Token-Matrix fuer `brand`, `surface`, `surface-elevated`, `text`, `muted`, `border`, `accent`, `success`, `warning`, `danger`, `focus`, `shadow`, `radius`
- Liste der Formen, die im Panel wirklich uebernommen werden sollen
- Liste der Template-Effekte, die bewusst nicht uebernommen werden

### 2. Token-Layer im bestehenden Panel

Die erste echte Code-Aenderung erfolgt in [`apps/web/app/globals.css`](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/web/app/globals.css).

Vorgehen:

- bestehende Root-Variablen auf ein klareres Token-System umstellen
- semantische Variablen ergaenzen, statt nur Einzelwerte zu ersetzen
- bestehende Klassenstruktur erhalten
- gemeinsame Grundelemente wie `.btn`, `.input`, `.card`, `.badge`, Tabellencontainer und Menuepanels ueber Tokens restylen

Beispiel fuer die Zielrichtung des Token-Layers:

- `--color-bg-app`
- `--color-surface-1`
- `--color-surface-2`
- `--color-surface-3`
- `--color-text-primary`
- `--color-text-secondary`
- `--color-border-default`
- `--color-border-strong`
- `--color-brand-primary`
- `--color-brand-soft`
- `--color-focus-ring`
- `--shadow-panel`
- `--shadow-elevated`
- `--radius-sm`
- `--radius-md`
- `--radius-lg`

Wichtig: keine neue technische Public API, keine Route-Aenderungen, keine State- oder Datenmodell-Aenderungen.

### 3. Shell zuerst

Die App-Shell bekommt zuerst die neue Designsprache, weil sie auf allen Produktseiten sichtbar ist.

Primäre Ziele:

- Header-Flaeche und Toolbar
- Sidebar-Flaeche, aktive Navigation, Hover und Fokus
- Breadcrumbs
- globale App-Hintergruende
- Suchfeld, Menuepanels, Wallet-/User-Dropdowns

Betroffene Dateien:

- [`apps/web/app/components/AppShell.tsx`](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/web/app/components/AppShell.tsx)
- [`apps/web/app/components/AppHeader.tsx`](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/web/app/components/AppHeader.tsx)
- [`apps/web/app/components/AppSidebar.tsx`](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/web/app/components/AppSidebar.tsx)
- [`apps/web/app/globals.css`](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/web/app/globals.css)

### 4. Standard-Komponenten angleichen

Danach werden die wiederverwendbaren Produktbausteine vereinheitlicht:

- Cards
- Formularfelder
- Buttons
- Badges
- Tabellen-Wrapper
- Filterleisten
- Dialog-/Modal-Flaechen
- KPI-Widgets
- Alert-Boxen

Das Ziel ist keine neue Komponentenbibliothek, sondern ein konsistenter visueller Layer ueber den bestehenden Bausteinen.

### 5. Sichtbare Produktseiten umstellen

Wenn Shell und Grundkomponenten stabil sind, folgen die Seiten mit der hoechsten Sichtbarkeit:

- Login/Auth
- Dashboard
- Bots
- Trading Desk
- Predictions
- Settings
- Funding/Wallet/Vaults je nach Prioritaet

Der Seitenaufbau bleibt erhalten. Geaendert werden nur Kontrast, Kanten, Spacing, Flaechen, Hervorhebungen und mikrovisuelles Verhalten.

## Empfohlene Rollout-Reihenfolge

### Phase A

- Token-Layer in `globals.css`
- globaler Seitenhintergrund
- Shell: Header, Sidebar, Breadcrumbs

### Phase B

- Buttons, Inputs, Badges, Menuepanels, Tabellencontainer, Standard-Cards
- Fokus- und Hover-Zustaende

### Phase C

- Dashboard
- Bots
- Trading Desk
- Predictions

### Phase D

- Login/Register/Reset
- Settings, Help, Funding, Wallet, Vaults
- Konsistenzabgleich ueber Randseiten

Die spaetere Website kann anschliessend auf denselben Tokens aufbauen, ist aber nicht Teil dieses Arbeitspakets.

## Guardrails

Folgendes ist explizit nicht Teil der Umsetzung:

- keine Einfuehrung von Tailwind v4 in `apps/web`
- kein Einbau der Template-Komponenten als neues UI-Framework
- keine Uebernahme von Marketing-Sektionen, Pricing-, Blog- oder FAQ-Strukturen
- keine Veraenderung von Navigation, Auth-Flows, Wallet-Handling oder API-Verhalten
- keine grossflaechige Motion- oder WebGL-Uebernahme ohne klaren Produktnutzen

## Risiken und Gegenmassnahmen

### Risiko: visuelle Drift durch zu viele Einzelanpassungen

Gegenmassnahme:

- zuerst Token-Layer stabilisieren
- spaeter nur gezielt komponentenweise uebersteuern

### Risiko: App verliert Lesbarkeit oder Kontrast

Gegenmassnahme:

- Kontrastpruefung fuer Text, Borders und Fokuszustand
- hellere Marketing-Effekte nur sparsam im Produkt verwenden

### Risiko: versehentliche technische Migration

Gegenmassnahme:

- keine Abhaengigkeiten aus dem Template uebernehmen, solange sie nicht separat begruendet sind
- kein Import von Template-CSS oder Template-Utilities in `apps/web`

### Risiko: uneinheitlicher Look zwischen Auth und Hauptapp

Gegenmassnahme:

- Auth-Screens bewusst als eigene Abnahmephase einplanen

## Abnahme und Tests

Visuelle Pflichtstrecke:

- Login
- Dashboard
- Bots
- Trading Desk
- Predictions
- Settings

Pruefpunkte:

- Desktop und Mobile-Navigation
- Hover-, Focus- und Active-Zustaende
- Lesbarkeit in Tabellen, Formularen und Dialogen
- keine funktionalen Regressions in Navigation, Formularen, Modals, Wallet und Auth
- Repo-Audit auf versehentliche Template-Abhaengigkeiten oder Tailwind-v4-Einfuehrung

## Praktischer Start im Repo

Empfohlene erste Umsetzung in einem separaten Branch:

1. Token-System in [`apps/web/app/globals.css`](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/web/app/globals.css) strukturieren.
2. Shell-Flaechen in Header, Sidebar und Breadcrumbs auf die neue Designsprache umstellen.
3. Basisbausteine `.btn`, `.input`, `.badge`, `.card` und zentrale Menuepanels vereinheitlichen.
4. Danach seitenweise feinjustieren statt sofort das ganze Panel gleichzeitig anzufassen.

## Annahmen

- Das Template wurde oder wird mit passender kommerzieller Lizenz gekauft.
- Ziel ist die Uebernahme von Farben, Formen und Stilprinzipien, nicht die direkte Codeintegration.
- `apps/web` bleibt auf dem aktuellen Stack.
- Die Website wird spaeter separat auf derselben Designbasis aufgebaut.
