import { useEffect } from "react";
import { brand } from "@/lib/brand";

/** Sets the browser tab title: "Page · Fanoos", or just the app name while there's nothing to show. */
export function useTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · ${brand.name}` : brand.name;
  }, [title]);
}
