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
  full_name?: string | null;
  phone?: string | null;
  contact_email?: string | null;
  linkedin_url?: string | null;
  portfolio_url?: string | null;
}

const CONTACT_STRING_FIELDS = ["full_name", "phone", "contact_email", "linkedin_url", "portfolio_url"] as const;

/**
 * These feed directly into the apply agent's automated form-filling, so a
 * malformed value here isn't just a display bug -- it's something that
 * could get typed into a real application field. Keep validation light
 * (this app has never strictly validated free-text fields) but reject
 * non-string/non-null garbage rather than silently coercing it.
 */
function validateContactFields(body: ProfilePatchBody): string | null {
  for (const field of CONTACT_STRING_FIELDS) {
    const value = body[field];
    if (value !== undefined && value !== null && typeof value !== "string") {
      return `"${field}" must be a string or null.`;
    }
  }
  return null;
}

export async function PATCH(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;
  const body = (await request.json()) as ProfilePatchBody;
  const validationError = validateContactFields(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }
  const profile = await repository.saveProfile(userId, body);
  return NextResponse.json(profile);
}
