import unittest

from lockmyitem_qqbot.local_model import mask_sensitive_text, normalize_analysis, parse_json_content, route_analysis


class LocalModelPolicyTest(unittest.TestCase):
    def test_parses_fenced_json(self):
        self.assertEqual(parse_json_content('```json\n{"isLostFound": true}\n```'), {"isLostFound": True})

    def test_masks_identifiers_and_elevates_sensitive_category(self):
        analysis = normalize_analysis({
            "confidence": 0.95,
            "type": "found",
            "title": "校园卡",
            "description": "学号 12345678，手机号 13812345678",
            "locationName": "教学中心",
        })
        self.assertEqual(analysis["sensitivityLevel"], "sensitive")
        self.assertNotIn("12345678", analysis["description"])
        self.assertNotIn("13812345678", analysis["description"])
        self.assertEqual(route_analysis(analysis, "manifest"), "needs_review")

    def test_only_normal_high_confidence_complete_record_is_publish_candidate(self):
        normal = normalize_analysis({
            "confidence": 0.9,
            "title": "蓝色雨伞",
            "description": "捡到一把伞",
            "locationName": "教学中心",
        })
        self.assertEqual(route_analysis(normal, "manifest"), "publish_candidate")
        self.assertEqual(route_analysis(normal, "loose_images"), "needs_review")
        self.assertEqual(mask_sensitive_text("手机号 13900000000"), "手机号")


if __name__ == "__main__":
    unittest.main()
