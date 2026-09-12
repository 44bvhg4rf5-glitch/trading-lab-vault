"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type NavUser = { displayName: string; role: string } | null;

export function Nav({ user }: { user: NavUser }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth", { method: "DELETE" });
    router.refresh();
  }

  return (
    <header className="bg-stone-900 text-stone-50">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-4">
        <Link href="/" className="font-semibold tracking-tight text-lg">
          🍺 Draft Map
        </Link>
        <nav className="hidden sm:flex gap-4 text-sm text-stone-300">
          <Link href="/" className="hover:text-white">Map</Link>
          <Link href="/for-pubs" className="hover:text-white">For pubs</Link>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {user ? (
            <>
              <span className="text-stone-300 truncate max-w-[10rem]">
                {user.displayName}
                {user.role !== "DRINKER" && <span className="ml-1 text-amber-400">· {user.role.toLowerCase().replace("_", " ")}</span>}
              </span>
              <button onClick={signOut} className="text-stone-300 hover:text-white">Sign out</button>
            </>
          ) : (
            <button onClick={() => setOpen(true)} className="bg-amber-500 hover:bg-amber-400 text-stone-900 font-medium rounded px-3 py-1.5">
              Sign in
            </button>
          )}
        </div>
      </div>
      {open && <SignInDialog onClose={() => setOpen(false)} />}
    </header>
  );
}

export function SignInDialog({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, displayName }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("Check your email and name");
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-white text-stone-900 rounded-lg shadow-xl p-6 w-full max-w-sm space-y-3">
        <h2 className="text-lg font-semibold">Sign in</h2>
        <p className="text-xs text-stone-500">Demo sign-in: no password yet. Your name shows on ratings and photos.</p>
        <label className="block text-sm">
          Email
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full border rounded px-2 py-1.5" />
        </label>
        <label className="block text-sm">
          Display name
          <input required minLength={2} value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-1 w-full border rounded px-2 py-1.5" />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm">Cancel</button>
          <button disabled={busy} className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 rounded px-3 py-1.5 text-sm font-medium">
            {busy ? "…" : "Continue"}
          </button>
        </div>
      </form>
    </div>
  );
}
