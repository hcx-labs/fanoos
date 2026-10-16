#!/usr/bin/env node
// Bump the version everywhere: the root package.json and every workspace share one version.
//   node scripts/bump-version.mjs patch|minor|major   → prints the new version
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const kind = process.argv[2];
if (!["patch", "minor", "major"].includes(kind)) {
  console.error("usage: bump-version.mjs patch|minor|major");
  process.exit(1);
}
const root = new URL("..", import.meta.url).pathname;
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const write = (p, data) => writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);

const rootPkg = read(join(root, "package.json"));
const [major, minor, patch] = rootPkg.version.split(".").map(Number);
const next = kind === "major" ? `${major + 1}.0.0` : kind === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;

const files = [join(root, "package.json")];
for (const pattern of rootPkg.workspaces) {
  const dir = join(root, pattern.replace(/\/\*$/, ""));
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, "package.json");
    if (existsSync(file)) files.push(file);
  }
}
for (const file of files) write(file, { ...read(file), version: next });
console.log(next);
