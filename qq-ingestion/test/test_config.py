import unittest

from check_config import validate_config


class ConfigValidationTest(unittest.TestCase):
    def test_missing_configuration_fails_without_returning_values(self):
        issues = validate_config({}, "all")
        names = {entry["name"] for entry in issues if entry["level"] == "error"}
        self.assertIn("QQ_BOT_APP_ID", names)
        self.assertIn("AUTH_TOKEN_SECRET", names)
        self.assertIn("HUNYUAN_CREDENTIALS", names)
        self.assertNotIn("value", {key for entry in issues for key in entry})

    def test_valid_combined_configuration_passes(self):
        environment = {
            "QQ_BOT_APP_ID": "app-id",
            "QQ_BOT_SECRET": "bot-secret",
            "QQ_GROUP_ID": "group-id",
            "QQ_AGGREGATION_SECONDS": "45",
            "LOCKMYITEM_INGEST_URL": "https://example.com/ingest",
            "QQ_INGEST_SECRET": "i" * 32,
            "QQ_ADMIN_SECRET": "a" * 32,
            "QQ_ALLOWED_GROUP_IDS": "group-id",
            "QQ_REVIEW_OWNER_ACTOR_ID": "openid-admin",
            "WEB_PUBLIC_BASE_URL": "https://lockmyitem.example.com",
            "AUTH_TOKEN_SECRET": "t" * 32,
            "SMTP_HOST": "smtp.example.com",
            "SMTP_USER": "sender@example.com",
            "SMTP_PASS": "password",
            "HUNYUAN_API_KEY": "model-key",
        }
        errors = [entry for entry in validate_config(environment, "all") if entry["level"] == "error"]
        self.assertEqual(errors, [])

    def test_cloud_accepts_unified_qq_owner_email_without_existing_actor_id(self):
        environment = {
            "AUTH_TOKEN_SECRET": "t" * 32,
            "SMTP_HOST": "smtp.example.com",
            "SMTP_USER": "sender@example.com",
            "SMTP_PASS": "password",
            "HUNYUAN_API_KEY": "model-key",
            "QQ_INGEST_SECRET": "i" * 32,
            "QQ_ADMIN_SECRET": "a" * 32,
            "QQ_ALLOWED_GROUP_IDS": "group-id",
            "QQ_REVIEW_OWNER_EMAIL": "shaolq2025@shanghaitech.edu.cn",
            "WEB_PUBLIC_BASE_URL": "https://lockmyitem.asia",
        }
        errors = [entry for entry in validate_config(environment, "cloud") if entry["level"] == "error"]
        self.assertEqual(errors, [])

    def test_listener_scope_does_not_require_cloud_backend(self):
        environment = {
            "QQ_BOT_APP_ID": "app-id",
            "QQ_BOT_SECRET": "bot-secret",
            "QQ_GROUP_ID": "group-id",
        }
        errors = [entry for entry in validate_config(environment, "listener") if entry["level"] == "error"]
        self.assertEqual(errors, [])

    def test_local_scope_only_requires_hunyuan_api(self):
        environment = {"HUNYUAN_API_KEY": "local-key"}
        errors = [entry for entry in validate_config(environment, "local") if entry["level"] == "error"]
        self.assertEqual(errors, [])

    def test_rejects_shared_secrets_bad_urls_and_inverted_thresholds(self):
        shared = "x" * 32
        environment = {
            "AUTH_TOKEN_SECRET": shared,
            "SMTP_HOST": "smtp.example.com",
            "SMTP_USER": "sender@example.com",
            "SMTP_PASS": "password",
            "HUNYUAN_API_KEY": "model-key",
            "QQ_INGEST_SECRET": shared,
            "QQ_ADMIN_SECRET": shared,
            "QQ_ALLOWED_GROUP_IDS": "group-id",
            "QQ_REVIEW_OWNER_ACTOR_ID": "openid-admin",
            "WEB_PUBLIC_BASE_URL": "http://example.com",
            "QQ_REVIEW_CONFIDENCE": "0.9",
            "QQ_AUTO_PUBLISH_CONFIDENCE": "0.8",
        }
        issues = validate_config(environment, "cloud")
        messages = " ".join(entry["message"] for entry in issues if entry["level"] == "error")
        self.assertIn("must differ", messages)
        self.assertIn("HTTPS", messages)
        self.assertIn("review < auto-publish", messages)


if __name__ == "__main__":
    unittest.main()
