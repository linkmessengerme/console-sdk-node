import { describe, expect, it } from "vitest";
import { newIdempotencyKey } from "../src/index";
import { isValidIdempotencyKey } from "../src/internal/idempotency";

describe("idempotency", () => {
  it("generates valid UUID-v4 keys", () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(isValidIdempotencyKey(key)).toBe(true);
  });

  it("accepts allowed charset and length", () => {
    expect(isValidIdempotencyKey("order-42:otp_v1")).toBe(true);
    expect(isValidIdempotencyKey("a".repeat(255))).toBe(true);
  });

  it("rejects empty, too long, or illegal characters", () => {
    expect(isValidIdempotencyKey("")).toBe(false);
    expect(isValidIdempotencyKey("a".repeat(256))).toBe(false);
    expect(isValidIdempotencyKey("has space")).toBe(false);
    expect(isValidIdempotencyKey("emoji✨")).toBe(false);
  });
});
