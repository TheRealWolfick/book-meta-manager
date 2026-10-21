# Books Meta Viewer — context for future work

Local web app (Node + Preact, no build step) for a novelist's Obsidian vault. It browses and edits a shared worldbuilding database, and manages characters through chapter-based ledgers whose entries are copied into chapters as Obsidian callouts. Built 2026-10-21.

The user writes several novels in one vault and uses Templater, Dataview and Obsidian Bases. They want structured data they can review in Obsidian, but with richer views and editing than Bases offer. Keep it lightweight: few dependencies, no database, the markdown files are the only source of truth.

## Vault

Default path `~/Documents/Obsidian/books` (override with `--vault` or `BOOKS_VAULT`). It is a git repo backed up by obsidian-git. The app never touches `.obsidian/`, `.git/` or `.trash/`.

```
1. <Novel>/ … 19. <Novel>/   novels: "<number>. <Name>" (number < 20)
  config.md            novel settings in frontmatter (see below)
  Chapters/            chapter notes; number from frontmatter `chapter` or leading digits of the file name
  Characters/          character sheets, flat: <Name>.md
  Ledgers/             <Owner> - <Ledger Type>.md
  Plan/, Plots/, Supporting Docs/, *.base
80. Global Data Store/ shared data (flat collection folders, see below)
  _Attachments/<Collection>/   uploaded images
90. Templater/
  Data Store Schema.md fields per collection + character sheet fields (JSON block). Single source of truth.
  Ledger Types.md      shared ledger type definitions and callout templates (frontmatter)
  Scripts/, Templates/ Templater user scripts that share the same conventions
99. Resources/
```


### Data store conventions (do not break these)

- **Each collection is one flat folder** (`Items`, `Materials`, `Recipes`, `Abilities`, `Races`, `Creatures`, `Power Systems`, `Power Levels`, `Worlds`, `Locations`, `Factions`, and `Taxonomy/<Facet>`). Obsidian Bases target folders with `file.folder ==`, and rows added from a base are created in that folder, so collections never get subfolders. Sub-categories are properties.
- **Category values are links to taxonomy notes**: `cat: ["[[artifact]]"]`, `genre: ["[[Steampunk]]"]`. A new category means a new note in `Taxonomy/<Facet>/`. Taxonomy notes can have `parent` for hierarchy and `ordered`/`class` for ranked lists (Rarity, Item Condition, Rating, Attack Power, Location Scales, Upgrade Slots).
- **Note names are unique across the whole vault, case-insensitively** (Obsidian resolves `[[links]]` by name). Disambiguate as `Name (Label)`, then `Name (Label 2)`. `title` holds the display name. `write.js uniqueName` and the Templater `dataStoreMaintenance.js` implement the same rule.
- **Field order and defaults** come from `90. Templater/Data Store Schema.md` (`collections[folder].fields`, `.links` = which folder a link field points at, `.label`). `characters` defines sheet fields; `characters.generated` lists fields the app writes (currently `inventory`).
- **Locations** store only `parent` + `scale` (no fixed realm/region columns); paths are computed. Factions use `seat`/`territory`; Locations use `controlled-by`.
- **Blueprints** live in `Recipes/` named `<item> (Blueprint)`. Frontmatter `item: "[[X]]"`, `components`, `materials`, `disciplines`, `tier`. The body holds Dataview inline fields the Templater crafting scripts read:
  ```
  component:: [[Copper Coil]]
  count:: 2
  material:: [[brass]]
  quantity:: 200
  unit:: g
  ```
  The item links back with `recipe: "[[X (Blueprint)]]"`. Blueprints are hierarchical (components are items with their own blueprints).
- **Images**: `images:` frontmatter list of plain links (`"[[Note 1.png]]"`, not embeds) plus an embed under a `## Images` heading in the body.

### Novel config (`<novel>/config.md` frontmatter)

```yaml
type: config
blueprints: true            # used by Templater createBlueprint
contains-system: false
draft-chapter-from: 900     # optional; chapters >= this are drafts (e.g. 999.md) and don't count as "latest"
characters-folder: Characters   # optional overrides
chapters-folder: Chapters
ledgers-folder: Ledgers
ledger-types:               # optional: add types or override parts of shared ones
  Journal:
    default-callout: maven
    callouts:
      maven: |-
        [!journal] \_\_\_\_'s Journal
        {{body}}
        {{eventLink}}
```

Novel-specific settings for this app go in this frontmatter (user's instruction).

## Ledgers

One file per owner per ledger type: `<novel>/Ledgers/<Owner> - <Type>.md`. Owners are any note (characters, but also e.g. a train). Frontmatter: `type: ledger`, `ledger-type`, `owner: "[[…]]"`, `novel: "[[…]]"`.

```markdown
# Chapter 13
## 13.2 Looted the cultist
callout:: grouped
ref:: emvhxvxx8ai0          # shared by linked entries in other ledgers
id:: emvhxvxx8ai0           # stable entry id (written last)
- [action:: add] [item:: [[Aquanox Sword Art]]] [qty:: 1]
- [action:: add] [item:: strange bone flute] [qty:: 1]            # misc item: plain text, no data note
- [action:: transfer-out] [item:: [[steel sword]]] [qty:: 1] [to:: [[Sample Character]]] [ref:: …-3]
- [action:: move] [item:: [[steel]]] [qty:: 250] [unit:: g] [store:: inventory] [to-store:: Apt 412]
Free text (log ledgers) follows the fields until the next heading.
```

- `# Chapter N` headings are regenerated on save; `## N.S Title` starts an entry. `S` is a sequence number unique **across all ledgers of the novel** for that chapter, so entries order correctly on the chapter page.
- Entry fields are `key:: value` lines before any body text. Line fields are `[k:: v]` brackets (values may contain `[[links]]`; `ledger.js parseBracketFields` handles nesting).
- Untouched entries are written back byte-for-byte (`raw`); only edited entries are re-serialised.
- Behaviours (code in `lib/ledger.js`; types are config in `Ledger Types.md`):
  - `stock` (Inventory): actions add, remove, move, transfer-out, transfer-in. Stacks keyed by store + item (note path or misc text) + unit + condition. g/kg/t are normalised to grams. `foldStock` replays to a chapter (`mode: end|start`), `diffStock` compares two chapters, and negative stock produces warnings.
  - `state` (Stats, Relationships): `- [set:: field] [value:: v]`, optional `[with:: [[X]]]`. Latest values are written to the character sheet; `with` lines named `relation` become `relations/<value>` lists.
  - `log` (Journal): ordered entries with body text.
- **Transfers**: saving a transfer-out writes a mirrored entry (`mirror-of:: <id>`, `transfer-in` lines with `from::`) in the receiver's ledger. Re-saving or deleting replaces the mirrors. Mirrors are not edited directly.
- **Sheet sync** (`novels.syncSheet`): after saves, a character's `inventory` (e.g. `2× [[Item]]`, `250g [[steel]] @ Apt 412`) and state values are patched into the sheet frontmatter, only when they changed. There's also a "Sync sheets" button per novel.

### Callouts

- Templates live under `ledger-types.<Type>.callouts.<variant>` in `90. Templater/Ledger Types.md`, overridable per novel in `config.md`. Lookup order: novel variant → novel default → shared variant → shared default. An entry picks a variant with `callout:: name`, else `default-callout`.
- Logic-less mustache subset (`lib/template.js`): `{{var}}`, `{{#list}}…{{/list}}`, `{{^list}}…{{/list}}`. A section tag alone on its line removes that line. Templates are written without `> `; `asCallout` prefixes every line.
- Template data (`novels.entryView`): `ownerName`, `chapter`, `title`, `body`, `eventLink`, entry fields; groups `added`, `removed`, `transferredIn`, `transferredOut`, `moved`, `gained`, `lost`, `set`, `lines`, `items`/`materials` (`[{lines}]`). Per line: `item`, `itemName`, `qtyText` (5x, 2.30kg), `plural`, `haveHas`, `condition`, `destination`, `source`, `toName`, `fromName`, `note`, `setField`, `setValue`, `withName`.
- `{{eventLink}}` renders `%% event: [[<Ledger file>#<N.S Title>]] %%`. `novels.placedEntries` scans chapter notes for these markers, giving the "in chapter text" / "not in text yet" badges.

## Code

```
server.js            http server (node:http), routes, static files, SSE live updates, /files/ (images, PDFs only)
lib/vault.js         index of all notes: frontmatter, links, name/alias resolution like Obsidian, backlinks, fs.watch
lib/write.js         atomicWrite (tmp file + rename), patchNote (yaml Document keeps key order and unknown keys,
                     mtime conflict -> 409), createNote, uniqueName, sanitizeName
lib/datastore.js     schema, collection index, entry pages, create, image attachments, QA, promote misc item
lib/blueprints.js    recipe parsing, build tree + bill of materials, where-used
lib/novels.js        novels, chapters, characters, ledger types merge, compute, callouts, saveEntry (mirrors,
                     linked entries), deleteEntry, syncSheet, createCharacter
lib/ledger.js        ledger parse/serialise, foldStock / diffStock / foldState, qty formatting
lib/template.js      mustache subset + callout prefixing
lib/render.js        markdown -> HTML (marked) with wikilinks, image embeds, callouts, inline fields, %% comments
public/              index.html (import map), app.js (all views, Preact + htm), style.css (light/dark)
test/run.sh, test/ui-smoke.mjs       npm test: vault copy + jsdom route render + create-entry flow
```

Dependencies: `yaml`, `marked`, `preact`, `htm` (served from node_modules at `/vendor/*`), dev: `jsdom`. Versions are pinned exactly.

### API

```
GET  /api/index                         data store notes (fm, no bodies), schema, counts, novels
GET  /api/note?path=                    entry page: fm, html, resolved links, backlinks, images,
                                        blueprint tree, whereUsed, heldBy
GET  /api/blueprint?item=&count=        build tree + bill for N units
GET  /api/qa
POST /api/render {markdown}
POST /api/note {collection, name, fm, body}         create (unique name)
PATCH /api/note {path, set, unset, body, baseMtime} edit any note (also novel config.md)
POST /api/images?path=&filename=  (raw body)        attach image
GET  /api/novel?folder=                 config, ledger types, chapters, characters, ledgers, stores, setFields
GET  /api/owner?novel=&owner=&at=&compare=&mode=    ledgers of an owner + computed state at a chapter
GET  /api/chapter?novel=&n=             entries of a chapter across ledgers, placed status, copyAll
GET  /api/callout?ledger=&key=&linked=1
POST /api/ledger/entry {novel, owner, type, entry:{chapter,title,fields,lines,body}, replaceKey,
                        baseMtime, createNotes:[{collection,name,fm}], linked:[{type, entry}]}
POST /api/ledger/preview  (same body)    callout + holdings before/after + new warnings, no write
DELETE /api/ledger/entry?ledger=&key=
POST /api/character {novel, name, fm}
POST /api/sync-sheets?novel=
POST /api/promote-misc {novel, item, collection, fm}  create a data note and relink matching misc lines
GET  /api/events                         SSE {version, paths} on every vault change
```

Non-GET requests must send `x-requested-with: books-meta-viewer` (blocks cross-site form posts). The server binds 127.0.0.1 by default and has no auth; don't expose it without adding a token.

### Front end

`public/app.js`: hash router (`#/c/<collection>`, `#/note/<path>`, `#/edit/<path>`, `#/new/<collection>`, `#/newchar/<novel>`, `#/novel/<folder>`, `#/owner/<folder>/<owner>`, `#/chapter/<folder>/<n>`, `#/entry/<folder>?owner&type&ledger&key&chapter`, `#/callouts/<folder>`, `#/qa`). `useApi(url)` refetches whenever the SSE version changes. Forms hold local state initialised once. `localStorage` holds only conveniences (view mode, novel filter, taxonomy toggle, group-by, column widths and hidden columns), wrapped in try/catch.

- Note pages are always editable (`FieldsEditor`): edits are kept as overrides of the fetched frontmatter, only changed keys are PATCHed on "Save changes" (Ctrl+S). `#/edit/<path>` is an alias of `#/note/<path>`; `NoteForm` only creates notes.
- Side drawer: a click on a `#/note/` link inside any `[data-drawer]` element (collection tables and cards, the drawer itself) opens it in the right-hand drawer instead of navigating. `data-page` opts a link out; ctrl/cmd-click still navigates. The drawer keeps a back/forward stack; back on the first page, clicking the backdrop, Escape or any route change closes it. Unsaved edits ask before being discarded (`markDirty`/`confirmDiscard`, scoped "page" or "drawer").
- Collection view: facet values that would leave no rows are greyed out (counts ignore the facet's own selection, values within a facet are OR-ed). A "Group by" bar (a one-row table, a button above each column; fields without a column go in the last cell) splits the rows into one table per group (click again to ungroup); list values put a row in every matching group; ranked taxonomies sort by `class`. Group choice is stored per collection in localStorage.
- `ColumnTables`: all group tables share one `<colgroup>` of widths (`table-layout: fixed`), measured from the first table's natural layout. Drag a header's right edge to resize (double-click resets), hold a header to collapse the column to a thin bordered strip (click or hold to restore). Resized widths (`colWidths:<collection>`) and hidden columns (`colHidden:<collection>`) are saved in localStorage; the last column fills the rest. One `.coltables` container scrolls all tables horizontally together.
- Animations: CSS keyframes for the drawer and page changes, `useFlip()` (Web Animations API) for rows moving on filter/sort/group changes. All honour `prefers-reduced-motion`.

## Working on this project

- **Never write to the real vault while testing.** `npm test` copies it to a temp dir. For manual API tests, copy the vault the same way (`tar --exclude=./.git --exclude=./.obsidian`) and run `node server.js --vault <copy> --port 4398`.
- Don't kill servers with `pkill -f` patterns that also match your own shell command line. Track PIDs.
- Write all frontmatter through `patchNote`/`createNote` (yaml Document, `nullStr: ""`). Never regenerate a whole note's frontmatter from a parsed object, which would drop formatting and unknown keys.
- Keep the vault conventions above in sync with the Templater scripts in `90. Templater/Scripts` (`dataStore.js`, `applySchema.js`, `dataStoreMaintenance.js`, `createNovel.js`, `createItem.js`, `createBlueprint.js`, `craftItem.js`, `dismantleItem.js`). Templater's `createNovel` creates `Characters/`, `Ledgers/` and copies bases from `90. Templater/Templates/Novel Scaffold/`.
- Code style: ES modules, 4-space indent, double quotes, small focused comments, no framework on the server.

## Open items / ideas

- Crafting and dismantling as ledger entries (consume a blueprint's components and materials at a chapter, add the output). This would replace Templater `craftItem.js`/`dismantleItem.js`.
- Status-window callouts (a character's stats and inventory at chapter N) as a `status` callout section.
- Renaming and deleting notes is left to Obsidian (it updates links); the app only creates and edits.
- The callout preview uses the app's own callout CSS, not the vault's CSS snippets (they style the whole page).

## Running as a service

`books-meta-viewer.service` in this folder is a systemd user unit:

```sh
mkdir -p ~/.config/systemd/user
cp books-meta-viewer.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now books-meta-viewer
journalctl --user -u books-meta-viewer -f      # logs
```

Restart it after changing server code: `systemctl --user restart books-meta-viewer`. Front-end files are read on each request, so a browser reload is enough for those.
