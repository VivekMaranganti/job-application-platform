import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";

// Not user-scoped — job listings are a shared, tenant-agnostic fact (see
// packages/db schema comments). Matching against a user's profile/filters
// happens client-side via lib/match-jobs.ts, mirroring the prototype.
export async function GET() {
  const jobs = await repository.listJobListings();
  return NextResponse.json(jobs);
}
