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
property-search search examples/north-brisbane-under_800k.yaml
```

Both providers run by default. To run one provider:

```bash
property-search search examples/north-brisbane-under_800k.yaml --provider rea
property-search search examples/north-brisbane-under_800k.yaml --provider domain
```

For JSON output:

```bash
property-search search examples/north-brisbane-under_800k.yaml --json
```

Save REA page HTML, screenshots and captured JSON responses for diagnosis:

```bash
property-search search examples/north-brisbane-under_800k.yaml --provider rea --debug
```

## Local web UI

Run the lightweight local UI with a criteria file (the example is the default):

```bash
npm run ui -- examples/north-brisbane-under_800k.yaml
```

Then open `http://localhost:8080`. The server listens on `0.0.0.0` so Railway and other hosted environments can route to it; `PORT` overrides `8080` when set. The form loads that YAML definition, and the YAML editor is read-only until you click **Edit YAML**. Click **Save YAML** to validate and write direct YAML changes; the left form is then repopulated from the saved YAML. Form edits can be written back with **Save form as YAML**. When creating a definition, type the name without an extension (for example, `northside`); `.yaml` is added automatically. The UI lets you run **REA + Domain**, **REA only**, or **Domain only**. During a search, the progress bar and narrow three-line terminal show the current provider and Apify calls, while the previous results stay visible and durable in the definition's SQLite snapshot until a successful replacement completes. If every selected provider fails, the previous saved snapshot is retained. Use the saved-definition menu to browse YAML files in the same folder or create a new one. Each definition has its own SQLite snapshot table, so switching definitions restores its most recently saved search results. The UI supports every documented YAML criterion, including the expanded property-type aliases. Enable **Save REA diagnostics** before a run to save REA page HTML, screenshots and captured JSON responses under `.debug/`. Search errors appear in the page; provider-specific errors still allow results from the other provider.

## Railway deployment

The included `Dockerfile` is ready for Railway and installs Google Chrome for the REA provider. Create a Railway service from this repository, attach a persistent volume at `/data`, and set `APIFY_TOKEN` as a Railway variable. Railway sets `PORT`; the UI listens on `0.0.0.0:$PORT` (default `0.0.0.0:8080`) and checks `/healthz` before routing traffic. Railway uses `railway.toml` to build the Docker image.

The volume keeps the SQLite database, persistent Chrome profile, and YAML definitions across deployments. On first start, the application copies the bundled YAML examples into `/data/definitions`; subsequent UI-created definitions and searches stay there.
If one provider fails, results from the other provider are still returned with a provider warning.

### Run REA through your local Chrome worker

If Railway cannot complete the REA browser request, run the REA browser on your local machine and let Railway handle the UI, Domain search, filtering and storage. The worker polls Railway over HTTPS, so your local machine does not need an inbound port or a public IP.

This uses **one Railway service only**. Do not create a second Railway service for the worker: the existing UI service exposes the authenticated worker queue, and `npm run rea-worker` is the worker process that you run locally.

1. Create one long random token. Put the same token in the Railway service variables and use it when starting the local worker:

```bash
openssl rand -hex 32
```

2. Set these variables on Railway:

```dotenv
PROPERTY_SEARCH_REA_WORKER_URL=https://your-service.up.railway.app
PROPERTY_SEARCH_REA_WORKER_TOKEN=the-token-from-step-1
```

3. On your local machine, start the worker with the same URL and token. Keep this process running while using the Railway UI:

```bash
PROPERTY_SEARCH_REA_WORKER_URL=https://your-service.up.railway.app \
PROPERTY_SEARCH_REA_WORKER_TOKEN=the-token-from-step-1 \
PROPERTY_SEARCH_REA_WORKER_PROFILE=.property-search-profile \
npm run rea-worker
```

The worker uses the local Chrome installation in headless mode, so search pages do not open visibly. Set `PROPERTY_SEARCH_REA_WORKER_HEADED=1` only when you need to watch Chrome for troubleshooting. The Railway UI will show messages such as `REA: queued local Chrome job`, `REA worker: local Chrome started`, and the REA request URL in its progress log. Do not set `PROPERTY_SEARCH_REA_WORKER_URL` in the environment used by a local UI unless you want that UI to send its REA work to the worker; without it, local UI searches continue to use local Chrome directly.

Railway's `/data/...` paths are for the Railway service only. If they are present in your local `.env`, the worker automatically uses `.property-search-profile` instead. Set `PROPERTY_SEARCH_REA_WORKER_PROFILE` if you want a different local Chrome profile.

Worker settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PROPERTY_SEARCH_REA_WORKER_URL` | unset | Public HTTPS base URL of the Railway UI service. Enables remote REA execution in the Railway UI. |
| `PROPERTY_SEARCH_REA_WORKER_TOKEN` | unset | Shared bearer token required by the Railway worker endpoints. |
| `PROPERTY_SEARCH_REA_WORKER_POLL` | `2000` | Poll interval in milliseconds for worker jobs and status. |
| `PROPERTY_SEARCH_REA_WORKER_TIMEOUT` | `0` | Maximum time the Railway UI waits for a local REA job in milliseconds. `0` means no limit. |
| `PROPERTY_SEARCH_REA_WORKER_HTTP_TIMEOUT` | `60000` | Local worker HTTP request timeout. |
| `PROPERTY_SEARCH_REA_WORKER_PROFILE` | `.property-search-profile` | Local Chrome profile path. |
| `PROPERTY_SEARCH_REA_WORKER_HEADED` | unset | Set to `1` to show local Chrome; headless by default. |

If the UI reports `Local REA worker did not finish within 300000ms`, an old Railway variable is overriding the unlimited default. Delete `PROPERTY_SEARCH_REA_WORKER_TIMEOUT` from Railway or set it to `0`, then redeploy the service.

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

`locations` and `transaction_type` are required. The web form offers `buy`, `rent` and `auction`; YAML and CLI definitions also accept `sold`.

The Domain provider converts each location and filter into a Domain search URL, passes those URLs to the Apify actor, and normalizes the actor's output into the same model used by REA.

## Complete YAML configuration

The YAML reader supports mappings, indented lists, inline lists, scalar numbers, booleans and comments. Unknown keys are ignored, so use only the fields below.

| YAML path | Type | Meaning |
| --- | --- | --- |
| `locations` | list of strings | Required. One or more suburbs, regions or postcodes. Include state and postcode for reliable Domain searches, for example `Narangba QLD 4504`. |
| `transaction_type` | `buy`, `rent`, `auction`, `sold` | Required. Selects sale, rental, auction or sold listings. Rental prices are generally weekly. Auction searches use sale listings and keep only listings identified as auctions. |
| `include_surrounding_suburbs` | boolean | Include nearby suburbs where the provider supports it. Default: `false`. |
| `price.min` | number | Minimum price in AUD. |
| `price.max` | number | Maximum price in AUD. |
| `property.types` | list of strings | Restrict property types. See the supported list below. |
| `property.bedrooms_min` | number | Minimum bedrooms. |
| `property.bathrooms_min` | number | Minimum bathrooms. |
| `property.carspaces_min` | number | Minimum car spaces. |
| `property.land_min_m2` | number | Minimum land size in square metres. |
| `property.land_max_m2` | number | Maximum land size in square metres. |
| `property.established_only` | boolean | Exclude listings identified as new developments or off-the-plan. Default: `false`. |
| `preferences.land_min_m2` | number | Soft land-size preference in square metres. Listings below this value remain eligible but do not receive land preference points. |
| `keywords.any` | list of strings | Optional phrases searched case-insensitively in the title, description and feature text. |
| `exclude_keywords` | list of strings | Optional phrases that remove a listing when found in the title, description or feature text. |
| `strict_keyword_match` | boolean | If `true`, require at least one `keywords.any` match. Default: `false`. |
| `exclude_under_contract` | boolean | Remove listings marked under contract, under offer or sold subject to contract. Default: `false`. |
| `sort.by` | `newest`, `oldest`, `score` | Saved result display order. `newest` also asks providers for newest/date-updated results where supported. |

### `locations`

This is a required list. Each item is sent to both providers as a separate search location. Use the most specific form available:

```yaml
locations:
  - Narangba QLD 4504
  - Burpengary QLD 4505
  - Brisbane QLD
  - 4506
```

Including the suburb, state and postcode is recommended for Domain. The application does not geocode or expand a location itself.

### `transaction_type`

This required scalar accepts exactly:

| Value | Search |
| --- | --- |
| `buy` | Properties for sale |
| `rent` | Rental properties; price is normally weekly |
| `auction` | Active properties being sold by auction |
| `sold` | Sold-listing results where the provider supports them |

Example:

```yaml
transaction_type: buy
```

### `include_surrounding_suburbs`

Boolean, default `false`. When `true`, the provider asks for nearby suburbs where that provider supports the option. It does not calculate a radius or a travel distance.

```yaml
include_surrounding_suburbs: true
```

### `price`

Both values are optional numeric AUD amounts. Omit either bound for an open-ended range. For rent searches, the amount is normally a weekly rent.

```yaml
price:
  min: 500000
  max: 800000
```

Listings with no parseable price are excluded when a price bound is present because they cannot be proven to satisfy it. Price ranges such as `$750,000 - $800,000` are compared using their low and high values.

### `property`

All keys under `property` are optional:

```yaml
property:
  types: [house, townhouse]
  bedrooms_min: 3
  bathrooms_min: 2
  carspaces_min: 2
  land_min_m2: 600
  land_max_m2: 2000
  established_only: true
```

- `types` is a list; a listing must match one of the selected types.
- `bedrooms_min`, `bathrooms_min` and `carspaces_min` are inclusive minimums.
- `land_min_m2` and `land_max_m2` are inclusive square-metre bounds. A missing land-size value cannot satisfy `land_min_m2`; a missing value is not rejected by `land_max_m2`. `land_min_m2` is a hard filter.
- `established_only: true` removes listings identified as new developments or off-the-plan. It depends on the provider exposing that status.

### `preferences`

Preferences affect ranking only; they never remove a listing. Use this when you want to prefer larger lots without requiring them:

```yaml
preferences:
  land_min_m2: 600
```

`preferences.land_min_m2` awards the land points to listings at or above the target. Listings below the target remain in the results and receive no land preference points. If both `property.land_min_m2` and `preferences.land_min_m2` are set, the property value remains a hard filter and the preference value is used for land ranking points.

### Property types

Use one or more of these supported values in `property.types`:

- `house`
- `apartment`
- `townhouse`
- `villa`
- `land`
- `acreage`
- `semi detached`
- `retirement`
- `block of units`
- `studio`
- `duplex`
- `terrace`

The aliases `unit`, `flat`, `new apartments`, `rural`, `unitblock`, `retire` and `semidetached` are also accepted. `unit` and `flat` map to `apartment`; `acreage` and `rural` map to the same category; and `unitblock` maps to `block of units`. Keep values lower-case for consistent filtering across both providers.

### `keywords`, `exclude_keywords` and `strict_keyword_match`

Keywords are free text; there is no fixed keyword vocabulary. Matching is case-insensitive substring matching over the listing headline, description and extracted features.

Positive keywords:

```yaml
keywords:
  any:
    - side access
    - shed
    - caravan
    - dual living
    - granny flat
    - solar panels
    - air conditioning
```

Exclusions:

```yaml
exclude_keywords:
  - retirement
  - townhouse
  - under construction
```

`strict_keyword_match` is a boolean and defaults to `false`:

```yaml
strict_keyword_match: true
```

When strict matching is enabled, at least one `keywords.any` phrase must match. `exclude_keywords` is applied independently and always removes a listing when a phrase matches. If `keywords.any` is empty or omitted, strict matching has no effect.

### `exclude_under_contract`

Boolean, default `false`:

```yaml
exclude_under_contract: true
```

When enabled, listings whose provider status contains `under contract`, `under offer` or `sold subject` are removed.

### `sort`

The YAML `sort.by` value controls the saved result display order. The supported values are `newest`, `oldest` and `score`:

```yaml
sort:
  by: newest
```

`newest` requests newest/date-updated ordering from the providers where supported. `oldest` and `score` sort the saved SQLite snapshot after the search. If `sort` is omitted, `newest` is used. Values such as `price`, `price_asc`, `price_desc`, `suburb` or `distance` are not implemented and should not be used.

### Display sorting

The left form's **Sort** field sets the initial display order. The results panel also has a separate **Display order** control for changing the current view. Both read the saved result from SQLite and support:

- **Newest** — most recently first observed in the database first (`first_seen`).
- **Oldest** — earliest first observation in the database first (`first_seen`).
- **Highest score** — highest ranking score first.

Changing the results-panel display order does not run the providers again or change the YAML definition. Saving the left form or YAML editor stores the selected initial order in the definition.

### Minimal and complete files

The smallest valid file is:

```yaml
locations:
  - Narangba QLD 4504
transaction_type: buy
```

The complete example below includes every currently supported YAML section:

```yaml
locations:
  - Narangba QLD 4504
  - Burpengary QLD 4505

transaction_type: buy
include_surrounding_suburbs: false

price:
  min: 500000
  max: 800000

property:
  types:
    - house
    - townhouse
  bedrooms_min: 3
  bathrooms_min: 2
  carspaces_min: 2
  land_max_m2: 2000
  established_only: true

preferences:
  land_min_m2: 600

keywords:
  any:
    - side access
    - shed
    - dual living

exclude_keywords:
  - retirement
  - townhouse
strict_keyword_match: false
exclude_under_contract: true

sort:
  by: newest
```

There are currently no YAML fields for maximum bedrooms, maximum bathrooms, maximum car spaces, preferred minimum bedrooms, preferred minimum bathrooms, preferred minimum car spaces, preferred building size, building size filters, price-per-square-metre, school distance, travel time, or arbitrary distance/radius searches. Adding those keys to a file will not apply those filters or preferences.

## Ranking score

Filtering happens before ranking. A property must pass the configured price, type, bedroom, bathroom, hard land-size, keyword and contract filters before it is displayed. Soft preferences only affect the score.

The score only controls result order:

| Match | Points |
| --- | ---: |
| Meets the configured land ranking target (`preferences.land_min_m2`, or `property.land_min_m2` when no preference is set) | +20 |
| Land is at least 20% above the land ranking target | +10 |
| Bedrooms exceed the minimum | +10 |
| Car spaces exceed the minimum | +10 |
| First matching keyword | +10 |
| Each additional matching keyword | +5 |
| Same physical property found on both REA and Domain | +5 |

Matching a minimum exactly does not add bedroom or car-space points. A land ranking target is different: meeting it awards the +20 land points even when it is a soft preference. Bathrooms, price, property type and newest-listing order are filters or sort criteria, not score criteria. Therefore a property with exactly 3 bedrooms, 2 car spaces and 600 m², no keyword matches, and both provider sources scores 5 when no land target is configured, or 25 when 600 m² is configured as a land preference.

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
| `PROPERTY_SEARCH_USER_AGENT` | Chrome default | Optional REA browser user agent |

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
