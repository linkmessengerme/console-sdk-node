import { createHash, randomBytes, randomUUID } from "node:crypto";

const CHALLENGE_TTL = 300, ACCESS_TTL = 900, SESSION_TTL = 30 * 86400;
const CAPACITY = 1000, MAX_ROTATIONS = 128;
const secret = () => randomBytes(32).toString("base64url");
const hash = value => createHash("sha256").update(value).digest("hex");
const valid = (value, pattern) => typeof value === "string" && pattern.test(value);

export class AuthFailure extends Error {
  constructor(code = "invalid_credentials", status = 401) {
    super(code); this.code = code; this.status = status;
  }
}

/**
 * Runnable SINGLE-PROCESS example. Replace the maps with transactional storage
 * before running multiple workers. Challenges and refresh tokens need atomic
 * consumption. Only hashes of opaque app tokens are stored.
 */
export class AppAuth {
  constructor(link, now = () => Math.floor(Date.now() / 1000)) {
    this.link = link; this.now = now;
    this.challenges = new Map(); this.users = new Map(); this.sessions = new Map();
    this.access = new Map(); this.refresh = new Map();
  }

  prune() {
    const now = this.now();
    for (const [id, challenge] of this.challenges) if (challenge.expiresAt <= now) this.challenges.delete(id);
    for (const session of this.sessions.values()) if (session.expiresAt <= now) this.revoke(session);
  }

  challenge() {
    this.prune();
    if (this.challenges.size >= CAPACITY) throw new AuthFailure("try_later", 503);
    const challenge_id = secret(), nonce = secret();
    this.challenges.set(hash(challenge_id), { nonce, expiresAt: this.now() + CHALLENGE_TTL });
    return { challenge_id, nonce, expires_in: CHALLENGE_TTL };
  }

  async signIn({ challenge_id, id_token, access_token }) {
    this.prune();
    if (!valid(challenge_id, /^[A-Za-z0-9_-]{43}$/) || typeof id_token !== "string" ||
        !id_token || id_token.length > 8192 || typeof access_token !== "string" ||
        !access_token || access_token.length > 8192) throw new AuthFailure("invalid_request", 400);
    const key = hash(challenge_id), challenge = this.challenges.get(key);
    // Consume BEFORE the first await: concurrent submissions cannot both sign in.
    // Any failure requires a fresh challenge and fresh Link sign-in.
    this.challenges.delete(key);
    if (!challenge) throw new AuthFailure("invalid_challenge");
    const identity = await this.link.verifyIdToken(id_token, { nonce: challenge.nonce });
    const profile = await this.link.getUserInfo(access_token, { expectedSub: identity.sub });
    if (challenge.expiresAt <= this.now()) throw new AuthFailure("invalid_challenge");
    // This example's application requires a phone. Never invent verified=true.
    if (!profile.phoneNumber) throw new AuthFailure("phone_required", 403);

    // A phone/username is mutable. Use verified issuer+subject as the account key.
    const userKey = JSON.stringify([identity.issuer, identity.sub]);
    if (this.sessions.size >= CAPACITY || (!this.users.has(userKey) && this.users.size >= CAPACITY))
      throw new AuthFailure("try_later", 503);
    const user = Object.freeze({
      id: this.users.get(userKey)?.id ?? randomUUID(), name: profile.name,
      preferred_username: profile.preferredUsername, picture: profile.picture,
      phone_number: profile.phoneNumber, phone_number_verified: profile.phoneNumberVerified,
    });
    this.users.set(userKey, user);
    const session = { id: randomUUID(), userKey, expiresAt: this.now() + SESSION_TTL,
      accessHash: undefined, refreshHash: undefined, refreshHashes: new Set(), accessExpiresAt: 0 };
    const result = this.issue(session);
    this.sessions.set(session.id, session);
    // No Link ID/access/refresh tokens are retained in the application session.
    return result;
  }

  issue(session) {
    const access_token = `app_at_${secret()}`, refresh_token = `app_rt_${secret()}`;
    const accessHash = hash(access_token), refreshHash = hash(refresh_token);
    if (session.accessHash) this.access.delete(session.accessHash);
    session.accessHash = accessHash; session.refreshHash = refreshHash;
    session.accessExpiresAt = Math.min(this.now() + ACCESS_TTL, session.expiresAt);
    session.refreshHashes.add(refreshHash);
    this.access.set(accessHash, session); this.refresh.set(refreshHash, session);
    return { token_type: "Bearer", access_token, refresh_token,
      expires_in: session.accessExpiresAt - this.now(), refresh_expires_in: session.expiresAt - this.now(),
      user: this.users.get(session.userKey) };
  }

  rotate(refreshToken) {
    this.prune();
    if (!valid(refreshToken, /^app_rt_[A-Za-z0-9_-]{43}$/)) throw new AuthFailure();
    const key = hash(refreshToken), session = this.refresh.get(key);
    if (!session) throw new AuthFailure();
    // Keep consumed refresh hashes until the family's absolute expiration.
    // Reuse invalidates the entire family, including its newest access token.
    if (key !== session.refreshHash || session.refreshHashes.size >= MAX_ROTATIONS) {
      this.revoke(session); throw new AuthFailure();
    }
    // Synchronous atomic transition in this one-process demo; no await here.
    return this.issue(session);
  }

  sessionFor(accessToken) {
    this.prune();
    if (!valid(accessToken, /^app_at_[A-Za-z0-9_-]{43}$/)) throw new AuthFailure();
    const session = this.access.get(hash(accessToken));
    if (!session || session.accessExpiresAt <= this.now()) throw new AuthFailure();
    return session;
  }

  me(accessToken) { return this.users.get(this.sessionFor(accessToken).userKey); }
  logout(accessToken) { this.revoke(this.sessionFor(accessToken)); }

  revoke(session) {
    this.sessions.delete(session.id);
    if (session.accessHash) this.access.delete(session.accessHash);
    for (const key of session.refreshHashes) this.refresh.delete(key);
  }
}
