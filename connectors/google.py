"""
Google Ads API 커넥터 — 실제 REST(v18) + OAuth2 스펙.
googleads.googleapis.com / accounts.google.com
"""
import os, json, urllib.parse, urllib.request, urllib.error
from typing import List, Optional
from .base import MediaConnector, StandardCampaign, http_get

API_VERSION = "v18"
ADS_BASE = f"https://googleads.googleapis.com/{API_VERSION}"
OAUTH_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
OAUTH_TOKEN = "https://oauth2.googleapis.com/token"

CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
DEV_TOKEN = os.environ.get("GOOGLE_DEVELOPER_TOKEN", "")


class GoogleAdsConnector(MediaConnector):
    key = "google"
    label = "Google Ads"

    @property
    def credential_fields(self):
        return [
            {"key": "developer_token", "label": "Developer Token", "type": "password", "placeholder": "Google Ads API Developer Token"},
            {"key": "client_id",       "label": "Client ID",       "type": "text",     "placeholder": "Google Cloud OAuth Client ID"},
            {"key": "client_secret",   "label": "Client Secret",   "type": "password", "placeholder": "Client Secret"},
            {"key": "refresh_token",   "label": "Refresh Token",   "type": "password", "placeholder": "OAuth Refresh Token"},
            {"key": "customer_id",     "label": "Customer ID",     "type": "text",     "placeholder": "Google Ads 계정 ID (하이픈 제외, 예: 1234567890)"},
        ]

    def oauth_url(self, redirect_uri: str, state: str = "") -> str:
        p = {"client_id": CLIENT_ID or "YOUR_GOOGLE_CLIENT_ID", "redirect_uri": redirect_uri,
             "response_type": "code", "access_type": "offline", "prompt": "consent",
             "scope": "https://www.googleapis.com/auth/adwords", "state": state}
        return f"{OAUTH_AUTH}?{urllib.parse.urlencode(p)}"

    def exchange_code(self, code: str, redirect_uri: str) -> dict:
        # 실제로는 POST. 데모 환경에선 구조만 (토큰 교환 엔드포인트 명시)
        return {"_endpoint": OAUTH_TOKEN, "_note": "POST grant_type=authorization_code"}

    def healthcheck(self, token: Optional[str] = None) -> dict:
        # googleads.googleapis.com 도달성 (인증 없이 요청 → 401/403 = 도달 성공)
        status, data = http_get(f"{ADS_BASE}/customers:listAccessibleCustomers")
        reachable = status is not None
        err = (data or {}).get("error", {})
        msg = err.get("message") if isinstance(err, dict) else str(err)
        return {"reachable": reachable, "httpStatus": status,
                "tokenValid": bool(token) and status == 200,
                "apiMessage": msg or "OK", "graphVersion": API_VERSION}

    def _get_access_token(self, creds: dict) -> str:
        """refresh_token으로 access_token 발급."""
        refresh_token = creds.get("refresh_token", "")
        client_id = creds.get("client_id", "") or CLIENT_ID
        client_secret = creds.get("client_secret", "")
        if not (refresh_token and client_id and client_secret):
            return ""
        body = urllib.parse.urlencode({
            "grant_type": "refresh_token",
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
        }).encode()
        req = urllib.request.Request(
            OAUTH_TOKEN, data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return json.loads(r.read().decode()).get("access_token", "")
        except Exception:
            return ""

    def fetch_campaigns(self, ad_account_id: str, token: str) -> List[StandardCampaign]:
        if not token:
            return []
        status, data = http_get(
            f"{ADS_BASE}/customers/{ad_account_id}/googleAds:searchStream",
            headers={"Authorization": f"Bearer {token}", "developer-token": DEV_TOKEN})
        if status != 200:
            return []
        return []  # 정규화 로직 — 실 토큰 확보 시 구현

    def fetch_daily_metrics(self, creds: dict, from_date: str, to_date: str) -> list:
        """Google Ads Reporting API — 일별 cost/imp/click/conv 수집 (GAQL)."""
        dev_token = creds.get("developer_token", "") or DEV_TOKEN
        customer_id = (creds.get("customer_id", "") or "").replace("-", "")
        if not (dev_token and customer_id):
            return []
        access_token = self._get_access_token(creds)
        if not access_token:
            return []
        query = (
            f"SELECT segments.date, metrics.cost_micros, metrics.impressions, "
            f"metrics.clicks, metrics.conversions FROM customer "
            f"WHERE segments.date BETWEEN '{from_date}' AND '{to_date}'"
        )
        body = json.dumps({"query": query}).encode()
        req = urllib.request.Request(
            f"{ADS_BASE}/customers/{customer_id}/googleAds:search",
            data=body,
            headers={
                "Authorization": f"Bearer {access_token}",
                "developer-token": dev_token,
                "Content-Type": "application/json",
            })
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read().decode())
        except (urllib.error.HTTPError, urllib.error.URLError, Exception):
            return []
        out = []
        for row in data.get("results", []):
            date = row.get("segments", {}).get("date", "")
            if not date:
                continue
            m = row.get("metrics", {})
            cost = round(int(m.get("costMicros", 0) or 0) / 1_000_000, 2)
            for mk, v in [
                ("cost",  cost),
                ("imp",   int(m.get("impressions", 0) or 0)),
                ("click", int(m.get("clicks", 0) or 0)),
                ("conv",  int(float(m.get("conversions", 0) or 0))),
            ]:
                out.append({"date": date, "media": "google", "metric_key": mk, "value": v})
        return out


    def fetch_device_breakdown(self, creds: dict, from_date: str, to_date: str) -> list:
        """Google Ads GAQL — segments.device 브레이크다운."""
        dev_token = creds.get("developer_token", "") or DEV_TOKEN
        customer_id = (creds.get("customer_id", "") or "").replace("-", "")
        if not (dev_token and customer_id):
            return []
        access_token = self._get_access_token(creds)
        if not access_token:
            return []
        query = (
            f"SELECT segments.date, segments.device, metrics.cost_micros, "
            f"metrics.impressions, metrics.clicks, metrics.conversions FROM customer "
            f"WHERE segments.date BETWEEN '{from_date}' AND '{to_date}'"
        )
        body = json.dumps({"query": query}).encode()
        req = urllib.request.Request(
            f"{ADS_BASE}/customers/{customer_id}/googleAds:search", data=body,
            headers={"Authorization": f"Bearer {access_token}",
                     "developer-token": dev_token, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read().decode())
        except Exception:
            return []
        device_map = {"DESKTOP": "desktop", "MOBILE": "mobile",
                      "TABLET": "tablet", "CONNECTED_TV": "ctv"}
        out = []
        for row in data.get("results", []):
            date = row.get("segments", {}).get("date", "")
            raw_dev = row.get("segments", {}).get("device", "")
            device = device_map.get(raw_dev, raw_dev.lower())
            m = row.get("metrics", {})
            cost = round(int(m.get("costMicros", 0) or 0) / 1_000_000, 2)
            for mk, v in [("cost", cost), ("imp", int(m.get("impressions", 0) or 0)),
                          ("click", int(m.get("clicks", 0) or 0)),
                          ("conv", int(float(m.get("conversions", 0) or 0)))]:
                out.append({"date": date, "media_key": "google", "device": device,
                            "metric_key": mk, "value": v})
        return out

    def fetch_product_breakdown(self, creds: dict, from_date: str, to_date: str) -> list:
        """Google Ads GAQL — campaign.advertising_channel_type 브레이크다운."""
        dev_token = creds.get("developer_token", "") or DEV_TOKEN
        customer_id = (creds.get("customer_id", "") or "").replace("-", "")
        if not (dev_token and customer_id):
            return []
        access_token = self._get_access_token(creds)
        if not access_token:
            return []
        query = (
            f"SELECT segments.date, campaign.advertising_channel_type, "
            f"metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions "
            f"FROM campaign WHERE segments.date BETWEEN '{from_date}' AND '{to_date}'"
        )
        body = json.dumps({"query": query}).encode()
        req = urllib.request.Request(
            f"{ADS_BASE}/customers/{customer_id}/googleAds:search", data=body,
            headers={"Authorization": f"Bearer {access_token}",
                     "developer-token": dev_token, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read().decode())
        except Exception:
            return []
        out = []
        for row in data.get("results", []):
            date = row.get("segments", {}).get("date", "")
            ctype = row.get("campaign", {}).get("advertisingChannelType", "UNKNOWN")
            m = row.get("metrics", {})
            cost = round(int(m.get("costMicros", 0) or 0) / 1_000_000, 2)
            for mk, v in [("cost", cost), ("imp", int(m.get("impressions", 0) or 0)),
                          ("click", int(m.get("clicks", 0) or 0)),
                          ("conv", int(float(m.get("conversions", 0) or 0)))]:
                out.append({"date": date, "media_key": "google", "campaign_type": ctype,
                            "metric_key": mk, "value": v})
        return out


CONNECTOR = GoogleAdsConnector()
