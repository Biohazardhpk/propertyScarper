import { ProviderError, ProviderTimeoutError, ProviderUnavailableError } from '../../core/errors.js';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class RemoteReaProvider {
  constructor(options = {}) {
    this.name = 'rea';
    this.baseUrl = String(options.baseUrl ?? process.env.PROPERTY_SEARCH_REA_WORKER_URL ?? '').replace(/\/$/, '');
    this.token = options.token ?? process.env.PROPERTY_SEARCH_REA_WORKER_TOKEN;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.pollMs = Number(options.pollMs ?? process.env.PROPERTY_SEARCH_REA_WORKER_POLL ?? 2000);
    const timeoutMs = Number(options.timeoutMs ?? process.env.PROPERTY_SEARCH_REA_WORKER_TIMEOUT ?? 0);
    this.timeoutMs = timeoutMs > 0 ? timeoutMs : Infinity;
  }

  async request(path, options = {}) {
    if (!this.baseUrl) throw new ProviderUnavailableError('REA worker is not configured; set PROPERTY_SEARCH_REA_WORKER_URL');
    if (!this.token) throw new ProviderError('REA worker requires PROPERTY_SEARCH_REA_WORKER_TOKEN', 'AUTHENTICATION_REQUIRED');
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, 60000)),
      });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new ProviderTimeoutError('REA worker request timed out');
      throw new ProviderUnavailableError(`REA worker request failed: ${error.message}`);
    }
    if (response.status === 204) return undefined;
    const text = await response.text(); let data;
    try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
    if (!response.ok) throw new ProviderUnavailableError(`REA worker returned HTTP ${response.status}${data?.error ? `: ${data.error}` : ''}`);
    return data;
  }

  async search(criteria, options = {}) {
    const notify = typeof options.onEvent === 'function' ? options.onEvent : () => {};
    const created = await this.request('/api/rea-worker/jobs', { method: 'POST', body: JSON.stringify({ criteria }) });
    if (!created?.jobId) throw new ProviderError('REA worker did not return a job ID', 'PARSING');
    notify({ type: 'request', message: `REA: queued local Chrome job ${created.jobId}.` });
    const deadline = Number.isFinite(this.timeoutMs) ? Date.now() + this.timeoutMs : Infinity; let eventIndex = 0;
    while (Date.now() < deadline) {
      const status = await this.request(`/api/rea-worker/jobs/${encodeURIComponent(created.jobId)}?after=${eventIndex}`);
      for (const event of status?.events ?? []) { notify(event); eventIndex++; }
      if (status?.state === 'SUCCEEDED') return status.listings ?? [];
      if (status?.state === 'FAILED') throw new ProviderUnavailableError(status.error?.message ?? 'Local REA worker failed');
      await wait(this.pollMs);
    }
    throw new ProviderTimeoutError(`Local REA worker did not finish within ${this.timeoutMs}ms`);
  }
}
