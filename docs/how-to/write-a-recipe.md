# Write a recipe

The recipe is a `hypertext:` block in the front matter of the entry note. Without it the plugin still builds a page from the folder; with it you decide the groups, the order, the overview tables and what folds. This page shows the common tasks. Every key is listed in the [recipe reference](../reference/recipe.md).

## Start from a block the plugin writes

1. Open the entry note.
2. Run **Insert export recipe** from the command palette.
3. Confirm. The plugin adds `version`, `lang` and one `folder` section per direct subfolder. The rest of the front matter stays as it is. If a `hypertext:` block already exists, nothing changes.

Nested YAML is easiest to edit in source mode (or Live Preview with the front matter shown as text), not in the Properties view.

## Name and order the groups

```yaml
hypertext:
  version: 1
  sections:
    - folder: Routes
      title: Hikes
    - folder: Gear
      order: name
```

The sections appear in the order you list them. A folder you do not list is not on the page, unless it sits inside a listed one. To leave a note out, give it `exclude: true` in its own front matter.

Inside a group the order is: the rule in `order`, otherwise the number prefix of the file name (a prefix of `0` leaves the note out), otherwise the name. `order: mention` follows the order in which the entry note mentions the notes; notes it does not mention follow in name order.

## Add an overview table and a summary line

```yaml
    - folder: Routes
      overview:
        - status
        - header: Plan
          template: "{status}, {distance_km} km"
      summary_line:
        - status
```

In the overview each note is one row; the first column is its title as a jump link. To name the value in the summary line, give the column a `label`:

```yaml
      summary_line:
        - field: status
          label: Status
        - header: Distance
          template: "{distance_km} km"
```

The line then reads `Status: planned · 12 km`. The names are the front matter fields your notes really carry. A field that some notes lack leaves an empty cell and gives one warning `field.missing` with the number of notes.

## Group by a field

```yaml
    - folder: Interviews
      group_by: [run, persona]
```

Notes with the same `run` form a group, and inside it the same `persona` forms a group. A note without a value lands in a group named "—" at the end.

If the grouping value is an ID such as `bernd-carpenter`, take the visible title from another field with `title_from`, one field per level:

```yaml
      group_by: [run, persona]
      title_from: [run_name, first_name]
```

Leave a level out by giving fewer fields than `group_by`. If the notes of a group disagree, the first value wins and the Findings tab shows `set.group-title`.

## Fold the entry note

```yaml
  fold:
    headings_from: 2
```

Every section of the entry note from heading level 2 on becomes a closed block. Add `linked_summary: true` and each block shows the summary line of the note its first link points to.

## Include folders from elsewhere

```yaml
  sources:
    - path: ../Archive/2025
      key: archive
      title: Archive 2025
  sections:
    - source: archive
```

A source is a folder outside the exported one. Its notes belong to the page and carry the source key in their anchors.

To put several sources under one heading, list their keys in one section:

```yaml
  sections:
    - sources: [run-a, run-b, run-c]
      title: Interviews
      group_by: [persona]
```

This gives Interviews > run > persona > note, and the navigation lists the runs below "Interviews".

## Check what you wrote

Export, then open the **Findings** tab. A misspelled key shows as `recipe.unknown-key` with the key's name; a value that does not fit stops the run with `recipe.invalid` and names the key. The page is only written when no finding is an error.
