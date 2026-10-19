/** Other public image sizes for the same video, tried only after a missing full-size image. */
export function thumbnailFallbacks(url: URL): URL[] {
  const match = /^\/vi(?:_webp)?\/([\w-]+)\/(?:hq720|maxresdefault)\.(?:jpg|webp)$/.exec(url.pathname);
  if (!match) return [];
  return ["maxresdefault", "hq720", "sddefault", "hqdefault"]
    .map((name) => new URL(`/vi/${match[1]}/${name}.jpg`, url.origin))
    .filter((candidate) => candidate.href !== url.href);
}
