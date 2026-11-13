// The human check on the online booking page (design: booking/design/human-check.html): is a person, not a program, sending
// this form? Cloudflare Turnstile runs in the patient's browser and hands the page a token; this asks Cloudflare whether the
// token is good. Only the token and the IP address go to Cloudflare, never the name, number or booking.
//
// The answer is "passed", "failed" or "unavailable", and it never throws:
//   - "unavailable" only when Cloudflare itself doesn't answer (timeout, network error, a Cloudflare server error);
//   - a missing token is still sent (as "none"), so a page that sends none while Cloudflare is up gets "failed": a program
//     cannot skip the check by claiming Cloudflare is down.
export const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Cloudflare's published test secrets (always pass, always fail, "already used"). Their answers don't name our hostname or the
// form, so with them only "success" is looked at. For trying the page on a computer, never for the live site.
export const isTestSecret = (secret) => /^[123]x0{31}AA$/.test(secret);

// keys: { siteKey, secret, timeoutMs } from booking/.env. Null when either key is missing: then nothing is checked anywhere.
export function humanChecker({ siteKey, secret, timeoutMs = 4000 } = {}, { fetch = globalThis.fetch, log = console } = {}) {
  if (!siteKey || !secret) return null;
  const test = isTestSecret(secret);
  if (test) log.warn?.("Human check: Cloudflare's test keys are in use. Fine on a computer, never on the live site.");
  // action: the form ("book", "chat_book", "callback", "find", "chat_start"); hostname: the page's own (from PUBLIC_SITE_URL).
  async function check(token, { action, hostname, ip }) {
    let r;
    try {
      r = await fetch(VERIFY_URL, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret, response: token || "none", ...(ip ? { remoteip: ip } : {}) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch { return "unavailable"; }
    if (r.status >= 500) return "unavailable";
    const j = await r.json().catch(() => null);
    if (!j || j["error-codes"]?.includes("internal-error")) return "unavailable";
    if (j.success !== true) return "failed";
    return test || (j.action === action && j.hostname === hostname) ? "passed" : "failed";
  }
  return { siteKey, check };
}
