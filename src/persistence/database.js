import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]).filter(([, child]) => child !== undefined)) : value;
const hashCriteria = (criteria) => createHash('sha256').update(JSON.stringify(stable(criteria))).digest('hex');
const numericPrice = (listing) => listing.price?.numeric ?? listing.price?.min ?? null;
const trackedStatus = (listing) => {
  const status = listing?.listingStatus;
  if (!status || /^added\s/i.test(status) || /^(new|featured|sponsored)$/i.test(status)) return null;
  return status;
};

export class SQLiteStore {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS searches(id INTEGER PRIMARY KEY, criteria_json TEXT NOT NULL, created_at TEXT NOT NULL, criteria_hash TEXT, completed_at TEXT);
      CREATE TABLE IF NOT EXISTS provider_runs(id INTEGER PRIMARY KEY, search_id INTEGER NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, listing_count INTEGER NOT NULL, duration_ms INTEGER NOT NULL, error TEXT, FOREIGN KEY(search_id) REFERENCES searches(id));
      CREATE TABLE IF NOT EXISTS properties(property_key TEXT PRIMARY KEY, property_id TEXT, address_json TEXT NOT NULL, first_seen TEXT, last_seen TEXT);
      CREATE TABLE IF NOT EXISTS listings(source TEXT NOT NULL, source_listing_id TEXT NOT NULL, source_url TEXT, property_key TEXT NOT NULL, payload_json TEXT NOT NULL, first_seen TEXT, last_seen TEXT, active INTEGER DEFAULT 1, PRIMARY KEY(source,source_listing_id));
      CREATE TABLE IF NOT EXISTS search_results(search_id INTEGER NOT NULL, property_key TEXT NOT NULL, score REAL, PRIMARY KEY(search_id,property_key));
      CREATE TABLE IF NOT EXISTS result_listings(search_id INTEGER NOT NULL, property_key TEXT NOT NULL, source TEXT NOT NULL, source_listing_id TEXT NOT NULL, source_url TEXT, price_numeric REAL, PRIMARY KEY(search_id,source,source_listing_id));
      CREATE TABLE IF NOT EXISTS price_history(id INTEGER PRIMARY KEY, source TEXT NOT NULL, source_listing_id TEXT NOT NULL, price_numeric REAL, price_display TEXT, observed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS listing_history(id INTEGER PRIMARY KEY, source TEXT NOT NULL, source_listing_id TEXT NOT NULL, change_type TEXT NOT NULL, old_value_json TEXT, new_value_json TEXT, observed_at TEXT NOT NULL);`);
    this.addColumn('searches', 'criteria_hash', 'TEXT');
    this.addColumn('searches', 'completed_at', 'TEXT');
    this.addColumn('properties', 'property_id', 'TEXT');
    this.addColumn('properties', 'first_seen', 'TEXT');
    this.addColumn('properties', 'last_seen', 'TEXT');
    this.addColumn('listings', 'first_seen', 'TEXT');
    this.addColumn('listings', 'active', 'INTEGER DEFAULT 1');
    this.addColumn('search_results', 'score', 'REAL');
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_searches_criteria ON searches(criteria_hash,id);
      CREATE INDEX IF NOT EXISTS idx_result_listings_search ON result_listings(search_id);
      CREATE INDEX IF NOT EXISTS idx_listing_history_identity ON listing_history(source,source_listing_id,observed_at);`);
  }

  addColumn(table, name, type) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((column) => column.name === name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }

  beginSearch(criteria, providers = ['rea', 'domain']) {
    const now = new Date().toISOString();
    const scope = [...providers].sort();
    const result = this.db.prepare('INSERT INTO searches(criteria_json,criteria_hash,created_at) VALUES (?,?,?)').run(JSON.stringify(criteria), hashCriteria({ criteria, providers: scope }), now);
    return Number(result.lastInsertRowid);
  }

  providerRun(searchId, provider, status, count, duration, error = null) {
    this.db.prepare('INSERT INTO provider_runs(search_id,provider,status,listing_count,duration_ms,error) VALUES (?,?,?,?,?,?)').run(searchId, provider, status, count, duration, error);
  }

  persistResults(searchId, properties, options = {}) {
    const now = new Date().toISOString();
    const expected = new Set(options.expectedProviders ?? ['rea', 'domain']);
    const successful = new Set(options.successfulProviders ?? [...expected]);
    const completeCoverage = [...expected].every((name) => successful.has(name));
    const search = this.db.prepare('SELECT criteria_hash FROM searches WHERE id=?').get(searchId);
    const previousSearch = this.db.prepare('SELECT id FROM searches WHERE criteria_hash=? AND completed_at IS NOT NULL AND id<? ORDER BY id DESC LIMIT 1').get(search.criteria_hash, searchId);
    const previousId = previousSearch?.id;
    const previousProperties = new Set(previousId ? this.db.prepare('SELECT property_key FROM search_results WHERE search_id=?').all(previousId).map((row) => row.property_key) : []);
    const previousListings = previousId ? this.db.prepare('SELECT * FROM result_listings WHERE search_id=?').all(previousId) : [];
    const currentProperties = new Set();
    const currentListingIds = new Set();
    const changes = { new: [], removed: [], priceChanged: [], urlChanged: [], statusChanged: [], descriptionChanged: [], relisted: [], sourceAdded: [], sourceRemoved: [] };
    const history = this.db.prepare('INSERT INTO listing_history(source,source_listing_id,change_type,old_value_json,new_value_json,observed_at) VALUES (?,?,?,?,?,?)');

    this.db.exec('BEGIN');
    try {
      for (const property of properties) {
        const key = property.addressKey || property.propertyId;
        currentProperties.add(key);
        if (previousId && !previousProperties.has(key)) changes.new.push(property);
        this.db.prepare('INSERT INTO properties(property_key,property_id,address_json,first_seen,last_seen) VALUES (?,?,?,?,?) ON CONFLICT(property_key) DO UPDATE SET property_id=excluded.property_id,address_json=excluded.address_json,last_seen=excluded.last_seen').run(key, property.propertyId, JSON.stringify(property.address), now, now);
        this.db.prepare('INSERT INTO search_results(search_id,property_key,score) VALUES (?,?,?)').run(searchId, key, property.score ?? null);
        const previousSources = new Set(previousListings.filter((row) => row.property_key === key).map((row) => row.source));

        for (const listing of property.listings) {
          const identity = `${listing.source}:${listing.sourceListingId}`;
          currentListingIds.add(identity);
          const old = this.db.prepare('SELECT source_url,payload_json,active FROM listings WHERE source=? AND source_listing_id=?').get(listing.source, listing.sourceListingId);
          let oldPayload;
          try { oldPayload = old ? JSON.parse(old.payload_json) : undefined; } catch {}
          const price = numericPrice(listing);
          const oldPrice = oldPayload ? numericPrice(oldPayload) : null;

          if (oldPayload && oldPrice !== price) {
            const change = { property, source: listing.source, from: oldPayload.price, to: listing.price };
            changes.priceChanged.push(change);
            history.run(listing.source, listing.sourceListingId, 'PRICE', JSON.stringify(oldPayload.price ?? null), JSON.stringify(listing.price ?? null), now);
          }
          if (old?.source_url && old.source_url !== listing.sourceUrl) changes.urlChanged.push({ property, source: listing.source, from: old.source_url, to: listing.sourceUrl });
          const oldStatus = trackedStatus(oldPayload);
          const newStatus = trackedStatus(listing);
          if (oldPayload && oldStatus !== newStatus && (oldStatus != null || newStatus != null)) {
            const change = { property, source: listing.source, from: oldStatus, to: newStatus };
            changes.statusChanged.push(change);
            history.run(listing.source, listing.sourceListingId, 'STATUS', JSON.stringify(oldStatus), JSON.stringify(newStatus), now);
          }
          if (oldPayload && (oldPayload.description ?? null) !== (listing.description ?? null)) {
            const change = { property, source: listing.source };
            changes.descriptionChanged.push(change);
            history.run(listing.source, listing.sourceListingId, 'DESCRIPTION', JSON.stringify(oldPayload.description ?? null), JSON.stringify(listing.description ?? null), now);
          }
          if (old?.active === 0) {
            const change = { property, source: listing.source };
            changes.relisted.push(change);
            history.run(listing.source, listing.sourceListingId, 'RELISTED', null, JSON.stringify({ sourceUrl: listing.sourceUrl }), now);
          }
          if (previousId && !previousSources.has(listing.source)) changes.sourceAdded.push({ property, source: listing.source });

          this.db.prepare('INSERT INTO listings(source,source_listing_id,source_url,property_key,payload_json,first_seen,last_seen,active) VALUES (?,?,?,?,?,?,?,1) ON CONFLICT(source,source_listing_id) DO UPDATE SET source_url=excluded.source_url,property_key=excluded.property_key,payload_json=excluded.payload_json,last_seen=excluded.last_seen,active=1').run(listing.source, listing.sourceListingId, listing.sourceUrl, key, JSON.stringify(listing), now, now);
          this.db.prepare('INSERT INTO result_listings(search_id,property_key,source,source_listing_id,source_url,price_numeric) VALUES (?,?,?,?,?,?)').run(searchId, key, listing.source, listing.sourceListingId, listing.sourceUrl, price);
          if (!oldPayload || oldPrice !== price) this.db.prepare('INSERT INTO price_history(source,source_listing_id,price_numeric,price_display,observed_at) VALUES (?,?,?,?,?)').run(listing.source, listing.sourceListingId, price, listing.price?.display ?? null, now);
        }
      }

      if (previousId) {
        if (completeCoverage) for (const key of previousProperties) if (!currentProperties.has(key)) changes.removed.push(key);
        for (const old of previousListings) {
          const identity = `${old.source}:${old.source_listing_id}`;
          if (!successful.has(old.source) || currentListingIds.has(identity)) continue;
          this.db.prepare('UPDATE listings SET active=0,last_seen=? WHERE source=? AND source_listing_id=?').run(now, old.source, old.source_listing_id);
          history.run(old.source, old.source_listing_id, 'REMOVED', JSON.stringify({ sourceUrl: old.source_url }), null, now);
          if (currentProperties.has(old.property_key)) changes.sourceRemoved.push({ propertyKey: old.property_key, source: old.source });
        }
      }
      this.db.prepare('UPDATE searches SET completed_at=? WHERE id=?').run(now, searchId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return changes;
  }

  close() { this.db.close(); }
}
