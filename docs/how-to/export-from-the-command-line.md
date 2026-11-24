# Export from the command line

A script can start an export through the Obsidian command line and read the result. This is for builds that run without you: the page is made by the plugin, in your running Obsidian.

## Requirements

- Obsidian with the command line enabled, and the vault open.
- The Obsidian window must not be minimised or hidden while the export runs. A hidden window stops the run with the error `render.hidden-window`.

## The call

```bash
obsidian eval code="await app.plugins.plugins['hypertext-exporter'].api.exportAndWait('Trail Notes/Trail Notes.md')"
```

The argument is the vault path of the entry note. The call waits until the export has finished and writes the page and the result file exactly as the command **Export current note as HTML page** does, to the destination set in the settings. If the note has a `hypertext:` block, the set is its folder; otherwise it is the note alone.

Use `eval`, not `obsidian command id=…`: a command returns before it has finished, `eval` waits for the result.

## The answer

The call returns the text of the result file, one JSON object:

```json
{"ok":true,"path":"Trail Notes/Trail Notes.html","errors":0,"warnings":3,"infos":2,"findings":[{"severity":"warning","code":"link.outside","message":"…","notePath":"Trail Notes/Trail Notes.md"}]}
```

- `ok` is `true` only when the page was written and no finding is an error.
- `path` is the vault path of the page, or `null`.
- The exit code of `obsidian eval` is always 0, also when the export failed. A script must read `ok` from the answer.

The same text is in the file `<note name>.export.json` beside the page. With the destination "Share" there is no file in the vault, and no result file.

## Check a page against its notes

The command **Check HTML export** builds the page again and compares it byte for byte with the file at the destination. It reports "the same" or the first byte where they differ. This is how you find out that the environment (Obsidian version, plugin version, a plugin that draws blocks) has changed since the last export.
