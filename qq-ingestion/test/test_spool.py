import tempfile
import unittest
from pathlib import Path

from lockmyitem_qqbot.spool import DurableSpool, batch_id_for


class DurableSpoolTest(unittest.TestCase):
    def test_enqueue_is_idempotent_and_processed_payload_is_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            spool = DurableSpool(Path(directory) / "spool.sqlite3")
            payload = {
                "groupId": "g1",
                "messageIds": ["m2", "m1"],
                "images": ["data:image/jpeg;base64,PRIVATE"],
            }
            expected = batch_id_for({**payload, "messageIds": ["m1", "m2"]})
            batch_id, inserted = spool.enqueue(payload)
            self.assertEqual(batch_id, expected)
            self.assertTrue(inserted)
            self.assertFalse(spool.enqueue(payload)[1])
            self.assertEqual(spool.due()[0].payload, payload)

            spool.mark_sent(batch_id)
            self.assertEqual(spool.due(), [])
            self.assertEqual(spool.stats(), {"pending": 0, "processed": 1})
            self.assertFalse(spool.enqueue(payload)[1])

    def test_retry_delays_delivery_and_increments_attempts(self):
        with tempfile.TemporaryDirectory() as directory:
            spool = DurableSpool(Path(directory) / "spool.sqlite3")
            batch_id, _ = spool.enqueue({"groupId": "g", "messageIds": ["m"]})
            spool.mark_retry(batch_id, "temporary", 60)
            self.assertEqual(spool.due(now=0), [])
            record = spool.due(now=10**12)[0]
            self.assertEqual(record.attempts, 1)


if __name__ == "__main__":
    unittest.main()
