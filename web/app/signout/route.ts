import { NextResponse, type NextRequest } from "next/server";
import { createClient, hasSupabaseConfiguration } from "@/lib/supabase/server";
import { isSameOriginRequest, redirectOrigin } from "@/app/auth/origin";
import { clearEmployeeSession } from "@/lib/employee-session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Submit this request from the application." }, {
      status: 403,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  await clearEmployeeSession();
  let failed = false;
  if (hasSupabaseConfiguration()) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.signOut({ scope: "local" });
      failed = Boolean(error);
    } catch {
      failed = true;
    }
  }
  const response = NextResponse.redirect(new URL(`/login?status=${failed ? "signout-failed" : "signed-out"}`, redirectOrigin(request)), 303);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}
