import { type KeyObject } from "node:crypto";

import { ApiError, AuthenticationError, ConnectionError } from "../errors";
import type { FetchLike } from "../options";
import { loadEd25519PrivateKey, randomJti, signEdDSAJWT } from "./jwt";

const GRANT = "client_credentials";
const ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const ASSERTION_TTL_SEC = 300;
const EXPIRY_SKEW_SEC = 30;

export interface TokenSourceConfig {
  tokenUrl: string;
  clientId: string;
  issuer: string;
  privateKeyPem: string;
  scope: string;
  userAgent: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
  /** Unix-seconds clock (injectable for tests). */
  now?: () => number;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

/**
 * Mints a client_assertion (private_key_jwt) and exchanges it at the token
 * endpoint (grant client_credentials) for a short-lived app access token,
 * caching it until expiry. Firebase Admin SDK model: the private key stays on
 * the backend, so a fresh token can be minted at any time — no refresh token.
 * See docs/console/api-auth/design.md §4.1.
 */
export class TokenSource {
  private readonly key: KeyObject;
  private readonly now: () => number;
  private token = "";
  private expiry = 0;
  private inflight: Promise<string> | null = null;

  constructor(private readonly cfg: TokenSourceConfig) {
    this.key = loadEd25519PrivateKey(cfg.privateKeyPem);
    this.now = cfg.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async getToken(signal?: AbortSignal): Promise<string> {
    const now = this.now();
    if (this.token && now < this.expiry) return this.token;
    // Dedupe concurrent refreshes so a burst of calls mints a single token.
    if (this.inflight) return this.inflight;
    this.inflight = this.refresh(now, signal).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** Drops the cached token — called on a 401 so the next call re-mints. */
  invalidate(): void {
    this.token = "";
    this.expiry = 0;
  }

  private buildAssertion(now: number): string {
    return signEdDSAJWT(this.key, {
      iss: this.cfg.clientId,
      sub: this.cfg.clientId,
      aud: this.cfg.issuer,
      iat: now,
      exp: now + ASSERTION_TTL_SEC,
      jti: randomJti(),
    });
  }

  private async refresh(now: number, signal?: AbortSignal): Promise<string> {
    const form = new URLSearchParams({
      grant_type: GRANT,
      client_assertion_type: ASSERTION_TYPE,
      client_assertion: this.buildAssertion(now),
      client_id: this.cfg.clientId,
    });
    if (this.cfg.scope) form.set("scope", this.cfg.scope);

    const resp = await this.fetchWithTimeout(form.toString(), signal);
    const text = await resp.text();
    let parsed: TokenResponse = {};
    try {
      parsed = JSON.parse(text) as TokenResponse;
    } catch {
      // keep empty — handled below
    }

    if (!resp.ok) throw this.tokenError(resp, parsed);
    if (!parsed.access_token) {
      throw new AuthenticationError({
        statusCode: resp.status,
        message: "token endpoint returned no access_token",
      });
    }
    const ttl = Number(parsed.expires_in) || 0;
    this.token = parsed.access_token;
    this.expiry = now + Math.max(0, ttl - EXPIRY_SKEW_SEC);
    return this.token;
  }

  /** 5xx/408/429 → retryable ApiError; 4xx (invalid_client/…) → AuthenticationError. */
  private tokenError(resp: Response, parsed: TokenResponse): Error {
    const message =
      parsed.error_description || parsed.error || resp.statusText || `HTTP ${resp.status}`;
    const init = {
      statusCode: resp.status,
      code: parsed.error ? parsed.error.toUpperCase() : undefined,
      message,
      requestId: resp.headers.get("x-request-id") ?? undefined,
    };
    if (resp.status >= 500 || resp.status === 408 || resp.status === 429) {
      return new ApiError(init);
    }
    return new AuthenticationError(init);
  }

  private async fetchWithTimeout(body: string, externalSignal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort(externalSignal?.reason);
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.cfg.timeoutMs);

    if (externalSignal) {
      if (externalSignal.aborted) controller.abort(externalSignal.reason);
      else externalSignal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      return await this.cfg.fetchImpl(this.cfg.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": this.cfg.userAgent,
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut) {
        throw new ConnectionError(`token request timed out after ${this.cfg.timeoutMs}ms`, {
          cause: err,
        });
      }
      throw new ConnectionError("token request failed", { cause: err });
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onAbort);
    }
  }
}
