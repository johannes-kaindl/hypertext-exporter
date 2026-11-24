# Security and determinism

The page is made from your notes by the plugin. It is not written by a model, it loads nothing when opened, and the same notes in the same environment give the same bytes. This page explains why those claims hold and where they stop.

## What the page protects against

Text from a note must not become a program in the page. That includes notes written by a model or a crew. Three layers, each checkable on its own:

1. **Obsidian's renderer** removes scripts, event attributes and `javascript:` targets when it draws a note. This was measured, not promised: it is Obsidian's behaviour and can change.
2. **The plugin's protection pass** runs on the finished tree before it is written, and again on the page read back from the finished text. It removes scripts, event attributes, `javascript:` targets, frames (`<iframe>`, `<object>`, `<embed>`), forms and `<base>`, and every `url(` in a style that is not a `data:` address. What it removes is reported as `guard.removed`. If the second pass still finds something, nothing is written (`final.guard`).
3. **The content security policy of the page**: `default-src 'none'`, the one style block and the one script only by checksum, images only as `data:`, `base-uri 'none'`, `form-action 'none'`, no frames. Even if layers 1 and 2 failed, nothing loads and nothing runs except the page's own script.

The one script on the page is the search and the expand/collapse helper. Its checksum is in the policy; the page reads without it, and the search field stays hidden until the script shows it.

## What it does not protect against

- **Content that deceives.** A link to the web with misleading text is still a link.
- **A plugin that acts while a note is drawn.** The plugin lets Obsidian draw each note in your own Obsidian window. A Dataview block calculates, a raw `<iframe>` in a note would load. Raw frames are replaced by text before drawing in every setting, but another plugin's code blocks run unless you set `blocks`. `blocks: core` (the default) draws Mermaid and maths and keeps every other code block as quoted source; `none` keeps Mermaid as source too; `all` lets every plugin draw. A post-processor that a plugin registers for all rendered text always runs. If you export a folder from an unknown source, use `blocks: core` or `none`.
- **Someone who changes the finished file.**

## What the file reveals

The page contains every note of the set in full, folded ones included, and everything embedded in them. It contains no vault name, no user path and no front matter except the fields the recipe names. The finished text is checked for `app://`, `capacitor://`, `file://` and the vault's folder path; a hit stops the run (`final.forbidden`).

## Determinism

The promise: the same files in the same environment give the same page, byte for byte. The environment is the Obsidian version, the plugin version, the theme, and the plugins that draw something in the notes. The page carries a stamp of it in `<meta>` lines in the head: plugin version, Obsidian version and language, the theme with its checksum, and the switches `blocks`, `embeds` and `remote_images`. With `stamp: full` the enabled community plugins are listed too. There is no date in the stamp; if the environment changes, the file changes visibly there.

The page contains no time, no random value, no user path and no `app://` address. Order never depends on the file system and never on `localeCompare`: notes are ordered by the rules in the recipe, then the number prefix, then the name by code point. Anchors depend only on paths and texts. Footnote anchors replace the random ones Obsidian makes.

Where it stops: a plugin that draws a block can only be reported, not promised. A maths font that is not available is not embedded and formulas fall back to another font (`math.font-url`); that makes the page differ from one made where the font is. **Check HTML export** tells you whether an environment change moved the bytes.

## Where the file is written

The export changes no note. It writes one page and one result file to the destination, replacing an earlier file of the same name through a temporary file, so there is never half a file. The destination "Share" uses a hidden folder in the vault and deletes older files of the same kind there at the next export without asking; do not keep anything in it. The only place the plugin writes into a note is the command **Insert export recipe**, and only after you confirm.
