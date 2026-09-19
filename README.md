# Australia Property Search

Search realestate.com.au and Domain from one local command. REA uses local Chrome; Domain uses the `blackfalcondata/domain-com-au-scraper` actor on Apify.

Results are filtered, ranked, matched by address and stored in SQLite.

## Install

Requirements: Node.js 22.5 or newer, Google Chrome and an Apify account.

```bash
npm install
npm link
property-search setup
```

## Apify token

Copy your API token from Apify Console and add it to `.env`:

```dotenv
APIFY_TOKEN=your-token
```

The token is read locally and `.env` is ignored by Git. Domain searches run a third-party paid Apify actor and consume the account's usage or credits.

## Search

```bash
property-search search examples/north-brisbane-under-800k.yaml
```

Both providers run by default. To run one provider:

```bash
property-search search examples/north-brisbane-under-800k.yaml --provider rea
property-search search examples/north-brisbane-under-800k.yaml --provider domain
```

For JSON output:

```bash
property-search search examples/north-brisbane-under-800k.yaml --json
```

If one provider fails, results from the other provider are still returned with a provider warning.

## Criteria

```yaml
locations:
  - Narangba QLD 4504
  - Burpengary QLD 4505

transaction_type: buy
include_surrounding_suburbs: false

price:
  max: 800000

property:
  types:
    - house
  bedrooms_min: 3
  bathrooms_min: 2
  carspaces_min: 2
  land_min_m2: 600

keywords:
  any:
    - side access
    - shed

exclude_keywords:
  - retirement

strict_keyword_match: false
exclude_under_contract: true

sort:
  by: newest
```

`locations` and `transaction_type` are required. Transaction type may be `buy`, `rent` or `sold`.

The Domain provider converts each location and filter into a Domain search URL, passes those URLs to the Apify actor, and normalizes the actor's output into the same model used by REA.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `APIFY_TOKEN` | none | Required for Domain searches |
| `PROPERTY_SEARCH_DOMAIN_ACTOR` | `blackfalcondata/domain-com-au-scraper` | Apify actor ID |
| `PROPERTY_SEARCH_DOMAIN_MAX_RESULTS` | `200` | Maximum Domain results per run; controls usage |
| `PROPERTY_SEARCH_DOMAIN_DETAILS` | unset | Set to `1` for richer, slower Domain detail extraction |
| `PROPERTY_SEARCH_APIFY_TIMEOUT` | `300000` | Maximum Apify run wait in milliseconds |
| `PROPERTY_SEARCH_DB` | `data/property-search.sqlite` | SQLite database path |
| `PROPERTY_SEARCH_PROFILE` | `.property-search-profile` | REA Chrome profile path |
| `PROPERTY_SEARCH_TIMEOUT` | `60000` | REA navigation timeout |
| `PROPERTY_SEARCH_MAX_PAGES` | `10` | Maximum pages per provider |
| `PROPERTY_SEARCH_HEADED` | unset | Set to `1` to show REA Chrome |

## History

Search history is stored in `data/property-search.sqlite`. Provider identity uses `(source, source listing ID)`, so matching Domain and REA records remain separate.

The database tracks first and last seen times, price, URL, status and description changes, disappearance and relisting. Existing databases are migrated in place.

## Tests

```bash
npm test
npm run check
```

Tests normally use saved fixtures and mocked Apify responses. With `APIFY_TOKEN` configured, this runs a small live actor test capped at five results:

```bash
npm run test:domain
```

Licensed under the [MIT licence](LICENSE).
