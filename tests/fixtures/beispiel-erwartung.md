# Erwartung an den Beispielordner (Abnahmefall 2)

Diese Datei liegt bewusst außerhalb von `beispiel/`, damit sie nicht zur Menge gehört.
Jeder Satz ist an der erzeugten Seite oder an der Ergebnisdatei prüfbar.
Die Befund-Codes stehen in `src/core/finding-codes.ts`.

## Menge und Reihenfolge

1. Die Menge besteht aus genau sechs Notizen: der Einstiegsnotiz `beispiel.md`, zwei Kapiteln und drei Anhangsnotizen.
2. `kapitel/0 Entwurf.md` kommt auf der Seite nicht vor, weil der Name mit einer Null beginnt.
3. `leer/README.md` kommt auf der Seite nicht vor und ergibt den Hinweis `set.empty-file`.
4. Die Kapitel stehen in der Reihenfolge Grundlagen, Größen und Maße.
5. Die Anhangsnotizen stehen in der Reihenfolge Fußnoten, Eingebettete Notiz, Blöcke und Links, weil `reihenfolge: mention` der Nennung in der Einstiegsnotiz folgt.
6. Das Wurzelelement trägt `lang="de"`.

## Marken und Sprünge

7. Jede `id` kommt auf der ganzen Seite genau einmal vor.
8. Jeder Sprung `href="#…"` hat ein Ziel mit derselben `id`.
9. Die Fußnoten der drei Notizen mit Fußnoten (`01 Grundlagen`, `fussnoten`, die Einbettung in `eingebettet`) tragen verschiedene Marken, obwohl alle `[^1]` heißen.
10. Die Überschrift `Abschnitt` kommt in `01 Grundlagen` und in `eingebettet` vor und bekommt zwei verschiedene Marken; ebenso die doppelte Überschrift `Beispiel` in `02 Größen und Maße`.
11. Die Überschriftsebenen haben keine Lücke.
12. Kein `<a>` trägt `target`.

## Befunde

13. Der Link `[[ausserhalb/notiz|Notiz außerhalb]]` und der gleich gemeinte Markdown-Link ergeben zwei Warnungen `link.outside` und stehen als Text mit Pfad auf der Seite.
14. Der Link `[[Gibt es nicht]]` ergibt genau eine Warnung `link.unresolved`.
15. `![[fehlt.png]]` ergibt `media.not-embedded` und einen Hinweis `ht-media-missing` mit dem Dateinamen `fehlt.png`.
16. Das Bild im Netz wird nicht geladen und ergibt `media.remote-skipped`.
17. Das Feld `aufwand` fehlt in `02 Größen und Maße` und ergibt genau eine Warnung `field.missing`.
18. Das rohe `<iframe src="app://x">` kommt in der Seite nicht vor und ergibt einen Hinweis `guard.removed`.
19. Es gibt keinen Befund mit der Schwere `error`.

## Inhalt

20. Das Bild `bild.png` und die Vektorgrafik `bild.svg` stehen als `<img src="data:…">` in der Seite.
21. Die Datei `ton.mp3` und die Datei `film.mp4` ergeben in der ersten Fassung einen Hinweis `media.later` mit Dateinamen, später eingebettete Medien.
22. Mermaid steht als `<svg>` in der Seite, der `dataview`-Block als `<pre><code class="language-dataview">`.
23. Der Callout `[!note]-` ist ein `<details>` ohne `open`, `[!tip]+` ein `<details open>`, `[!info]` ein fester Kasten ohne `<details>`.
24. Die Kontrollkästchen der Aufgabenliste tragen `disabled`.
25. Die Tabelle in `blöcke` und die Übersicht des Bereichs Kapitel stehen je in einem Behälter `div.ht-table` mit `tabindex="0"`.
26. Der Bereich Anhang ist geöffnet, der Bereich Kapitel zu.
27. Die Einstiegsnotiz ist gefaltet: Jede ihrer Überschriften der Ebene 2 ist ein `<details>`.

## Bytes und Netz

28. Zwei Läufe mit gleicher Umgebung ergeben dieselbe SHA-256.
29. Die Seite enthält weder `app://` noch `capacitor://` noch `file://` noch einen Benutzerpfad.
30. Beim Öffnen der Datei entstehen keine Netzanfragen außer dem Dokument selbst.
31. Bei 390 Pixel Breite ist `document.documentElement.scrollWidth` höchstens 390.
