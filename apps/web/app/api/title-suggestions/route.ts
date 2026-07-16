import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/require-user";
import { NoResumeError, TitleDerivationNotConfiguredError, startTitleDerivation } from "@/lib/title-derivation";

export async function POST() {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;
  try {
    const result = await startTitleDerivation(userId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof TitleDerivationNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 501 });
    }
    if (err instanceof NoResumeError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("title-suggestions failed", err);
    return NextResponse.json(
      { error: "We couldn't read that resume automatically. You can try again or add titles manually." },
      { status: 502 }
    );
  }
}
