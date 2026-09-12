"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SignInDialog } from "./Nav";

export function ClaimPubButton({ pubId, signedIn }: { pubId: string; signedIn: boolean }) {
  const router = useRouter();
  const [needSignIn, setNeedSignIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    if (!signedIn) return setNeedSignIn(true);
    if (!confirm("Claim this pub as its owner or manager? You'll be able to manage its tap list, events and deals.")) return;
    setBusy(true);
    const res = await fetch(`/api/pubs/${pubId}/claim`, { method: "POST" });
    setBusy(false);
    if (res.ok) router.push(`/for-pubs/${pubId}`);
    else setError((await res.json().catch(() => ({}))).error ?? "Couldn't claim");
  }

  return (
    <>
      <button onClick={claim} disabled={busy} className="underline text-stone-600 disabled:opacity-50">
        {busy ? "Claiming…" : "Own this pub? Claim it"}
      </button>
      {error && <span className="text-red-600">{error}</span>}
      {needSignIn && <SignInDialog onClose={() => setNeedSignIn(false)} />}
    </>
  );
}
