import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { loginPath } from "@/app/auth/paths";
import { createClient, hasSupabaseConfiguration } from "@/lib/supabase/server";

export type CurrentUser = {
  userId: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
};

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  if (!hasSupabaseConfiguration()) return null;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user || !user.email) return null;

  const email = user.email.trim().toLowerCase();
  const name = user.user_metadata?.display_name ?? user.user_metadata?.full_name;
  return {
    userId: user.id,
    email,
    displayName: typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : email,
    emailVerified: Boolean(user.email_confirmed_at),
  };
});

export async function requireCurrentUser(returnTo = "/"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(loginPath(returnTo));
  if (!user.emailVerified) redirect(loginPath(returnTo, "confirm-email"));
  return user;
}
