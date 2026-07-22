import asyncio
import base64
import hashlib
import hmac
import json
import mimetypes
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from .aggregator import IncomingMessage, MessageAggregator
from .spool import DurableSpool, SpoolRecord


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"missing environment variable: {name}")
    return value


def canonical_payload(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def build_signed_envelope(action: str, payload: dict[str, Any], secret: bytes, timestamp: int | None = None) -> dict[str, Any]:
    timestamp = int(time.time() * 1000) if timestamp is None else int(timestamp)
    signed_message = f"{timestamp}.{action}.{canonical_payload(payload)}"
    signature = hmac.new(secret, signed_message.encode("utf-8"), hashlib.sha256).hexdigest()
    return {"action": action, "timestamp": timestamp, "signature": signature, "payload": payload}


def _download_image(url: str, allowed_suffixes: tuple[str, ...], max_bytes: int = 4 * 1024 * 1024) -> tuple[str, int]:
    def allowed(candidate: str) -> bool:
        parsed = urllib.parse.urlparse(candidate)
        host = (parsed.hostname or "").lower()
        return parsed.scheme == "https" and any(host == suffix or host.endswith(f".{suffix}") for suffix in allowed_suffixes)

    if not allowed(url):
        raise ValueError("QQ image URL host is not allowed")
    request = urllib.request.Request(url, headers={"User-Agent": "LockMyItem-QQBot/1.0"})
    with urllib.request.urlopen(request, timeout=15) as response:
        final_url = response.geturl()
        if not allowed(final_url):
            raise ValueError("QQ image redirect host is not allowed")
        content_type = response.headers.get_content_type()
        if not content_type.startswith("image/"):
            raise ValueError("attachment is not an image")
        data = response.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ValueError("QQ image exceeds 4 MB")
    return f"data:{content_type};base64,{base64.b64encode(data).decode('ascii')}", len(data)


class LockMyItemIngestClient:
    def __init__(self, reply_callback=None):
        self.ingest_url = os.getenv("LOCKMYITEM_INGEST_URL", "").strip()
        secret = os.getenv("QQ_INGEST_SECRET", "").strip()
        if bool(self.ingest_url) != bool(secret):
            raise RuntimeError("LOCKMYITEM_INGEST_URL and QQ_INGEST_SECRET must be configured together")
        self.secret = secret.encode("utf-8") if secret else b""
        self.backend_configured = bool(self.ingest_url and self.secret)
        self.group_id = os.getenv("QQ_GROUP_ID", "").strip()
        self.group_name = os.getenv("QQ_GROUP_NAME", "上科大健忘者互助协会").strip()
        self.allowed_suffixes = tuple(
            value.strip().lower()
            for value in os.getenv("QQ_IMAGE_HOST_SUFFIXES", "qpic.cn,qq.com,gtimg.cn").split(",")
            if value.strip()
        )
        self.max_batch_image_bytes = int(os.getenv("QQ_MAX_BATCH_IMAGE_BYTES", str(3_500_000)))
        self.post_max_attempts = max(1, int(os.getenv("QQ_POST_MAX_ATTEMPTS", "5")))
        self.post_retry_base_seconds = max(0.1, float(os.getenv("QQ_POST_RETRY_BASE_SECONDS", "1")))
        self.reply_callback = reply_callback
        default_spool_path = Path(__file__).resolve().parents[1] / "data" / "qq-ingestion-spool.sqlite3"
        spool_path = os.getenv("QQ_SPOOL_PATH", "").strip() or str(default_spool_path)
        self.spool = DurableSpool(spool_path)
        self._delivery_lock = asyncio.Lock()
        self.aggregator = MessageAggregator(
            float(os.getenv("QQ_AGGREGATION_SECONDS", "45")),
            self._flush,
            seen_ttl_seconds=float(os.getenv("QQ_SEEN_ID_TTL_SECONDS", str(24 * 60 * 60))),
            max_seen_ids=int(os.getenv("QQ_MAX_SEEN_IDS", "20000")),
        )

    async def accept(self, message: IncomingMessage) -> bool:
        if self.group_id and message.group_id != self.group_id:
            return False
        return await self.aggregator.add(message)

    async def _flush(self, messages: list[IncomingMessage]) -> None:
        first = messages[0]
        image_urls = [url for message in messages for url in message.image_urls]
        images = []
        total_image_bytes = 0
        for url in image_urls[:6]:
            try:
                image, image_bytes = await asyncio.to_thread(_download_image, url, self.allowed_suffixes)
                if total_image_bytes + image_bytes > self.max_batch_image_bytes:
                    print("skip QQ attachment: batch image payload limit reached")
                    continue
                images.append(image)
                total_image_bytes += image_bytes
            except Exception as error:
                print(f"skip QQ attachment: {error}")
        payload = {
            "messageIds": [message.message_id for message in messages],
            "groupId": first.group_id,
            "groupName": first.group_name or self.group_name,
            "senderId": first.sender_id,
            "text": "\n".join(message.text.strip() for message in messages if message.text.strip()),
            "images": images,
            "sentAt": first.sent_at,
        }
        batch_id, inserted = await asyncio.to_thread(self.spool.enqueue, payload)
        if inserted:
            print(f"queued QQ batch {batch_id[:12]} with {len(payload['messageIds'])} message(s)")
        if not self.backend_configured:
            print("QQ backend is not configured; batch remains in the local durable queue")
            return
        await self.deliver_pending()

    async def _deliver_record(self, record: SpoolRecord) -> bool:
        response = None
        last_error = None
        for attempt in range(1, self.post_max_attempts + 1):
            try:
                response = await asyncio.to_thread(self._post, record.payload)
                break
            except Exception as error:
                last_error = error
                if attempt < self.post_max_attempts:
                    delay = min(30.0, self.post_retry_base_seconds * (2 ** (attempt - 1)))
                    print(f"QQ ingestion attempt {attempt} failed; retrying in {delay:g}s: {error}")
                    await asyncio.sleep(delay)
        if response is None:
            retry_delay = min(300.0, self.post_retry_base_seconds * (2 ** min(record.attempts, 8)))
            await asyncio.to_thread(self.spool.mark_retry, record.batch_id, str(last_error or "delivery failed"), retry_delay)
            print(f"QQ ingestion deferred for {retry_delay:g}s: {last_error}")
            return False

        reply_text = response.get("replyText", "")
        if reply_text and self.reply_callback and not response.get("replyQueued"):
            payload = record.payload
            message_ids = payload.get("messageIds") or [""]
            first = IncomingMessage(
                message_id=str(message_ids[0]),
                group_id=str(payload.get("groupId") or ""),
                group_name=str(payload.get("groupName") or self.group_name),
                sender_id=str(payload.get("senderId") or ""),
                sent_at=str(payload.get("sentAt") or ""),
            )
            try:
                await self.reply_callback(first, reply_text)
            except Exception as error:
                retry_delay = min(300.0, self.post_retry_base_seconds * (2 ** min(record.attempts, 8)))
                await asyncio.to_thread(self.spool.mark_retry, record.batch_id, f"reply failed: {error}", retry_delay)
                return False
        await asyncio.to_thread(self.spool.mark_sent, record.batch_id)
        return True

    async def deliver_pending(self, limit: int = 10) -> int:
        if not self.backend_configured:
            return 0
        delivered = 0
        async with self._delivery_lock:
            records = await asyncio.to_thread(self.spool.due, limit)
            for record in records:
                if await self._deliver_record(record):
                    delivered += 1
            await asyncio.to_thread(self.spool.cleanup_processed)
        return delivered

    def _require_backend(self) -> None:
        if not self.backend_configured:
            raise RuntimeError("QQ backend delivery is not configured")

    def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.post_action("ingestQQBatch", payload)

    def post_action(self, action: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_backend()
        envelope = build_signed_envelope(action, payload, self.secret)
        body = json.dumps(envelope, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(self.ingest_url, data=body, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(request, timeout=40) as response:
            result = json.loads(response.read().decode("utf-8"))
        if isinstance(result.get("body"), str):
            result = json.loads(result["body"])
        if result.get("ok") is False:
            raise RuntimeError(result.get("message") or result.get("code") or "ingestion failed")
        return result.get("data", result)

    def pull_outbox(self, limit: int = 5) -> list[dict[str, Any]]:
        return self.post_action("pullQQOutbox", {"limit": limit}).get("messages", [])

    def ack_outbox(self, outbox_id: str, sent: bool, error: str = "") -> dict[str, Any]:
        return self.post_action("ackQQOutbox", {"outboxId": outbox_id, "sent": sent, "error": error[:300]})


def attachment_urls(message: Any) -> list[str]:
    values = []
    for attachment in getattr(message, "attachments", None) or []:
        url = getattr(attachment, "url", "") or (attachment.get("url", "") if isinstance(attachment, dict) else "")
        content_type = getattr(attachment, "content_type", "") or (attachment.get("content_type", "") if isinstance(attachment, dict) else "")
        if url and (not content_type or str(content_type).startswith("image/")):
            values.append(str(url))
    return values
