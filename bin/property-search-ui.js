#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
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
import { RemoteReaProvider } from '../src/providers/rea/remote.js';

try { loadEnvFile(resolve('.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const initialCriteriaPath = resolve(process.argv[2] ?? 'examples/north-brisbane-under_800k.yaml');
const definitionsDir = dirname(initialCriteriaPath);
const publicDir = resolve('src/web/public');
const port = Number(process.env.PORT || 8080);
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const json = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
const body = async (request) => new Promise((resolveBody, reject) => { let input = ''; request.on('data', (chunk) => { input += chunk; if (input.length > 1_000_000) reject(new Error('Request is too large')); }); request.on('end', () => { try { resolveBody(JSON.parse(input || '{}')); } catch { reject(new Error('Request body must be valid JSON')); } }); request.on('error', reject); });
const definitionName = (value = basename(initialCriteriaPath)) => { const name = basename(String(value)); if (!/^[\w.-]+\.ya?ml$/i.test(name)) throw new Error('Choose a YAML filename ending in .yaml or .yml'); return name; };
const definitionPath = (name) => resolve(definitionsDir, definitionName(name));
const databasePath = () => process.env.PROPERTY_SEARCH_DB ?? 'data/property-search.sqlite';
const latestResult = (name, sort = 'newest') => { const store = new SQLiteStore(databasePath()); try { return store.loadSnapshot(name, sort); } finally { store.close(); } };
async function listDefinitions() { return (await readdir(definitionsDir)).filter((name) => /\.ya?ml$/i.test(name)).sort(); }
async function readConfig(name) { const safeName = definitionName(name); const yaml = await readFile(definitionPath(safeName), 'utf8'); return { name: safeName, yaml, form: criteriaToForm(parseCriteriaYaml(yaml)), lastResult: latestResult(safeName) }; }
async function run(criteria, name, debug = false, onEvent) {
  let browser; let store;
  try {
    const useRemoteRea = Boolean(process.env.PROPERTY_SEARCH_REA_WORKER_URL);
    if (!useRemoteRea) browser = new BrowserManager();
    store = new SQLiteStore(databasePath());
    const debugRoot = debug ? `.debug/${new Date().toISOString().replace(/[:.]/g, '-')}` : undefined;
    const rea = useRemoteRea ? new RemoteReaProvider() : new ReaProvider({ manager: browser, debugRoot });
    const result = await new SearchService([rea, new DomainProvider()], store).search(criteria, { onEvent });
    store.saveSnapshot(name, result);
    return result;
  } finally { await browser?.close(); store?.close(); }
}
const jobs = new Map();
const sendEvent = (response, event) => { if (!response.writableEnded) response.write(`data: ${JSON.stringify(event)}\n\n`); };
const publish = (job, event) => {
  job.progress = Math.max(job.progress, Number(event.progress ?? job.progress));
  const item = { ...event, progress: job.progress, timestamp: new Date().toISOString() };
  job.events.push(item); if (job.events.length > 100) job.events.shift();
  for (const response of job.listeners) { try { sendEvent(response, item); } catch { job.listeners.delete(response); } }
};
const finish = (job) => { job.done = true; for (const response of job.listeners) { try { response.end(); } catch {} } job.listeners.clear(); const cleanup = setTimeout(() => jobs.delete(job.id), 10 * 60 * 1000); cleanup.unref?.(); };
const startJob = (criteria, name, yaml, debug) => {
  const job = { id: randomUUID(), events: [], listeners: new Set(), progress: 0, done: false };
  jobs.set(job.id, job); publish(job, { type: 'queued', progress: 0, message: 'Search queued.' });
  void (async () => {
    try {
      const result = await run(criteria, name, debug, (event) => publish(job, event));
      publish(job, { type: 'complete', progress: 100, message: 'Search complete.', result: { name, yaml, result } });
    } catch (error) { publish(job, { type: 'error', progress: 100, message: error.message ?? 'Search failed.' }); }
    finally { finish(job); }
  })();
  return job;
};
const reaWorkerJobs = new Map();
const workerAuthorized = (request) => Boolean(process.env.PROPERTY_SEARCH_REA_WORKER_TOKEN && request.headers.authorization === `Bearer ${process.env.PROPERTY_SEARCH_REA_WORKER_TOKEN}`);
const workerJobCleanup = (job) => { const cleanup = setTimeout(() => reaWorkerJobs.delete(job.id), 10 * 60 * 1000); cleanup.unref?.(); };
const workerJob = (id) => reaWorkerJobs.get(String(id));
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'GET' && url.pathname === '/healthz') { response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('ok'); return; }
    if (request.method === 'GET' && url.pathname === '/api/search/events') {
      const job = jobs.get(url.searchParams.get('job')); if (!job) return json(response, 404, { error: 'Search job not found' });
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' }); response.flushHeaders?.();
      job.events.forEach((event) => sendEvent(response, event));
      if (job.done) { response.end(); return; }
      job.listeners.add(response); request.on('close', () => job.listeners.delete(response)); return;
    }
    if (url.pathname.startsWith('/api/rea-worker/')) {
      if (!workerAuthorized(request)) return json(response, 401, { error: 'REA worker authentication failed' });
      if (request.method === 'POST' && url.pathname === '/api/rea-worker/jobs') {
        const input = await body(request); const job = { id: randomUUID(), criteria: input.criteria, state: 'QUEUED', events: [], listings: undefined, error: undefined, createdAt: Date.now() }; reaWorkerJobs.set(job.id, job); return json(response, 202, { jobId: job.id, state: job.state });
      }
      const nextMatch = url.pathname.match(/^\/api\/rea-worker\/jobs\/next$/);
      if (request.method === 'GET' && nextMatch) { const job = [...reaWorkerJobs.values()].find((candidate) => candidate.state === 'QUEUED'); if (!job) { response.writeHead(204); response.end(); return; } job.state = 'RUNNING'; return json(response, 200, { jobId: job.id, criteria: job.criteria }); }
      const jobMatch = url.pathname.match(/^\/api\/rea-worker\/jobs\/([^/]+)$/);
      if (jobMatch && request.method === 'GET') { const job = workerJob(jobMatch[1]); if (!job) return json(response, 404, { error: 'REA worker job not found' }); const after = Math.max(0, Number(url.searchParams.get('after') ?? 0)); return json(response, 200, { jobId: job.id, state: job.state, events: job.events.slice(after), listings: job.state === 'SUCCEEDED' ? job.listings : undefined, error: job.error }); }
      const eventMatch = url.pathname.match(/^\/api\/rea-worker\/jobs\/([^/]+)\/(events|result|error)$/);
      if (eventMatch && request.method === 'POST') { const job = workerJob(eventMatch[1]); if (!job) return json(response, 404, { error: 'REA worker job not found' }); const input = await body(request); if (eventMatch[2] === 'events') job.events.push({ ...input, timestamp: new Date().toISOString() }); if (eventMatch[2] === 'result') { job.listings = Array.isArray(input.listings) ? input.listings : []; job.state = 'SUCCEEDED'; workerJobCleanup(job); } if (eventMatch[2] === 'error') { job.error = { code: input.code ?? 'UNAVAILABLE', message: input.message ?? 'REA worker failed' }; job.state = 'FAILED'; workerJobCleanup(job); } return json(response, 202, { jobId: job.id, state: job.state }); }
      return json(response, 404, { error: 'REA worker route not found' });
    }
    if (request.method === 'GET' && url.pathname === '/api/readme') return json(response, 200, { markdown: await readFile(resolve('README.md'), 'utf8') });
    if (request.method === 'GET' && url.pathname === '/api/configs') return json(response, 200, { definitions: await listDefinitions(), current: basename(initialCriteriaPath) });
    if (request.method === 'GET' && url.pathname === '/api/config') return json(response, 200, await readConfig(url.searchParams.get('name') ?? undefined));
    if (request.method === 'GET' && url.pathname === '/api/results') {
      const name = definitionName(url.searchParams.get('name') ?? undefined);
      const requestedSort = url.searchParams.get('sort'); const sort = ['newest', 'oldest', 'score'].includes(requestedSort) ? requestedSort : 'newest';
      return json(response, 200, { name, sort, result: latestResult(name, sort) });
    }
    if (request.method === 'POST' && url.pathname === '/api/configs') {
      const name = definitionName((await body(request)).name); const path = definitionPath(name);
      try { await readFile(path); throw new Error('A YAML definition with that name already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await writeFile(path, criteriaToYaml({ locations: ['Brisbane QLD 4000'], transactionType: 'buy', sort: 'newest' }));
      return json(response, 201, await readConfig(name));
    }
    if (request.method === 'POST' && url.pathname === '/api/yaml') {
      const input = await body(request); const name = definitionName(input.name); const criteria = formToCriteria(input.form ?? {}); const yaml = criteriaToYaml(criteria); const parsed = parseCriteriaYaml(yaml);
      await writeFile(definitionPath(name), yaml); return json(response, 200, { name, yaml, form: criteriaToForm(parsed), lastResult: latestResult(name) });
    }
    if (request.method === 'POST' && url.pathname === '/api/search') {
      const input = await body(request); const name = definitionName(input.name); const criteria = formToCriteria(input.form ?? {}); const yaml = criteriaToYaml(criteria); const parsed = parseCriteriaYaml(yaml); const job = startJob(parsed, name, yaml, Boolean(input.debug));
      return json(response, 202, { jobId: job.id, name, yaml });
    }
    if (request.method === 'GET') {
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1); const path = resolve(publicDir, file);
      if (!path.startsWith(`${publicDir}/`)) return json(response, 403, { error: 'Forbidden' });
      const data = await readFile(path); response.writeHead(200, { 'Content-Type': contentTypes[extname(path)] ?? 'application/octet-stream' }); response.end(data); return;
    }
    json(response, 404, { error: 'Not found' });
  } catch (error) { json(response, 400, { error: error.message ?? 'Unexpected error' }); }
});
server.listen(port, '0.0.0.0', () => console.log(`Property Search UI: http://localhost:${port}\nDefinitions: ${definitionsDir}`));
