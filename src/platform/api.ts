import type { ApiErrorBody, ApiResult, SessionDTO } from '../../shared/platform.ts';

export class ApiError extends Error {
  status: number; code: string; fields?: Record<string, string[]>;
  constructor(status: number, code: string, message: string, fields?: Record<string, string[]>) { super(message); this.name = 'ApiError'; this.status = status; this.code = code; this.fields = fields; }
}
type Listener = (session: SessionDTO | null) => void;
/** All user data is memory-only. Cookies are HttpOnly and owned by the API. */
export class PlatformApi {
  session: SessionDTO | null = null;
  private listeners = new Set<Listener>();
  private transport: typeof fetch;
  constructor(transport: typeof fetch = (...args) => fetch(...args)) { this.transport = transport; }
  subscribe(listener: Listener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  adopt(session: SessionDTO | null) { this.session = session; for (const listener of this.listeners) listener(session); }
  async refreshSession(signal?: AbortSignal) {
    const result = await this.request<SessionDTO>('/auth/session', { signal });
    this.adopt(result.data); return result.data;
  }
  async request<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<ApiResult<T>> {
    const method = options.method ?? 'GET';
    if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (method !== 'GET' && !this.session?.csrfToken) await this.refreshSession(options.signal);
    const controller = new AbortController();
    const cancel = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), 15000);
    try {
      const multipart = options.body instanceof FormData;
      const response = await this.transport(`/api/v1${path}`, {
        method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', ...(options.body !== undefined && !multipart ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-CSRF-Token': this.session!.csrfToken } : {}) },
        body: options.body === undefined ? undefined : multipart ? options.body as FormData : JSON.stringify(options.body),
      });
      const payload = await response.json().catch(() => null) as ApiResult<T> | ApiErrorBody | null;
      if (!response.ok) {
        if (response.status === 401) this.adopt(null);
        const error = payload && 'error' in payload ? payload.error : null;
        throw new ApiError(response.status, error?.code ?? 'UNAVAILABLE', error?.message ?? '服务暂时不可用，请稍后重试。', error?.fieldErrors);
      }
      if (!payload || !('data' in payload)) throw new ApiError(503, 'INVALID_RESPONSE', '服务返回了无法识别的数据，请重试。');
      return payload;
    } catch (error) {
      if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (error instanceof ApiError) throw error;
      if (controller.signal.aborted) throw new ApiError(408, 'TIMEOUT', '连接超时，请重试。');
      throw new ApiError(503, 'UNAVAILABLE', '无法连接 IXD 服务，请检查本地 API 是否启动。');
    } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', cancel); }
  }
  async logout() {
    await this.request('/auth/logout', { method: 'POST', body: {} });
    this.adopt(null); await this.refreshSession();
  }
}
export const platformApi = new PlatformApi();
export const errorMessage = (error: unknown) => error instanceof ApiError && error.fields ? `${error.message} ${Object.values(error.fields).flat().join('；')}` : error instanceof Error ? error.message : '操作失败，请重试。';
