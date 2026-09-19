#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { parseCriteriaYaml } from '../src/core/criteria.js';
import { SearchService } from '../src/core/search.js';
import { ReaProvider } from '../src/providers/rea/provider.js';
import { DomainProvider } from '../src/providers/domain/provider.js';
import { SQLiteStore } from '../src/persistence/database.js';
import { BrowserManager } from '../src/browser/manager.js';
import { criteriaToForm, criteriaToYaml, formToCriteria } from '../src/web/criteria-yaml.js';

try { loadEnvFile(resolve('.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const initialCriteriaPath = resolve(process.argv[2] ?? 'examples/north-brisbane-under_800k.yaml');
const definitionsDir = dirname(initialCriteriaPath);
const publicDir = resolve('src/web/public');
const port = Number(process.env.PORT ?? 3000);
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const json = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
const body = async (request) => new Promise((resolveBody, reject) => { let input = ''; request.on('data', (chunk) => { input += chunk; if (input.length > 1_000_000) reject(new Error('Request is too large')); }); request.on('end', () => { try { resolveBody(JSON.parse(input || '{}')); } catch { reject(new Error('Request body must be valid JSON')); } }); request.on('error', reject); });
const definitionName = (value = basename(initialCriteriaPath)) => { const name = basename(String(value)); if (!/^[\w.-]+\.ya?ml$/i.test(name)) throw new Error('Choose a YAML filename ending in .yaml or .yml'); return name; };
const definitionPath = (name) => resolve(definitionsDir, definitionName(name));
const databasePath = () => process.env.PROPERTY_SEARCH_DB ?? 'data/property-search.sqlite';
const latestResult = (name) => { const store = new SQLiteStore(databasePath()); try { return store.loadSnapshot(name); } finally { store.close(); } };
async function listDefinitions() { return (await readdir(definitionsDir)).filter((name) => /\.ya?ml$/i.test(name)).sort(); }
async function readConfig(name) { const safeName = definitionName(name); const yaml = await readFile(definitionPath(safeName), 'utf8'); return { name: safeName, yaml, form: criteriaToForm(parseCriteriaYaml(yaml)), lastResult: latestResult(safeName) }; }
async function run(criteria, name, debug = false) {
  let browser; let store;
  try {
    browser = new BrowserManager(); store = new SQLiteStore(databasePath());
    const debugRoot = debug ? `.debug/${new Date().toISOString().replace(/[:.]/g, '-')}` : undefined;
    const result = await new SearchService([new ReaProvider({ manager: browser, debugRoot }), new DomainProvider()], store).search(criteria);
    store.saveSnapshot(name, result);
    return result;
  } finally { await browser?.close(); store?.close(); }
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'GET' && url.pathname === '/healthz') { response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('ok'); return; }
    if (request.method === 'GET' && url.pathname === '/api/readme') return json(response, 200, { markdown: await readFile(resolve('README.md'), 'utf8') });
    if (request.method === 'GET' && url.pathname === '/api/configs') return json(response, 200, { definitions: await listDefinitions(), current: basename(initialCriteriaPath) });
    if (request.method === 'GET' && url.pathname === '/api/config') return json(response, 200, await readConfig(url.searchParams.get('name') ?? undefined));
    if (request.method === 'POST' && url.pathname === '/api/configs') {
      const name = definitionName((await body(request)).name); const path = definitionPath(name);
      try { await readFile(path); throw new Error('A YAML definition with that name already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await writeFile(path, criteriaToYaml({ locations: ['Brisbane QLD 4000'], transactionType: 'buy', sort: 'newest' }));
      return json(response, 201, await readConfig(name));
    }
    if (request.method === 'POST' && ['/api/yaml', '/api/search'].includes(url.pathname)) {
      const input = await body(request); const name = definitionName(input.name); const criteria = formToCriteria(input.form ?? {}); const yaml = criteriaToYaml(criteria); const parsed = parseCriteriaYaml(yaml);
      if (url.pathname === '/api/yaml') { await writeFile(definitionPath(name), yaml); return json(response, 200, { name, yaml, form: criteriaToForm(parsed), lastResult: latestResult(name) }); }
      return json(response, 200, { name, yaml, result: await run(parsed, name, Boolean(input.debug)) });
    }
    if (request.method === 'GET') {
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1); const path = resolve(publicDir, file);
      if (!path.startsWith(`${publicDir}/`)) return json(response, 403, { error: 'Forbidden' });
      const data = await readFile(path); response.writeHead(200, { 'Content-Type': contentTypes[extname(path)] ?? 'application/octet-stream' }); response.end(data); return;
    }
    json(response, 404, { error: 'Not found' });
  } catch (error) { json(response, 400, { error: error.message ?? 'Unexpected error' }); }
});
server.listen(port, '127.0.0.1', () => console.log(`Property Search UI: http://localhost:${port}\nDefinitions: ${definitionsDir}`));
