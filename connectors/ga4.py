"""GA4(Google Analytics 4) 커넥터 — 서비스 계정 인증으로 Data API 조회.
매체(media)가 아닌 전환 소스(conversion source)이므로 광고매체 커넥터 매트릭스에는 노출하지 않고
conversion_settings.config에 저장된 자격증명으로만 조회한다."""
import json
import time
import urllib.request
import urllib.error
from .base import MediaConnector

TOKEN_URL = "https://oauth2.googleapis.com/token"
DATA_API_BASE = "https://analyticsdata.googleapis.com/v1beta"
SCOPE = "https://www.googleapis.com/auth/analytics.readonly"


def _get_access_token(service_account_json: str) -> str:
    """서비스 계정 JSON으로 JWT(RS256) 생성 후 access_token 교환. 실패 시 빈 문자열."""
    import jwt  # PyJWT[crypto] — requirements.txt 참고
    try:
        sa = json.loads(service_account_json)
        client_email = sa["client_email"]
        private_key = sa["private_key"]
    except Exception:
        return ""

    now = int(time.time())
    claim = {
        "iss": client_email,
        "scope": SCOPE,
        "aud": TOKEN_URL,
        "exp": now + 3600,
        "iat": now,
    }
    try:
        assertion = jwt.encode(claim, private_key, algorithm="RS256")
    except Exception:
        return ""

    body = (
        f"grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion={assertion}"
    ).encode("utf-8")
    req = urllib.request.Request(
        TOKEN_URL, data=body, method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            resp = json.loads(r.read().decode("utf-8"))
            return resp.get("access_token", "")
    except Exception:
        return ""


class GA4Connector(MediaConnector):
    key = "ga4"; label = "Google Analytics 4"
    region = "글로벌"; category = "전환 소스"

    @property
    def credential_fields(self):
        return [
            {"key": "propertyId", "label": "GA4 속성 ID", "type": "text",
             "placeholder": "예: 123456789"},
            {"key": "serviceAccountJson", "label": "서비스 계정 JSON 키", "type": "textarea",
             "placeholder": '{"type": "service_account", "client_email": "...", "private_key": "...", ...}'},
        ]

    def healthcheck(self, token=None):
        return {"reachable": False, "httpStatus": None, "tokenValid": False,
                "apiMessage": "전환 소스 — 매체 커넥터 매트릭스 대상 아님",
                "graphVersion": "-", "authType": "service_account",
                "region": self.region, "category": self.category}

    def fetch_daily_metrics(self, creds: dict, from_date: str, to_date: str) -> list:
        """GA4 Data API에서 계정 전체 일별 전환수(conversions)를 조회.
        매체별 세분화 없음 — media 필드는 항상 'ga4' 고정."""
        property_id = (creds.get("propertyId") or "").strip()
        sa_json = creds.get("serviceAccountJson") or ""
        if not (property_id and sa_json):
            return []

        access_token = _get_access_token(sa_json)
        if not access_token:
            return []

        body = json.dumps({
            "dimensions": [{"name": "date"}],
            "metrics": [{"name": "conversions"}],
            "dateRanges": [{"startDate": from_date, "endDate": to_date}],
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{DATA_API_BASE}/properties/{property_id}:runReport",
            data=body, method="POST",
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {access_token}"})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read().decode("utf-8"))
        except Exception:
            return []

        out = []
        for row in (data.get("rows") or []):
            try:
                raw_date = row["dimensionValues"][0]["value"]  # YYYYMMDD
                value = int(row["metricValues"][0]["value"])
            except (KeyError, IndexError, ValueError):
                continue
            if len(raw_date) != 8:
                continue
            date = f"{raw_date[0:4]}-{raw_date[4:6]}-{raw_date[6:8]}"
            out.append({"date": date, "media": "ga4", "metric_key": "conv", "value": value})
        return out
