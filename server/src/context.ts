import type { Pool } from 'pg';
import type { SafeUser, EditorGrant } from '../../shared/platform.js';
import type { AppConfig } from './config.js';
export interface Actor { user: SafeUser; grants: EditorGrant[] }
export interface AppContext { db: Pool; config: AppConfig; now: () => Date }
declare module 'fastify' {
  interface FastifyRequest { actor: Actor | null }
  interface Session { userId?: string; userVersion?: number }
}
