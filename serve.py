#!/usr/bin/env python3
"""WeplayCard — локальный сервер для запуска на своём ПК.

Запуск:
    python3 serve.py            # порт 8000
    python3 serve.py 8080       # свой порт
    PORT=9000 python3 serve.py  # или через переменную окружения

Затем открой в браузере:  http://localhost:8000
Остановить: Ctrl+C

Раздаёт файлы из папки, где лежит этот скрипт, и шлёт заголовки
no-store, чтобы браузер не держал устаревшие версии скриптов.
"""
import http.server
import socketserver
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", "8000"))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, *args):
        pass


class ThreadingServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    print(f"WeplayCard запущен:  http://localhost:{PORT}   (остановить: Ctrl+C)")
    with ThreadingServer(("0.0.0.0", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nостановлено")
