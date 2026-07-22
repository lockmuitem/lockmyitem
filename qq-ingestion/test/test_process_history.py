import json
import tempfile
import unittest
from pathlib import Path

from lockmyitem_qqbot.history_store import HistoryResultStore
from process_history import discover, process


class _FakeModel:
    def analyze(self, text, sent_at, image_paths):
        return {
            "isLostFound": True,
            "confidence": 0.91,
            "type": "found",
            "title": "蓝色雨伞",
            "description": text,
            "category": "日用品",
            "locationRaw": "教学中心",
            "locationName": "教学中心",
            "occurredAtText": sent_at,
            "sensitivityLevel": "normal",
            "aiTags": ["蓝色"],
            "modelReason": "",
        }


class ProcessHistoryTest(unittest.TestCase):
    def test_manifest_is_aggregated_and_cached(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "messages.jsonl"
            records = [
                {"messageId": "m1", "groupId": "g", "senderId": "u", "text": "捡到雨伞", "sentAt": "2026-07-22T09:00:00+08:00"},
                {"messageId": "m2", "groupId": "g", "senderId": "u", "text": "教学中心", "sentAt": "2026-07-22T09:00:30+08:00"},
            ]
            manifest.write_text("\n".join(json.dumps(item, ensure_ascii=False) for item in records), encoding="utf-8")
            store = HistoryResultStore(root / "state.sqlite3")
            code, report = process(root, store, _FakeModel(), False, 45, "history", "group")
            self.assertEqual(code, 0)
            self.assertEqual(report["new"], 1)
            self.assertEqual(report["routes"], {"publish_candidate": 1})
            _, repeated = process(root, store, _FakeModel(), False, 45, "history", "group")
            self.assertEqual(repeated["cached"], 1)

    def test_loose_images_are_always_reviewed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "item.jpg").write_bytes(b"not-a-real-jpeg-but-readable")
            mode, batches, errors = discover(root, 45, "history", "group")
            self.assertEqual((mode, len(batches), errors), ("loose_images", 1, []))
            store = HistoryResultStore(root / "state.sqlite3")
            _, report = process(root, store, _FakeModel(), False, 45, "history", "group")
            self.assertEqual(report["routes"], {"needs_review": 1})

    def test_unknown_qq_export_stops_instead_of_falling_back_to_images(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "聊天记录.html").write_text("<html></html>", encoding="utf-8")
            (root / "item.jpg").write_bytes(b"image")
            mode, batches, errors = discover(root, 45, "history", "group")
            self.assertEqual(mode, "unsupported_export")
            self.assertEqual(batches, [])
            self.assertTrue(errors)


if __name__ == "__main__":
    unittest.main()
