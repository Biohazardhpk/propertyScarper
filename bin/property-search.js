#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { parseCriteriaYaml } from '../src/core/criteria.js';
import { SearchService } from '../src/core/search.js';
import { ReaProvider } from '../src/providers/rea/provider.js';
import { DomainProvider } from '../src/providers/domain/provider.js';
import { SQLiteStore } from '../src/persistence/database.js';
import { formatResults } from '../src/cli/format.js';
import { BrowserManager } from '../src/browser/manager.js';

try { loadEnvFile(resolve('.env')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

const [, , command, argument, ...flags] = process.argv;
const usage = () => 'Usage:\n  property-search setup\n  property-search search <criteria.yaml> [--json] [--provider rea|domain] [--debug]';

if (command === 'setup') {
  const browser = new BrowserManager({ headless: false });
  try {
    console.log('Opening Chrome to warm the persistent REA browser profile...');
    console.log(`Verified: ${await browser.warmUp()}`);
  } catch (error) {
    console.error(`property-search setup: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
} else if (command === 'search' && argument) {
  let browser;
  let store;
  try {
    const criteria = parseCriteriaYaml(await readFile(resolve(argument), 'utf8'));
    const providerFlag = flags.indexOf('--provider');
    const only = providerFlag >= 0 ? flags[providerFlag + 1] : undefined;
    if (only && !['rea', 'domain'].includes(only)) throw new Error('--provider must be rea or domain');
    const debug = flags.includes('--debug');
    const debugRoot = debug ? `.debug/${new Date().toISOString().replace(/[:.]/g, '-')}` : undefined;
    const selected = only ? [only] : ['rea', 'domain'];
    const providers = [];
    if (selected.includes('rea')) {
      browser = new BrowserManager();
      providers.push(new ReaProvider({ manager: browser, debugRoot }));
    }
    if (selected.includes('domain')) providers.push(new DomainProvider());
    store = new SQLiteStore(process.env.PROPERTY_SEARCH_DB ?? 'data/property-search.sqlite');
    const result = await new SearchService(providers, store).search(criteria);
    console.log(flags.includes('--json') ? JSON.stringify(result, null, 2) : formatResults(result));
  } catch (error) {
    console.error(`property-search: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    store?.close();
  }
} else {
  console.error(usage());
  process.exitCode = 2;
}
