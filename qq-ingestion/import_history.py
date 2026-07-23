import argparse
import base64
import hashlib
import json
import mimetypes
from pathlib import Path

from lockmyitem_qqbot.client import LockMyItemIngestClient
from lockmyitem_qqbot.history_tools import aggregate_manifest_records, inspect_loose_directory, read_manifest


def data_url(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def materialize_batch(batch: dict, base_dir: Path, force_review: bool = False) -> dict:
    payload = {key: value for key, value in batch.items() if key != "imagePaths"}
    payload["images"] = [data_url((base_dir / value).resolve()) for value in batch.get("imagePaths", [])]
    payload["replyEnabled"] = False
    if force_review:
        payload["importMode"] = "loose_images"
    return payload


def preview_batch(batch: dict, base_dir: Path, force_review: bool = False) -> dict:
    return {
        **batch,
        "images": [str((base_dir / value).resolve()) for value in batch.get("imagePaths", [])],
        "expectedRoute": "needs_review" if force_review or not batch.get("text") else "model_decides",
    }


def import_manifest(path: Path, client: LockMyItemIngestClient | None, dry_run: bool, window_seconds: int,
                    force_review: bool = False) -> int:
    batches, errors = aggregate_manifest_records(read_manifest(path), path.parent, window_seconds)
    if errors:
        print(json.dumps({"valid": False, "errors": errors}, ensure_ascii=False, indent=2))
        return 2
    if dry_run:
        print(json.dumps({
            "valid": True,
            "messageCount": sum(len(batch["messageIds"]) for batch in batches),
            "batchCount": len(batches),
            "windowSeconds": window_seconds,
            "forceReview": force_review,
            "batches": [preview_batch(batch, path.parent, force_review) for batch in batches],
        }, ensure_ascii=False, indent=2))
        return 0
    for index, batch in enumerate(batches, 1):
        result = client._post(materialize_batch(batch, path.parent, force_review))
        print(index, result.get("status"), result.get("itemId") or result.get("draftId") or "")
    return 0


def import_loose_images(client: LockMyItemIngestClient | None, directory: Path, group_id: str, group_name: str, dry_run: bool) -> int:
    audit = inspect_loose_directory(directory)
    if dry_run:
        print(json.dumps(audit, ensure_ascii=False, indent=2))
        return 0 if audit["importable"] else 2
    for image in audit["images"]:
        image_path = Path(image["path"])
        payload = {
            "messageIds": [f"history-loose:{image['sha256']}"],
            "groupId": group_id,
            "groupName": group_name,
            "senderId": "history-unknown",
            "text": "",
            "images": [data_url(image_path)],
            "sentAt": "",
            "importMode": "loose_images",
            "replyEnabled": False,
        }
        result = client._post(payload)
        print(image_path.name, result.get("status"), result.get("draftId") or "")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate or import QQ history into LockMyItem")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--manifest", type=Path)
    source.add_argument("--image-dir", type=Path)
    parser.add_argument("--group-id", default="history-import")
    parser.add_argument("--group-name", default="上科大健忘者互助协会")
    parser.add_argument("--window-seconds", type=int, default=45)
    parser.add_argument("--force-review", action="store_true", help="无论模型置信度如何，全部导入为待审核草稿")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    ingest_client = None if args.dry_run else LockMyItemIngestClient()
    if args.manifest:
        raise SystemExit(import_manifest(args.manifest, ingest_client, args.dry_run, args.window_seconds, args.force_review))
    raise SystemExit(import_loose_images(ingest_client, args.image_dir, args.group_id, args.group_name, args.dry_run))
