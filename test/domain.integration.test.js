import { loadEnvFile } from 'node:process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainProvider } from '../src/providers/domain/provider.js';

try { loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }

test('manual live Domain search through Apify', { skip: process.env.DOMAIN_INTEGRATION !== '1' || !process.env.APIFY_TOKEN, timeout: 360000 }, async () => {
  const provider = new DomainProvider({ maxPages: 1, maxResults: 5 });
  const listings = await provider.search({ locations: ['Narangba QLD 4504'], transactionType: 'buy', maxPrice: 800000, minBedrooms: 3 });
  assert.ok(listings.length > 0, 'expected at least one normalized Domain listing from Apify');
  assert.ok(listings.every((listing) => listing.source === 'domain' && listing.sourceListingId));
});
