import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getMissingConfiguration } from "@/lib/config";
import { safeReturnPath } from "@/app/auth/paths";
import { signIn, signUp, requestPasswordReset, resendConfirmation } from "./actions";
import { SubmitButton } from "./submit-button";
import EmployeeLoginForm from "./employee-login-form";
import styles from "./auth.module.css";

export const dynamic = "force-dynamic";

const messages: Record<string, string> = {
  "admin-only": "Email accounts are for the admin. Employees sign in with their registered phone number.",
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
  const status = typeof params.status === "string" ? params.status : "";
  const emailStatus = ["check-email", "confirm-email", "reset-email", "password-updated", "invalid-link", "reset-expired", "password-updated-signout-failed"].includes(status);
  const mode = params.mode === "signup" || params.mode === "forgot-password" || params.mode === "signin" ? params.mode : emailStatus ? "signin" : "employee";
  const missing = getMissingConfiguration();
  const user = missing.length === 0 ? await getCurrentUser() : null;
  const signoutFailed = status === "signout-failed" || status === "password-updated-signout-failed";
  const admin = user?.authType === "email" && user.emailVerified && user.email === process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!signoutFailed && (mode === "employee" && user?.authType === "phone" || admin && mode !== "forgot-password" && params.mode !== "employee")) redirect(returnTo);

  const href = (nextMode: string) => `/login?${new URLSearchParams({ mode: nextMode, return_to: returnTo }).toString()}`;
  const employee = mode === "employee";
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
        <h1 id="auth-heading" className={styles.heading}>{employee ? "Employee sign in" : signup ? "Create admin account" : forgot ? "Reset admin password" : "Admin sign in"}</h1>
        <p className={styles.description}>{employee ? "Enter your phone number to see your schedule and request shifts. No password or verification code is needed." : signup ? "Use your configured admin email. We’ll confirm it before you manage the schedule." : forgot ? "Enter your admin email and we’ll send you a password reset link." : "Use your admin email and password to manage your team."}</p>
        {messages[status] && <p className={`${styles.notice} ${successStatuses.has(status) ? "" : styles.error}`} role={successStatuses.has(status) ? "status" : "alert"}>{messages[status]}</p>}
        {employee ? <EmployeeLoginForm returnTo={returnTo}/> : <form action={signup ? signUp : forgot ? requestPasswordReset : signIn} className="form-stack">
          <input type="hidden" name="return_to" value={returnTo}/>
          {signup && <label htmlFor="name">Your name<input id="name" name="name" autoComplete="name" required maxLength={80}/></label>}
          <label htmlFor="email">Email address<input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254}/></label>
          {!forgot && <label htmlFor="password">Password<input id="password" name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 12 : undefined} maxLength={128}/>{signup && <span className={styles.formNote}>Use at least 12 characters.</span>}</label>}
          <SubmitButton pendingText={signup ? "Creating account…" : forgot ? "Requesting link…" : "Signing in…"}>{signup ? "Create account" : forgot ? "Send reset link" : "Sign in"}</SubmitButton>
        </form>}
        {!employee && ["confirm-email", "invalid-link", "check-email"].includes(status) && <>
          <div className={styles.divider}/>
          <form action={resendConfirmation} className="form-stack">
            <input type="hidden" name="return_to" value={returnTo}/>
            <label htmlFor="confirmation-email">Email to confirm<input id="confirmation-email" name="email" type="email" autoComplete="email" required maxLength={254}/></label>
            <SubmitButton secondary pendingText="Requesting link…">Resend confirmation email</SubmitButton>
          </form>
        </>}
        <nav className={styles.links} aria-label="Account options">
          {employee ? <Link href={href("signin")}>Admin sign in</Link> : <>
            <Link href={href(signup || forgot ? "signin" : "signup")}>{signup || forgot ? "Back to admin sign in" : "Create admin account"}</Link>
            {!forgot && <Link href={href("forgot-password")}>Forgot password?</Link>}
            <Link href={href("employee")}>Employee phone sign-in</Link>
          </>}
        </nav>
        {signoutFailed && <form action="/signout" method="post" className="form-stack"><SubmitButton secondary>Try signing out again</SubmitButton></form>}
      </>}
    </section>
  </main>;
}
