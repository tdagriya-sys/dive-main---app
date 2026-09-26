/**
 * Masks an email address or mobile number so it can be recorded in the activity
 * stream (failed-login attempts against an account that may not exist) without
 * writing a full personal identifier for a person who never signed in:
 *
 *   tushar@divve.in  ->  t***@divve.in
 *   9509866887       ->  95******87
 *
 * Enough to recognise "the same person keeps trying", not enough to identify them.
 */
export function maskIdentifier(raw: string | undefined | null): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  if (value.includes("@")) {
    const [local, ...rest] = value.split("@");
    const domain = rest.join("@");
    return `${local.slice(0, 1)}***@${domain}`;
  }
  const digits = value.replace(/\s+/g, "");
  if (digits.length <= 4) return "*".repeat(digits.length);
  return `${digits.slice(0, 2)}${"*".repeat(Math.max(2, digits.length - 4))}${digits.slice(-2)}`;
}
