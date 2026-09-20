#!/usr/bin/env node
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { BrowserManager } from '../src/browser/manager.js';
import { ReaProvider } from '../src/providers/rea/provider.js';

try { loadEnvFile(resolve('.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }

const baseUrl = String(process.env.PROPERTY_SEARCH_REA_WORKER_URL ?? '').replace(/\/$/, '');
const token = process.env.PROPERTY_SEARCH_REA_WORKER_TOKEN;
const pollMs = Number(process.env.PROPERTY_SEARCH_REA_WORKER_POLL ?? 2000);
const requestTimeoutMs = Number(process.env.PROPERTY_SEARCH_REA_WORKER_HTTP_TIMEOUT ?? 60000);
const configuredProfile = process.env.PROPERTY_SEARCH_REA_WORKER_PROFILE ?? process.env.PROPERTY_SEARCH_PROFILE;
const profile = configuredProfile && !/^\/data(?:\/|$)/.test(configuredProfile) ? configuredProfile : '.property-search-profile';
if (configuredProfile && profile !== configuredProfile) console.warn(`Ignoring Railway-only Chrome profile path ${configuredProfile}; using ${profile} for the local worker.`);
if (!baseUrl || !token) throw new Error('Set PROPERTY_SEARCH_REA_WORKER_URL and PROPERTY_SEARCH_REA_WORKER_TOKEN before starting the REA worker');

const request = async (path, options = {}) => {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, signal: AbortSignal.timeout(requestTimeoutMs) });
  } catch (error) { throw new Error(`Railway worker request failed: ${error.message}`); }
  if (response.status === 204) return undefined;
  const text = await response.text(); let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  if (!response.ok) throw new Error(`Railway worker returned HTTP ${response.status}${data?.error ? `: ${data.error}` : ''}`);
  return data;
};
const postEvent = async (jobId, event) => { try { await request(`/api/rea-worker/jobs/${encodeURIComponent(jobId)}/events`, { method: 'POST', body: JSON.stringify(event) }); } catch (error) { console.error(error.message); } };
const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });

const browser = new BrowserManager({ profile });
const provider = new ReaProvider({ manager: browser });
console.log(`REA worker connected to ${baseUrl} using Chrome profile ${resolve(profile)}`);
while (!stopping) {
  try {
    const job = await request('/api/rea-worker/jobs/next');
    if (!job?.jobId) { await sleep(pollMs); continue; }
    await postEvent(job.jobId, { type: 'worker-start', message: 'REA worker: local Chrome started.' });
    try {
      let eventQueue = Promise.resolve();
      const emit = (event) => { eventQueue = eventQueue.then(() => postEvent(job.jobId, event)); };
      const listings = await provider.search(job.criteria, { onEvent: emit });
      await eventQueue;
      await request(`/api/rea-worker/jobs/${encodeURIComponent(job.jobId)}/result`, { method: 'POST', body: JSON.stringify({ listings }) });
    } catch (error) {
      await request(`/api/rea-worker/jobs/${encodeURIComponent(job.jobId)}/error`, { method: 'POST', body: JSON.stringify({ code: error.code ?? 'UNAVAILABLE', message: error.message }) }).catch((reportError) => console.error(reportError.message));
    }
  } catch (error) { console.error(error.message); await sleep(Math.max(pollMs, 5000)); }
}
await browser.close();
