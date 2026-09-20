import { AuthenticationRequiredError, ProviderError, ProviderTimeoutError, ProviderUnavailableError } from '../../core/errors.js';
import { uniqueListings } from '../shared.js';
import { mapDomainListing } from './parser.js';
import { domainSearchUrl } from './search.js';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class ApifyClient {
  constructor(options = {}) {
    this.token = options.token ?? process.env.APIFY_TOKEN;
    this.actorId = String(options.actorId ?? process.env.PROPERTY_SEARCH_DOMAIN_ACTOR ?? 'blackfalcondata/domain-com-au-scraper').replace('/', '~');
    this.fetch = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? 'https://api.apify.com/v2';
    this.timeoutMs = Number(options.timeoutMs ?? process.env.PROPERTY_SEARCH_APIFY_TIMEOUT ?? 300000);
    this.pollMs = Number(options.pollMs ?? 2000);
  }

  async request(path, options = {}) {
    if (!this.token) throw new AuthenticationRequiredError('Domain via Apify requires APIFY_TOKEN in .env');
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, 60000)),
      });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new ProviderTimeoutError('Apify request timed out');
      throw new ProviderUnavailableError(`Apify request failed: ${error.message}`);
    }
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
    const detail = body?.error?.message ?? body?.message ?? (typeof body === 'string' ? body.slice(0, 300) : undefined);
    if (response.status === 401) throw new AuthenticationRequiredError(`Apify rejected APIFY_TOKEN${detail ? `: ${detail}` : ''}`);
    if (response.status === 403) throw new ProviderError(`Apify denied access to ${this.actorId}${detail ? `: ${detail}` : ''}`, 'ACCESS_DENIED');
    if (response.status === 429) throw new ProviderError('Apify API rate limit reached; retry later', 'RATE_LIMITED');
    if (!response.ok) throw new ProviderUnavailableError(`Apify returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    return body;
  }

  async run(input, options = {}) {
    const notify = typeof options.onEvent === 'function' ? options.onEvent : () => {};
    notify({ type: 'request', message: `APIFY: POST actor ${this.actorId}.` });
    const started = await this.request(`/acts/${encodeURIComponent(this.actorId)}/runs`, { method: 'POST', body: JSON.stringify(input) });
    let run = started?.data;
    if (!run?.id) throw new ProviderUnavailableError('Apify did not return an actor run ID');
    notify({ type: 'response', message: `APIFY: run ${run.id} started (${run.status}).` });
    const deadline = Date.now() + this.timeoutMs;
    while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) {
      if (Date.now() >= deadline) throw new ProviderTimeoutError(`Apify actor ${this.actorId} did not finish within ${this.timeoutMs}ms`);
      await wait(this.pollMs);
      run = (await this.request(`/actor-runs/${encodeURIComponent(run.id)}`))?.data;
      notify({ type: 'poll', message: `APIFY: run ${run?.id ?? 'unknown'} status ${run?.status ?? 'unknown'}.` });
    }
    if (run.status !== 'SUCCEEDED') throw new ProviderUnavailableError(`Apify actor ${this.actorId} finished with status ${run.status}`);
    if (!run.defaultDatasetId) return [];
    notify({ type: 'request', message: `APIFY: GET dataset ${run.defaultDatasetId}.` });
    const items = await this.request(`/datasets/${encodeURIComponent(run.defaultDatasetId)}/items?clean=true&format=json&limit=1000`);
    if (!Array.isArray(items)) throw new ProviderError('Apify dataset returned an unexpected response', 'PARSING');
    notify({ type: 'response', message: `APIFY: dataset returned ${items.length} items.` });
    return items;
  }
}

export class DomainProvider {
  constructor(options = {}) {
    this.name = 'domain';
    this.client = options.client ?? new ApifyClient(options);
    this.maxPages = Number(options.maxPages ?? process.env.PROPERTY_SEARCH_MAX_PAGES ?? 10);
    this.maxResults = Number(options.maxResults ?? process.env.PROPERTY_SEARCH_DOMAIN_MAX_RESULTS ?? 200);
    this.includeDetails = options.includeDetails ?? process.env.PROPERTY_SEARCH_DOMAIN_DETAILS === '1';
    this.listingCache = new Map();
  }

  normalize(rawListing) { return mapDomainListing(rawListing); }

  actorInput(criteria, urls) {
    return {
      saleType: criteria.transactionType,
      startUrls: urls,
      maxResults: this.maxResults,
      maxPages: this.maxPages,
      includeDetails: this.includeDetails,
      compact: false,
      incrementalMode: false,
    };
  }

  async getListing(idOrUrl) {
    const cached = this.listingCache.get(String(idOrUrl));
    if (cached) return cached;
    if (!/^https?:\/\//i.test(String(idOrUrl))) throw new ProviderUnavailableError(`Domain listing ${idOrUrl} is not cached; a full listing URL is required`);
    const items = await this.client.run({ startUrls: [String(idOrUrl)], maxResults: 1, maxPages: 1, includeDetails: true, compact: false });
    const listing = items.map((item) => this.normalize(item)).find((item) => item.sourceListingId);
    if (!listing) throw new ProviderError('Apify returned no Domain listing for the supplied URL', 'PARSING');
    this.remember(listing);
    return listing;
  }

  remember(listing) {
    this.listingCache.set(listing.sourceListingId, listing);
    if (listing.sourceUrl) this.listingCache.set(listing.sourceUrl, listing);
  }

  async search(criteria, options = {}) {
    const notify = typeof options.onEvent === 'function' ? options.onEvent : () => {};
    const urls = criteria.locations.map((location) => domainSearchUrl(criteria, location));
    notify({ type: 'request', message: `DOMAIN: prepared ${urls.length} search URL${urls.length === 1 ? '' : 's'} for Apify.` });
    urls.forEach((url) => notify({ type: 'request', message: `DOMAIN: ${url}` }));
    const items = await this.client.run(this.actorInput(criteria, urls), { onEvent: notify });
    const listings = uniqueListings(items.map((item) => this.normalize(item)).filter((item) => item.sourceListingId));
    listings.forEach((listing) => this.remember(listing));
    notify({ type: 'response', message: `DOMAIN: normalized ${listings.length} listings.` });
    return listings;
  }
}
