import argparse
import hashlib
import json
from pathlib import Path

from check_config import load_env_file
from lockmyitem_qqbot.history_store import HistoryResultStore
from lockmyitem_qqbot.history_tools import IMAGE_SUFFIXES, aggregate_manifest_records, inspect_image, read_manifest
from lockmyitem_qqbot.local_model import HunyuanLocalClient, normalize_analysis, route_analysis


def _source_id(group_id: str, message_ids: list[str]) -> str:
    canonical = json.dumps([group_id, sorted(message_ids)], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def discover(source: Path, window_seconds: int, group_id: str, group_name: str) -> tuple[str, list[dict], list[str]]:
    source = source.resolve()
    if source.is_file():
        if source.suffix.lower() != ".jsonl":
            return "unsupported_export", [], [f"暂不识别该导出格式：{source.name}；请保留原文件，拿到样本后再添加适配器"]
        manifests = [source]
    else:
        preferred = source / "messages.jsonl"
        manifests = [preferred] if preferred.is_file() else sorted(source.glob("*.jsonl"))
    if manifests:
        if len(manifests) > 1:
            return "manifest", [], ["目录内有多个 JSONL，请用 --source 指定其中一个"]
        batches, errors = aggregate_manifest_records(read_manifest(manifests[0]), manifests[0].parent, window_seconds)
        for batch in batches:
            batch["_baseDir"] = str(manifests[0].parent)
        return "manifest", batches, errors
    if not source.is_dir():
        return "unknown", [], [f"输入不存在：{source}"]
    export_candidates = [
        path for path in sorted(source.rglob("*"))
        if path.is_file() and path.suffix.lower() in {".txt", ".html", ".htm", ".mht", ".json"}
    ]
    if export_candidates:
        names = ", ".join(path.name for path in export_candidates[:5])
        return "unsupported_export", [], [f"发现尚未适配的 QQ 导出文件：{names}；请勿删除或手工改写，先按真实格式添加解析器"]
    image_paths = [path for path in sorted(source.rglob("*")) if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES]
    batches = []
    for path in image_paths:
        info = inspect_image(path)
        batches.append({
            "messageIds": [f"history-loose:{info['sha256']}"],
            "groupId": group_id,
            "groupName": group_name,
            "senderId": "history-unknown",
            "text": "",
            "imagePaths": [str(path)],
            "sentAt": "",
            "_baseDir": "",
        })
    return "loose_images", batches, ([] if batches else ["没有找到 messages.jsonl 或支持的图片"])


def image_info(batch: dict) -> tuple[list[Path], list[dict]]:
    base = Path(batch.get("_baseDir") or ".")
    paths = [((base / value).resolve() if not Path(value).is_absolute() else Path(value).resolve()) for value in batch.get("imagePaths", [])]
    safe = []
    for path in paths:
        info = inspect_image(path)
        safe.append({key: info[key] for key in ("path", "name", "bytes", "sha256", "width", "height")})
    return paths, safe


def process(source: Path, store: HistoryResultStore | None, client: HunyuanLocalClient | None, dry_run: bool,
            window_seconds: int, group_id: str, group_name: str) -> tuple[int, dict]:
    mode, batches, errors = discover(source, window_seconds, group_id, group_name)
    if errors:
        return 2, {"ok": False, "sourceMode": mode, "errors": errors}
    report = {"ok": True, "sourceMode": mode, "batchCount": len(batches), "new": 0, "cached": 0, "routes": {}, "failures": []}
    previews = []
    for batch in batches:
        source_id = _source_id(batch["groupId"], batch["messageIds"])
        existing = store.get(source_id) if store else None
        if existing:
            report["cached"] += 1
            route = existing["route"]
            report["routes"][route] = report["routes"].get(route, 0) + 1
            continue
        paths, safe_images = image_info(batch)
        if dry_run:
            previews.append({
                "sourceId": source_id,
                "messageIds": batch["messageIds"],
                "sourceTextPresent": bool(str(batch.get("text") or "").strip()),
                "sentAt": batch.get("sentAt", ""),
                "images": safe_images,
                "forcedRoute": "needs_review" if mode == "loose_images" else "model_decides",
            })
            continue
        source_text = str(batch.get("text") or "")
        try:
            analysis = normalize_analysis(client.analyze(source_text, batch.get("sentAt", ""), paths))
        except Exception as error:
            report["ok"] = False
            report["failures"].append({"sourceId": source_id, "error": str(error)[:300]})
            continue
        route = route_analysis(analysis, mode)
        result = {
            "sourceId": source_id,
            "sourceMode": mode,
            "messageIds": batch["messageIds"],
            "groupId": batch["groupId"],
            "groupName": batch.get("groupName") or group_name,
            "senderHash": hashlib.sha256(str(batch.get("senderId") or "").encode("utf-8")).hexdigest(),
            "sourceTextPresent": bool(source_text.strip()),
            "sourceTextSha256": hashlib.sha256(source_text.encode("utf-8")).hexdigest() if source_text else "",
            "sentAt": batch.get("sentAt", ""),
            "images": safe_images,
            "analysis": analysis,
            "route": route,
        }
        store.put(source_id, result)
        report["new"] += 1
        report["routes"][route] = report["routes"].get(route, 0) + 1
    if dry_run:
        report["previews"] = previews
    return (3 if report["failures"] else 0), report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="本地解析 QQ 聊天记录并调用混元，结果不会包含图片 Base64")
    parser.add_argument("--source", type=Path, required=True, help="messages.jsonl 或包含聊天记录/图片的目录")
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    parser.add_argument("--state", type=Path, default=Path("data/history-results.sqlite3"))
    parser.add_argument("--output", type=Path, default=Path("data/history-results.jsonl"))
    parser.add_argument("--group-id", default="history-import")
    parser.add_argument("--group-name", default="上科大健忘者互助协会")
    parser.add_argument("--window-seconds", type=int, default=45)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.env_file.is_file():
        load_env_file(args.env_file)
    result_store = None if args.dry_run else HistoryResultStore(args.state)
    try:
        model_client = None if args.dry_run else HunyuanLocalClient()
    except RuntimeError as error:
        print(json.dumps({"ok": False, "errors": [str(error)]}, ensure_ascii=False, indent=2))
        raise SystemExit(2)
    exit_code, summary = process(
        args.source, result_store, model_client, args.dry_run, args.window_seconds, args.group_id, args.group_name
    )
    if not args.dry_run and result_store is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text("\n".join(json.dumps(item, ensure_ascii=False) for item in result_store.all()), encoding="utf-8")
        summary["output"] = str(args.output.resolve())
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    raise SystemExit(exit_code)
