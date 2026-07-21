import { prisma } from "../../lib/client.ts";
import { loadJobBoardConfigs } from "./config.ts";
import { fetchAshbyJobBoardPostings } from "./fetch.ts";
import { normalizeAshbyJob, type NormalizedJobListing } from "./normalize.ts";

// ---------------------------------------------------------------------------
// Ashby job-board connector: fetch -> normalize -> upsert. Same
// fetch/normalize/upsert shape and one-shot-script-not-a-scheduler decision
// as connectors/lever/run.ts and connectors/greenhouse/run.ts -- see those
// files' headers and connectors/greenhouse/README.md for the full rationale
// (unchanged here).
//
// Run with: `node connectors/ashby/run.ts` (from packages/db), or
// `npm run db:seed:ashby` (see package.json).
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
  const boards = loadJobBoardConfigs();
  if (boards.length === 0) {
    console.log("[ashby] No job boards configured -- nothing to do.");
    return;
  }

  let upserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const board of boards) {
    console.log(`[ashby] Fetching job board "${board.jobBoardName}"...`);
    let response;
    try {
      response = await fetchAshbyJobBoardPostings(board.jobBoardName);
    } catch (err) {
      failed++;
      console.error(`[ashby] Failed to fetch job board "${board.jobBoardName}":`, err);
      continue;
    }
    console.log(`[ashby] ${board.jobBoardName}: ${response.jobs.length} posting(s) found`);

    for (const job of response.jobs) {
      // isListed === false means the posting exists but is intentionally
      // excluded from the board's public listing page (only reachable via
      // a direct link, per Ashby's docs) -- an aggregator that surfaces it
      // anyway would be showing something the employer chose not to list.
      // Skipped, not upserted, and not counted as a failure.
      if (job.isListed === false) {
        skipped++;
        continue;
      }
      try {
        await upsertJob(normalizeAshbyJob(job, board));
        upserted++;
      } catch (err) {
        failed++;
        console.error(`[ashby] Failed to upsert posting "${job.jobUrl}" (board "${board.jobBoardName}"):`, err);
      }
    }
  }

  console.log(`[ashby] Done. Upserted ${upserted} listing(s), skipped ${skipped} unlisted, ${failed} failure(s).`);
  if (failed > 0) process.exitCode = 1;
}

run()
  .catch((err) => {
    console.error("[ashby] Fatal error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
