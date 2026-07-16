import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { requireUserId } from "@/lib/require-user";
import type { CompanySize, DatePosted, EmploymentType, WorkArrangement } from "@/lib/types";

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;
  const filters = await repository.getFilters(userId);
  return NextResponse.json(filters);
}

interface FiltersPatchBody {
  work_arrangement?: WorkArrangement[];
  employment_type?: EmploymentType[];
  company_size?: CompanySize[];
  salary_min?: number | null;
  date_posted?: DatePosted;
  industries?: string[];
  exclude_companies?: string[];
  special_instructions?: string;
}

export async function PATCH(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;
  const body = (await request.json()) as FiltersPatchBody;
  const filters = await repository.saveFilters(userId, body);
  return NextResponse.json(filters);
}
