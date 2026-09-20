import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { parseCriteriaYaml } from '../src/core/criteria.js';
import { normalizeAddress, deduplicate } from '../src/core/deduplication.js';
import { enrichAndFilter } from '../src/core/filtering.js';
import { rank } from '../src/core/ranking.js';
import { mapReaListing, parseReaHtml } from '../src/providers/rea/parser.js';
import { mapDomainListing, parseDomainHtml, parseDomainListingHtml } from '../src/providers/domain/parser.js';
import { reaSearchUrl } from '../src/providers/rea/search.js';
import { domainSearchUrl } from '../src/providers/domain/search.js';
import { ApifyClient, DomainProvider } from '../src/providers/domain/provider.js';
import { RemoteReaProvider } from '../src/providers/rea/remote.js';
import { SQLiteStore } from '../src/persistence/database.js';
import { SearchService } from '../src/core/search.js';
import { criteriaToForm, criteriaToYaml, formToCriteria } from '../src/web/criteria-yaml.js';

const fixture = (path) => readFile(`test/fixtures/${path}`, 'utf8');
const loadListings = async () => {
  const rea = mapReaListing(JSON.parse(await fixture('rea/listings.json'))[0]);
  const domain = mapDomainListing(JSON.parse(await fixture('domain/listing.json')));
  return [rea, domain];
};

test('parses documented YAML criteria without changing REA behaviour', async () => {
  const criteria = parseCriteriaYaml(`locations:
  - Narangba QLD 4504
transaction_type: buy
price:
  max: 900000
property:
  types: [house]
  bedrooms_min: 3
  carspaces_min: 2
  land_min_m2: 600
  established_only: true
keywords:
  any: [side access, caravan, camper, trailer, shed, dual access]
exclude_keywords: [retirement, townhouse, apartment]
exclude_under_contract: true
sort:
  by: newest`);
  assert.equal(criteria.maxPrice, 900000);
  assert.equal(criteria.minLandAreaM2, 600);
  assert.deepEqual(criteria.propertyTypes, ['house']);
  assert.deepEqual(criteria.keywords.slice(0, 2), ['side access', 'caravan']);
});

test('parses and ranks the soft land preference without filtering smaller lots', () => {
  const criteria = parseCriteriaYaml('locations:\n  - Narangba QLD 4504\ntransaction_type: buy\npreferences:\n  land_min_m2: 600\n');
  assert.equal(criteria.preferredMinLandAreaM2, 600);
  const properties = rank([
    { landAreaM2: 500, listings: [{ source: 'rea', matchedKeywords: [] }] },
    { landAreaM2: 600, listings: [{ source: 'rea', matchedKeywords: [] }] },
  ], criteria);
  assert.deepEqual(properties.map((property) => property.landAreaM2), [600, 500]);
  assert.equal(properties[0].score, 20);
  assert.equal(properties[1].score, 0);
});

test('web form criteria round-trip through the existing YAML parser', () => {
  const form = { locations: 'Narangba QLD 4504\nPetrie QLD 4502', transactionType: 'buy', minPrice: '500000', maxPrice: '900000', propertyTypes: 'house\nunit', minBedrooms: '3', minBathrooms: '2', minCarspaces: '1', minLandAreaM2: '500', maxLandAreaM2: '1200', preferredMinLandAreaM2: '650', establishedOnly: true, includeSurroundingSuburbs: true, keywords: 'shed\nside access', excludeKeywords: 'retirement', strictKeywordMatch: true, excludeUnderContract: true, sort: 'newest' };
  const criteria = parseCriteriaYaml(criteriaToYaml(formToCriteria(form)));
  assert.deepEqual(criteriaToForm(criteria), { ...form, minPrice: 500000, maxPrice: 900000, minBedrooms: 3, minBathrooms: 2, minCarspaces: 1, minLandAreaM2: 500, maxLandAreaM2: 1200, preferredMinLandAreaM2: 650 });
});

test('builds REA and Domain public search URLs from common criteria', () => {
  const criteria = { transactionType: 'buy', minPrice: 500000, maxPrice: 900000, minBedrooms: 3, minBathrooms: 2, minCarspaces: 2, minLandAreaM2: 600, maxLandAreaM2: 2000, propertyTypes: ['house'], includeSurroundingSuburbs: true, excludeUnderContract: true, sort: 'newest' };
  const rea = reaSearchUrl(criteria, 'Narangba QLD 4504', 2);
  assert.match(rea, /property-house-with-3-bedrooms-2-bathrooms-2-car-space-between-500000-900000-size-600-2000-in-narangba\+qld\+4504\/list-2/);
  assert.match(rea, /misc=ex-under-contract/);
  const domain = new URL(domainSearchUrl(criteria, 'Narangba QLD 4504', 2));
  assert.equal(domain.pathname, '/sale/narangba-qld-4504/');
  assert.equal(domain.searchParams.get('page'), '2');
  assert.equal(domain.searchParams.get('price'), '500000-900000');
  assert.equal(domain.searchParams.get('bedrooms'), '3-any');
  assert.equal(domain.searchParams.get('landsize'), '600-2000');
  assert.equal(domain.searchParams.get('ptype'), 'house');
  assert.equal(domain.searchParams.get('ssubs'), '1');
});

test('builds Domain sale, rent and sold routes dynamically', () => {
  assert.match(domainSearchUrl({ transactionType: 'buy' }, 'Petrie QLD 4502'), /\/sale\/petrie-qld-4502\//);
  assert.match(domainSearchUrl({ transactionType: 'rent' }, 'Petrie QLD 4502'), /\/rent\/petrie-qld-4502\//);
  assert.match(domainSearchUrl({ transactionType: 'sold' }, 'Petrie QLD 4502'), /\/sold-listings\/petrie-qld-4502\//);
});

test('parses REA Argonaut hydration including exact and surrounding results', async () => {
  const raw = JSON.parse(await fixture('rea/listings.json'))[0];
  const payload = { buySearch: { results: { exact: { items: [{ listing: raw }] }, surrounding: { items: [{ listing: { ...raw, id: 'rea-2' } }] }, pagination: { maxPageNumberAvailable: 4 }, totalResultsCount: 55 } } };
  const cache = JSON.stringify({ x: { data: JSON.stringify(payload) } });
  const html = `<html><script>window.ArgonautExchange=${JSON.stringify({ app: { urqlClientCache: cache } })};</script></html>`;
  const parsed = parseReaHtml(html);
  assert.equal(parsed.listings.length, 2);
  assert.equal(parsed.listings[1].isSurrounding, true);
  assert.equal(parsed.totalPages, 4);
});

test('parses Domain search hydration and pagination fixture', async () => {
  const parsed = parseDomainHtml(await fixture('domain/search.html'));
  assert.equal(parsed.listings.length, 2);
  assert.equal(parsed.totalPages, 2);
  assert.equal(parsed.totalResults, 22);
  assert.equal(parsed.listings[0].bedrooms, 4);
  assert.equal(parsed.listings[0].source, 'domain');
});

test('parses a Domain listing page from JSON-LD and tolerates missing fields', async () => {
  const listing = parseDomainListingHtml(await fixture('domain/listing.html'), 'https://www.domain.com.au/12-smith-street-narangba-qld-4504-2013958589');
  assert.equal(listing.sourceListingId, '2013958589');
  assert.equal(listing.address.suburb, 'Narangba');
  assert.equal(listing.price.numeric, 785000);
  assert.equal(listing.bedrooms, 4);
  assert.equal(listing.carspaces, undefined);
  assert.deepEqual(listing.imageUrls, ['https://images.example/house.jpg']);
});

test('Domain provider sends filtered public URLs to the configured Apify actor and normalizes output', async () => {
  const actorListing = JSON.parse(await fixture('domain/apify-listing.json'));
  let input;
  const client = { async run(value) { input = value; return [actorListing]; } };
  const provider = new DomainProvider({ client, maxPages: 2, maxResults: 25, includeDetails: true });
  const listings = await provider.search({ locations: ['Narangba QLD 4504'], transactionType: 'buy', minPrice: 500000, maxPrice: 800000, minBedrooms: 3, minBathrooms: 2, minCarspaces: 1, propertyTypes: ['house'] });
  assert.equal(input.saleType, 'buy');
  assert.equal(input.maxPages, 2);
  assert.equal(input.maxResults, 25);
  assert.equal(input.includeDetails, true);
  assert.equal(input.startUrls.length, 1);
  assert.match(input.startUrls[0], /domain\.com\.au\/sale\/narangba-qld-4504/);
  assert.match(input.startUrls[0], /price=500000-800000/);
  assert.equal(listings[0].sourceListingId, '2020248471');
  assert.equal(listings[0].price.numeric, 795000);
  assert.equal(listings[0].landAreaM2, 650);
  assert.equal(listings[0].agent.agency, 'Example Realty');
});

test('Apify client starts, polls and reads an actor dataset using bearer auth', async () => {
  const requests = [];
  const fakeFetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/runs')) return new Response(JSON.stringify({ data: { id: 'run-1', status: 'RUNNING' } }), { status: 201 });
    if (url.includes('/actor-runs/')) return new Response(JSON.stringify({ data: { id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'dataset-1' } }), { status: 200 });
    return new Response(JSON.stringify([{ listingId: 'domain-1' }]), { status: 200 });
  };
  const client = new ApifyClient({ token: 'test-token', fetch: fakeFetch, pollMs: 0 });
  const items = await client.run({ query: ['Narangba QLD 4504'] });
  assert.equal(items.length, 1);
  assert.match(requests[0].url, /acts\/blackfalcondata~domain-com-au-scraper\/runs$/);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-token');
  assert.match(requests[2].url, /datasets\/dataset-1\/items/);
});

test('normalizes, filters and matches Domain and REA copies without losing sources', async () => {
  assert.equal(normalizeAddress({ street: '12 Smith Street', suburb: 'Narangba', state: 'QLD', postcode: '4504' }), normalizeAddress({ street: '12 Smith St', suburb: 'Narangba', state: 'QLD', postcode: '4504' }));
  const listings = await loadListings();
  const criteria = { minLandAreaM2: 600, minBedrooms: 3, minCarspaces: 2, maxPrice: 900000, propertyTypes: ['house'], keywords: ['side access', 'shed'] };
  const result = rank(deduplicate(enrichAndFilter(listings, criteria)), criteria);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].listings.map((listing) => listing.source).sort(), ['domain', 'rea']);
  assert.deepEqual(result[0].matchedKeywords, ['side access', 'shed']);
});

test('strict keywords and unknown bounded values are filtered locally', () => {
  const base = { source: 'rea', sourceListingId: 'x', address: {}, propertyType: 'house', bedrooms: 3 };
  assert.equal(enrichAndFilter([base], { maxPrice: 10, keywords: ['shed'] }).length, 0);
  assert.equal(enrichAndFilter([{ ...base, price: { numeric: 5 }, description: 'plain' }], { strictKeywordMatch: true, keywords: ['shed'] }).length, 0);
});

test('SQLite preserves composite provider identity and tracks listing changes', async () => {
  const path = `/tmp/property-search-${crypto.randomUUID()}.sqlite`;
  const store = new SQLiteStore(path);
  const [rea, originalDomain] = await loadListings();
  const domain = { ...originalDomain, sourceListingId: rea.sourceListingId };
  const criteria = { locations: ['Narangba'], transactionType: 'buy' };
  const first = store.beginSearch(criteria);
  store.persistResults(first, rank(deduplicate([rea, domain]), criteria));
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM listings WHERE source_listing_id=?').get(rea.sourceListingId).count, 2);

  const second = store.beginSearch(criteria);
  const changed = { ...rea, sourceUrl: `${rea.sourceUrl}?new`, price: { display: '$760,000', numeric: 760000 }, listingStatus: 'under offer', description: `${rea.description ?? ''} Updated.` };
  const changes = store.persistResults(second, rank(deduplicate([changed, domain]), criteria));
  assert.equal(changes.priceChanged.length, 1);
  assert.equal(changes.urlChanged.length, 1);
  assert.equal(changes.statusChanged.length, 1);
  assert.equal(changes.descriptionChanged.length, 1);

  const third = store.beginSearch(criteria);
  const removed = store.persistResults(third, []);
  assert.equal(removed.removed.length, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM listings WHERE active=0').get().count, 2);

  const fourth = store.beginSearch(criteria);
  const relisted = store.persistResults(fourth, rank(deduplicate([changed]), criteria));
  assert.equal(relisted.relisted.length, 1);
  assert.ok(store.db.prepare('SELECT COUNT(*) AS count FROM listing_history').get().count >= 6);
  store.close();
});

test('SQLite migrates an existing database without losing rows', () => {
  const path = `/tmp/property-search-legacy-${crypto.randomUUID()}.sqlite`;
  const legacy = new DatabaseSync(path);
  legacy.exec("CREATE TABLE searches(id INTEGER PRIMARY KEY, criteria_json TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE properties(property_key TEXT PRIMARY KEY, address_json TEXT); CREATE TABLE listings(source TEXT, source_listing_id TEXT, source_url TEXT, property_key TEXT, payload_json TEXT, last_seen TEXT, PRIMARY KEY(source,source_listing_id)); INSERT INTO listings VALUES ('rea','existing','https://example.test','key','{}','2025-01-01'); CREATE TABLE search_results(search_id INTEGER, property_key TEXT); CREATE TABLE provider_runs(id INTEGER PRIMARY KEY, search_id INTEGER, provider TEXT, status TEXT, listing_count INTEGER, duration_ms INTEGER, error TEXT); CREATE TABLE price_history(id INTEGER PRIMARY KEY, source TEXT, source_listing_id TEXT, price_numeric REAL, price_display TEXT, observed_at TEXT);");
  legacy.close();
  const store = new SQLiteStore(path);
  assert.ok(store.db.prepare('PRAGMA table_info(searches)').all().some((column) => column.name === 'criteria_hash'));
  assert.ok(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='listing_history'").get());
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM listings').get().count, 1);
  store.close();
});

test('SQLite keeps latest UI results in a separate table for each YAML definition', () => {
  const path = `/tmp/property-search-saved-${crypto.randomUUID()}.sqlite`;
  const store = new SQLiteStore(path);
  store.saveSnapshot('north.yaml', { properties: [{ propertyId: 'north' }] });
  store.saveSnapshot('south.yaml', { properties: [{ propertyId: 'south' }] });
  assert.deepEqual(store.loadSnapshot('north.yaml'), { properties: [{ propertyId: 'north' }] });
  assert.deepEqual(store.loadSnapshot('south.yaml'), { properties: [{ propertyId: 'south' }] });
  assert.notEqual(store.snapshotTable('north.yaml'), store.snapshotTable('south.yaml'));
  store.close();
});

test('provider failure is isolated', async () => {
  const path = `/tmp/property-search-${crypto.randomUUID()}.sqlite`;
  const store = new SQLiteStore(path);
  const good = { name: 'rea', async search() { return [(await loadListings())[0]]; } };
  const bad = { name: 'domain', async search() { const error = new Error('timeout'); error.code = 'TIMEOUT'; throw error; } };
  const result = await new SearchService([good, bad], store).search({ locations: ['Narangba'], transactionType: 'buy' });
  assert.equal(result.properties.length, 1);
  assert.equal(result.providers[1].error.code, 'TIMEOUT');
  store.close();
});

test('search emits progress events for the UI', async () => {
  const path = `/tmp/property-search-progress-${crypto.randomUUID()}.sqlite`;
  const store = new SQLiteStore(path); const events = [];
  const provider = { name: 'rea', async search(_criteria, { onEvent }) { onEvent({ type: 'request', message: 'REA: GET fixture' }); return []; } };
  await new SearchService([provider], store).search({ locations: ['Narangba'], transactionType: 'buy' }, { onEvent: (event) => events.push(event) });
  assert.deepEqual(events.map((event) => event.type), ['search-start', 'provider-start', 'request', 'provider-complete', 'finalizing', 'search-complete']);
  assert.equal(events.at(-1).progress, 100);
  store.close();
});

test('remote REA provider queues, polls and returns local-worker listings', async () => {
  const calls = []; const events = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/api/rea-worker/jobs')) return new Response(JSON.stringify({ jobId: 'rea-job-1' }), { status: 202 });
    return new Response(JSON.stringify({ state: 'SUCCEEDED', events: [{ type: 'worker-start', message: 'local Chrome started' }], listings: [{ source: 'rea', sourceListingId: 'rea-1' }] }), { status: 200 });
  };
  const provider = new RemoteReaProvider({ baseUrl: 'https://railway.example', token: 'worker-token', fetch, pollMs: 0 });
  const listings = await provider.search({ locations: ['Narangba QLD 4504'], transactionType: 'buy' }, { onEvent: (event) => events.push(event) });
  assert.equal(listings[0].sourceListingId, 'rea-1');
  assert.equal(events[0].message, 'REA: queued local Chrome job rea-job-1.');
  assert.equal(events[1].message, 'local Chrome started');
  assert.match(calls[0].options.headers.Authorization, /^Bearer worker-token$/);
});
