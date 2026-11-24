# Aufnahme-Vertrag — README-Bilder

Dieser Ordner hält die Bilder, die `README.md` und `README.de.md` einbetten. Diese Datei ist der **Vertrag**: welche Bilder es gibt, was jedes zeigen muss, in welcher Klasse es steht, und wie man sie reproduzierbar neu aufnimmt. `readme_lint.py` gleicht Vertrag, Dateien und Einbettungen ab.

## Status

**Stand 2026-11-24: vier Bilder aufgenommen, `shots:check` grün (Treiber `scripts/shots.ts`, Obsidian 1.15.1, Chrome 158).** Alle vier wurden nach dem Lauf angesehen. Offen: keines.

Befund beim Aufnehmen: Die Texte der Befunde im Panel „Findings“ sind deutsch, auch in der englischen Oberfläche (`findings.png` zeigt es). Das Bild zeigt den Auslieferungszustand und bleibt so; die Folge steht als Task im Cockpit.

## Konventionen

Verbindlich ist der workspace-weite Bild-Standard in `_docs/readme/readme-spec.json` (`images`-Block). Kurzfassung:

| Klasse | Einbettung | Grenze |
|---|---|---|
| `hero` | `width="820"`, zentriert, direkt nach den Badges | Querformat (H ≤ B) |
| `feature` | `width="820"` | H/B ≤ 1.6 |
| `detail` | Vorschaubild `width="380"`, verlinkt auf die Vollauflösung | keine Höhengrenze |

Aufnahme bei 1200 px Breite (Dichte 2, heruntergerechnet), Vorschaubilder 380 px unter `thumbs/`, Einbettung immer per `<img width>`. Budget: PNG ≤ 400 KB, Ordner-Summe ≤ 5120 KB. Alt-Texte beschreiben, was zu sehen ist.

## Die Bilder

| Datei | Klasse | referenziert von | muss zeigen |
|---|---|---|---|
| `hero.png` | hero | beide READMEs, nach den Badges | Die **erzeugte Seite** des Fixtures „Trail Notes“ als `file://` in headless Chrome (nicht Obsidian), helles Schema, 1200 × 840: der Werkzeug-Block mit dem Suchwort `lake`, der Zahl der Treffer (`2 matches`) und den Knöpfen `Clear`, `Expand all`, `Collapse all`; darunter die Navigation, die Einstiegsnotiz mit dem geöffneten Bereich „Where to start“ (Treffer hervorgehoben, Bild, gefaltete Callout „Packing light“) und der Anfang der Gruppe „Routes“ mit ihrer Übersicht. Das Bild muss ohne Bildunterschrift sagen: eine Seite, die sich durchsuchen und aufklappen lässt. |
| `recipe-in-note.png` | feature | beide READMEs, § Usage („The recipe“) | Die Einstiegsnotiz **im Quelltext-Modus** mit dem vollständigen Block `hypertext:` im Frontmatter (nicht als Eigenschaften-Feld), rechts das Panel `Export` mit dem Quellordner `Trail Notes`, `6 notes in this folder.` und dem Knopf `Export folder`. Die Statusleiste ist für die Aufnahme ausgeblendet (fremdes Sync-Symbol). |
| `findings.png` | detail | beide READMEs, § Usage („Ways into an export“) | Das Panel `Findings` nach einem Export des Fixtures: die Zusammenfassung `0 errors, 3 warnings, 2 notices` und alle fünf Befunde mit Schwere, Text, Code (`field.missing`, `link.outside`, `link.unresolved`, `output.size`, `media.remote-skipped`) und dem Sprung zur Notiz; zugeschnitten auf den letzten Befund, nicht bis zum Fensterrand. |
| `page-mobile.png` | detail | beide READMEs, § Usage („The recipe“) | Dieselbe Seite bei **390 Pixel** Breite (Gerätedichte 2, 780 × 1688): Suchzeile, Navigation und Einstiegsnotiz ohne waagerechtes Scrollen (der Treiber misst `scrollWidth` ≤ 390 und nimmt sonst nicht auf). |

## UI-Strings, verbatim aus `src/i18n/strings.ts`

Ändern sich diese Strings, ändern sich die Bilder.

| Schlüssel | Text |
|---|---|
| `hub.tab.export` | Export |
| `hub.tab.findings` | Findings |
| `export.source.label` | Source folder |
| `export.count.many` | {0} notes in this folder. |
| `export.button` | Export folder |
| `findings.summary` | {0} errors, {1} warnings, {2} notices |
| `findings.severity.warning` | Warning |
| `findings.severity.info` | Notice |

## Reproduktion

```bash
npm run build && npm run shots -- --setup   # Staging-Vault hypertext-exporter-smoke aus dem Fixture bauen
npm run shots -- --list                      # diesen Vertrag anzeigen
npm run shots:check                          # gegen den Bild-Standard prüfen
```

Aufgenommen wird in einer Zweitinstanz (Port 9845) und in headless Chrome (Port 9844), beide mit Lock, über `tools/obsidian-cdp/messlauf.sh` mit `RUNNER=shots` und `SETUP_BEFEHL='npm run shots -- --setup'`; die vollständige Befehlszeile steht im Kopf von `scripts/shots.ts`. `--only <name>` nimmt ein Bild neu auf. Der Treiber startet Chrome selbst und beendet es am Ende; nach dem Lauf jedes Bild ansehen.

## Fixture

`fixture/notes/` hält erfundene, englische Wandernotizen (`Trail Notes/` mit `Routes/`, `Gear/` und einem Bild, dazu `Outside/Camp rules.md` außerhalb der Menge, damit ein Befund `link.outside` entsteht) und `fixture/obsidian/` die Vault-Konfiguration, die nur dieses Plugin aktiviert. Es kommen weder echte Namen noch Daten aus einem Projekt vor.

| Datei | Rolle |
|---|---|
| `lake.png` (unter `fixture/notes/Trail Notes/`) | Beilage des Fixtures (erzeugt, mit Rauschen, damit der Weißraum-Test nicht anschlägt), kein README-Bild; sie steht im Bild von `hero.png` und `page-mobile.png`. |
