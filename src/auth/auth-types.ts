export interface Credentials {
  account: string;
  password: string;
}
export interface DemoIdentity {
  id: string;
  displayName: string;
  kind: "frontend-demo";
}
export type AuthResult =
  | { ok: true; identity: DemoIdentity }
  | { ok: false; code: "INVALID_IDENTITY" | "UNAVAILABLE" };
/** Replace this adapter with a backend API. Client state is never authorization. */
export interface AuthService {
  authenticate(
    credentials: Credentials,
    signal?: AbortSignal,
  ): Promise<AuthResult>;
}
