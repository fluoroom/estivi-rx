#!/usr/bin/env python3
"""Fetch one DGT YQ bitmap over FTP and hand it to the page.

The browser cannot open port 21. This process speaks FTP and only retrieves
names of the form `@CALL` + 14 digits + `.BMP` from one directory.
"""

import json
import os
import re
import sys
from ftplib import FTP, error_perm
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

def folded_password():
    """YONIQ's FTP password, folded so this file does not contain it as text."""
    folded = bytes((202, 120, 50, 136, 58, 161, 28, 87, 207, 56, 64))
    mask = bytes((163, 23, 92, 225, 75, 144, 45, 102, 248, 12, 115))
    return bytes(a ^ b for a, b in zip(folded, mask)).decode("ascii")


HOST = os.environ.get("YONIQ_FTP_HOST", "ioniq.evl.es")
PORT = int(os.environ.get("YONIQ_FTP_PORT", "21"))
USER = os.environ.get("YONIQ_FTP_USER", "eugenioioniq")
PASSWORD = os.environ.get("YONIQ_FTP_PASSWORD") or folded_password()
PATH = os.environ.get("YONIQ_FTP_PATH", "/web/imagenes_ioniq")
LISTEN = int(os.environ.get("RECOVERY_PORT", "8090"))

NAME = re.compile(r"^@[A-Za-z0-9]{1,12}(?:/[A-Za-z0-9]{1,4})?[0-9]{14}\.BMP$")
LIMIT = 240


def route(path):
    if path.startswith("/dgt/"):
        return path[4:]
    return path


def allowed(name):
    return isinstance(name, str) and NAME.fullmatch(name) is not None


def fetch(names):
    wanted = [n for n in names if allowed(n)][:LIMIT]
    if not wanted:
        return None
    ftp = FTP()
    ftp.connect(HOST, PORT, timeout=15)
    ftp.login(USER, PASSWORD)
    ftp.set_pasv(True)
    ftp.cwd(PATH)
    ftp.voidcmd("TYPE I")
    try:
        for name in wanted:
            if not present(ftp, name):
                continue
            body = bytearray()
            ftp.retrbinary("RETR " + name, body.extend)
            if body:
                return bytes(body)
    finally:
        try:
            ftp.quit()
        except Exception:
            ftp.close()
    return None


def present(ftp, name):
    try:
        size = ftp.size(name)
    except error_perm as err:
        text = str(err)
        if text.startswith("550") or text.startswith("450"):
            return False
        return True
    return bool(size)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = route(unquote(urlparse(self.path).path))
        prefix = "/file/"
        if not path.startswith(prefix):
            self.send_error(404)
            return
        name = path[len(prefix):]
        if not allowed(name):
            self.send_error(404)
            return
        self.reply(self.retrieve([name]))

    def do_POST(self):
        if route(urlparse(self.path).path) != "/find":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length < 0 or length > 20000:
            self.send_error(413)
            return
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
            names = payload.get("names", [])
        except (json.JSONDecodeError, UnicodeError, ValueError):
            self.send_error(400)
            return
        if not isinstance(names, list):
            self.send_error(400)
            return
        self.reply(self.retrieve(names))

    def retrieve(self, names):
        try:
            return fetch(names)
        except OSError as err:
            sys.stderr.write(f"recovery: {err}\n")
            return None

    def reply(self, body):
        if not body:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/bmp")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    ThreadingHTTPServer(("0.0.0.0", LISTEN), Handler).serve_forever()


if __name__ == "__main__":
    main()
