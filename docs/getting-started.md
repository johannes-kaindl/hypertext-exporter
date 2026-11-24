# Getting started

This walks you from the install to your first page: a folder of three notes, exported as one HTML file you can send to anyone. It takes about five minutes and needs nothing but Obsidian and a browser.

## 1. Install

*Settings* → *Community plugins* → *Browse* → search for **Hypertext Exporter** → *Install* → *Enable*. Until the plugin is listed there, see the [README](https://github.com/johannes-kaindl/hypertext-exporter/blob/main/README.md#install) for the manual and BRAT routes.

## 2. Write a few notes

Create a folder `Trail Notes` with three notes in it:

- `Trail Notes` — the entry note. Its name equals the folder name, so the plugin picks it as the start of the page. Write a sentence or two and add a link to the next note: `See the [[Lake loop]].`
- `Lake loop` — a few lines of text.
- `Ridge walk` — a few lines of text, and a second-level heading (`## Weather`) with a paragraph below it.

The notes stay plain Markdown. Nothing in them is specific to the plugin yet.

## 3. Add a recipe

Open `Trail Notes` and run **Insert export recipe** from the command palette. Confirm the dialog. The plugin adds a `hypertext:` block to the front matter of the entry note:

```yaml
hypertext:
  version: 1
  lang: en
```

That block is the recipe. These default values are enough for a first page. It is also what tells the plugin that this note stands for its folder.

## 4. Export

Run **Export current note as HTML page**. The plugin draws each note in your Obsidian window, so keep the window visible while it works. When it is done, a notice says **Page saved: Trail Notes/Trail Notes.html**, and the **Findings** tab of the Hypertext Exporter panel opens.

The panel lists what happened. A first export shows one notice, the size of the page. Next to the page lies `Trail Notes.export.json`, a short result file a script can read.

## 5. Open the page

Run **Open HTML export**. The page opens in your default browser. You should see a list of contents at the top, a search field, the entry note open, and the other notes as closed blocks. Click a block to open it. Type a word from one of your notes into the search field: blocks without it disappear, the others open, and the word is highlighted. `Escape` clears the search and puts everything back as it was.

Send the single `.html` file to someone else: it needs nothing besides itself and loads nothing from the web.

## Where next

- Group, order and summarise the notes: [Write a recipe](how-to/write-a-recipe.md).
- Every key of the recipe: [Recipe reference](reference/recipe.md).
- Change where the page is saved under *Settings* → *Hypertext Exporter* → **Save the page to**.
- Something went differently? See [Troubleshooting](troubleshooting.md).
