import { useSyncExternalStore } from "react";

// Keep in step with catalogGrid: 2 columns, sm:3, xl:5, 2xl:6.
const breakpoints = [640, 1280, 1536];
const read = () => (innerWidth >= 1536 ? 6 : innerWidth >= 1280 ? 5 : innerWidth >= 640 ? 3 : 2) * 3;
const subscribe = (notify: () => void) => {
  const queries = breakpoints.map((width) => matchMedia(`(min-width: ${width}px)`));
  queries.forEach((query) => query.addEventListener("change", notify));
  return () => queries.forEach((query) => query.removeEventListener("change", notify));
};
export function useCatalogPageSize() { return useSyncExternalStore(subscribe, read, () => 6); }
