/** Only return to paths on this application; never to another origin. */
export function safeReturnPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return fallback;
  if (/[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(decoded)) return fallback;
    const url = new URL(value, "https://app.local");
    if (url.origin !== "https://app.local") return fallback;
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/login" || path === "/signout" ||
        (path.startsWith("/auth") && path !== "/auth/reset-password")) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function loginPath(returnTo = "/", status?: string): string {
  const params = new URLSearchParams({ return_to: safeReturnPath(returnTo) });
  if (status) params.set("status", status);
  return `/login?${params.toString()}`;
}
