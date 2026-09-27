import type { ApiResult, SessionDTO } from '../../shared/platform';

let csrfToken = '';
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fieldErrors?: Record<string, string[]>) { super(message); }
}
export function rememberSession(session: SessionDTO) { csrfToken = session.csrfToken; }
export async function api<T>(route: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<ApiResult<T>> {
  const method = options.method ?? 'GET';
  const form = options.body instanceof FormData;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined && !form) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrfToken;
  let response: Response;
  try {
    response = await fetch(`/api/v1${route}`, {
      method, headers, credentials: 'include', cache: 'no-store',
      body: options.body === undefined ? undefined : form ? options.body as FormData : JSON.stringify(options.body),
      signal: options.signal ?? AbortSignal.timeout(20_000),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(503, 'NETWORK_UNAVAILABLE', '无法连接 API，或请求已超时。请检查服务后重试；尚未确认保存成功。');
  }
  let result: any;
  try { result = await response.json(); }
  catch { throw new ApiError(response.status || 503, 'INVALID_RESPONSE', '服务未返回有效结果，请检查 API 状态后重试。'); }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('ixd:session-expired'));
    throw new ApiError(response.status, result.error?.code ?? 'REQUEST_FAILED', result.error?.message ?? '操作未完成，请重试。', result.error?.fieldErrors);
  }
  return result;
}
export async function getSession() { const { data } = await api<SessionDTO>('/auth/session'); rememberSession(data); return data; }
export function message(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return `${error.message} 当前输入已保留；请先复制需要保留的文字，再重新读取服务器版本后合并。`;
  if (error instanceof ApiError && error.fieldErrors) return [error.message, ...Object.entries(error.fieldErrors).map(([k, v]) => `${k}：${v.join('；')}`)].join('\n');
  return error instanceof Error ? error.message : '操作未完成，请重试。';
}
export function query(values: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  Object.entries(values).forEach(([k, v]) => { if (v !== undefined && v !== '') search.set(k, String(v)); });
  return search.toString();
}
