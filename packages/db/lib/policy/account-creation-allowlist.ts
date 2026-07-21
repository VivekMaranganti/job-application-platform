// ---------------------------------------------------------------------------
// Where the agent is allowed to create an account (issue: credential vault).
//
// This is the gate that decides whether the apply agent may register a new
// account on a site. It lives in lib/policy/ for the same reason
// criminal-history-jurisdiction.ts does: it's a guardrail with real
// consequences if it's wrong, and it has two consumers on opposite sides of
// the monorepo (apps/web's save path, apps/apply-agent-service's automation
// loop), neither of which depends on the other.
//
// The rule is an explicit allowlist of ATS vendors, not a heuristic.
//
// The obvious-looking alternative -- "allow anything served over HTTPS with
// a valid certificate" -- does not work, and it's worth being precise about
// why, because it's an easy mistake to make. TLS authenticates the
// *connection*: it proves you're talking to whoever controls that hostname,
// and that nobody is reading the bytes in between. It says nothing at all
// about whether that party is trustworthy. Certificates are free and
// issued in seconds via ACME, so a credential-harvesting page that clones
// Workday's login screen has exactly as green a padlock as Workday does.
// Any check based on cert validity alone would hand a real password to that
// page and record it as a success.
//
// So HTTPS is treated here as necessary but nowhere near sufficient: the
// hostname must ALSO resolve to a vendor we've named in advance.
//
// Failure mode is deliberately asymmetric. An unknown-but-legitimate ATS
// gets refused and the agent yields to the human -- annoying, recoverable in
// seconds. A lookalike domain getting through means the agent types real
// credentials into an attacker's form -- silent, and not recoverable. The
// list stays short and the check stays strict.
// ---------------------------------------------------------------------------

/** A vendor whose registration pages the agent may drive. */
export interface AllowedAtsVendor {
  /** Registrable domain (eTLD+1), lowercase, no leading dot. */
  domain: string;
  /** Display label stored on the credential row and shown in the UI. */
  siteName: string;
}

/**
 * The allowlist.
 *
 * Every entry here is an ATS vendor this repo already has a connector for
 * (see packages/db/connectors/) or that the apply agent is known to
 * encounter, and whose registration flow is a normal candidate-account
 * signup rather than something requiring an employer relationship.
 *
 * Adding an entry is a code change and a PR review on purpose -- the same
 * reasoning as JURISDICTION_POLICY in criminal-history-jurisdiction.ts.
 * There is intentionally no runtime toggle, admin setting, or env var that
 * can widen this list, because a config-file allowlist is exactly the kind
 * of thing that gets loosened at 2am to unblock a run and never tightened
 * again.
 */
export const ALLOWED_ATS_VENDORS: readonly AllowedAtsVendor[] = [
  { domain: "greenhouse.io", siteName: "Greenhouse" },
  { domain: "lever.co", siteName: "Lever" },
  { domain: "ashbyhq.com", siteName: "Ashby" },
  { domain: "smartrecruiters.com", siteName: "SmartRecruiters" },
  { domain: "myworkdayjobs.com", siteName: "Workday" },
  { domain: "myworkdaysite.com", siteName: "Workday" },
  { domain: "icims.com", siteName: "iCIMS" },
] as const;

/** Result of an allowlist check. Discriminated so callers must handle denial. */
export type AllowlistDecision =
  | {
      allowed: true;
      /** The matched registrable domain -- what to persist as `domain`. */
      domain: string;
      /** Vendor display label -- what to persist as `siteName`. */
      siteName: string;
      /** Full hostname the URL actually pointed at, for the audit trail. */
      hostname: string;
    }
  | {
      allowed: false;
      /** Machine-readable reason, for logging and for the UI's message. */
      reason:
        | "malformed_url"
        | "not_https"
        | "credentials_in_url"
        | "ip_address_host"
        | "domain_not_allowlisted";
      /** Human-readable explanation, safe to show the user. */
      detail: string;
    };

/**
 * True when `hostname` is `domain` itself or a subdomain of it.
 *
 * This is the part that's easy to get wrong, so it's spelled out rather
 * than done inline with `includes` or a bare `endsWith`:
 *
 *   - `hostname.includes("greenhouse.io")` matches "greenhouse.io.evil.com".
 *   - `hostname.endsWith("greenhouse.io")` matches "notgreenhouse.io" and
 *     "evil-greenhouse.io" -- a domain an attacker can simply register.
 *
 * Requiring either an exact match or a match on "." + domain closes both:
 * "boards.greenhouse.io" passes, "evil-greenhouse.io" does not, because the
 * character before the suffix must be a literal dot.
 */
function isHostWithinDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * Decides whether the agent may create an account at `url`.
 *
 * Fails closed on every path: anything unparseable, non-HTTPS, or not
 * matching a listed vendor is denied. There is no "unknown" outcome and no
 * default-allow branch.
 */
export function checkAccountCreationAllowed(url: string): AllowlistDecision {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      allowed: false,
      reason: "malformed_url",
      detail: "That isn't a parseable URL, so there's no host to check.",
    };
  }

  // HTTPS only. Over plaintext HTTP the password is readable by anything on
  // the path, which makes the allowlist moot -- the right host doesn't help
  // if the wire is open. Note this is checked *in addition to* the domain
  // match below, never instead of it.
  if (parsed.protocol !== "https:") {
    return {
      allowed: false,
      reason: "not_https",
      detail: `Account creation requires HTTPS; this URL uses ${parsed.protocol.replace(":", "")}.`,
    };
  }

  // A URL carrying inline credentials ("https://user:pass@host/") is a
  // classic way to make a hostile host look familiar in a UI that truncates,
  // and legitimate ATS signup links never contain them.
  if (parsed.username !== "" || parsed.password !== "") {
    return {
      allowed: false,
      reason: "credentials_in_url",
      detail: "URLs containing inline credentials are refused.",
    };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");

  // A bare IP can't be matched against a registrable domain, and no real ATS
  // asks candidates to register against one.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[")) {
    return {
      allowed: false,
      reason: "ip_address_host",
      detail: "Account creation against a raw IP address is refused.",
    };
  }

  const vendor = ALLOWED_ATS_VENDORS.find((v) => isHostWithinDomain(hostname, v.domain));
  if (!vendor) {
    return {
      allowed: false,
      reason: "domain_not_allowlisted",
      detail:
        `${hostname} is not on the list of ATS vendors this agent may create accounts on. ` +
        `A valid HTTPS certificate isn't enough on its own -- it proves the connection is ` +
        `encrypted, not that the site is who it appears to be. Create this account yourself ` +
        `if you trust it, then save the credentials manually.`,
    };
  }

  return { allowed: true, domain: vendor.domain, siteName: vendor.siteName, hostname };
}

/**
 * Convenience wrapper for call sites that only need the boolean.
 *
 * Prefer `checkAccountCreationAllowed` where the reason matters (the agent's
 * yield-to-human message, anything user-facing) -- "no" with a reason is far
 * more useful to a person watching a session than a silent skip.
 */
export function isAccountCreationAllowed(url: string): boolean {
  return checkAccountCreationAllowed(url).allowed;
}
