import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { requireUserId } from "@/lib/require-user";
import type { Level } from "@/lib/types";

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;
  const profile = await repository.getProfile(userId);
  return NextResponse.json(profile);
}

interface ProfilePatchBody {
  locations?: string[];
  levels?: Level[];
  target_titles?: string[];
}

export async function PATCH(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;
  const body = (await request.json()) as ProfilePatchBody;
  const profile = await repository.saveProfile(userId, body);
  return NextResponse.json(profile);
}
