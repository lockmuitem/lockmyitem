import argparse
import json
import sys
import urllib.parse
import urllib.request


TOKEN_API = "https://api.weixin.qq.com/cgi-bin/token"
CODE_API = "https://api.weixin.qq.com/wxa/getwxacodeunlimit"


def request_json(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def request_bytes(url, payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        content = response.read()
        content_type = response.headers.get("Content-Type", "")
        return content_type, content


def main():
    parser = argparse.ArgumentParser(description="Generate official WeChat Mini Program QR code.")
    parser.add_argument("--appid", required=True, help="Mini Program AppID")
    parser.add_argument("--secret", required=True, help="Mini Program AppSecret")
    parser.add_argument("--page", default="pages/index/index", help="Mini Program page path")
    parser.add_argument("--scene", default="source=campus_promo", help="Scene string, max 32 visible chars")
    parser.add_argument("--output", default="shanghaitech-lost-found-qrcode.png", help="Output PNG path")
    args = parser.parse_args()

    token_query = urllib.parse.urlencode(
        {
            "grant_type": "client_credential",
            "appid": args.appid,
            "secret": args.secret,
        }
    )
    token = request_json(f"{TOKEN_API}?{token_query}")
    if "access_token" not in token:
        print(json.dumps(token, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1

    code_payload = {
        "scene": args.scene,
        "page": args.page,
        "check_path": False,
        "env_version": "release",
        "width": 430,
        "auto_color": False,
        "line_color": {"r": 15, "g": 118, "b": 110},
        "is_hyaline": False,
    }
    content_type, body = request_bytes(f"{CODE_API}?access_token={token['access_token']}", code_payload)
    if "application/json" in content_type:
        print(body.decode("utf-8"), file=sys.stderr)
        return 1

    with open(args.output, "wb") as file:
        file.write(body)
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
