# Books Meta Viewer

A small local web app for the Obsidian vault at `~/Documents/Obsidian/books`. It browses and edits the shared worldbuilding data in `80. Global Data Store`, and manages each novel's characters through chapter-based ledgers (inventory, journal, stats, relationships), copying entries as callouts to paste into chapters.

All data stays in the vault as markdown. The app has no database: it reads the notes, watches them for changes, and writes back with the same frontmatter conventions the vault's Templater scripts use.

## Run

```sh
npm install
npm start                      # http://127.0.0.1:4321
node server.js --vault /path/to/vault --port 4321 --host 127.0.0.1
```

`BOOKS_VAULT` and `PORT` environment variables work too. It listens on localhost only by default.

## What it does

- **Data store**: every collection with filters built from its link fields, table or card view, search, an entry page with typed fields, rendered body, backlinks, and an image drop zone (drag, paste or click).
- **Blueprints**: recursive build tree, total bill of materials for N units, parts that have no blueprint, required engineering disciplines, max tier, and a where-used tree.
- **Create and edit** any data store note from the schema in `90. Templater/Data Store Schema.md`, with type-ahead link pickers and inline creation of new category values.
- **Novels**: characters, chapters, ledger owners. Per owner: a chapter slider showing holdings or values at any chapter, a diff between two chapters, warnings for negative stock.
- **Entry editor**: add/remove/move/transfer lines, items from the data store or misc text, create the data note for an item while adding it, a linked entry in another ledger (e.g. a journal entry and its reward), live callout preview with the inventory before and after.
- **Callouts**: ⧉ Copy on every entry, Save & copy, copy a whole chapter. Templates are per ledger type, overridable per novel in `config.md`, editable on the Callouts page.
- **Chapter tracking**: callouts include a hidden `%% event: [[…]] %%` marker; entries show "in chapter text" once pasted.
- **Quality checks**: ledger problems, misc items (with "Create entry & relink"), unresolved links, name collisions, Untitled notes, unreadable frontmatter.

## Test

```sh
npm test
```

Copies the vault to a temporary folder, starts the server against the copy, renders every route in jsdom and creates an entry through the editor. The real vault is never written.

## systemd (user service)

See `CLAUDE.md` → "Running as a service" (unit file: `books-meta-viewer.service`).
