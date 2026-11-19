# AGENTS.md

Orientierung für KI-Agenten (Claude Code, Codex, …) und Mitwirkende an diesem Repository. Workspace-weite Standards (comply-or-explain): siehe [`../../workspace/_docs/CONVENTIONS.md`](../../workspace/_docs/CONVENTIONS.md) (maintainer-lokal, nicht Teil dieses Repos — ignorieren, falls im Klon nicht vorhanden).

**Stand 2026-11-19:** Gerüst nach Dach-Standard steht (Gates, kit-sync, Lizenzen), noch kein Feature. Spec und Bauplan liegen im Coding-Cockpit; der Bauplan zählt die Tasks, dies hier ist Task 1.

## Project character

**Projekt:** `hypertext-exporter` — Obsidian-Plugin: erzeugt aus einem Ordner (oder einer Notiz) Markdown-Notizen mit Frontmatter deterministisch eine eigenständige, aufklappbare HTML-Seite zum Weitergeben. Die Notizen bleiben die Quelle, die Seite ist ein Erzeugnis, nie von einem Modell geschrieben; sie lädt nichts nach. Steht in der Reihe von epub-exporter, paperize, letterhead und slide-deck. Autor: Johannes Kaindl.

- **Plugin-ID:** `hypertext-exporter`, `isDesktopOnly: false`, `minAppVersion` 1.8.7, Lizenz AGPL-3.0-or-later (Doku CC BY-SA 4.0).
- **TS + esbuild:** `main.js` ist ein Build-Artefakt (`.gitignore`), nicht committet.
- **Stand und Plan:** Spec `$CODING_COCKPIT_VAULT/25_Coding/hypertext-exporter/_SDD/2026-11-18-hypertext-exporter-design.md`, Bauplan `$CODING_COCKPIT_VAULT/25_Coding/hypertext-exporter/_SDD/2026-11-19-hypertext-exporter-bauplan.md` (Cockpit, nicht im Repo).

## Architecture principles

- **Drei Schichten:** `src/core/` rein (kein `obsidian`-Import, geprüft mit `npm run check:pure`), `src/obsidian/` spricht mit Obsidian, `src/vendor/kit/` und `src/vendor/kit-obsidian/` sind vendorte Kit-Module (nie von Hand ändern).
- **Kit-first (Dach-AGENTS.md):** Alles Wiederverwendbare liegt im Kit (obsidian-kit, code-kit) und kommt per kit-sync. Eine neue exportierte reine Funktion ohne plugin-eigenen Typ in der Signatur geht nicht ins Plugin, sondern als Bestellung an den Kit-Master. Vor dem Bauen: `python3 ../tools/funktionsinventur/naehte_suche.py <wörter>`; vor dem Commit `python3 ../tools/bibliothek/gate.py --repo hypertext-exporter --liste`.
- **Feste Folge der Schritte** (Spec 10.2), Marken und Determinismus nach Spec 10.4 und 10.8: keine Uhrzeit, kein Zufallswert, kein Benutzerpfad, keine `app://`-Adresse in der Ausgabe; Reihenfolgen nie mit `localeCompare` und nie nach Dateisystem.
- **Store-Bauart (Spec 8, hält Passed):** (1) `innerHTML` und `outerHTML` nur lesen, nie zuweisen. (2) Kein Node-Modul (`fs`, `path`, `zlib`, `crypto`, `node:*`, `Buffer`), geschrieben wird über die Vault-API; `npm run check:no-node` prüft das für `src/` ohne `src/vendor`. (3) Kein angehängtes `<style>` im Obsidian-Fenster; der Stil der Seite ist eine Zeichenkette in der Ausgabe. (4) `createEl` und `activeDocument` statt `document.createElement` und `document`. (5) Einstellungen über `getSettingDefinitions()`. Keine Laufzeit-Abhängigkeit.

## Commands

```bash
npm run typecheck          # tsc --noEmit
npm test                   # check-no-abs-paths + check-no-nul-bytes + vitest run
npm run check:pure         # kein obsidian-Import in src/core und src/vendor/kit
npm run check:no-node      # kein Node-Modul in src/ (ohne src/vendor), Gegenprobe mit einer Wegwerfdatei
npm run lint               # check-no-inline-disables + eslint src (eslint-plugin-obsidianmd), 0 Warnungen
npm run build              # esbuild --production → main.js
npm run gate               # typecheck + typecheck:test + typecheck:scripts + test + check:pure + check:no-node + lint + build — vor jedem Commit
npm run smoke:gui          # folgt mit Task 2 (Treiber gegen eine Zweitinstanz)
sh tools/sync-kit.sh       # Kit vendoren (Pins in tools/kit-sync.json); --check vergleicht nur
```

## Conventions

- Markdown-Dateien: ein Absatz je Zeile (Johannes' Regel seit 2026-09-19). Kein absoluter Benutzerpfad in getrackten `*.md` (Gate `scripts/check-no-abs-paths.mjs`); Vault- und Staging-Orte nur über Variablen (`$CODING_COCKPIT_VAULT`).
- Conventional Commits auf Deutsch, SemVer-Tags ohne `v`, nur berührte Dateien per Pfad stagen. `origin` ist Forgejo; `github` gibt es noch nicht und bekommt Branch und Tag später nur über `release.mjs`. Kein Release, kein Tag vor der Abnahme.
- **Store-Gate:** kein Inline-`eslint-disable` in `src/` (erzwungen von `scripts/check-no-inline-disables.mjs`); Ausnahmen nur file-scoped in `eslint.overrides.mjs` mit Begründung.
- i18n zweisprachig (EN/DE) in `src/i18n/strings.ts` über die Kit-Engine `i18n`.
- Release-Tooling liegt zentral unter `../tools/release/`, nicht im Repo; ein Clone ohne Dach ist nicht release-fähig. Regeln: `../.claude/rules/release-und-store.md`.
- GUI-Läufe nur in einer Zweitinstanz mit Lock (`../.claude/rules/obsidian-instanz.md`, `../.claude/rules/cdp-lock.md`).

## Gotchas

- **focus-crew-Daten kommen in kein Repo und in keinen Commit** (Abnahmefall 1 liegt nur im Cache-Ordner und im Staging-Vault).
- `src/vendor/` gehört kit-sync: `node ../tools/kit-sync/kit-sync.mjs --check` muss grün sein, Handänderungen fallen dort auf.
- `grep` ist auf diesem Rechner ugrep und respektiert `.gitignore`; Gegenprobe mit einem Begriff, der sicher irgendwo steht.

## Context index

- Recherche zu Kit-Bausteinen und Store-Nachbarn: `$CODING_COCKPIT_VAULT/25_Coding/hypertext-exporter/_SDD/2026-11-18-recherche-kit-bausteine-und-store-nachbarn.md` (Cockpit, nicht im Repo).
- Vor UI-Arbeit: `../UI-STANDARD.md` und `../.claude/rules/ui-bausteine.md`; vor einer `styles.css`: `../.claude/rules/store-css.md`.
- Vor einem GUI-Smoke-Treiber: `../.claude/rules/gui-smoke-treiber.md`, `../tools/obsidian-cdp/README.md`.
- Vor einem Release oder Rescan: `../.claude/rules/release-und-store.md`, Skills `plugin-release-setup` und `store-rescan`.
- Dach-Kontext: `../AGENTS.md` (Kit-first, Angleichen als Default) und `../REGISTRY.md` vor dem Lösen eines Problems.

## Memory

Das Coding-Cockpit (`25_Coding/hypertext-exporter/` im Arbeits-Vault) ist die SSOT für Stand, Warum und Entscheidungen. Session-Handoff unter `.remember/` (gitignored).

## Abweichungen von der Leitkonvention

Keine bekannt. Einzige Besonderheit: das zentrale Release-Tooling unter `../tools/release/` statt eines lokalen `scripts/release.mjs`.
