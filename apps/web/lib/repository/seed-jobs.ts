import type { JobListing } from "@/lib/types";

// ---------------------------------------------------------------------------
// Stand-ins for what real ATS connectors (Greenhouse / Lever / Ashby /
// Workday) would return, ported from the job-application-profile.jsx
// prototype's MOCK_JOBS. Each carries a source_connector so it's clear
// where it would come from once real connectors (a separate future issue)
// are wired up.
// ---------------------------------------------------------------------------

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

interface SeedJob {
  id: string;
  title: string;
  company: string;
  location: string;
  remote: JobListing["remote_type"];
  employmentType: JobListing["employment_type"];
  level: JobListing["level"];
  salaryMin: number | null;
  salaryMax: number | null;
  companySize: JobListing["company_size"];
  industry: string;
  datePostedDaysAgo: number;
  sourceConnector: string;
}

const SEED: SeedJob[] = [
  { id: "j1", title: "Senior Product Manager", company: "Northwind Analytics", location: "Austin, TX", remote: "Hybrid", employmentType: "Full-time", level: "Senior", salaryMin: 140000, salaryMax: 175000, companySize: "Small-mid (51-500)", industry: "Software", datePostedDaysAgo: 2, sourceConnector: "Greenhouse" },
  { id: "j2", title: "Product Manager, Growth", company: "Fernwood Health", location: "Remote", remote: "Remote", employmentType: "Full-time", level: "Mid level", salaryMin: 115000, salaryMax: 135000, companySize: "Large (501-5,000)", industry: "Healthcare", datePostedDaysAgo: 5, sourceConnector: "Lever" },
  { id: "j3", title: "Staff Product Manager", company: "Cascade Robotics", location: "Austin, TX", remote: "Onsite", employmentType: "Full-time", level: "Staff / Principal", salaryMin: 170000, salaryMax: 205000, companySize: "Startup (1-50)", industry: "Robotics", datePostedDaysAgo: 1, sourceConnector: "Ashby" },
  { id: "j4", title: "Associate Product Manager", company: "Fernwood Health", location: "Remote", remote: "Remote", employmentType: "Full-time", level: "Entry level", salaryMin: 85000, salaryMax: 100000, companySize: "Large (501-5,000)", industry: "Healthcare", datePostedDaysAgo: 20, sourceConnector: "Lever" },
  { id: "j5", title: "Product Marketing Manager", company: "Northwind Analytics", location: "Austin, TX", remote: "Hybrid", employmentType: "Contract", level: "Mid level", salaryMin: 90000, salaryMax: 110000, companySize: "Small-mid (51-500)", industry: "Software", datePostedDaysAgo: 9, sourceConnector: "Greenhouse" },
  { id: "j6", title: "Director of Product", company: "Halcyon Freight", location: "Dallas, TX", remote: "Onsite", employmentType: "Full-time", level: "Director", salaryMin: 190000, salaryMax: 230000, companySize: "Enterprise (5,000+)", industry: "Logistics", datePostedDaysAgo: 3, sourceConnector: "Workday" },
  { id: "j7", title: "Senior Product Manager, Platform", company: "Ridgeline Data", location: "Remote", remote: "Remote", employmentType: "Full-time", level: "Senior", salaryMin: 150000, salaryMax: 180000, companySize: "Small-mid (51-500)", industry: "Software", datePostedDaysAgo: 1, sourceConnector: "Ashby" },
  { id: "j8", title: "Product Manager Intern", company: "Cascade Robotics", location: "Austin, TX", remote: "Onsite", employmentType: "Internship", level: "Entry level", salaryMin: null, salaryMax: null, companySize: "Startup (1-50)", industry: "Robotics", datePostedDaysAgo: 6, sourceConnector: "Ashby" },
];

export function seedJobListings(): JobListing[] {
  return SEED.map((j) => ({
    id: j.id,
    source_connector: j.sourceConnector,
    external_id: j.id,
    title: j.title,
    company: j.company,
    location: j.location,
    remote_type: j.remote,
    employment_type: j.employmentType,
    level: j.level,
    salary_min: j.salaryMin,
    salary_max: j.salaryMax,
    company_size: j.companySize,
    industry: j.industry,
    date_posted: daysAgo(j.datePostedDaysAgo),
    url: `https://example-ats.invalid/${j.sourceConnector.toLowerCase()}/${j.id}`,
    raw_payload: { note: "seed data — stands in for a real connector payload" },
  }));
}
