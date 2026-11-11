export class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

/** A failure that retrying cannot fix (refused connection, redirect, non-JSON reply). */
export class FatalRequestError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Remove secrets from text before it is shown or saved. Some providers and proxies echo
 * request headers back in error bodies, so we scrub the exact key and any bearer token.
 */
export function redact(text: string, secrets: Array<string | undefined>): string {
  let out = text.replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]");
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join("[redacted]");
  }
  return out;
}

function isLoopback(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/** Refuse to put an API key on the wire in clear text to a remote host. */
export function assertSafeBaseUrl(baseUrl: string, hasKey: boolean): void {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid base URL: ${baseUrl}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`Unsupported URL scheme in base URL: ${u.protocol}`);
  if (hasKey && u.protocol === "http:" && !isLoopback(u.hostname)) {
    throw new Error(`Refusing to send an API key over plain http to ${u.hostname}. Use https, or a loopback address.`);
  }
}

const FATAL_NET_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "ERR_INVALID_URL", "ERR_INVALID_PROTOCOL"]);

/**
 * POST JSON with retries on 429 / 5xx / transient network errors.
 * Request headers (which carry API keys) are never included in error messages.
 * Redirects are refused: a redirect must not carry credentials to another host.
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  opts: { retries?: number; timeoutMs?: number } = {},
): Promise<any> {
  const retries = opts.retries ?? 4;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "error",
        });
      } catch (e) {
        const cause = (e as { cause?: { code?: string; message?: string } }).cause;
        if (cause?.code && FATAL_NET_CODES.has(cause.code)) {
          throw new FatalRequestError(`Cannot connect to ${host} (${cause.code}). Is the server running and the URL right?`);
        }
        if (/bad port|invalid url/i.test(cause?.message ?? "")) {
          throw new FatalRequestError(`Cannot connect to ${host}: ${cause?.message}.`);
        }
        if (/redirect/i.test(cause?.message ?? "") || /redirect/i.test(String((e as Error).message))) {
          throw new FatalRequestError(`${host} replied with a redirect; refusing to follow it (it could carry your API key elsewhere).`);
        }
        throw e;
      }
      const text = await res.text();
      if (res.ok) {
        try {
          return JSON.parse(text);
        } catch {
          throw new FatalRequestError(`${host} returned a non-JSON response (is the base URL correct?): ${text.slice(0, 120).replace(/\s+/g, " ")}`);
        }
      }
      const err = new HttpError(res.status, text);
      if (res.status !== 429 && res.status < 500) throw err;
      lastErr = err;
      const ra = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30_000) : Math.min(1000 * 2 ** attempt, 15_000));
    } catch (e) {
      if (e instanceof FatalRequestError) throw e;
      if (e instanceof HttpError && e.status !== 429 && e.status < 500) throw e;
      lastErr = e;
      if (attempt < retries) await sleep(Math.min(1000 * 2 ** attempt, 15_000));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
