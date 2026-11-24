# Findings reference

Every export ends with a list of findings, in the **Findings** tab of the panel and in the result file next to the page. Nothing is dropped silently: whatever the page lacks, a finding says so.

There are three severities. An **error** stops the run before the file is written. A **warning** means the page is written but something in it is not as the note says. A **notice** reports a decision or a size and needs no action. The codes are fixed; the message text of a finding follows the language of the Obsidian interface (English or German), in the panel and in the result file. Match on the code, not on the text.

The result file is `<note name>.export.json`. It holds `ok`, `path` (the page, or `null`), the counts `errors`, `warnings` and `infos`, and the list of findings with `severity`, `code`, `message` (in the language of the interface at the time of the run) and where known `notePath` and `recipePath`. It is written for every run except the target "Share". See [Export from the command line](../how-to/export-from-the-command-line.md).

## Recipe

| Code | Severity | Meaning |
|---|---|---|
| `recipe.unknown-key` | warning | A key the recipe does not know. It is ignored. The finding names the key. |
| `recipe.invalid` | error, or warning for an empty source | A value of the wrong type or outside the allowed values, a section without a target, two sources with one key, a path outside the vault. |
| `recipe.value-later` | error | A value that applies from a later version, for example `embeds: live`. |
| `recipe.version` | error | A `version` this plugin does not read. |
| `recipe.not-yet` | warning | A key that is read but not built yet: `grids`, a `theme` other than `default`, `output: package`, `remote_images: embed`. |

## Set of notes

| Code | Severity | Meaning |
|---|---|---|
| `set.empty` | error | There is nothing to export. |
| `set.empty-file` | notice | A note without a body was skipped. |
| `set.excluded` | notice | A note with `exclude` was skipped. |
| `set.no-group-value` | notice | A note has no value in a `group_by` field and sits in the group "—". |

## Drawing

| Code | Severity | Meaning |
|---|---|---|
| `render.hidden-window` | error | The Obsidian window is hidden or minimised. Obsidian slows its renderer down so much that the export cannot finish, so the run stops before drawing. Keep the window visible while an export runs. |
| `render.timeout` | warning | Drawing a note was not finished in time; the note may be incomplete. |
| `render.placeholder` | warning | A block still showed a placeholder (for example "Loading") when the time was up. |
| `render.placeholder-lost` | warning | A code block was lost while drawing and is missing from the page. |
| `render.failed` | warning | A renderer reported an error. |
| `render.mermaid-missing` | warning | Some Mermaid diagrams were not drawn. |
| `render.metadata-not-ready` | warning | Obsidian had not indexed an embedded note after five seconds, so an embedded section of it may show the whole note. The note was drawn anyway; export again once Obsidian has finished indexing. |
| `prepare.frame-replaced` | notice | A raw frame (`<iframe>`, `<object>`, `<embed>`, `<webview>`) in the note text was replaced by a text such as `[iframe]` before drawing. It is not on the page. |
| `freeze.empty-block` | warning | A block stayed empty. |
| `freeze.canvas-failed`, `freeze.canvas-blank` | warning | A canvas could not be turned into an image, or was drawn empty. |
| `guard.removed` | notice, warning for SVG | The protection pass removed active content: a script, an event attribute, a `javascript:` target, a form, a frame. A rejected drawing is a warning because it is missing from the page. |
| `guard.reparse` | error, warning | The protection pass read the text of a note a second time and the content came out differently, the sign of a crafted note. It is a warning when the note stays on the page in the form a browser reads from it. It is an error, with the path of the note, when the content did not settle after three rounds: the note was not taken over, all of its content was removed, and no page is written. |
| `math.font-url` | notice | A maths font was not embedded; formulas use a fallback font. |

## Media and links

| Code | Severity | Meaning |
|---|---|---|
| `media.not-embedded` | warning | An image could not be embedded. The page shows the file name instead, never the old address. |
| `media.remote-skipped` | notice | An image with an address on the web was not loaded (`remote_images: skip`). |
| `media.later` | notice | Audio, video or another attachment is not embedded in this version. The page shows the file name. |
| `media.svg-rejected` | warning | A vector image was rejected by the check and is missing. |
| `link.outside` | warning | A link points to a note outside the set. It stays as text with the path. |
| `link.unresolved` | warning | A link target does not exist. It stays as text. |
| `link.scheme` | notice | A link with a scheme other than `http`, `https` or `mailto` stays as text. |
| `link.heading-missing`, `link.block` | notice | The heading or block of a link is not on the page; the link jumps to the note. |
| `embed.outside` | warning | An embedded note lies outside the set. It is included anyway. |
| `embed.missing` | warning, notice | An embed has no target, or was not loaded when drawing stopped. |
| `embed.missing-section` | warning | A section or block named in an embed does not exist; Obsidian embeds the whole note. |

## Anchors, fields, output

| Code | Severity | Meaning |
|---|---|---|
| `mark.duplicate` | error, warning, notice | An anchor appears twice on the page (an error), or a footnote or heading id was kept or replaced. |
| `mark.missing-target` | error, warning | A jump has no target on the page. |
| `field.missing` | warning | A field of an overview or summary line is missing or empty in some notes. |
| `field.attr-collision` | warning | Two fields give the same data attribute; only the first is set. |
| `heading.capped` | notice | A heading deeper than level 6 stays at level 6. |
| `final.forbidden` | error | The finished page contains an address that must never be in it (`app://`, `capacitor://`, `file://`) or the path of the vault. |
| `final.user-path` | warning | The page contains text that looks like a user folder (`/Users/`, `/home/`, `C:\Users`). It may be part of a note. |
| `final.guard` | error | The second protection pass still found active content in the finished page. Nothing is written. |
| `output.size` | notice | The size of the page. |
| `output.over-limit` | warning | The page is larger than `output_limit_mb`. |
| `output.write-failed` | error, warning | The page or the result file could not be written. |
| `export.failed` | error | The run failed with an unexpected error; the message names it. |
