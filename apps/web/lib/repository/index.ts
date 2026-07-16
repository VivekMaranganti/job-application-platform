import type { Repository } from "./types";
import { memoryRepository } from "./memory";

// ---------------------------------------------------------------------------
// The one place that decides which Repository implementation backs the app.
//
// TODO(merge / issue #2): once `packages/db` has a real Prisma client and
// encryption helper, add `./postgres.ts` implementing `Repository` against
// them, and swap the export below to it. Nothing outside `lib/repository`
// (API routes, hooks, components) imports `memory.ts` directly, so this is
// the only line that needs to change.
// ---------------------------------------------------------------------------

export const repository: Repository = memoryRepository;

export type { Repository } from "./types";
