"""
카카오 모먼트 API 커넥터 — OAuth Bearer token 인증.
https://apis.moment.kakao.com/openapi/v4/
"""
import json, urllib.parse, urllib.request, urllib.error
from typing import List, Optional
from .base import MediaConnector, StandardCampaign

MOMENT_BASE = "https://apis.moment.kakao.com"
OAUTH_AUTH  = "https://kauth.kakao.com/oauth/authorize"

_FIXTURE = [
    StandardCampaign("kakao_c1", "비즈보드_메인", "ACTIVE", 3800000, 1900000, 22000, 310, 290.0, campaign_type="BIZBOARD"),
    StandardCampaign("kakao_c2", "채널_메시지",   "ACTIVE", 1200000,  600000,  9000, 140, 360.0, campaign_type="CHANNEL_MSG"),
]

_DEVICE_SPLIT  = {"mobile": 0.85, "desktop": 0.15}
_PRODUCT_SPLIT = {"BIZBOARD": 0.76, "CHANNEL_MSG": 0.24}


class KakaoMomentConnector(MediaConnector):
    key      = "kakao"
    label    = "카카오모먼트"
    region   = "한국"
    category = "SNS/디스플레이"

    @property
    def credential_fields(self):
        return [
            {"key": "access_token",  "label": "Access Token",  "type": "password",
             "placeholder": "카카오 광고 OAuth Access Token (카카오 비즈니스 센터에서 발급)"},
            {"key": "ad_account_id", "label": "Ad Account ID", "type": "text",
             "placeholder": "카카오모먼트 광고계정 ID (숫자)"},
        ]

    def oauth_url(self, redirect_uri: str, state: str = "") -> str:
        params = {"client_id": "", "redirect_uri": redirect_uri,
                  "response_type": "code", "scope": "moment", "state": state}
        return f"{OAUTH_AUTH}?{urllib.parse.urlencode(params)}"

    def healthcheck(self, token: Optional[str] = None) -> dict:
        req = urllib.request.Request(
            f"{MOMENT_BASE}/openapi/v4/adAccounts",
            headers={"Authorization": f"Bearer {token or 'demo'}",
                     "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=8) as r:
                status = r.status
        except urllib.error.HTTPError as e:
            status = e.code
        except Exception:
            status = None
        reachable    = status is not None
        token_valid  = status == 200
        return {"reachable": reachable, "httpStatus": status, "tokenValid": token_valid,
                "apiMessage": "OK" if token_valid else f"HTTP {status}",
                "graphVersion": "v4", "region": self.region, "category": self.category}

    def fetch_campaigns(self, ad_account_id: str, token: str) -> List[StandardCampaign]:
        return list(_FIXTURE)

    def fetch_daily_metrics(self, creds: dict, from_date: str, to_date: str) -> list:
        """카카오모먼트 성과 API — 일별 cost/imp/click/conv."""
        token        = creds.get("access_token", "")
        ad_account_id = creds.get("ad_account_id", "")
        if not (token and ad_account_id):
            return []
        params = urllib.parse.urlencode({
            "startDate":     from_date,
            "endDate":       to_date,
            "dateGroupUnit": "DAY",
            "metricsGroups": "BASIC",
        })
        url = f"{MOMENT_BASE}/openapi/v4/adAccounts/{ad_account_id}/reports/stats?{params}"
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                data = json.loads(r.read().decode())
        except (urllib.error.HTTPError, urllib.error.URLError, Exception):
            return []
        out = []
        for row in (data.get("content") or []):
            date = row.get("reportedDate", "")
            if not date:
                continue
            conv = (int(row.get("convPurchaseCnt", 0) or 0)
                    + int(row.get("convSignUpCnt", 0) or 0))
            for mk, v in [
                ("cost",  int(row.get("cost", 0) or 0)),
                ("imp",   int(row.get("impCnt", 0) or 0)),
                ("click", int(row.get("clkCnt", 0) or 0)),
                ("conv",  conv),
            ]:
                out.append({"date": date, "media": "kakao", "metric_key": mk, "value": v})
        return out


    def fetch_device_breakdown(self, creds: dict, from_date: str, to_date: str) -> list:
        """카카오모먼트 — 디바이스별 일별 지표 (deviceTypes 파라미터)."""
        token = creds.get("access_token", "")
        ad_account_id = creds.get("ad_account_id", "")
        if not (token and ad_account_id):
            return []
        out = []
        for device_code, device_label in [("MOBILE", "mobile"), ("PC", "desktop")]:
            params = urllib.parse.urlencode({
                "startDate": from_date, "endDate": to_date,
                "dateGroupUnit": "DAY", "metricsGroups": "BASIC",
                "deviceTypes": device_code,
            })
            url = f"{MOMENT_BASE}/openapi/v4/adAccounts/{ad_account_id}/reports/stats?{params}"
            req = urllib.request.Request(url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=10) as r:
                    data = json.loads(r.read().decode())
            except Exception:
                continue
            for row in (data.get("content") or []):
                date = row.get("reportedDate", "")
                if not date:
                    continue
                conv = (int(row.get("convPurchaseCnt", 0) or 0)
                        + int(row.get("convSignUpCnt", 0) or 0))
                for mk, v in [("cost", int(row.get("cost", 0) or 0)),
                               ("imp",  int(row.get("impCnt", 0) or 0)),
                               ("click",int(row.get("clkCnt", 0) or 0)),
                               ("conv", conv)]:
                    out.append({"date": date, "media_key": "kakao",
                                "device": device_label, "metric_key": mk, "value": v})
        return out

    def fetch_product_breakdown(self, creds: dict, from_date: str, to_date: str) -> list:
        """카카오모먼트 — 광고 유형(campaign_type)별 일별 지표."""
        token = creds.get("access_token", "")
        ad_account_id = creds.get("ad_account_id", "")
        if not (token and ad_account_id):
            return []
        params = urllib.parse.urlencode({
            "startDate": from_date, "endDate": to_date,
            "dateGroupUnit": "DAY", "metricsGroups": "BASIC",
        })
        url = (f"{MOMENT_BASE}/openapi/v4/adAccounts/{ad_account_id}/campaigns?"
               f"fields=id,campaignType")
        req = urllib.request.Request(url,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                camp_data = json.loads(r.read().decode())
        except Exception:
            return []
        camp_type_map = {c["id"]: c.get("campaignType", "UNKNOWN")
                        for c in (camp_data.get("content") or [])}
        url2 = f"{MOMENT_BASE}/openapi/v4/adAccounts/{ad_account_id}/reports/stats?{params}&groupBy=CAMPAIGN"
        req2 = urllib.request.Request(url2,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req2, timeout=10) as r:
                data = json.loads(r.read().decode())
        except Exception:
            return []
        out = []
        for row in (data.get("content") or []):
            date = row.get("reportedDate", "")
            ctype = camp_type_map.get(str(row.get("campaignId", "")), "UNKNOWN")
            if not date:
                continue
            conv = (int(row.get("convPurchaseCnt", 0) or 0)
                    + int(row.get("convSignUpCnt", 0) or 0))
            for mk, v in [("cost", int(row.get("cost", 0) or 0)),
                           ("imp",  int(row.get("impCnt", 0) or 0)),
                           ("click",int(row.get("clkCnt", 0) or 0)),
                           ("conv", conv)]:
                out.append({"date": date, "media_key": "kakao",
                            "campaign_type": ctype, "metric_key": mk, "value": v})
        return out


CONNECTOR = KakaoMomentConnector()
