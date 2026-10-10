#!/usr/bin/env python3
import argparse
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

OLD_HOTUPDATE = b"https://freefiremobile-a.akamaihd.net/sbt/ABHotUpdates/"
NEW_HOTUPDATE = b"http://142.44.162.24:19134/legacy170x/sbt/ABHotUpdates/"

SERVER_TXT = """# FF Legacy 1.70.0 - full XAPK build
BOOTSTRAP=http://142.44.162.24:19134
LIVE=http://142.44.162.24:19134
CDN=http://142.44.162.24:19134/sbt/ABHotUpdates/
LOGIN=http://142.44.162.24:19132
MAIN=http://142.44.162.24:19133
GATEWAY=142.44.162.24:8084
MATCH=142.44.162.24:10100
""".encode("utf-8")


def run(*args, cwd=None):
    print("+", " ".join(map(str, args)), flush=True)
    subprocess.run([str(x) for x in args], cwd=cwd, check=True)


def find_game_apk(xapk_path: Path):
    with zipfile.ZipFile(xapk_path, "r") as xz:
        candidates = [n for n in xz.namelist() if n.lower().endswith(".apk")]
        if not candidates:
            raise RuntimeError("XAPK does not contain any APK")
        print("APK candidates:", candidates)
        for name in candidates:
            raw = xz.read(name)
            try:
                with zipfile.ZipFile(io.BytesIO(raw), "r") as az:
                    if "assets/bin/Data/level0" in az.namelist():
                        print("Selected game APK:", name)
                        return name, raw
            except zipfile.BadZipFile:
                pass
    raise RuntimeError("No APK containing assets/bin/Data/level0 was found")


def clone_info(info: zipfile.ZipInfo) -> zipfile.ZipInfo:
    out = zipfile.ZipInfo(info.filename, info.date_time)
    out.comment = info.comment
    out.extra = info.extra
    out.internal_attr = info.internal_attr
    out.external_attr = info.external_attr
    out.create_system = info.create_system
    out.create_version = info.create_version
    out.extract_version = info.extract_version
    out.flag_bits = info.flag_bits & ~0x08
    out.volume = info.volume
    out.compress_type = info.compress_type
    return out


def patch_apk(apk_bytes: bytes, work: Path, zipalign: Path, apksigner: Path, keystore: Path) -> Path:
    original = work / "base-original.apk"
    unsigned = work / "base-unsigned.apk"
    aligned = work / "base-aligned.apk"
    signed = work / "base-signed.apk"
    original.write_bytes(apk_bytes)

    with zipfile.ZipFile(original, "r") as zin:
        if "assets/bin/Data/level0" not in zin.namelist():
            raise RuntimeError("inner APK is missing assets/bin/Data/level0")
        level_info = zin.getinfo("assets/bin/Data/level0")
        level = zin.read(level_info)
        count = level.count(OLD_HOTUPDATE)
        print(f"Hot-update URL occurrences: {count}")
        if count != 1:
            raise RuntimeError(f"expected exactly one historical hot-update URL, found {count}")
        if len(OLD_HOTUPDATE) != len(NEW_HOTUPDATE):
            raise RuntimeError("replacement URL length changed; refusing binary patch")
        level = level.replace(OLD_HOTUPDATE, NEW_HOTUPDATE)

        with zipfile.ZipFile(unsigned, "w", allowZip64=True) as zout:
            for info in zin.infolist():
                name = info.filename
                if name.startswith("META-INF/"):
                    continue
                if name in ("assets/bin/Data/level0", "assets/fflegacy/server.txt"):
                    continue
                out_info = clone_info(info)
                with zin.open(info, "r") as src, zout.open(out_info, "w", force_zip64=True) as dst:
                    shutil.copyfileobj(src, dst, length=1024 * 1024)

            out_info = clone_info(level_info)
            zout.writestr(out_info, level)

            cfg = zipfile.ZipInfo("assets/fflegacy/server.txt")
            cfg.compress_type = zipfile.ZIP_DEFLATED
            cfg.external_attr = 0o100644 << 16
            zout.writestr(cfg, SERVER_TXT)

    run(zipalign, "-f", "-p", "4", unsigned, aligned)
    run(
        apksigner, "sign",
        "--ks", keystore,
        "--ks-key-alias", "androiddebugkey",
        "--ks-pass", "pass:android",
        "--key-pass", "pass:android",
        "--v1-signing-enabled", "true",
        "--v2-signing-enabled", "true",
        "--v3-signing-enabled", "true",
        "--v4-signing-enabled", "false",
        "--out", signed,
        aligned,
    )
    run(apksigner, "verify", "--verbose", "--print-certs", signed)

    with zipfile.ZipFile(signed, "r") as z:
        patched_level = z.read("assets/bin/Data/level0")
        if NEW_HOTUPDATE not in patched_level or OLD_HOTUPDATE in patched_level:
            raise RuntimeError("signed APK verification failed: hot-update URL not patched")
        if z.read("assets/fflegacy/server.txt") != SERVER_TXT:
            raise RuntimeError("signed APK verification failed: server.txt mismatch")

    print("Patched APK size:", signed.stat().st_size)
    return signed


def replace_zip_entry(zip_path: Path, entry_name: str, replacement: Path):
    # `zip -d` and `zip -0` preserve every large untouched XAPK member (notably OBB data),
    # avoiding a 600+ MB decompress/recompress cycle.
    run("zip", "-d", zip_path, entry_name)
    staging = zip_path.parent / "replace-entry"
    target = staging / entry_name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(replacement, target)
    run("zip", "-0", zip_path, entry_name, cwd=staging)
    shutil.rmtree(staging, ignore_errors=True)


def update_xapk_manifest(xapk_path: Path):
    with zipfile.ZipFile(xapk_path, "r") as z:
        if "manifest.json" not in z.namelist():
            return
        manifest = json.loads(z.read("manifest.json").decode("utf-8"))
        package_files = [i for i in z.infolist() if i.filename.lower().endswith((".apk", ".obb"))]
        total = sum(i.file_size for i in package_files)
        changed = False
        if "total_size" in manifest:
            manifest["total_size"] = total
            changed = True
        if not changed:
            return

    with tempfile.TemporaryDirectory(prefix="xapk-manifest-") as td:
        p = Path(td) / "manifest.json"
        p.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        run("zip", "-d", xapk_path, "manifest.json")
        run("zip", "-0", xapk_path, "manifest.json", cwd=td)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("xapk", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--zipalign", type=Path, required=True)
    parser.add_argument("--apksigner", type=Path, required=True)
    parser.add_argument("--keystore", type=Path, required=True)
    args = parser.parse_args()

    if len(OLD_HOTUPDATE) != 55 or len(NEW_HOTUPDATE) != 55:
        raise RuntimeError("hot-update URLs must both stay exactly 55 bytes")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    inner_name, inner_apk = find_game_apk(args.xapk)

    with tempfile.TemporaryDirectory(prefix="ff-xapk-patch-") as td:
        work = Path(td)
        signed_apk = patch_apk(inner_apk, work, args.zipalign, args.apksigner, args.keystore)
        shutil.copy2(args.xapk, args.output)
        replace_zip_entry(args.output, inner_name, signed_apk)
        update_xapk_manifest(args.output)

    with zipfile.ZipFile(args.output, "r") as xz:
        print("Final XAPK entries:")
        for info in xz.infolist():
            if info.filename.lower().endswith((".apk", ".obb")) or info.filename == "manifest.json":
                print(f"  {info.file_size:>12}  {info.filename}")

    print("OUTPUT=", args.output)
    print("SIZE=", args.output.stat().st_size)


if __name__ == "__main__":
    main()
