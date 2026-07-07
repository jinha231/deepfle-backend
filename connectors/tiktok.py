"""
TikTok for Business API 커넥터 — Long-term Access Token 인증.
https://business-api.tiktok.com/open_api/v1.3/
"""
import json, urllib.parse, urllib.request, urllib.error
from typing import List, Optional
from .base import MediaConnector, StandardCampaign

TT_BASE = "https://business-api.tiktok.com/open_api/v1.3"

_FIXTURE = [
    StandardCampaign("tt_c1", "MZ_챌린지", "ACTIVE", 680000, 1200000, 8200, 42, 180.0),
]


class TikTokConnector(MediaConnector):
    key      = "tiktok"
    label    = "TikTok for Business"
    region   = "글로벌"
    category = "숏폼 영상"

    @property
    def credential_fields(self):
        return [
            {"key": "access_token",  "label": "Access Token",   "type": "password",
             "placeholder": "TikTok for Business Long-term Access Token"},
            {"key": "advertiser_id", "label": "Advertiser ID",  "type": "text",
             "placeholder": "TikTok 광고계정 Advertiser ID (숫자)"},
        ]

    def oauth_url(self, redirect_uri: str, state: str = "") -> str:
        return (f"https://business-api.tiktok.com/portal/auth"
                f"?app_id=&state={state}&redirect_uri={urllib.parse.quote(redirect_uri)}")

    def healthcheck(self, token: Optional[str] = None) -> dict:
        params = urllib.parse.urlencode({"advertiser_id": "0"})
        req = urllib.request.Request(
            f"{TT_BASE}/advertiser/info/?{params}",
            headers={"Access-Token": token or "demo",
                     "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=8) as r:
                status = r.status
        except urllib.error.HTTPError as e:
            status = e.code
        except Exception:
            status = None
        reachable   = status is not None
        token_valid = status == 200
        return {"reachable": reachable, "httpStatus": status, "tokenValid": token_valid,
                "apiMessage": "OK" if token_valid else f"HTTP {status}",
                "graphVersion": "v1.3", "region": self.region, "category": self.category}

    def fetch_campaigns(self, ad_account_id: str, token: str) -> List[StandardCampaign]:
        return list(_FIXTURE)

    def fetch_daily_metrics(self, creds: dict, from_date: str, to_date: str) -> list:
        """TikTok Business API — 일별 cost/imp/click/conv."""
        token         = creds.get("access_token", "")
        advertiser_id = creds.get("advertiser_id", "")
        if not (token and advertiser_id):
            return []
        params = urllib.parse.urlencode({
            "advertiser_id": advertiser_id,
            "report_type":   "BASIC",
            "dimensions":    json.dumps(["stat_time_day"]),
            "metrics":       json.dumps(["spend", "impressions", "clicks", "conversion"]),
            "start_date":    from_date,
            "end_date":      to_date,
            "page_size":     1000,
        })
        req = urllib.request.Request(
            f"{TT_BASE}/report/integrated/get/?{params}",
            headers={"Access-Token": token, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                data = json.loads(r.read().decode())
        except (urllib.error.HTTPError, urllib.error.URLError, Exception):
            return []
        if data.get("code", -1) != 0:
            return []
        out = []
        for row in (data.get("data", {}).get("list") or []):
            date = (row.get("dimensions", {}).get("stat_time_day") or "")[:10]
            if not date:
                continue
            m = row.get("metrics", {})
            for mk, field in [("cost", "spend"), ("imp", "impressions"),
                               ("click", "clicks"), ("conv", "conversion")]:
                v = float(m.get(field, 0) or 0)
                out.append({"date": date, "media": "tiktok", "metric_key": mk,
                            "value": round(v, 2) if mk == "cost" else int(round(v))})
        return out


CONNECTOR = TikTokConnector()
