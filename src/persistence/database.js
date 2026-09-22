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
const snapshotSort = (value) => ['newest', 'oldest', 'score'].includes(value) ? value : 'newest';
const usableSnapshot = (result) => !Array.isArray(result?.providers) || result.providers.length === 0 || result.providers.some((provider) => !provider?.error);

export class SQLiteStore {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS searches(id INTEGER PRIMARY KEY, criteria_json TEXT NOT NULL, created_at TEXT NOT NULL, criteria_hash TEXT, completed_at TEXT, definition_name TEXT);
      CREATE TABLE IF NOT EXISTS provider_runs(id INTEGER PRIMARY KEY, search_id INTEGER NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, listing_count INTEGER NOT NULL, duration_ms INTEGER NOT NULL, error TEXT, FOREIGN KEY(search_id) REFERENCES searches(id));
      CREATE TABLE IF NOT EXISTS properties(property_key TEXT PRIMARY KEY, property_id TEXT, address_json TEXT NOT NULL, first_seen TEXT, last_seen TEXT);
      CREATE TABLE IF NOT EXISTS listings(source TEXT NOT NULL, source_listing_id TEXT NOT NULL, source_url TEXT, property_key TEXT NOT NULL, payload_json TEXT NOT NULL, first_seen TEXT, last_seen TEXT, active INTEGER DEFAULT 1, PRIMARY KEY(source,source_listing_id));
      CREATE TABLE IF NOT EXISTS search_results(search_id INTEGER NOT NULL, property_key TEXT NOT NULL, score REAL, PRIMARY KEY(search_id,property_key));
      CREATE TABLE IF NOT EXISTS result_listings(search_id INTEGER NOT NULL, property_key TEXT NOT NULL, source TEXT NOT NULL, source_listing_id TEXT NOT NULL, source_url TEXT, price_numeric REAL, PRIMARY KEY(search_id,source,source_listing_id));
      CREATE TABLE IF NOT EXISTS price_history(id INTEGER PRIMARY KEY, source TEXT NOT NULL, source_listing_id TEXT NOT NULL, price_numeric REAL, price_display TEXT, observed_at TEXT NOT NULL, search_id INTEGER);
      CREATE TABLE IF NOT EXISTS listing_history(id INTEGER PRIMARY KEY, source TEXT NOT NULL, source_listing_id TEXT NOT NULL, change_type TEXT NOT NULL, old_value_json TEXT, new_value_json TEXT, observed_at TEXT NOT NULL, search_id INTEGER);
      CREATE TABLE IF NOT EXISTS property_link_clicks(definition_name TEXT NOT NULL, property_key TEXT NOT NULL, source TEXT NOT NULL, source_listing_id TEXT NOT NULL, source_url TEXT NOT NULL, clicked_at TEXT NOT NULL, click_count INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(definition_name,source,source_listing_id));
      CREATE TABLE IF NOT EXISTS property_favorites(definition_name TEXT NOT NULL, property_key TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY(definition_name,property_key));`);
    this.addColumn('searches', 'criteria_hash', 'TEXT');
    this.addColumn('searches', 'completed_at', 'TEXT');
    this.addColumn('searches', 'definition_name', 'TEXT');
    this.addColumn('properties', 'property_id', 'TEXT');
    this.addColumn('properties', 'first_seen', 'TEXT');
    this.addColumn('properties', 'last_seen', 'TEXT');
    this.addColumn('listings', 'first_seen', 'TEXT');
    this.addColumn('listings', 'active', 'INTEGER DEFAULT 1');
    this.addColumn('search_results', 'score', 'REAL');
    this.addColumn('price_history', 'search_id', 'INTEGER');
    this.addColumn('listing_history', 'search_id', 'INTEGER');
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_searches_criteria ON searches(criteria_hash,id);
      CREATE INDEX IF NOT EXISTS idx_searches_definition ON searches(definition_name,id);
      CREATE INDEX IF NOT EXISTS idx_result_listings_search ON result_listings(search_id);
      CREATE INDEX IF NOT EXISTS idx_listing_history_identity ON listing_history(source,source_listing_id,observed_at);`);
  }

  addColumn(table, name, type) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((column) => column.name === name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }

  beginSearch(criteria, providers = ['rea', 'domain'], definitionName = null) {
    const now = new Date().toISOString();
    const scope = [...providers].sort();
    const result = this.db.prepare('INSERT INTO searches(criteria_json,criteria_hash,created_at,definition_name) VALUES (?,?,?,?)').run(JSON.stringify(criteria), hashCriteria({ criteria, providers: scope }), now, definitionName == null ? null : String(definitionName));
    return Number(result.lastInsertRowid);
  }

  providerRun(searchId, provider, status, count, duration, error = null) {
    this.db.prepare('INSERT INTO provider_runs(search_id,provider,status,listing_count,duration_ms,error) VALUES (?,?,?,?,?,?)').run(searchId, provider, status, count, duration, error);
  }

  snapshotTable(definitionName) { return `saved_search_${createHash('sha256').update(definitionName).digest('hex').slice(0, 16)}`; }

  saveSnapshot(definitionName, result) {
    const table = this.snapshotTable(definitionName);
    this.db.exec(`CREATE TABLE IF NOT EXISTS ${table}(id INTEGER PRIMARY KEY, completed_at TEXT NOT NULL, result_json TEXT NOT NULL)`);
    this.db.prepare(`INSERT INTO ${table}(completed_at,result_json) VALUES (?,?)`).run(new Date().toISOString(), JSON.stringify(result));
  }

  recordLinkClick(definitionName, propertyKey, source, sourceListingId, sourceUrl) {
    const clickedAt = new Date().toISOString();
    const listingKey = String(sourceListingId || sourceUrl || propertyKey);
    this.db.prepare(`INSERT INTO property_link_clicks(definition_name,property_key,source,source_listing_id,source_url,clicked_at,click_count)
      VALUES (?,?,?,?,?,?,1)
      ON CONFLICT(definition_name,source,source_listing_id) DO UPDATE SET property_key=excluded.property_key,source_url=excluded.source_url,clicked_at=excluded.clicked_at,click_count=property_link_clicks.click_count+1`).run(String(definitionName), String(propertyKey), String(source), listingKey, String(sourceUrl), clickedAt);
  }

  setFavorite(definitionName, propertyKey, favorite) {
    const name = String(definitionName); const key = String(propertyKey);
    if (favorite) this.db.prepare(`INSERT INTO property_favorites(definition_name,property_key,saved_at) VALUES (?,?,?) ON CONFLICT(definition_name,property_key) DO UPDATE SET saved_at=excluded.saved_at`).run(name, key, new Date().toISOString());
    else this.db.prepare('DELETE FROM property_favorites WHERE definition_name=? AND property_key=?').run(name, key);
  }

  loadInteractions(definitionName) {
    const name = String(definitionName);
    return {
      favorites: this.db.prepare('SELECT property_key FROM property_favorites WHERE definition_name=? ORDER BY saved_at DESC').all(name).map((row) => row.property_key),
      links: this.db.prepare('SELECT source,source_listing_id,clicked_at,click_count FROM property_link_clicks WHERE definition_name=? ORDER BY clicked_at DESC').all(name).map((row) => ({ ...row })),
    };
  }

  deleteDefinition(definitionName) {
    const name = String(definitionName);
    const table = this.snapshotTable(name);
    const searchIds = new Set(this.db.prepare('SELECT id FROM searches WHERE definition_name=?').all(name).map((row) => Number(row.id)));
    if (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
      for (const row of this.db.prepare(`SELECT result_json FROM ${table}`).all()) {
        try { const searchId = JSON.parse(row.result_json).searchId; if (searchId != null) searchIds.add(Number(searchId)); } catch {}
      }
    }
    const ids = [...searchIds];
    const placeholders = ids.map(() => '?').join(',');
    this.db.exec('BEGIN');
    try {
      if (ids.length) {
        this.db.prepare(`DELETE FROM provider_runs WHERE search_id IN (${placeholders})`).run(...ids);
        this.db.prepare(`DELETE FROM search_results WHERE search_id IN (${placeholders})`).run(...ids);
        this.db.prepare(`DELETE FROM result_listings WHERE search_id IN (${placeholders})`).run(...ids);
        this.db.prepare(`DELETE FROM price_history WHERE search_id IN (${placeholders})`).run(...ids);
        this.db.prepare(`DELETE FROM listing_history WHERE search_id IN (${placeholders})`).run(...ids);
        this.db.prepare(`DELETE FROM searches WHERE id IN (${placeholders})`).run(...ids);
      }
      this.db.prepare('DELETE FROM property_link_clicks WHERE definition_name=?').run(name);
      this.db.prepare('DELETE FROM property_favorites WHERE definition_name=?').run(name);
      this.db.exec(`DROP TABLE IF EXISTS ${table}`);
      this.db.exec(`DELETE FROM listings WHERE NOT EXISTS (SELECT 1 FROM result_listings WHERE result_listings.source=listings.source AND result_listings.source_listing_id=listings.source_listing_id)`);
      this.db.exec(`DELETE FROM properties WHERE NOT EXISTS (SELECT 1 FROM search_results WHERE search_results.property_key=properties.property_key) AND NOT EXISTS (SELECT 1 FROM listings WHERE listings.property_key=properties.property_key)`);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  loadSnapshot(definitionName, sort = 'newest') {
    const table = this.snapshotTable(definitionName);
    if (!this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) return undefined;
    const snapshotRows = this.db.prepare(`SELECT result_json FROM ${table} ORDER BY id DESC`).all();
    const row = snapshotRows.find((candidate) => {
      try { return usableSnapshot(JSON.parse(candidate.result_json)); } catch { return false; }
    });
    if (!row) return undefined;
    const result = JSON.parse(row.result_json);
    if (!Array.isArray(result.properties) || result.properties.length < 2 || result.searchId == null) return result;

    const order = snapshotSort(sort);
    const orderBy = order === 'score'
      ? 'sr.score IS NULL, sr.score DESC, sr.property_key ASC'
      : order === 'oldest'
        ? 'first_observed IS NULL, first_observed ASC, sr.property_key ASC'
        : 'first_observed IS NULL, first_observed DESC, sr.property_key ASC';
    const rows = this.db.prepare(`
      SELECT sr.property_key, sr.score,
        p.first_seen AS first_observed,
        p.last_seen AS last_observed
      FROM search_results sr
      LEFT JOIN result_listings rl ON rl.search_id = sr.search_id AND rl.property_key = sr.property_key
      LEFT JOIN listings l ON l.source = rl.source AND l.source_listing_id = rl.source_listing_id
      LEFT JOIN properties p ON p.property_key = sr.property_key
      WHERE sr.search_id = ?
      GROUP BY sr.property_key, sr.score, p.first_seen, p.last_seen
      ORDER BY ${orderBy}
    `).all(result.searchId);
    if (!rows.length) return result;
    const rank = new Map(rows.map((item, index) => [item.property_key, index]));
    result.properties = [...result.properties].sort((a, b) => {
      const aKey = a.addressKey || a.propertyId;
      const bKey = b.addressKey || b.propertyId;
      return (rank.get(aKey) ?? Number.MAX_SAFE_INTEGER) - (rank.get(bKey) ?? Number.MAX_SAFE_INTEGER);
    });
    return result;
  }

  persistResults(searchId, properties, options = {}) {
    const now = new Date().toISOString();
    const expected = new Set(options.expectedProviders ?? ['rea', 'domain']);
    const successful = new Set(options.successfulProviders ?? [...expected]);
    const completeCoverage = [...expected].every((name) => successful.has(name));
    const search = this.db.prepare('SELECT criteria_hash FROM searches WHERE id=?').get(searchId);
    const previousSearch = this.db.prepare('SELECT id FROM searches WHERE criteria_hash=? AND definition_name IS ? AND completed_at IS NOT NULL AND id<? ORDER BY id DESC LIMIT 1').get(search.criteria_hash, search.definition_name ?? null, searchId);
    const previousId = previousSearch?.id;
    const previousProperties = new Set(previousId ? this.db.prepare('SELECT property_key FROM search_results WHERE search_id=?').all(previousId).map((row) => row.property_key) : []);
    const previousListings = previousId ? this.db.prepare('SELECT * FROM result_listings WHERE search_id=?').all(previousId) : [];
    const currentProperties = new Set();
    const currentListingIds = new Set();
    const changes = { new: [], removed: [], priceChanged: [], urlChanged: [], statusChanged: [], descriptionChanged: [], relisted: [], sourceAdded: [], sourceRemoved: [] };
    const history = this.db.prepare('INSERT INTO listing_history(source,source_listing_id,change_type,old_value_json,new_value_json,observed_at,search_id) VALUES (?,?,?,?,?,?,?)');

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
            history.run(listing.source, listing.sourceListingId, 'PRICE', JSON.stringify(oldPayload.price ?? null), JSON.stringify(listing.price ?? null), now, searchId);
          }
          if (old?.source_url && old.source_url !== listing.sourceUrl) changes.urlChanged.push({ property, source: listing.source, from: old.source_url, to: listing.sourceUrl });
          const oldStatus = trackedStatus(oldPayload);
          const newStatus = trackedStatus(listing);
          if (oldPayload && oldStatus !== newStatus && (oldStatus != null || newStatus != null)) {
            const change = { property, source: listing.source, from: oldStatus, to: newStatus };
            changes.statusChanged.push(change);
            history.run(listing.source, listing.sourceListingId, 'STATUS', JSON.stringify(oldStatus), JSON.stringify(newStatus), now, searchId);
          }
          if (oldPayload && (oldPayload.description ?? null) !== (listing.description ?? null)) {
            const change = { property, source: listing.source };
            changes.descriptionChanged.push(change);
            history.run(listing.source, listing.sourceListingId, 'DESCRIPTION', JSON.stringify(oldPayload.description ?? null), JSON.stringify(listing.description ?? null), now, searchId);
          }
          if (old?.active === 0) {
            const change = { property, source: listing.source };
            changes.relisted.push(change);
            history.run(listing.source, listing.sourceListingId, 'RELISTED', null, JSON.stringify({ sourceUrl: listing.sourceUrl }), now, searchId);
          }
          if (previousId && !previousSources.has(listing.source)) changes.sourceAdded.push({ property, source: listing.source });

          this.db.prepare('INSERT INTO listings(source,source_listing_id,source_url,property_key,payload_json,first_seen,last_seen,active) VALUES (?,?,?,?,?,?,?,1) ON CONFLICT(source,source_listing_id) DO UPDATE SET source_url=excluded.source_url,property_key=excluded.property_key,payload_json=excluded.payload_json,last_seen=excluded.last_seen,active=1').run(listing.source, listing.sourceListingId, listing.sourceUrl, key, JSON.stringify(listing), now, now);
          this.db.prepare('INSERT INTO result_listings(search_id,property_key,source,source_listing_id,source_url,price_numeric) VALUES (?,?,?,?,?,?)').run(searchId, key, listing.source, listing.sourceListingId, listing.sourceUrl, price);
          if (!oldPayload || oldPrice !== price) this.db.prepare('INSERT INTO price_history(source,source_listing_id,price_numeric,price_display,observed_at,search_id) VALUES (?,?,?,?,?,?)').run(listing.source, listing.sourceListingId, price, listing.price?.display ?? null, now, searchId);
        }
      }

      if (previousId) {
        if (completeCoverage) for (const key of previousProperties) if (!currentProperties.has(key)) changes.removed.push(key);
        for (const old of previousListings) {
          const identity = `${old.source}:${old.source_listing_id}`;
          if (!successful.has(old.source) || currentListingIds.has(identity)) continue;
          this.db.prepare('UPDATE listings SET active=0,last_seen=? WHERE source=? AND source_listing_id=?').run(now, old.source, old.source_listing_id);
          history.run(old.source, old.source_listing_id, 'REMOVED', JSON.stringify({ sourceUrl: old.source_url }), null, now, searchId);
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
