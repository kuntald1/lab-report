"""Password hashing (bcrypt) and JWT encode/decode.

Uses the `bcrypt` and `PyJWT` packages directly — no passlib/python-jose — to
avoid the well-known passlib<->bcrypt version-detection crash.
"""
import os
import datetime as dt
from typing import Optional

import bcrypt
import jwt  # PyJWT

SECRET_KEY = os.getenv("JWT_SECRET", "change-me-in-production-please")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "720"))  # 12h default


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(claims: dict, expires_minutes: Optional[int] = None) -> str:
    to_encode = dict(claims)
    expire = dt.datetime.now(dt.timezone.utc) + dt.timedelta(
        minutes=expires_minutes or ACCESS_TOKEN_EXPIRE_MINUTES
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
