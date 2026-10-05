import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { isSameOriginRequest } from "@/app/auth/origin";
import { createEmployeeSession, employeeSessionSecret } from "@/lib/employee-session";
import { normalizePhone } from "@/lib/phone";
import { readState } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, hasSupabaseConfiguration } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const unavailable = "Employee sign-in is temporarily unavailable. Please try again.";
const unmatched = "Unable to sign in with that phone number. Ask your admin to check your access.";
function reply(body: Record<string, unknown>, status: number, retryAfter?: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) } });
}

function clientIp(request: Request): string {
  // Vercel supplies this header. Outside Vercel, do not trust a caller's
  // forwarded IP: use one shared local bucket instead.
  const value = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for")?.trim() : "";
  return value && isIP(value) ? value : "unavailable";
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return reply({ error: "Submit this request from the application." }, 403);
  let phone: string | null;
  try {
    const raw = await request.text();
    if (raw.length > 512) return reply({ error: "Enter a valid phone number." }, 400);
    const input = JSON.parse(raw);
    phone = normalizePhone(input?.phone);
  } catch {
    return reply({ error: "Enter a valid phone number." }, 400);
  }
  if (!phone) return reply({ error: "Enter a valid phone number." }, 400);

  try {
    const secret = employeeSessionSecret();
    const hash = (kind: string, value: string) => createHmac("sha256", secret).update(`employee-login:${kind}:${value}`).digest("hex");
    // The database increments both limits atomically across server instances.
    // Missing migration, failed RPC, and invalid replies all fail closed.
    const { data: retryAfter, error } = await createAdminClient().rpc("consume_employee_login_rate_limits", {
      p_ip_hash: hash("ip", clientIp(request)), p_phone_hash: hash("phone", phone),
    });
    if (error || !Number.isInteger(retryAfter) || retryAfter < 0 || retryAfter > 900) return reply({ error: unavailable }, 503);
    if (retryAfter > 0) return reply({ error: "Too many sign-in attempts. Please try again later." }, 429, retryAfter);

    const saved = await readState();
    const matching = saved?.state.employees.filter(employee => employee.active && employee.phone === phone && employee.phoneVersion) ?? [];
    if (matching.length !== 1) return reply({ error: unmatched }, 401);

    // Switching identities must never leave an old admin session behind.
    if (hasSupabaseConfiguration()) {
      const supabase = await createClient();
      const result = await supabase.auth.signOut({ scope: "local" });
      if (result.error) return reply({ error: unavailable }, 503);
    }
    await createEmployeeSession(matching[0]);
    return reply({ ok: true, redirectTo: "/" }, 200);
  } catch {
    // No phone numbers, cookies, or database credentials are logged or returned.
    return reply({ error: unavailable }, 503);
  }
}
