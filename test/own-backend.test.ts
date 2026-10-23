import { describe, expect, it } from "vitest";
import { AppAuth, AuthFailure } from "../examples/own-backend/auth.mjs";
import { IDTokenError, InvalidResponseError } from "../src/index";
import { loginFixture } from "./login-fixture";

function setup() {
  const f = loginFixture();
  let now = Math.floor(Date.now() / 1000);
  const auth = new AppAuth(f.client, () => now);
  const advance = (seconds: number) => { now += seconds; };
  const request = async () => {
    const challenge = auth.challenge();
    return { challenge_id: challenge.challenge_id,
      id_token: await f.token({ nonce: challenge.nonce }), access_token: "user-access" };
  };
  return { ...f, auth, advance, request };
}

describe("own-backend example with real LoginClient and signed ID tokens", () => {
  it("exchanges identity and phone for independent opaque tokens, rotates and revokes on replay", async () => {
    const { auth, request } = setup();
    const input = await request();
    const session = await auth.signIn(input);
    expect(session).toMatchObject({ token_type: "Bearer", expires_in: 900, refresh_expires_in: 2592000,
      user: { name: "Test", phone_number: "+12025550123" } });
    expect(session.user.phone_number_verified).toBeUndefined();
    expect(session.access_token).toMatch(/^app_at_/); expect(session.refresh_token).toMatch(/^app_rt_/);
    expect(auth.me(session.access_token)).toEqual(session.user);
    await expect(auth.signIn(input)).rejects.toMatchObject({ code: "invalid_challenge" });
    const rotated = auth.rotate(session.refresh_token);
    expect(rotated.user.id).toBe(session.user.id);
    expect(rotated.access_token).not.toBe(session.access_token);
    expect(() => auth.me(session.access_token)).toThrow(AuthFailure);
    expect(auth.me(rotated.access_token)).toEqual(session.user);
    expect(() => auth.rotate(session.refresh_token)).toThrow(AuthFailure);
    expect(() => auth.me(rotated.access_token)).toThrow(AuthFailure);
    expect(() => auth.rotate(rotated.refresh_token)).toThrow(AuthFailure);
  });

  it("consumes the saved nonce once under concurrent submissions", async () => {
    const { auth, request, fetchImpl } = setup();
    const input = await request();
    const results = await Promise.allSettled([auth.signIn(input), auth.signIn(input)]);
    expect(results.map(r => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects a caller-supplied nonce and consumes failed challenges", async () => {
    const { auth, request, token, fetchImpl } = setup();
    const input = await request();
    const wrong = "x".repeat(43);
    await expect(auth.signIn({ ...input, id_token: await token({ nonce: wrong }), nonce: wrong })).rejects.toBeInstanceOf(IDTokenError);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(auth.signIn(input)).rejects.toMatchObject({ code: "invalid_challenge" });
  });

  it("does not create a session for another UserInfo subject or missing phone", async () => {
    const { auth, request, f } = setup();
    f.profile.sub = "other";
    await expect(auth.signIn(await request())).rejects.toBeInstanceOf(InvalidResponseError);
    f.profile.sub = "user1"; delete f.profile.phone_number;
    await expect(auth.signIn(await request())).rejects.toMatchObject({ code: "phone_required", status: 403 });
    expect(auth.sessions.size).toBe(0);
  });

  it("expires challenges/access/families and revokes current refresh on logout", async () => {
    const { auth, request, advance, fetchImpl } = setup();
    const expired = await request(); advance(301);
    await expect(auth.signIn(expired)).rejects.toMatchObject({ code: "invalid_challenge" });
    expect(fetchImpl).not.toHaveBeenCalled();
    const first = await auth.signIn(await request()); advance(901);
    expect(() => auth.me(first.access_token)).toThrow(AuthFailure);
    const next = auth.rotate(first.refresh_token);
    auth.logout(next.access_token);
    expect(() => auth.rotate(next.refresh_token)).toThrow(AuthFailure);
    const last = await auth.signIn(await request()); advance(2592001);
    expect(() => auth.rotate(last.refresh_token)).toThrow(AuthFailure);
    expect(auth.sessions.size).toBe(0);
  });

  it("keeps account identity stable across phone changes and stores only token hashes", async () => {
    const { auth, request, f } = setup();
    const first = await auth.signIn(await request());
    f.profile.phone_number = "+12025550124";
    const second = await auth.signIn(await request());
    expect(second.user.id).toBe(first.user.id);
    expect(second.user.phone_number).toBe("+12025550124");
    const stored = JSON.stringify({ sessions: [...auth.sessions], refresh: [...auth.refresh], access: [...auth.access] });
    expect(stored).not.toContain(first.access_token);
    expect(stored).not.toContain(first.refresh_token);
    expect(stored).not.toContain("user-access");
    expect(() => auth.me("user-access")).toThrow(AuthFailure);
    expect(() => auth.rotate(first.access_token)).toThrow(AuthFailure);
  });
});
