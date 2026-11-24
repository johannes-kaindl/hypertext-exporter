# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### Added

- Export of a folder of notes, or of a single note, as one self-contained HTML page: commands **Export folder as HTML page…** and **Export current note as HTML page**, entries in the file menu of folders and notes, and the Hypertext Exporter panel with the tabs **Export** and **Findings**.
- Export recipe: the `hypertext:` block in the front matter of the entry note names the sections, their order, groups, overview tables, summary lines, sources outside the folder and the title; German aliases for every key; **Insert export recipe** writes a starting block. Unknown keys are warnings, wrong values stop the run, keys that are not built yet are answered with a warning.
- Notes become foldable blocks; callouts with `-` or `+` fold as written; sections of the entry note fold from a chosen heading level.
- Stable anchors and jumps between the notes of the set; links to notes outside the set, links without a target and other schemes stay as text and are listed.
- Overview tables and summary lines built from front matter fields; ordering by name, number prefix, first mention, or a field; grouping by one or two fields.
- Images, including SVG, are embedded in the page; images with a web address are not loaded. Audio, video and other attachments show their file name.
- Search and fold helpers in the page: blocks without the words are hidden, blocks with them open and the words are highlighted, **Expand all** and **Collapse all**, the print view opens everything.
- Findings list with fixed codes after every export, and a result file `<note name>.export.json` beside the page.
- **Check HTML export** rebuilds the page and compares it byte for byte; **Open HTML export** opens it.
- Command line: `obsidian eval` with `app.plugins.plugins['hypertext-exporter'].api.exportAndWait('<path>')` runs an export and returns the result file.
- Settings: where to save the page (beside the entry note, a folder in the vault, or the share sheet) and the export folder.
- Light and dark colours that follow the reader's device; a layout that needs no sideways scrolling at 390 pixels.
- Documentation: README in English and German, getting started, recipe and findings reference, security and determinism, troubleshooting.

### Security

- Text from a note does not become a program in the page: Obsidian's renderer, then a protection pass of the plugin (scripts, event attributes, `javascript:` targets, frames, forms, `<base>`), then a content security policy with checksums, `default-src 'none'`.
- The protection pass reads the tree of each note again until it is stable (code-kit 0.89.0): a note whose content does not settle after three rounds is not taken over and stops the run with `guard.reparse` and the path of the note; links in the body, `<meta http-equiv>`, `name` on images, fixed or sticky positions and popover attributes are removed.
- A second protection pass runs on the finished page read back from its text; if it still finds active content, nothing is written.
- The finished page is checked for `app://`, `capacitor://`, `file://` and the path of the vault; a hit stops the run.
- Raw frames in note text are replaced before drawing; the recipe switch `blocks` decides which code blocks other plugins may draw.
