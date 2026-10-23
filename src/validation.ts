import { ValidationError } from "./errors";

// Phone: 8–15 digits, optional leading "+". Bare digits get a "+" prepended.
const PHONE_WITH_PLUS_RE = /^\+[1-9][0-9]{7,14}$/;
const PHONE_DIGITS_RE = /^[1-9][0-9]{7,14}$/;
// OTP code: 4–10 latin letters or digits.
const CODE_RE = /^[A-Za-z0-9]{4,10}$/;

/** Normalizes a phone to E.164 (`+` prefix) or throws {@link ValidationError}. */
export function normalizePhone(phone: string): string {
  const p = phone.trim();
  if (PHONE_WITH_PLUS_RE.test(p)) return p;
  if (PHONE_DIGITS_RE.test(p)) return `+${p}`;
  throw new ValidationError(
    "phone must contain 8-15 digits and may start with +",
  );
}

/** Validates an OTP code and returns it trimmed, or throws {@link ValidationError}. */
export function validateCode(code: string): string {
  const c = code.trim();
  if (!CODE_RE.test(c)) {
    throw new ValidationError("code must be 4-10 latin letters or digits");
  }
  return c;
}
