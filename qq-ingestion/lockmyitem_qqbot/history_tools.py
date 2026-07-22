import hashlib
import json
import struct
from datetime import datetime
from pathlib import Path
from typing import Any


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def parse_timestamp(value: str) -> datetime:
    text = str(value or "").strip()
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        raise ValueError("sentAt must include a timezone offset")
    return parsed


def image_dimensions(path: Path) -> tuple[int, int] | None:
    with path.open("rb") as stream:
        head = stream.read(32)
        if head.startswith(b"\x89PNG\r\n\x1a\n") and len(head) >= 24:
            return struct.unpack(">II", head[16:24])
        if not head.startswith(b"\xff\xd8"):
            return None
        stream.seek(2)
        while True:
            marker_start = stream.read(1)
            if not marker_start:
                return None
            if marker_start != b"\xff":
                continue
            marker = stream.read(1)
            while marker == b"\xff":
                marker = stream.read(1)
            if marker in {b"\xd8", b"\xd9"}:
                continue
            length_bytes = stream.read(2)
            if len(length_bytes) != 2:
                return None
            length = struct.unpack(">H", length_bytes)[0]
            if marker and marker[0] in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
                data = stream.read(5)
                if len(data) != 5:
                    return None
                height, width = struct.unpack(">HH", data[1:5])
                return width, height
            stream.seek(max(0, length - 2), 1)


def inspect_image(path: Path) -> dict[str, Any]:
    size = path.stat().st_size
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    dimensions = image_dimensions(path)
    return {
        "path": str(path),
        "name": path.name,
        "bytes": size,
        "sha256": digest,
        "width": dimensions[0] if dimensions else None,
        "height": dimensions[1] if dimensions else None,
    }


def inspect_loose_directory(directory: Path) -> dict[str, Any]:
    images = [inspect_image(path) for path in sorted(directory.iterdir()) if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES]
    return {
        "format": "loose_images",
        "importable": bool(images),
        "autoPublishEligible": False,
        "forcedRoute": "needs_review",
        "missingFields": ["messageId", "senderId", "text/location", "image grouping"],
        "imageCount": len(images),
        "totalBytes": sum(image["bytes"] for image in images),
        "images": images,
    }


def read_manifest(path: Path) -> list[dict[str, Any]]:
    records = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        record = json.loads(line)
        record["_line"] = line_number
        records.append(record)
    return records


def validate_manifest_record(record: dict[str, Any], base_dir: Path) -> list[str]:
    errors = []
    line = record.get("_line", "?")
    message_ids = record.get("messageIds") or ([record.get("messageId")] if record.get("messageId") else [])
    if not message_ids or any(not str(value).strip() for value in message_ids):
        errors.append(f"line {line}: messageId/messageIds is required")
    for field in ("groupId", "senderId"):
        if not str(record.get(field, "")).strip():
            errors.append(f"line {line}: {field} is required")
    if record.get("sentAt"):
        try:
            parse_timestamp(record["sentAt"])
        except (TypeError, ValueError) as error:
            errors.append(f"line {line}: invalid sentAt ({error})")
    image_paths = record.get("imagePaths") or []
    if not str(record.get("text", "")).strip() and not image_paths:
        errors.append(f"line {line}: text or imagePaths is required")
    for value in image_paths:
        resolved = (base_dir / str(value)).resolve()
        if not resolved.is_file():
            errors.append(f"line {line}: image does not exist: {value}")
        elif resolved.suffix.lower() not in IMAGE_SUFFIXES:
            errors.append(f"line {line}: unsupported image type: {value}")
    return errors


def aggregate_manifest_records(records: list[dict[str, Any]], base_dir: Path, window_seconds: int = 45) -> tuple[list[dict[str, Any]], list[str]]:
    errors = [error for record in records for error in validate_manifest_record(record, base_dir)]
    timestamp_presence = [bool(str(record.get("sentAt") or "").strip()) for record in records]
    if any(timestamp_presence) and not all(timestamp_presence):
        errors.append("sentAt must be present on every record or omitted from every record")
    if errors:
        return [], errors

    prepared = []
    for sequence, record in enumerate(records):
        sent_at = str(record.get("sentAt") or "").strip()
        prepared.append({
            "messageIds": [str(value) for value in (record.get("messageIds") or [record["messageId"]])],
            "groupId": str(record["groupId"]),
            "groupName": str(record.get("groupName") or "上科大健忘者互助协会"),
            "senderId": str(record["senderId"]),
            "textParts": [str(record.get("text") or "").strip()] if str(record.get("text") or "").strip() else [],
            "imagePaths": [str(value) for value in (record.get("imagePaths") or [])],
            "sentAt": sent_at,
            "_timestamp": parse_timestamp(sent_at) if sent_at else None,
            "_sequence": sequence,
            "_itemBoundary": bool(record.get("itemBoundary") or record.get("newItem")),
        })

    if all(timestamp_presence):
        prepared.sort(key=lambda value: value["_timestamp"])
    batches: list[dict[str, Any]] = []

    def new_batch(message: dict[str, Any]) -> dict[str, Any]:
        batch = {
            "messageIds": [],
            "groupId": message["groupId"],
            "groupName": message["groupName"],
            "senderId": message["senderId"],
            "textParts": [],
            "imagePaths": [],
            "sentAt": message["sentAt"],
            "_lastTimestamp": message["_timestamp"],
            "_hasImages": False,
            "_textAfterImage": False,
        }
        batches.append(batch)
        return batch

    def append_message(batch: dict[str, Any], message: dict[str, Any]) -> None:
        had_images = batch["_hasImages"]
        batch["messageIds"].extend(message["messageIds"])
        batch["textParts"].extend(message["textParts"])
        batch["imagePaths"].extend(message["imagePaths"])
        if had_images and message["textParts"]:
            batch["_textAfterImage"] = True
        batch["_hasImages"] = bool(batch["imagePaths"])
        batch["_lastTimestamp"] = message["_timestamp"]

    if all(timestamp_presence):
        active: dict[tuple[str, str], dict[str, Any]] = {}
        for message in prepared:
            key = (message["groupId"], message["senderId"])
            batch = active.get(key)
            inactivity = (message["_timestamp"] - batch["_lastTimestamp"]).total_seconds() if batch else None
            if message["_itemBoundary"] or batch is None or inactivity is None or inactivity < 0 or inactivity > window_seconds:
                batch = new_batch(message)
                active[key] = batch
            append_message(batch, message)
    else:
        batch = None
        active_key = None
        for message in prepared:
            key = (message["groupId"], message["senderId"])
            starts_new_image_after_location = bool(
                batch and message["imagePaths"] and batch["_hasImages"] and batch["_textAfterImage"]
            )
            if message["_itemBoundary"] or batch is None or key != active_key or starts_new_image_after_location:
                batch = new_batch(message)
                active_key = key
            append_message(batch, message)

    output = []
    for batch in batches:
        output.append({
            "messageIds": list(dict.fromkeys(batch["messageIds"])),
            "groupId": batch["groupId"],
            "groupName": batch["groupName"],
            "senderId": batch["senderId"],
            "text": "\n".join(batch["textParts"]),
            "imagePaths": list(dict.fromkeys(batch["imagePaths"])),
            "sentAt": batch["sentAt"],
        })
    return output, []
