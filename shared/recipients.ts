export const MAX_RECIPIENTS = 20;
export function validEmailAddress(value: string) {
  return (
    value.length <= 254 &&
    !/[\x00-\x1f\x7f]/.test(value) &&
    /^[^\s@<>,;，；、]+@[^\s@<>,;，；、]+\.[^\s@<>,;，；、]+$/u.test(value)
  );
}
// Use identical parsing for recipient fields and API callers. Validate the whole
// list before creating a share; never silently discard an invalid address.
export function parseRecipients(value: unknown): string[] {
  const entries = typeof value === "string" ? [value] : value;
  if (
    !Array.isArray(entries) ||
    !entries.every((entry) => typeof entry === "string")
  )
    throw new Error("Enter 1–20 recipient email addresses.");
  const addresses = new Set<string>();
  for (const entry of entries) {
    for (const token of entry.split(/[\s,;，；、]+/u).filter(Boolean)) {
      const address = token.toLowerCase();
      if (!validEmailAddress(address))
        throw new Error(`Check this email address: ${token.slice(0, 254)}`);
      addresses.add(address);
      if (addresses.size > MAX_RECIPIENTS)
        throw new Error("Enter 1–20 recipient email addresses.");
    }
  }
  if (!addresses.size) throw new Error("Enter 1–20 recipient email addresses.");
  return [...addresses];
}
