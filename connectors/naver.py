"""네이버 검색광고 커넥터 — 실제 API(HMAC 서명). 키는 환경변수 또는 전달된 creds에서 읽음."""
import os, time, hmac, hashlib, base64, json, datetime
import urllib.parse, urllib.request, urllib.error
from typing import List, Optional
from .base import MediaConnector, StandardCampaign

BASE = "https://api.searchad.naver.com"

def _env_keys():
    return (os.environ.get("NAVER_SA_API_KEY", ""),
            os.environ.get("NAVER_SA_SECRET_KEY", ""),
            os.environ.get("NAVER_SA_CUSTOMER_ID", ""))

# 하위호환: 이전 이름 유지
def _keys():
    return _env_keys()

class NaverSearchConnector(MediaConnector):
    key = "naver_sa"; label = "네이버 검색광고"
    region = "한국"; category = "검색"
    auth_type = "signed"
    # 네이버 검색광고는 광고주가 대행사 계정에 '권한 설정'으로 접근 권한을 위임하면,
    # 대행사 소유의 API Key/Secret 하나로 Customer ID만 바꿔서 여러 광고주 계정을 조회할 수 있다.
    # 그래서 API Key/Secret은 서버 환경변수(NAVER_SA_API_KEY/NAVER_SA_SECRET_KEY)로 전 계정 공용 설정하고,
    # 계정별로는 Customer ID만 입력받는다 (fetch_* 메서드들은 creds 우선, 없으면 환경변수로 폴백).
    guide = "API Key/Secret Key는 대행사 계정 기준으로 서버에 공용 설정되어 있습니다. 이 계정에서 조회할 네이버 검색광고 Customer ID만 입력하세요 (네이버 '권한 설정'으로 이 계정에 접근 권한이 위임되어 있어야 합니다)."

    @property
    def credential_fields(self):
        return [
            {"key": "customer_id", "label": "Customer ID", "type": "text", "placeholder": "광고주 고객번호 (예: 1234567)"},
        ]

    def _get_with_keys(self, uri, api_key, secret, customer):
        ts = str(int(time.time() * 1000))
        msg = f"{ts}.GET.{uri.split('?')[0]}"
        sig = base64.b64encode(hmac.new(secret.encode(), msg.encode(), hashlib.sha256).digest()).decode()
        req = urllib.request.Request(BASE + uri, headers={
            "X-Timestamp": ts, "X-API-KEY": api_key, "X-Customer": str(customer),
            "X-Signature": sig, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            return e.code, {"error": e.read().decode("utf-8", "replace")[:200]}
        except Exception as e:
            return None, {"error": str(e)}

    def _get(self, uri):
        api_key, secret, customer = _env_keys()
        if not (api_key and secret and customer):
            return None, {"error": "키 미설정"}
        return self._get_with_keys(uri, api_key, secret, customer)

    def oauth_url(self, redirect_uri, state=""): return ""

    def healthcheck(self, token=None):
        api_key, secret, customer = _keys()
        configured = bool(api_key and secret and customer)
        status, data = (self._get("/ncc/campaigns") if configured else (None, {}))
        msg = "키 미설정 (환경변수 필요)" if not configured else ("OK" if status == 200 else str(data.get("error", ""))[:80])
        # 도달성: 키가 있고 매체 API 서버가 실제로 응답(HTTP status 수신)했을 때만 True.
        # 키 미설정/네트워크 실패는 빨강으로 정확히 표시.
        reachable = configured and status is not None
        return {"reachable": reachable, "httpStatus": status, "tokenValid": status == 200,
                "apiMessage": msg, "graphVersion": "-", "authType": "signed",
                "region": self.region, "category": self.category}

    def _stat(self, cid):
        until = datetime.date.today(); since = until - datetime.timedelta(days=7)
        fields = '["impCnt","clkCnt","salesAmt","ccnt"]'
        tr = json.dumps({"since": str(since), "until": str(until)})
        uri = f"/stats?id={cid}&fields={urllib.parse.quote(fields)}&timeRange={urllib.parse.quote(tr)}"
        status, data = self._get(uri)
        if status == 200 and isinstance(data, dict) and data.get("data"):
            return data["data"][0]
        return {}

    def fetch_campaigns(self, ad_account_id, token) -> List[StandardCampaign]:
        status, camps = self._get("/ncc/campaigns")
        if status != 200 or not isinstance(camps, list):
            return []
        out = []
        for c in camps:
            cid = c.get("nccCampaignId", "")
            st = self._stat(cid)
            spend = int(st.get("salesAmt", 0)); click = int(st.get("clkCnt", 0)); conv = int(st.get("ccnt", 0))
            ctype = c.get("campaignType", "WEB_SITE")  # WEB_SITE|BRAND|SHOPPING|PLACE
            out.append(StandardCampaign(
                external_id=cid, name=c.get("name", ""),
                status="ACTIVE" if c.get("status") == "ELIGIBLE" else "PAUSED",
                spend=spend, impressions=int(st.get("impCnt", 0)),
                clicks=click, conversions=conv, roas=0.0, campaign_type=ctype))
        return out

    def fetch_daily_metrics(self, creds: dict, from_date: str, to_date: str) -> list:
        """일별 지표 조회 — 자격증명(creds) 우선, 없으면 환경변수 폴백."""
        api_key = creds.get("api_key") or os.environ.get("NAVER_SA_API_KEY", "")
        secret  = creds.get("secret_key") or os.environ.get("NAVER_SA_SECRET_KEY", "")
        customer = creds.get("customer_id") or os.environ.get("NAVER_SA_CUSTOMER_ID", "")
        if not (api_key and secret and customer):
            return []
        status, camps = self._get_with_keys("/ncc/campaigns", api_key, secret, customer)
        if status != 200 or not isinstance(camps, list):
            return []
        out = []
        for c in camps:
            cid = c.get("nccCampaignId", "")
            if not cid:
                continue
            fields = urllib.parse.quote('["impCnt","clkCnt","salesAmt","ccnt"]')
            tr = urllib.parse.quote(json.dumps({"since": from_date, "until": to_date}))
            uri = f"/stats?id={cid}&fields={fields}&timeRange={tr}&dateType=DAY"
            st, data = self._get_with_keys(uri, api_key, secret, customer)
            if st != 200 or not isinstance(data, dict):
                continue
            for row in (data.get("data") or []):
                dt = row.get("dt", "")
                if not dt:
                    continue
                mapping = [("imp", "impCnt"), ("click", "clkCnt"), ("cost", "salesAmt"), ("conv", "ccnt")]
                for mk, field in mapping:
                    out.append({"date": dt, "media": "naver_sa", "metric_key": mk, "value": int(row.get(field, 0))})
        return out

    def fetch_device_breakdown(self, creds: dict, from_date: str, to_date: str) -> list:
        """네이버 검색광고 — 디바이스별 지표 (device=PC|MOBILE)."""
        api_key = creds.get("api_key") or os.environ.get("NAVER_SA_API_KEY", "")
        secret  = creds.get("secret_key") or os.environ.get("NAVER_SA_SECRET_KEY", "")
        customer = creds.get("customer_id") or os.environ.get("NAVER_SA_CUSTOMER_ID", "")
        if not (api_key and secret and customer):
            return []
        out = []
        for device_code, device_label in [("PC", "desktop"), ("MOBILE", "mobile")]:
            fields = urllib.parse.quote('["impCnt","clkCnt","salesAmt","ccnt"]')
            tr = urllib.parse.quote(json.dumps({"since": from_date, "until": to_date}))
            uri = f"/stats?fields={fields}&timeRange={tr}&dateType=DAY&device={device_code}"
            st, data = self._get_with_keys(uri, api_key, secret, customer)
            if st != 200 or not isinstance(data, dict):
                continue
            for row in (data.get("data") or []):
                dt = row.get("dt", "")
                if not dt:
                    continue
                for mk, field in [("imp","impCnt"),("click","clkCnt"),
                                   ("cost","salesAmt"),("conv","ccnt")]:
                    out.append({"date": dt, "media_key": "naver_sa",
                                "device": device_label, "metric_key": mk,
                                "value": int(row.get(field, 0))})
        return out

    def fetch_product_breakdown(self, creds: dict, from_date: str, to_date: str) -> list:
        """네이버 검색광고 — 캠페인 타입별(파워링크/브랜드검색/쇼핑검색) 지표."""
        api_key = creds.get("api_key") or os.environ.get("NAVER_SA_API_KEY", "")
        secret  = creds.get("secret_key") or os.environ.get("NAVER_SA_SECRET_KEY", "")
        customer = creds.get("customer_id") or os.environ.get("NAVER_SA_CUSTOMER_ID", "")
        if not (api_key and secret and customer):
            return []
        st, camps = self._get_with_keys("/ncc/campaigns", api_key, secret, customer)
        if st != 200 or not isinstance(camps, list):
            return []
        out = []
        for c in camps:
            cid = c.get("nccCampaignId", "")
            ctype = c.get("campaignType", "WEB_SITE")
            if not cid:
                continue
            fields = urllib.parse.quote('["impCnt","clkCnt","salesAmt","ccnt"]')
            tr = urllib.parse.quote(json.dumps({"since": from_date, "until": to_date}))
            uri = f"/stats?id={cid}&fields={fields}&timeRange={tr}&dateType=DAY"
            st2, data = self._get_with_keys(uri, api_key, secret, customer)
            if st2 != 200 or not isinstance(data, dict):
                continue
            for row in (data.get("data") or []):
                dt = row.get("dt", "")
                if not dt:
                    continue
                for mk, field in [("imp","impCnt"),("click","clkCnt"),
                                   ("cost","salesAmt"),("conv","ccnt")]:
                    out.append({"date": dt, "media_key": "naver_sa",
                                "campaign_type": ctype, "metric_key": mk,
                                "value": int(row.get(field, 0))})
        return out