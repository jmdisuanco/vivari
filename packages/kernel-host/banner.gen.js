// Regenerate the shell banner in coreutils.js: npm i figlet 8colors (anywhere), node banner.gen.js > banner.json, paste with doubled escapes.
// Banner for the VM shell: figlet (Big) + 8colors, one colour per row. Prints a JS string literal.
const figlet = require('figlet'), c = require('8colors');
const rows = figlet.textSync('JMart', { font: 'Big' }).split('\n').filter((l) => l.trim());
const paint = [(s) => c.br(s), (s) => c.by(s), (s) => c.bg(s), (s) => c.bc(s), (s) => c.bb(s), (s) => c.bm(s)];
const art = rows.map((r, i) => paint[i % paint.length](r).end()).join('\n');
const sub = c.bw('Code terminal').end() + c.bk(' · ').end() + 'Node 24 · try ' + c.bc('ls').end() + ', ' + c.bc('node -v').end() + ' or ' + c.bc('npm run dev').end();
const site = c.bk('Docs and projects: ').end() + c.bb('https://code.jmart.dev').end();
const banner = (art + '\n' + sub + '\n' + site + '\n').replace(/\n/g, '\r\n');
process.stdout.write(process.argv[2] === 'show' ? banner : JSON.stringify(banner));
