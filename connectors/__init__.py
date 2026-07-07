"""DeepFle 매체 커넥터 패키지 — 통합 레지스트리."""
from .registry import ALL_CONNECTORS, PRIORITY, ADDITIONAL
from .naver  import NaverSearchConnector
from .meta   import MetaConnector
from .google import GoogleAdsConnector
from .kakao  import KakaoMomentConnector
from .tiktok import TikTokConnector

# GenericConnector 대신 실 API 구현체로 교체
ALL_CONNECTORS["naver_sa"] = NaverSearchConnector()
ALL_CONNECTORS["meta"]     = MetaConnector()
ALL_CONNECTORS["google"]   = GoogleAdsConnector()
ALL_CONNECTORS["kakao"]    = KakaoMomentConnector()
ALL_CONNECTORS["tiktok"]   = TikTokConnector()

CONNECTORS = ALL_CONNECTORS

def get_connector(media_key):
    return ALL_CONNECTORS.get(media_key)