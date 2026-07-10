"""
DeepFle 백엔드 — REST API 서버 (http.server 기반, 표준 라이브러리만)
실행:  python server.py   (포트 5050)

핵심: 모든 보호 엔드포인트는 JWT 검증 + 계정별 역할 매핑을 서버에서 강제한다.
      (프론트엔드 메뉴 숨김은 보조수단일 뿐, 실제 권한은 여기서 결정)
"""
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# .env 파일 로드 (있으면 환경변수로 설정)
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))
except ImportError:
    pass

import db
from auth import verify_password, hash_password, issue_token, verify_token, can_edit, is_master
from connectors import get_connector, CONNECTORS as MEDIA_CONNECTORS

PORT = int(os.environ.get('PORT', 5050))

# 매체별 대표 색상 (대시보드 차트용)
MEDIA_COLOR = {
    "meta": "#1877F2", "google": "#4285F4", "kakao": "#FFCD00", "tiktok": "#000000",
    "naver_gfa": "#03C75A", "naver_sa": "#00C73C", "apple_sa": "#555555",
    "pinterest": "#E60023", "x_ads": "#1DA1F2", "criteo": "#FF6E00",
    "msft": "#00A4EF", "snap": "#FFFC00",
    "taboola": "#1F96DA", "dable": "#FF6600", "karrot": "#FF7A1A",
    "coupang": "#ED1C24", "mobion": "#6236FF", "moloco": "#0052CC",
    "kakao_sa": "#3A1D96", "buzzvil": "#FF4081", "inmobi": "#E91E63",
}


# ───────────────────────── 권한 헬퍼 ─────────────────────────
def account_role(conn, user_id, account_id):
    """해당 사용자가 그 계정에서 갖는 역할. 접근 불가면 None."""
    row = conn.execute(
        "SELECT role FROM user_accounts WHERE user_id=? AND account_id=?",
        (user_id, account_id),
    ).fetchone()
    return row["role"] if row else None


def workspace_role(conn, user_id, ws_id):
    """해당 사용자가 그 워크스페이스에서 갖는 역할. 멤버 아니면 None."""
    row = conn.execute(
        "SELECT role FROM workspace_members WHERE user_id=? AND ws_id=?",
        (user_id, ws_id),
    ).fetchone()
    return row["role"] if row else None


def write_audit(conn, account_id, user, action, detail=""):
    conn.execute(
        "INSERT INTO audit_log (account_id,user_id,user_name,role,action,detail) VALUES (?,?,?,?,?,?)",
        (account_id, user["sub"], user["name"], user["role"], action, detail),
    )


def _cleanup_old_manual_conv_data(conn):
    """수기 전환 데이터는 저장 시점(updated_at) 기준 7일이 지나면 자동 삭제한다.
    별도 스케줄러 없이, 이 데이터를 조회/저장할 때마다 만료분을 함께 정리한다."""
    conn.execute("DELETE FROM manual_conv_data WHERE updated_at < datetime('now','-7 days')")
    conn.commit()


# 회원가입 이메일 인증코드 임시 저장소 {email: {code, expires_ts}}
import time as _time
_VERIFY_CODES: dict = {}


def _send_emailjs(to_email: str, to_name: str, code_or_url: str, expires_in: str,
                  template_env: str = "EMAILJS_TEMPLATE_VERIFY") -> bool:
    """EmailJS REST API로 이메일 발송. 성공 시 True. 실패 사유는 stdout에 로그(Railway Deploy Logs에서 확인)."""
    import urllib.request as _ur, json as _json
    service_id  = os.environ.get("EMAILJS_SERVICE_ID", "")
    public_key  = os.environ.get("EMAILJS_PUBLIC_KEY", "")
    private_key = os.environ.get("EMAILJS_PRIVATE_KEY", "")
    template_id = os.environ.get(template_env, "") or os.environ.get("EMAILJS_TEMPLATE_VERIFY", "")
    if not (service_id and public_key and template_id):
        print(f"[emailjs] 환경변수 누락: service_id={bool(service_id)} public_key={bool(public_key)} template_id={bool(template_id)}", flush=True)
        return False
    body = {
        "service_id":  service_id,
        "template_id": template_id,
        "user_id":     public_key,
        "template_params": {
            "to_email":      to_email,
            "to_name":       to_name,
            "security_code": code_or_url,
            "expires_in":    expires_in,
        },
    }
    if private_key:
        body["accessToken"] = private_key  # 서버(non-browser) 호출 시 Origin 검증 우회용
    payload = _json.dumps(body).encode("utf-8")
    req = _ur.Request(
        "https://api.emailjs.com/api/v1.0/email/send",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "origin": "https://jinha231.github.io",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
        method="POST",
    )
    try:
        with _ur.urlopen(req, timeout=15) as r:
            ok = r.status == 200
            if not ok:
                print(f"[emailjs] 발송 실패: status={r.status} body={r.read()[:300]}", flush=True)
            return ok
    except Exception as e:
        body_detail = ""
        if hasattr(e, "read"):
            try: body_detail = e.read().decode("utf-8", "ignore")[:300]
            except Exception: pass
        print(f"[emailjs] 발송 예외: {e} {body_detail}", flush=True)
        return False


# ───────────────────────── 라우트 핸들러 ─────────────────────────
class Api:
    """각 메서드는 (status:int, body:dict) 반환."""

    # POST /api/auth/login
    @staticmethod
    def login(body, user, conn, params):
        email = (body or {}).get("email", "").strip()
        password = (body or {}).get("password", "")
        row = conn.execute("SELECT * FROM users WHERE email=? AND active=1", (email,)).fetchone()
        if not row or not verify_password(password, row["password_hash"]):
            return 401, {"error": "이메일 또는 비밀번호가 올바르지 않습니다."}
        if (row["status"] if "status" in row.keys() else "active") == "pending":
            return 403, {"error": "pending", "message": "가입 승인 대기 중입니다. 관리자에게 문의해주세요."}
        conn.execute("UPDATE users SET last_login=datetime('now') WHERE id=?", (row["id"],))
        conn.commit()
        token = issue_token({"sub": row["id"], "name": row["name"], "role": row["role"], "email": row["email"]})
        return 200, {
            "token": token,
            "user": {"id": row["id"], "name": row["name"], "email": row["email"],
                     "role": row["role"], "avatarColor": row["avatar_color"]},
        }

    # GET /api/auth/me
    @staticmethod
    def me(body, user, conn, params):
        row = conn.execute("SELECT * FROM users WHERE id=?", (user["sub"],)).fetchone()
        if not row:
            return 404, {"error": "사용자를 찾을 수 없습니다."}
        return 200, {"id": row["id"], "name": row["name"], "email": row["email"],
                     "role": row["role"], "avatarColor": row["avatar_color"]}

    # POST /api/auth/send-verify  — 회원가입 이메일 인증코드 발송 (인증 불요)
    @staticmethod
    def send_verify(body, user, conn, params):
        import secrets
        b = body or {}
        email = (b.get("email") or "").strip().lower()
        if not email or "@" not in email:
            return 400, {"error": "올바른 이메일을 입력해주세요."}
        existing = conn.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
        if existing:
            return 409, {"error": "이미 가입된 이메일입니다."}
        code = "".join([str(secrets.randbelow(10)) for _ in range(6)])
        _VERIFY_CODES[email] = {"code": code, "expires": _time.time() + 600}
        to_name = email.split("@")[0]
        print(f"[emailjs] send-verify 호출됨: email={email}", flush=True)
        sent = _send_emailjs(email, to_name, code, "10분")
        print(f"[emailjs] send-verify 결과: sent={sent}", flush=True)
        if sent:
            return 200, {"sent": True, "message": f"{email}으로 인증코드를 발송했습니다."}
        else:
            return 200, {"sent": False,
                         "message": "이메일 발송에 실패했습니다. 관리자에게 문의해주세요."}

    # POST /api/auth/check-verify  — 인증코드 확인 (인증 불요)
    @staticmethod
    def check_verify(body, user, conn, params):
        b = body or {}
        email = (b.get("email") or "").strip().lower()
        code  = (b.get("code") or "").strip()
        entry = _VERIFY_CODES.get(email)
        if not entry:
            return 400, {"error": "인증코드를 먼저 발송해주세요."}
        if _time.time() > entry["expires"]:
            _VERIFY_CODES.pop(email, None)
            return 400, {"error": "인증코드가 만료되었습니다. 다시 발송해주세요."}
        if entry["code"] != code:
            return 400, {"error": "인증코드가 올바르지 않습니다."}
        entry["verified"] = True
        return 200, {"verified": True}

    # POST /api/auth/register  — 회원가입 → 준회원(pending) 으로 생성, 마스터 승인 필요
    @staticmethod
    def register(body, user, conn, params):
        import uuid as _uuid, random
        b = body or {}
        name  = (b.get("name") or "").strip()
        email = (b.get("email") or "").strip().lower()
        pw    = b.get("password") or ""
        if not name or not email or not pw:
            return 400, {"error": "이름, 이메일, 비밀번호는 필수입니다."}
        if len(pw) < 8:
            return 400, {"error": "비밀번호는 8자 이상이어야 합니다."}
        entry = _VERIFY_CODES.get(email)
        if not entry or not entry.get("verified"):
            return 403, {"error": "이메일 인증을 완료해주세요."}
        existing = conn.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
        if existing:
            return 409, {"error": "이미 가입된 이메일입니다."}
        uid = "u_" + _uuid.uuid4().hex[:8]
        pw_hash = hash_password(pw)
        color = "#{:06x}".format(random.randint(0x334155, 0x64748b))
        conn.execute(
            "INSERT INTO users (id,name,email,password_hash,role,avatar_color,active,status) VALUES (?,?,?,?,?,?,1,?)",
            (uid, name, email, pw_hash, "user", color, "pending"),
        )
        conn.commit()
        _VERIFY_CODES.pop(email, None)
        return 201, {"ok": True, "pending": True,
                     "message": "가입이 완료되었습니다. 관리자 승인 후 서비스를 이용하실 수 있습니다."}


    # ───────── R2: 매체 실 API 커넥터 ─────────

    # GET /api/connectors  — 사용 가능한 커넥터 목록
    @staticmethod
    def list_connectors(body, user, conn, params):
        out = [{"key": c.key, "label": c.label,
                "region": getattr(c, "region", "-"), "category": getattr(c, "category", "-")}
               for c in MEDIA_CONNECTORS.values()]
        return 200, {"connectors": out}

    # GET /api/connectors/health-all  — 전 매체 실제 API 도달성 일괄 검증 (병렬)
    @staticmethod
    def connectors_health_all(body, user, conn, params):
        import concurrent.futures as cf

        def one(c):
            try:
                hc = c.healthcheck()
            except Exception as e:
                hc = {"reachable": False, "httpStatus": None, "apiMessage": str(e), "tokenValid": False}
            return {"key": c.key, "label": c.label,
                    "region": getattr(c, "region", "-"), "category": getattr(c, "category", "-"),
                    "reachable": hc["reachable"], "httpStatus": hc["httpStatus"],
                    "tokenValid": hc.get("tokenValid", False),
                    "apiMessage": (hc.get("apiMessage") or "")[:120]}

        conns = list(MEDIA_CONNECTORS.values())
        with cf.ThreadPoolExecutor(max_workers=10) as ex:
            results = list(ex.map(one, conns))
        reachable_n = sum(1 for r in results if r["reachable"])
        return 200, {"results": results, "total": len(results), "reachable": reachable_n}

    # GET /api/connectors/:media/status  — 실제 API 도달성 + 토큰 유효성
    @staticmethod
    def connector_status(body, user, conn, params):
        c = get_connector(params["media"])
        if not c:
            return 404, {"error": "지원하지 않는 매체입니다."}
        token = os.environ.get(f"{params['media'].upper()}_ACCESS_TOKEN", "")
        return 200, {"media": c.key, "label": c.label, **c.healthcheck(token or None)}

    # GET /api/connectors/:media/oauth-url?redirect=&state=  — OAuth 인가 URL
    @staticmethod
    def connector_oauth_url(body, user, conn, params):
        c = get_connector(params["media"])
        if not c:
            return 404, {"error": "지원하지 않는 매체입니다."}
        import urllib.parse as up
        q = up.parse_qs(params.get("_query", ""))
        redirect = (q.get("redirect", [""])[0]) or "https://app.deepfle.io/oauth/callback"
        state = (q.get("state", [""])[0])
        return 200, {"oauthUrl": c.oauth_url(redirect, state), "media": c.key}

    # POST /api/connectors/:media/sync  {ws_id, ad_account_id, account_id, token?}
    #   실제 매체 API에서 캠페인을 가져와 DB media 테이블에 반영
    @staticmethod
    def connector_sync(body, user, conn, params):
        c = get_connector(params["media"])
        if not c:
            return 404, {"error": "지원하지 않는 매체입니다."}
        b = body or {}
        ws_id = b.get("ws_id")
        wsr = workspace_role(conn, user["sub"], ws_id) if ws_id else None
        if not wsr or not can_edit(wsr):
            return 403, {"error": "워크스페이스 편집 권한이 필요합니다."}

        # 토큰: 요청 본문 > 환경변수 (운영 시 안전 저장소)
        token = b.get("token") or os.environ.get(f"{params['media'].upper()}_ACCESS_TOKEN", "")
        hc = c.healthcheck(token or None)
        campaigns = c.fetch_campaigns(b.get("ad_account_id", ""), token or "")

        # 캠페인 → campaigns 테이블에 반영 + media 테이블은 플랫폼 집계로 업데이트
        account_id = b.get("account_id")
        applied = 0
        if account_id:
            total_spend = total_imp = total_click = total_cvr = 0
            for cam in campaigns:
                cpa = int(cam.spend / cam.conversions) if cam.conversions else 0
                total_spend += cam.spend; total_imp += cam.impressions
                total_click += cam.clicks; total_cvr += cam.conversions
                conn.execute(
                    """INSERT INTO campaigns (account_id,media_key,campaign_id,name,campaign_type,
                       status,spend,imp,click,cvr,roas,cpa,is_on,last_sync)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
                       ON CONFLICT(account_id,media_key,name) DO UPDATE SET
                       campaign_id=excluded.campaign_id, campaign_type=excluded.campaign_type,
                       status=excluded.status, spend=excluded.spend, imp=excluded.imp,
                       click=excluded.click, cvr=excluded.cvr, roas=excluded.roas,
                       cpa=excluded.cpa, is_on=excluded.is_on, last_sync=excluded.last_sync""",
                    (account_id, c.key, cam.external_id, cam.name,
                     getattr(cam, "campaign_type", ""), cam.status,
                     cam.spend, cam.impressions, cam.clicks, cam.conversions,
                     int(cam.roas), cpa, 1 if cam.status == "ACTIVE" else 0),
                )
                applied += 1
            # media 플랫폼 행 집계 업데이트 (캠페인명이 아닌 플랫폼 기준)
            agg_roas = int(total_spend / total_cvr * 100) if total_cvr else 0
            agg_cpa  = int(total_spend / total_cvr) if total_cvr else 0
            color = MEDIA_COLOR.get(c.key, "#64748B")
            existing = conn.execute(
                "SELECT id FROM media WHERE account_id=? AND media_key=?",
                (account_id, c.key)).fetchone()
            if existing:
                conn.execute(
                    "UPDATE media SET spend=?,imp=?,click=?,cvr=?,roas=?,cpa=?,last_sync=datetime('now') WHERE id=?",
                    (total_spend, total_imp, total_click, total_cvr, agg_roas, agg_cpa, existing["id"]))
            else:
                conn.execute(
                    """INSERT INTO media (account_id,name,color,spend,imp,click,cvr,roas,cpa,
                       is_on,connected,media_key,last_sync)
                       VALUES (?,?,?,?,?,?,?,?,?,1,1,?,datetime('now'))""",
                    (account_id, c.label, color, total_spend, total_imp, total_click,
                     total_cvr, agg_roas, agg_cpa, c.key))
            write_audit(conn, account_id, user, "connector_sync",
                        f"{c.label} 동기화 → {applied}개 캠페인 → media 집계 반영")
            conn.commit()

        return 200, {
            "ok": True,
            "media": c.key,
            "apiReachable": hc["reachable"],
            "tokenValid": hc["tokenValid"],
            "usedFixture": not hc["tokenValid"],   # 토큰 무효 시 fixture 사용
            "apiMessage": hc["apiMessage"],
            "campaignCount": len(campaigns),
            "appliedToAccount": applied,
            "campaigns": [cam.to_dict() for cam in campaigns],
        }

    # ───────── R3: 계정 단위 멀티매체 동기화 ─────────

    # POST /api/accounts/:accId/sync-connectors  {ws_id}
    #   계정에 연결된 모든 매체 ad_accounts를 각 커넥터로 동기화 → media 통합 반영
    @staticmethod
    def sync_account_connectors(body, user, conn, params):
        acc_id = params["account_id"]
        b = body or {}
        ws_id = b.get("ws_id")
        wsr = workspace_role(conn, user["sub"], ws_id) if ws_id else account_role(conn, user["sub"], acc_id)
        if not wsr:
            return 403, {"error": "접근 권한이 없습니다."}
        if not can_edit(wsr):
            return 403, {"error": "편집 권한이 필요합니다."}

        # 이 계정에 연결된 매체 광고계정들
        ad_accounts = conn.execute(
            "SELECT * FROM ad_accounts WHERE account_id=? AND status!='disconnected'", (acc_id,)
        ).fetchall()

        cur = conn.execute("INSERT INTO sync_jobs (account_id,status) VALUES (?, 'running')", (acc_id,))
        job_id = cur.lastrowid

        per_media, total_campaigns, used_fixture_any = [], 0, False
        for aa in ad_accounts:
            c = get_connector(aa["media"])
            if not c:
                continue
            token = os.environ.get(f"{aa['media'].upper()}_ACCESS_TOKEN", "")
            hc = c.healthcheck(token or None)
            campaigns = c.fetch_campaigns(aa["external_id"] or "", token or "")
            if not hc.get("tokenValid"):
                used_fixture_any = True
            # campaigns 테이블 반영 + media 플랫폼 집계 업데이트
            color = MEDIA_COLOR.get(aa["media"], "#64748B")
            tot_spend = tot_imp = tot_click = tot_cvr = 0
            for cam in campaigns:
                cpa = int(cam.spend / cam.conversions) if cam.conversions else 0
                tot_spend += cam.spend; tot_imp += cam.impressions
                tot_click += cam.clicks; tot_cvr += cam.conversions
                conn.execute(
                    """INSERT INTO campaigns (account_id,media_key,campaign_id,name,campaign_type,
                       status,spend,imp,click,cvr,roas,cpa,is_on,last_sync)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
                       ON CONFLICT(account_id,media_key,name) DO UPDATE SET
                       campaign_id=excluded.campaign_id, campaign_type=excluded.campaign_type,
                       status=excluded.status, spend=excluded.spend, imp=excluded.imp,
                       click=excluded.click, cvr=excluded.cvr, roas=excluded.roas,
                       cpa=excluded.cpa, is_on=excluded.is_on, last_sync=excluded.last_sync""",
                    (acc_id, aa["media"], cam.external_id, cam.name,
                     getattr(cam, "campaign_type", ""), cam.status,
                     cam.spend, cam.impressions, cam.clicks, cam.conversions,
                     int(cam.roas), cpa, 1 if cam.status == "ACTIVE" else 0),
                )
            agg_roas = int(tot_spend / tot_cvr * 100) if tot_cvr else 0
            agg_cpa  = int(tot_spend / tot_cvr) if tot_cvr else 0
            plat_row = conn.execute("SELECT id FROM media WHERE account_id=? AND media_key=?",
                                    (acc_id, aa["media"])).fetchone()
            if plat_row:
                conn.execute(
                    "UPDATE media SET spend=?,imp=?,click=?,cvr=?,roas=?,cpa=?,last_sync=datetime('now') WHERE id=?",
                    (tot_spend, tot_imp, tot_click, tot_cvr, agg_roas, agg_cpa, plat_row["id"]))
            else:
                conn.execute(
                    """INSERT INTO media (account_id,name,color,spend,imp,click,cvr,roas,cpa,
                       is_on,connected,media_key,last_sync)
                       VALUES (?,?,?,?,?,?,?,?,?,1,1,?,datetime('now'))""",
                    (acc_id, c.label, color, tot_spend, tot_imp, tot_click,
                     tot_cvr, agg_roas, agg_cpa, aa["media"]))
            per_media.append({"media": aa["media"], "label": c.label,
                              "reachable": hc["reachable"], "tokenValid": hc.get("tokenValid", False),
                              "campaigns": len(campaigns)})
            total_campaigns += len(campaigns)
            conn.execute("UPDATE ad_accounts SET last_sync=datetime('now') WHERE id=?", (aa["id"],))

        conn.execute("UPDATE sync_jobs SET status='done', media_count=?, finished_at=datetime('now') WHERE id=?",
                     (len(per_media), job_id))
        write_audit(conn, acc_id, user, "account_sync_connectors",
                    f"{len(per_media)}개 매체 동기화 → {total_campaigns}개 캠페인")
        conn.execute(
            "INSERT INTO notifications (account_id,level,channel,title,message) VALUES (?,?,?,?,?)",
            (acc_id, "info", "email", "매체 데이터 동기화 완료",
             f"{len(per_media)}개 매체 · {total_campaigns}개 캠페인이 갱신되었습니다."))
        conn.commit()

        return 200, {"ok": True, "jobId": job_id, "mediaCount": len(per_media),
                     "totalCampaigns": total_campaigns, "usedFixture": used_fixture_any,
                     "perMedia": per_media}

    # ───────── R1: 워크스페이스 (멀티테넌시) ─────────

    # GET /api/workspaces  — 내가 속한 워크스페이스 목록
    @staticmethod
    def list_workspaces(body, user, conn, params):
        rows = conn.execute(
            """SELECT w.*, wm.role AS my_role FROM workspaces w
               JOIN workspace_members wm ON wm.ws_id=w.id
               WHERE wm.user_id=? ORDER BY w.created_at""",
            (user["sub"],),
        ).fetchall()
        out = []
        for w in rows:
            acc_n = conn.execute("SELECT COUNT(*) AS c FROM accounts WHERE ws_id=?", (w["id"],)).fetchone()["c"]
            ad_n = conn.execute("SELECT COUNT(*) AS c FROM ad_accounts WHERE ws_id=?", (w["id"],)).fetchone()["c"]
            mem_n = conn.execute("SELECT COUNT(*) AS c FROM workspace_members WHERE ws_id=?", (w["id"],)).fetchone()["c"]
            out.append({"id": w["id"], "name": w["name"], "myRole": w["my_role"],
                        "accountCount": acc_n, "adAccountCount": ad_n, "memberCount": mem_n})
        return 200, {"workspaces": out}

    # GET /api/workspaces/:id/accounts  — 워크스페이스 내 광고주 계정 (내 권한 필터)
    @staticmethod
    def list_ws_accounts(body, user, conn, params):
        wid = params["ws_id"]
        wsr = workspace_role(conn, user["sub"], wid)
        if not wsr:
            return 403, {"error": "이 워크스페이스에 접근할 권한이 없습니다."}
        # 워크스페이스 내 계정 중, 내가 user_accounts로 접근 가능한 것
        rows = conn.execute(
            """SELECT a.*, ua.role AS my_role FROM accounts a
               JOIN user_accounts ua ON ua.account_id=a.id
               WHERE a.ws_id=? AND ua.user_id=? ORDER BY a.id""",
            (wid, user["sub"]),
        ).fetchall()
        out = []
        for a in rows:
            agg = conn.execute("SELECT COALESCE(SUM(spend),0) AS s FROM media WHERE account_id=?", (a["id"],)).fetchone()
            out.append({"id": a["id"], "name": a["name"], "advertiser": a["advertiser"],
                        "color": a["color"], "myRole": a["my_role"], "spend": agg["s"]})
        return 200, {"accounts": out, "wsRole": wsr}

    # POST /api/workspaces/:id/accounts  — 광고주 계정 생성 (마스터/편집 권한)
    @staticmethod
    def create_account(body, user, conn, params):
        wid = params["ws_id"]
        wsr = workspace_role(conn, user["sub"], wid)
        if not wsr:
            return 403, {"error": "이 워크스페이스에 접근할 권한이 없습니다."}
        if not can_edit(wsr):
            return 403, {"error": "편집 권한이 필요합니다."}
        b = body or {}
        name = (b.get("name") or "").strip()
        if not name:
            return 400, {"error": "계정명은 필수입니다."}
        import uuid as _uuid
        acc_id = "acc_" + _uuid.uuid4().hex[:8]
        color = b.get("color") or "#4F46E5"
        advertiser = (b.get("advertiser") or "").strip()
        conn.execute(
            "INSERT INTO accounts (id, ws_id, name, advertiser, color) VALUES (?,?,?,?,?)",
            (acc_id, wid, name, advertiser, color),
        )
        conn.execute(
            "INSERT INTO user_accounts (user_id, account_id, role) VALUES (?,?,?)",
            (user["sub"], acc_id, "master"),
        )
        write_audit(conn, acc_id, user, "account_create", f"광고주 계정 생성: {name}")
        conn.commit()
        return 201, {"account": {"id": acc_id, "name": name, "advertiser": advertiser,
                                  "color": color, "myRole": "master"}}

    # PATCH /api/accounts/:id  — 계정 기본정보 수정 (계정명·광고주명)
    @staticmethod
    def update_account(body, user, conn, params):
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "이 계정에 접근할 권한이 없습니다."}
        if role not in ("master", "user"):
            return 403, {"error": "편집 권한이 필요합니다."}
        b = body or {}
        name = (b.get("name") or "").strip()
        advertiser = (b.get("advertiser") or "").strip()
        if not name:
            return 400, {"error": "계정명은 필수입니다."}
        conn.execute(
            "UPDATE accounts SET name=?, advertiser=? WHERE id=?",
            (name, advertiser, aid),
        )
        write_audit(conn, aid, user, "account_update", f"계정 정보 수정: {name}")
        conn.commit()
        return 200, {"ok": True}

    # DELETE /api/accounts/:id  — 계정 삭제 (마스터 전용)
    @staticmethod
    def delete_account(body, user, conn, params):
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "이 계정에 접근할 권한이 없습니다."}
        if role != "master":
            return 403, {"error": "마스터 권한이 필요합니다."}
        # 연관 데이터 삭제 (ON DELETE CASCADE 미지원 환경 대비)
        for tbl in ("user_accounts", "ad_accounts", "rules", "rule_executions",
                    "conversion_settings", "attribution_links", "audiences",
                    "manual_metrics", "audit_log", "report_config", "report_history",
                    "metric_data"):
            try:
                conn.execute(f"DELETE FROM {tbl} WHERE account_id=?", (aid,))
            except Exception:
                pass
        conn.execute("DELETE FROM accounts WHERE id=?", (aid,))
        conn.commit()
        return 200, {"ok": True}

    # POST /api/workspaces/:id/invite  — 광고주 초대 (토큰 링크 발송)
    @staticmethod
    def invite_user(body, user, conn, params):
        import uuid as _uuid, secrets as _sec, json as _json
        wid = params["ws_id"]
        wsr = workspace_role(conn, user["sub"], wid)
        if not wsr:
            return 403, {"error": "워크스페이스 접근 권한이 없습니다."}
        b = body or {}
        email = (b.get("email") or "").strip().lower()
        account_ids = b.get("account_ids") or []
        if not email:
            return 400, {"error": "이메일은 필수입니다."}
        if not account_ids:
            return 400, {"error": "접근 계정을 하나 이상 지정해주세요."}
        if conn.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone():
            return 409, {"error": "이미 가입된 이메일입니다."}

        token = _sec.token_urlsafe(32)
        import datetime as _dt
        expires = (_dt.datetime.utcnow() + _dt.timedelta(days=7)).isoformat()
        conn.execute(
            "INSERT INTO invites (token,email,account_id,ws_id,role,invited_by,expires_at) VALUES (?,?,?,?,?,?,?)",
            (token, email, _json.dumps(account_ids), wid, "advertiser", user["sub"], expires)
        )
        write_audit(conn, account_ids[0] if account_ids else wid, user, "invite_advertiser",
                    f"광고주 초대: {email}")
        conn.commit()

        base_url = os.environ.get("APP_URL", "http://localhost:3003/deepfle-dashboard.html")
        invite_url = f"{base_url}?invite={token}"
        to_name = email.split("@")[0]
        sent = _send_emailjs(email, to_name, invite_url, "7일 이내", "EMAILJS_TEMPLATE_INVITE")
        return 201, {"ok": True, "invite_sent": sent, "invite_url": invite_url}

    # GET /api/invite/:token  — 초대 토큰 정보 (인증 불요)
    @staticmethod
    def get_invite(body, user, conn, params):
        import json as _json, datetime as _dt
        token = params["token"]
        row = conn.execute("SELECT * FROM invites WHERE token=?", (token,)).fetchone()
        if not row:
            return 404, {"error": "유효하지 않은 초대 링크입니다."}
        if row["used_at"]:
            return 410, {"error": "이미 사용된 초대 링크입니다."}
        try:
            if _dt.datetime.fromisoformat(row["expires_at"]) < _dt.datetime.utcnow():
                return 410, {"error": "만료된 초대 링크입니다."}
        except Exception:
            pass
        import json as _json
        acc_ids = []
        try: acc_ids = _json.loads(row["account_id"] or "[]")
        except: pass
        acc_names = []
        for aid in acc_ids:
            a = conn.execute("SELECT name FROM accounts WHERE id=?", (aid,)).fetchone()
            if a: acc_names.append(a["name"])
        return 200, {"email": row["email"], "role": row["role"],
                     "account_ids": acc_ids, "account_names": acc_names,
                     "ws_id": row["ws_id"]}

    # POST /api/invite/:token/accept  — 초대 수락 (계정 생성)
    @staticmethod
    def accept_invite(body, user, conn, params):
        import uuid as _uuid, random, json as _json, datetime as _dt
        token = params["token"]
        row = conn.execute("SELECT * FROM invites WHERE token=?", (token,)).fetchone()
        if not row:
            return 404, {"error": "유효하지 않은 초대 링크입니다."}
        if row["used_at"]:
            return 410, {"error": "이미 사용된 초대 링크입니다."}
        try:
            if _dt.datetime.fromisoformat(row["expires_at"]) < _dt.datetime.utcnow():
                return 410, {"error": "만료된 초대 링크입니다."}
        except Exception:
            pass
        b = body or {}
        name = (b.get("name") or "").strip()
        pw   = b.get("password") or ""
        if not name or not pw:
            return 400, {"error": "이름과 비밀번호는 필수입니다."}
        if len(pw) < 8:
            return 400, {"error": "비밀번호는 8자 이상이어야 합니다."}
        if conn.execute("SELECT id FROM users WHERE email=?", (row["email"],)).fetchone():
            return 409, {"error": "이미 가입된 이메일입니다."}

        uid = "u_" + _uuid.uuid4().hex[:8]
        color = "#{:06x}".format(random.randint(0x334155, 0x64748b))
        conn.execute(
            "INSERT INTO users (id,name,email,password_hash,role,avatar_color,active,status) VALUES (?,?,?,?,?,?,1,?)",
            (uid, name, row["email"], hash_password(pw), row["role"], color, "active"),
        )
        conn.execute("INSERT OR IGNORE INTO workspace_members (ws_id,user_id,role) VALUES (?,?,?)",
                     (row["ws_id"], uid, row["role"]))
        acc_ids = []
        try: acc_ids = _json.loads(row["account_id"] or "[]")
        except: pass
        for aid in acc_ids:
            conn.execute("INSERT OR IGNORE INTO user_accounts (user_id,account_id,role) VALUES (?,?,?)",
                         (uid, aid, row["role"]))
        conn.execute("UPDATE invites SET used_at=datetime('now') WHERE token=?", (token,))
        conn.commit()
        jwt_token = issue_token({"sub": uid, "name": name, "role": row["role"], "email": row["email"]})
        return 201, {"token": jwt_token,
                     "user": {"id": uid, "name": name, "email": row["email"],
                              "role": row["role"], "avatarColor": color},
                     "account_ids": acc_ids}

    # ── 관리자 전용: 준회원 승인 ──

    # GET /api/admin/pending-users
    @staticmethod
    def list_pending_users(body, user, conn, params):
        if not is_master(user["role"]):
            return 403, {"error": "마스터 권한이 필요합니다."}
        rows = conn.execute(
            "SELECT id,name,email,avatar_color,created_at FROM users WHERE status='pending' ORDER BY created_at"
        ).fetchall()
        return 200, {"users": [dict(r) for r in rows]}

    # POST /api/admin/users/:id/approve  {ws_id?, account_ids?}
    @staticmethod
    def approve_user(body, user, conn, params):
        if not is_master(user["role"]):
            return 403, {"error": "마스터 권한이 필요합니다."}
        uid = params["user_id"]
        b   = body or {}
        row = conn.execute("SELECT * FROM users WHERE id=? AND status='pending'", (uid,)).fetchone()
        if not row:
            return 404, {"error": "대기 중인 사용자를 찾을 수 없습니다."}
        # 마스터의 워크스페이스 자동 선택
        ws_row = conn.execute(
            "SELECT ws_id FROM workspace_members WHERE user_id=? AND role='master' LIMIT 1",
            (user["sub"],)).fetchone()
        ws_id = b.get("ws_id") or (ws_row["ws_id"] if ws_row else None)
        conn.execute("UPDATE users SET status='active' WHERE id=?", (uid,))
        if ws_id:
            conn.execute("INSERT OR IGNORE INTO workspace_members (ws_id,user_id,role) VALUES (?,?,?)",
                         (ws_id, uid, "user"))
        for aid in (b.get("account_ids") or []):
            conn.execute("INSERT OR IGNORE INTO user_accounts (user_id,account_id,role) VALUES (?,?,?)",
                         (uid, aid, "user"))
        write_audit(conn, ws_id or uid, user, "approve_user", f"준회원 승인: {row['name']} ({row['email']})")
        conn.commit()
        return 200, {"ok": True}

    # DELETE /api/admin/users/:id  — 삭제 (pending 거절 또는 활성 사용자 삭제)
    @staticmethod
    def delete_user(body, user, conn, params):
        if not is_master(user["role"]):
            return 403, {"error": "마스터 권한이 필요합니다."}
        uid = params["user_id"]
        if uid == user["sub"]:
            return 400, {"error": "자신은 삭제할 수 없습니다."}
        row = conn.execute("SELECT name,email FROM users WHERE id=?", (uid,)).fetchone()
        if not row:
            return 404, {"error": "사용자를 찾을 수 없습니다."}
        conn.execute("DELETE FROM users WHERE id=?", (uid,))
        write_audit(conn, uid, user, "delete_user", f"사용자 삭제: {row['name']} ({row['email']})")
        conn.commit()
        return 200, {"ok": True}

    # PUT /api/admin/users/:id/role  {role}
    @staticmethod
    def update_user_role(body, user, conn, params):
        if not is_master(user["role"]):
            return 403, {"error": "마스터 권한이 필요합니다."}
        uid  = params["user_id"]
        role = (body or {}).get("role", "")
        if role not in ("user", "advertiser", "master"):
            return 400, {"error": "role은 master, user, advertiser 중 하나여야 합니다."}
        conn.execute("UPDATE users SET role=? WHERE id=?", (role, uid))
        # workspace_members도 동기화
        conn.execute("UPDATE workspace_members SET role=? WHERE user_id=? AND role!='master'", (role, uid))
        conn.commit()
        return 200, {"ok": True}

    # PUT /api/admin/users/:id/accounts  {account_ids, ws_id}
    @staticmethod
    def update_user_accounts(body, user, conn, params):
        if not is_master(user["role"]):
            return 403, {"error": "마스터 권한이 필요합니다."}
        uid = params["user_id"]
        b   = body or {}
        account_ids = b.get("account_ids") or []
        role_row = conn.execute("SELECT role FROM users WHERE id=?", (uid,)).fetchone()
        if not role_row:
            return 404, {"error": "사용자를 찾을 수 없습니다."}
        role = role_row["role"]
        conn.execute("DELETE FROM user_accounts WHERE user_id=?", (uid,))
        for aid in account_ids:
            conn.execute("INSERT OR IGNORE INTO user_accounts (user_id,account_id,role) VALUES (?,?,?)",
                         (uid, aid, role))
        conn.commit()
        return 200, {"ok": True}

    # GET /api/workspaces/:id/ad-accounts  — 연결된 매체 광고계정
    @staticmethod
    def list_ad_accounts(body, user, conn, params):
        wid = params["ws_id"]
        wsr = workspace_role(conn, user["sub"], wid)
        if not wsr:
            return 403, {"error": "접근 권한이 없습니다."}
        rows = conn.execute(
            """SELECT aa.*, a.name AS account_label FROM ad_accounts aa
               LEFT JOIN accounts a ON a.id=aa.account_id
               WHERE aa.ws_id=? ORDER BY aa.id""", (wid,),
        ).fetchall()
        return 200, {"adAccounts": [dict(r) for r in rows], "canEdit": can_edit(wsr)}

    # POST /api/workspaces/:id/ad-accounts  — 매체 광고계정 연결 (편집권한)
    @staticmethod
    def connect_ad_account(body, user, conn, params):
        wid = params["ws_id"]
        wsr = workspace_role(conn, user["sub"], wid)
        if not wsr:
            return 403, {"error": "접근 권한이 없습니다."}
        if not can_edit(wsr):
            return 403, {"error": "편집 권한이 필요합니다."}
        b = body or {}
        if not b.get("media"):
            return 400, {"error": "media는 필수입니다."}
        cur = conn.execute(
            """INSERT INTO ad_accounts (ws_id,account_id,media,external_id,account_name,status,last_sync)
               VALUES (?,?,?,?,?,'connected',datetime('now'))""",
            (wid, b.get("account_id"), b["media"], b.get("external_id", ""),
             b.get("account_name", "")),
        )
        write_audit(conn, b.get("account_id"), user, "ad_account_connect",
                    f"{b['media']} 광고계정 연결: {b.get('account_name','')}")
        conn.commit()
        return 200, {"ok": True, "adAccountId": cur.lastrowid}

    # PATCH /api/ad-accounts/:id  {status}  — 연결 상태 변경/해제
    @staticmethod
    def update_ad_account(body, user, conn, params):
        aaid = params["aa_id"]
        row = conn.execute("SELECT * FROM ad_accounts WHERE id=?", (aaid,)).fetchone()
        if not row:
            return 404, {"error": "광고계정 연결을 찾을 수 없습니다."}
        wsr = workspace_role(conn, user["sub"], row["ws_id"])
        if not wsr or not can_edit(wsr):
            return 403, {"error": "편집 권한이 필요합니다."}
        new_status = (body or {}).get("status", "disconnected")
        conn.execute("UPDATE ad_accounts SET status=? WHERE id=?", (new_status, aaid))
        write_audit(conn, row["account_id"], user, "ad_account_update",
                    f"{row['media']} 연결 상태 → {new_status}")
        conn.commit()
        return 200, {"ok": True}

    # GET /api/workspaces/:id/integrations  — 외부 연동 목록
    @staticmethod
    def list_integrations(body, user, conn, params):
        wid = params["ws_id"]
        wsr = workspace_role(conn, user["sub"], wid)
        if not wsr:
            return 403, {"error": "접근 권한이 없습니다."}
        rows = conn.execute("SELECT * FROM integrations WHERE ws_id=? ORDER BY id", (wid,)).fetchall()
        return 200, {"integrations": [dict(r) for r in rows], "canEdit": can_edit(wsr)}

    # POST /api/workspaces/:id/integrations  — 외부 연동 추가
    @staticmethod
    def add_integration(body, user, conn, params):
        wid = params["ws_id"]
        wsr = workspace_role(conn, user["sub"], wid)
        if not wsr or not can_edit(wsr):
            return 403, {"error": "편집 권한이 필요합니다."}
        b = body or {}
        if b.get("type") not in ("ga4", "cafe24", "mmp", "sns"):
            return 400, {"error": "지원하지 않는 연동 유형입니다."}
        cur = conn.execute(
            "INSERT INTO integrations (ws_id,type,name,status) VALUES (?,?,?,'connected')",
            (wid, b["type"], b.get("name", b["type"])),
        )
        conn.commit()
        return 200, {"ok": True, "integrationId": cur.lastrowid}

    # GET /api/accounts  — 접근 가능한 계정만 (계정별 역할 포함)
    @staticmethod
    def list_accounts(body, user, conn, params):
        rows = conn.execute(
            """SELECT a.*, ua.role AS my_role FROM accounts a
               JOIN user_accounts ua ON ua.account_id=a.id
               WHERE ua.user_id=? ORDER BY a.id""",
            (user["sub"],),
        ).fetchall()
        out = []
        for a in rows:
            agg = conn.execute(
                "SELECT COALESCE(SUM(spend),0) AS spend, COUNT(*) AS n FROM media WHERE account_id=?",
                (a["id"],),
            ).fetchone()
            members = conn.execute(
                "SELECT COUNT(*) AS c FROM user_accounts WHERE account_id=?", (a["id"],)
            ).fetchone()["c"]
            out.append({
                "id": a["id"], "name": a["name"], "advertiser": a["advertiser"],
                "color": a["color"], "myRole": a["my_role"],
                "spend": agg["spend"], "memberCount": members,
            })
        return 200, {"accounts": out}

    # GET /api/accounts/:id/media
    @staticmethod
    def list_media(body, user, conn, params):
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "이 계정에 접근할 권한이 없습니다."}
        rows = conn.execute("SELECT * FROM media WHERE account_id=? ORDER BY spend DESC", (aid,)).fetchall()
        media = [dict(r) for r in rows]
        return 200, {"media": media, "canEdit": can_edit(role), "myRole": role}

    # GET /api/accounts/:id/campaigns?media=&status=
    @staticmethod
    def list_campaigns(body, user, conn, params):
        import urllib.parse as up
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        q = up.parse_qs(params.get("_query", ""))
        media_filter  = (q.get("media",  [""])[0])
        status_filter = (q.get("status", [""])[0])
        sql = "SELECT * FROM campaigns WHERE account_id=?"
        args = [aid]
        if media_filter:  sql += " AND media_key=?"; args.append(media_filter)
        if status_filter: sql += " AND status=?";    args.append(status_filter)
        sql += " ORDER BY spend DESC"
        rows = conn.execute(sql, args).fetchall()
        return 200, {"campaigns": [dict(r) for r in rows]}

    # GET /api/accounts/:id/device-breakdown?from=&to=&media=
    @staticmethod
    def device_breakdown(body, user, conn, params):
        import urllib.parse as up
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        q = up.parse_qs(params.get("_query", ""))
        from_date = (q.get("from",  [""])[0])
        to_date   = (q.get("to",    [""])[0])
        media_key = (q.get("media", [""])[0])
        sql = ("SELECT date, media_key, device, metric_key, SUM(value) as value "
               "FROM campaign_metrics WHERE account_id=? AND campaign_type='all'")
        args = [aid]
        if from_date: sql += " AND date>=?"; args.append(from_date)
        if to_date:   sql += " AND date<=?"; args.append(to_date)
        if media_key: sql += " AND media_key=?"; args.append(media_key)
        sql += " GROUP BY date, media_key, device, metric_key ORDER BY date, media_key, device"
        rows = conn.execute(sql, args).fetchall()
        return 200, {"breakdown": [dict(r) for r in rows]}

    # GET /api/accounts/:id/product-breakdown?from=&to=&media=
    @staticmethod
    def product_breakdown(body, user, conn, params):
        import urllib.parse as up
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        q = up.parse_qs(params.get("_query", ""))
        from_date = (q.get("from",  [""])[0])
        to_date   = (q.get("to",    [""])[0])
        media_key = (q.get("media", [""])[0])
        sql = ("SELECT date, media_key, campaign_type, metric_key, SUM(value) as value "
               "FROM campaign_metrics WHERE account_id=? AND device='all' AND campaign_type!='all'")
        args = [aid]
        if from_date: sql += " AND date>=?"; args.append(from_date)
        if to_date:   sql += " AND date<=?"; args.append(to_date)
        if media_key: sql += " AND media_key=?"; args.append(media_key)
        sql += " GROUP BY date, media_key, campaign_type, metric_key ORDER BY date, media_key, campaign_type"
        rows = conn.execute(sql, args).fetchall()
        return 200, {"breakdown": [dict(r) for r in rows]}

    # GET /api/accounts/:id/raw-metrics?from=&to=&media=&breakdown=none|device|product
    @staticmethod
    def raw_metrics(body, user, conn, params):
        import urllib.parse as up
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        q = up.parse_qs(params.get("_query", ""))
        from_date = (q.get("from",      [""])[0])
        to_date   = (q.get("to",        [""])[0])
        media_key = (q.get("media",     [""])[0])
        breakdown = (q.get("breakdown", ["none"])[0])
        # breakdown=none → metric_data(일별 매체 합계); device/product → campaign_metrics
        if breakdown == "none":
            sql = (
                "SELECT date, media as media_key,"
                " SUM(CASE WHEN metric_key='cost'  THEN value ELSE 0 END) as cost,"
                " SUM(CASE WHEN metric_key='imp'   THEN value ELSE 0 END) as imp,"
                " SUM(CASE WHEN metric_key='click' THEN value ELSE 0 END) as click,"
                " SUM(CASE WHEN metric_key='conv'  THEN value ELSE 0 END) as conv"
                " FROM metric_data WHERE account_id=?"
            )
            args = [aid]
            if from_date: sql += " AND date>=?"; args.append(from_date)
            if to_date:   sql += " AND date<=?"; args.append(to_date)
            if media_key: sql += " AND media=?"; args.append(media_key)
            sql += " GROUP BY date, media ORDER BY date, media"
        elif breakdown == "both":
            sql = (
                "SELECT date, media_key, device, campaign_type,"
                " SUM(CASE WHEN metric_key='cost'  THEN value ELSE 0 END) as cost,"
                " SUM(CASE WHEN metric_key='imp'   THEN value ELSE 0 END) as imp,"
                " SUM(CASE WHEN metric_key='click' THEN value ELSE 0 END) as click,"
                " SUM(CASE WHEN metric_key='conv'  THEN value ELSE 0 END) as conv"
                " FROM campaign_metrics WHERE account_id=? AND device!='all' AND campaign_type!='all'"
            )
            args = [aid]
            if from_date: sql += " AND date>=?"; args.append(from_date)
            if to_date:   sql += " AND date<=?"; args.append(to_date)
            if media_key: sql += " AND media_key=?"; args.append(media_key)
            sql += " GROUP BY date, media_key, device, campaign_type ORDER BY date, media_key"
        else:
            if breakdown == "device":
                extra_col = ", device"
                wf = "device!='all' AND campaign_type='all'"
            else:
                extra_col = ", campaign_type"
                wf = "device='all' AND campaign_type!='all'"
            sql = (
                f"SELECT date, media_key{extra_col},"
                " SUM(CASE WHEN metric_key='cost'  THEN value ELSE 0 END) as cost,"
                " SUM(CASE WHEN metric_key='imp'   THEN value ELSE 0 END) as imp,"
                " SUM(CASE WHEN metric_key='click' THEN value ELSE 0 END) as click,"
                " SUM(CASE WHEN metric_key='conv'  THEN value ELSE 0 END) as conv"
                f" FROM campaign_metrics WHERE account_id=? AND {wf}"
            )
            args = [aid]
            if from_date: sql += " AND date>=?"; args.append(from_date)
            if to_date:   sql += " AND date<=?"; args.append(to_date)
            if media_key: sql += " AND media_key=?"; args.append(media_key)
            sql += f" GROUP BY date, media_key{extra_col} ORDER BY date, media_key"
        rows = conn.execute(sql, args).fetchall()
        return 200, {"rows": [dict(r) for r in rows], "total": len(rows)}

    # GET /api/accounts/:id/raw-hierarchy?from=&to=&media=&level=campaign|adgroup|keyword|creative
    @staticmethod
    def raw_hierarchy(body, user, conn, params):
        import urllib.parse as up
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        q         = up.parse_qs(params.get("_query", ""))
        from_date = (q.get("from",  [""])[0])
        to_date   = (q.get("to",   [""])[0])
        media_key = (q.get("media", [""])[0])
        level     = (q.get("level", ["campaign"])[0])
        with_dev  = q.get("with_device", [""])[0] == "1"
        # campaign_type은 캠페인 고유 속성 — 항상 GROUP BY에 포함
        group_map = {
            "campaign": "date,media_key,campaign,campaign_type",
            "adgroup":  "date,media_key,campaign,campaign_type,adgroup",
            "keyword":  "date,media_key,campaign,campaign_type,adgroup,keyword",
            "creative": "date,media_key,campaign,campaign_type,adgroup,keyword,creative",
        }
        gcols = group_map.get(level, "date,media_key,campaign,campaign_type")
        if with_dev:
            gcols += ",device"
        sql = (
            f"SELECT {gcols},"
            " SUM(cost) as cost, SUM(imp) as imp, SUM(click) as click,"
            " SUM(conv) as conv, SUM(conv_native) as conv_native,"
            " SUM(conv_ga4) as conv_ga4, SUM(conv_mmp) as conv_mmp,"
            " SUM(conv_manual) as conv_manual"
            " FROM ad_hierarchy WHERE account_id=?"
        )
        args = [aid]
        if from_date: sql += " AND date>=?"; args.append(from_date)
        if to_date:   sql += " AND date<=?"; args.append(to_date)
        if media_key: sql += " AND media_key=?"; args.append(media_key)
        sql += f" GROUP BY {gcols} ORDER BY date,media_key"
        rows = [dict(r) for r in conn.execute(sql, args).fetchall()]
        # 수기 전환 데이터 입력(conv_id별) 병합은 프론트엔드 fetchRawData()가 담당한다
        # (conv_id_{id} 단위로 정확히 병합 — 여기서 "(수기입력)" 합성 행을 만들면 중복·구버전 conv 필드로 충돌한다)
        return 200, {"rows": rows, "total": len(rows)}

    # PATCH /api/media/:id  {is_on}  — 편집 권한 필요
    @staticmethod
    def update_media(body, user, conn, params):
        mid = params["media_id"]
        row = conn.execute("SELECT * FROM media WHERE id=?", (mid,)).fetchone()
        if not row:
            return 404, {"error": "매체를 찾을 수 없습니다."}
        role = account_role(conn, user["sub"], row["account_id"])
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        if not can_edit(role):
            return 403, {"error": "편집 권한이 필요합니다. (광고주는 조회 전용)"}
        if "is_on" in (body or {}):
            new_on = 1 if body["is_on"] else 0
            conn.execute("UPDATE media SET is_on=? WHERE id=?", (new_on, mid))
            write_audit(conn, row["account_id"], user, "media_toggle",
                        f"{row['name']} → {'ON' if new_on else 'OFF'}")
        if "spend" in (body or {}):
            conn.execute("UPDATE media SET spend=? WHERE id=?", (int(body["spend"]), mid))
            write_audit(conn, row["account_id"], user, "media_budget",
                        f"{row['name']} 예산 → {body['spend']}")
        conn.commit()
        return 200, {"ok": True}

    # GET /api/accounts/:id/rules
    @staticmethod
    def list_rules(body, user, conn, params):
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        rows = conn.execute("SELECT * FROM rules WHERE account_id=? ORDER BY id", (aid,)).fetchall()
        return 200, {"rules": [dict(r) for r in rows], "canEdit": can_edit(role)}

    # POST /api/accounts/:id/rules  — 규칙 생성 (편집 권한)
    @staticmethod
    def create_rule(body, user, conn, params):
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        if not can_edit(role):
            return 403, {"error": "편집 권한이 필요합니다."}
        b = body or {}
        name = (b.get("name") or "").strip()
        if not name:
            return 400, {"error": "규칙 이름은 필수입니다."}
        cur = conn.execute(
            "INSERT INTO rules (account_id,name,description,level,schedule,active) VALUES (?,?,?,?,?,?)",
            (aid, name, b.get("description", ""), b.get("level", "캠페인"),
             b.get("schedule", "실시간"), 1 if b.get("active", True) else 0),
        )
        rid = cur.lastrowid
        write_audit(conn, aid, user, "rule_create", f"규칙 생성: {name}")
        conn.commit()
        row = conn.execute("SELECT * FROM rules WHERE id=?", (rid,)).fetchone()
        return 200, {"ok": True, "rule": dict(row)}

    # PATCH /api/rules/:id  {active?, name?, description?, level?, schedule?}  — 수정/토글 (편집 권한)
    @staticmethod
    def update_rule(body, user, conn, params):
        rid = params["rule_id"]
        rule = conn.execute("SELECT * FROM rules WHERE id=?", (rid,)).fetchone()
        if not rule:
            return 404, {"error": "규칙을 찾을 수 없습니다."}
        role = account_role(conn, user["sub"], rule["account_id"])
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        if not can_edit(role):
            return 403, {"error": "편집 권한이 필요합니다."}
        b = body or {}
        if "active" in b:
            new_active = 1 if b["active"] else 0
            conn.execute("UPDATE rules SET active=? WHERE id=?", (new_active, rid))
            write_audit(conn, rule["account_id"], user, "rule_toggle",
                        f"{rule['name']} → {'활성' if new_active else '비활성'}")
        for f in ("name", "description", "level", "schedule"):
            if f in b:
                conn.execute(f"UPDATE rules SET {f}=? WHERE id=?", (b[f], rid))
        conn.commit()
        return 200, {"ok": True}

    # DELETE /api/rules/:id  — 규칙 삭제 (편집 권한)
    @staticmethod
    def delete_rule(body, user, conn, params):
        rid = params["rule_id"]
        rule = conn.execute("SELECT * FROM rules WHERE id=?", (rid,)).fetchone()
        if not rule:
            return 404, {"error": "규칙을 찾을 수 없습니다."}
        role = account_role(conn, user["sub"], rule["account_id"])
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        if not can_edit(role):
            return 403, {"error": "편집 권한이 필요합니다."}
        conn.execute("DELETE FROM rules WHERE id=?", (rid,))
        write_audit(conn, rule["account_id"], user, "rule_delete", f"규칙 삭제: {rule['name']}")
        conn.commit()
        return 200, {"ok": True}

    # GET /api/accounts/:id/rule-executions  — 자동 규칙 실행 로그 (계정별)
    @staticmethod
    def list_rule_executions(body, user, conn, params):
        import json as _json
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        rows = conn.execute(
            """SELECT e.*, r.name AS rule_name FROM rule_executions e
               LEFT JOIN rules r ON r.id = e.rule_id
               WHERE e.account_id=? AND e.mode='live'
               ORDER BY e.id DESC LIMIT 50""",
            (aid,),
        ).fetchall()
        out = []
        for e in rows:
            try:
                impacts = _json.loads(e["affected"] or "[]")
            except Exception:
                impacts = []
            out.append({"id": e["id"], "ruleName": e["rule_name"] or "(삭제된 규칙)",
                        "executedAt": e["executed_at"], "undone": bool(e["undone"]),
                        "impacts": impacts})
        return 200, {"executions": out}

    # ───────── 설정: 전환설정 (계정별 전환 출처/네이밍 매핑) ─────────
    @staticmethod
    def list_conversions(body, user, conn, params):
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        rows = conn.execute("SELECT * FROM conversion_settings WHERE account_id=? ORDER BY id", (aid,)).fetchall()
        return 200, {"conversions": [dict(r) for r in rows], "canEdit": can_edit(role)}

    @staticmethod
    def create_conversion(body, user, conn, params):
        import json as _json
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        if not can_edit(role):
            return 403, {"error": "편집 권한이 필요합니다."}
        b = body or {}
        sol = (b.get("solution_metric") or "").strip()
        if not sol:
            return 400, {"error": "솔루션 지표명은 필수입니다."}
        cur = conn.execute(
            "INSERT INTO conversion_settings (account_id,source,source_metric,solution_metric,value_type,config,col_group) VALUES (?,?,?,?,?,?,?)",
            (aid, b.get("source", "manual"), b.get("source_metric", ""), sol,
             b.get("value_type", "count"), _json.dumps(b.get("config", {}), ensure_ascii=False),
             b.get("col_group", "conv")))
        write_audit(conn, aid, user, "conversion_create", f"전환설정 추가: {sol} ({b.get('source','manual')})")
        conn.commit()
        return 200, {"ok": True, "id": cur.lastrowid}

    @staticmethod
    def update_conversion(body, user, conn, params):
        import json as _json
        cid = params["conv_id"]
        row = conn.execute("SELECT * FROM conversion_settings WHERE id=?", (cid,)).fetchone()
        if not row:
            return 404, {"error": "전환설정을 찾을 수 없습니다."}
        role = account_role(conn, user["sub"], row["account_id"])
        if not role or not can_edit(role):
            return 403, {"error": "편집 권한이 필요합니다."}
        b = body or {}
        for f in ("source", "source_metric", "solution_metric", "value_type", "active", "col_group"):
            if f in b:
                conn.execute(f"UPDATE conversion_settings SET {f}=? WHERE id=?", (b[f], cid))
        if "config" in b:
            conn.execute("UPDATE conversion_settings SET config=? WHERE id=?",
                         (_json.dumps(b["config"], ensure_ascii=False), cid))
        conn.commit()
        return 200, {"ok": True}

    @staticmethod
    def delete_conversion(body, user, conn, params):
        cid = params["conv_id"]
        row = conn.execute("SELECT * FROM conversion_settings WHERE id=?", (cid,)).fetchone()
        if not row:
            return 404, {"error": "전환설정을 찾을 수 없습니다."}
        role = account_role(conn, user["sub"], row["account_id"])
        if not role or not can_edit(role):
            return 403, {"error": "편집 권한이 필요합니다."}
        conn.execute("DELETE FROM conversion_settings WHERE id=?", (cid,))
        write_audit(conn, row["account_id"], user, "conversion_delete", f"전환설정 삭제: {row['solution_metric']}")
        conn.commit()
        return 200, {"ok": True}

    # ───────── 지표 사전 (분석 메뉴가 소비) ─────────
    @staticmethod
    def metric_catalog(body, user, conn, params):
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        base = [{"key": "imp", "name": "노출수"}, {"key": "click", "name": "클릭수"},
                {"key": "cost", "name": "광고비"}, {"key": "cpc", "name": "CPC"}, {"key": "cpm", "name": "CPM"}]
        conv = conn.execute(
            "SELECT solution_metric,source,value_type FROM conversion_settings WHERE account_id=? AND active=1 ORDER BY id",
            (aid,)).fetchall()
        return 200, {
            "base": base,
            "conversion": [{"name": r["solution_metric"], "source": r["source"], "type": r["value_type"]} for r in conv],
        }

    # ───────── Phase 8: 운영 신뢰성 ─────────

    # PATCH /api/users/:uid/accounts/:aid  {role}  — 계정별 역할 변경 (마스터 전용)
    @staticmethod
    def set_account_role(body, user, conn, params):
        if not is_master(user["role"]):
            return 403, {"error": "마스터 권한이 필요합니다."}
        uid, aid = params["user_id"], params["account_id"]
        new_role = (body or {}).get("role")
        if new_role not in ("user", "advertiser", "master"):
            return 400, {"error": "유효하지 않은 역할입니다."}
        exists = conn.execute(
            "SELECT 1 FROM user_accounts WHERE user_id=? AND account_id=?", (uid, aid)
        ).fetchone()
        if exists:
            conn.execute("UPDATE user_accounts SET role=? WHERE user_id=? AND account_id=?",
                         (new_role, uid, aid))
        else:
            conn.execute("INSERT INTO user_accounts (user_id,account_id,role) VALUES (?,?,?)",
                         (uid, aid, new_role))
        write_audit(conn, aid, user, "role_change", f"{uid} → {new_role} (계정 {aid})")
        conn.commit()
        return 200, {"ok": True, "userId": uid, "accountId": aid, "role": new_role}

    # POST /api/accounts/:id/notify  {level,title,message,channel}  — 알림 생성 + 발송 시뮬레이션
    @staticmethod
    def create_notification(body, user, conn, params):
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role or not can_edit(role):
            return 403, {"error": "권한이 없습니다."}
        b = body or {}
        cur = conn.execute(
            "INSERT INTO notifications (account_id,level,channel,title,message) VALUES (?,?,?,?,?)",
            (aid, b.get("level", "info"), b.get("channel", "email"),
             b.get("title", "알림"), b.get("message", "")),
        )
        # 실제 발송은 여기서 메일/슬랙 API 호출 (데모: 큐 적재로 대체)
        conn.commit()
        return 200, {"ok": True, "notificationId": cur.lastrowid, "dispatched": b.get("channel", "email")}

    # GET /api/accounts/:id/notifications
    @staticmethod
    def list_notifications(body, user, conn, params):
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        rows = conn.execute(
            "SELECT * FROM notifications WHERE account_id=? ORDER BY id DESC LIMIT 30", (aid,)
        ).fetchall()
        unread = conn.execute(
            "SELECT COUNT(*) AS c FROM notifications WHERE account_id=? AND read=0", (aid,)
        ).fetchone()["c"]
        return 200, {"notifications": [dict(r) for r in rows], "unread": unread}

    # GET /api/users  — 마스터 전용
    @staticmethod
    def list_users(body, user, conn, params):
        if not is_master(user["role"]):
            return 403, {"error": "마스터 권한이 필요합니다."}
        rows = conn.execute("SELECT * FROM users ORDER BY created_at").fetchall()
        out = []
        for u in rows:
            accs = conn.execute(
                "SELECT account_id FROM user_accounts WHERE user_id=?", (u["id"],)
            ).fetchall()
            out.append({"id": u["id"], "name": u["name"], "email": u["email"],
                        "role": u["role"], "avatarColor": u["avatar_color"],
                        "lastLogin": u["last_login"], "active": bool(u["active"]),
                        "status": u["status"] if "status" in u.keys() else "active",
                        "accounts": [a["account_id"] for a in accs]})
        return 200, {"users": out}

    # GET /api/accounts/:id/audit  — 감사 로그 (마스터/사용자)
    @staticmethod
    def list_audit(body, user, conn, params):
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        rows = conn.execute(
            "SELECT * FROM audit_log WHERE account_id=? ORDER BY id DESC LIMIT 50", (aid,)
        ).fetchall()
        return 200, {"audit": [dict(r) for r in rows]}

    # GET /api/accounts/:id/messages — 같은 계정을 관리하는 마스터·사용자간 팀 메시지
    @staticmethod
    def list_messages(body, user, conn, params):
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if role not in ("master", "user"):
            return 403, {"error": "접근 권한이 없습니다."}
        rows = conn.execute(
            "SELECT * FROM account_messages WHERE account_id=? ORDER BY id DESC LIMIT 100", (aid,)
        ).fetchall()
        return 200, {"messages": [dict(r) for r in rows]}

    # POST /api/accounts/:id/messages {text}
    @staticmethod
    def create_message(body, user, conn, params):
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if role not in ("master", "user"):
            return 403, {"error": "접근 권한이 없습니다."}
        text = ((body or {}).get("text") or "").strip()
        if not text:
            return 400, {"error": "메시지 내용을 입력하세요."}
        conn.execute(
            "INSERT INTO account_messages (account_id,user_id,user_name,role,text) VALUES (?,?,?,?,?)",
            (aid, user["sub"], user["name"], user["role"], text),
        )
        conn.commit()
        return 200, {"ok": True}

    # ───────── Ph E: 누적 store + 리포트 설정 ─────────

    # GET /api/accounts/:id/metric-data?from=&to=&media=
    @staticmethod
    def list_metric_data(body, user, conn, params):
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        import urllib.parse as up
        q = up.parse_qs(params.get("_query", ""))
        d_from = (q.get("from", [""])[0]) or "2000-01-01"
        d_to   = (q.get("to", [""])[0])   or "2099-12-31"
        media  = q.get("media", [""])[0]
        if media:
            rows = conn.execute(
                "SELECT * FROM metric_data WHERE account_id=? AND date>=? AND date<=? AND media=? ORDER BY date,media,metric_key",
                (aid, d_from, d_to, media)).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM metric_data WHERE account_id=? AND date>=? AND date<=? ORDER BY date,media,metric_key",
                (aid, d_from, d_to)).fetchall()
        data = [dict(r) for r in rows]

        # 수기 전환 데이터 입력(주 전환지표)을 conv 합계에 병합 — 대시보드·리포트 요약에 자동 반영
        convs = conn.execute(
            "SELECT id,value_type FROM conversion_settings WHERE account_id=? AND active=1 ORDER BY id", (aid,)
        ).fetchall()
        primary = next((c for c in convs if c["value_type"] == "count"), convs[0] if convs else None)
        if primary:
            mc_sql = ("SELECT date,media,SUM(value) as value FROM manual_conv_data "
                       "WHERE account_id=? AND conv_id=? AND date>=? AND date<=?")
            mc_args = [aid, primary["id"], d_from, d_to]
            if media: mc_sql += " AND media=?"; mc_args.append(media)
            mc_sql += " GROUP BY date,media"
            for r in conn.execute(mc_sql, mc_args).fetchall():
                if r["value"]:
                    data.append({"account_id": aid, "date": r["date"], "media": r["media"],
                                 "metric_key": "conv", "value": r["value"]})
        return 200, {"data": data, "count": len(data)}

    # POST /api/accounts/:id/metric-data/pull — 수동 데이터 갱신 트리거
    @staticmethod
    def pull_metric_data(body, user, conn, params):
        import json as _json, hashlib as _hs
        from datetime import datetime as _dt
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role or not can_edit(role):
            return 403, {"error": "편집 권한이 필요합니다."}
        b = body or {}
        target_date = b.get("date") or _dt.now().date().isoformat()

        media_list = conn.execute(
            "SELECT DISTINCT media FROM media_credentials WHERE account_id=?", (aid,)
        ).fetchall()
        if not media_list:
            media_list = [{"media": m} for m in ["meta", "google", "naver_sa", "kakao"]]

        inserted = 0
        errors = []

        for mr in media_list:
            m = mr["media"]

            # 저장된 자격증명 로드
            cred_row = conn.execute(
                "SELECT creds_json FROM media_credentials WHERE account_id=? AND media=?",
                (aid, m)).fetchone()
            creds = {}
            if cred_row:
                try:
                    creds = _json.loads(cred_row["creds_json"])
                except Exception:
                    creds = {}

            # 실 커넥터 호출 (자격증명이 있을 때만)
            fetched = False
            if creds:
                connector = MEDIA_CONNECTORS.get(m)
                if connector:
                    try:
                        metric_rows = connector.fetch_daily_metrics(creds, target_date, target_date)
                        for row in metric_rows:
                            conn.execute(
                                "INSERT OR REPLACE INTO metric_data (account_id,date,media,metric_key,value) VALUES (?,?,?,?,?)",
                                (aid, row["date"], row["media"], row["metric_key"], row["value"]))
                            inserted += 1
                        if metric_rows:
                            fetched = True
                    except Exception as e:
                        errors.append(f"{m}: {str(e)[:80]}")

            # 자격증명 미설정 시 스킵 (데모 데이터 생성 안 함)
            if not fetched:
                if not creds:
                    errors.append(f"{m}: API 자격증명이 설정되지 않았습니다")
                # fetched=False + creds 있음인 경우 이미 위에서 errors에 추가됨

        # ── 전환 소스(GA4 등) — conversion_settings.config에 저장된 자격증명으로 조회 ──
        conv_rows = conn.execute(
            "SELECT id, source, config FROM conversion_settings WHERE account_id=? AND active=1 AND source!='manual'",
            (aid,)).fetchall()
        for cr in conv_rows:
            try:
                conv_creds = _json.loads(cr["config"] or "{}")
            except Exception:
                conv_creds = {}
            if not conv_creds:
                continue
            connector = MEDIA_CONNECTORS.get(cr["source"])
            if not connector:
                continue
            try:
                metric_rows = connector.fetch_daily_metrics(conv_creds, target_date, target_date)
                for row in metric_rows:
                    conn.execute(
                        "INSERT OR REPLACE INTO metric_data (account_id,date,media,metric_key,value) VALUES (?,?,?,?,?)",
                        (aid, row["date"], row["media"], row["metric_key"], row["value"]))
                    inserted += 1
            except Exception as e:
                errors.append(f"{cr['source']}: {str(e)[:80]}")

        conn.execute(
            "UPDATE report_config SET last_pull=datetime('now') WHERE account_id=?", (aid,))
        write_audit(conn, aid, user, "metric_pull", f"데이터 갱신: {inserted}건 ({target_date})")
        conn.commit()
        result = {"ok": True, "date": target_date, "inserted": inserted}
        if errors:
            result["errors"] = errors
        return 200, result

    # ───────── 매체 자격증명 CRUD ─────────

    # GET /api/accounts/:id/media-credentials
    @staticmethod
    def get_media_credentials(body, user, conn, params):
        import json as _json
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        rows = conn.execute(
            "SELECT id, media, updated_at, creds_json FROM media_credentials WHERE account_id=? ORDER BY media",
            (aid,)).fetchall()
        # 저장된 자격증명이 있으면 ad_accounts에도 자동 반영 (연동 매체 표시 동기화)
        acc_row = conn.execute("SELECT ws_id FROM accounts WHERE id=?", (aid,)).fetchone()
        if acc_row and acc_row["ws_id"]:
            ws_id = acc_row["ws_id"]
            changed = False
            for r in rows:
                existing = conn.execute(
                    "SELECT id FROM ad_accounts WHERE ws_id=? AND account_id=? AND media=?",
                    (ws_id, aid, r["media"])).fetchone()
                if not existing:
                    conn.execute(
                        "INSERT INTO ad_accounts (ws_id,account_id,media,account_name,external_id,status,last_sync) VALUES (?,?,?,?,?,?,datetime('now'))",
                        (ws_id, aid, r["media"], f'{r["media"]} 광고계정', f'cred_{aid}', 'connected'))
                    changed = True
            if changed:
                conn.commit()
        out = []
        for r in rows:
            raw = {}
            try: raw = _json.loads(r["creds_json"] or '{}')
            except: pass
            out.append({"id": r["id"], "media": r["media"], "updated_at": r["updated_at"], "creds": raw})
        return 200, {"credentials": out}

    # POST /api/accounts/:id/media-credentials  {media, creds:{...}}
    @staticmethod
    def save_media_credentials(body, user, conn, params):
        import json as _json
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role or not can_edit(role):
            return 403, {"error": "편집 권한이 필요합니다."}
        b = body or {}
        media = (b.get("media") or "").strip()
        creds = b.get("creds") or {}
        if not media:
            return 400, {"error": "media 필드가 필요합니다."}
        conn.execute(
            "INSERT INTO media_credentials (account_id, media, creds_json, updated_at) VALUES (?,?,?,datetime('now')) "
            "ON CONFLICT(account_id, media) DO UPDATE SET creds_json=excluded.creds_json, updated_at=excluded.updated_at",
            (aid, media, _json.dumps(creds, ensure_ascii=False)))
        # 자격증명 저장 시 ad_accounts에도 자동 반영
        acc_row = conn.execute("SELECT ws_id FROM accounts WHERE id=?", (aid,)).fetchone()
        if acc_row and acc_row["ws_id"]:
            ws_id = acc_row["ws_id"]
            existing = conn.execute(
                "SELECT id FROM ad_accounts WHERE ws_id=? AND account_id=? AND media=?",
                (ws_id, aid, media)).fetchone()
            if existing:
                conn.execute("UPDATE ad_accounts SET status='connected',last_sync=datetime('now') WHERE id=?", (existing["id"],))
            else:
                conn.execute(
                    "INSERT INTO ad_accounts (ws_id,account_id,media,account_name,external_id,status,last_sync) VALUES (?,?,?,?,?,?,datetime('now'))",
                    (ws_id, aid, media, f'{media} 광고계정', f'cred_{aid}', 'connected'))
        # 자격증명 저장 시 media 테이블에도 즉시 upsert (드롭다운 즉시 표시되도록)
        connector = MEDIA_CONNECTORS.get(media)
        media_name = connector.label if connector else media
        media_color_val = MEDIA_COLOR.get(media, '#64748B')
        existing_media = conn.execute(
            "SELECT id FROM media WHERE account_id=? AND media_key=?", (aid, media)).fetchone()
        if existing_media:
            conn.execute("UPDATE media SET is_on=1, connected=1 WHERE id=?", (existing_media["id"],))
        else:
            conn.execute(
                """INSERT INTO media (account_id,name,color,spend,imp,click,cvr,roas,cpa,
                   is_on,connected,media_key,last_sync)
                   VALUES (?,?,?,0,0,0,0,0,0,1,1,?,datetime('now'))""",
                (aid, media_name, media_color_val, media))
        write_audit(conn, aid, user, "save_credentials", f"{media} API 자격증명 저장")
        conn.commit()
        return 200, {"ok": True, "media": media}

    # DELETE /api/media-credentials/:cred_id
    @staticmethod
    def delete_media_credentials(body, user, conn, params):
        cred_id = params["cred_id"]
        row = conn.execute("SELECT * FROM media_credentials WHERE id=?", (cred_id,)).fetchone()
        if not row:
            return 404, {"error": "자격증명을 찾을 수 없습니다."}
        role = account_role(conn, user["sub"], row["account_id"])
        if not role or not can_edit(role):
            return 403, {"error": "편집 권한이 필요합니다."}
        conn.execute("DELETE FROM media_credentials WHERE id=?", (cred_id,))
        # ad_accounts와 media 테이블에서도 연결 해제
        acc_row = conn.execute("SELECT ws_id FROM accounts WHERE id=?", (row["account_id"],)).fetchone()
        if acc_row and acc_row["ws_id"]:
            conn.execute(
                "UPDATE ad_accounts SET status='disconnected' WHERE ws_id=? AND account_id=? AND media=?",
                (acc_row["ws_id"], row["account_id"], row["media"]))
        conn.execute(
            "UPDATE media SET is_on=0, connected=0 WHERE account_id=? AND media_key=?",
            (row["account_id"], row["media"]))
        write_audit(conn, row["account_id"], user, "delete_credentials", f"{row['media']} 자격증명 삭제")
        conn.commit()
        return 200, {"ok": True}

    # GET /api/connectors/:media/fields
    @staticmethod
    def connector_fields(body, user, conn, params):
        c = MEDIA_CONNECTORS.get(params["media"])
        if not c:
            return 404, {"error": "지원하지 않는 매체입니다."}
        return 200, {
            "media": c.key, "label": c.label,
            "authType": getattr(c, "auth_type", "oauth"),
            "fields": c.credential_fields,
            "guide": getattr(c, "guide", ""),
        }

    # ───────── 설정: 매체-솔루션 컬럼 매핑 CRUD (Raw 수동 업로드 헤더 인식용) ─────────

    # GET /api/accounts/:id/media-metric-map?media=X
    @staticmethod
    def get_media_metric_map(body, user, conn, params):
        import urllib.parse as up
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        q = up.parse_qs(params.get("_query", ""))
        media = q.get("media", [""])[0]
        sql = "SELECT media,metric_key,provider_field FROM media_metric_map WHERE account_id=?"
        args = [aid]
        if media:
            sql += " AND media=?"; args.append(media)
        sql += " ORDER BY media,metric_key"
        rows = conn.execute(sql, args).fetchall()
        return 200, {"mappings": [dict(r) for r in rows]}

    # POST /api/accounts/:id/media-metric-map  {media, mappings:[{metric_key,provider_field}]}
    @staticmethod
    def save_media_metric_map(body, user, conn, params):
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role or not can_edit(role):
            return 403, {"error": "편집 권한이 필요합니다."}
        b = body or {}
        media = (b.get("media") or "").strip()
        mappings = b.get("mappings", [])
        if not media or not mappings:
            return 400, {"error": "media, mappings 필드가 필요합니다."}
        saved = 0
        for m in mappings:
            metric_key = (m.get("metric_key") or "").strip()
            if not metric_key:
                continue
            conn.execute(
                "INSERT INTO media_metric_map (account_id,media,metric_key,provider_field,updated_at) VALUES (?,?,?,?,datetime('now')) "
                "ON CONFLICT(account_id,media,metric_key) DO UPDATE SET provider_field=excluded.provider_field, updated_at=excluded.updated_at",
                (aid, media, metric_key, m.get("provider_field", "")))
            saved += 1
        write_audit(conn, aid, user, "save_media_metric_map", f"{media} 컬럼 매핑 {saved}건 저장")
        conn.commit()
        return 200, {"ok": True, "saved": saved}

    # ───────── 수기 매체 Raw 업로드 지표 CRUD ─────────

    # GET /api/accounts/:id/manual-metrics?from=&to=&media=
    @staticmethod
    def get_manual_metrics(body, user, conn, params):
        import urllib.parse as up
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        q = up.parse_qs(params.get("_query", ""))
        from_date = q.get("from", [""])[0]
        to_date   = q.get("to",   [""])[0]
        media     = q.get("media", [""])[0]
        sql = "SELECT * FROM manual_metrics WHERE account_id=?"
        args = [aid]
        if from_date: sql += " AND date>=?"; args.append(from_date)
        if to_date:   sql += " AND date<=?"; args.append(to_date)
        if media:     sql += " AND media=?"; args.append(media)
        sql += " ORDER BY date, media"
        rows = conn.execute(sql, args).fetchall()
        return 200, {"rows": [dict(r) for r in rows]}

    # POST /api/accounts/:id/manual-metrics  {rows: [{date,media,cost,imp,click,...}]}
    @staticmethod
    def upsert_manual_metrics(body, user, conn, params):
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role or role == "advertiser":
            return 403, {"error": "편집 권한이 없습니다."}
        rows = (body or {}).get("rows", [])
        if not rows:
            return 400, {"error": "rows 필드가 비어있습니다."}
        inserted = 0
        for r in rows:
            conn.execute("""
                INSERT OR REPLACE INTO manual_metrics
                    (account_id,date,media,campaign,adgroup,keyword,creative,campaign_type,device,
                     cost,imp,click,conv_native,conv_ga4,conv_mmp,conv_manual)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                aid,
                r.get("date",""), r.get("media",""),
                r.get("campaign",""), r.get("adgroup",""),
                r.get("keyword",""), r.get("creative",""),
                r.get("campaign_type",""), r.get("device",""),
                r.get("cost",0), r.get("imp",0), r.get("click",0),
                r.get("conv_native",0), r.get("conv_ga4",0),
                r.get("conv_mmp",0), r.get("conv_manual",0),
            ))
            inserted += 1
        medias = sorted({(r.get("media") or "").strip() for r in rows if r.get("media")})
        media_label = medias[0] if len(medias) == 1 else f"{len(medias)}개 매체"
        dates = sorted({(r.get("date") or "").strip() for r in rows if r.get("date")})
        date_label = (dates[0] if dates[0] == dates[-1] else f"{dates[0]}~{dates[-1]}") if dates else ""
        sum_labels = [("cost", "광고비"), ("imp", "노출수"), ("click", "클릭수"),
                      ("conv_native", "전환(매체픽셀)"), ("conv_ga4", "전환(GA4)"),
                      ("conv_mmp", "전환(MMP)"), ("conv_manual", "전환(수기)")]
        sum_parts = []
        for key, label in sum_labels:
            total = sum(float(r.get(key, 0) or 0) for r in rows)
            if total:
                sum_parts.append(f"{label} {total:,.0f}")
        detail = media_label
        if date_label: detail += f" · {date_label}"
        detail += f" · {inserted}행 업로드"
        if sum_parts:
            detail += " · " + " · ".join(sum_parts)
        write_audit(conn, aid, user, "upload_manual_metrics", detail)
        conn.commit()
        return 200, {"inserted": inserted}

    # DELETE /api/accounts/:id/manual-metrics?from=&to=&media=
    @staticmethod
    def delete_manual_metrics(body, user, conn, params):
        import urllib.parse as up
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role or role == "advertiser":
            return 403, {"error": "편집 권한이 없습니다."}
        q = up.parse_qs(params.get("_query", ""))
        from_date = q.get("from", [""])[0]
        to_date   = q.get("to",   [""])[0]
        media     = q.get("media", [""])[0]
        sql = "DELETE FROM manual_metrics WHERE account_id=?"
        args = [aid]
        if from_date: sql += " AND date>=?"; args.append(from_date)
        if to_date:   sql += " AND date<=?"; args.append(to_date)
        if media:     sql += " AND media=?"; args.append(media)
        conn.execute(sql, args)
        conn.commit()
        return 200, {"ok": True}

    # ───────── 수기 전환 데이터 입력 CRUD (리포트 설정 > 수기 전환 데이터 입력) ─────────

    # GET /api/accounts/:id/manual-conv-data?from=&to=
    @staticmethod
    def get_manual_conv_data(body, user, conn, params):
        import urllib.parse as up
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        _cleanup_old_manual_conv_data(conn)
        q = up.parse_qs(params.get("_query", ""))
        from_date = q.get("from", [""])[0]
        to_date   = q.get("to",   [""])[0]
        sql = "SELECT id,date,media,conv_id,value FROM manual_conv_data WHERE account_id=?"
        args = [aid]
        if from_date: sql += " AND date>=?"; args.append(from_date)
        if to_date:   sql += " AND date<=?"; args.append(to_date)
        sql += " ORDER BY date,media,conv_id"
        rows = conn.execute(sql, args).fetchall()
        return 200, {"rows": [dict(r) for r in rows]}

    # POST /api/accounts/:id/manual-conv-data  {entries:[{date,media,conv_id,value}]}
    @staticmethod
    def save_manual_conv_data(body, user, conn, params):
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role or not can_edit(role):
            return 403, {"error": "편집 권한이 필요합니다."}
        _cleanup_old_manual_conv_data(conn)
        entries = (body or {}).get("entries", [])
        saved = 0
        for e in entries:
            date_v  = (e.get("date") or "").strip()
            media_v = (e.get("media") or "").strip()
            conv_id = e.get("conv_id")
            if not date_v or not media_v or conv_id is None:
                continue
            conn.execute(
                "INSERT INTO manual_conv_data (account_id,date,media,conv_id,value,updated_at) VALUES (?,?,?,?,?,datetime('now')) "
                "ON CONFLICT(account_id,date,media,conv_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                (aid, date_v, media_v, int(conv_id), float(e.get("value") or 0)))
            saved += 1
        write_audit(conn, aid, user, "save_manual_conv_data", f"수기 전환 데이터 {saved}건 저장")
        conn.commit()
        return 200, {"ok": True, "saved": saved}

    # DELETE /api/accounts/:id/manual-conv-data?date=&media=&conv_id=
    @staticmethod
    def delete_manual_conv_data(body, user, conn, params):
        import urllib.parse as up
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role or not can_edit(role):
            return 403, {"error": "편집 권한이 필요합니다."}
        q = up.parse_qs(params.get("_query", ""))
        date_v  = q.get("date",    [""])[0]
        media_v = q.get("media",   [""])[0]
        conv_id = q.get("conv_id", [""])[0]
        if not date_v:
            return 400, {"error": "date 파라미터가 필요합니다."}
        sql = "DELETE FROM manual_conv_data WHERE account_id=? AND date=?"
        args = [aid, date_v]
        if media_v:   sql += " AND media=?";   args.append(media_v)
        if conv_id:   sql += " AND conv_id=?"; args.append(int(conv_id))
        conn.execute(sql, args)
        write_audit(conn, aid, user, "delete_manual_conv_data", f"수기 전환 데이터 삭제 · {date_v}" + (f"/{media_v}" if media_v else ""))
        conn.commit()
        return 200, {"ok": True}

    # GET /api/accounts/:id/report-config
    @staticmethod
    def get_report_config(body, user, conn, params):
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        rows = conn.execute(
            "SELECT * FROM report_config WHERE account_id=? ORDER BY id", (aid,)
        ).fetchall()
        return 200, {"configs": [dict(r) for r in rows], "canEdit": can_edit(role)}

    # POST /api/accounts/:id/report-config  — 생성/수정
    @staticmethod
    def save_report_config(body, user, conn, params):
        import json as _json
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role or not can_edit(role):
            return 403, {"error": "편집 권한이 필요합니다."}
        b = body or {}
        config_id = b.get("id")
        name = b.get("name", "기본 리포트")
        cols = _json.dumps(b.get("columns", []), ensure_ascii=False)
        medias = _json.dumps(b.get("media", []), ensure_ascii=False)
        cycle = b.get("update_cycle", "manual")
        if config_id:
            conn.execute(
                "UPDATE report_config SET name=?,columns_json=?,media_json=?,update_cycle=? WHERE id=? AND account_id=?",
                (name, cols, medias, cycle, config_id, aid))
        else:
            cur = conn.execute(
                "INSERT INTO report_config (account_id,name,columns_json,media_json,update_cycle) VALUES (?,?,?,?,?)",
                (aid, name, cols, medias, cycle))
            config_id = cur.lastrowid
        write_audit(conn, aid, user, "report_config_save", f"리포트 설정 저장: {name}")
        conn.commit()
        return 200, {"ok": True, "id": config_id}

    # DELETE /api/report-config/:id
    @staticmethod
    def delete_report_config(body, user, conn, params):
        cid = params["config_id"]
        row = conn.execute("SELECT * FROM report_config WHERE id=?", (cid,)).fetchone()
        if not row:
            return 404, {"error": "리포트 설정을 찾을 수 없습니다."}
        role = account_role(conn, user["sub"], row["account_id"])
        if not role or not can_edit(role):
            return 403, {"error": "편집 권한이 필요합니다."}
        conn.execute("DELETE FROM report_config WHERE id=?", (cid,))
        conn.commit()
        return 200, {"ok": True}

    # GET /api/accounts/:id/report-history
    @staticmethod
    def list_report_history(body, user, conn, params):
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        rows = conn.execute(
            "SELECT * FROM report_history WHERE account_id=? ORDER BY id DESC LIMIT 50", (aid,)
        ).fetchall()
        return 200, {"history": [dict(r) for r in rows]}

    # POST /api/accounts/:id/report-export  — 엑셀 내보내기
    @staticmethod
    def report_export(body, user, conn, params):
        import json as _json
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        b = body or {}
        d_from = b.get("from", "2000-01-01")
        d_to = b.get("to", "2099-12-31")
        columns = b.get("columns", ["date","media","cost","imp","click","conv","revenue"])
        media_filter = b.get("media", [])
        if media_filter:
            placeholders = ",".join(["?"] * len(media_filter))
            rows = conn.execute(
                f"SELECT * FROM metric_data WHERE account_id=? AND date>=? AND date<=? AND media IN ({placeholders}) ORDER BY date,media",
                (aid, d_from, d_to, *media_filter)).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM metric_data WHERE account_id=? AND date>=? AND date<=? ORDER BY date,media",
                (aid, d_from, d_to)).fetchall()
        pivot = {}
        for r in rows:
            key = (r["date"], r["media"])
            if key not in pivot:
                pivot[key] = {"date": r["date"], "media": r["media"]}
            pivot[key][r["metric_key"]] = r["value"]
        for rec in pivot.values():
            c, imp, cl = rec.get("cost", 0), rec.get("imp", 0), rec.get("click", 0)
            conv, rev = rec.get("conv", 0), rec.get("revenue", 0)
            if "ctr" in columns and imp:
                rec["ctr"] = round(cl / imp * 100, 2)
            if "cpc" in columns and cl:
                rec["cpc"] = round(c / cl, 0)
            if "roas" in columns and c:
                rec["roas"] = round(rev / c * 100, 1)
            if "cpa" in columns and conv:
                rec["cpa"] = round(c / conv, 0)
        table = sorted(pivot.values(), key=lambda x: (x["date"], x["media"]))
        file_name = f"deepfle_report_{d_from}_{d_to}.xlsx"
        conn.execute(
            "INSERT INTO report_history (account_id,file_name,period_from,period_to,status) VALUES (?,?,?,?,?)",
            (aid, file_name, d_from, d_to, "done"))
        write_audit(conn, aid, user, "report_export", f"리포트 내보내기: {file_name}")
        conn.commit()
        return 200, {"ok": True, "fileName": file_name, "columns": columns,
                     "rows": table, "rowCount": len(table)}

    # ───────── Phase 6: 데이터 파이프라인 ─────────

    # POST /api/accounts/:id/sync  — 매체 데이터 동기화 배치 (편집 권한 필요)
    @staticmethod
    def sync_media(body, user, conn, params):
        import random
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        if not can_edit(role):
            return 403, {"error": "편집 권한이 필요합니다."}

        cur = conn.execute("INSERT INTO sync_jobs (account_id,status) VALUES (?, 'running')", (aid,))
        job_id = cur.lastrowid
        # 매체 커넥터에서 데이터 pull 시뮬레이션 (실제로는 매체 API 호출)
        media = conn.execute("SELECT * FROM media WHERE account_id=?", (aid,)).fetchall()
        for m in media:
            # 신규 성과 데이터 반영 (±5% 변동 + 최신 동기화 시각)
            delta = random.uniform(0.95, 1.08)
            conn.execute(
                """UPDATE media SET spend=?, click=?, cvr=?, last_sync=datetime('now') WHERE id=?""",
                (int(m["spend"] * delta), int(m["click"] * delta), int(m["cvr"] * delta), m["id"]),
            )
        conn.execute(
            "UPDATE sync_jobs SET status='done', media_count=?, finished_at=datetime('now') WHERE id=?",
            (len(media), job_id),
        )
        write_audit(conn, aid, user, "media_sync", f"{len(media)}개 매체 동기화")
        conn.commit()
        return 200, {"ok": True, "jobId": job_id, "mediaCount": len(media), "syncedAt": "방금 전"}

    # GET /api/accounts/:id/sync-status  — 최근 동기화 상태
    @staticmethod
    def sync_status(body, user, conn, params):
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        row = conn.execute(
            "SELECT * FROM sync_jobs WHERE account_id=? ORDER BY id DESC LIMIT 1", (aid,)
        ).fetchone()
        return 200, {"lastJob": dict(row) if row else None}

    # POST /api/track/click  — 추적 링크 클릭 (공개 엔드포인트, click_id 발급)
    @staticmethod
    def track_click(body, user, conn, params):
        import uuid
        b = body or {}
        aid = b.get("account_id")
        if not aid:
            return 400, {"error": "account_id가 필요합니다."}
        click_id = "clk_" + uuid.uuid4().hex[:16]
        conn.execute(
            "INSERT INTO attr_clicks (click_id,account_id,link_name,media) VALUES (?,?,?,?)",
            (click_id, aid, b.get("link_name", ""), b.get("media", "")),
        )
        conn.commit()
        return 200, {"ok": True, "clickId": click_id}

    # POST /api/track/conversion  — 전환 포스트백 (S2S, 디듑)
    @staticmethod
    def track_conversion(body, user, conn, params):
        b = body or {}
        click_id = b.get("click_id")
        click = conn.execute("SELECT * FROM attr_clicks WHERE click_id=?", (click_id,)).fetchone()
        if not click:
            return 404, {"error": "유효하지 않은 click_id (클릭 기록 없음)"}
        dedup = b.get("dedup_key") or (click_id + ":" + str(b.get("order_id", "")))
        # 중복 전환 방지
        existing = conn.execute("SELECT id FROM attr_conversions WHERE dedup_key=?", (dedup,)).fetchone()
        if existing:
            return 200, {"ok": True, "deduped": True}
        conn.execute(
            "INSERT INTO attr_conversions (click_id,account_id,value,dedup_key) VALUES (?,?,?,?)",
            (click_id, click["account_id"], int(b.get("value", 0)), dedup),
        )
        conn.commit()
        return 200, {"ok": True, "deduped": False}

    # ───────── Phase 7: 자동화 안전장치 ─────────

    # 규칙 → 영향받는 매체 + 액션 산정 (데모 규칙 엔진)
    @staticmethod
    def _evaluate_rule(conn, rule):
        """규칙 조건에 해당하는 매체와 예상 변화를 계산 (실제 변경 X)."""
        media = conn.execute(
            "SELECT * FROM media WHERE account_id=? AND is_on=1", (rule["account_id"],)
        ).fetchall()
        impacts = []
        name = rule["name"]
        for m in media:
            before, after, action = None, None, None
            if "중지" in name:                      # 광고비 초과 자동 중지
                if m["spend"] >= 5_000_000 and m["cpa"] >= 12000:
                    action, before, after = "pause", "ON", "OFF"
            elif "감소" in name:                    # ROAS 저하 예산 감소
                if m["roas"] <= 350:
                    action, before, after = "budget_down", m["spend"], int(m["spend"] * 0.8)
            elif "증액" in name or "증가" in name:   # 고성과 예산 증액
                if m["roas"] >= 500:
                    action, before, after = "budget_up", m["spend"], int(m["spend"] * 1.1)
            if action:
                impacts.append({"mediaId": m["id"], "media": m["name"],
                                "action": action, "before": before, "after": after})
        return impacts

    # POST /api/rules/:id/preview  — 드라이런 (영향 미리보기, 변경 없음)
    @staticmethod
    def rule_preview(body, user, conn, params):
        rid = params["rule_id"]
        rule = conn.execute("SELECT * FROM rules WHERE id=?", (rid,)).fetchone()
        if not rule:
            return 404, {"error": "규칙을 찾을 수 없습니다."}
        role = account_role(conn, user["sub"], rule["account_id"])
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        impacts = Api._evaluate_rule(conn, rule)
        return 200, {"ruleName": rule["name"], "impacts": impacts,
                     "affectedCount": len(impacts), "mode": "dryrun"}

    # POST /api/rules/:id/execute  — 실제 실행 (스냅샷 저장 + 일일 상한)
    @staticmethod
    def rule_execute(body, user, conn, params):
        import json as _json
        rid = params["rule_id"]
        rule = conn.execute("SELECT * FROM rules WHERE id=?", (rid,)).fetchone()
        if not rule:
            return 404, {"error": "규칙을 찾을 수 없습니다."}
        role = account_role(conn, user["sub"], rule["account_id"])
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        if not can_edit(role):
            return 403, {"error": "편집 권한이 필요합니다."}

        # 일일 자동변경 상한 체크
        today_count = conn.execute(
            """SELECT COUNT(*) AS c FROM rule_executions
               WHERE account_id=? AND mode='live' AND undone=0
               AND date(executed_at)=date('now')""",
            (rule["account_id"],),
        ).fetchone()["c"]
        if today_count >= db.DAILY_CHANGE_LIMIT:
            return 429, {"error": f"일일 자동변경 상한({db.DAILY_CHANGE_LIMIT}회)에 도달했습니다. "
                                  f"안전을 위해 추가 자동변경이 차단됩니다."}

        impacts = Api._evaluate_rule(conn, rule)
        if not impacts:
            return 200, {"ok": True, "affectedCount": 0, "message": "조건에 해당하는 매체가 없습니다."}

             # 실제 적용 (DB 반영 + 매체 API write 호출)
        for imp in impacts:
            mrow = conn.execute("SELECT name FROM media WHERE id=?", (imp["mediaId"],)).fetchone()
            aa = conn.execute(
                "SELECT * FROM ad_accounts WHERE account_id=? AND status!='disconnected' LIMIT 1",
                (rule["account_id"],)).fetchone()
            conn_obj = get_connector(aa["media"]) if aa else None
            token = os.environ.get(f"{aa['media'].upper()}_ACCESS_TOKEN", "") if aa else ""
            if imp["action"] == "pause":
                conn.execute("UPDATE media SET is_on=0 WHERE id=?", (imp["mediaId"],))
                if conn_obj:
                    imp["apiCall"] = conn_obj.pause_campaign(aa["external_id"] or "", token)
            elif imp["action"] in ("budget_down", "budget_up"):
                conn.execute("UPDATE media SET spend=? WHERE id=?", (imp["after"], imp["mediaId"]))
                if conn_obj:
                    imp["apiCall"] = conn_obj.update_budget(aa["external_id"] or "", int(imp["after"]), token)

        cur = conn.execute(
            "INSERT INTO rule_executions (rule_id,account_id,mode,affected) VALUES (?,?,'live',?)",
            (rid, rule["account_id"], _json.dumps(impacts, ensure_ascii=False)),
        )
        exec_id = cur.lastrowid
        conn.execute("UPDATE rules SET last_run=datetime('now') WHERE id=?", (rid,))
        write_audit(conn, rule["account_id"], user, "rule_execute",
                    f"{rule['name']} 실행 → {len(impacts)}개 매체 변경")
        # 자동 알림 생성 (규칙 실행 결과 통지)
        conn.execute(
            "INSERT INTO notifications (account_id,level,channel,title,message) VALUES (?,?,?,?,?)",
            (rule["account_id"], "warning", "email", f"[자동규칙] {rule['name']} 실행됨",
             f"{len(impacts)}개 매체가 자동 조정되었습니다. 되돌리려면 실행 이력에서 복원하세요."),
        )
        conn.commit()
        return 200, {"ok": True, "executionId": exec_id, "affectedCount": len(impacts),
                     "impacts": impacts, "remainingToday": db.DAILY_CHANGE_LIMIT - today_count - 1}

    # POST /api/rule-executions/:id/undo  — 되돌리기
    @staticmethod
    def rule_undo(body, user, conn, params):
        import json as _json
        eid = params["exec_id"]
        ex = conn.execute("SELECT * FROM rule_executions WHERE id=?", (eid,)).fetchone()
        if not ex:
            return 404, {"error": "실행 이력을 찾을 수 없습니다."}
        if ex["undone"]:
            return 400, {"error": "이미 되돌려진 실행입니다."}
        role = account_role(conn, user["sub"], ex["account_id"])
        if not role or not can_edit(role):
            return 403, {"error": "편집 권한이 필요합니다."}

        impacts = _json.loads(ex["affected"] or "[]")

        conn.execute("UPDATE rule_executions SET undone=1 WHERE id=?", (eid,))
        write_audit(conn, ex["account_id"], user, "rule_undo",
                    f"실행 #{eid} 되돌리기 → {len(impacts)}개 매체 복원")
        conn.commit()
        return 200, {"ok": True, "restoredCount": len(impacts)}

    # GET /api/accounts/:id/attribution  — 매체별 어트리뷰션 집계 (라스트클릭)
    @staticmethod
    def attribution(body, user, conn, params):
        aid = params["account_id"]
        role = account_role(conn, user["sub"], aid)
        if not role:
            return 403, {"error": "접근 권한이 없습니다."}
        rows = conn.execute(
            """SELECT c.media AS media,
                      COUNT(DISTINCT c.click_id) AS clicks,
                      COUNT(v.id) AS conversions,
                      COALESCE(SUM(v.value),0) AS revenue
               FROM attr_clicks c
               LEFT JOIN attr_conversions v ON v.click_id = c.click_id
               WHERE c.account_id=?
               GROUP BY c.media ORDER BY clicks DESC""",
            (aid,),
        ).fetchall()
        out = []
        for r in rows:
            clicks = r["clicks"] or 0
            convs = r["conversions"] or 0
            out.append({
                "media": r["media"] or "(direct)", "clicks": clicks, "conversions": convs,
                "cvr": round(convs / clicks * 100, 2) if clicks else 0,
                "revenue": r["revenue"],
            })
        return 200, {"attribution": out}


# 라우팅 테이블: (METHOD, 정규식) → (핸들러, 인증필요)
ROUTES = [
    ("POST", r"^/api/auth/login$",                    Api.login,        False),
    ("GET",  r"^/api/auth/me$",                        Api.me,           True),
    ("POST", r"^/api/auth/send-verify$",              Api.send_verify,  False),
    ("POST", r"^/api/auth/check-verify$",             Api.check_verify, False),
    ("POST", r"^/api/auth/register$",                 Api.register,     False),
    # 초대 토큰
    ("GET",  r"^/api/invite/(?P<token>[^/]+)$",       Api.get_invite,   False),
    ("POST", r"^/api/invite/(?P<token>[^/]+)/accept$", Api.accept_invite, False),
    # 관리자: 준회원 승인
    ("GET",  r"^/api/admin/pending-users$",                        Api.list_pending_users,  True),
    ("POST", r"^/api/admin/users/(?P<user_id>[^/]+)/approve$",    Api.approve_user,        True),
    ("DELETE",r"^/api/admin/users/(?P<user_id>[^/]+)$",           Api.delete_user,         True),
    ("PUT",  r"^/api/admin/users/(?P<user_id>[^/]+)/role$",       Api.update_user_role,    True),
    ("PUT",  r"^/api/admin/users/(?P<user_id>[^/]+)/accounts$",   Api.update_user_accounts, True),
    # R2: 매체 실 API 커넥터
    ("GET",  r"^/api/connectors$",                                    Api.list_connectors,   True),
    ("GET",  r"^/api/connectors/health-all$",                         Api.connectors_health_all, False),
    ("GET",  r"^/api/connectors/(?P<media>[^/]+)/status$",            Api.connector_status,  True),
    ("GET",  r"^/api/connectors/(?P<media>[^/]+)/oauth-url$",         Api.connector_oauth_url, True),
    ("GET",  r"^/api/connectors/(?P<media>[^/]+)/fields$",            Api.connector_fields,  True),
    ("POST", r"^/api/connectors/(?P<media>[^/]+)/sync$",              Api.connector_sync,    True),
    # 매체 자격증명 CRUD
    ("GET",    r"^/api/accounts/(?P<account_id>[^/]+)/media-credentials$",    Api.get_media_credentials,    True),
    ("POST",   r"^/api/accounts/(?P<account_id>[^/]+)/media-credentials$",    Api.save_media_credentials,   True),
    ("DELETE", r"^/api/media-credentials/(?P<cred_id>\d+)$",                  Api.delete_media_credentials, True),
    # R1: 워크스페이스
    ("GET",  r"^/api/workspaces$",                                    Api.list_workspaces,   True),
    ("GET",  r"^/api/workspaces/(?P<ws_id>[^/]+)/accounts$",          Api.list_ws_accounts,  True),
    ("POST",  r"^/api/workspaces/(?P<ws_id>[^/]+)/accounts$",          Api.create_account,    True),
    ("PATCH",  r"^/api/accounts/(?P<account_id>[^/]+)$",               Api.update_account,    True),
    ("DELETE", r"^/api/accounts/(?P<account_id>[^/]+)$",               Api.delete_account,    True),
    ("POST", r"^/api/workspaces/(?P<ws_id>[^/]+)/invite$",           Api.invite_user,       True),
    ("GET",  r"^/api/workspaces/(?P<ws_id>[^/]+)/ad-accounts$",       Api.list_ad_accounts,  True),
    ("POST", r"^/api/workspaces/(?P<ws_id>[^/]+)/ad-accounts$",       Api.connect_ad_account, True),
    ("PATCH", r"^/api/ad-accounts/(?P<aa_id>\d+)$",                   Api.update_ad_account, True),
    ("GET",  r"^/api/workspaces/(?P<ws_id>[^/]+)/integrations$",      Api.list_integrations, True),
    ("POST", r"^/api/workspaces/(?P<ws_id>[^/]+)/integrations$",      Api.add_integration,   True),
    ("GET",  r"^/api/accounts$",                       Api.list_accounts, True),
    ("GET",  r"^/api/accounts/(?P<account_id>[^/]+)/media$",             Api.list_media,         True),
    ("GET",  r"^/api/accounts/(?P<account_id>[^/]+)/campaigns$",         Api.list_campaigns,     True),
    ("GET",  r"^/api/accounts/(?P<account_id>[^/]+)/device-breakdown$",  Api.device_breakdown,   True),
    ("GET",  r"^/api/accounts/(?P<account_id>[^/]+)/product-breakdown$", Api.product_breakdown,  True),
    ("GET",  r"^/api/accounts/(?P<account_id>[^/]+)/raw-metrics$",      Api.raw_metrics,        True),
    ("GET",  r"^/api/accounts/(?P<account_id>[^/]+)/raw-hierarchy$",   Api.raw_hierarchy,      True),
    # 매체-솔루션 컬럼 매핑
    ("GET",  r"^/api/accounts/(?P<account_id>[^/]+)/media-metric-map$", Api.get_media_metric_map,  True),
    ("POST", r"^/api/accounts/(?P<account_id>[^/]+)/media-metric-map$", Api.save_media_metric_map, True),
    # 수기 매체 Raw 업로드 지표
    ("GET",    r"^/api/accounts/(?P<account_id>[^/]+)/manual-metrics$",    Api.get_manual_metrics,    True),
    ("POST",   r"^/api/accounts/(?P<account_id>[^/]+)/manual-metrics$",   Api.upsert_manual_metrics, True),
    ("DELETE", r"^/api/accounts/(?P<account_id>[^/]+)/manual-metrics$",   Api.delete_manual_metrics, True),
    # 수기 전환 데이터 입력 (리포트 설정 > 수기 전환 데이터 입력)
    ("GET",    r"^/api/accounts/(?P<account_id>[^/]+)/manual-conv-data$", Api.get_manual_conv_data,  True),
    ("POST",   r"^/api/accounts/(?P<account_id>[^/]+)/manual-conv-data$", Api.save_manual_conv_data, True),
    ("DELETE", r"^/api/accounts/(?P<account_id>[^/]+)/manual-conv-data$", Api.delete_manual_conv_data, True),
    ("GET",  r"^/api/accounts/(?P<account_id>[^/]+)/rules$", Api.list_rules, True),
    ("POST", r"^/api/accounts/(?P<account_id>[^/]+)/rules$", Api.create_rule, True),
    ("PATCH", r"^/api/rules/(?P<rule_id>\d+)$",        Api.update_rule, True),
    ("DELETE", r"^/api/rules/(?P<rule_id>\d+)$",       Api.delete_rule, True),
    ("GET",  r"^/api/accounts/(?P<account_id>[^/]+)/rule-executions$", Api.list_rule_executions, True),
    # 설정: 전환설정 / 매체연동 매핑 / 지표 사전
    ("GET",  r"^/api/accounts/(?P<account_id>[^/]+)/conversion-settings$", Api.list_conversions, True),
    ("POST", r"^/api/accounts/(?P<account_id>[^/]+)/conversion-settings$", Api.create_conversion, True),
    ("PATCH", r"^/api/conversion-settings/(?P<conv_id>\d+)$",  Api.update_conversion, True),
    ("DELETE", r"^/api/conversion-settings/(?P<conv_id>\d+)$", Api.delete_conversion, True),
    ("GET",  r"^/api/accounts/(?P<account_id>[^/]+)/metric-catalog$",  Api.metric_catalog, True),
    # Ph E: metric-data + report-config + report-history + export
    ("GET",  r"^/api/accounts/(?P<account_id>[^/]+)/metric-data$",       Api.list_metric_data, True),
    ("POST", r"^/api/accounts/(?P<account_id>[^/]+)/metric-data/pull$",  Api.pull_metric_data, True),
    ("GET",  r"^/api/accounts/(?P<account_id>[^/]+)/report-config$",     Api.get_report_config, True),
    ("POST", r"^/api/accounts/(?P<account_id>[^/]+)/report-config$",     Api.save_report_config, True),
    ("DELETE", r"^/api/report-config/(?P<config_id>\d+)$",               Api.delete_report_config, True),
    ("GET",  r"^/api/accounts/(?P<account_id>[^/]+)/report-history$",    Api.list_report_history, True),
    ("POST", r"^/api/accounts/(?P<account_id>[^/]+)/report-export$",     Api.report_export, True),
    ("GET",  r"^/api/accounts/(?P<account_id>[^/]+)/audit$", Api.list_audit, True),
    ("GET",  r"^/api/accounts/(?P<account_id>[^/]+)/messages$", Api.list_messages, True),
    ("POST", r"^/api/accounts/(?P<account_id>[^/]+)/messages$", Api.create_message, True),
    ("PATCH", r"^/api/media/(?P<media_id>\d+)$",       Api.update_media, True),
    # R3: 계정 멀티매체 동기화
    ("POST", r"^/api/accounts/(?P<account_id>[^/]+)/sync-connectors$", Api.sync_account_connectors, True),
    ("GET",  r"^/api/users$",                          Api.list_users,   True),
    # Phase 6: 데이터 파이프라인
    ("POST", r"^/api/accounts/(?P<account_id>[^/]+)/sync$",        Api.sync_media,    True),
    ("GET",  r"^/api/accounts/(?P<account_id>[^/]+)/sync-status$", Api.sync_status,   True),
    ("GET",  r"^/api/accounts/(?P<account_id>[^/]+)/attribution$", Api.attribution,   True),
    ("POST", r"^/api/track/click$",                    Api.track_click,      False),  # 공개 추적
    ("POST", r"^/api/track/conversion$",               Api.track_conversion, False),  # S2S 포스트백
    # Phase 7: 자동화 안전장치
    ("POST", r"^/api/rules/(?P<rule_id>\d+)/preview$", Api.rule_preview, True),
    ("POST", r"^/api/rules/(?P<rule_id>\d+)/execute$", Api.rule_execute, True),
    ("POST", r"^/api/rule-executions/(?P<exec_id>\d+)/undo$", Api.rule_undo, True),
    # Phase 8: 운영 신뢰성
    ("PATCH", r"^/api/users/(?P<user_id>[^/]+)/accounts/(?P<account_id>[^/]+)$", Api.set_account_role, True),
    ("POST", r"^/api/accounts/(?P<account_id>[^/]+)/notify$",        Api.create_notification, True),
    ("GET",  r"^/api/accounts/(?P<account_id>[^/]+)/notifications$", Api.list_notifications,  True),
]


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type,Authorization")

    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _dispatch(self, method):
        path = self.path.split("?")[0]
        # 요청 본문
        body = None
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length:
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
            except Exception:
                body = None

        for m, pattern, handler, auth_required in ROUTES:
            if m != method:
                continue
            match = re.match(pattern, path)
            if not match:
                continue

            user = None
            if auth_required:
                authz = self.headers.get("Authorization", "")
                token = authz[7:] if authz.startswith("Bearer ") else ""
                user = verify_token(token)
                if not user:
                    return self._send(401, {"error": "인증이 필요합니다. 다시 로그인해주세요."})

            conn = db.get_conn()
            try:
                p = match.groupdict()
                qs = self.path.split("?", 1)[1] if "?" in self.path else ""
                p["_query"] = qs
                status, payload = handler(body, user, conn, p)
            except Exception as e:
                conn.rollback()
                status, payload = 500, {"error": f"서버 오류: {e}"}
            finally:
                conn.close()
            return self._send(status, payload)

        self._send(404, {"error": "엔드포인트를 찾을 수 없습니다."})

    def do_GET(self):
        if self.path.split("?")[0] == "/api/health":
            return self._send(200, {"status": "ok", "service": "deepfle-backend"})
        self._dispatch("GET")

    def do_POST(self):   self._dispatch("POST")
    def do_PUT(self):    self._dispatch("PUT")
    def do_PATCH(self):  self._dispatch("PATCH")
    def do_DELETE(self): self._dispatch("DELETE")

    def log_message(self, fmt, *args):
        print(f"[api] {self.command} {self.path} → {args[1] if len(args) > 1 else ''}")


if __name__ == "__main__":
    db.init_db()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[api] DeepFle 백엔드 실행 중 → http://0.0.0.0:{PORT}")
    print(f"[api] 관리자 계정: admin@deepfle.io / admin123")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[api] 종료")
