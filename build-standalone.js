/* Собирает автономные файлы: всё (CSS + JS движка и интерфейса) инлайнится
   в один HTML, без внешних ссылок и без ?v-версий — открывается двойным кликом
   (file://) или через любой статический сервер, без интернета.

   Генерирует:
     weplaycard-standalone.html — страница «Дуэль лжи» (36 карт)
     poker-standalone.html      — страница «Покер» (52 карты)

   Ссылки между страницами переписываются на соседние автономные файлы, чтобы
   переключение работало и из одного файла. */
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const r = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

function inline(pageFile, scripts, navRewrite) {
  let html = r(pageFile);
  const css = r('styles.css');

  // Инлайним CSS вместо внешней ссылки (с ?v)
  html = html.replace(
    /<link rel="stylesheet" href="styles\.css[^"]*" \/>/,
    '<style>\n' + css + '\n</style>'
  );

  // Инлайним оба скрипта вместо внешних <script src=...?v>
  const js = scripts.map((f) => '<script>\n' + r(f) + '\n</script>').join('\n');
  html = html.replace(
    /<script src="[^"]*"><\/script>\s*<script src="[^"]*"><\/script>/,
    js
  );

  // Убираем преконнект к Google Fonts (не нужен, шрифты системные)
  html = html.replace(/<link rel="preconnect"[^>]*>\s*/g, '');

  // Переписываем навигацию на соседние автономные файлы
  if (navRewrite) {
    for (const rw of navRewrite) html = html.replace(rw.from, rw.to);
  }
  return html;
}

const duel = inline('index.html', ['engine.js', 'app.js'], [
  { from: 'href="poker.html"', to: 'href="poker-standalone.html"' },
  { from: 'href="index.html"', to: 'href="weplaycard-standalone.html"' },
]);
const duelOut = path.join(dir, 'weplaycard-standalone.html');
fs.writeFileSync(duelOut, duel);
console.log('Готово:', duelOut, '(', duel.length, 'байт )');

const poker = inline('poker.html', ['poker-engine.js', 'poker-app.js'], [
  { from: 'href="index.html"', to: 'href="weplaycard-standalone.html"' },
  { from: 'href="poker.html"', to: 'href="poker-standalone.html"' },
]);
const pokerOut = path.join(dir, 'poker-standalone.html');
fs.writeFileSync(pokerOut, poker);
console.log('Готово:', pokerOut, '(', poker.length, 'байт )');

for (const out of [duelOut, pokerOut]) {
  const html = fs.readFileSync(out, 'utf8');
  const leaked = /(src|href)="(styles\.css|engine\.js|app\.js|poker-engine\.js|poker-app\.js)/.test(html);
  console.log('Внешние ссылки остались?', leaked ? 'ДА! (' + path.basename(out) + ')' : 'нет, всё инлайн (' + path.basename(out) + ')');
}
