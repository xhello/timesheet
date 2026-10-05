import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { normalizePhone } from "@/lib/phone";
import { readState } from "@/lib/storage";
import type { CurrentUser } from "@/lib/auth";
import type { Employee } from "@/lib/schedule";

export const EMPLOYEE_SESSION_COOKIE = "schedule_employee_session";
export const EMPLOYEE_SESSION_SECONDS = 7 * 24 * 60 * 60;
type SessionClaims = { v: 1; employeeId: string; phoneVersion: string; iat: number; exp: number };

export function employeeSessionSecret(): string {
  const secret = process.env.EMPLOYEE_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Employee sign-in is not configured.");
  return secret;
}

function signature(body: string, secret: string) {
  return createHmac("sha256", secret).update(`employee-session:v1:${body}`).digest("base64url");
}

/** Signed claims contain no phone number. The current roster is checked on every request. */
export function sealEmployeeSession(employee: Pick<Employee, "id" | "phoneVersion">, secret: string, now = Math.floor(Date.now() / 1000)): string {
  if (secret.length < 32 || !employee.id || !employee.phoneVersion) throw new Error("Employee sign-in is not configured.");
  const claims: SessionClaims = { v: 1, employeeId: employee.id, phoneVersion: employee.phoneVersion, iat: now, exp: now + EMPLOYEE_SESSION_SECONDS };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${signature(body, secret)}`;
}

export function unsealEmployeeSession(token: string, secret: string, now = Math.floor(Date.now() / 1000)): SessionClaims | null {
  if (secret.length < 32 || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
  const expected = Buffer.from(signature(parts[0], secret));
  const received = Buffer.from(parts[1]);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (claims?.v !== 1 || typeof claims.employeeId !== "string" || !claims.employeeId || claims.employeeId.length > 128 ||
      typeof claims.phoneVersion !== "string" || !claims.phoneVersion || claims.phoneVersion.length > 128 ||
      !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || claims.iat > now + 60 ||
      claims.exp <= now || claims.exp <= claims.iat || claims.exp - claims.iat > EMPLOYEE_SESSION_SECONDS) return null;
    return claims as SessionClaims;
  } catch {
    return null;
  }
}

function cookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: EMPLOYEE_SESSION_SECONDS };
}

export async function createEmployeeSession(employee: Employee): Promise<void> {
  if (!employee.active || !employee.phone || normalizePhone(employee.phone) !== employee.phone || !employee.phoneVersion) {
    throw new Error("Employee sign-in is not available.");
  }
  const cookieStore = await cookies();
  cookieStore.set(EMPLOYEE_SESSION_COOKIE, sealEmployeeSession(employee, employeeSessionSecret()), cookieOptions());
}

export async function clearEmployeeSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(EMPLOYEE_SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0, expires: new Date(0) });
}

export async function readEmployeeSession(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(EMPLOYEE_SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = unsealEmployeeSession(token, employeeSessionSecret());
  if (!claims) return null;
  const saved = await readState();
  const employee = saved?.state.employees.find(item => item.id === claims.employeeId);
  if (!employee?.active || !employee.phone || normalizePhone(employee.phone) !== employee.phone || employee.phoneVersion !== claims.phoneVersion) return null;
  return { authType: "phone", userId: `employee:${employee.id}`, employeeId: employee.id, phoneVersion: claims.phoneVersion, displayName: employee.name, email: "", emailVerified: false };
}
