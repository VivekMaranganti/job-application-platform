import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Which SmartRecruiters companies to track -- same shape/precedence as
// connectors/ashby/config.ts and connectors/lever/config.ts (see those
// files' headers for the full rationale, unchanged here).
// ---------------------------------------------------------------------------

export interface CompanyConfig {
  /** SmartRecruiters' company identifier, e.g. "smartrecruiters" in api.smartrecruiters.com/v1/companies/smartrecruiters/postings -- find it via Settings/Admin -> "Career Pages & Job Ads" in the SmartRecruiters app (it's what follows the / in careers.smartrecruiters.com/<identifier>), per the official docs. */
  companyIdentifier: string;
  /** Overrides the `company` field on every listing from this company. Unlike Lever/Ashby, SmartRecruiters' API does return a real `company.name` on every posting -- this override is only used as a fallback if that field is ever missing, not as the primary source. */
  companyName?: string;
  /** Not inferable from the API, so it's a per-company static override. Omit to leave `company_size` null. */
  companySize?: string;
  /** Fallback only -- SmartRecruiters' API returns a real `industry.label` on most postings; this override is used only when a posting doesn't have one. */
  industry?: string;
}

const DEFAULT_CONFIG_RELATIVE_PATH = "connectors/smartrecruiters/companies.json";

/** Resolves relative to `process.cwd()` -- see greenhouse/config.ts's identical note for why. */
function defaultConfigPath(): string {
  return path.resolve(process.cwd(), DEFAULT_CONFIG_RELATIVE_PATH);
}

function parseCompanyConfigEntry(entry: unknown, index: number, sourcePath: string): CompanyConfig {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new Error(`${sourcePath}: entry ${index} must be an object`);
  }
  const e = entry as Record<string, unknown>;
  if (typeof e.companyIdentifier !== "string" || e.companyIdentifier.trim().length === 0) {
    throw new Error(`${sourcePath}: entry ${index} is missing a non-empty string "companyIdentifier"`);
  }
  return {
    companyIdentifier: e.companyIdentifier.trim(),
    companyName: typeof e.companyName === "string" ? e.companyName : undefined,
    companySize: typeof e.companySize === "string" ? e.companySize : undefined,
    industry: typeof e.industry === "string" ? e.industry : undefined,
  };
}

/** Loads the list of SmartRecruiters companies to ingest. See module doc comment above for precedence. */
export function loadCompanyConfigs(): CompanyConfig[] {
  const envCompanies = process.env.SMARTRECRUITERS_COMPANIES;
  if (envCompanies !== undefined && envCompanies.trim().length > 0) {
    return envCompanies
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((companyIdentifier) => ({ companyIdentifier }));
  }

  const configPath = process.env.SMARTRECRUITERS_COMPANIES_CONFIG ?? defaultConfigPath();
  if (!existsSync(configPath)) {
    if (process.env.SMARTRECRUITERS_COMPANIES_CONFIG === undefined) {
      console.warn(
        `[smartrecruiters] No config at ${configPath} and SMARTRECRUITERS_COMPANIES is not set. ` +
          `Copy connectors/smartrecruiters/companies.example.json to companies.json (or set SMARTRECRUITERS_COMPANIES) to configure which companies to ingest.`
      );
      return [];
    }
    throw new Error(`SMARTRECRUITERS_COMPANIES_CONFIG points to a file that doesn't exist: ${configPath}`);
  }

  const raw = readFileSync(configPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${configPath}: not valid JSON (${(err as Error).message})`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${configPath}: must be a JSON array of company configs`);
  }
  return parsed.map((entry, i) => parseCompanyConfigEntry(entry, i, configPath));
}
