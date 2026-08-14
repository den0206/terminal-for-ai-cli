#!/usr/bin/env node
// Rewrites the <!-- BEGIN:release --> block in both READMEs with the latest
// published release. Run from the Export VSIX workflow after `gh release create`.
import {readFileSync, writeFileSync} from 'node:fs';

const tag = process.env.RELEASE_TAG;
const url = process.env.RELEASE_URL;
if (!tag || !url) {
  throw new Error('RELEASE_TAG and RELEASE_URL are required');
}
const date = new Date().toISOString().slice(0, 10);

const bodies = {
  'README.md': `Latest release: <a href="${url}"><strong>${tag}</strong></a> (${date})`,
  'README_JP.md': `最新リリース: <a href="${url}"><strong>${tag}</strong></a>（${date}）`,
};

for (const [file, body] of Object.entries(bodies)) {
  const source = readFileSync(file, 'utf8');
  const marker = /(<!-- BEGIN:release -->)[\s\S]*?(<!-- END:release -->)/;
  if (!marker.test(source)) {
    throw new Error(`${file} is missing the release markers`);
  }
  writeFileSync(file, source.replace(marker, `$1\n  ${body}\n  $2`));
}
