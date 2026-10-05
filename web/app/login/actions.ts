"use server";

import { redirect } from "next/navigation";
import { createClient, hasSupabaseConfiguration } from "@/lib/supabase/server";
import { actionOrigin } from "@/app/auth/origin";
import { safeReturnPath } from "@/app/auth/paths";
import { clearEmployeeSession } from "@/lib/employee-session";

type Mode = "signin" | "signup" | "forgot-password";

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function emailAddress(form: FormData): string | null {
  const email = field(form, "email").trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function isAdminEmail(email: string): boolean {
  return Boolean(process.env.ADMIN_EMAIL?.trim()) && email === process.env.ADMIN_EMAIL?.trim().toLowerCase();
}

function goToLogin(form: FormData, mode: Mode, status: string): never {
  const query = new URLSearchParams({ mode, status, return_to: safeReturnPath(field(form, "return_to")) });
  redirect(`/login?${query.toString()}`);
}

async function prepare(form: FormData, mode: Mode): Promise<string> {
  if (!hasSupabaseConfiguration()) goToLogin(form, mode, "setup");
  try {
    return await actionOrigin();
  } catch {
    goToLogin(form, mode, "invalid-request");
  }
}

export async function signIn(form: FormData): Promise<void> {
  await prepare(form, "signin");
  const email = emailAddress(form);
  const password = field(form, "password");
  if (!email || !password || password.length > 128) goToLogin(form, "signin", "invalid-credentials");

  if (!isAdminEmail(email)) goToLogin(form, "signin", "admin-only");
  let status: string | null = null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      status = error.code === "email_not_confirmed" ? "confirm-email" : "invalid-credentials";
    } else if (!data.user?.email_confirmed_at) {
      await supabase.auth.signOut({ scope: "local" });
      status = "confirm-email";
    }
  } catch {
    status = "unavailable";
  }
  if (status) goToLogin(form, "signin", status);
  await clearEmployeeSession();
  redirect(safeReturnPath(field(form, "return_to")));
}

export async function signUp(form: FormData): Promise<void> {
  const origin = await prepare(form, "signup");
  const email = emailAddress(form);
  const password = field(form, "password");
  const name = field(form, "name").trim();
  if (!email || !name || name.length > 80) goToLogin(form, "signup", "invalid-details");
  if (!isAdminEmail(email)) goToLogin(form, "signup", "admin-only");
  if (password.length < 12 || password.length > 128) goToLogin(form, "signup", "password-length");
  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("next", safeReturnPath(field(form, "return_to")));

  let status = "check-email";
  let signedIn = false;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: callback.toString(), data: { display_name: name } },
    });
    if (error) status = error.code === "over_email_send_rate_limit" ? "rate-limited" : "signup-failed";
    signedIn = Boolean(!error && data.session && data.user?.email_confirmed_at);
    if (data.session && !signedIn) await supabase.auth.signOut({ scope: "local" });
  } catch {
    status = "unavailable";
  }
  if (signedIn) { await clearEmployeeSession(); redirect(safeReturnPath(field(form, "return_to"))); }
  goToLogin(form, "signin", status);
}

export async function resendConfirmation(form: FormData): Promise<void> {
  const origin = await prepare(form, "signin");
  const email = emailAddress(form);
  if (!email) goToLogin(form, "signin", "invalid-email");
  if (!isAdminEmail(email)) goToLogin(form, "signin", "check-email");
  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("next", safeReturnPath(field(form, "return_to")));
  try {
    const supabase = await createClient();
    await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: callback.toString() } });
  } catch {
    // The public response does not reveal whether an account exists.
  }
  goToLogin(form, "signin", "check-email");
}

export async function requestPasswordReset(form: FormData): Promise<void> {
  const origin = await prepare(form, "forgot-password");
  const email = emailAddress(form);
  if (!email) goToLogin(form, "forgot-password", "invalid-email");
  if (!isAdminEmail(email)) goToLogin(form, "forgot-password", "reset-email");
  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("next", "/auth/reset-password");
  try {
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: callback.toString() });
  } catch {
    // Use the same response for registered and unregistered addresses.
  }
  goToLogin(form, "forgot-password", "reset-email");
}

export async function updatePassword(form: FormData): Promise<void> {
  await prepare(form, "forgot-password");
  const password = field(form, "password");
  if (password.length < 12 || password.length > 128) redirect("/auth/reset-password?status=password-length");
  if (password !== field(form, "confirm_password")) redirect("/auth/reset-password?status=password-mismatch");

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user?.email_confirmed_at || !user.email || !isAdminEmail(user.email.toLowerCase())) redirect("/login?mode=forgot-password&status=reset-expired");
  let failed = false;
  let passwordUpdated = false;
  let signoutFailed = false;
  try {
    const { error } = await supabase.auth.updateUser({ password });
    failed = Boolean(error);
    passwordUpdated = !error;
    if (!error) {
      const { error: signoutError } = await supabase.auth.signOut({ scope: "global" });
      signoutFailed = Boolean(signoutError);
    }
  } catch {
    failed = !passwordUpdated;
    signoutFailed = passwordUpdated;
  }
  if (failed) redirect("/auth/reset-password?status=password-failed");
  if (signoutFailed) redirect("/login?status=password-updated-signout-failed");
  redirect("/login?status=password-updated");
}
