import { useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { accountActions, useAccounts } from "@/lib/session";
import { useSource } from "@/lib/source";
import { itemKey } from "@/lib/paths";

export function CatalogActions({ kind, onSync }: { kind: "movies" | "shows"; onSync: () => void }) {
  const source = useSource();
  const { inFeed, backends } = useAccounts();
  const [busy, setBusy] = useState<"sync" | "export">();
  const sync = async () => {
    setBusy("sync");
    try {
      const accounts = inFeed.filter((a) => { const backend = backends.find((b) => b.id === a.backendId); return kind === "movies" ? backend?.info?.features.includes("movies") : backend?.kind !== "youtube"; });
      await Promise.all(accounts.map((a) => accountActions.sync(a.id)));
      onSync(); toast.success("Synced");
    } catch (e) { toast.error("Sync failed", { description: (e as Error).message }); }
    finally { setBusy(undefined); }
  };
  const exportCatalog = async () => {
    setBusy("export");
    try {
      const sources = await source.following({ kind });
      const titles: { id: string; backend?: string; title: string; library?: string; server?: string; year?: number }[] = sources.filter((c) => c.kind === "series" && kind === "shows").map((c) => ({ id: c.id, backend: c.backend, title: c.name, year: c.year }));
      for (const library of sources.filter((c) => c.kind === "library" && c.libraryType === kind)) {
        let next: string | undefined; const seen = new Set<string>();
        do {
          const page = await source.channel(library, undefined, { next, sort: "new" });
          for (const c of page.channels ?? []) titles.push({ id: c.id, backend: c.backend, title: c.name, library: library.name, server: library.handle, year: c.year });
          for (const v of page.videos) titles.push({ id: v.id, backend: v.backend, title: v.title, library: library.name, server: library.handle, year: v.year });
          next = page.next;
          if (next && seen.has(next)) throw Error("The server returned a repeated page. Try exporting again.");
          if (next) seen.add(next);
        } while (next);
      }
      const unique = [...new Map(titles.map((t) => [itemKey(t), t])).values()];
      const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), [kind]: unique }, null, 2)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = `fanoos-${kind}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast.error("Export failed", { description: (e as Error).message }); }
    finally { setBusy(undefined); }
  };
  return <><Button variant="outline" className="rounded-full" disabled={!!busy} onClick={() => void sync()}><RefreshCw className={busy === "sync" ? "animate-spin" : undefined} />{busy === "sync" ? "Syncing…" : "Sync now"}</Button><Button variant="outline" className="rounded-full" disabled={!!busy} onClick={() => void exportCatalog()}><Download />{busy === "export" ? "Exporting…" : "Export"}</Button></>;
}
