import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { getCurrentUserId } from "@/lib/current-user";
import { REQUIRED_FIELDS, type RequiredFieldId, type RequiredFieldMode } from "@/lib/types";

export async function GET() {
  const userId = getCurrentUserId();
  const answers = await repository.getRequiredInfoAnswers(userId);
  const byField = new Map(answers.map((a) => [a.field_id, a]));
  // Always return a full row per known field (defaulting to manual/empty)
  // so the client doesn't have to special-case "never answered".
  const full = REQUIRED_FIELDS.map(
    (f) => byField.get(f.id) ?? { user_id: userId, field_id: f.id, mode: "manual" as RequiredFieldMode, value: "" }
  );
  return NextResponse.json(full);
}

interface RequiredInfoPatchBody {
  field_id: RequiredFieldId;
  mode?: RequiredFieldMode;
  value?: string;
}

export async function PATCH(request: Request) {
  const userId = getCurrentUserId();
  const body = (await request.json()) as RequiredInfoPatchBody;
  if (!body.field_id) {
    return NextResponse.json({ error: "field_id is required" }, { status: 400 });
  }
  const answer = await repository.saveRequiredInfoAnswer(userId, body.field_id, {
    mode: body.mode,
    value: body.value,
  });
  return NextResponse.json(answer);
}
