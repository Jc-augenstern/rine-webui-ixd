import type { SessionDTO } from '../../shared/platform.ts';
import { PlatformApi, platformApi, ApiError } from '../platform/api.ts';
import type { AuthService } from './auth-types.ts';

/** An API failure is never converted into an authenticated local identity. */
export function createAuthService(api: PlatformApi): AuthService {
  return {
    async authenticate(credentials, signal) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (!credentials.account.trim() || !credentials.password) return { ok: false, code: 'INVALID_IDENTITY' };
      try {
        const { data } = await api.request<SessionDTO>('/auth/login', { method: 'POST', body: { account: credentials.account.trim(), password: credentials.password }, signal });
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (!data.user) return { ok: false, code: 'INVALID_IDENTITY' };
        api.adopt(data); return { ok: true, identity: data.user };
      } catch (error) {
        if (signal?.aborted || error instanceof DOMException && error.name === 'AbortError') throw error;
        if (error instanceof ApiError) return { ok: false, code: error.status === 401 ? 'INVALID_IDENTITY' : error.status === 403 ? 'FORBIDDEN' : error.status === 429 ? 'RATE_LIMITED' : error.status === 408 ? 'TIMEOUT' : 'UNAVAILABLE', message: error.message };
        return { ok: false, code: 'UNAVAILABLE' };
      }
    },
  };
}
export const authService = createAuthService(platformApi);
