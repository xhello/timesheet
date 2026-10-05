/** Store and compare phone numbers in one international format. */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value || value.length > 48 || !/^[+0-9() .-]+$/.test(value)) return null;
  if (value.includes("+") && (!value.startsWith("+") || value.indexOf("+", 1) !== -1)) return null;
  // Permit a single conventional area-code group, but reject broken or nested groups.
  if (/[()]/.test(value) && !/^[^()]*\([0-9]{1,4}\)[^()]*$/.test(value)) return null;
  const digits = value.replace(/[^0-9]/g, "");
  if (value.startsWith("+")) return /^[1-9][0-9]{7,14}$/.test(digits) ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
