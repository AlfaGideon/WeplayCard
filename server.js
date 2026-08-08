// WeplayCard — локальный сервер на Node.js (без зависимостей).
//
// Запуск:
//     node server.js            # порт 8000
//     node server.js 8080       # свой порт
//     PORT=9000 node server.js  # или через переменную окружения
//
// Затем открой в браузере:  http://localhost:8000
// Остановить: Ctrl+C

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2] || process.env.PORT || '8000', 10);
const root = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(root, urlPath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log('WeplayCard запущен:  http://localhost:' + PORT + '   (остановить: Ctrl+C)');
});
