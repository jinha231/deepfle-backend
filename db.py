"""
DeepFle 백엔드 — SQLite 스키마 정의 및 시드 데이터
Python 표준 라이브러리 sqlite3 만으로 동작.
"""
import sqlite3
import os
from auth import hash_password

DB_PATH = os.path.join(os.path.dirname(__file__), "deepfle.db")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK(role IN ('master','user','advertiser')),
    avatar_color  TEXT DEFAULT '#94A3B8',
    last_login    TEXT,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT DEFAULT (datetime('now'))
);

-- ───────── R1: 워크스페이스 (멀티테넌시 최상위) ─────────
CREATE TABLE IF NOT EXISTS workspaces (
    id          TEXT PRIMARY KEY,          -- ws_xxxxx
    name        TEXT NOT NULL,
    owner_id    TEXT REFERENCES users(id),
    plan        TEXT DEFAULT 'full',       -- 라이센스 제거: 항상 full
    created_at  TEXT DEFAULT (datetime('now'))
);

-- 사용자 × 워크스페이스 멤버십 (워크스페이스 접근 권한)
CREATE TABLE IF NOT EXISTS workspace_members (
    ws_id       TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK(role IN ('master','user','advertiser')),
    PRIMARY KEY (ws_id, user_id)
);

-- 광고주 계정 (워크스페이스 하위)
CREATE TABLE IF NOT EXISTS accounts (
    id          TEXT PRIMARY KEY,
    ws_id       TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    advertiser  TEXT,
    color       TEXT DEFAULT '#4F46E5',
    memo        TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
);

-- 실제 매체 광고계정 연결 (R1 핵심)
CREATE TABLE IF NOT EXISTS ad_accounts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ws_id        TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    account_id   TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    media        TEXT NOT NULL,            -- meta|google|kakao|naver|tiktok
    external_id  TEXT,                     -- 매체측 광고계정 ID
    account_name TEXT,
    status       TEXT NOT NULL DEFAULT 'connected',  -- connected|disconnected|error|pending
    last_sync    TEXT
);

-- 외부 연동 (GA4 · Cafe24 · MMP · SNS)
CREATE TABLE IF NOT EXISTS integrations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ws_id        TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    type         TEXT NOT NULL,            -- ga4|cafe24|mmp|sns
    name         TEXT,
    status       TEXT NOT NULL DEFAULT 'connected',
    connected_at TEXT DEFAULT (datetime('now'))
);

-- 사용자 × 계정 권한 매핑 (계정별 역할 차등 지원 — Phase 8 본격화)
CREATE TABLE IF NOT EXISTS user_accounts (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK(role IN ('master','user','advertiser')),
    PRIMARY KEY (user_id, account_id)
);

CREATE TABLE IF NOT EXISTS media (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    color       TEXT,
    spend       INTEGER DEFAULT 0,
    imp         INTEGER DEFAULT 0,
    click       INTEGER DEFAULT 0,
    cvr         INTEGER DEFAULT 0,
    roas        INTEGER DEFAULT 0,
    cpa         INTEGER DEFAULT 0,
    is_on       INTEGER NOT NULL DEFAULT 1,
    connected   INTEGER NOT NULL DEFAULT 1,
    last_sync   TEXT
);

CREATE TABLE IF NOT EXISTS rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    level       TEXT,
    schedule    TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    last_run    TEXT
);

-- 불변 감사 로그 (Phase 8 본격화, 구조는 지금 마련)
CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  TEXT,
    user_id     TEXT,
    user_name   TEXT,
    role        TEXT,
    action      TEXT NOT NULL,
    detail      TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
);

-- ───────── Phase 6: 데이터 파이프라인 ─────────
-- 매체 동기화 작업 이력
CREATE TABLE IF NOT EXISTS sync_jobs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id   TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'running',  -- running|done|error
    media_count  INTEGER DEFAULT 0,
    started_at   TEXT DEFAULT (datetime('now')),
    finished_at  TEXT
);

-- 어트리뷰션: 클릭 기록 (추적 링크 클릭 시 click_id 발급)
CREATE TABLE IF NOT EXISTS attr_clicks (
    click_id    TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL,
    link_name   TEXT,
    media       TEXT,
    ts          TEXT DEFAULT (datetime('now'))
);

-- 어트리뷰션: 전환 포스트백 (click_id 매핑 + 디듑)
CREATE TABLE IF NOT EXISTS attr_conversions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    click_id    TEXT NOT NULL,
    account_id  TEXT NOT NULL,
    value       INTEGER DEFAULT 0,
    dedup_key   TEXT UNIQUE,           -- 동일 전환 중복집계 방지
    ts          TEXT DEFAULT (datetime('now'))
);

-- ───────── Phase 7: 자동화 안전장치 ─────────
-- 규칙 실행 이력 (변경 전 스냅샷 보관 → undo 가능)
CREATE TABLE IF NOT EXISTS rule_executions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id     INTEGER NOT NULL,
    account_id  TEXT NOT NULL,
    mode        TEXT NOT NULL,         -- dryrun|live
    affected    TEXT,                  -- JSON: 영향받은 매체와 before/after
    undone      INTEGER NOT NULL DEFAULT 0,
    executed_at TEXT DEFAULT (datetime('now'))
);

-- ───────── Phase 8: 운영 신뢰성 ─────────
-- 알림 (규칙 실패·예산 소진 등 → 이메일/슬랙 발송 큐)
CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  TEXT NOT NULL,
    level       TEXT NOT NULL DEFAULT 'info',  -- info|warning|error
    channel     TEXT,                          -- email|slack
    title       TEXT NOT NULL,
    message     TEXT,
    read        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
);

-- ───────── Ph E: 누적 store + 리포트 설정 ─────────
CREATE TABLE IF NOT EXISTS metric_data (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,              -- YYYY-MM-DD
    media       TEXT NOT NULL,              -- meta|google|naver_sa|kakao|...
    metric_key  TEXT NOT NULL,              -- cost|imp|click|conv|revenue
    value       REAL NOT NULL DEFAULT 0,
    UNIQUE(account_id, date, media, metric_key)
);

CREATE TABLE IF NOT EXISTS report_config (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name          TEXT NOT NULL DEFAULT '기본 리포트',
    columns_json  TEXT,                     -- JSON: 선택된 컬럼 목록
    media_json    TEXT,                     -- JSON: 선택된 매체 목록
    update_cycle  TEXT NOT NULL DEFAULT 'manual', -- manual|daily|weekly
    last_pull     TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS report_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    config_id     INTEGER REFERENCES report_config(id),
    file_name     TEXT,
    period_from   TEXT,
    period_to     TEXT,
    status        TEXT NOT NULL DEFAULT 'done',  -- done|error
    created_at    TEXT DEFAULT (datetime('now'))
);

-- ───────── 설정: 전환설정 (계정별 전환 출처/네이밍 매핑) ─────────
CREATE TABLE IF NOT EXISTS conversion_settings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    source          TEXT NOT NULL,              -- ga4|acecounter|airbridge|adjust|appsflyer|manual
    source_metric   TEXT,                       -- 출처 지표명 (예: purchase, 주문완료)
    solution_metric TEXT NOT NULL,              -- 솔루션 지표명 (사용자 지정: 구매/가입/DB)
    value_type      TEXT NOT NULL DEFAULT 'count', -- count|currency|rate
    config          TEXT,                       -- JSON: property id/api key/token 등
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- ───────── 설정: 매체연동 (계정별 매체 제공지표 → 솔루션 표준명 매핑) ─────────
CREATE TABLE IF NOT EXISTS media_metric_map (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    media           TEXT NOT NULL,              -- meta|google|naver_sa|kakao|...
    metric_key      TEXT NOT NULL,              -- imp|click|cost|cpc|cpm
    provider_field  TEXT,                       -- 매체 제공 필드명
    solution_name   TEXT NOT NULL,              -- 솔루션 표준명
    active          INTEGER NOT NULL DEFAULT 1,
    UNIQUE(account_id, media, metric_key)
);

-- ───────── 매체 API 자격증명 (계정별, JSON 저장) ─────────
CREATE TABLE IF NOT EXISTS media_credentials (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    media       TEXT NOT NULL,              -- meta|google|naver_sa|taboola|...
    creds_json  TEXT NOT NULL DEFAULT '{}', -- JSON: {access_token, api_key, ...}
    updated_at  TEXT DEFAULT (datetime('now')),
    UNIQUE(account_id, media)
);

-- ───────── 캠페인 (매체 플랫폼 하위 단위) ─────────
CREATE TABLE IF NOT EXISTS campaigns (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    media_key     TEXT NOT NULL,              -- meta|google|naver_sa|kakao|tiktok
    campaign_id   TEXT,                       -- 매체 캠페인 고유 ID
    name          TEXT NOT NULL,
    campaign_type TEXT,                       -- SEARCH|DISPLAY|SHOPPING|PMAX|BIZBOARD|...
    status        TEXT DEFAULT 'ACTIVE',      -- ACTIVE|PAUSED|ENDED
    spend         INTEGER DEFAULT 0,
    imp           INTEGER DEFAULT 0,
    click         INTEGER DEFAULT 0,
    cvr           INTEGER DEFAULT 0,
    roas          INTEGER DEFAULT 0,
    cpa           INTEGER DEFAULT 0,
    is_on         INTEGER DEFAULT 1,
    last_sync     TEXT,
    UNIQUE(account_id, media_key, name)
);

-- ───────── 캠페인 일별 지표 (디바이스·상품유형 브레이크다운) ─────────
CREATE TABLE IF NOT EXISTS campaign_metrics (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id    TEXT NOT NULL,
    date          TEXT NOT NULL,              -- YYYY-MM-DD
    media_key     TEXT NOT NULL,              -- meta|google|naver_sa|kakao|tiktok
    device        TEXT NOT NULL DEFAULT 'all', -- pc|mobile|tablet|ctv|all
    campaign_type TEXT NOT NULL DEFAULT 'all', -- SEARCH|DISPLAY|PMAX|BIZBOARD|all
    metric_key    TEXT NOT NULL,              -- cost|imp|click|conv
    value         REAL NOT NULL DEFAULT 0,
    UNIQUE(account_id, date, media_key, device, campaign_type, metric_key)
);

-- ───────── 광고 계층 성과 (캠페인·광고그룹·키워드·소재·디바이스 일별) ─────────
CREATE TABLE IF NOT EXISTS ad_hierarchy (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id    TEXT NOT NULL,
    date          TEXT NOT NULL,
    media_key     TEXT NOT NULL,
    campaign      TEXT NOT NULL DEFAULT '',
    campaign_type TEXT NOT NULL DEFAULT '',
    adgroup       TEXT NOT NULL DEFAULT '',
    keyword       TEXT NOT NULL DEFAULT '',
    creative      TEXT NOT NULL DEFAULT '',
    device        TEXT NOT NULL DEFAULT 'all',
    cost          REAL    NOT NULL DEFAULT 0,
    imp           INTEGER NOT NULL DEFAULT 0,
    click         INTEGER NOT NULL DEFAULT 0,
    conv          REAL    NOT NULL DEFAULT 0,
    conv_native   REAL    NOT NULL DEFAULT 0,
    conv_ga4      REAL    NOT NULL DEFAULT 0,
    conv_mmp      REAL    NOT NULL DEFAULT 0,
    conv_manual   REAL    NOT NULL DEFAULT 0,
    UNIQUE(account_id, date, media_key, campaign, adgroup, keyword, creative, device)
);

-- ───────── 수기 매체 Raw 업로드 데이터 (CSV 업로드로 적재) ─────────
CREATE TABLE IF NOT EXISTS manual_metrics (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    date          TEXT NOT NULL,
    media         TEXT NOT NULL,
    campaign      TEXT NOT NULL DEFAULT '',
    adgroup       TEXT NOT NULL DEFAULT '',
    keyword       TEXT NOT NULL DEFAULT '',
    creative      TEXT NOT NULL DEFAULT '',
    campaign_type TEXT NOT NULL DEFAULT '',
    device        TEXT NOT NULL DEFAULT '',
    cost          REAL    NOT NULL DEFAULT 0,
    imp           INTEGER NOT NULL DEFAULT 0,
    click         INTEGER NOT NULL DEFAULT 0,
    conv_native   REAL    NOT NULL DEFAULT 0,
    conv_ga4      REAL    NOT NULL DEFAULT 0,
    conv_mmp      REAL    NOT NULL DEFAULT 0,
    conv_manual   REAL    NOT NULL DEFAULT 0,
    UNIQUE(account_id, date, media, campaign, adgroup, keyword, creative, campaign_type, device)
);
"""

# 일일 자동변경 상한 (계정당 하루 최대 자동 변경 횟수)
DAILY_CHANGE_LIMIT = 10

# ── 시드 데이터 ──
SEED_USERS = [
    # id,        name,   email,              role,     color,     password
    ("u_master", "관리자", "admin@deepfle.io", "master", "#7C3AED", "admin123"),
]

# 워크스페이스 (멀티테넌시 루트)
SEED_WORKSPACES = [
    ("ws_main", "내 워크스페이스", "u_master"),
]

# 워크스페이스 멤버십
SEED_WS_MEMBERS = [
    ("ws_main", "u_master", "master"),
]

# 광고주 계정 — 초기 빈 상태 (로그인 후 계정 관리에서 직접 생성)
SEED_ACCOUNTS = []

# 실제 매체 광고계정 연결 — 초기 빈 상태 (설정 > 매체 연동에서 등록)
SEED_AD_ACCOUNTS = []

# 외부 연동 — 초기 빈 상태
SEED_INTEGRATIONS = []

# 사용자 × 계정 권한 매핑 — 초기 빈 상태
SEED_USER_ACCOUNTS = []

# 매체 플랫폼 시드 — 각 행은 매체 플랫폼 단위 (캠페인명이 아님)
# (name, color, spend, imp, click, cvr, roas, cpa, is_on, connected, media_key)
MEDIA_TEMPLATE = [
    ("카카오모먼트",   "#FFE300", 12400000, 4200000, 68000, 1420, 520, 8732,  1, 1, "kakao"),
    ("네이버 검색광고","#03C75A", 9800000,  2800000, 54000, 980,  380, 10000, 1, 1, "naver_sa"),
    ("구글 Ads",       "#4285F4", 7200000,  5100000, 72000, 820,  410, 8780,  1, 1, "google"),
    ("메타(페이스북)", "#1877F2", 6500000,  3400000, 48000, 540,  340, 12037, 1, 1, "meta"),
    ("틱톡",           "#000000", 680000,   1200000, 8200,  42,   180, 16190, 0, 0, "tiktok"),
    ("당근마켓",       "#FF7E36", 140000,   210000,  3200,  15,   150, 9333,  0, 0, "karrot"),
    ("유튜브",         "#FF0000", 380000,   520000,  4800,  28,   210, 13571, 0, 0, "youtube"),
    ("네이버 쇼핑",    "#00C73C", 1800000,  890000,  14000, 198,  480, 9090,  0, 0, "naver_shopping"),
    ("카카오 비즈보드","#F7E600", 3800000,  1900000, 22000, 310,  290, 12258, 1, 1, "kakao_biz"),
]

# 캠페인 시드 — campaign_type으로 매체 내 세부 구성상품 구분
# (account_id, media_key, campaign_id, name, campaign_type, status, spend, imp, click, cvr, roas, cpa, is_on)
SEED_CAMPAIGNS = []

# 디바이스별 집계 비율 (device breakdown seed 생성용)
DEVICE_SPLITS = {
    "meta":     {"mobile": 0.75, "desktop": 0.25},
    "google":   {"mobile": 0.60, "desktop": 0.35, "tablet": 0.05},
    "naver_sa": {"mobile": 0.55, "desktop": 0.45},
    "kakao":    {"mobile": 0.85, "desktop": 0.15},
    "tiktok":   {"mobile": 1.00},
}

# 상품유형별 집계 비율 (campaign_type breakdown seed 생성용)
PRODUCT_TYPE_SPLITS = {
    "meta":     {"CONVERSION": 0.55, "AWARENESS": 0.30, "TRAFFIC": 0.15},
    "google":   {"SEARCH": 0.60, "PERFORMANCE_MAX": 0.25, "DISPLAY": 0.15},
    "kakao":    {"BIZBOARD": 0.76, "CHANNEL_MSG": 0.24},
    "naver_sa": {"WEB_SITE": 0.80, "BRAND": 0.20},
}

SEED_RULES = []

# 광고 계층 시드: (media_key, campaign, campaign_type, adgroup, keyword, creative, cost_ratio)
# ratio는 해당 매체 일별 총 비용 대비 비중 (매체별 합계 = 1.0)
# device 브레이크다운은 DEVICE_SPLITS를 곱해 자동 생성
AD_HIERARCHY_SEED = [
    # ── naver_sa (합계 = 1.00) ──
    ("naver_sa","아토모스_파워링크_브랜드","WEB_SITE",  "브랜드_브랜드명_아토모스","아토모스",        "브랜드소재_v1",      0.13),
    ("naver_sa","아토모스_파워링크_브랜드","WEB_SITE",  "브랜드_브랜드명_아토모스","아토모스공식",     "브랜드소재_v1",      0.10),
    ("naver_sa","아토모스_파워링크_브랜드","WEB_SITE",  "브랜드_브랜드명_아토모스","아토모스채용",     "브랜드소재_v2",      0.06),
    ("naver_sa","아토모스_파워링크_브랜드","WEB_SITE",  "브랜드_상품명_솔루션",   "마케팅솔루션",     "솔루션소재_v1",      0.17),
    ("naver_sa","아토모스_파워링크_브랜드","WEB_SITE",  "브랜드_상품명_솔루션",   "광고성과분석",     "솔루션소재_v1",      0.14),
    ("naver_sa","아토모스_파워링크_브랜드","WEB_SITE",  "브랜드_상품명_솔루션",   "대시보드솔루션",   "솔루션소재_v2",      0.10),
    ("naver_sa","아토모스_파워링크_경쟁사","WEB_SITE",  "경쟁사_마케팅툴",        "경쟁사솔루션비교", "경쟁사비교소재_v1",  0.18),
    ("naver_sa","아토모스_파워링크_경쟁사","WEB_SITE",  "경쟁사_마케팅툴",        "마케팅자동화툴",   "경쟁사비교소재_v1",  0.12),
    # ── meta (합계 = 1.00) ──
    ("meta","아토모스_브랜드인지도","AWARENESS",  "인지도_마케터_30대","","브랜드동영상_마케터_v1",  0.18),
    ("meta","아토모스_브랜드인지도","AWARENESS",  "인지도_마케터_30대","","브랜드이미지_마케터_v1",  0.12),
    ("meta","아토모스_브랜드인지도","AWARENESS",  "인지도_광고주_40대","","브랜드동영상_광고주_v1",  0.15),
    ("meta","아토모스_전환캠페인",  "CONVERSION", "전환_솔루션체험",   "","체험신청_캐러셀_v1",      0.30),
    ("meta","아토모스_전환캠페인",  "CONVERSION", "전환_솔루션체험",   "","체험신청_단일이미지_v1",  0.25),
    # ── google (합계 = 1.00) ──
    ("google","아토모스_브랜드검색","SEARCH",          "브랜드_KW",    "아토모스",         "브랜드RSA_v1",    0.18),
    ("google","아토모스_브랜드검색","SEARCH",          "브랜드_KW",    "마케팅솔루션",     "브랜드RSA_v1",    0.14),
    ("google","아토모스_브랜드검색","SEARCH",          "상품_KW",      "광고분석툴",       "상품RSA_v1",      0.12),
    ("google","아토모스_브랜드검색","SEARCH",          "상품_KW",      "성과분석대시보드", "상품RSA_v1",      0.10),
    ("google","아토모스_PMax",      "PERFORMANCE_MAX", "PMax_전체상품","",                 "PMax소재세트_v1", 0.26),
    ("google","아토모스_PMax",      "PERFORMANCE_MAX", "PMax_전체상품","",                 "PMax소재세트_v2", 0.20),
    # ── kakao (합계 = 1.00) ──
    ("kakao","아토모스_카카오브랜드","BIZBOARD",   "비즈보드_마케터_30대","","비즈보드소재_v1",  0.40),
    ("kakao","아토모스_카카오브랜드","BIZBOARD",   "비즈보드_마케터_30대","","비즈보드소재_v2",  0.36),
    ("kakao","아토모스_카카오전환", "CHANNEL_MSG", "전환_채널메시지",    "","채널메시지소재_v1",0.24),
]

# 전환 소스 시드 (account_id, source, source_metric, solution_metric, value_type)
SEED_CONV_SETTINGS = []  # 데모 데이터 제거 — 계정 등록 후 직접 설정

SEED_CONVERSION = []  # 데모 데이터 제거

# 매체연동 매핑 기본 필드 (매체 제공 필드명) — metric_key: (노출/클릭/광고비/CPC/CPM)
MEDIA_PROVIDER_FIELDS = {
    "meta":     ["impressions", "clicks", "spend", "cpc", "cpm"],
    "google":   ["impressions", "clicks", "cost_micros", "average_cpc", "average_cpm"],
    "naver_sa": ["impCnt", "clkCnt", "salesAmt", "cpc", "cpm"],
    "kakao":    ["imp", "click", "spending", "cpc", "cpm"],
}
METRIC_KEYS = [("imp", "노출수"), ("click", "클릭수"), ("cost", "광고비"), ("cpc", "CPC"), ("cpm", "CPM")]
# acc1에 기본 매핑 시드할 매체
SEED_MEDIA_MAP_MEDIA = ["meta", "google", "naver_sa"]


def init_db(reset=False):
    if reset and os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    conn = get_conn()
    conn.executescript(SCHEMA)

    # ── 스키마 마이그레이션 (기존 DB에 컬럼/테이블 추가) ──
    for stmt in [
        "ALTER TABLE media ADD COLUMN media_key TEXT",
        # 준회원 승인 구조: users에 status 컬럼 추가
        "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
    ]:
        try:
            conn.execute(stmt)
            conn.commit()
        except Exception:
            pass  # 이미 존재하면 무시

    # invites 테이블 — account_id는 복수 계정 JSON 배열, FK 없이 TEXT
    # 기존 테이블에 accounts FK가 걸려 있으면 FK 위반이 발생하므로 재생성
    _inv_row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='invites'"
    ).fetchone()
    if _inv_row and _inv_row["sql"] and "REFERENCES accounts" in _inv_row["sql"]:
        conn.executescript("DROP TABLE IF EXISTS invites;")
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS invites (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        token       TEXT NOT NULL UNIQUE,
        email       TEXT NOT NULL,
        account_id  TEXT,
        ws_id       TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        role        TEXT NOT NULL DEFAULT 'advertiser',
        invited_by  TEXT NOT NULL REFERENCES users(id),
        created_at  TEXT DEFAULT (datetime('now')),
        expires_at  TEXT NOT NULL,
        used_at     TEXT
    );
    """)

    # ad_hierarchy: device/campaign_type 컬럼 추가 → UNIQUE 키 변경 필요하므로 재생성
    try:
        _h_cols = [r[1] for r in conn.execute("PRAGMA table_info(ad_hierarchy)").fetchall()]
        if 'device' not in _h_cols:
            conn.executescript("""
                DROP TABLE IF EXISTS ad_hierarchy;
                CREATE TABLE ad_hierarchy (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    account_id    TEXT NOT NULL,
                    date          TEXT NOT NULL,
                    media_key     TEXT NOT NULL,
                    campaign      TEXT NOT NULL DEFAULT '',
                    campaign_type TEXT NOT NULL DEFAULT '',
                    adgroup       TEXT NOT NULL DEFAULT '',
                    keyword       TEXT NOT NULL DEFAULT '',
                    creative      TEXT NOT NULL DEFAULT '',
                    device        TEXT NOT NULL DEFAULT 'all',
                    cost          REAL    NOT NULL DEFAULT 0,
                    imp           INTEGER NOT NULL DEFAULT 0,
                    click         INTEGER NOT NULL DEFAULT 0,
                    conv          REAL    NOT NULL DEFAULT 0,
                    conv_native   REAL    NOT NULL DEFAULT 0,
                    conv_ga4      REAL    NOT NULL DEFAULT 0,
                    conv_mmp      REAL    NOT NULL DEFAULT 0,
                    conv_manual   REAL    NOT NULL DEFAULT 0,
                    UNIQUE(account_id, date, media_key, campaign, adgroup, keyword, creative, device)
                );
            """)
    except Exception:
        pass

    # 기존 media 테이블에서 캠페인명으로 잘못 들어간 행 제거 후 media_key 업데이트
    valid_names = [m[0] for m in MEDIA_TEMPLATE]
    conn.execute(
        f"DELETE FROM media WHERE name NOT IN ({','.join('?'*len(valid_names))})",
        valid_names,
    )
    for name, *_, media_key in MEDIA_TEMPLATE:
        conn.execute("UPDATE media SET media_key=? WHERE name=? AND media_key IS NULL",
                     (media_key, name))
    conn.commit()

    # ad_hierarchy 시드 제거 — 실제 API 연동 후 pull_metric_data로 수집

    # ── conversion_settings 시드 (항상 실행) ──
    for _aid, _src, _sm, _sol, _vt in SEED_CONV_SETTINGS:
        conn.execute(
            "INSERT OR IGNORE INTO conversion_settings"
            " (account_id,source,source_metric,solution_metric,value_type)"
            " VALUES (?,?,?,?,?)",
            (_aid, _src, _sm, _sol, _vt),
        )
    conn.commit()

    # campaign_metrics 시드 제거 — 실제 API 연동 후 pull_metric_data로 수집

    # ── 데모 데이터 일회성 정리 (_df_cleaned 테이블로 추적, 최초 1회만 실행) ──
    try:
        _cleaned = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='_df_cleaned'"
        ).fetchone()
        if not _cleaned:
            conn.executescript("""
                DELETE FROM metric_data;
                DELETE FROM ad_hierarchy;
                DELETE FROM campaign_metrics;
                DELETE FROM rules;
                DELETE FROM users WHERE id NOT IN ('u_master');
                DELETE FROM accounts WHERE id IN ('acc1','acc2','acc3','acc4','acc5','acc6');
                DELETE FROM ad_accounts;
                DELETE FROM integrations;
                DELETE FROM workspace_members WHERE user_id NOT IN ('u_master');
                DELETE FROM workspaces WHERE id='ws_agency';
                UPDATE workspaces SET name='내 워크스페이스' WHERE id='ws_main';
                CREATE TABLE IF NOT EXISTS _df_cleaned (ts TEXT);
                INSERT INTO _df_cleaned (ts) VALUES (datetime('now'));
            """)
            conn.commit()
    except Exception:
        pass

    # 이미 시드됐는지 확인
    cur = conn.execute("SELECT COUNT(*) AS c FROM users")
    if cur.fetchone()["c"] > 0:
        conn.close()
        return

    # users
    for uid, name, email, role, color, pw in SEED_USERS:
        conn.execute(
            "INSERT INTO users (id,name,email,password_hash,role,avatar_color) VALUES (?,?,?,?,?,?)",
            (uid, name, email, hash_password(pw), role, color),
        )
    # workspaces
    for wid, name, owner in SEED_WORKSPACES:
        conn.execute("INSERT INTO workspaces (id,name,owner_id) VALUES (?,?,?)", (wid, name, owner))
    # workspace_members
    for wid, uid, role in SEED_WS_MEMBERS:
        conn.execute("INSERT INTO workspace_members (ws_id,user_id,role) VALUES (?,?,?)", (wid, uid, role))
    # accounts (ws_id 소속)
    for aid, wsid, name, adv, color in SEED_ACCOUNTS:
        conn.execute(
            "INSERT INTO accounts (id,ws_id,name,advertiser,color) VALUES (?,?,?,?,?)",
            (aid, wsid, name, adv, color),
        )
    # user_accounts
    for uid, aid, role in SEED_USER_ACCOUNTS:
        conn.execute(
            "INSERT INTO user_accounts (user_id,account_id,role) VALUES (?,?,?)",
            (uid, aid, role),
        )
    # ad_accounts (실제 매체 광고계정 연결)
    for wsid, aid, media, ext, accname, status in SEED_AD_ACCOUNTS:
        conn.execute(
            """INSERT INTO ad_accounts (ws_id,account_id,media,external_id,account_name,status,last_sync)
               VALUES (?,?,?,?,?,?,datetime('now'))""",
            (wsid, aid, media, ext, accname, status),
        )
    # integrations
    for wsid, typ, name, status in SEED_INTEGRATIONS:
        conn.execute(
            "INSERT INTO integrations (ws_id,type,name,status) VALUES (?,?,?,?)",
            (wsid, typ, name, status),
        )
    # media — 각 계정에 매체 플랫폼 데이터 (계정별로 규모 차등)
    import random
    for aid, _, _, _, _ in SEED_ACCOUNTS:
        scale = 1.0 if aid == "acc1" else random.uniform(0.2, 0.7)
        count = 9 if aid == "acc1" else random.randint(4, 7)
        for m in MEDIA_TEMPLATE[:count]:
            name, color, spend, imp, click, cvr, roas, cpa, is_on, conn_, media_key = m
            conn.execute(
                """INSERT INTO media (account_id,name,color,spend,imp,click,cvr,roas,cpa,is_on,connected,media_key,last_sync)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))""",
                (aid, name, color, int(spend*scale), int(imp*scale), int(click*scale),
                 int(cvr*scale), roas, cpa, is_on, conn_, media_key),
            )
    # rules
    for r in SEED_RULES:
        conn.execute(
            "INSERT INTO rules (account_id,name,description,level,schedule,active,last_run) VALUES (?,?,?,?,?,?,?)",
            r,
        )
    # conversion_settings (전환설정)
    for acc, src, sm, sol, vt in SEED_CONVERSION:
        conn.execute(
            "INSERT INTO conversion_settings (account_id,source,source_metric,solution_metric,value_type) VALUES (?,?,?,?,?)",
            (acc, src, sm, sol, vt),
        )
    # media_metric_map (매체연동 매핑) — acc1 기본 매핑
    for media in SEED_MEDIA_MAP_MEDIA:
        fields = MEDIA_PROVIDER_FIELDS.get(media, ["", "", "", "", ""])
        for (mk, sol), pf in zip(METRIC_KEYS, fields):
            conn.execute(
                "INSERT INTO media_metric_map (account_id,media,metric_key,provider_field,solution_name) VALUES (?,?,?,?,?)",
                ("acc1", media, mk, pf, sol),
            )

    # metric_data 시드 제거 — 실제 API 연동 후 pull_metric_data로 수집

    # ── 캠페인 시드 (acc1) ──
    for aid, mk, cid, cname, ctype, status, sp, im, cl, cv, rs, cp, ion in SEED_CAMPAIGNS:
        cpa_v = cp if cp else (sp // cv if cv else 0)
        conn.execute(
            """INSERT OR IGNORE INTO campaigns
               (account_id,media_key,campaign_id,name,campaign_type,status,
                spend,imp,click,cvr,roas,cpa,is_on,last_sync)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))""",
            (aid, mk, cid, cname, ctype, status, sp, im, cl, cv, rs, cpa_v, ion),
        )

    # ── campaign_metrics 시드: metric_data에서 device/campaign_type 브레이크다운 파생 ──
    for day_offset in range(90):
        d = (today - _td(days=89 - day_offset)).isoformat()
        for media_key, dev_splits in DEVICE_SPLITS.items():
            base_rows = conn.execute(
                "SELECT metric_key, value FROM metric_data WHERE account_id='acc1' AND date=? AND media=?",
                (d, media_key),
            ).fetchall()
            for row in base_rows:
                mk2, total = row["metric_key"], row["value"]
                for device, ratio in dev_splits.items():
                    conn.execute(
                        """INSERT OR IGNORE INTO campaign_metrics
                           (account_id,date,media_key,device,campaign_type,metric_key,value)
                           VALUES (?,?,?,?,?,?,?)""",
                        ("acc1", d, media_key, device, "all", mk2, round(total * ratio, 2)),
                    )
        for media_key, pt_splits in PRODUCT_TYPE_SPLITS.items():
            base_rows = conn.execute(
                "SELECT metric_key, value FROM metric_data WHERE account_id='acc1' AND date=? AND media=?",
                (d, media_key),
            ).fetchall()
            for row in base_rows:
                mk2, total = row["metric_key"], row["value"]
                for ptype, ratio in pt_splits.items():
                    conn.execute(
                        """INSERT OR IGNORE INTO campaign_metrics
                           (account_id,date,media_key,device,campaign_type,metric_key,value)
                           VALUES (?,?,?,?,?,?,?)""",
                        ("acc1", d, media_key, "all", ptype, mk2, round(total * ratio, 2)),
                    )

    # ── Ph E: report_config 시드 (acc1 기본 리포트) ──
    import json as _json
    conn.execute(
        "INSERT INTO report_config (account_id,name,columns_json,media_json,update_cycle) VALUES (?,?,?,?,?)",
        ("acc1", "일간 매체 성과 리포트",
         _json.dumps(["date","media","cost","imp","click","conv","revenue","ctr","cpc","roas"]),
         _json.dumps(["meta","google","naver_sa","kakao"]),
         "daily"),
    )

    conn.commit()
    conn.close()
    print(f"[db] 초기화 완료: {DB_PATH}")


if __name__ == "__main__":
    import sys
    reset = "--reset" in sys.argv
    init_db(reset=reset)
    print("[db] 시드 데이터 로드 완료")
