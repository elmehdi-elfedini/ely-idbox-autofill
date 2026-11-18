#!/usr/bin/env python3
"""Create a store-ready ZIP from manifest-referenced extension files only."""

import argparse
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def add_file(files, value):
    if not isinstance(value, str) or not value:
        return
    normalized = value.replace("\\", "/")
    path = Path(normalized)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"Unsafe manifest path: {value}")
    matches = list(ROOT.glob(normalized)) if any(c in normalized for c in "*?[") else [ROOT / path]
    for match in matches:
        if match.is_file():
            files.add(match.relative_to(ROOT).as_posix())
        elif not match.exists():
            raise FileNotFoundError(f"Manifest file not found: {value}")


def package_files(manifest):
    files = {"manifest.json"}
    background = manifest.get("background", {})
    add_file(files, background.get("service_worker"))
    for item in background.get("scripts", []):
        add_file(files, item)

    for content_script in manifest.get("content_scripts", []):
        for key in ("js", "css"):
            for item in content_script.get(key, []):
                add_file(files, item)

    for key in ("icons",):
        for item in manifest.get(key, {}).values():
            add_file(files, item)
    for action_key in ("action", "browser_action", "page_action"):
        action = manifest.get(action_key, {})
        for item in action.get("default_icon", {}).values() if isinstance(action.get("default_icon"), dict) else [action.get("default_icon")]:
            add_file(files, item)

    for key in ("side_panel", "options_ui"):
        add_file(files, manifest.get(key, {}).get("default_path") or manifest.get(key, {}).get("page"))
    for key in ("options_page", "devtools_page"):
        add_file(files, manifest.get(key))
    for item in manifest.get("chrome_url_overrides", {}).values():
        add_file(files, item)
    for resource_group in manifest.get("web_accessible_resources", []):
        for item in resource_group.get("resources", []):
            add_file(files, item)

    # HTML pages can load scripts, stylesheets, and images outside the manifest.
    for html_file in [name for name in files if name.lower().endswith((".html", ".htm"))]:
        html = (ROOT / html_file).read_text(encoding="utf-8")
        for asset in re.findall(r"(?:src|href)\s*=\s*[\"']([^\"']+)[\"']", html, flags=re.IGNORECASE):
            if asset.startswith(("http://", "https://", "data:", "#", "chrome-extension://")):
                continue
            add_file(files, (Path(html_file).parent / asset).as_posix())

    return sorted(files)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="dist/ely-idbox.zip")
    parser.add_argument("--tag", help="Release tag; must match the manifest version, for example v2.1")
    args = parser.parse_args()

    manifest_path = ROOT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    version = manifest.get("version", "")
    if not re.fullmatch(r"\d+(\.\d+){1,3}", version):
        raise ValueError(f"Invalid extension version: {version!r}")
    if args.tag and args.tag.removeprefix("v") != version:
        raise ValueError(f"Tag {args.tag!r} does not match manifest version {version!r}")

    files = package_files(manifest)
    output = Path(args.output)
    if not output.is_absolute():
        output = ROOT / output
    output.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for relative in files:
            archive.write(ROOT / relative, relative)

    print(f"Packaged version {version}: {output}")
    print(f"Included {len(files)} runtime files; local CSV exports and screenshots are excluded.")


if __name__ == "__main__":
    main()
