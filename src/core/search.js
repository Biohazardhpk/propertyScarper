import { enrichAndFilter } from './filtering.js'; import { deduplicate } from './deduplication.js'; import { rank } from './ranking.js';
export class SearchService {
  constructor(providers, store) { this.providers = providers; this.store = store; }
  async search(criteria) {
    const expectedProviders = this.providers.map((provider) => provider.name); const searchId = this.store.beginSearch(criteria, expectedProviders); const runs = await Promise.all(this.providers.map(async (provider) => {
      const started = Date.now(); try { const listings = await provider.search(criteria); this.store.providerRun(searchId, provider.name, 'OK', listings.length, Date.now() - started); return { provider: provider.name, listings }; }
      catch (error) { this.store.providerRun(searchId, provider.name, 'FAILED', 0, Date.now() - started, error.message); return { provider: provider.name, listings: [], error: { code: error.code ?? 'UNAVAILABLE', message: error.message } }; }
    }));
    const listings = enrichAndFilter(runs.flatMap((r) => r.listings), criteria); const properties = rank(deduplicate(listings), criteria); const changes = this.store.persistResults(searchId, properties, { expectedProviders, successfulProviders: runs.filter((r) => !r.error).map((r) => r.provider) });
    return { searchId, criteria, providers: runs.map(({ provider, listings, error }) => ({ name: provider, listingCount: listings.length, error })), totalSourceListings: listings.length, properties, changes };
  }
}
