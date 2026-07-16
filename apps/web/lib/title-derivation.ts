import Anthropic from "@anthropic-ai/sdk";
import mammoth from "mammoth";
import { repository } from "@/lib/repository";

// ---------------------------------------------------------------------------
// Server-side port of the prototype's "derive titles from resume" flow.
//
// The prototype called the Anthropic API directly from the browser with no
// API key handling — fine for a throwaway single-file demo, never fine for a
// real app (it would either leak a key to the client or simply not work).
// This version moves the call server-side, behind ANTHROPIC_API_KEY.
//
// If ANTHROPIC_API_KEY isn't set, callers get a clear "not configured" error
// rather than a cryptic SDK failure — honest labeling per the project's UX
// patterns (see job-application-profile.jsx's "simulated" / "not yet
// implemented" labels).
// ---------------------------------------------------------------------------

export class TitleDerivationNotConfiguredError extends Error {
  constructor() {
    super(
      "AI title suggestions aren't configured in this environment (ANTHROPIC_API_KEY is not set on the server)."
    );
    this.name = "TitleDerivationNotConfiguredError";
  }
}

export class NoResumeError extends Error {
  constructor() {
    super("Upload a resume before requesting title suggestions.");
    this.name = "NoResumeError";
  }
}

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new TitleDerivationNotConfiguredError();
  }
  return new Anthropic();
}

type ResumeContentBlock =
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
  | { type: "text"; text: string };

async function getResumeContentBlock(userId: string): Promise<ResumeContentBlock> {
  const resume = await repository.getResumeFile(userId);
  if (!resume) throw new NoResumeError();

  const isPdf = /\.pdf$/i.test(resume.fileName) || resume.mimeType === "application/pdf";
  if (isPdf) {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: resume.buffer.toString("base64") },
    };
  }
  // .doc / .docx — best-effort raw text extraction with mammoth (same
  // limitation as the prototype: mammoth targets .docx, legacy .doc may not
  // extract cleanly).
  const result = await mammoth.extractRawText({ buffer: resume.buffer });
  return { type: "text", text: `Resume content:\n\n${result.value}` };
}

function parseJsonLoose(text: string): unknown {
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  return JSON.parse(cleaned);
}

export interface TitleQuestion {
  question: string;
  options: string[];
}

export interface StartDerivationResult {
  resume_summary: string;
  questions: TitleQuestion[];
}

export async function startTitleDerivation(userId: string): Promise<StartDerivationResult> {
  const client = getClient();
  const resumeBlock = await getResumeContentBlock(userId);

  const prompt = {
    type: "text" as const,
    text:
      "Analyze the attached resume for a job search tool. Respond with ONLY raw JSON (no markdown fences, no preamble) in this exact shape:\n" +
      '{"resume_summary": "one sentence describing the candidate\'s background", ' +
      '"questions": [{"question": "a clarifying question about direction/seniority/focus", "options": ["3-5 short answer options"]}]}\n' +
      "Include 2 to 4 questions that would meaningfully change which job titles to target next (e.g. individual contributor vs management track, staying in current specialty vs adjacent field, seniority level, industry focus). Keep options short (2-6 words each).",
  };
  const content = resumeBlock.type === "document" ? [resumeBlock, prompt] : [prompt, resumeBlock];

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1200,
    messages: [{ role: "user", content }],
  });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const parsed = parseJsonLoose(text) as Partial<StartDerivationResult>;
  return {
    resume_summary: parsed.resume_summary ?? "",
    questions: parsed.questions ?? [],
  };
}

export interface FinalizeDerivationResult {
  titles: string[];
}

export async function finalizeTitleDerivation(
  userId: string,
  questions: TitleQuestion[],
  answers: Record<number, string>
): Promise<FinalizeDerivationResult> {
  const client = getClient();
  const resumeBlock = await getResumeContentBlock(userId);

  const qaText = questions
    .map((q, i) => `Q: ${q.question}\nA: ${answers[i] || "(skipped)"}`)
    .join("\n\n");
  const prompt = {
    type: "text" as const,
    text:
      "Based on the same resume and these clarifying answers, respond with ONLY raw JSON (no markdown fences) in this shape:\n" +
      '{"titles": ["5-10 recommended job titles to search for, ordered by best fit"]}\n\n' +
      `Clarifying answers:\n${qaText}`,
  };
  const content = resumeBlock.type === "document" ? [resumeBlock, prompt] : [prompt, resumeBlock];

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1200,
    messages: [{ role: "user", content }],
  });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const parsed = parseJsonLoose(text) as Partial<FinalizeDerivationResult>;
  return { titles: parsed.titles ?? [] };
}
