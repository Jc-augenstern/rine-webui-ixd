import { DEV_AUTH } from "./dev-auth-config.ts";
import type { AuthService } from "./auth-types.ts";

/** Development demonstration only. No session token, real account or protected data. */
export const demoAuthService: AuthService = {
  async authenticate(credentials, signal) {
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException("Cancelled", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, DEV_AUTH.responseDelayMs);
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
    if (
      credentials.account.trim() !== DEV_AUTH.account ||
      credentials.password !== DEV_AUTH.password
    ) {
      return { ok: false, code: "INVALID_IDENTITY" };
    }
    return {
      ok: true,
      identity: {
        id: DEV_AUTH.account,
        displayName: DEV_AUTH.displayName,
        kind: "frontend-demo",
      },
    };
  },
};

// A real integration only needs to replace this dependency with an API adapter.
export const authService: AuthService = demoAuthService;
