import { prisma } from "../../lib/client.ts";
import { loadBoardConfigs } from "./config.ts";
import { fetchGreenhouseBoardJobs } from "./fetch.ts";
import { normalizeGreenhouseJob, type NormalizedJobListing } from "./normalize.ts";

// ---------------------------------------------------------------------------
// Greenhouse job-board connector: fetch -> normalize -> upsert.
//
// How this runs (issue #5 decision -- flagged rather than guessed silently,
// same spirit as packages/db/README.md's other "open infra decisions"
// call-outs):
//
// There's no job-scheduler/cron infrastructure anywhere in this repo yet, so
// this is a plain standalone script invoked via the `db:seed:greenhouse` npm
// script (see package.json), not a long-running worker or queue consumer.
// Run it by hand today; wiring it to a scheduler (cron, a serverless
// scheduled function, a queue) is a separate, later decision once one
// exists for the project generally -- building one just for this connector
// would be over-engineering a single-connector problem. See this
// directory's README.md for more on that trade-off and other open
// follow-ups (rate limiting, pagination, additional ATS connectors).
//
// Idempotency: every upsert keys on the JobListing (sourceConnector,
// externalId) unique constraint, so re-running this against the same boards
// updates existing rows in place instead of duplicating them -- safe to run
// repeatedly / on a schedule once one exists.
//
// Run with: `node connectors/greenhouse/run.ts` (from packages/db) --
// executable directly, no build step or ts-node/tsx dependency needed:
// Node's native TypeScript support (stable since Node 22.6, unflagged since
// 23.6) strips the type annotations at load time. Relative imports use
// explicit ".ts" extensions because Node's ESM loader (unlike a bundler or
// CommonJS `require`) does no implicit extension resolution --
// tsconfig.json's `allowImportingTsExtensions` keeps `tsc --noEmit` happy
// with that.
// ---------------------------------------------------------------------------

async function upsertJob(job: NormalizedJobListing): Promise<void> {
  await prisma.jobListing.upsert({
    where: {
      sourceConnector_externalId: {
        sourceConnector: job.sourceConnector,
        externalId: job.externalId,
      },
    },
    create: job,
    update: {
      // Deliberately omits sourceConnector/externalId -- that pair is the
      // idempotency key this upsert matched on, not something a re-fetch
      // should ever change.
      title: job.title,
      company: job.company,
      location: job.location,
      remoteType: job.remoteType,
      employmentType: job.employmentType,
      level: job.level,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      companySize: job.companySize,
      industry: job.industry,
      datePosted: job.datePosted,
      url: job.url,
      rawPayload: job.rawPayload,
    },
  });
}

async function run(): Promise<void> {
  const boards = loadBoardConfigs();
  if (boards.length === 0) {
    console.log("[greenhouse] No boards configured -- nothing to do.");
    return;
  }

  let upserted = 0;
  let failed = 0;

  for (const board of boards) {
    console.log(`[greenhouse] Fetching board "${board.boardToken}"...`);
    let jobs;
    try {
      ({ jobs } = await fetchGreenhouseBoardJobs(board.boardToken));
    } catch (err) {
      failed++;
      console.error(`[greenhouse] Failed to fetch board "${board.boardToken}":`, err);
      continue;
    }
    console.log(`[greenhouse] ${board.boardToken}: ${jobs.length} job(s) found`);

    for (const rawJob of jobs) {
      try {
        await upsertJob(normalizeGreenhouseJob(rawJob, board));
        upserted++;
      } catch (err) {
        failed++;
        console.error(`[greenhouse] Failed to upsert job ${rawJob.id} (board "${board.boardToken}"):`, err);
      }
    }
  }

  console.log(`[greenhouse] Done. Upserted ${upserted} listing(s), ${failed} failure(s).`);
  if (failed > 0) process.exitCode = 1;
}

run()
  .catch((err) => {
    console.error("[greenhouse] Fatal error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
