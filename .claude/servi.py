# Server di sviluppo: come «python -m http.server», ma senza cache del browser (Cache-Control: no-store),
# così dopo ogni modifica la pagina e i test caricano sempre i file aggiornati.
import http.server
import sys


class SenzaCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


porta = int(sys.argv[1]) if len(sys.argv) > 1 else 5617
http.server.ThreadingHTTPServer(('', porta), SenzaCache).serve_forever()
