import { NextResponse } from "next/server";
import { deleteCredential } from "auto-job-applier-db";
import { requireUserId } from "@/lib/require-user";

// ---------------------------------------------------------------------------
// DELETE /api/credentials/:id -> forget a saved account.
//
// Deliberately not gated behind the reveal unlock window. Deleting a
// credential destroys access rather than granting it, so requiring a code
// here would only make it harder for a user to react quickly to a
// credential they think is compromised -- the wrong tradeoff. Reveal is the
// dangerous direction; delete is the safe one.
//
// The row's CredentialRevealEvent history cascades with it (see schema).
// That's intentional: keeping reveal records for a credential the user asked
// us to forget would mean the "forget" didn't.
// ---------------------------------------------------------------------------

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  const deleted = await deleteCredential(userId, id);
  if (!deleted) {
    return NextResponse.json({ error: "Credential not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
