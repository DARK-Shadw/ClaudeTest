'use strict';
// Bundles the game into ONE self-contained HTML file for the Artifact tool:
//   node tools/build-artifact.js  ->  artifact/uno-no-mercy.html
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const html = read('public/index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script src="net-ws.js">')).trim();
const css = read('public/style.css');
const wrap = (src, req) => `(() => { const module = { exports: {} }; const exports = module.exports; const require = (${req});\n${src}\nreturn module.exports; })()`;

const script = [
  `const __game = ${wrap(read('server/game.js'), '() => ({})')};`,
  `const { Room } = ${wrap(read('server/room.js'), "() => __game")};`,
  read('public/net-room.js'),
  read('public/app.js'),
].join('\n');

const out = `<title>Uno No Mercy</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lilita+One&family=Fredoka:wght@500;700&display=swap" rel="stylesheet">
<style>
${css}
:root { color-scheme: dark; background: #2a1250; }
</style>
${body}
<script>
${script}
</script>
`;
fs.mkdirSync(path.join(root, 'artifact'), { recursive: true });
fs.writeFileSync(path.join(root, 'artifact/uno-no-mercy.html'), out);
console.log('artifact/uno-no-mercy.html', (out.length / 1024).toFixed(0) + ' KB');
