import hashlib
import hmac
import json
import os
import tempfile
import unittest
from unittest.mock import Mock, patch

from lockmyitem_qqbot.aggregator import IncomingMessage
from lockmyitem_qqbot.client import LockMyItemIngestClient, _download_image, build_signed_envelope


class _Headers:
    def __init__(self, content_type: str):
        self.content_type = content_type

    def get_content_type(self):
        return self.content_type


class _Response:
    def __init__(self, body: bytes, content_type: str = "application/json", url: str = "https://gchat.qpic.cn/image.jpg"):
        self.body = body
        self.headers = _Headers(content_type)
        self.url = url

    def read(self, _limit=None):
        return self.body

    def geturl(self):
        return self.url

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class ClientProtocolTest(unittest.TestCase):
    def test_signature_is_canonical_and_binds_action(self):
        payload = {"text": "拾到耳机", "groupId": "group-1", "messageIds": ["m1", "m2"]}
        envelope = build_signed_envelope("ingestQQBatch", payload, b"test-secret", 1784685600000)
        canonical = '{"groupId":"group-1","messageIds":["m1","m2"],"text":"拾到耳机"}'
        expected = hmac.new(
            b"test-secret",
            f"1784685600000.ingestQQBatch.{canonical}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        self.assertEqual(envelope["signature"], expected)
        changed = build_signed_envelope("pullQQOutbox", payload, b"test-secret", 1784685600000)
        self.assertNotEqual(envelope["signature"], changed["signature"])

    def test_post_action_sends_signed_json_and_unwraps_http_trigger_body(self):
        captured = {}

        def fake_urlopen(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            wrapped = {"body": json.dumps({"ok": True, "data": {"status": "published"}})}
            return _Response(json.dumps(wrapped).encode("utf-8"))

        with tempfile.TemporaryDirectory() as directory:
            environment = {
                "LOCKMYITEM_INGEST_URL": "https://example.invalid/ingest",
                "QQ_INGEST_SECRET": "test-secret",
                "QQ_SPOOL_PATH": os.path.join(directory, "spool.sqlite3"),
            }
            with patch.dict(os.environ, environment, clear=True), patch(
                "lockmyitem_qqbot.client.urllib.request.urlopen", side_effect=fake_urlopen
            ):
                result = LockMyItemIngestClient().post_action("pullQQOutbox", {"limit": 3})

        body = json.loads(captured["request"].data.decode("utf-8"))
        self.assertEqual(body["action"], "pullQQOutbox")
        self.assertEqual(body["payload"], {"limit": 3})
        self.assertEqual(captured["request"].get_method(), "POST")
        self.assertEqual(captured["timeout"], 40)
        self.assertEqual(result, {"status": "published"})

    def test_image_download_rejects_non_https_and_lookalike_hosts(self):
        for url in (
            "http://gchat.qpic.cn/image.jpg",
            "https://qpic.cn.evil.example/image.jpg",
            "https://evilqpic.cn/image.jpg",
        ):
            with self.subTest(url=url), self.assertRaisesRegex(ValueError, "not allowed"):
                _download_image(url, ("qpic.cn", "qq.com"))

    def test_image_download_accepts_qq_subdomain_and_enforces_size(self):
        with patch(
            "lockmyitem_qqbot.client.urllib.request.urlopen",
            return_value=_Response(b"abc", "image/jpeg"),
        ):
            encoded, size = _download_image("https://gchat.qpic.cn/image.jpg", ("qpic.cn",), max_bytes=3)
        self.assertEqual((encoded, size), ("data:image/jpeg;base64,YWJj", 3))

        with patch(
            "lockmyitem_qqbot.client.urllib.request.urlopen",
            return_value=_Response(b"abcd", "image/jpeg"),
        ), self.assertRaisesRegex(ValueError, "exceeds"):
            _download_image("https://gchat.qpic.cn/image.jpg", ("qpic.cn",), max_bytes=3)

    def test_image_download_rejects_redirect_outside_qq_hosts(self):
        with patch(
            "lockmyitem_qqbot.client.urllib.request.urlopen",
            return_value=_Response(b"abc", "image/jpeg", "https://attacker.example/image.jpg"),
        ), self.assertRaisesRegex(ValueError, "redirect"):
            _download_image("https://gchat.qpic.cn/image.jpg", ("qpic.cn",))


class ClientRetryTest(unittest.IsolatedAsyncioTestCase):
    async def test_flush_retries_transient_ingestion_failures(self):
        with tempfile.TemporaryDirectory() as directory:
            environment = {
                "LOCKMYITEM_INGEST_URL": "https://example.invalid/ingest",
                "QQ_INGEST_SECRET": "test-secret",
                "QQ_POST_MAX_ATTEMPTS": "3",
                "QQ_POST_RETRY_BASE_SECONDS": "0.001",
                "QQ_SPOOL_PATH": os.path.join(directory, "spool.sqlite3"),
            }
            with patch.dict(os.environ, environment, clear=True):
                client = LockMyItemIngestClient()
            client._post = Mock(side_effect=[OSError("temporary-1"), OSError("temporary-2"), {"status": "needs_review"}])
            await client._flush([IncomingMessage("m1", "g1", "group", "u1", text="拾到耳机")])
            self.assertEqual(client._post.call_count, 3)
            self.assertEqual(client.spool.stats(), {"pending": 0, "processed": 1})

    async def test_listener_without_backend_keeps_batch_in_local_queue(self):
        with tempfile.TemporaryDirectory() as directory:
            environment = {"QQ_SPOOL_PATH": os.path.join(directory, "spool.sqlite3")}
            with patch.dict(os.environ, environment, clear=True):
                client = LockMyItemIngestClient()
            client._post = Mock()
            await client._flush([IncomingMessage("m-local", "g1", "group", "u1", text="拾到校园卡")])
            self.assertFalse(client.backend_configured)
            self.assertEqual(client._post.call_count, 0)
            self.assertEqual(client.spool.stats(), {"pending": 1, "processed": 0})


if __name__ == "__main__":
    unittest.main()
