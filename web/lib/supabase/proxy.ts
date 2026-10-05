import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  // Public calendars and signed-in controls share these routes. Never cache a
  // response carrying a user's session, including redirects and server actions.
  response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("Referrer-Policy", "same-origin");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        const previous = response;
        response = NextResponse.next({ request });
        // There can be several writes in one request. Retain every cookie and
        // response header, including the SSR library's first-write cache headers.
        for (const cookie of previous.cookies.getAll()) response.cookies.set(cookie);
        previous.headers.forEach((value, name) => {
          if (name.toLowerCase() !== "set-cookie" && !name.startsWith("x-middleware-")) {
            response.headers.set(name, value);
          }
        });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
      },
    },
  });

  // Verify with the Auth server; cookie contents alone never establish identity.
  await supabase.auth.getUser();
  return response;
}
