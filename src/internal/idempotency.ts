import { randomUUID } from "node:crypto";

/** Idempotency key charset accepted by the gateway: 1–255 of [A-Za-z0-9_-:]. */
const KEY_RE = /^[A-Za-z0-9_\-:]{1,255}$/;

/** Generates a fresh idempotency key (UUID v4). */
export function newIdempotencyKey(): string {
  return randomUUID();
}

export function isValidIdempotencyKey(key: string): boolean {
  return KEY_RE.test(key.trim());
}
