import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { getCurrentUserId } from "@/lib/current-user";
import type { Level } from "@/lib/types";

export async function GET() {
  const userId = getCurrentUserId();
  const profile = await repository.getProfile(userId);
  return NextResponse.json(profile);
}

interface ProfilePatchBody {
  locations?: string[];
  levels?: Level[];
  target_titles?: string[];
}

export async function PATCH(request: Request) {
  const userId = getCurrentUserId();
  const body = (await request.json()) as ProfilePatchBody;
  const profile = await repository.saveProfile(userId, body);
  return NextResponse.json(profile);
}
