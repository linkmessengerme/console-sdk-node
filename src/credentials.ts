import { ConfigError } from "./errors";
import { assertEd25519PrivateKey } from "./internal/jwt";

/**
 * OAuth-client key material, as issued by the Developer Console ("Download key"
 * produces a JSON file in the {@link CredentialsFile} shape — "in the style of a
 * Google service-account": the private key is revealed once; the platform keeps
 * only the public key). Authentication is `private_key_jwt`: the SDK signs a
 * short client_assertion with this private key, exchanges it at the token
 * endpoint for a short-lived Bearer access token. See docs/console/api-auth.
 */
export interface Credentials {
  type: string;
  clientId: string;
  /** PEM (PKCS#8 Ed25519) private key. Used locally to sign client_assertion. */
  privateKeyPem: string;
  tokenUrl: string;
  apiBaseUrl: string;
  /** Audience of the client_assertion (the Authorization Server issuer). */
  issuer: string;
  environment: string;
  projectId: string;
}

/** Raw JSON shape of a downloaded key file. */
export interface CredentialsFile {
  type?: string;
  client_id?: string;
  private_key?: string;
  token_url?: string;
  api_base_url?: string;
  issuer?: string;
  environment?: string;
  project_id?: string;
}

export const OAUTH_CLIENT_TYPE = "link_oauth_client";

export function validateUrl(raw: string, field: string): void {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch (err) {
    throw new ConfigError(`credentials ${field} is invalid`, { cause: err });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ConfigError(`credentials ${field} must use http or https`);
  }
  if (!url.host) {
    throw new ConfigError(`credentials ${field} host is required`);
  }
  if (url.hash) {
    throw new ConfigError(`credentials ${field} must not include a fragment`);
  }
}

/** Derives token_url/issuer from api_base_url when absent, then validates URLs. */
function normalizeAndValidate(creds: Credentials): void {
  validateUrl(creds.apiBaseUrl, "api_base_url");
  const base = creds.apiBaseUrl.replace(/\/+$/, "");
  if (!creds.tokenUrl) creds.tokenUrl = `${base}/oauth/v1/token`;
  if (!creds.issuer) creds.issuer = base;
  validateUrl(creds.tokenUrl, "token_url");
}

/** Builds credentials programmatically from client_id + PEM key + base URL. */
export function fromClientKey(
  clientId: string,
  privateKeyPem: string,
  apiBaseUrl: string,
): Credentials {
  assertEd25519PrivateKey(privateKeyPem);
  const creds: Credentials = {
    type: OAUTH_CLIENT_TYPE,
    clientId: clientId.trim(),
    privateKeyPem,
    tokenUrl: "",
    apiBaseUrl: apiBaseUrl.trim(),
    issuer: "",
    environment: "",
    projectId: "",
  };
  if (!creds.clientId) {
    throw new ConfigError("credentials client_id is required");
  }
  normalizeAndValidate(creds);
  return creds;
}

/** Builds and fully validates credentials from a parsed key-file object. */
export function fromFile(file: CredentialsFile): Credentials {
  const privateKeyPem = (file.private_key ?? "").trim();
  assertEd25519PrivateKey(privateKeyPem);
  const creds: Credentials = {
    type: (file.type ?? "").trim(),
    clientId: (file.client_id ?? "").trim(),
    privateKeyPem,
    tokenUrl: (file.token_url ?? "").trim(),
    apiBaseUrl: (file.api_base_url ?? "").trim(),
    issuer: (file.issuer ?? "").trim(),
    environment: (file.environment ?? "").trim(),
    projectId: (file.project_id ?? "").trim(),
  };
  if (creds.type !== OAUTH_CLIENT_TYPE) {
    throw new ConfigError(`credentials type must be "${OAUTH_CLIENT_TYPE}"`);
  }
  if (!creds.clientId) {
    throw new ConfigError("credentials client_id is required");
  }
  normalizeAndValidate(creds);
  return creds;
}

/** Parses credentials from a JSON string or an already-parsed object. */
export function parseCredentials(data: string | CredentialsFile): Credentials {
  let file: CredentialsFile;
  if (typeof data === "string") {
    try {
      file = JSON.parse(data) as CredentialsFile;
    } catch (err) {
      throw new ConfigError("failed to parse credentials JSON", { cause: err });
    }
  } else {
    file = data;
  }
  return fromFile(file);
}
