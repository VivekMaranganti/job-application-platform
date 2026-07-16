import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Which Lever sites to track -- same shape/precedence as
// connectors/greenhouse/config.ts (see that file's header for the full
// rationale, unchanged here): env var for a quick run, JSON file for
// per-site static metadata Lever's API can't supply itself.
// ---------------------------------------------------------------------------

export interface SiteConfig {
  /** Lever's site name, e.g. "leverdemo" in api.lever.co/v0/postings/leverdemo. */
  site: string;
  /** Overrides the `company` field on every listing from this site. Falls back to `site` if omitted -- Lever's postings API doesn't return a company display name field (unlike Greenhouse's `company_name`). */
  companyName?: string;
  /** Same rationale as Greenhouse's config.ts: not inferable from the API, so it's a per-site static override. Omit to leave `company_size` null. */
  companySize?: string;
  /** Same rationale as companySize. Omit to leave `industry` null. */
  industry?: string;
}

const DEFAULT_CONFIG_RELATIVE_PATH = "connectors/lever/sites.json";

/** Resolves relative to `process.cwd()` -- see greenhouse/config.ts's identical note for why. */
function defaultConfigPath(): string {
  return path.resolve(process.cwd(), DEFAULT_CONFIG_RELATIVE_PATH);
}

function parseSiteConfigEntry(entry: unknown, index: number, sourcePath: string): SiteConfig {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new Error(`${sourcePath}: entry ${index} must be an object`);
  }
  const e = entry as Record<string, unknown>;
  if (typeof e.site !== "string" || e.site.trim().length === 0) {
    throw new Error(`${sourcePath}: entry ${index} is missing a non-empty string "site"`);
  }
  return {
    site: e.site.trim(),
    companyName: typeof e.companyName === "string" ? e.companyName : undefined,
    companySize: typeof e.companySize === "string" ? e.companySize : undefined,
    industry: typeof e.industry === "string" ? e.industry : undefined,
  };
}

/** Loads the list of Lever sites to ingest. See module doc comment above for precedence. */
export function loadSiteConfigs(): SiteConfig[] {
  const envSites = process.env.LEVER_SITES;
  if (envSites !== undefined && envSites.trim().length > 0) {
    return envSites
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((site) => ({ site }));
  }

  const configPath = process.env.LEVER_SITES_CONFIG ?? defaultConfigPath();
  if (!existsSync(configPath)) {
    if (process.env.LEVER_SITES_CONFIG === undefined) {
      console.warn(
        `[lever] No config at ${configPath} and LEVER_SITES is not set. ` +
          `Copy connectors/lever/sites.example.json to sites.json (or set LEVER_SITES) to configure which sites to ingest.`
      );
      return [];
    }
    throw new Error(`LEVER_SITES_CONFIG points to a file that doesn't exist: ${configPath}`);
  }

  const raw = readFileSync(configPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${configPath}: not valid JSON (${(err as Error).message})`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${configPath}: must be a JSON array of site configs`);
  }
  return parsed.map((entry, i) => parseSiteConfigEntry(entry, i, configPath));
}
