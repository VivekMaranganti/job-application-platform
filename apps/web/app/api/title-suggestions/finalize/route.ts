import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/current-user";
import {
  NoResumeError,
  TitleDerivationNotConfiguredError,
  finalizeTitleDerivation,
  type TitleQuestion,
} from "@/lib/title-derivation";

interface FinalizeBody {
  questions: TitleQuestion[];
  answers: Record<number, string>;
}

export async function POST(request: Request) {
  const userId = getCurrentUserId();
  const body = (await request.json()) as FinalizeBody;
  try {
    const result = await finalizeTitleDerivation(userId, body.questions ?? [], body.answers ?? {});
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof TitleDerivationNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 501 });
    }
    if (err instanceof NoResumeError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("title-suggestions finalize failed", err);
    return NextResponse.json(
      { error: "Something went wrong generating your title suggestions. You can try again or add titles manually." },
      { status: 502 }
    );
  }
}
