import { clearEmployeeSession } from "@/lib/employee-session";
import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient, hasSupabaseConfiguration } from "@/lib/supabase/server";
import { safeReturnPath } from "@/app/auth/paths";
import { redirectOrigin } from "@/app/auth/origin";

export const dynamic = "force-dynamic";

const emailTypes = new Set<EmailOtpType>(["email", "signup", "recovery", "invite", "email_change", "magiclink"]);

function goTo(request: NextRequest, path: string) {
  const response = NextResponse.redirect(new URL(path, redirectOrigin(request)));
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: NextRequest) {
  if (!hasSupabaseConfiguration()) return goTo(request, "/login?status=setup");
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const code = params.get("code");
  const returnTo = type === "recovery" ? "/auth/reset-password" : safeReturnPath(params.get("next"));

  try {
    const supabase = await createClient();
    const result = tokenHash && type && emailTypes.has(type)
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : code ? await supabase.auth.exchangeCodeForSession(code) : null;
    if (!result || result.error) return goTo(request, "/login?status=invalid-link");

    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user?.email_confirmed_at) {
      await supabase.auth.signOut({ scope: "local" });
      return goTo(request, "/login?status=confirm-email");
    }
    if (user.email?.trim().toLowerCase() !== process.env.ADMIN_EMAIL?.trim().toLowerCase()) {
      await supabase.auth.signOut({ scope: "local" });
      return goTo(request, "/login?mode=signin&status=admin-only");
    }
    await clearEmployeeSession();
    return goTo(request, returnTo);
  } catch {
    return goTo(request, "/login?status=invalid-link");
  }
}
