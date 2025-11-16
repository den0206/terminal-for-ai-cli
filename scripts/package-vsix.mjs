#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { existsSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const workspaceRoot = process.cwd();
const packageJsonPath = join(workspaceRoot, "package.json");

let pkg;
try {
  pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
} catch (error) {
  console.error(`Failed to read ${packageJsonPath}:`, error);
  process.exit(1);
}

const extensionName = pkg?.name;
const extensionVersion = pkg?.version;

if (!extensionName || !extensionVersion) {
  console.error("package.json must contain both 'name' and 'version'.");
  process.exit(1);
}

const outputDir = join(workspaceRoot, "vsix");
mkdirSync(outputDir, { recursive: true });

const baseFilename = `${extensionName}-${extensionVersion}`;
let candidatePath = join(outputDir, `${baseFilename}.vsix`);
let index = 0;

while (existsSync(candidatePath)) {
  index += 1;
  candidatePath = join(outputDir, `${baseFilename}-${index}.vsix`);
}

const spawnResult = spawnSync("npx", ["vsce", "package", "--out", candidatePath], {
  cwd: workspaceRoot,
  stdio: "inherit"
});

if (spawnResult.status !== 0) {
  process.exit(spawnResult.status ?? 1);
}

const relativePath = relative(workspaceRoot, candidatePath) || candidatePath;
console.log(`VSIX written to ${relativePath}`);
