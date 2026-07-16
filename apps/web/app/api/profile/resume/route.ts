import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { requireUserId } from "@/lib/require-user";

const ACCEPTED_EXTENSIONS = [".pdf", ".doc", ".docx"];

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Expected multipart/form-data with a 'file' field." }, { status: 400 });
  }

  const lowerName = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
    return NextResponse.json({ error: "Only PDF or Word (.doc/.docx) resumes are accepted." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const profile = await repository.saveResume(userId, {
    fileName: file.name,
    fileSize: file.size,
    buffer,
    mimeType: file.type || "application/octet-stream",
  });
  return NextResponse.json(profile);
}

export async function DELETE() {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;
  const profile = await repository.removeResume(userId);
  return NextResponse.json(profile);
}
