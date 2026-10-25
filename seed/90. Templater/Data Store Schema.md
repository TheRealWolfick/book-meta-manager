---
title: Data Store Schema
type: config
---
# Data Store Schema
Single source of truth for the fields of every collection in the `80. Global Data Store` folder.

- **collections** — keyed by folder path relative to the data store root. Every folder is flat (no subfolders) so bases can target it with `file.folder ==`.
- **fields** — `[key, default]` in the order they are written. Adding a field here makes `applySchema` add it to new notes, and `Data Store Maintenance` add it (empty) to existing notes.
- **links** — which folder a link-valued field points at. Used for pick lists and the QA check for values that don't resolve to a note.
- **label** — the suffix used when a file name must be made unique, e.g. `Excellent (Rating)`.
- **characters** — fields for character sheets in each novel's `Characters` folder (used by World Builder). `generated` fields are written by the app from ledgers; edit those through ledger entries.
- **plans** — fields of each novel's plan notes (volumes in `Plan/Book Plan`, chapter plans in `Plan/Chapter Plans`, plots in `Plots`). Link targets starting with `@` are folders of the novel itself. Plan text lives in frontmatter (`plan`, `plot`) so bases can show it.

Edit the JSON below. Keep it valid JSON (double quotes, no trailing commas).

```json
{
 "root": "80. Global Data Store",
 "collections": {
  "Items": {
   "label": "Item",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "item"
    ],
    [
     "status",
     "stub"
    ],
    [
     "cat",
     []
    ],
    [
     "subcat",
     []
    ],
    [
     "topics",
     []
    ],
    [
     "genre",
     []
    ],
    [
     "tradition",
     []
    ],
    [
     "power-system",
     []
    ],
    [
     "energy-source",
     []
    ],
    [
     "heritage",
     []
    ],
    [
     "rarity",
     ""
    ],
    [
     "grade",
     ""
    ],
    [
     "tier",
     ""
    ],
    [
     "slot",
     []
    ],
    [
     "applies-to",
     []
    ],
    [
     "elements",
     []
    ],
    [
     "teaches",
     []
    ],
    [
     "recipe",
     ""
    ],
    [
     "system-item",
     false
    ],
    [
     "value",
     ""
    ],
    [
     "currency",
     ""
    ],
    [
     "uom",
     ""
    ],
    [
     "images",
     []
    ],
    [
     "novels",
     []
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "genre": "Taxonomy/Genres",
    "tradition": "Taxonomy/Traditions",
    "power-system": "Power Systems",
    "energy-source": "Taxonomy/Energy Sources",
    "heritage": "Races",
    "rarity": "Taxonomy/Rarity",
    "elements": "Taxonomy/Elements",
    "novels": "Taxonomy/Novels",
    "cat": "Taxonomy/Item Categories",
    "subcat": "Taxonomy/Item Categories",
    "topics": "Taxonomy/Topics",
    "teaches": "Abilities",
    "recipe": "Recipes",
    "grade": "Power Levels",
    "slot": "Taxonomy/Upgrade Slots",
    "applies-to": "Taxonomy/Item Categories"
   }
  },
  "Materials": {
   "label": "Material",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "material"
    ],
    [
     "status",
     "stub"
    ],
    [
     "cat",
     []
    ],
    [
     "genre",
     []
    ],
    [
     "tradition",
     []
    ],
    [
     "power-system",
     []
    ],
    [
     "energy-source",
     []
    ],
    [
     "heritage",
     []
    ],
    [
     "rarity",
     ""
    ],
    [
     "tier",
     ""
    ],
    [
     "elements",
     []
    ],
    [
     "density",
     ""
    ],
    [
     "usage",
     []
    ],
    [
     "sources",
     []
    ],
    [
     "images",
     []
    ],
    [
     "novels",
     []
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "genre": "Taxonomy/Genres",
    "tradition": "Taxonomy/Traditions",
    "power-system": "Power Systems",
    "energy-source": "Taxonomy/Energy Sources",
    "heritage": "Races",
    "rarity": "Taxonomy/Rarity",
    "elements": "Taxonomy/Elements",
    "novels": "Taxonomy/Novels",
    "cat": "Taxonomy/Material Categories",
    "sources": "Creatures"
   }
  },
  "Recipes": {
   "label": "Recipe",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "recipe"
    ],
    [
     "status",
     "stub"
    ],
    [
     "cat",
     []
    ],
    [
     "item",
     ""
    ],
    [
     "tier",
     ""
    ],
    [
     "components",
     []
    ],
    [
     "materials",
     []
    ],
    [
     "disciplines",
     []
    ],
    [
     "genre",
     []
    ],
    [
     "power-system",
     []
    ],
    [
     "rarity",
     ""
    ],
    [
     "images",
     []
    ],
    [
     "novels",
     []
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "genre": "Taxonomy/Genres",
    "power-system": "Power Systems",
    "rarity": "Taxonomy/Rarity",
    "novels": "Taxonomy/Novels",
    "cat": "Taxonomy/Recipe Categories",
    "item": "Items",
    "materials": "Materials",
    "components": "Items",
    "disciplines": "Taxonomy/Engineering Disciplines"
   }
  },
  "Abilities": {
   "label": "Ability",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "ability"
    ],
    [
     "status",
     "stub"
    ],
    [
     "cat",
     []
    ],
    [
     "subcat",
     []
    ],
    [
     "genre",
     []
    ],
    [
     "tradition",
     []
    ],
    [
     "power-system",
     []
    ],
    [
     "energy-source",
     []
    ],
    [
     "elements",
     []
    ],
    [
     "grade",
     ""
    ],
    [
     "parent-art",
     ""
    ],
    [
     "sub-arts",
     []
    ],
    [
     "classes",
     []
    ],
    [
     "requirements",
     []
    ],
    [
     "reagents",
     []
    ],
    [
     "images",
     []
    ],
    [
     "novels",
     []
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "genre": "Taxonomy/Genres",
    "tradition": "Taxonomy/Traditions",
    "power-system": "Power Systems",
    "energy-source": "Taxonomy/Energy Sources",
    "elements": "Taxonomy/Elements",
    "novels": "Taxonomy/Novels",
    "cat": "Taxonomy/Ability Categories",
    "subcat": "Taxonomy/Ability Categories",
    "grade": "Power Levels",
    "parent-art": "Abilities",
    "sub-arts": "Abilities",
    "classes": "Abilities"
   }
  },
  "Races": {
   "label": "Race",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "race"
    ],
    [
     "status",
     "stub"
    ],
    [
     "genre",
     []
    ],
    [
     "tradition",
     []
    ],
    [
     "parent-race",
     ""
    ],
    [
     "sapient",
     true
    ],
    [
     "lifespan",
     ""
    ],
    [
     "homeworld",
     ""
    ],
    [
     "power-system",
     []
    ],
    [
     "energy-source",
     []
    ],
    [
     "appearance",
     ""
    ],
    [
     "culture",
     ""
    ],
    [
     "traits",
     []
    ],
    [
     "images",
     []
    ],
    [
     "novels",
     []
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "genre": "Taxonomy/Genres",
    "tradition": "Taxonomy/Traditions",
    "power-system": "Power Systems",
    "energy-source": "Taxonomy/Energy Sources",
    "novels": "Taxonomy/Novels",
    "parent-race": "Races"
   }
  },
  "Creatures": {
   "label": "Creature",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "creature"
    ],
    [
     "status",
     "stub"
    ],
    [
     "cat",
     []
    ],
    [
     "subcat",
     []
    ],
    [
     "genre",
     []
    ],
    [
     "tradition",
     []
    ],
    [
     "power-system",
     []
    ],
    [
     "temperament",
     []
    ],
    [
     "intelligence",
     ""
    ],
    [
     "potential",
     ""
    ],
    [
     "potential-sub",
     ""
    ],
    [
     "habitat",
     []
    ],
    [
     "drops",
     []
    ],
    [
     "images",
     []
    ],
    [
     "novels",
     []
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "genre": "Taxonomy/Genres",
    "tradition": "Taxonomy/Traditions",
    "power-system": "Power Systems",
    "novels": "Taxonomy/Novels",
    "cat": "Taxonomy/Creature Categories",
    "subcat": "Taxonomy/Creature Categories",
    "potential": "Power Levels",
    "drops": "Materials"
   }
  },
  "Power Systems": {
   "label": "Power System",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "power-system"
    ],
    [
     "status",
     "stub"
    ],
    [
     "parent",
     ""
    ],
    [
     "genre",
     []
    ],
    [
     "tradition",
     []
    ],
    [
     "energy-source",
     []
    ],
    [
     "images",
     []
    ],
    [
     "novels",
     []
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "genre": "Taxonomy/Genres",
    "tradition": "Taxonomy/Traditions",
    "energy-source": "Taxonomy/Energy Sources",
    "novels": "Taxonomy/Novels",
    "parent": "Power Systems"
   }
  },
  "Power Levels": {
   "label": "Power Level",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "power-level"
    ],
    [
     "status",
     "stub"
    ],
    [
     "power-system",
     ""
    ],
    [
     "level-kind",
     "realm"
    ],
    [
     "class",
     0
    ],
    [
     "sub-levels",
     []
    ],
    [
     "images",
     []
    ],
    [
     "novels",
     []
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "power-system": "Power Systems",
    "novels": "Taxonomy/Novels"
   }
  },
  "Worlds": {
   "label": "World",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "world"
    ],
    [
     "status",
     "stub"
    ],
    [
     "genre",
     []
    ],
    [
     "power-system",
     []
    ],
    [
     "races",
     []
    ],
    [
     "images",
     []
    ],
    [
     "novels",
     []
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "genre": "Taxonomy/Genres",
    "power-system": "Power Systems",
    "novels": "Taxonomy/Novels",
    "races": "Races"
   }
  },
  "Locations": {
   "label": "Location",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "location"
    ],
    [
     "status",
     "stub"
    ],
    [
     "world",
     ""
    ],
    [
     "parent",
     ""
    ],
    [
     "scale",
     ""
    ],
    [
     "cat",
     []
    ],
    [
     "controlled-by",
     []
    ],
    [
     "population",
     ""
    ],
    [
     "size",
     ""
    ],
    [
     "climate",
     []
    ],
    [
     "images",
     []
    ],
    [
     "novels",
     []
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "novels": "Taxonomy/Novels",
    "world": "Worlds",
    "parent": "Locations",
    "scale": "Taxonomy/Location Scales",
    "cat": "Taxonomy/Location Types",
    "controlled-by": "Factions"
   }
  },
  "Factions": {
   "label": "Faction",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "faction"
    ],
    [
     "status",
     "stub"
    ],
    [
     "world",
     ""
    ],
    [
     "cat",
     []
    ],
    [
     "seat",
     ""
    ],
    [
     "territory",
     []
    ],
    [
     "members",
     []
    ],
    [
     "relations/friendly",
     []
    ],
    [
     "relations/neutral",
     []
    ],
    [
     "relations/hostile",
     []
    ],
    [
     "power-system",
     []
    ],
    [
     "images",
     []
    ],
    [
     "novels",
     []
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "power-system": "Power Systems",
    "novels": "Taxonomy/Novels",
    "world": "Worlds",
    "cat": "Taxonomy/Faction Types",
    "seat": "Locations",
    "territory": "Locations"
   }
  },
  "Taxonomy/Genres": {
   "label": "Genre",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "genre"
    ],
    [
     "facet",
     "Genres"
    ],
    [
     "parent",
     ""
    ],
    [
     "ordered",
     false
    ],
    [
     "class",
     ""
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "parent": "Taxonomy/Genres"
   }
  },
  "Taxonomy/Traditions": {
   "label": "Tradition",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "tradition"
    ],
    [
     "facet",
     "Traditions"
    ],
    [
     "parent",
     ""
    ],
    [
     "ordered",
     false
    ],
    [
     "class",
     ""
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "parent": "Taxonomy/Traditions"
   }
  },
  "Taxonomy/Energy Sources": {
   "label": "Energy Source",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "energy-source"
    ],
    [
     "facet",
     "Energy Sources"
    ],
    [
     "parent",
     ""
    ],
    [
     "ordered",
     false
    ],
    [
     "class",
     ""
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "parent": "Taxonomy/Energy Sources"
   }
  },
  "Taxonomy/Elements": {
   "label": "Element",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "element"
    ],
    [
     "facet",
     "Elements"
    ],
    [
     "parent",
     ""
    ],
    [
     "ordered",
     false
    ],
    [
     "class",
     ""
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "parent": "Taxonomy/Elements"
   }
  },
  "Taxonomy/Item Categories": {
   "label": "Item Category",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "item-category"
    ],
    [
     "facet",
     "Item Categories"
    ],
    [
     "parent",
     ""
    ],
    [
     "ordered",
     false
    ],
    [
     "class",
     ""
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "parent": "Taxonomy/Item Categories"
   }
  },
  "Taxonomy/Material Categories": {
   "label": "Material Category",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "material-category"
    ],
    [
     "facet",
     "Material Categories"
    ],
    [
     "parent",
     ""
    ],
    [
     "ordered",
     false
    ],
    [
     "class",
     ""
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "parent": "Taxonomy/Material Categories"
   }
  },
  "Taxonomy/Ability Categories": {
   "label": "Ability Category",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "ability-category"
    ],
    [
     "facet",
     "Ability Categories"
    ],
    [
     "parent",
     ""
    ],
    [
     "ordered",
     false
    ],
    [
     "class",
     ""
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "parent": "Taxonomy/Ability Categories"
   }
  },
  "Taxonomy/Creature Categories": {
   "label": "Creature Category",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "creature-category"
    ],
    [
     "facet",
     "Creature Categories"
    ],
    [
     "parent",
     ""
    ],
    [
     "ordered",
     false
    ],
    [
     "class",
     ""
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "parent": "Taxonomy/Creature Categories"
   }
  },
  "Taxonomy/Recipe Categories": {
   "label": "Recipe Category",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "recipe-category"
    ],
    [
     "facet",
     "Recipe Categories"
    ],
    [
     "parent",
     ""
    ],
    [
     "ordered",
     false
    ],
    [
     "class",
     ""
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "parent": "Taxonomy/Recipe Categories"
   }
  },
  "Taxonomy/Topics": {
   "label": "Topic",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "topic"
    ],
    [
     "facet",
     "Topics"
    ],
    [
     "parent",
     ""
    ],
    [
     "ordered",
     false
    ],
    [
     "class",
     ""
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "parent": "Taxonomy/Topics"
   }
  },
  "Taxonomy/Location Scales": {
   "label": "Location Scale",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "location-scale"
    ],
    [
     "facet",
     "Location Scales"
    ],
    [
     "parent",
     ""
    ],
    [
     "ordered",
     true
    ],
    [
     "class",
     ""
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "parent": "Taxonomy/Location Scales"
   }
  },
  "Taxonomy/Location Types": {
   "label": "Location Type",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "location-type"
    ],
    [
     "facet",
     "Location Types"
    ],
    [
     "parent",
     ""
    ],
    [
     "ordered",
     false
    ],
    [
     "class",
     ""
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "parent": "Taxonomy/Location Types"
   }
  },
  "Taxonomy/Faction Types": {
   "label": "Faction Type",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "faction-type"
    ],
    [
     "facet",
     "Faction Types"
    ],
    [
     "parent",
     ""
    ],
    [
     "ordered",
     false
    ],
    [
     "class",
     ""
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "parent": "Taxonomy/Faction Types"
   }
  },
  "Taxonomy/Rarity": {
   "label": "Rarity",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "rarity"
    ],
    [
     "facet",
     "Rarity"
    ],
    [
     "parent",
     ""
    ],
    [
     "ordered",
     true
    ],
    [
     "class",
     ""
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "parent": "Taxonomy/Rarity"
   }
  },
  "Taxonomy/Item Condition": {
   "label": "Item Condition",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "condition-rating"
    ],
    [
     "facet",
     "Item Condition"
    ],
    [
     "parent",
     ""
    ],
    [
     "ordered",
     true
    ],
    [
     "class",
     ""
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "parent": "Taxonomy/Item Condition"
   }
  },
  "Taxonomy/Rating": {
   "label": "Rating",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "rating"
    ],
    [
     "facet",
     "Rating"
    ],
    [
     "parent",
     ""
    ],
    [
     "ordered",
     true
    ],
    [
     "class",
     ""
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "parent": "Taxonomy/Rating"
   }
  },
  "Taxonomy/Attack Power": {
   "label": "Attack Power",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "attack-power"
    ],
    [
     "facet",
     "Attack Power"
    ],
    [
     "parent",
     ""
    ],
    [
     "ordered",
     true
    ],
    [
     "class",
     ""
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "parent": "Taxonomy/Attack Power"
   }
  },
  "Taxonomy/Units": {
   "label": "Unit",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "unit"
    ],
    [
     "facet",
     "Units"
    ],
    [
     "parent",
     ""
    ],
    [
     "ordered",
     false
    ],
    [
     "class",
     ""
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "parent": "Taxonomy/Units"
   }
  },
  "Taxonomy/Novels": {
   "label": "Novel",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "novel"
    ],
    [
     "facet",
     "Novels"
    ],
    [
     "folder",
     ""
    ],
    [
     "world",
     []
    ],
    [
     "genre",
     []
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "world": "Worlds",
    "genre": "Taxonomy/Genres"
   }
  },
  "Taxonomy/Upgrade Slots": {
   "label": "Upgrade Slot",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "upgrade-slot"
    ],
    [
     "facet",
     "Upgrade Slots"
    ],
    [
     "parent",
     ""
    ],
    [
     "ordered",
     false
    ],
    [
     "class",
     ""
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "parent": "Taxonomy/Upgrade Slots"
   }
  },
  "Taxonomy/Engineering Disciplines": {
   "label": "Engineering Discipline",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "aliases",
     []
    ],
    [
     "type",
     "engineering-discipline"
    ],
    [
     "facet",
     "Engineering Disciplines"
    ],
    [
     "parent",
     ""
    ],
    [
     "ordered",
     false
    ],
    [
     "class",
     ""
    ],
    [
     "description",
     ""
    ],
    [
     "created-date",
     ""
    ],
    [
     "tags",
     []
    ]
   ],
   "links": {
    "parent": "Taxonomy/Engineering Disciplines"
   }
  }
 },
 "characters": {
  "label": "Character",
  "fields": [
   [
    "name",
    ""
   ],
   [
    "aliases",
    []
   ],
   [
    "type",
    "character"
   ],
   [
    "novel",
    ""
   ],
   [
    "alive",
    true
   ],
   [
    "gender",
    ""
   ],
   [
    "race",
    ""
   ],
   [
    "member-of",
    []
   ],
   [
    "chapter-introduced",
    ""
   ],
   [
    "chapter-updated",
    ""
   ],
   [
    "age-introduced",
    ""
   ],
   [
    "age-current",
    ""
   ],
   [
    "height",
    ""
   ],
   [
    "weight",
    ""
   ],
   [
    "eye-color",
    ""
   ],
   [
    "hair-color",
    ""
   ],
   [
    "hair-style",
    ""
   ],
   [
    "facial-hair",
    ""
   ],
   [
    "attractiveness",
    ""
   ],
   [
    "personality",
    ""
   ],
   [
    "appearance",
    ""
   ],
   [
    "character/power-system",
    ""
   ],
   [
    "character/level",
    ""
   ],
   [
    "character/sub-level",
    ""
   ],
   [
    "character/talent",
    ""
   ],
   [
    "character/skills",
    []
   ],
   [
    "relations/friendly",
    []
   ],
   [
    "relations/neutral",
    []
   ],
   [
    "relations/hostile",
    []
   ],
   [
    "inventory",
    []
   ],
   [
    "images",
    []
   ],
   [
    "created-date",
    ""
   ]
  ],
  "links": {
   "race": "Races",
   "member-of": "Factions",
   "character/power-system": "Power Systems",
   "character/level": "Power Levels",
   "character/skills": "Abilities"
  },
  "generated": [
   "inventory"
  ]
 },
 "plans": {
  "volumes": {
   "label": "Volume",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "type",
     "volume"
    ],
    [
     "number",
     ""
    ],
    [
     "plot",
     ""
    ],
    [
     "subplots",
     []
    ],
    [
     "chapter-start",
     ""
    ],
    [
     "chapter-end",
     ""
    ],
    [
     "description",
     ""
    ],
    [
     "plan",
     ""
    ]
   ],
   "links": {
    "plot": "@plots",
    "subplots": "@plots"
   }
  },
  "chapters": {
   "label": "Chapter Plan",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "type",
     "chapter-plan"
    ],
    [
     "chapter",
     ""
    ],
    [
     "volume",
     ""
    ],
    [
     "plan",
     ""
    ]
   ],
   "links": {},
   "generated": [
    "volume"
   ]
  },
  "plots": {
   "label": "Plot",
   "fields": [
    [
     "title",
     ""
    ],
    [
     "type",
     "plot"
    ],
    [
     "rating",
     ""
    ],
    [
     "characters",
     []
    ],
    [
     "mood",
     ""
    ],
    [
     "soundtrack",
     []
    ],
    [
     "images",
     []
    ],
    [
     "plot",
     ""
    ]
   ],
   "links": {
    "rating": "Taxonomy/Rating",
    "characters": "@characters"
   }
  }
 }
}
```
