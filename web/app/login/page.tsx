import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getMissingConfiguration } from "@/lib/config";
import { safeReturnPath } from "@/app/auth/paths";
import { signIn, signUp, requestPasswordReset, resendConfirmation } from "./actions";
import { SubmitButton } from "./submit-button";
import styles from "./auth.module.css";

export const dynamic = "force-dynamic";

const messages: Record<string, string> = {
  "check-email": "If your email needs confirmation, a link will arrive in your inbox. Open it to finish signing up, then sign in here.",
  "confirm-email": "Confirm your email address before signing in. Check your inbox, or request a new confirmation link below.",
  "reset-email": "If an account exists for that email, a password reset link will arrive in your inbox. Open it in this browser to choose a new password.",
  "password-updated": "Your password has been updated. Sign in with your new password.",
  "signed-out": "You have signed out.",
  "invalid-credentials": "We could not sign you in. Check your email and password, and try again.",
  "invalid-details": "Enter your name and a valid email address.",
  "invalid-email": "Enter a valid email address.",
  "password-length": "Use a password between 12 and 128 characters.",
  "signup-failed": "We could not create your account. Try signing in if you already have an account, or try again later.",
  "rate-limited": "Too many emails have been requested. Please wait a few minutes and try again.",
  "unavailable": "Sign-in is temporarily unavailable. Please try again shortly.",
  "invalid-request": "This form could not be submitted. Reload this page and try again.",
  "invalid-link": "This email link is invalid or has expired. Request a new confirmation or password reset email.",
  "reset-expired": "Open a new password reset link from your email to continue.",
  "signout-failed": "We could not finish signing you out. Please try again.",
  "password-updated-signout-failed": "Your password was saved, but we could not finish signing you out. Use the button below to try again.",
};
const successStatuses = new Set(["check-email", "confirm-email", "reset-email", "password-updated", "signed-out"]);

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const returnTo = safeReturnPath(params.return_to);
  const mode = params.mode === "signup" || params.mode === "forgot-password" ? params.mode : "signin";
  const status = typeof params.status === "string" ? params.status : "";
  const missing = getMissingConfiguration();
  const user = missing.length === 0 ? await getCurrentUser() : null;
  const signoutFailed = status === "signout-failed" || status === "password-updated-signout-failed";
  if (user?.emailVerified && mode !== "forgot-password" && !signoutFailed) redirect(returnTo);

  const href = (nextMode: string) => `/login?${new URLSearchParams({ mode: nextMode, return_to: returnTo }).toString()}`;
  const signup = mode === "signup";
  const forgot = mode === "forgot-password";

  return <main className={styles.shell}>
    <section className={styles.card} aria-labelledby="auth-heading">
      <Link href="/" className={styles.brand} aria-label="Shiftboard home">
        <span className={styles.brandIcon}><CalendarDays size={22}/></span> Shiftboard
      </Link>
      {missing.length > 0 ? <>
        <h1 id="auth-heading" className={styles.heading}>Setup is almost ready</h1>
        <p className={styles.description}>The app owner needs to finish the server configuration before anyone can sign in.</p>
        <ul className={styles.configList}>{missing.map((name) => <li key={name}><code>{name}</code></li>)}</ul>
        <p className={styles.formNote}>Add these environment variables in Vercel, complete the Supabase setup in the README, and redeploy. Keep the service role key in server environment variables only.</p>
      </> : <>
        <h1 id="auth-heading" className={styles.heading}>{signup ? "Create your account" : forgot ? "Reset your password" : "Welcome back"}</h1>
        <p className={styles.description}>{signup ? "Join your team with your own account. We’ll confirm your email before you access the schedule." : forgot ? "Enter your account email and we’ll send you a link to choose a new password." : "Sign in to manage shifts and see your team’s schedule."}</p>
        {messages[status] && <p className={`${styles.notice} ${successStatuses.has(status) ? "" : styles.error}`} role={successStatuses.has(status) ? "status" : "alert"}>{messages[status]}</p>}
        <form action={signup ? signUp : forgot ? requestPasswordReset : signIn} className="form-stack">
          <input type="hidden" name="return_to" value={returnTo}/>
          {signup && <label htmlFor="name">Your name<input id="name" name="name" autoComplete="name" required maxLength={80}/></label>}
          <label htmlFor="email">Email address<input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254}/></label>
          {!forgot && <label htmlFor="password">Password<input id="password" name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 12 : undefined} maxLength={128}/>{signup && <span className={styles.formNote}>Use at least 12 characters.</span>}</label>}
          <SubmitButton pendingText={signup ? "Creating account…" : forgot ? "Requesting link…" : "Signing in…"}>{signup ? "Create account" : forgot ? "Send reset link" : "Sign in"}</SubmitButton>
        </form>
        {["confirm-email", "invalid-link", "check-email"].includes(status) && <>
          <div className={styles.divider}/>
          <form action={resendConfirmation} className="form-stack">
            <input type="hidden" name="return_to" value={returnTo}/>
            <label htmlFor="confirmation-email">Email to confirm<input id="confirmation-email" name="email" type="email" autoComplete="email" required maxLength={254}/></label>
            <SubmitButton secondary pendingText="Requesting link…">Resend confirmation email</SubmitButton>
          </form>
        </>}
        <nav className={styles.links} aria-label="Account options">
          <Link href={href(signup || forgot ? "signin" : "signup")}>{signup || forgot ? "Back to sign in" : "Create an account"}</Link>
          {!forgot && <Link href={href("forgot-password")}>Forgot password?</Link>}
        </nav>
        {signoutFailed && <form action="/signout" method="post" className="form-stack"><SubmitButton secondary>Try signing out again</SubmitButton></form>}
      </>}
    </section>
  </main>;
}
