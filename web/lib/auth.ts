import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { loginPath } from "@/app/auth/paths";
import { createClient, hasSupabaseConfiguration } from "@/lib/supabase/server";
import { readEmployeeSession } from "@/lib/employee-session";

export type CurrentUser = {
  userId: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  authType: "email" | "phone";
  employeeId?: string;
  phoneVersion?: string;
};

export function isEmailUser(user: CurrentUser): boolean {
  return user.authType === "email";
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const employee = await readEmployeeSession();
  if (employee) return employee;
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
    authType: "email",
  };
});

export async function requireCurrentUser(returnTo = "/"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(loginPath(returnTo));
  if (isEmailUser(user) && !user.emailVerified) redirect(loginPath(returnTo, "confirm-email"));
  return user;
}
