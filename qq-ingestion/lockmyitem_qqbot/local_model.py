import base64
import json
import mimetypes
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


SENSITIVE_WORDS = (
    "身份证", "护照", "银行卡", "信用卡", "借记卡", "医保卡", "社保卡", "驾驶证",
    "学生证", "工作证", "工卡", "校园卡", "一卡通", "饭卡", "门禁卡", "证件",
)
IMPORTANT_WORDS = (
    "钱包", "手机", "耳机", "airpods", "平板", "电脑", "相机", "手表", "钥匙", "鼠标", "耳机盒",
)


def image_data_url(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def parse_json_content(content: Any) -> dict[str, Any]:
    if isinstance(content, dict):
        return content
    if isinstance(content, list):
        content = "".join(str(part.get("text", "")) if isinstance(part, dict) else str(part) for part in content)
    text = str(content or "").strip()
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, flags=re.IGNORECASE)
    if fenced:
        text = fenced.group(1).strip()
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("混元没有返回可解析的 JSON")
        value = json.loads(text[start:end + 1])
    if not isinstance(value, dict):
        raise ValueError("混元 JSON 顶层必须是对象")
    return value


def _clean(value: Any, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def mask_sensitive_text(value: Any) -> str:
    text = str(value or "")
    patterns = (
        r"\b\d{6}(?:18|19|20)?\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b",
        r"(?<!\d)1[3-9]\d{9}(?!\d)",
        r"((?:身份证|学生证|工作证|工卡|校园卡|一卡通|饭卡|银行卡|信用卡|借记卡|护照|证件|卡)(?:号|号码|编号)?|工号|学号|证号)\s*(?:[:：#]|为|是)?\s*[A-Za-z0-9-]{6,24}",
        r"(?:\d[\s-]?){12,19}",
    )
    for pattern in patterns:
        text = re.sub(pattern, "", text, flags=re.IGNORECASE)
    text = re.sub(r"((?:持卡人|姓名|名字|姓名信息))\s*(?:[:：#]|为|是)?\s*[\u4e00-\u9fa5]{2,4}", r"\1", text)
    return _clean(text, 500)


def normalize_analysis(raw: dict[str, Any], fallback_text: str = "") -> dict[str, Any]:
    try:
        confidence = min(1.0, max(0.0, float(raw.get("confidence", raw.get("score", 0)))))
    except (TypeError, ValueError):
        confidence = 0.0
    analysis = {
        "isLostFound": raw.get("isLostFound", raw.get("relevant", True)) is not False,
        "confidence": confidence,
        "type": "lost" if raw.get("type") == "lost" else "found",
        "title": mask_sensitive_text(_clean(raw.get("title") or raw.get("itemName") or "QQ群失物招领", 80)),
        "description": mask_sensitive_text(_clean(raw.get("description") or fallback_text or "来自QQ群的失物招领线索", 500)),
        "category": _clean(raw.get("category") or "其他", 30),
        "locationRaw": mask_sensitive_text(_clean(raw.get("locationRaw") or raw.get("rawLocation"), 160)),
        "locationName": mask_sensitive_text(_clean(raw.get("locationName") or raw.get("normalizedLocation") or raw.get("locationRaw"), 80)),
        "occurredAtText": _clean(raw.get("occurredAtText") or raw.get("timeText"), 80),
        "sensitivityLevel": str(raw.get("sensitivityLevel") or "normal").lower(),
        "aiTags": [_clean(item, 30) for item in (raw.get("aiTags") or []) if _clean(item, 30)][:10],
        "modelReason": mask_sensitive_text(_clean(raw.get("reason") or raw.get("modelReason"), 240)),
    }
    source = " ".join(str(analysis.get(key) or "") for key in ("title", "description", "category")).lower()
    if any(word in source for word in SENSITIVE_WORDS):
        analysis["sensitivityLevel"] = "sensitive"
    elif analysis["sensitivityLevel"] != "sensitive" and any(word in source for word in IMPORTANT_WORDS):
        analysis["sensitivityLevel"] = "important"
    elif analysis["sensitivityLevel"] not in {"important", "sensitive"}:
        analysis["sensitivityLevel"] = "normal"
    return analysis


def route_analysis(analysis: dict[str, Any], source_mode: str, medium: float = 0.45, high: float = 0.8) -> str:
    if source_mode == "loose_images":
        return "needs_review"
    if not analysis.get("isLostFound") or float(analysis.get("confidence") or 0) < medium:
        return "ignored"
    protected = analysis.get("sensitivityLevel") in {"important", "sensitive"}
    location = analysis.get("locationName") or analysis.get("locationRaw")
    if float(analysis.get("confidence") or 0) >= high and analysis.get("title") and location and not protected:
        return "publish_candidate"
    return "needs_review"


def build_prompt(text: str, sent_at: str) -> str:
    return "\n".join((
        "你是校园失物招领结构化助手。结合群消息文字与图片，判断是否为真实失物/招领线索。",
        "只返回 JSON：isLostFound, confidence(0-1), type(found/lost), title, description, category, locationRaw, locationName, occurredAtText, sensitivityLevel(normal/important/sensitive), aiTags, reason。",
        "locationRaw 保留原文地点，locationName 规范为校园建筑或区域；无法确定时留空。",
        "校园卡、银行卡、证件、带姓名学号的纸张为 sensitive；手机、耳机、AirPods、钱包、钥匙、鼠标、耳机盒等贵重物品为 important；其余普通物品为 normal。",
        "不要抄录姓名、学号、卡号、手机号、二维码内容或任何唯一编号。",
        f"群消息：{str(text or '')[:1200] or '（无文字，仅有图片）'}",
        f"发送时间：{str(sent_at or '')[:80] or '未知'}",
    ))


class HunyuanLocalClient:
    def __init__(self, api_key: str | None = None, base_url: str | None = None, model: str | None = None):
        self.api_key = (api_key or os.getenv("HUNYUAN_API_KEY", "")).strip()
        if not self.api_key:
            raise RuntimeError("缺少 HUNYUAN_API_KEY；请写入本地 .env，不要提交到 Git")
        self.base_url = (base_url or os.getenv("HUNYUAN_BASE_URL", "https://api.hunyuan.cloud.tencent.com/v1")).rstrip("/")
        if urlparse(self.base_url).scheme != "https":
            raise RuntimeError("HUNYUAN_BASE_URL 必须使用 HTTPS，避免 API 密钥明文传输")
        self.model = (model or os.getenv("HUNYUAN_MODEL", "hunyuan-vision")).strip()

    def analyze(self, text: str, sent_at: str, image_paths: list[Path]) -> dict[str, Any]:
        max_bytes = int(os.getenv("HUNYUAN_MAX_BATCH_IMAGE_BYTES", str(8 * 1024 * 1024)))
        if sum(path.stat().st_size for path in image_paths[:6]) > max_bytes:
            raise RuntimeError("图片批次超过 HUNYUAN_MAX_BATCH_IMAGE_BYTES，请拆分或压缩后重试")
        content = [
            {"type": "image_url", "image_url": {"url": image_data_url(path)}}
            for path in image_paths[:6]
        ]
        content.append({"type": "text", "text": build_prompt(text, sent_at)})
        body = json.dumps({
            "model": self.model,
            "messages": [{"role": "user", "content": content}],
            "temperature": 0.1,
        }, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=body,
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read(500).decode("utf-8", errors="replace")
            raise RuntimeError(f"混元请求失败 HTTP {error.code}: {detail}") from error
        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError("混元响应缺少 choices")
        return normalize_analysis(parse_json_content(choices[0].get("message", {}).get("content")))
