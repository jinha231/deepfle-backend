"""
DeepFle 백엔드 — 인증/인가 유틸 (표준 라이브러리만 사용)
- 비밀번호: PBKDF2-HMAC-SHA256
- 토큰: HMAC-SHA256 서명 JWT (자체 구현)
- 권한: 역할(role) + 계정 매핑 기반 서버측 검증
"""
import hashlib
import hmac
import json
import base64
import os
import time

# 운영 환경에서는 환경변수로 주입. 데모용 고정 키.
SECRET = os.environ.get("DEEPFLE_SECRET", "deepfle-dev-secret-change-in-production").encode()
TOKEN_TTL = 60 * 60 * 8  # 8시간


# ───────────────────────── 비밀번호 ─────────────────────────
def hash_password(password: str, salt: bytes = None) -> str:
    if salt is None:
        salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100_000)
    return f"{salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, dk_hex = stored.split("$")
        salt = bytes.fromhex(salt_hex)
        candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100_000)
        return hmac.compare_digest(candidate.hex(), dk_hex)
    except Exception:
        return False


# ───────────────────────── JWT ─────────────────────────
def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def issue_token(payload: dict) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    body = dict(payload)
    body["iat"] = int(time.time())
    body["exp"] = int(time.time()) + TOKEN_TTL
    seg_h = _b64url(json.dumps(header, separators=(",", ":")).encode())
    seg_b = _b64url(json.dumps(body, separators=(",", ":")).encode())
    signing_input = f"{seg_h}.{seg_b}".encode()
    sig = hmac.new(SECRET, signing_input, hashlib.sha256).digest()
    return f"{seg_h}.{seg_b}.{_b64url(sig)}"


def verify_token(token: str):
    """유효하면 payload(dict) 반환, 아니면 None."""
    try:
        seg_h, seg_b, seg_s = token.split(".")
        signing_input = f"{seg_h}.{seg_b}".encode()
        expected = hmac.new(SECRET, signing_input, hashlib.sha256).digest()
        if not hmac.compare_digest(_b64url(expected), seg_s):
            return None
        payload = json.loads(_b64url_decode(seg_b))
        if payload.get("exp", 0) < int(time.time()):
            return None  # 만료
        return payload
    except Exception:
        return None


# ───────────────────────── 권한 ─────────────────────────
def can_edit(role: str) -> bool:
    return role in ("master", "user")


def is_master(role: str) -> bool:
    return role == "master"
