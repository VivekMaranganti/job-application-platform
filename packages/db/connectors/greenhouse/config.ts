import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Which Greenhouse boards to pull is configuration, not something to
// hardcode into the connector. Two ways to supply it, checked in this
// order:
//
//   1. `GREENHOUSE_BOARD_TOKENS` env var -- a comma-separated list of board
//      tokens (e.g. "gitlab,asana"), for a quick one-off run with no
//      per-board metadata.
//   2. A JSON file (default `connectors/greenhouse/boards.json`, override
//      the path with `GREENHOUSE_BOARDS_CONFIG`) -- an array of
//      `BoardConfig` objects, so each board can also carry a couple of
//      static facts the Greenhouse API itself can't tell us (see
//      `companySize`/`industry` below).
//
// `boards.json` is git-ignored (like `.env`) since which companies an
// individual deployment tracks is deployment-specific, not something to
// commit. `boards.example.json` (checked in) documents the format --
// mirrors the project's existing `.env` / `.env.example` convention.
// ---------------------------------------------------------------------------

export interface BoardConfig {
  /** Greenhouse's board token, e.g. "gitlab" in boards-api.greenhouse.io/v1/boards/gitlab/jobs. */
  boardToken: string;
  /**
   * Overrides the `company` field on every listing from this board. Falls
   * back to Greenhouse's own `company_name` (present on every board response
   * we inspected) if omitted, and finally to `boardToken` if that's also
   * missing.
   */
  companyName?: string;
  /**
   * Stamped onto every listing from this board. Greenhouse's public Job
   * Board API has no employee-count/company-size field of any kind, so this
   * isn't something the connector can infer per job -- it's a static fact
   * the person configuring the board already knows about the company (e.g.
   * "this is Stripe, which is Enterprise (5,000+)"), supplied once here
   * instead of guessed per listing. Should match the exact labels in
   * apps/web/lib/types.ts's `CompanySize` union (e.g. "Startup (1-50)") so
   * the UI's company-size filter keeps working -- not enforced by a type
   * here since packages/db doesn't import app types (see normalize.ts).
   * Omit to leave `company_size` null.
   */
  companySize?: string;
  /** Same rationale as `companySize`: not inferable from the API, so it's a per-board static override. Omit to leave `industry` null. */
  industry?: string;
}

const DEFAULT_CONFIG_RELATIVE_PATH = "connectors/greenhouse/boards.json";

/**
 * Resolves relative to `process.cwd()`, not this file's location. That's
 * deliberate: this script is meant to be run via the `db:seed:greenhouse`
 * npm script (see package.json), and npm always sets `cwd` to the workspace
 * package's directory (packages/db) when running a workspace script --
 * whether invoked from inside packages/db directly or as
 * `npm run db:seed:greenhouse --workspace=auto-job-applier-db` from the repo
 * root. If you run this file directly with `node` from some other cwd, pass
 * `GREENHOUSE_BOARDS_CONFIG=/absolute/path/to/boards.json` to override.
 */
function defaultConfigPath(): string {
  return path.resolve(process.cwd(), DEFAULT_CONFIG_RELATIVE_PATH);
}

function parseBoardConfigEntry(entry: unknown, index: number, sourcePath: string): BoardConfig {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new Error(`${sourcePath}: entry ${index} must be an object`);
  }
  const e = entry as Record<string, unknown>;
  if (typeof e.boardToken !== "string" || e.boardToken.trim().length === 0) {
    throw new Error(`${sourcePath}: entry ${index} is missing a non-empty string "boardToken"`);
  }
  return {
    boardToken: e.boardToken.trim(),
    companyName: typeof e.companyName === "string" ? e.companyName : undefined,
    companySize: typeof e.companySize === "string" ? e.companySize : undefined,
    industry: typeof e.industry === "string" ? e.industry : undefined,
  };
}

/**
 * Loads the list of Greenhouse boards to ingest. See module doc comment
 * above for precedence (env var wins over the JSON file).
 */
export function loadBoardConfigs(): BoardConfig[] {
  const envTokens = process.env.GREENHOUSE_BOARD_TOKENS;
  if (envTokens !== undefined && envTokens.trim().length > 0) {
    return envTokens
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .map((boardToken) => ({ boardToken }));
  }

  const configPath = process.env.GREENHOUSE_BOARDS_CONFIG ?? defaultConfigPath();
  if (!existsSync(configPath)) {
    if (process.env.GREENHOUSE_BOARDS_CONFIG === undefined) {
      // Only the *default* path gets the friendly "did you forget to set
      // this up" message -- an explicit GREENHOUSE_BOARDS_CONFIG that
      // doesn't exist is more likely a real typo/misconfiguration.
      console.warn(
        `[greenhouse] No config at ${configPath} and GREENHOUSE_BOARD_TOKENS is not set. ` +
          `Copy connectors/greenhouse/boards.example.json to boards.json (or set GREENHOUSE_BOARD_TOKENS) to configure which boards to ingest.`
      );
      return [];
    }
    throw new Error(`GREENHOUSE_BOARDS_CONFIG points to a file that doesn't exist: ${configPath}`);
  }

  const raw = readFileSync(configPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${configPath}: not valid JSON (${(err as Error).message})`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${configPath}: must be a JSON array of board configs`);
  }
  return parsed.map((entry, i) => parseBoardConfigEntry(entry, i, configPath));
}
