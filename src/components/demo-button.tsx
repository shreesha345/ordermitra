"use client";

import { useT } from "./lang";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { BTN_SECONDARY } from "./ui";

export function DemoButton({ label }: { label?: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/demo", { method: "POST" });
    setBusy(false);
    if (!res.ok) return setError(((await res.json()) as { error?: string }).error ?? t("Could not load sample data"));
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={load} disabled={busy} className={BTN_SECONDARY}>
        <Sparkles className="size-4" aria-hidden />
        {busy ? t("Loading…") : (label ?? t("Load sample data"))}
      </button>
      {error && <span className="text-xs text-danger" role="alert">{error}</span>}
    </span>
  );
}
