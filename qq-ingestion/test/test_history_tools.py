import json
import tempfile
import unittest
from pathlib import Path

from lockmyitem_qqbot.history_tools import aggregate_manifest_records, inspect_loose_directory, read_manifest


class HistoryToolsTest(unittest.TestCase):
    def test_manifest_groups_same_sender_inside_window(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "messages.jsonl"
            records = [
                {"messageId": "m1", "groupId": "g", "senderId": "u", "text": "捡到耳机", "sentAt": "2026-07-22T09:00:00+08:00"},
                {"messageId": "m2", "groupId": "g", "senderId": "u", "text": "地点在教学中心", "sentAt": "2026-07-22T09:00:40+08:00"},
                {"messageId": "m3", "groupId": "g", "senderId": "u", "text": "另一件物品", "sentAt": "2026-07-22T09:02:00+08:00"},
            ]
            path.write_text("\n".join(json.dumps(record, ensure_ascii=False) for record in records), encoding="utf-8")
            batches, errors = aggregate_manifest_records(read_manifest(path), path.parent, 45)
            self.assertEqual(errors, [])
            self.assertEqual([batch["messageIds"] for batch in batches], [["m1", "m2"], ["m3"]])
            self.assertIn("教学中心", batches[0]["text"])

    def test_manifest_rejects_missing_id_sender_and_timezone(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "messages.jsonl"
            path.write_text(json.dumps({"groupId": "g", "text": "物品", "sentAt": "2026-07-22 09:00:00"}), encoding="utf-8")
            batches, errors = aggregate_manifest_records(read_manifest(path), path.parent, 45)
            self.assertEqual(batches, [])
            self.assertTrue(any("messageId" in error for error in errors))
            self.assertTrue(any("senderId" in error for error in errors))
            self.assertTrue(any("timezone" in error for error in errors))

    def test_manifest_without_time_pairs_adjacent_images_and_location_by_order(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "front.jpg").write_bytes(b"front")
            (root / "back.jpg").write_bytes(b"back")
            records = [
                {"messageId": "m1", "groupId": "g", "senderId": "u", "imagePaths": ["front.jpg"]},
                {"messageId": "m2", "groupId": "g", "senderId": "u", "imagePaths": ["back.jpg"]},
                {"messageId": "m3", "groupId": "g", "senderId": "u", "text": "放在教学中心一楼服务台"},
            ]
            batches, errors = aggregate_manifest_records(records, root, 45)
            self.assertEqual(errors, [])
            self.assertEqual(len(batches), 1)
            self.assertEqual(batches[0]["messageIds"], ["m1", "m2", "m3"])
            self.assertEqual(batches[0]["imagePaths"], ["front.jpg", "back.jpg"])
            self.assertIn("教学中心", batches[0]["text"])
            self.assertEqual(batches[0]["sentAt"], "")

    def test_manifest_without_time_uses_sender_and_location_boundary(self):
        records = [
            {"messageId": "a1", "groupId": "g", "senderId": "a", "imagePaths": ["a.jpg"]},
            {"messageId": "a2", "groupId": "g", "senderId": "a", "text": "图书馆服务台"},
            {"messageId": "b1", "groupId": "g", "senderId": "b", "text": "这不是上一件"},
            {"messageId": "a3", "groupId": "g", "senderId": "a", "imagePaths": ["a2.jpg"]},
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("a.jpg", "a2.jpg"):
                (root / name).write_bytes(name.encode())
            batches, errors = aggregate_manifest_records(records, root, 45)
        self.assertEqual(errors, [])
        self.assertEqual([batch["messageIds"] for batch in batches], [["a1", "a2"], ["b1"], ["a3"]])

    def test_manifest_without_time_splits_next_image_after_location(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("phone.jpg", "card.jpg"):
                (root / name).write_bytes(name.encode())
            records = [
                {"messageId": "m1", "groupId": "g", "senderId": "u", "imagePaths": ["phone.jpg"]},
                {"messageId": "m2", "groupId": "g", "senderId": "u", "text": "快递站找到"},
                {"messageId": "m3", "groupId": "g", "senderId": "u", "imagePaths": ["card.jpg"]},
            ]
            batches, errors = aggregate_manifest_records(records, root, 45)
        self.assertEqual(errors, [])
        self.assertEqual([batch["messageIds"] for batch in batches], [["m1", "m2"], ["m3"]])

    def test_loose_images_are_forced_to_review(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.png"
            path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 8 + (10).to_bytes(4, "big") + (20).to_bytes(4, "big") + b"\x00" * 8)
            audit = inspect_loose_directory(Path(directory))
            self.assertEqual(audit["imageCount"], 1)
            self.assertEqual(audit["forcedRoute"], "needs_review")
            self.assertEqual((audit["images"][0]["width"], audit["images"][0]["height"]), (10, 20))


if __name__ == "__main__":
    unittest.main()
