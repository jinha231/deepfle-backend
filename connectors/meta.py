"""
Meta(Facebook) Marketing API 커넥터 — 실제 Graph API v19.0 스펙 구현.

유효한 access_token 주입 시 실제 광고 데이터를 가져온다.
토큰이 없거나 무효이면 → 연결성(엔드포인트 도달)만 검증하고 fixture로 폴백.
표준 라이브러리 urllib 만 사용.
"""
import json
import os
import urllib.parse
import urllib.request
import urllib.error
from typing import List, Optional

from .base import MediaConnector, StandardCampaign, http_post

GRAPH_VERSION = "v19.0"
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_VERSION}"
OAUTH_DIALOG = f"https://www.facebook.com/{GRAPH_VERSION}/dialog/oauth"

# 운영 시 환경변수로 주입 (앱 심사 통과한 Meta 앱)
APP_ID = os.environ.get("META_APP_ID", "")
APP_SECRET = os.environ.get("META_APP_SECRET", "")


def _http_get(url: str, timeout: float = 8.0) -> tuple:
    """(status, json_dict) 반환. 네트워크 실패 시 (None, {error})."""
    req = urllib.request.Request(url, headers={"User-Agent": "DeepFle/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # 메타는 에러도 JSON으로 응답 (예: 토큰 무효 → code 190)
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            body = {"error": {"message": str(e)}}
        return e.code, body
    except Exception as e:
        return None, {"error": {"message": f"network: {e}"}}



class MetaConnector(MediaConnector):
    key = "meta"
    label = "Meta (Facebook/Instagram)"

    @property
    def credential_fields(self):
        return [
            {"key": "access_token",  "label": "Access Token",   "type": "password", "placeholder": "Meta 광고관리자 → 비즈니스 설정 → 시스템 사용자 토큰"},
            {"key": "ad_account_id", "label": "Ad Account ID",  "type": "text",     "placeholder": "act_XXXXXXXXXX (광고계정 ID)"},
        ]

    def oauth_url(self, redirect_uri: str, state: str = "") -> str:
        params = {
            "client_id": APP_ID or "YOUR_META_APP_ID",
            "redirect_uri": redirect_uri,
            "state": state,
            "scope": "ads_read,ads_management,business_management",
            "response_type": "code",
        }
        return f"{OAUTH_DIALOG}?{urllib.parse.urlencode(params)}"

    def exchange_code(self, code: str, redirect_uri: str) -> dict:
        params = {
            "client_id": APP_ID, "client_secret": APP_SECRET,
            "redirect_uri": redirect_uri, "code": code,
        }
        status, data = _http_get(f"{GRAPH_BASE}/oauth/access_token?{urllib.parse.urlencode(params)}")
        return data

    def healthcheck(self, token: Optional[str] = None) -> dict:
        """실제 Graph API 도달 여부 + 토큰 유효성 점검."""
        if token:
            status, data = _http_get(f"{GRAPH_BASE}/me?access_token={urllib.parse.quote(token)}")
        else:
            # 토큰 없이도 엔드포인트 도달 여부는 확인 (메타가 에러 JSON 반환 = 도달 성공)
            status, data = _http_get(f"{GRAPH_BASE}/me")
        reachable = status is not None
        err = (data or {}).get("error", {})
        token_valid = reachable and "error" not in (data or {})
        return {
            "reachable": reachable,            # graph.facebook.com 도달 여부
            "httpStatus": status,
            "tokenValid": token_valid,
            "apiMessage": err.get("message") if err else "OK",
            "graphVersion": GRAPH_VERSION,
        }

    def fetch_campaigns(self, ad_account_id: str, token: str) -> List[StandardCampaign]:
        """GET /act_{id}/campaigns + /insights → 표준 캠페인."""
        if not token:
            return []
        acct = ad_account_id if ad_account_id.startswith("act_") else f"act_{ad_account_id}"
        fields = "campaign_name,impressions,clicks,spend,actions,purchase_roas"
        url = (f"{GRAPH_BASE}/{acct}/insights?"
               f"{urllib.parse.urlencode({'fields': fields, 'level': 'campaign', 'access_token': token})}")
        status, data = _http_get(url)
        if status != 200 or "data" not in data:
            return []
        out = []
        for row in data["data"]:
            conv = 0
            for a in row.get("actions", []):
                if a.get("action_type") in ("purchase", "offsite_conversion.fb_pixel_purchase"):
                    conv += int(float(a.get("value", 0)))
            roas = 0.0
            if row.get("purchase_roas"):
                roas = float(row["purchase_roas"][0].get("value", 0)) * 100
            out.append(StandardCampaign(
                external_id=row.get("campaign_id", ""),
                name=row.get("campaign_name", ""),
                status="ACTIVE",
                spend=int(float(row.get("spend", 0))),
                impressions=int(row.get("impressions", 0)),
                clicks=int(row.get("clicks", 0)),
                conversions=conv,
                roas=round(roas, 1),
            ))
        return out

    # ── write 작업 (R4): 실제 Graph API POST. 토큰 없으면 시뮬레이션 ──
    def set_status(self, external_id: str, status: str, token: str) -> dict:
        # 실제: POST graph.facebook.com/v19.0/{campaign_id}  body: status=PAUSED|ACTIVE
        if not token:
            return {"ok": True, "simulated": True, "action": "set_status",
                    "status": status, "id": external_id, "endpoint": f"{GRAPH_BASE}/{external_id}"}
        status_code, data = http_post(f"{GRAPH_BASE}/{external_id}",
                                      {"status": status, "access_token": token})
        return {"ok": status_code == 200, "simulated": False, "httpStatus": status_code,
                "action": "set_status", "status": status, "id": external_id, "apiResponse": data}

    def pause_campaign(self, external_id: str, token: str) -> dict:
        return self.set_status(external_id, "PAUSED", token)

    def update_budget(self, external_id: str, daily_budget: int, token: str) -> dict:
        # 실제: POST graph.facebook.com/v19.0/{adset_id}  body: daily_budget (단위: cents)
        if not token:
            return {"ok": True, "simulated": True, "action": "update_budget",
                    "budget": daily_budget, "id": external_id, "endpoint": f"{GRAPH_BASE}/{external_id}"}
        status_code, data = http_post(f"{GRAPH_BASE}/{external_id}",
                                      {"daily_budget": daily_budget, "access_token": token})
        return {"ok": status_code == 200, "simulated": False, "httpStatus": status_code,
                "action": "update_budget", "budget": daily_budget, "id": external_id, "apiResponse": data}

    def fetch_daily_metrics(self, creds: dict, from_date: str, to_date: str) -> list:
        """Meta Insights API — 일별 cost/imp/click/conv 수집."""
        token = creds.get("access_token", "")
        ad_account = creds.get("ad_account_id", "")
        if not (token and ad_account):
            return []
        acct = ad_account if ad_account.startswith("act_") else f"act_{ad_account}"
        time_range = urllib.parse.quote(json.dumps({"since": from_date, "until": to_date}))
        fields = "spend,impressions,clicks,actions"
        url = (f"{GRAPH_BASE}/{acct}/insights?"
               f"fields={fields}&time_range={time_range}&time_increment=1"
               f"&level=account&access_token={urllib.parse.quote(token)}")
        status, data = _http_get(url)
        if status != 200 or "data" not in data:
            return []
        out = []
        for row in data.get("data", []):
            date = row.get("date_start", "")
            if not date:
                continue
            conv = sum(
                int(float(a.get("value", 0)))
                for a in row.get("actions", [])
                if a.get("action_type") in ("purchase", "offsite_conversion.fb_pixel_purchase")
            )
            for mk, v in [
                ("cost",  round(float(row.get("spend", 0) or 0), 2)),
                ("imp",   int(row.get("impressions", 0) or 0)),
                ("click", int(row.get("clicks", 0) or 0)),
                ("conv",  conv),
            ]:
                out.append({"date": date, "media": "meta", "metric_key": mk, "value": v})
        return out

    def fetch_device_breakdown(self, creds: dict, from_date: str, to_date: str) -> list:
        """Meta Insights — 디바이스별 일별 지표.
        실 API: breakdown=device_platform (mobile_app|mobile_web|desktop)"""
        token = creds.get("access_token", "")
        ad_account = creds.get("ad_account_id", "")
        if not (token and ad_account):
            return []
        acct = ad_account if ad_account.startswith("act_") else f"act_{ad_account}"
        time_range = urllib.parse.quote(json.dumps({"since": from_date, "until": to_date}))
        url = (f"{GRAPH_BASE}/{acct}/insights?"
               f"fields=spend,impressions,clicks,actions"
               f"&time_range={time_range}&time_increment=1&level=account"
               f"&breakdowns=device_platform&access_token={urllib.parse.quote(token)}")
        status, data = _http_get(url)
        if status != 200 or "data" not in data:
            return []
        out = []
        device_map = {"mobile_app": "mobile", "mobile_web": "mobile", "desktop": "desktop"}
        for row in data.get("data", []):
            date = row.get("date_start", "")
            raw_device = row.get("device_platform", "unknown")
            device = device_map.get(raw_device, raw_device)
            conv = sum(int(float(a.get("value", 0))) for a in row.get("actions", [])
                       if a.get("action_type") in ("purchase", "offsite_conversion.fb_pixel_purchase"))
            for mk, v in [("cost", round(float(row.get("spend", 0) or 0), 2)),
                           ("imp",  int(row.get("impressions", 0) or 0)),
                           ("click",int(row.get("clicks", 0) or 0)), ("conv", conv)]:
                out.append({"date": date, "media_key": "meta", "device": device,
                            "metric_key": mk, "value": v})
        return out

    def fetch_product_breakdown(self, creds: dict, from_date: str, to_date: str) -> list:
        """Meta Insights — 캠페인 objective(상품유형)별 일별 지표."""
        token = creds.get("access_token", "")
        ad_account = creds.get("ad_account_id", "")
        if not (token and ad_account):
            return []
        acct = ad_account if ad_account.startswith("act_") else f"act_{ad_account}"
        time_range = urllib.parse.quote(json.dumps({"since": from_date, "until": to_date}))
        url = (f"{GRAPH_BASE}/{acct}/campaigns?"
               f"fields=id,objective&access_token={urllib.parse.quote(token)}")
        _, camp_data = _http_get(url)
        obj_map = {c["id"]: c.get("objective", "UNKNOWN") for c in camp_data.get("data", [])}

        url2 = (f"{GRAPH_BASE}/{acct}/insights?"
                f"fields=campaign_id,spend,impressions,clicks,actions"
                f"&time_range={time_range}&time_increment=1&level=campaign"
                f"&access_token={urllib.parse.quote(token)}")
        status, data = _http_get(url2)
        if status != 200 or "data" not in data:
            return []
        out = []
        for row in data.get("data", []):
            date = row.get("date_start", "")
            objective = obj_map.get(row.get("campaign_id", ""), "UNKNOWN")
            conv = sum(int(float(a.get("value", 0))) for a in row.get("actions", [])
                       if a.get("action_type") in ("purchase", "offsite_conversion.fb_pixel_purchase"))
            for mk, v in [("cost", round(float(row.get("spend", 0) or 0), 2)),
                           ("imp",  int(row.get("impressions", 0) or 0)),
                           ("click",int(row.get("clicks", 0) or 0)), ("conv", conv)]:
                out.append({"date": date, "media_key": "meta", "campaign_type": objective,
                            "metric_key": mk, "value": v})
        return out


# 커넥터 레지스트리 (R2: meta만, 이후 google/kakao/naver 추가)
CONNECTORS = {
    "meta": MetaConnector(),
}
