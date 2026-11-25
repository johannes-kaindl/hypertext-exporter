# Recipe reference

The recipe is the `hypertext:` block in the front matter of the entry note. It is the only place that decides what the page looks like. A folder without a recipe still gives a valid page, with the default values below. How to write one: [Write a recipe](../how-to/write-a-recipe.md).

Keys are English; every key also has a German alias. Case, `_` and `-` do not matter (`group_by`, `groupBy` and `Gruppen` are read the same). An unknown key is a warning (`recipe.unknown-key`), never a stop; a wrong value of a known key is an error and no page is written (`recipe.invalid`).

## Top level

| Key (alias) | Values | Default | State in this version |
|---|---|---|---|
| `version` | `1` | `1` | Another number is an error (`recipe.version`). |
| `title` (`titel`) | text | title of the entry note | Works. |
| `lang` (`sprache`) | `en`, `de` | `en` | Works. Sets the language of the texts the page itself writes (search, skip link, notices about media). It never follows the Obsidian language. |
| `sources` (`quellen`) | list of folders | none | Works. Folders outside the exported folder that belong to the set. |
| `sections` (`bereiche`) | list of sections | one group per subfolder in name order, one section per loose note, all closed | Works. |
| `fields` (`felder`) | `title`, `order`, `exclude` | the fixed names below | Works. |
| `fold` (`aufklappen`) | `headings_from`, `linked_summary` | no folding, `false` | Works. |
| `blocks` (`bloecke`) | `none`, `core`, `all` | `core` | Works. See [Security and determinism](../explanation/security-and-determinism.md). |
| `remote_images` (`fernbilder`) | `skip`, `embed` | `skip` | `skip` works. `embed` is accepted and reported as not yet built (`recipe.not-yet`); the image is still skipped. |
| `stamp` (`stempel`) | `minimal`, `full` | `minimal` | Works. `full` also lists the enabled community plugins with their version in the head of the page. |
| `output` (`ausgabe`) | `auto`, `file`, `package` | `auto` | One HTML file is always written. `package` is reported as not yet built. |
| `output_limit_mb` | number above 0 | `20` | Above this size the run adds a warning (`output.over-limit`); it still writes the file. |
| `embeds` (`einbettungen`) | `static` | `static` | `live` is an error with the sentence that it applies from a later version (`recipe.value-later`). |
| `theme` (`thema`) | text | `default` | Only `default` exists. Any other name is reported as not yet built; the default theme is used. |
| `grids` (`raster`) | map | none | Accepted, checked, and reported as not yet built. |

Keys marked "not yet built" give one warning each, `recipe.not-yet`, naming the key. Nothing is silently ignored.

## sections

Each entry names exactly one of `folder` (`ordner`), `note` (`datei`), `source` (`quelle`) or `sources` (`quellen`). `folder` and `note` are paths relative to the exported folder (the folder of the entry note); `source` is the key of an entry in `sources`; `sources` is a list of such keys and makes one group over several sources (see below). A folder or note that is not listed in `sections` is not on the page. A note that two sections would both take stays in the first and gives a warning (`recipe.invalid`).

| Key (alias) | Meaning |
|---|---|
| `title` (`titel`) | Title of the group. Default: the folder name without its number prefix. |
| `order` (`reihenfolge`) | `name` (default), `mention` (order of first mention in the entry note, the rest after), `field:<name>`, or any other text, which is read as a field name. |
| `title_from` (`titel_aus`) | List of fields, one per level of `group_by`: the groups of that level take their title from this field of their notes instead of the grouping value. Order and anchors stay with the grouping value. If the notes of a group disagree, the first value in the group's order wins and the run gives a warning `set.group-title` at the first note that differs; if none has a value, the group keeps the grouping value and gets a notice `set.group-title`. More fields than levels give a warning (`recipe.invalid`). |
| `group_by` (`gruppen`) | List of fields. Notes with the same value of the first field form a group, then the next field groups inside it. The word `folder` (`ordner`) stands for the folder of the note. A note without a value goes to a group named "—" at the end and gets a notice `set.no-group-value`. |
| `overview` (`uebersicht`) | List of columns for a table with one row per note. The first column is the title as a jump link. |
| `summary_line` (`zusatzzeile`) | List of columns shown as one line below the title of each note, joined by ` · `. A column object may carry `label` (`beschriftung`): the cell then reads `label: value`; an empty cell is left out together with its label. `label` exists only here, in `overview` the column has its `header`. |
| `open` (`offen`) | `true` opens the group when the page loads. Default: closed. |

### A group over several sources

```yaml
  sources:
    - path: ../../runs/run-a/interviews
      key: run-a
    - path: ../../runs/run-b/interviews
      key: run-b
  sections:
    - sources: [run-a, run-b]
      title: Interviews
      group_by: [persona]
      title_from: [first_name]
```

The page shows one group "Interviews", inside it one group per source in the order of the list (titled with the source's `title`, otherwise the folder name), inside each source the groups of `group_by`. `title` is required here. `order`, `group_by` and `title_from` apply inside every source; `title`, `open`, `overview` and `summary_line` belong to the outer group, and the summary line applies to every note below it. The navigation lists the outer group and, indented below it, its sources. A key that is not under `sources` is an error; a source that an earlier section already shows is skipped with a warning. Sources not named by any section still follow at the end, as before.

A column is either a field name (a dot reads nested fields: `models.a.count`), or an object with `header` (`ueberschrift`) and exactly one of `field` (`feld`) or `template` (`vorlage`). A template is text with field names in curly braces, for example `"{status}, {distance_km} km"`. A template column needs a `header`. A missing field leaves the cell empty and is reported once per field with the number of notes (`field.missing`). Field values are always written as text, never read as HTML or Markdown.

## sources

Each entry is a path (a string), or an object with `path` (`pfad`, required), `key` (`schluessel`) and `title` (`titel`). Paths are relative to the folder of the entry note and may use `..` up to the vault root. Without `key` the key is the last part of the path, written as a slug. Two sources with the same key are an error. The order of the list is the order of the sources on the page.

## fields

Maps the three field names the plugin itself reads. `fields: { title: name }` means: in this folder the title is in the field `name`. The mapped name is tried first, then the fixed names.

| Key (alias) | Fixed names read when nothing is mapped |
|---|---|
| `title` (`titel`) | `title`, `titel` |
| `order` (`reihenfolge`) | `order`, `reihenfolge` |
| `exclude` (`ausschliessen`) | `exclude`, `ausschliessen` |

A note whose `exclude` field is `true`, `1`, `yes` or `ja` (any case, as text or as a value) is left out and gets a notice `set.excluded`. The title of a note is, in this order: the title field, the first level 1 heading, the file name without its number prefix.

## fold

| Key (alias) | Meaning |
|---|---|
| `headings_from` (`ueberschrift_ab`) | Whole number 1 to 6. From this heading level on, each section of the entry note becomes a closed `<details>`. Without it the entry note is not folded. |
| `linked_summary` (`zusatzzeile_aus_link`) | `true` gives a foldable section of the entry note the summary line of the note its first link points to. |

Callouts with a `-` or `+` after the type are folded or open on the page whatever this setting says.

## Example

```yaml
hypertext:
  version: 1
  lang: en
  title: Trail Notes
  sections:
    - folder: Routes
      overview:
        - status
        - header: Plan
          template: "{status}, {distance_km} km"
      summary_line:
        - status
    - folder: Gear
      open: true
  fold:
    headings_from: 2
```

The command **Insert export recipe** writes a starting block for you: `version`, `lang`, and one `folder` section per direct subfolder.
