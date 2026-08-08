/* Собирает weplaycard-standalone.html: всё (CSS, engine.js, app.js) инлайнится
   в один файл, без внешних ссылок и без ?v-версий — открывается двойным кликом
   (file://) или через любой статический сервер, без интернета. */
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const r = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

let html = r('index.html');
const css = r('styles.css');
const engine = r('engine.js');
const app = r('app.js');

// Инлайним CSS вместо внешней ссылки (с ?v)
html = html.replace(
  /<link rel="stylesheet" href="styles\.css[^"]*" \/>/,
  '<style>\n' + css + '\n</style>'
);

// Инлайним engine.js + app.js вместо внешних <script src=...?v>
html = html.replace(
  /<script src="engine\.js[^"]*"><\/script>\s*<script src="app\.js[^"]*"><\/script>/,
  '<script>\n' + engine + '\n</script>\n<script>\n' + app + '\n</script>'
);

// Убираем преконнект к Google Fonts (не нужен, шрифты системные)
html = html.replace(/<link rel="preconnect"[^>]*>\s*/g, '');

const out = path.join(dir, 'weplaycard-standalone.html');
fs.writeFileSync(out, html);
console.log('Готово:', out, '(', html.length, 'байт )');
console.log('Внешние ссылки остались?', /(src|href)="(styles\.css|engine\.js|app\.js)/.test(html) ? 'ДА!' : 'нет, всё инлайн');
