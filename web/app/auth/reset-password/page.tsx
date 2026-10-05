import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { requireCurrentUser } from "@/lib/auth";
import { updatePassword } from "@/app/login/actions";
import { SubmitButton } from "@/app/login/submit-button";
import styles from "@/app/login/auth.module.css";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireCurrentUser("/auth/reset-password");
  if (user.authType !== "email" || user.email !== process.env.ADMIN_EMAIL?.trim().toLowerCase()) redirect("/login?mode=signin&status=admin-only");
  const params = await searchParams;
  const errors: Record<string, string> = {
    "password-length": "Use a password between 12 and 128 characters.",
    "password-mismatch": "The passwords do not match. Please enter them again.",
    "password-failed": "We could not update your password. Try a different password or request a new reset link.",
  };
  const error = typeof params.status === "string" ? errors[params.status] : undefined;
  return <main className={styles.shell}>
    <section className={styles.card} aria-labelledby="reset-heading">
      <Link href="/" className={styles.brand}><span className={styles.brandIcon}><CalendarDays size={22}/></span> Shiftboard</Link>
      <h1 id="reset-heading" className={styles.heading}>Choose a new password</h1>
      <p className={styles.description}>Use at least 12 characters. You’ll sign in again after saving your new password.</p>
      {error && <p className={`${styles.notice} ${styles.error}`} role="alert">{error}</p>}
      <form action={updatePassword} className="form-stack">
        <label htmlFor="password">New password<input id="password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></label>
        <label htmlFor="confirm-password">Confirm new password<input id="confirm-password" name="confirm_password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></label>
        <SubmitButton pendingText="Saving password…">Save new password</SubmitButton>
      </form>
    </section>
  </main>;
}
