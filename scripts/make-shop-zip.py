#!/usr/bin/env python3
"""Build the UnityForge Labs shop zip for Clay Blocks.

Writes dist/Clay-Blocks.zip next to this repo. Does not upload it.

Usage (from the Clay Blocks folder):
    python3 scripts/make-shop-zip.py
"""
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "dist"
OUT = OUT_DIR / "Clay-Blocks.zip"

# Buyer files. Tests, git metadata, and the zip itself stay out.
INCLUDE = [
    "README.md",
    "INSTALL.md",
    "LICENCE.md",
    "CREDITS.md",
    "NOTES.md",
    "serve.py",
    "start.sh",
    "Start Clay Blocks.bat",
    "index.html",
    "manifest.webmanifest",
    "sw.js",
    "screenshot.png",
    "css",
    "js",
    "vendor",
    "icons",
    "fonts",
]

SKIP_PARTS = {"__pycache__", ".DS_Store"}


def files_under(path: Path):
    if path.is_file():
        yield path
        return
    for child in sorted(path.rglob("*")):
        if not child.is_file():
            continue
        if SKIP_PARTS.intersection(child.parts):
            continue
        if child.suffix == ".pyc":
            continue
        yield child


def main():
    missing = [name for name in INCLUDE if not (ROOT / name).exists()]
    if missing:
        raise SystemExit("Missing files, zip not written: " + ", ".join(missing))

    OUT_DIR.mkdir(exist_ok=True)
    if OUT.exists():
        OUT.unlink()

    count = 0
    with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name in INCLUDE:
            for path in files_under(ROOT / name):
                arc = path.relative_to(ROOT).as_posix()
                zf.write(path, arc)
                count += 1

    print(f"Wrote {OUT}")
    print(f"{count} files, {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
