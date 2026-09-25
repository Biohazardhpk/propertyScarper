import { BrowserManager } from '../../browser/manager.js';
import { reaSearchUrl } from './search.js';
import { parseReaHtml } from './parser.js';
import { uniqueListings } from '../shared.js';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class ReaProvider {
  constructor(options = {}) {
    this.name = 'rea';
    this.manager = options.manager ?? new BrowserManager(options);
    this.debugRoot = options.debugRoot;
    this.maxPages = Number(options.maxPages ?? process.env.PROPERTY_SEARCH_MAX_PAGES ?? 10);
    this.retries = Math.max(0, Number(options.retries ?? process.env.PROPERTY_SEARCH_REA_RETRIES ?? 3));
    this.retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? process.env.PROPERTY_SEARCH_REA_RETRY_DELAY ?? 5000));
  }

  async fetchPageWithRetry(url, fetchOptions, notify, location, pageNumber) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.manager.fetchPage(url, fetchOptions);
      } catch (error) {
        const rateLimited = error.code === 'RATE_LIMITED' || /HTTP 429/i.test(error.message ?? '');
        if (!rateLimited || attempt >= this.retries) throw error;
        const delay = Math.max(this.retryDelayMs * (2 ** attempt), Number(error.retryAfterMs) || 0);
        notify({ type: 'retry', message: `REA: rate limited; retrying page ${pageNumber} for ${location} in ${Math.ceil(delay / 1000)}s (${attempt + 1}/${this.retries}).` });
        await wait(delay);
      }
    }
  }

  async search(criteria, options = {}) {
    const notify = typeof options.onEvent === 'function' ? options.onEvent : () => {};
    const listings = [];
    for (const location of criteria.locations) {
      let totalPages = this.maxPages;
      for (let page = 1; page <= Math.min(totalPages, this.maxPages); page += 1) {
        const url = reaSearchUrl(criteria, location, page);
        const debugDir = this.debugRoot ? `${this.debugRoot}/rea/${location.replace(/\W+/g, '-')}/page-${page}` : undefined;
        notify({ type: 'request', message: `REA: GET ${url}` });
        try {
          const fetched = await this.fetchPageWithRetry(url, { provider: this.name, debugDir }, notify, location, page);
          const parsed = parseReaHtml(fetched.html);
          listings.push(...(criteria.transactionType === 'auction' ? parsed.listings.map((listing) => ({ ...listing, isAuction: true })) : parsed.listings));
          notify({ type: 'response', message: `REA: page ${page} returned ${parsed.listings.length} listings for ${location}.` });
          totalPages = parsed.totalPages ?? (parsed.listings.length ? totalPages : page);
          if (!parsed.listings.length) break;
        } catch (error) {
          error.partialListings = uniqueListings(listings);
          throw error;
        }
      }
    }
    return uniqueListings(listings);
  }
}
