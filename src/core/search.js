import { enrichAndFilter } from './filtering.js'; import { deduplicate } from './deduplication.js'; import { rank } from './ranking.js';
export class SearchService {
  constructor(providers, store) { this.providers = providers; this.store = store; }
  async search(criteria, options = {}) {
    const notify = typeof options.onEvent === 'function' ? options.onEvent : () => {};
    const expectedProviders = this.providers.map((provider) => provider.name); const searchId = this.store.beginSearch(criteria, expectedProviders, options.definitionName);
    notify({ type: 'search-start', progress: 2, message: `Search started for ${criteria.locations.length} location${criteria.locations.length === 1 ? '' : 's'}.` });
    const runs = await Promise.all(this.providers.map(async (provider, index) => {
      const started = Date.now(); const providerStart = 8 + Math.floor(index * (80 / Math.max(1, this.providers.length))); const providerEnd = 8 + Math.floor((index + 1) * (80 / Math.max(1, this.providers.length)));
      notify({ type: 'provider-start', provider: provider.name, progress: providerStart, message: `${provider.name.toUpperCase()}: starting.` });
      try {
        const listings = await provider.search(criteria, { onEvent: (event) => notify({ ...event, provider: event.provider ?? provider.name }) });
        this.store.providerRun(searchId, provider.name, 'OK', listings.length, Date.now() - started); notify({ type: 'provider-complete', provider: provider.name, progress: providerEnd, message: `${provider.name.toUpperCase()}: received ${listings.length} listings.` }); return { provider: provider.name, listings };
      }
      catch (error) { this.store.providerRun(searchId, provider.name, 'FAILED', 0, Date.now() - started, error.message); notify({ type: 'provider-error', provider: provider.name, progress: providerEnd, message: `${provider.name.toUpperCase()}: failed — ${error.message}` }); return { provider: provider.name, listings: [], error: { code: error.code ?? 'UNAVAILABLE', message: error.message } }; }
    }));
    notify({ type: 'finalizing', progress: 94, message: 'Combining, filtering and ranking results.' });
    const listings = enrichAndFilter(runs.flatMap((r) => r.listings), criteria); const properties = rank(deduplicate(listings), criteria); const changes = this.store.persistResults(searchId, properties, { expectedProviders, successfulProviders: runs.filter((r) => !r.error).map((r) => r.provider) });
    notify({ type: 'search-complete', progress: 100, message: `Search complete — ${properties.length} matching properties.` });
    return { searchId, criteria, providers: runs.map(({ provider, listings, error }) => ({ name: provider, listingCount: listings.length, error })), totalSourceListings: listings.length, properties, changes };
  }
}
