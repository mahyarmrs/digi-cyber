// Renders the public download page (hub/) for a release into a checkout of the download repository.
// node scripts/hub-page.mjs --tag v1.2.0 --repo Owner/downloads --files out --out hub-repo
// Every download link must name a file in --files, so a renamed installer fails the release here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const hub = path.join(root, 'hub');
// What the page owns in the download repository; anything else there (a LICENSE, say) is left alone.
const managed = ['README.md', 'THIRD-PARTY.md', 'assets', 'screenshots'];

export function galleryHtml(dir, group, perRow = 4) {
  const shots = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f)).sort()
    : [];
  if (shots.length === 0) return '';
  const rows = [];
  for (let i = 0; i < shots.length; i += perRow) {
    const cells = shots.slice(i, i + perRow).map((f) => {
      const alt = f.replace(/\.[^.]+$/, '').replace(/^\d+[-_]/, '').replace(/[-_]/g, ' ');
      return `<img src="screenshots/${group}/${f}" alt="${alt}" width="${group === 'android' ? 190 : 400}">`;
    });
    rows.push(`<p align="center">\n${cells.join('\n')}\n</p>`);
  }
  return rows.join('\n');
}

// Fills the template: {{tag}}, {{version}}, {{repo}}, {{base}} (the release's download folder),
// a gallery per screenshots/<group>, and drops <!-- section:<group> --> blocks whose gallery is empty.
export function render(template, { tag, repo, screenshotsDir }) {
  const version = tag.replace(/^v/, '');
  const galleries = {};
  let out = template.replace(/<!-- section:([\w-]+) -->([\s\S]*?)<!-- \/section -->\n?/g, (_, group, body) => {
    galleries[group] ??= galleryHtml(path.join(screenshotsDir, group), group);
    return galleries[group] ? body : '';
  });
  out = out.replace(/\{\{gallery:([\w-]+)\}\}/g, (_, group) => {
    galleries[group] ??= galleryHtml(path.join(screenshotsDir, group), group);
    return galleries[group];
  });
  return out
    .replaceAll('{{base}}', `https://github.com/${repo}/releases/download/${tag}`)
    .replaceAll('{{tag}}', tag)
    .replaceAll('{{version}}', version)
    .replaceAll('{{repo}}', repo);
}

// The release files the page links to that the release does not have.
export function missingDownloads(page, { tag, repo, files }) {
  const prefix = `https://github.com/${repo}/releases/download/${tag}/`;
  const linked = new Set();
  for (const m of page.matchAll(/https:\/\/github\.com\/[^\s)"'<>]+/g)) {
    if (m[0].startsWith(prefix)) linked.add(decodeURIComponent(m[0].slice(prefix.length)));
  }
  return [...linked].filter((f) => !files.includes(f)).sort();
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  for (const k of ['tag', 'repo', 'files', 'out']) if (!out[k]) throw new Error(`--${k} is required`);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = args(process.argv.slice(2));
  const page = render(fs.readFileSync(path.join(hub, 'README.md'), 'utf8'), {
    tag: a.tag,
    repo: a.repo,
    screenshotsDir: path.join(hub, 'screenshots'),
  });
  const missing = missingDownloads(page, { tag: a.tag, repo: a.repo, files: fs.readdirSync(a.files) });
  if (missing.length) {
    console.error(`The download page links to files the release does not have:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }
  fs.mkdirSync(a.out, { recursive: true });
  for (const name of managed) fs.rmSync(path.join(a.out, name), { recursive: true, force: true });
  for (const name of managed.filter((n) => n !== 'README.md')) {
    const from = path.join(hub, name);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(a.out, name), { recursive: true });
  }
  fs.writeFileSync(path.join(a.out, 'README.md'), page);
  console.log(`Download page for ${a.tag} written to ${a.out}`);
}
