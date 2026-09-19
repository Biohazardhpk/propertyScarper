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

Save REA page HTML, screenshots and captured JSON responses for diagnosis:

```bash
property-search search examples/north-brisbane-under-800k.yaml --provider rea --debug
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

## Complete YAML configuration

The YAML reader supports mappings, indented lists, inline lists, scalar numbers, booleans and comments. Unknown keys are ignored, so use only the fields below.

| YAML path | Type | Meaning |
| --- | --- | --- |
| `locations` | list of strings | Required. One or more suburbs, regions or postcodes. Include state and postcode for reliable Domain searches, for example `Narangba QLD 4504`. |
| `transaction_type` | `buy`, `rent`, `sold` | Required. Selects sale, rental or sold listings. Rental prices are generally weekly. |
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
| `sort.by` | `newest` | Sort by newest listing where supported. Missing or other values use the provider's default order. Sold REA searches use sold-date order. |

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

The only supported application sort value is `newest`:

```yaml
sort:
  by: newest
```

`newest` requests newest/date-updated ordering from the providers where supported. If `sort` is omitted, results use provider order. Values such as `price`, `price_asc`, `price_desc`, `suburb` or `distance` are not implemented and should not be used.

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

There are currently no YAML fields for maximum bedrooms, maximum bathrooms, maximum car spaces, preferred minimum bedrooms, preferred minimum bathrooms, preferred minimum car spaces, preferred building size, building size filters, auction-only searches, price-per-square-metre, school distance, travel time, or arbitrary distance/radius searches. Adding those keys to a file will not apply those filters or preferences.

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
