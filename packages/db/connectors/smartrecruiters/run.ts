import { prisma } from "../../lib/client.ts";
import { loadCompanyConfigs } from "./config.ts";
import { fetchSmartRecruitersPostingDetails, fetchSmartRecruitersPostings } from "./fetch.ts";
import { normalizeSmartRecruitersPosting, type NormalizedJobListing } from "./normalize.ts";

// ---------------------------------------------------------------------------
// SmartRecruiters connector: fetch (list) -> fetch (detail, per posting) ->
// normalize -> upsert. Same fetch/normalize/upsert shape and
// one-shot-script-not-a-scheduler decision as connectors/ashby/run.ts,
// connectors/lever/run.ts, and connectors/greenhouse/run.ts -- see those
// files' headers and connectors/greenhouse/README.md for the full
// rationale (unchanged here). The extra per-posting detail fetch (needed to
// get a real public URL -- see fetch.ts) is this connector's one structural
// difference from the others.
//
// Run with: `node connectors/smartrecruiters/run.ts` (from packages/db), or
// `npm run db:seed:smartrecruiters` (see package.json).
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
  const companies = loadCompanyConfigs();
  if (companies.length === 0) {
    console.log("[smartrecruiters] No companies configured -- nothing to do.");
    return;
  }

  let upserted = 0;
  let failed = 0;

  for (const company of companies) {
    console.log(`[smartrecruiters] Fetching company "${company.companyIdentifier}"...`);
    let postings;
    try {
      postings = await fetchSmartRecruitersPostings(company.companyIdentifier);
    } catch (err) {
      failed++;
      console.error(`[smartrecruiters] Failed to fetch company "${company.companyIdentifier}":`, err);
      continue;
    }
    console.log(`[smartrecruiters] ${company.companyIdentifier}: ${postings.length} posting(s) found`);

    for (const posting of postings) {
      try {
        // The list endpoint has no public job-page URL (see fetch.ts) --
        // JobListing.url is a required, non-null field per the schema, so
        // a posting whose detail fetch fails or comes back without a
        // postingUrl can't be represented and is skipped (counted as a
        // failure) rather than stored with a fabricated URL.
        const details = await fetchSmartRecruitersPostingDetails(company.companyIdentifier, posting.id);
        if (!details.postingUrl) {
          throw new Error("detail response has no postingUrl");
        }
        await upsertJob(normalizeSmartRecruitersPosting(posting, details, company, details.postingUrl));
        upserted++;
      } catch (err) {
        failed++;
        console.error(
          `[smartrecruiters] Failed to fetch/upsert posting ${posting.id} (company "${company.companyIdentifier}"):`,
          err
        );
      }
    }
  }

  console.log(`[smartrecruiters] Done. Upserted ${upserted} listing(s), ${failed} failure(s).`);
  if (failed > 0) process.exitCode = 1;
}

run()
  .catch((err) => {
    console.error("[smartrecruiters] Fatal error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
