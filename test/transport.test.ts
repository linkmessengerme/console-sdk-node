import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ApiError, AuthenticationError, ConsoleClient, RateLimitError } from "../src/index";

const CLIENT_ID = "lk_client_test01";
const BASE = "https://api-sdk.example.test";
const PEM = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(payload, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

interface Recorded {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

// recordingFetch auto-answers the token endpoint and serves productResponses in
// order for everything else.
function recordingFetch(productResponses: Response[]) {
  const calls: Recorded[] = [];
  let i = 0;
  const fn = (async (input: unknown, init: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init.method ?? "GET",
      headers: new Headers(init.headers as HeadersInit),
      body: String(init.body ?? ""),
    });
    if (url.endsWith("/oauth/v1/token")) {
      return jsonResponse(200, { access_token: "test-token", token_type: "Bearer", expires_in: 900 });
    }
    const resp = productResponses[i++];
    if (!resp) throw new Error("unexpected extra fetch call");
    return resp;
  }) as unknown as typeof fetch;
  const product = () => calls.filter((c) => !c.url.endsWith("/oauth/v1/token"));
  return { fn, calls, product };
}

function newClient(fn: typeof fetch, overrides = {}): ConsoleClient {
  return new ConsoleClient({
    clientId: CLIENT_ID,
    privateKey: PEM,
    baseUrl: BASE,
    fetch: fn,
    retry: { initialBackoffMs: 1, maxBackoffMs: 1 },
    ...overrides,
  });
}

describe("transport", () => {
  it("sends a Bearer token and maps snake_case → camelCase", async () => {
    const { fn, product } = recordingFetch([
      jsonResponse(200, {
        request_id: "req_1",
        phone: "+12025550123",
        status: "queued",
        template_used: "fallback",
        locale_used: "en",
      }),
    ]);
    const client = newClient(fn);

    const res = await client.otp.send({ phone: "12025550123", code: "123456" }, { idempotencyKey: "k1" });

    expect(res).toEqual({
      requestId: "req_1",
      phone: "+12025550123",
      status: "queued",
      templateUsed: "fallback",
      localeUsed: "en",
    });

    const calls = product();
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(`${BASE}/sdk/v1/otp/send`);
    expect(call.method).toBe("POST");
    expect(call.headers.get("Authorization")).toBe("Bearer test-token");
    expect(call.headers.get("X-Link-Signature")).toBeNull();
    expect(call.headers.get("Idempotency-Key")).toBe("k1");
    expect(call.body).toBe('{"phone":"+12025550123","code":"123456"}');
  });

  it("retries transient 5xx (idempotent) then succeeds", async () => {
    const { fn, product } = recordingFetch([
      jsonResponse(503, { error: { code: "INTERNAL_ERROR", message: "try later" } }),
      jsonResponse(200, { request_id: "req_2", status: "queued" }),
    ]);
    const client = newClient(fn);

    const res = await client.otp.send({ phone: "+12025550123", code: "1234" });
    expect(res.requestId).toBe("req_2");
    expect(product()).toHaveLength(2);
  });

  it("does not retry 4xx and surfaces ApiError", async () => {
    const { fn, product } = recordingFetch([
      jsonResponse(400, { error: { code: "INVALID_REQUEST", message: "bad" } }),
    ]);
    const client = newClient(fn);

    await expect(client.otp.send({ phone: "+12025550123", code: "1234" })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(product()).toHaveLength(1);
  });

  it("maps INVALID_TOKEN → AuthenticationError", async () => {
    const { fn } = recordingFetch([
      jsonResponse(401, { error: { code: "INVALID_TOKEN", message: "nope" } }),
    ]);
    const client = newClient(fn);
    await expect(client.otp.send({ phone: "+12025550123", code: "1234" })).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("maps TOO_MANY_REQUESTS → RateLimitError with retryAfter", async () => {
    const { fn } = recordingFetch([
      jsonResponse(429, { error: { code: "TOO_MANY_REQUESTS", message: "slow down" } }, {
        "retry-after": "30",
      }),
    ]);
    const client = newClient(fn, { retry: false });

    await client.otp.send({ phone: "+12025550123", code: "1234" }).then(
      () => {
        throw new Error("expected RateLimitError");
      },
      (err: unknown) => {
        expect(err).toBeInstanceOf(RateLimitError);
        expect((err as RateLimitError).retryAfter).toBe("30");
        expect((err as RateLimitError).statusCode).toBe(429);
      },
    );
  });
});
