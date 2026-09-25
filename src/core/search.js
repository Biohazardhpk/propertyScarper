import { enrichAndFilter } from './filtering.js';
import { deduplicate } from './deduplication.js';
import { rank } from './ranking.js';
import { uniqueListings } from '../providers/shared.js';

const knownProviders = ['rea', 'domain'];

export class SearchService {
  constructor(providers, store) {
    this.providers = providers;
    this.store = store;
  }

  async search(criteria, options = {}) {
    const notify = typeof options.onEvent === 'function' ? options.onEvent : () => {};
    const selectedProviders = this.providers.map((provider) => provider.name);
    const snapshotProviders = options.snapshotProviders
      ?? (options.definitionName ? knownProviders : selectedProviders);
    const previousSnapshot = options.definitionName
      ? this.store.loadSnapshot(options.definitionName, 'newest')
      : undefined;
    const previousListings = (previousSnapshot?.properties ?? []).flatMap((property) => property.listings ?? []);
    const selectedSet = new Set(selectedProviders);
    const searchId = this.store.beginSearch(criteria, snapshotProviders, options.definitionName);

    notify({ type: 'search-start', progress: 2, message: `Search started for ${criteria.locations.length} location${criteria.locations.length === 1 ? '' : 's'}.` });
    const runs = await Promise.all(this.providers.map(async (provider, index) => {
      const started = Date.now();
      const providerStart = 8 + Math.floor(index * (80 / Math.max(1, this.providers.length)));
      const providerEnd = 8 + Math.floor((index + 1) * (80 / Math.max(1, this.providers.length)));
      notify({ type: 'provider-start', provider: provider.name, progress: providerStart, message: `${provider.name.toUpperCase()}: starting.` });
      try {
        const listings = await provider.search(criteria, { onEvent: (event) => notify({ ...event, provider: event.provider ?? provider.name }) });
        this.store.providerRun(searchId, provider.name, 'OK', listings.length, Date.now() - started);
        notify({ type: 'provider-complete', provider: provider.name, progress: providerEnd, message: `${provider.name.toUpperCase()}: received ${listings.length} listings.` });
        return { provider: provider.name, listings };
      } catch (error) {
        const partialListings = Array.isArray(error.partialListings) ? uniqueListings(error.partialListings) : [];
        this.store.providerRun(searchId, provider.name, 'FAILED', partialListings.length, Date.now() - started, error.message);
        const partialNote = partialListings.length ? ` (${partialListings.length} listings retained from completed pages)` : '';
        const retryNote = Number(error.retryAttempts) > 0 ? ` after ${error.retryAttempts} retries` : '';
        const failureMessage = `${error.message}${retryNote}${partialNote}`;
        notify({ type: 'provider-error', provider: provider.name, progress: providerEnd, message: `${provider.name.toUpperCase()}: failed — ${failureMessage}` });
        return { provider: provider.name, listings: partialListings, error: { code: error.code ?? 'UNAVAILABLE', message: failureMessage } };
      }
    }));

    const failedProviders = new Set(runs.filter((run) => run.error).map((run) => run.provider));
    const retainedListings = previousListings.filter((listing) => !selectedSet.has(listing.source) || failedProviders.has(listing.source));
    const freshListings = runs.flatMap((run) => run.listings);
    const listings = enrichAndFilter(uniqueListings([...retainedListings, ...freshListings]), criteria);
    const properties = rank(deduplicate(listings), criteria);
    const retainedProviders = new Set(retainedListings.map((listing) => listing.source));
    const successfulProviders = [
      ...runs.filter((run) => !run.error).map((run) => run.provider),
      ...retainedProviders,
    ];
    const changes = this.store.persistResults(searchId, properties, {
      expectedProviders: snapshotProviders,
      successfulProviders: [...new Set(successfulProviders)],
      previousSearchId: previousSnapshot?.searchId,
    });
    notify({ type: 'finalizing', progress: 94, message: 'Combining, filtering and ranking results.' });
    notify({ type: 'search-complete', progress: 100, message: `Search complete — ${properties.length} matching properties.` });

    const providerResults = runs.map(({ provider, listings: providerListings, error }) => ({ name: provider, listingCount: providerListings.length, error }));
    const reportedProviders = new Set(providerResults.map((provider) => provider.name));
    const previousProviders = (previousSnapshot?.providers ?? [])
      .filter((provider) => retainedProviders.has(provider.name) && !reportedProviders.has(provider.name))
      .map((provider) => ({ ...provider, error: undefined }));

    return {
      searchId,
      criteria,
      providers: [...providerResults, ...previousProviders],
      totalSourceListings: listings.length,
      properties,
      changes,
    };
  }
}
