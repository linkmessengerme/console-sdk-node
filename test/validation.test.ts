import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/errors";
import { normalizePhone, validateCode } from "../src/validation";

describe("normalizePhone", () => {
  it("accepts E.164 and bare digits", () => {
    expect(normalizePhone("+12025550123")).toBe("+12025550123");
    expect(normalizePhone("12025550123")).toBe("+12025550123");
    expect(normalizePhone("  +12025550123 ")).toBe("+12025550123");
  });

  it("rejects malformed phones", () => {
    for (const bad of ["", "123", "+0123456789", "+12025550123901234", "phone", "+abc12345"]) {
      expect(() => normalizePhone(bad)).toThrow(ValidationError);
    }
  });
});

describe("validateCode", () => {
  it("accepts 4-10 alphanumerics", () => {
    expect(validateCode("1234")).toBe("1234");
    expect(validateCode("ABCDe12345")).toBe("ABCDe12345");
  });

  it("rejects bad codes", () => {
    for (const bad of ["", "123", "12345678901", "12-34", "código"]) {
      expect(() => validateCode(bad)).toThrow(ValidationError);
    }
  });
});
