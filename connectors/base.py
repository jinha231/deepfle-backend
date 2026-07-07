"""
DeepFle 매체 커넥터 — 공통 인터페이스 (플러그인 추상화)

새 매체 추가 = 이 인터페이스를 구현한 어댑터 1개 작성.
각 어댑터는 동일한 표준 형태(StandardCampaign)로 정규화해 반환한다.
"""
import json
import urllib.request
import urllib.error
from dataclasses import dataclass, asdict
from typing import List, Optional


def http_get(url: str, headers: dict = None, timeout: float = 8.0) -> tuple:
    """공유 HTTP GET. (status, json_dict) 반환. 매체 API 도달성 검증에 사용."""
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "DeepFle/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            try:
                return r.status, json.loads(raw)
            except Exception:
                return r.status, {"_raw": raw[:300]}
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8", "replace"))
        except Exception:
            return e.code, {"error": {"message": str(e)}}
    except Exception as e:
        return None, {"error": {"message": f"network: {e}"}}


def http_post(url: str, data: dict = None, headers: dict = None, timeout: float = 8.0) -> tuple:
    """공유 HTTP POST (form-urlencoded). 매체 API write 작업(상태/예산 변경)에 사용."""
    import urllib.parse
    body = urllib.parse.urlencode(data or {}).encode("utf-8")
    h = {"User-Agent": "DeepFle/1.0", "Content-Type": "application/x-www-form-urlencoded"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=body, headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            try:
                return r.status, json.loads(raw)
            except Exception:
                return r.status, {"_raw": raw[:300]}
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8", "replace"))
        except Exception:
            return e.code, {"error": {"message": str(e)}}
    except Exception as e:
        return None, {"error": {"message": f"network: {e}"}}


@dataclass
class StandardCampaign:
    """매체 무관 표준 캠페인 모델 (대시보드/규칙 엔진이 소비)."""
    external_id: str
    name: str
    status: str          # ACTIVE | PAUSED | ...
    spend: int           # KRW
    impressions: int
    clicks: int
    conversions: int
    roas: float          # %
    campaign_type: str = ""  # SEARCH|DISPLAY|SHOPPING|PMAX|BIZBOARD|CONVERSION|AWARENESS|...

    def to_dict(self):
        return asdict(self)


class MediaConnector:
    """모든 매체 커넥터가 따르는 인터페이스."""
    key: str = "base"          # meta | google | kakao | naver
    label: str = "Base"

    @property
    def credential_fields(self) -> list:
        """UI 렌더링용 자격증명 필드 스키마 [{key, label, type, placeholder}]."""
        return []

    def fetch_daily_metrics(self, creds: dict, from_date: str, to_date: str) -> list:
        """실 API에서 일별 지표를 가져온다. [{date, media, metric_key, value}] 반환.
        실패 시 빈 리스트 → 백엔드가 시드 폴백 사용."""
        return []

    def fetch_device_breakdown(self, creds: dict, from_date: str, to_date: str) -> list:
        """디바이스별 일별 지표. [{date, media_key, device, metric_key, value}] 반환.
        device: pc|mobile|tablet|ctv"""
        return []

    def fetch_product_breakdown(self, creds: dict, from_date: str, to_date: str) -> list:
        """상품유형(campaign_type)별 일별 지표.
        [{date, media_key, campaign_type, metric_key, value}] 반환."""
        return []

    def oauth_url(self, redirect_uri: str, state: str = "") -> str:
        """사용자 동의를 받을 OAuth 인가 URL."""
        raise NotImplementedError

    def exchange_code(self, code: str, redirect_uri: str) -> dict:
        """authorization code → access token 교환."""
        raise NotImplementedError

    def fetch_campaigns(self, ad_account_id: str, token: str) -> List[StandardCampaign]:
        """실제 매체 API에서 캠페인+성과를 가져와 표준 모델로 정규화."""
        raise NotImplementedError

    # 토큰/네트워크 가용성 점검 — 실제 호출 전 연결성 확인용
    def healthcheck(self, token: Optional[str] = None) -> dict:
        raise NotImplementedError

    # ── write 작업 (R4): 규칙 엔진이 호출 ──
    def pause_campaign(self, external_id: str, token: str) -> dict:
        return {"ok": True, "simulated": True, "action": "pause", "id": external_id}

    def set_status(self, external_id: str, status: str, token: str) -> dict:
        return {"ok": True, "simulated": True, "action": "set_status", "status": status, "id": external_id}

    def update_budget(self, external_id: str, daily_budget: int, token: str) -> dict:
        return {"ok": True, "simulated": True, "action": "update_budget",
                "budget": daily_budget, "id": external_id}


class GenericConnector(MediaConnector):
    """설정 기반 범용 커넥터 — 실제 API 베이스 도달성 검증 + OAuth URL + fixture.
    메타/구글 같은 풀 어댑터의 경량 버전. 새 매체를 빠르게 편입할 때 사용."""

    def __init__(self, key, label, api_base, health_path="/",
                 oauth_auth=None, scope="", auth_type="oauth",
                 region="글로벌", category="", fixture=None, extra_headers=None,
                 cred_fields=None):
        self.key = key
        self.label = label
        self.api_base = api_base.rstrip("/")
        self.health_path = health_path
        self.oauth_auth = oauth_auth
        self.scope = scope
        self.auth_type = auth_type        # oauth | apikey | signed
        self.region = region
        self._cred_fields = cred_fields or []
        self.category = category
        self._fixture = fixture or []
        self.extra_headers = extra_headers or {}

    def oauth_url(self, redirect_uri: str, state: str = "") -> str:
        if not self.oauth_auth:
            return ""   # API 키/서명 방식은 OAuth 없음
        import urllib.parse
        p = {"redirect_uri": redirect_uri, "state": state, "response_type": "code"}
        if self.scope:
            p["scope"] = self.scope
        return f"{self.oauth_auth}?{urllib.parse.urlencode(p)}"

    def exchange_code(self, code: str, redirect_uri: str) -> dict:
        return {"_note": f"{self.label} 토큰 교환 ({self.auth_type})"}

    def healthcheck(self, token: Optional[str] = None) -> dict:
        headers = dict(self.extra_headers)
        if token:
            headers["Authorization"] = f"Bearer {token}"
        status, data = http_get(self.api_base + self.health_path, headers=headers or None)
        reachable = status is not None
        msg = "OK"
        if isinstance(data, dict):
            err = data.get("error") or data.get("message") or data.get("_raw")
            if isinstance(err, dict):
                msg = err.get("message", str(err))[:160]
            elif err:
                msg = str(err)[:160]
        return {"reachable": reachable, "httpStatus": status,
                "tokenValid": bool(token) and status == 200,
                "apiMessage": msg, "graphVersion": "-",
                "authType": self.auth_type, "region": self.region, "category": self.category}

    @property
    def credential_fields(self) -> list:
        return self._cred_fields

    def fetch_campaigns(self, ad_account_id: str, token: str) -> List[StandardCampaign]:
        return list(self._fixture)   # 토큰 확보 시 매체별 정규화 로직 주입
