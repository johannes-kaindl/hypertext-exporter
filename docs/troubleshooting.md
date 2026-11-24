# Troubleshooting

Each entry starts with what you see, then the cause and what to do. The notices and the text of every finding are in the language of the Obsidian interface, English or German. The code in the Findings tab is what to look up in the [findings reference](reference/findings.md).

## The export is not available yet.

**Cause:** the command ran before the plugin had finished loading, or the plugin failed to load.

**Fix:** wait a moment and run the command again. If it stays, switch the plugin off and on under *Settings* → *Community plugins*.

## The export stopped with N error(s). No page was written. See the findings.

**Cause:** at least one finding is an error. The page is only written when there is none.

**Fix:** open the **Findings** tab and read the entries marked **Error**. The most common are a wrong value in the recipe (`recipe.invalid`, the entry names the key), a version the plugin does not read (`recipe.version`) and an empty folder (`set.empty`). The [findings reference](reference/findings.md) lists every code.

## The Obsidian window is hidden

The Findings tab shows the error `render.hidden-window`, and no page is written.

**Cause:** the Obsidian window was minimised or covered completely. Obsidian then slows its renderer down so far that the export would never finish, so the plugin stops before it starts.

**Fix:** bring the window forward and keep it visible until the notice **Page saved** appears. Do not minimise it during an export that runs from a script either.

## Export cancelled. No page was written.

**Cause:** you pressed **Cancel** in the progress notice.

**Fix:** nothing is wrong; an earlier page at the same place is left untouched. Run the export again.

## The export failed: …

**Cause:** an unexpected error. The text after the colon names it, and the Findings tab shows it as `export.failed`.

**Fix:** run the export once more. If it repeats, report it with the text, your Obsidian version and the plugin version.

## This note already has a hypertext block. Nothing was changed.

**Cause:** you ran **Insert export recipe** on a note that already carries a `hypertext:` block.

**Fix:** edit the block by hand. See the [recipe reference](reference/recipe.md).

## The export recipe could not be inserted.

> The export recipe could not be inserted. The front matter of this note is not in a form the plugin can extend safely.

**Cause:** the front matter of the note is not valid YAML, or has a shape the plugin does not dare to extend.

**Fix:** correct the front matter (or add the `hypertext:` block by hand), then run the command again. The plugin never rewrites a note it cannot read safely.

## No export yet. Export the note or its folder first.

**Cause:** **Check HTML export** or **Open HTML export** found no page at the destination of the settings. The page may have been moved, or the destination setting changed since the export.

**Fix:** export again, or set the destination back to where the page lies.

## The export differs from a fresh run, starting at byte N.

**Cause:** the page on disk is not what the plugin builds today. Either a note changed, or the environment did: the Obsidian version, the plugin version, or a plugin that draws blocks. The stamp in the `<head>` of both pages shows the versions.

**Fix:** if you want the page to match today's notes, export again. Why bytes can move: [Security and determinism](explanation/security-and-determinism.md#determinism).

## Nothing to compare: the target Share leaves no file in the vault.

**Cause:** with the destination **Share sheet**, the plugin keeps no page in the vault that a check could compare.

**Fix:** use **Beside the entry note** or **Folder in the vault** if you want to check a page.

## Files in the share folder disappeared

**Cause:** the destination "Share sheet" writes to a hidden folder in the vault and deletes older files of the same kind there at the next export, without asking.

**Fix:** never keep a page there. Choose **Beside the entry note** or **Folder in the vault** for pages you keep.

## A video, audio file or PDF is not in the page

The Findings tab shows `media.later`, and the page shows the file name.

**Cause:** this version embeds images (PNG, JPEG, GIF, WebP, AVIF and SVG). Audio, video and other attachments are not embedded yet.

**Fix:** none yet; the file name stays on the page so the reader knows what was there.

## An image with a web address is missing

The Findings tab shows `media.remote-skipped`.

**Cause:** the page loads nothing from the web, so a remote image is not fetched and stays a link with a note.

**Fix:** save the image into the vault and embed it from there.

## A link became plain text

The Findings tab shows `link.outside` or `link.unresolved`.

**Cause:** the link points to a note outside the exported set, or to a note that does not exist. The page keeps the text with the target in brackets.

**Fix:** move the note into the folder (or add its folder as a `source` in the recipe), or correct the link.

## Formulas look slightly different

The Findings tab shows `math.font-url`.

**Cause:** the maths fonts are not embedded in this version, so formulas use a fallback font.

**Fix:** none; the formulas are correct, only their letter shapes differ.

## The search field is missing

**Cause:** the field is shown by the page's script. In a viewer that does not run scripts (some mail previews and file previews), the page is still readable, but without search.

**Fix:** open the file in a browser.

## Getting help

Still stuck? [Open an issue](https://github.com/johannes-kaindl/hypertext-exporter/issues) with your Obsidian version, the plugin version (*Settings* → *Community plugins*) and what you expected to happen.
