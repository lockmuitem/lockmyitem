import base64
import tempfile
import unittest
from pathlib import Path

from import_history import materialize_batch, preview_batch


class ImportHistoryTest(unittest.TestCase):
    def test_force_review_marks_grouped_batch_as_loose_images(self):
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "sample.jpg"
            image.write_bytes(b"test-image")
            batch = {"messageIds": ["m1"], "text": "", "imagePaths": [image.name]}

            payload = materialize_batch(batch, Path(directory), force_review=True)
            self.assertEqual(payload["importMode"], "loose_images")
            self.assertFalse(payload["replyEnabled"])
            self.assertEqual(base64.b64decode(payload["images"][0].split(",", 1)[1]), b"test-image")
            self.assertEqual(preview_batch(batch, Path(directory), force_review=True)["expectedRoute"], "needs_review")


if __name__ == "__main__":
    unittest.main()
