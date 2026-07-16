import type { Repository } from "./types";
import { postgresRepository } from "./postgres";

// ---------------------------------------------------------------------------
// The one place that decides which Repository implementation backs the app.
//
// Backed by Postgres (packages/db) as of the repository-wiring pass that
// closed out issue #2's integration gap. `memory.ts` (the original issue #1
// stub) is kept in the tree for reference/tests but is no longer wired up
// here -- running the app now requires a reachable Postgres instance with
// migrations applied (see packages/db/README.md). Nothing outside
// `lib/repository` (API routes, hooks, components) imports an
// implementation directly, so this is the only line that needs to change.
// ---------------------------------------------------------------------------

export const repository: Repository = postgresRepository;

export type { Repository } from "./types";
