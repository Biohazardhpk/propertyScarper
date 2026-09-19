# Australia Property Search

Local CLI for searching realestate.com.au and Domain with one YAML file. Results are filtered, ranked, deduplicated, and stored in SQLite.

## Requirements

- Node.js 22.5+
- Google Chrome

No API token or `.env` file is required. The application uses Patchright with your locally installed Chrome.

## Install

```bash
npm install
npm test
npm link
property-search setup
```

`property-search setup` opens Chrome once to prepare the persistent REA browser profile.

Without `npm link`, use `node bin/property-search.js` instead of `property-search`.

## Run a search

A working example is included at [examples/north-brisbane-under-800k.yaml](examples/north-brisbane-under-800k.yaml):

```bash
property-search search examples/north-brisbane-under-800k.yaml
```

Options:

```bash
# JSON output
property-search search examples/north-brisbane-under-800k.yaml --json

# One provider only
property-search search examples/north-brisbane-under-800k.yaml --provider rea
property-search search examples/north-brisbane-under-800k.yaml --provider domain

# Save HTML, screenshots, and network diagnostics
property-search search examples/north-brisbane-under-800k.yaml --debug
```

Both providers run by default. If one fails, results from the other are still returned.

## Criteria file

```yaml
locations:
  - Narangba QLD 4504
  - Burpengary QLD 4505

transaction_type: buy

price:
  min: 500000
  max: 800000

property:
  types:
    - house
  bedrooms_min: 3
  bathrooms_min: 2
  carspaces_min: 2
  land_min_m2: 600
  land_max_m2: 2000
  established_only: true

keywords:
  any:
    - side access
    - shed

exclude_keywords:
  - retirement
  - townhouse

strict_keyword_match: false
exclude_under_contract: true

sort:
  by: newest
```

Required fields:

- `locations`: one or more locations
- `transaction_type`: `buy`, `rent`, or `sold`

`newest` is the supported sort option. Keyword matches normally improve ranking; set `strict_keyword_match: true` to require a match.

## Search history

Results are stored in `data/property-search.sqlite`. Repeating the same search can report new or removed properties, price and URL changes, and portal sources being added or removed.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PROPERTY_SEARCH_DB` | `data/property-search.sqlite` | Database path |
| `PROPERTY_SEARCH_PROFILE` | `.property-search-profile` | Chrome profile path |
| `PROPERTY_SEARCH_BROWSER_CHANNEL` | `chrome` | Installed browser channel |
| `PROPERTY_SEARCH_TIMEOUT` | `60000` | Navigation timeout in milliseconds |
| `PROPERTY_SEARCH_MAX_PAGES` | `10` | Page limit per location and provider |
| `PROPERTY_SEARCH_HEADED` | unset | Set to `1` to show Chrome |

Example:

```bash
PROPERTY_SEARCH_HEADED=1 property-search search examples/north-brisbane-under-800k.yaml
```

## Troubleshooting

- `BLOCKED`: run `property-search setup` again, or retry with `PROPERTY_SEARCH_HEADED=1`.
- `TIMEOUT`: increase `PROPERTY_SEARCH_TIMEOUT` or reduce `PROPERTY_SEARCH_MAX_PAGES`.
- `PARSING`: rerun with `--debug`; the portal structure may have changed.
- Profile already in use: close other searches or Chrome processes using `.property-search-profile`.

Debug files are saved under `.debug/<timestamp>/<provider>/<location>/page-<number>/`.

Domain may return HTTP 403 on some networks. This is reported as a provider failure rather than an empty successful result.

## Development

```bash
npm test
npm run check
```

Tests use local fixtures and do not contact live websites.

## References and licence

Implementation patterns were informed by:

- `ErrolMc/RealEstateMCP`: persistent Chrome, REA warm-up, URL construction, and hydration parsing.
- `callanjfox/realestate-scraping`: pagination, fixtures, and incremental synchronization.
- `muhashi/realestate.com.au` (CC0-1.0): criteria and normalization concepts.
- `RealEstateWebTools/property_web_scraper` (MIT): structured metadata mappings.

No source was copied from repositories without a licence. This project is released under the [MIT licence](LICENSE).
