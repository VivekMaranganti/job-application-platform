import { prisma } from "../../lib/client.ts";
import { loadSiteConfigs } from "./config.ts";
import { fetchLeverSitePostings } from "./fetch.ts";
import { normalizeLeverPosting, type NormalizedJobListing } from "./normalize.ts";

// ---------------------------------------------------------------------------
// Lever job-board connector: fetch -> normalize -> upsert. Same
// fetch/normalize/upsert shape and one-shot-script-not-a-scheduler decision
// as connectors/greenhouse/run.ts -- see that file's header and
// connectors/greenhouse/README.md for the full rationale (unchanged here).
//
// Run with: `node connectors/lever/run.ts` (from packages/db), or
// `npm run db:seed:lever` (see package.json).
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
  const sites = loadSiteConfigs();
  if (sites.length === 0) {
    console.log("[lever] No sites configured -- nothing to do.");
    return;
  }

  let upserted = 0;
  let failed = 0;

  for (const site of sites) {
    console.log(`[lever] Fetching site "${site.site}"...`);
    let postings;
    try {
      postings = await fetchLeverSitePostings(site.site);
    } catch (err) {
      failed++;
      console.error(`[lever] Failed to fetch site "${site.site}":`, err);
      continue;
    }
    console.log(`[lever] ${site.site}: ${postings.length} posting(s) found`);

    for (const posting of postings) {
      try {
        await upsertJob(normalizeLeverPosting(posting, site));
        upserted++;
      } catch (err) {
        failed++;
        console.error(`[lever] Failed to upsert posting ${posting.id} (site "${site.site}"):`, err);
      }
    }
  }

  console.log(`[lever] Done. Upserted ${upserted} listing(s), ${failed} failure(s).`);
  if (failed > 0) process.exitCode = 1;
}

run()
  .catch((err) => {
    console.error("[lever] Fatal error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
