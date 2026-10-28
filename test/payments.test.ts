import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ApiError, AuthenticationError, ConsoleClient, InvalidResponseError, RateLimitError,
  ValidationError, type CreateOrderRequest, type GetOrderRequest,
  type GetOrderByMerchantReferenceRequest, type CancelOrderRequest,
  type RecordFulfillmentRequest,
} from "../src/index";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/payments.json", import.meta.url), "utf8"));
const PEM = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const BASE = "https://api.example.test";
function camel(value: any): any {
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), camel(v)]));
}
function call(client: ConsoleClient, name: string, request: any): Promise<any> {
  switch (name) {
    case "CreateOrder": return client.payments.createOrder(request as CreateOrderRequest);
    case "GetOrder": return client.payments.getOrder(request as GetOrderRequest);
    case "GetOrderByMerchantReference": return client.payments.getOrderByMerchantReference(request as GetOrderByMerchantReferenceRequest);
    case "CancelOrder": return client.payments.cancelOrder(request as CancelOrderRequest);
    case "RecordFulfillment": return client.payments.recordFulfillment(request as RecordFulfillmentRequest);
    default: throw new Error(name);
  }
}
function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Retry-After": "2" } });
}
function setup(handler: (url: string, init: RequestInit) => Response, retry = false) {
  const scopes: Record<string, number> = {};
  const requests: { url: string; init: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/oauth/v1/token")) {
      const scope = new URLSearchParams(String(init.body)).get("scope")!;
      scopes[scope] = (scopes[scope] ?? 0) + 1;
      // Allow concurrent callers to join the same pending mint.
      await Promise.resolve();
      return response(200, { access_token: `${scope}-${scopes[scope]}`, expires_in: 900 });
    }
    requests.push({ url, init });
    return handler(url, init);
  };
  const client = new ConsoleClient({ clientId: "test-client", privateKey: PEM, baseUrl: BASE,
    fetch: fetchImpl, retry: retry ? { maxRetries: 2, initialBackoffMs: 1, maxBackoffMs: 1 } : false });
  return { client, scopes, requests };
}

describe("Mini Apps payments contract", () => {
  for (const [name, tc] of Object.entries<any>(fixtures.cases)) {
    it(`${name}: exact ProtoJSON request and lossless response`, async () => {
      const { client, scopes, requests } = setup(() => response(200, tc.response));
      const out = await call(client, name, camel(tc.request));
      expect(scopes).toEqual({ payments: 1 });
      expect(requests).toHaveLength(1);
      const { url, init } = requests[0]!;
      expect(url).toBe(BASE + tc.path);
      expect(init.method).toBe("POST");
      const headers = new Headers(init.headers);
      expect(headers.get("Authorization")).toBe("Bearer payments-1");
      expect(headers.get("Accept")).toBe("application/json");
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(JSON.parse(String(init.body))).toEqual(tc.request);
      const order = out.order ?? out.checkout.order;
      expect(order.product.version).toBe("9223372036854775807");
      expect(order.offer.amountMinor).toBe("9007199254740993");
      expect(order.revision).toBe("9007199254740993");
      expect(order.createdAt).toBe("2026-10-28T00:00:00.123456789Z");
      if (name === "CreateOrder") expect(out.checkout.methodAvailable).toBe(false);
      expect(order.paidAt).toBe(tc.response.order?.paid_at);
    });
  }

  for (const [name, results] of Object.entries<any[]>(fixtures.business)) {
    for (const result of results) {
      it(`returns ${result.result} without throwing or retrying`, async () => {
        const { client, requests } = setup(() => response(200, result), true);
        const out = await call(client, name, camel(fixtures.cases[name].request));
        expect(out.result).toBe(result.result);
        if (!result.order) expect(out.order).toBeUndefined();
        if (!result.checkout) expect(out.checkout).toBeUndefined();
        expect(requests).toHaveLength(1);
      });
    }
  }

  for (const error of fixtures.errors) {
    it(`maps ProtoJSON HTTP ${error.status} to existing errors`, async () => {
      const { client } = setup(() => response(error.status, error.body));
      const promise = client.payments.getOrder(camel(fixtures.cases.GetOrder.request));
      const kind = [401, 403].includes(error.status) ? AuthenticationError : error.status === 429 ? RateLimitError : ApiError;
      await expect(promise).rejects.toBeInstanceOf(kind);
      await expect(promise).rejects.toMatchObject({ code: error.body.code, statusCode: error.status,
        message: expect.stringContaining(error.body.detail), requestId: "req-payments", details: { trace_id: "trace-payments" } });
      if (error.status === 429) await expect(promise).rejects.toMatchObject({ retryAfter: "2",
        details: { rate_limit: { limit: "9007199254740993" } } });
      if (error.status === 422) await expect(promise).rejects.toMatchObject({ details: { field_violations: error.body.field_violations } });
    });
  }

  it("isolates concurrent scope caches and preserves the full body on 503/401 retries", async () => {
    let retryPhase = false, attempts = 0;
    const bodies: string[] = [];
    const tc = fixtures.cases.CreateOrder;
    const { client, scopes } = setup((url, init) => {
      const auth = new Headers(init.headers).get("Authorization");
      if (url.endsWith("/otp/send")) {
        expect(auth).toBe("Bearer otp-1");
        return response(200, { status: "sent" });
      }
      expect(auth).toMatch(/^Bearer payments-/);
      if (retryPhase) {
        bodies.push(String(init.body)); attempts++;
        if (attempts === 1) return response(503, { code: "ERROR_CODE_UNAVAILABLE" });
        if (attempts === 2) return response(401, { code: "ERROR_CODE_UNAUTHENTICATED" });
      }
      return response(200, tc.response);
    }, true);
    await Promise.all(Array.from({ length: 12 }, (_, i) => i % 2 ? client.payments.createOrder(camel(tc.request)) : client.otp.send({ phone: "12025550123", code: "123456" })));
    expect(scopes).toEqual({ otp: 1, payments: 1 });
    retryPhase = true;
    await client.payments.createOrder(camel(tc.request));
    await client.otp.send({ phone: "12025550123", code: "123456" });
    expect(scopes).toEqual({ otp: 1, payments: 2 });
    expect(bodies).toHaveLength(3);
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0]!)).toEqual(tc.request);
  });

  it.each([12.5, 9007199254740992, 1n, "0", "-1", "1.5", "9223372036854775808"])("rejects invalid or lossy int64 input %s before I/O", async value => {
    const { client, requests, scopes } = setup(() => { throw new Error("unexpected I/O"); });
    const request = camel(fixtures.cases.CreateOrder.request);
    request.payment.amountMinor = value;
    await expect(client.payments.createOrder(request)).rejects.toBeInstanceOf(ValidationError);
    expect(requests).toHaveLength(0); expect(scopes).toEqual({});
  });
  it("requires operation UUIDs and rejects malformed success responses", async () => {
    const { client, scopes } = setup(() => response(200, {}));
    for (const name of ["CreateOrder", "CancelOrder", "RecordFulfillment"]) {
      const req = camel(fixtures.cases[name].request); delete req.operationId;
      await expect(call(client, name, req)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(scopes).toEqual({});
    await expect(client.payments.getOrder(camel(fixtures.cases.GetOrder.request))).rejects.toBeInstanceOf(InvalidResponseError);
  });
});
