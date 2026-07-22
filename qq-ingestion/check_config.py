import argparse
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlparse


def load_env_file(path: Path) -> None:
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip().strip('"').strip("'")
        if name:
            os.environ.setdefault(name, value)


def _is_https(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.netloc)


def validate_config(environment: dict[str, str], scope: str = "all") -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []

    def value(name: str) -> str:
        return str(environment.get(name, "") or "").strip()

    def error(name: str, message: str) -> None:
        issues.append({"level": "error", "name": name, "message": message})

    def warning(name: str, message: str) -> None:
        issues.append({"level": "warning", "name": name, "message": message})

    def require(name: str) -> str:
        current = value(name)
        if not current:
            error(name, "missing")
        return current

    if scope in {"listener", "bot", "all"}:
        require("QQ_BOT_APP_ID")
        require("QQ_BOT_SECRET")
        require("QQ_GROUP_ID")
        if scope in {"bot", "all"}:
            ingest_url = require("LOCKMYITEM_INGEST_URL")
            ingest_secret = require("QQ_INGEST_SECRET")
            if ingest_url and not _is_https(ingest_url):
                error("LOCKMYITEM_INGEST_URL", "must be an HTTPS CloudBase HTTP trigger")
            if ingest_secret and len(ingest_secret) < 32:
                error("QQ_INGEST_SECRET", "must contain at least 32 characters")
        try:
            window = float(value("QQ_AGGREGATION_SECONDS") or "45")
            if not 30 <= window <= 60:
                error("QQ_AGGREGATION_SECONDS", "must be between 30 and 60 seconds")
        except ValueError:
            error("QQ_AGGREGATION_SECONDS", "must be numeric")
        suffixes = [entry.strip() for entry in (value("QQ_IMAGE_HOST_SUFFIXES") or "qpic.cn,qq.com,gtimg.cn").split(",")]
        if any(not suffix or "*" in suffix or "://" in suffix or "/" in suffix for suffix in suffixes):
            error("QQ_IMAGE_HOST_SUFFIXES", "must contain comma-separated hostname suffixes without wildcards")

    if scope in {"cloud", "all"}:
        token_secret = value("AUTH_TOKEN_SECRET") or value("LOCKMYITEM_AUTH_SECRET")
        if not token_secret:
            error("AUTH_TOKEN_SECRET", "missing (LOCKMYITEM_AUTH_SECRET is also accepted)")
        elif len(token_secret) < 32:
            error("AUTH_TOKEN_SECRET", "must contain at least 32 characters")

        smtp_names = ("SMTP_HOST", "SMTP_USER", "SMTP_PASS")
        for name in smtp_names:
            require(name)

        api_key = value("HUNYUAN_API_KEY") or value("TENCENTCLOUD_API_KEY") or value("TENCENT_HUNYUAN_API_KEY") or value("MODEL_API_KEY")
        secret_id = value("TENCENTCLOUD_SECRET_ID") or value("TENCENT_SECRET_ID")
        secret_key = value("TENCENTCLOUD_SECRET_KEY") or value("TENCENT_SECRET_KEY")
        if not api_key and not (secret_id and secret_key):
            error("HUNYUAN_CREDENTIALS", "configure an API key or Tencent Cloud SecretId + SecretKey")

        ingest_secret = require("QQ_INGEST_SECRET")
        admin_secret = require("QQ_ADMIN_SECRET")
        if ingest_secret and len(ingest_secret) < 32:
            error("QQ_INGEST_SECRET", "must contain at least 32 characters")
        if admin_secret and len(admin_secret) < 32:
            error("QQ_ADMIN_SECRET", "must contain at least 32 characters")
        if ingest_secret and admin_secret and ingest_secret == admin_secret:
            error("QQ_ADMIN_SECRET", "must differ from QQ_INGEST_SECRET")
        require("QQ_ALLOWED_GROUP_IDS")
        review_owner_actor = value("QQ_REVIEW_OWNER_ACTOR_ID")
        review_owner_email = value("QQ_REVIEW_OWNER_EMAIL").lower()
        email_domain = (value("AUTH_EMAIL_DOMAIN") or "shanghaitech.edu.cn").lower()
        if not review_owner_actor and not review_owner_email:
            error("QQ_REVIEW_OWNER", "configure QQ_REVIEW_OWNER_EMAIL or QQ_REVIEW_OWNER_ACTOR_ID")
        if review_owner_email and ("@" not in review_owner_email or not review_owner_email.endswith(f"@{email_domain}")):
            error("QQ_REVIEW_OWNER_EMAIL", f"must use @{email_domain}")
        if review_owner_actor and review_owner_email and "@" in review_owner_email:
            derived_actor = f"email:{hashlib.sha256(review_owner_email.encode('utf-8')).hexdigest()}"
            if review_owner_actor != derived_actor:
                error("QQ_REVIEW_OWNER_ACTOR_ID", "must match the actor derived from QQ_REVIEW_OWNER_EMAIL, or be omitted")
        public_url = require("WEB_PUBLIC_BASE_URL")
        if public_url and not _is_https(public_url):
            error("WEB_PUBLIC_BASE_URL", "must be an HTTPS public site URL")

        try:
            medium = float(value("QQ_REVIEW_CONFIDENCE") or "0.45")
            high = float(value("QQ_AUTO_PUBLISH_CONFIDENCE") or "0.8")
            if not 0 <= medium < high <= 1:
                error("QQ_CONFIDENCE_THRESHOLDS", "must satisfy 0 <= review < auto-publish <= 1")
        except ValueError:
            error("QQ_CONFIDENCE_THRESHOLDS", "must be numeric")

        if not value("SMTP_FROM"):
            warning("SMTP_FROM", "not set; SMTP_USER will be used as sender")

    if scope == "local":
        require("HUNYUAN_API_KEY")
        base_url = value("HUNYUAN_BASE_URL") or "https://api.hunyuan.cloud.tencent.com/v1"
        if not _is_https(base_url):
            error("HUNYUAN_BASE_URL", "must use HTTPS")

    return issues


def sdk_status() -> dict[str, str]:
    try:
        import botpy
        from botpy.message import GroupMessage

        if not hasattr(botpy, "Client") or not hasattr(botpy, "Intents") or not hasattr(GroupMessage, "reply"):
            return {"level": "error", "name": "qq-botpy", "message": "installed SDK lacks required interfaces"}
        return {"level": "ok", "name": "qq-botpy", "message": "required interfaces available"}
    except Exception:
        return {"level": "error", "name": "qq-botpy", "message": "not installed; run pip install -r requirements.txt"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate LockMyItem QQ bot and CloudBase configuration without printing secrets")
    parser.add_argument("--scope", choices=("listener", "bot", "cloud", "local", "all"), default="all")
    parser.add_argument("--env-file", type=Path)
    args = parser.parse_args()
    if args.env_file:
        load_env_file(args.env_file)
    findings = validate_config(dict(os.environ), args.scope)
    if args.scope in {"listener", "bot", "all"}:
        findings.append(sdk_status())
    errors = [entry for entry in findings if entry["level"] == "error"]
    report = {
        "ok": not errors,
        "scope": args.scope,
        "errorCount": len(errors),
        "warningCount": len([entry for entry in findings if entry["level"] == "warning"]),
        "findings": findings,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["ok"] else 2)
