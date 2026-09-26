// Packs the Vite build into one self-contained HTML fragment for hosts that wrap pages in their
// own document skeleton: the title, font links, inline CSS, the app root and the inline script.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const dist = 'dist';
const html = readFileSync(join(dist, 'index.html'), 'utf8');

function pick(re, what) {
  const m = html.match(re);
  if (!m) throw new Error(`Could not find ${what} in dist/index.html`);
  return m;
}

const title = pick(/<title>[\s\S]*?<\/title>/, 'the title')[0];
const fonts = [...html.matchAll(/<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com[^"]+)"[^>]*>/g)]
  .map((m) => `<link rel="stylesheet" href="${m[1]}">`)
  .join('\n');
const cssPath = pick(/<link rel="stylesheet"[^>]*href="\.\/([^"]+\.css)"/, 'the stylesheet')[1];
const jsPath = pick(/<script type="module"[^>]*src="\.\/([^"]+\.js)"/, 'the script')[1];
const body = pick(/<body>([\s\S]*?)<\/body>/, 'the body')[1].replace(/<script[\s\S]*?<\/script>/g, '').trim();
const css = readFileSync(join(dist, cssPath), 'utf8');
// A literal "</script" inside the bundle would close the inline script early.
const js = readFileSync(join(dist, jsPath), 'utf8').replace(/<\/script/gi, '<\\/script');

const out = `${title}\n${fonts}\n<style>\n${css}\n</style>\n${body}\n<script type="module">\n${js}\n</script>\n`;
const file = join('dist-artifact', 'hearthwild.html');
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, out);
console.log(`Wrote ${file} (${Math.round(out.length / 1024)} KB)`);
