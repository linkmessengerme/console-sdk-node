/**
 * Supported message locales (ISO 639-1). When `locale` is omitted the gateway
 * auto-detects it from the phone's country code.
 */
export const Locale = {
  Russian: "ru",
  English: "en",
  Kazakh: "kk",
  Uzbek: "uz",
} as const;

export type Locale = (typeof Locale)[keyof typeof Locale];

export interface SendRequest {
  /** Recipient phone in E.164 (`+12025550123`); bare digits are accepted too. */
  phone: string;
  /** The OTP code to deliver. 4–10 latin letters or digits. */
  code: string;
  /** Optional ISO 639-1 locale; auto-detected from the phone when omitted. */
  locale?: Locale | (string & {});
  /** Optional template id; the project default (or fallback) is used otherwise. */
  templateId?: string;
  /**
   * Optional template substitutions (e.g. `{ name: "Alex" }`). `{{code}}` is
   * filled automatically from `code` — do not include it here.
   */
  variables?: Record<string, string>;
}

export interface SendResponse {
  requestId: string;
  phone: string;
  status: string;
  /** Template that rendered the message: a template id, or `"fallback"`. */
  templateUsed?: string;
  /** Locale actually used after auto-detect/fallback resolution. */
  localeUsed?: string;
}
