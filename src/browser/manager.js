import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ProviderBlockedError, ProviderTimeoutError, ProviderUnavailableError } from '../core/errors.js';

const blocked = (status, title, html) => status === 429 || html.length < 5000 || !title.trim() || /access denied|pardon our interruption/i.test(title);

export class BrowserManager {
  constructor(options = {}) { this.profile = resolve(options.profile ?? process.env.PROPERTY_SEARCH_PROFILE ?? '.property-search-profile'); this.channel = process.env.PROPERTY_SEARCH_BROWSER_CHANNEL ?? 'chrome'; this.headless = options.headless ?? process.env.PROPERTY_SEARCH_HEADED !== '1'; this.timeout = Number(process.env.PROPERTY_SEARCH_TIMEOUT ?? 60000); this.idleMs = Number(process.env.PROPERTY_SEARCH_BROWSER_IDLE ?? 30000); this.inFlight = 0; }
  async launch(headless = this.headless) {
    if (this.context) return this.context;
    if (this.launching) return this.launching;
    this.launching = (async () => { try { const { chromium } = await import('patchright'); await mkdir(this.profile, { recursive: true }); const userAgent = process.env.PROPERTY_SEARCH_USER_AGENT; this.context = await chromium.launchPersistentContext(this.profile, { channel: this.channel, headless, locale: 'en-AU', timezoneId: 'Australia/Brisbane', viewport: { width: 1440, height: 900 }, ...(userAgent ? { userAgent } : {}) }); this.context.on('close', () => { this.context = undefined; }); return this.context; }
      catch (error) { if (/ProcessSingleton|already.*(?:use|running)/i.test(error.message)) throw new ProviderUnavailableError(`Browser profile is already in use: ${this.profile}`); throw new ProviderUnavailableError(`Could not launch installed Chrome through Patchright: ${error.message}`); }
      finally { this.launching = undefined; } })();
    return this.launching;
  }
  async fetchPage(url, { provider, debugDir, settleMs = 3000 } = {}) {
    this.inFlight++; const context = await this.launch(); const page = await context.newPage(); let status = null; const payloads = []; page.setDefaultTimeout(this.timeout);
    page.on('response', async (response) => { if (response.request().resourceType() === 'document') status = response.status(); if (debugDir && /json|graphql/i.test(response.headers()['content-type'] ?? '')) { try { if (payloads.length < 25) payloads.push({ url: response.url(), status: response.status(), body: await response.text() }); } catch {} } });
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeout }); await page.waitForTimeout(settleMs); const [title, html] = await Promise.all([page.title(), page.content()]); if (debugDir) { await mkdir(debugDir, { recursive: true }); await Promise.all([writeFile(`${debugDir}/page.html`, html), writeFile(`${debugDir}/network.json`, JSON.stringify(payloads, null, 2)), page.screenshot({ path: `${debugDir}/page.png`, fullPage: true })]); } if (blocked(status, title, html)) throw new ProviderBlockedError(`${provider} returned a bot-protection page (HTTP ${status ?? '?'}, ${html.length} bytes)`); return { html, title, status, url: page.url() }; }
    catch (error) { if (error.code) throw error; if (/timeout/i.test(error.message)) throw new ProviderTimeoutError(`${provider} timed out loading ${url}`); throw new ProviderUnavailableError(`${provider} could not load ${url}: ${error.message}`); }
    finally { await page.close().catch(() => {}); this.inFlight--; this.scheduleClose(); }
  }
  scheduleClose() { clearTimeout(this.timer); this.timer = setTimeout(() => { if (!this.inFlight) void this.close(); }, this.idleMs); this.timer.unref?.(); }
  async warmUp() { await this.close(); this.headless = false; const context = await this.launch(false); const page = await context.newPage(); try { await page.goto('https://www.realestate.com.au/', { waitUntil: 'domcontentloaded', timeout: this.timeout }); await page.waitForTimeout(8000); const result = await this.fetchPage('https://www.realestate.com.au/buy/in-narangba,+qld+4504/list-1', { provider: 'rea', settleMs: 6000 }); return result.title; } finally { await page.close().catch(() => {}); await this.close(); } }
  async close() { clearTimeout(this.timer); if (this.launching) await this.launching.catch(() => {}); const context = this.context; this.context = undefined; await context?.close().catch(() => {}); }
}
