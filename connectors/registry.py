"""
DeepFle 매체 커넥터 레지스트리 — 실제 광고 API를 제공하는 매체 정의.
각 항목의 api_base/health_path 는 실제 운영 엔드포인트이며, healthcheck가 실호출로 도달성을 검증한다.
"""
from .base import GenericConnector
from .meta import MetaConnector
from .google import GoogleAdsConnector


# ── 우선순위 매체 (구글은 풀 어댑터, 나머지 설정 기반) ──
PRIORITY = [
    MetaConnector(),
    GoogleAdsConnector(),
    GenericConnector(
        "kakao", "카카오모먼트", "https://apis.moment.kakao.com",
        health_path="/openapi/v4/adAccounts",
        oauth_auth="https://kauth.kakao.com/oauth/authorize",
        scope="moment", region="한국", category="SNS/디스플레이"),
    GenericConnector(
        "tiktok", "TikTok for Business", "https://business-api.tiktok.com",
        health_path="/open_api/v1.3/advertiser/info/",
        oauth_auth="https://business-api.tiktok.com/portal/auth",
        region="글로벌", category="숏폼 영상"),
]


# ── 추가 연동 가능 매체 (실제 광고 API 보유) ──
ADDITIONAL = [
    GenericConnector(
        "naver_sa", "네이버 검색광고", "https://api.searchad.naver.com",
        health_path="/ncc/campaigns", auth_type="signed", region="한국", category="검색",
        cred_fields=[
            {"key": "api_key",     "label": "API Key",     "type": "text",     "placeholder": "네이버 검색광고 API Key"},
            {"key": "secret_key",  "label": "Secret Key",  "type": "password", "placeholder": "Secret Key (HMAC 서명용)"},
            {"key": "customer_id", "label": "Customer ID", "type": "text",     "placeholder": "광고주/대행사 고객번호"},
        ]),
    GenericConnector(
        "naver_gfa", "네이버 성과형광고(GFA)", "https://gfaapi.naver.com",
        health_path="/", oauth_auth="https://nid.naver.com/oauth2.0/authorize",
        auth_type="oauth", region="한국", category="성과형 디스플레이",
        cred_fields=[
            {"key": "client_id",     "label": "Client ID",     "type": "text",     "placeholder": "네이버 GFA API Client ID"},
            {"key": "client_secret", "label": "Client Secret", "type": "password", "placeholder": "Client Secret"},
            {"key": "access_token",  "label": "Access Token",  "type": "password", "placeholder": "OAuth Access Token"},
            {"key": "customer_id",   "label": "광고주 ID",      "type": "text",     "placeholder": "GFA 광고주 계정 ID"},
        ]),
    GenericConnector(
        "apple_sa", "Apple Search Ads", "https://api.searchads.apple.com",
        health_path="/api/v5/acls", oauth_auth="https://appleid.apple.com/auth/authorize",
        auth_type="oauth", region="글로벌", category="앱 검색"),
    GenericConnector(
        "pinterest", "Pinterest Ads", "https://api.pinterest.com",
        health_path="/v5/user_account", oauth_auth="https://www.pinterest.com/oauth/",
        scope="ads:read", region="글로벌", category="이미지 발견"),
    GenericConnector(
        "x_ads", "X(Twitter) Ads", "https://ads-api.twitter.com",
        health_path="/12/accounts", auth_type="oauth1", region="글로벌", category="SNS"),
    GenericConnector(
        "criteo", "Criteo", "https://api.criteo.com",
        health_path="/2024-01/retail-media/accounts", oauth_auth="https://api.criteo.com/oauth2/token",
        auth_type="oauth", region="글로벌", category="리타겟팅"),
    GenericConnector(
        "msft", "Microsoft Ads (Bing)", "https://campaign.api.bingads.microsoft.com",
        health_path="/", oauth_auth="https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        scope="https://ads.microsoft.com/msads.manage", region="글로벌", category="검색"),
    GenericConnector(
        "snap", "Snapchat Ads", "https://adsapi.snapchat.com",
        health_path="/v1/me", oauth_auth="https://accounts.snapchat.com/login/oauth2/authorize",
        scope="snapchat-marketing-api", region="글로벌", category="숏폼/AR"),
    # ── 추가 한국/글로벌 매체 ──
    GenericConnector(
        "taboola", "Taboola", "https://backstage.taboola.com",
        health_path="/backstage/api/1.0/token-details/client",
        auth_type="oauth", region="글로벌", category="네이티브 광고",
        cred_fields=[
            {"key": "client_id",     "label": "Client ID",     "type": "text",     "placeholder": "Backstage API Client ID"},
            {"key": "client_secret", "label": "Client Secret", "type": "password", "placeholder": "Client Secret"},
            {"key": "account_id",    "label": "Account ID",    "type": "text",     "placeholder": "타불라 Advertiser Account ID"},
        ]),
    GenericConnector(
        "dable", "데이블(Dable)", "https://api.dable.io",
        health_path="/v1/ping",
        auth_type="apikey", region="한국/아시아", category="네이티브 광고",
        cred_fields=[
            {"key": "api_key",    "label": "API Key",  "type": "password", "placeholder": "데이블 API Key (계정매니저 제공)"},
            {"key": "account_id", "label": "Site ID",  "type": "text",     "placeholder": "site_id 또는 account_id"},
        ]),
    GenericConnector(
        "karrot", "당근마켓 광고", "https://ads-api.karrotmarket.com",
        health_path="/",
        oauth_auth="https://accounts.karrotmarket.com/oauth/authorize",
        auth_type="oauth", region="한국", category="지역 SNS",
        cred_fields=[
            {"key": "client_id",     "label": "Client ID",      "type": "text",     "placeholder": "당근 광고 Client ID"},
            {"key": "client_secret", "label": "Client Secret",  "type": "password", "placeholder": "Client Secret"},
            {"key": "access_token",  "label": "Access Token",   "type": "password", "placeholder": "OAuth Access Token"},
            {"key": "advertiser_id", "label": "광고주 ID",        "type": "text",     "placeholder": "Advertiser ID"},
        ]),
    GenericConnector(
        "coupang", "쿠팡 광고", "https://api.coupangads.com",
        health_path="/v1/health",
        auth_type="signed", region="한국", category="커머스 광고",
        cred_fields=[
            {"key": "access_key",  "label": "Access Key",  "type": "text",     "placeholder": "Coupang Ads Access Key"},
            {"key": "secret_key",  "label": "Secret Key",  "type": "password", "placeholder": "HMAC 서명용 Secret Key"},
            {"key": "customer_id", "label": "Customer ID", "type": "text",     "placeholder": "쿠팡 광고주 계정 ID"},
        ]),
    GenericConnector(
        "mobion", "모비온(Mobion)", "https://api.mobion.net",
        health_path="/",
        auth_type="apikey", region="한국", category="모바일 DSP",
        cred_fields=[
            {"key": "api_key",    "label": "API Key",  "type": "password", "placeholder": "모비온 API Key (계정팀 제공)"},
            {"key": "account_id", "label": "계정 ID",   "type": "text",     "placeholder": "모비온 Account ID"},
        ]),
    GenericConnector(
        "moloco", "몰로코(Moloco)", "https://api.moloco.com",
        health_path="/cm/v1/info",
        auth_type="apikey", region="글로벌", category="프로그래매틱 DSP",
        cred_fields=[
            {"key": "api_key",       "label": "API Key",       "type": "password", "placeholder": "Moloco API Key (대시보드 Settings > API)"},
            {"key": "ad_account_id", "label": "Ad Account ID", "type": "text",     "placeholder": "Moloco 광고계정 ID"},
        ]),
    GenericConnector(
        "kakao_sa", "카카오 키워드광고(SA)", "https://api.keywordad.kakao.com",
        health_path="/openapi/v1/account",
        oauth_auth="https://kauth.kakao.com/oauth/authorize",
        auth_type="oauth", region="한국", category="검색",
        cred_fields=[
            {"key": "client_id",     "label": "REST API 키",    "type": "text",     "placeholder": "카카오 앱 REST API 키"},
            {"key": "client_secret", "label": "Client Secret",  "type": "password", "placeholder": "Client Secret"},
            {"key": "access_token",  "label": "Access Token",   "type": "password", "placeholder": "OAuth Access Token"},
            {"key": "customer_id",   "label": "광고계정 ID",      "type": "text",     "placeholder": "카카오SA 광고계정 ID"},
        ]),
    GenericConnector(
        "buzzvil", "버즈빌(Buzzvil)", "https://api.buzzvil.com",
        health_path="/v1/status",
        auth_type="apikey", region="한국/글로벌", category="잠금화면 광고",
        cred_fields=[
            {"key": "api_key",    "label": "API Key",  "type": "password", "placeholder": "버즈빌 API Key"},
            {"key": "account_id", "label": "계정 ID",   "type": "text",     "placeholder": "버즈빌 Organization ID"},
        ]),
    GenericConnector(
        "inmobi", "인모비(InMobi)", "https://api.inmobi.com",
        health_path="/v3.0/user/login",
        oauth_auth="https://api.inmobi.com/v3.0/user/login",
        auth_type="oauth", region="글로벌", category="모바일 광고",
        cred_fields=[
            {"key": "client_id",     "label": "Client ID",     "type": "text",     "placeholder": "InMobi Client ID"},
            {"key": "client_secret", "label": "Client Secret", "type": "password", "placeholder": "Client Secret"},
            {"key": "account_id",    "label": "Account ID",    "type": "text",     "placeholder": "InMobi Account ID (숫자)"},
        ]),
]


ALL_CONNECTORS = {c.key: c for c in (PRIORITY + ADDITIONAL)}
