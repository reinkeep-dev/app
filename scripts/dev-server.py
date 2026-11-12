"""Local preview server for reinkeep/site that tells the browser never to cache.

python -m http.server lets browsers keep old copies of CSS, JS and images, so a fresh render or edit
could show up stale (seen 2026-11-10). This serves the same files with Cache-Control: no-store.
Usage: python3 reinkeep/scripts/dev-server.py [port] [directory]
"""
import functools
import http.server
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4181
ROOT = sys.argv[2] if len(sys.argv) > 2 else "reinkeep/site"


class NoStoreHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    handler = functools.partial(NoStoreHandler, directory=ROOT)
    http.server.ThreadingHTTPServer(("", PORT), handler).serve_forever()
