"""mmWave Config Lab desktop app: the web app in a native window (Edge WebView2 on Windows).

Run from source:  python desktop/launcher.py
Build the .exe:   see build.ps1
"""
import os
import sys

import webview

APP_TITLE = "mmWave Config Lab"


def app_dir() -> str:
    # PyInstaller unpacks bundled files into sys._MEIPASS
    base = getattr(sys, "_MEIPASS", os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    return os.path.join(base, "app")


def _dialog(kind: str):
    # pywebview 5+ has webview.FileDialog; older versions use the module constants
    fd = getattr(webview, "FileDialog", None)
    if fd is not None:
        return getattr(fd, kind)
    return getattr(webview, kind + "_DIALOG")


class Api:
    """Called from app.js as window.pywebview.api.<name>()."""

    def __init__(self):
        self.window = None
        self.last_dir = os.path.expanduser("~")

    def open_cfg(self):
        paths = self.window.create_file_dialog(
            _dialog("OPEN"), directory=self.last_dir, allow_multiple=False,
            file_types=("Radar config (*.cfg;*.txt)", "All files (*.*)"),
        )
        if not paths:
            return None
        path = paths[0]
        self.last_dir = os.path.dirname(path)
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return {"name": os.path.basename(path), "text": f.read()}

    def save_cfg(self, text, suggested="radar.cfg"):
        path = self.window.create_file_dialog(
            _dialog("SAVE"), directory=self.last_dir, save_filename=suggested or "radar.cfg",
            file_types=("Radar config (*.cfg)", "All files (*.*)"),
        )
        if not path:
            return None
        if isinstance(path, (list, tuple)):
            path = path[0]
        self.last_dir = os.path.dirname(path)
        with open(path, "w", encoding="utf-8", newline="\r\n") as f:
            f.write(text.replace("\r\n", "\n"))
        return {"name": os.path.basename(path)}


def main():
    index = os.path.join(app_dir(), "index.html")
    if not os.path.exists(index):
        sys.exit(f"Cannot find {index}")
    api = Api()
    api.window = webview.create_window(APP_TITLE, index, js_api=api, width=1440, height=940, min_size=(820, 600))
    webview.start(private_mode=False)


if __name__ == "__main__":
    main()
