---
title: Beispielordner für den Hypertext-Export
order: 1
hypertext:
  version: 1
  lang: de
  title: Beispiel für den Hypertext-Export
  sections:
    - folder: kapitel
      title: Kapitel
      order: name
      overview:
        - status
        - aufwand
        - header: Stand
          template: "{status} (Aufwand {aufwand})"
      summary_line:
        - status
    - ordner: anhang
      titel: Anhang
      reihenfolge: mention
      zusatzzeile:
        - status
      offen: true
    - folder: leer
      title: Leerer Ordner
  fold:
    headings_from: 2
---

Dieser Ordner ist ein erfundener Prüffall für den Hypertext-Export.
Er enthält Texte, Bilder, Ton, Film, Fußnoten, Einbettungen und einige Stolperfallen, und er gehört keinem echten Projekt.

## Überblick

Die Seite soll aus diesem Ordner dieselben Bytes ergeben, so oft man sie auch erzeugt.
Alles, was dazu nötig ist, steht in der Bauanleitung am Kopf dieser Notiz, teils mit englischen, teils mit deutschen Schlüsseln.

#beispiel #prüffall

## Kapitel

Die Kapitel stehen im Ordner `kapitel`: [[kapitel/01 Grundlagen|Grundlagen]] und [[kapitel/02 Größen und Maße|Größen und Maße]].
Der Entwurf mit der Null im Namen gehört nicht zur Seite.

## Anhang

Der Anhang folgt der Reihenfolge, in der er hier genannt wird: zuerst [[anhang/fussnoten|die Fußnoten]], dann [[anhang/eingebettet|die eingebettete Notiz]], zuletzt [[anhang/blöcke|die Blöcke und Links]].

## Medien

Ein kleines Bild als PNG:

![[bild.png]]

Dasselbe als Vektorgrafik:

![[bild.svg]]

Ein kurzer Ton:

![[ton.mp3]]

Ein kurzer Film:

![[film.mp4]]

## Fernes und Fehlendes

Ein Bild im Netz wird nicht geladen:

![Ein Bild im Netz](https://example.invalid/bild.png)

Ein Bild, das es im Vault nicht gibt:

![[fehlt.png]]
