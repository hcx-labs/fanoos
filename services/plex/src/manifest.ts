import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
/** Resolve manifest URLs before proxying them; preserve DASH $Number$/$Time$ templates. */
export function rewriteManifest(xml: string, origin: string, manifestPath: string, proxy: (path: string) => string): string {
 if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsupported Plex manifest.");
 const doc = new DOMParser().parseFromString(xml, "application/xml");
 if (doc.documentElement.localName !== "MPD") throw new Error("Plex did not return a DASH manifest.");
 const resolve = (value: string, parent: string) => {
  const url = new URL(value, parent);
  if (url.origin !== origin) throw new Error("Plex manifest referenced another server.");
  for (const key of [...url.searchParams.keys()]) if (key.toLowerCase() === "x-plex-token") url.searchParams.delete(key);
  return url;
 };
 const visit = (element: Element, parent: string) => {
  const children = Array.from(element.childNodes).filter((n): n is Element => n.nodeType === 1);
  const bases = children.filter((n) => n.localName === "BaseURL");
  const base = bases[0]?.textContent ? resolve(bases[0].textContent, parent).href : parent;
  for (const child of bases) { const url = resolve(child.textContent || "", parent); child.textContent = proxy(url.pathname + url.search); }
  for (const name of ["media", "initialization", "sourceURL", "index"]) {
   const value = element.getAttribute(name);
   if (value) { const url = resolve(value, base); element.setAttribute(name, proxy(url.pathname + url.search).replace(/%24/gi, "$")); }
  }
  for (const child of children) {
   if (["Location", "PatchLocation", "UTCTiming"].includes(child.localName)) element.removeChild(child);
   else if (child.localName !== "BaseURL") visit(child, base);
  }
 };
 visit(doc.documentElement, new URL(manifestPath, origin).href);
 return new XMLSerializer().serializeToString(doc);
}
