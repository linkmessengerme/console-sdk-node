import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import {
  AuthenticationError, ConfigError, IDTokenError, InvalidResponseError,
  LoginClient, ValidationError,
} from "../../dist/index.js";
import { AppAuth, AuthFailure } from "./auth.mjs";

async function body(request) {
  if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json")
    throw new AuthFailure("json_required", 415);
  let size = 0; const parts = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 20_000) throw new AuthFailure("request_too_large", 413);
    parts.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(parts).toString("utf8")); }
  catch { throw new AuthFailure("invalid_json", 400); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AuthFailure("invalid_request", 400);
  return value;
}

function bearer(request) {
  const match = /^Bearer (app_at_[A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? "");
  if (!match) throw new AuthFailure();
  return match[1];
}

export function createAppServer(link) {
  const auth = new AppAuth(link);
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      let result;
      const route = `${req.method} ${req.url}`;
      if (route === "POST /auth/link/challenge") { await body(req); result = auth.challenge(); }
      else if (route === "POST /auth/link") result = await auth.signIn(await body(req));
      else if (route === "POST /auth/refresh") result = auth.rotate((await body(req)).refresh_token);
      else if (route === "GET /me") result = { user: auth.me(bearer(req)) };
      else if (route === "POST /auth/logout") { await body(req); auth.logout(bearer(req)); result = { ok: true }; }
      else throw new AuthFailure("not_found", 404);
      res.end(JSON.stringify(result));
    } catch (error) {
      // No request bodies, Link tokens, or provider error descriptions in logs/responses.
      let failure = new AuthFailure("login_unavailable", 503);
      if (error instanceof AuthFailure) failure = error;
      else if (error instanceof IDTokenError || error instanceof AuthenticationError ||
               error instanceof InvalidResponseError || error instanceof ValidationError || error instanceof ConfigError)
        failure = new AuthFailure();
      res.statusCode = failure.status;
      res.end(JSON.stringify({ error: failure.code }));
    }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const link = new LoginClient({
    issuer: process.env.LINK_ISSUER,
    apiBaseUrl: process.env.LINK_API_BASE_URL || undefined,
    clientIds: (process.env.LINK_LOGIN_CLIENT_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean),
  });
  const port = Number(process.env.PORT ?? 8080);
  createAppServer(link).listen(port, "127.0.0.1", () => {
    console.log(`Own-backend example: http://127.0.0.1:${port}`);
  });
}
