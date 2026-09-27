import type { SafeUser } from '../../shared/platform.ts';
export interface Credentials { account: string; password: string }
export type AuthResult = { ok: true; identity: SafeUser } | { ok: false; code: 'INVALID_IDENTITY' | 'UNAVAILABLE' | 'TIMEOUT' | 'FORBIDDEN' | 'RATE_LIMITED'; message?: string };
export interface AuthService { authenticate(credentials: Credentials, signal?: AbortSignal): Promise<AuthResult> }
