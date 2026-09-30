"""Extract verified publisher names from the legacy SQLite database, read only."""

import hashlib
import json
import sqlite3
import unicodedata
from pathlib import Path


BSS = Path(r"C:\Users\eliau\Downloads\ServiceSecretary.bss")
LEGACY = Path(r"C:\Users\eliau\Downloads\oradoress2-default-rtdb-export.json")
OUTPUT = Path(r"C:\Users\eliau\.codex\worktrees\pdf-a4\admin-spa\output\secretary-name-map-2026-09-30.json")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalized(value: str) -> str:
    folded = unicodedata.normalize("NFD", value or "")
    return " ".join("".join(char for char in folded if unicodedata.category(char) != "Mn").casefold().split())


legacy = json.loads(LEGACY.read_text(encoding="utf-8"))
publishers = legacy.get("secretario", {}).get("publicadores", {})
master = legacy.get("master", {}).get("pessoas", {})
connection = sqlite3.connect(f"file:{BSS.as_posix()}?mode=ro", uri=True)
connection.row_factory = sqlite3.Row
rows = connection.execute("SELECT _id, FirstName, MiddleName, LastName, Disabled FROM publishers").fetchall()
connection.close()

matches = []
pending = []
for row in rows:
    parts = [str(row[field] or "").strip() for field in ("FirstName", "MiddleName", "LastName")]
    full = " ".join(part for part in parts if part)
    short = " ".join(part for part in (parts[0].split(" ")[0], (parts[2] or parts[1]).split(" ")[-1]) if part)
    legacy_id = f"sec_pub_{row['_id']}"
    master_id = publishers.get(legacy_id, {}).get("masterId")
    old_name = master.get(master_id, {}).get("name", "")
    first = normalized(parts[0]).split(" ")[0] if normalized(parts[0]) else ""
    old_first = normalized(old_name).split(" ")[0] if normalized(old_name) else ""
    evidence = (
        bool(master_id and master_id in master)
        and "\ufffd" not in full
        and len(full.split()) >= 2
        and (
            normalized(old_name) in {normalized(full), normalized(short)}
            or (first == old_first and len(first) >= 3)
        )
    )
    item = {
        "publisherId": row["_id"],
        "masterId": master_id,
        "fullName": full,
        "shortName": short,
        "oldMasterName": old_name,
        "disabled": bool(row["Disabled"]),
    }
    (matches if evidence else pending).append(item)

by_master = {}
for item in matches:
    by_master.setdefault(item["masterId"], []).append(item)
duplicates = {master_id: items for master_id, items in by_master.items() if len(items) > 1}
for master_id in duplicates:
    pending.extend(by_master[master_id])
    matches = [item for item in matches if item["masterId"] != master_id]

output = {
    "sources": {"bss": {"path": str(BSS), "sha256": sha256(BSS)}, "legacy": {"path": str(LEGACY), "sha256": sha256(LEGACY)}},
    "counts": {"publishers": len(rows), "verified": len(matches), "pending": len(pending), "duplicateMasterIds": len(duplicates)},
    "verified": matches,
    "pending": pending,
}
if OUTPUT.exists():
    raise SystemExit(f"Output already exists: {OUTPUT}")
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(output["counts"], ensure_ascii=False))
