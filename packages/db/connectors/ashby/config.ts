import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Which Ashby job boards to track -- same shape/precedence as
// connectors/lever/config.ts (see that file's header, and
// connectors/greenhouse/config.ts before it, for the full rationale,
// unchanged here): env var for a quick run, JSON file for per-board static
// metadata Ashby's API can't supply itself.
// ---------------------------------------------------------------------------

export interface JobBoardConfig {
  /** Ashby's job board name, e.g. "Ashby" in api.ashbyhq.com/posting-api/job-board/Ashby -- see the official docs' "How to find your jobs page name" section (the last path segment of your Ashby-hosted job board URL). */
  jobBoardName: string;
  /** Overrides the `company` field on every listing from this board. Falls back to `jobBoardName` if omitted -- like Lever, Ashby's public postings API has no company-display-name field. */
  companyName?: string;
  /** Not inferable from the API, so it's a per-board static override. Omit to leave `company_size` null. */
  companySize?: string;
  /** Same rationale as companySize. Omit to leave `industry` null. */
  industry?: string;
}

const DEFAULT_CONFIG_RELATIVE_PATH = "connectors/ashby/job-boards.json";

/** Resolves relative to `process.cwd()` -- see greenhouse/config.ts's identical note for why. */
function defaultConfigPath(): string {
  return path.resolve(process.cwd(), DEFAULT_CONFIG_RELATIVE_PATH);
}

function parseJobBoardConfigEntry(entry: unknown, index: number, sourcePath: string): JobBoardConfig {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new Error(`${sourcePath}: entry ${index} must be an object`);
  }
  const e = entry as Record<string, unknown>;
  if (typeof e.jobBoardName !== "string" || e.jobBoardName.trim().length === 0) {
    throw new Error(`${sourcePath}: entry ${index} is missing a non-empty string "jobBoardName"`);
  }
  return {
    jobBoardName: e.jobBoardName.trim(),
    companyName: typeof e.companyName === "string" ? e.companyName : undefined,
    companySize: typeof e.companySize === "string" ? e.companySize : undefined,
    industry: typeof e.industry === "string" ? e.industry : undefined,
  };
}

/** Loads the list of Ashby job boards to ingest. See module doc comment above for precedence. */
export function loadJobBoardConfigs(): JobBoardConfig[] {
  const envBoards = process.env.ASHBY_JOB_BOARDS;
  if (envBoards !== undefined && envBoards.trim().length > 0) {
    return envBoards
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((jobBoardName) => ({ jobBoardName }));
  }

  const configPath = process.env.ASHBY_JOB_BOARDS_CONFIG ?? defaultConfigPath();
  if (!existsSync(configPath)) {
    if (process.env.ASHBY_JOB_BOARDS_CONFIG === undefined) {
      console.warn(
        `[ashby] No config at ${configPath} and ASHBY_JOB_BOARDS is not set. ` +
          `Copy connectors/ashby/job-boards.example.json to job-boards.json (or set ASHBY_JOB_BOARDS) to configure which job boards to ingest.`
      );
      return [];
    }
    throw new Error(`ASHBY_JOB_BOARDS_CONFIG points to a file that doesn't exist: ${configPath}`);
  }

  const raw = readFileSync(configPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${configPath}: not valid JSON (${(err as Error).message})`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${configPath}: must be a JSON array of job board configs`);
  }
  return parsed.map((entry, i) => parseJobBoardConfigEntry(entry, i, configPath));
}
