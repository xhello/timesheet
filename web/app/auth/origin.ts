import "server-only";

import { headers } from "next/headers";

function httpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function hostOrigin(request: Request): string | null {
  const target = new URL(request.url);
  const host = request.headers.get("host");
  if (!host) return target.origin;
  const candidate = httpOrigin(`${target.protocol}//${host}`);
  // Host is the browser's actual destination; Next may internally normalize
  // 127.0.0.1 to localhost. Reject paths, credentials, and malformed Host values.
  return candidate && new URL(candidate).host === host ? candidate : null;
}

/** Public redirects use the configured deployment origin when it is available. */
export function redirectOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    const origin = httpOrigin(configured);
    if (!origin) throw new Error("The application site URL is not configured correctly.");
    return origin;
  }
  return hostOrigin(request) || new URL(request.url).origin;
}

/** Server Actions also enforce Next.js's built-in Origin/Host protection. */
export async function actionOrigin(): Promise<string> {
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  if (!origin || !host || httpOrigin(origin) !== origin || new URL(origin).host !== host) {
    throw new Error("This form must be submitted from this application.");
  }

  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    const siteOrigin = httpOrigin(configured);
    if (!siteOrigin) throw new Error("The application site URL is not configured correctly.");
    return siteOrigin;
  }
  return origin;
}

/** POST routes reject missing or cross-origin submissions, including sign-out. */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || httpOrigin(origin) !== origin) return false;
  if (origin === hostOrigin(request)) return true;
  // Vercel may pass an internal URL to the handler. Only the configured public
  // origin may substitute for that URL; arbitrary forwarded headers cannot.
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  return Boolean(configured && origin === httpOrigin(configured) && new URL(origin).host === request.headers.get("host"));
}
