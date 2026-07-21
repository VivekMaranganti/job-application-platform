"use client";

import { useEffect, useState } from "react";
import { Copy, Eye, EyeOff, Lock, Plus, ShieldCheck, Trash2, Unlock } from "lucide-react";
import { useCredentials } from "@/hooks/use-credentials";
import {
  Label,
  SectionCard,
  ghostButtonClass,
  inputClass,
  primaryButtonClass,
} from "@/components/ui/primitives";

// ---------------------------------------------------------------------------
// The vault UI.
//
// Default state shows no passwords at all -- site, username, and dots. A
// password appears only after the user proves it's them (a code emailed to
// the address on file, good for a 5-minute window) and then clicks Reveal on
// one specific row. Revealed values live in React state only and wipe
// themselves after 30 seconds.
//
// The alternative -- render the whole decrypted table on load -- was
// rejected: it puts every password in one screenshot, one shoulder-surf, and
// one browser-memory dump, and it makes the audit trail meaningless because
// every page view looks identical to an attacker dumping the vault.
// ---------------------------------------------------------------------------

function RelativeTime({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-muted">never</span>;
  return <span className="text-muted">{new Date(iso).toLocaleString()}</span>;
}

export function CredentialsTab() {
  const {
    credentials,
    loading,
    unlockedUntil,
    revealed,
    requestUnlockCode,
    redeemUnlockCode,
    reveal,
    hide,
    save,
    remove,
  } = useCredentials();

  const [codeSent, setCodeSent] = useState(false);
  const [codeMessage, setCodeMessage] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [showAdd, setShowAdd] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<string | null>(null);

  // Drives the countdown. Ticking once a second is enough for a mm:ss
  // display and avoids a re-render per frame.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const isUnlocked = unlockedUntil !== null && unlockedUntil.getTime() > now;
  const secondsLeft = isUnlocked ? Math.max(0, Math.floor((unlockedUntil.getTime() - now) / 1000)) : 0;

  async function handleRequestCode() {
    const { message, devCode } = await requestUnlockCode();
    setCodeSent(true);
    setUnlockError(null);
    setCodeMessage(devCode ? `${message} Code: ${devCode}` : message);
  }

  async function handleRedeem() {
    const result = await redeemUnlockCode(codeInput);
    if (!result.ok) {
      setUnlockError(result.error ?? "That code isn't valid.");
      return;
    }
    setCodeSent(false);
    setCodeInput("");
    setCodeMessage(null);
    setUnlockError(null);
  }

  async function handleAdd() {
    setAddError(null);
    const result = await save({ url: newUrl, username: newUsername });
    if (!result.ok) {
      setAddError(result.error ?? "Couldn't save that credential.");
      return;
    }
    setJustCreated(result.password ?? null);
    setNewUrl("");
    setNewUsername("");
    setShowAdd(false);
  }

  if (loading) return <div className="text-[14px] text-muted">Loading saved accounts…</div>;

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-[19px] font-semibold text-ink m-0">Portal accounts</h2>
        <p className="text-[14px] text-muted mt-1.5 leading-relaxed">
          Some employers gate their application form behind an account. These are the accounts the
          agent created or that you saved, stored encrypted and never committed to git.
        </p>
      </div>

      {/* Unlock control */}
      <SectionCard>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-2.5">
            {isUnlocked ? (
              <Unlock size={16} className="text-ledger mt-0.5 shrink-0" />
            ) : (
              <Lock size={16} className="text-bronze mt-0.5 shrink-0" />
            )}
            <div>
              <div className="text-[14px] text-ink font-medium">
                {isUnlocked ? "Vault unlocked" : "Vault locked"}
              </div>
              <div className="text-[13px] text-muted mt-1 leading-relaxed">
                {isUnlocked ? (
                  <>
                    Reveal is available for{" "}
                    <span className="font-mono text-ink">
                      {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
                    </span>
                    . It re-locks automatically.
                  </>
                ) : (
                  "Passwords stay hidden until you confirm it's you with a code sent to your email."
                )}
              </div>
            </div>
          </div>
          {!isUnlocked && !codeSent && (
            <button onClick={handleRequestCode} className={primaryButtonClass}>
              Send me a code
            </button>
          )}
        </div>

        {!isUnlocked && codeSent && (
          <div className="mt-4 pt-4 border-t border-line">
            {codeMessage && <div className="text-[13px] text-muted mb-2.5">{codeMessage}</div>}
            <div className="flex gap-2 items-start">
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRedeem()}
                placeholder="6-digit code"
                inputMode="numeric"
                maxLength={6}
                className={`${inputClass} font-mono max-w-[160px]`}
              />
              <button onClick={handleRedeem} className={primaryButtonClass}>
                Unlock
              </button>
              <button onClick={() => setCodeSent(false)} className={ghostButtonClass}>
                Cancel
              </button>
            </div>
            {unlockError && <div className="text-[13px] text-bronze mt-2">{unlockError}</div>}
          </div>
        )}
      </SectionCard>

      {/* Freshly created password, shown once */}
      {justCreated && (
        <div className="mt-4 border border-ledger/40 bg-ledger/[0.05] rounded-lg px-4 py-3.5">
          <div className="text-[13px] text-ink font-medium mb-1.5">
            Saved. This password is shown once here — after this, it takes a code to see it again.
          </div>
          <div className="flex items-center gap-2">
            <code className="font-mono text-[13.5px] text-ink bg-white border border-line rounded px-2.5 py-1.5 select-all">
              {justCreated}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(justCreated)}
              className={ghostButtonClass}
              aria-label="Copy password"
            >
              <Copy size={13} />
            </button>
            <button onClick={() => setJustCreated(null)} className={ghostButtonClass}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* Credential list */}
      <div className="mt-5">
        {credentials.length === 0 ? (
          <div className="text-[14px] text-muted border border-dashed border-line rounded-lg px-4 py-6 text-center">
            No portal accounts saved yet. The agent will add one here when a job application requires
            registering, or you can add an existing account below.
          </div>
        ) : (
          <div className="border border-line rounded-lg divide-y divide-line overflow-hidden">
            {credentials.map((c) => {
              const shown = revealed[c.id];
              return (
                <div key={c.id} className="px-4 py-3.5 bg-white">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[14.5px] text-ink font-medium">{c.siteName}</span>
                        {c.createdByAgent && (
                          <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-ledger border border-ledger/50 bg-ledger/[0.06] rounded px-1.5 py-0.5">
                            <ShieldCheck size={10} />
                            Agent
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[12.5px] text-muted mt-1 truncate">
                        {c.originHostname}
                      </div>
                      <div className="text-[13.5px] text-ink mt-1.5">{c.username}</div>

                      <div className="mt-2 flex items-center gap-2">
                        {shown ? (
                          <>
                            <code className="font-mono text-[13.5px] text-ink bg-paper border border-line rounded px-2.5 py-1 select-all">
                              {shown}
                            </code>
                            <button
                              onClick={() => navigator.clipboard.writeText(shown)}
                              className={ghostButtonClass}
                              aria-label={`Copy password for ${c.siteName}`}
                            >
                              <Copy size={13} />
                            </button>
                            <button
                              onClick={() => hide(c.id)}
                              className={ghostButtonClass}
                              aria-label="Hide password"
                            >
                              <EyeOff size={13} />
                            </button>
                          </>
                        ) : (
                          <>
                            <span
                              className="font-mono text-[15px] text-muted tracking-[0.2em] select-none"
                              aria-label="Password hidden"
                            >
                              ••••••••••••
                            </span>
                            <button
                              onClick={() => reveal(c.id)}
                              disabled={!isUnlocked}
                              title={isUnlocked ? "Reveal password" : "Unlock the vault first"}
                              className={`${ghostButtonClass} ${
                                isUnlocked ? "" : "opacity-40 cursor-not-allowed"
                              }`}
                            >
                              <Eye size={13} />
                              <span className="ml-1.5">Reveal</span>
                            </button>
                          </>
                        )}
                      </div>

                      <div className="text-[12px] text-muted mt-2">
                        Last revealed: <RelativeTime iso={c.lastRevealedAt} />
                      </div>
                    </div>

                    <button
                      onClick={() => remove(c.id)}
                      className={`${ghostButtonClass} shrink-0`}
                      aria-label={`Delete ${c.siteName} credential`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add existing account */}
      <div className="mt-5">
        {showAdd ? (
          <SectionCard>
            <Label>Site URL</Label>
            <input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://boards.greenhouse.io/…"
              className={inputClass}
            />
            <div className="mt-3">
              <Label>Username or email</Label>
              <input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="you@example.com"
                className={inputClass}
              />
            </div>
            <p className="text-[12.5px] text-muted mt-2.5 leading-relaxed">
              Leaving the password blank generates a strong one. Only recognized ATS domains are
              accepted — a valid certificate alone isn&apos;t enough to prove a site is who it looks
              like.
            </p>
            {addError && <div className="text-[13px] text-bronze mt-2">{addError}</div>}
            <div className="flex gap-2 mt-3.5">
              <button onClick={handleAdd} className={primaryButtonClass}>
                Save account
              </button>
              <button onClick={() => setShowAdd(false)} className={ghostButtonClass}>
                Cancel
              </button>
            </div>
          </SectionCard>
        ) : (
          <button onClick={() => setShowAdd(true)} className={ghostButtonClass}>
            <Plus size={13} />
            <span className="ml-1.5">Add an existing account</span>
          </button>
        )}
      </div>
    </div>
  );
}
