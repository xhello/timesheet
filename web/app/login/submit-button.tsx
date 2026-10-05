"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ children, pendingText = "Please wait…", secondary = false }: {
  children: React.ReactNode;
  pendingText?: string;
  secondary?: boolean;
}) {
  const { pending } = useFormStatus();
  return <button className={`btn ${secondary ? "outline" : "primary"} big full`} type="submit" disabled={pending} aria-disabled={pending}>
    {pending ? pendingText : children}
  </button>;
}
