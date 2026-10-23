import { timingSafeEqual } from "node:crypto";
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify, type KeyLike, type JWTPayload } from "jose";
import { ConfigError, LinkError } from "./errors";
import { UserInfoTransport } from "./internal/userinfo";
import { LoginService } from "./userinfo/service";
import type { LoginUserInfo, UserInfoOptions } from "./userinfo/types";
import type { FetchLike } from "./options";
import { VERSION } from "./version";

export class IDTokenError extends LinkError {
  constructor() { super("ID token validation failed"); }
}
export class LoginKeySourceError extends LinkError {
  constructor() { super("Login signing keys unavailable"); }
}

export interface LoginConfig {
  /** Exact trusted issuer from Console; never read this from an incoming token. */
  issuer: string;
  /** Regional API origin. Defaults to issuer. */
  apiBaseUrl?: string;
  /** This backend's allowed public Login client IDs, not an OTP client ID. */
  clientIds: readonly string[];
  fetch?: FetchLike;
}
export interface IDTokenClaims {
  readonly issuer: string;
  readonly sub: string;
  readonly clientId: string;
  readonly nonce: string;
  /** Unix seconds. */
  readonly issuedAt: number;
  readonly expiresAt: number;
}
export interface VerifyIDTokenOptions {
  /** Expected value saved by the backend before sign-in, not supplied with the token. */
  nonce: string;
  signal?: AbortSignal;
}

function origin(raw: string): string {
  try {
    const u = new URL(raw);
    if (typeof raw !== "string" || /[\s\\?#]/.test(raw) || u.username || u.password ||
        ![u.origin, `${u.origin}/`].includes(raw) ||
        !(u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))) throw new Error();
    return u.origin;
  } catch { throw new ConfigError("invalid Login configuration"); }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LoginKeySourceError();
  return value as Record<string, unknown>;
}
function wait<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new IDTokenError()); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    if (signal.aborted) { void promise.catch(() => {}); reject(new IDTokenError()); return; }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

/** Standalone Login verification/UserInfo. No private key or app credentials. */
export class LoginClient {
  private readonly issuer: string;
  private readonly base: string;
  private readonly clients: Set<string>;
  private readonly fetch: FetchLike;
  private readonly userInfo: LoginService;
  private keys = new Map<string, KeyLike | Uint8Array>();
  private expires = 0;
  private nextFetch = 0;
  private loading?: Promise<void>;
  private keyError?: LoginKeySourceError;

  constructor(config: LoginConfig) {
    this.issuer = origin(config.issuer);
    this.base = origin(config.apiBaseUrl ?? config.issuer);
    if (config.issuer !== this.issuer || !Array.isArray(config.clientIds) || !config.clientIds.length || config.clientIds.length > 32 ||
        config.clientIds.some(id => typeof id !== "string" || !id || id.length > 40 || id.trim() !== id)) throw new ConfigError("invalid Login configuration");
    this.clients = new Set(config.clientIds);
    this.fetch = config.fetch ?? globalThis.fetch;
    this.userInfo = new LoginService(new UserInfoTransport({
      baseUrl: this.base, fetchImpl: this.fetch, timeoutMs: 5000, userAgent: `link-console-sdk-node/${VERSION}`,
    }));
  }

  getUserInfo(accessToken: string, options: UserInfoOptions = {}): Promise<LoginUserInfo> {
    return this.userInfo.getUserInfo(accessToken, options);
  }

  /** The caller must also atomically consume its saved login challenge once. */
  async verifyIdToken(token: string, options: VerifyIDTokenOptions): Promise<IDTokenClaims> {
    const nonce = options?.nonce;
    const signal = options?.signal;
    if (signal?.aborted || typeof token !== "string" || token.length > 8192 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ||
        typeof nonce !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(nonce)) throw new IDTokenError();
    let kid: string;
    try {
      const header = decodeProtectedHeader(token);
      if (header.alg !== "EdDSA" || header.typ !== "JWT" || typeof header.kid !== "string" || !header.kid || header.kid.length > 128 ||
          ["crit", "b64", "jku", "jwk", "x5u", "x5c"].some(k => k in header)) throw new IDTokenError();
      kid = header.kid;
      this.identity(decodeJwt(token), nonce);
    } catch { throw new IDTokenError(); }
    const key = await this.key(kid, signal);
    try {
      const { payload } = await jwtVerify(token, key, {
        algorithms: ["EdDSA"], typ: "JWT", issuer: this.issuer, audience: [...this.clients],
        clockTolerance: 30, requiredClaims: ["sub", "iat", "exp", "azp", "nonce"],
      });
      if (signal?.aborted) throw new IDTokenError();
      return this.identity(payload, nonce);
    } catch { throw new IDTokenError(); }
  }

  private identity(p: JWTPayload, nonce: string): IDTokenClaims {
    const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
    const now = Date.now() / 1000;
    if (p.iss !== this.issuer || typeof p.sub !== "string" || !p.sub || Buffer.byteLength(p.sub) > 255 ||
        aud.length !== 1 || typeof aud[0] !== "string" || !this.clients.has(aud[0]) || p.azp !== aud[0] ||
        "token_use" in p || typeof p.nonce !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(p.nonce) ||
        p.nonce.length !== nonce.length || !timingSafeEqual(Buffer.from(p.nonce), Buffer.from(nonce)) ||
        !Number.isSafeInteger(p.iat) || !Number.isSafeInteger(p.exp) || p.iat! <= 0 || p.exp! <= p.iat! ||
        p.iat! > now + 30 || p.exp! <= now - 30 ||
        (p.nbf !== undefined && (!Number.isSafeInteger(p.nbf) || p.nbf < 0 || p.nbf > now + 30))) throw new IDTokenError();
    return Object.freeze({ issuer: this.issuer, sub: p.sub, clientId: aud[0], nonce: p.nonce, issuedAt: p.iat!, expiresAt: p.exp! });
  }

  private async key(kid: string, signal?: AbortSignal): Promise<KeyLike | Uint8Array> {
    if (signal?.aborted) throw new IDTokenError();
    let key = this.keys.get(kid);
    if (key && Date.now() < this.expires) return key;
    if (!this.loading) {
      if (Date.now() < this.nextFetch) throw this.keyError ?? new IDTokenError();
      const started = Date.now();
      this.loading = this.loadKeys().then(keys => {
        this.keys = keys; this.expires = started + 300_000; this.nextFetch = started + 30_000; this.keyError = undefined;
      }).catch(() => {
        this.nextFetch = Date.now() + 1000; this.keyError = new LoginKeySourceError(); throw this.keyError;
      }).finally(() => { this.loading = undefined; });
    }
    await wait(this.loading, signal);
    key = this.keys.get(kid);
    if (!key) throw new IDTokenError();
    return key;
  }

  private async loadKeys(): Promise<Map<string, KeyLike | Uint8Array>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const discovery = await this.publicJSON(`${this.base}/.well-known/openid-configuration`, controller.signal);
      if (discovery.issuer !== this.issuer || discovery.jwks_uri !== `${this.base}/oauth/v1/jwks.json` ||
          !Array.isArray(discovery.id_token_signing_alg_values_supported) || !discovery.id_token_signing_alg_values_supported.includes("EdDSA")) throw new LoginKeySourceError();
      const set = await this.publicJSON(discovery.jwks_uri, controller.signal);
      if (!Array.isArray(set.keys) || !set.keys.length || set.keys.length > 32) throw new LoginKeySourceError();
      const keys = new Map<string, KeyLike | Uint8Array>();
      for (const raw of set.keys) {
        const k = record(raw);
        if (typeof k.kid !== "string" || !k.kid || k.kid.length > 128 || keys.has(k.kid) ||
            k.kty !== "OKP" || k.crv !== "Ed25519" || k.alg !== "EdDSA" || k.use !== "sig" || "d" in k ||
            typeof k.x !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(k.x) || Buffer.from(k.x, "base64url").toString("base64url") !== k.x ||
            (k.key_ops !== undefined && (!Array.isArray(k.key_ops) || k.key_ops.length !== 1 || k.key_ops[0] !== "verify"))) throw new LoginKeySourceError();
        keys.set(k.kid, await importJWK({ kty: "OKP", crv: "Ed25519", x: k.x, alg: "EdDSA", use: "sig" }, "EdDSA"));
      }
      return keys;
    } finally { clearTimeout(timer); controller.abort(); }
  }

  private async publicJSON(url: string, signal: AbortSignal): Promise<Record<string, unknown>> {
    const response = await this.fetch(url, {
      method: "GET", headers: { Accept: "application/json", "User-Agent": `link-console-sdk-node/${VERSION}` },
      credentials: "omit", redirect: "error", signal,
    });
    if (response.status !== 200 || response.redirected || (response.url && response.url !== url) ||
        response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" ||
        Number(response.headers.get("content-length")) > 65536 || !response.body) throw new LoginKeySourceError();
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 65536) throw new LoginKeySourceError();
        parts.push(value);
      }
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    return record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts))));
  }
}
