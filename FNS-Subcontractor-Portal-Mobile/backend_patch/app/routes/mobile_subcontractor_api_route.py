# app/routes/mobile_subcontractor_api_route.py
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse, RedirectResponse
from jose import jwt as jose_jwt
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import async_session, get_db
from app.db.models.site_info_model import SiteInfo
from app.db.models.user_model import User
from app.utils.auth import create_access_token, decode_token, verify_user
from app.utils.subcontractor_site_names import get_subcontractor_site_names
from app.crud.login_audit_crud import record_login, record_logout
from app.crud.subcontractor_site_permissions_crud import ensure_defaults, get_effective_flags_for_user

try:
    from app.routes.subcontractor_site_permissions_route import PAGE_DEFS
except Exception:  # pragma: no cover - defensive fallback
    PAGE_DEFS: List[Dict[str, str]] = [
        {"key": "sow_documents", "label": "SOW/Pricing Documents", "group": "management"},
        {"key": "accounting_contacts", "label": "Accounting Contacts", "group": "management"},
        {"key": "site_walk_redlines", "label": "Site Walk Redlines", "group": "installer"},
        {"key": "site_walk_photos", "label": "Site Walk Photos", "group": "installer"},
        {"key": "daily_reports", "label": "Daily Reports", "group": "installer"},
        {"key": "photo_repository", "label": "Photo Repository", "group": "installer"},
        {"key": "site_cds", "label": "Site CDs", "group": "installer"},
        {"key": "site_daily_tracker", "label": "Site Daily Tracker", "group": "installer"},
        {"key": "material_tracker", "label": "Material Tracker", "group": "installer"},
    ]

router = APIRouter(prefix="/mobile/subcontractor/api", tags=["Mobile Subcontractor API"])

MOBILE_SUBCONTRACTOR_ACCESS_MINUTES = 60 * 24 * 7
MOBILE_SUBCONTRACTOR_COOKIE_MAX_AGE = MOBILE_SUBCONTRACTOR_ACCESS_MINUTES * 60
EXCLUDED_HOME_KEYS = {"sitemap", "site_permissions", "invoicing", "quote_submission", "signed_nda"}
PAGE_ICONS = {
    "sow_documents": "📄",
    "accounting_contacts": "☎️",
    "site_walk_redlines": "✏️",
    "site_walk_photos": "🖼️",
    "daily_reports": "📝",
    "photo_repository": "📷",
    "site_cds": "🗂️",
    "site_daily_tracker": "✅",
    "material_tracker": "📦",
}


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _role(user: Dict[str, Any]) -> str:
    role = user.get("user_role") or user.get("role") or user.get("userRole") or user.get("subcontractor_role") or ""
    if isinstance(role, dict):
        for key in ("key", "value", "name", "label"):
            raw = role.get(key)
            if isinstance(raw, str) and raw.strip():
                return raw.strip()
        return ""
    return _clean(role)


def _mobile_public_user(user: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "email": user.get("sub") or user.get("email") or user.get("email_address"),
        "email_address": user.get("sub") or user.get("email") or user.get("email_address"),
        "user_type": "Subcontractor",
        "user_role": user.get("user_role"),
        "name": user.get("name"),
        "subcontractor_name": user.get("subcontractor_name"),
    }


def _cookie_secure(request: Request) -> bool:
    forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    return request.url.scheme == "https" or forwarded_proto == "https"


def _set_access_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=_cookie_secure(request),
        samesite="lax",
        max_age=MOBILE_SUBCONTRACTOR_COOKIE_MAX_AGE,
        path="/",
    )


def _extract_token(authorization: Optional[str]) -> str:
    raw = _clean(authorization)
    if raw.lower().startswith("bearer "):
        return raw[7:].strip()
    return raw


def _decode_subcontractor_token(token: str) -> Dict[str, Any]:
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing mobile token")
    try:
        payload = decode_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired mobile token") from exc
    if _clean(payload.get("user_type")) != "Subcontractor":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Subcontractors only")
    return payload


async def get_mobile_subcontractor_user(authorization: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    return _decode_subcontractor_token(_extract_token(authorization))


async def _issue_session(db: AsyncSession, user_data: Dict[str, Any]) -> Dict[str, Any]:
    email = _clean(user_data.get("sub")).lower()
    row = (await db.execute(select(User).where(func.lower(User.email_address) == email))).scalar_one_or_none()
    user_role = _clean(getattr(row, "user_role", None) or user_data.get("user_role"))
    name = _clean(getattr(row, "name", None) or user_data.get("name"))
    subcontractor_name = _clean(getattr(row, "subcontractor_name", None) or user_data.get("subcontractor_name"))
    token_payload = {
        "sub": email,
        "email": email,
        "email_address": email,
        "user_type": "Subcontractor",
        "user_role": user_role,
        "name": name,
        "friendly_name": name or email,
        "subcontractor_name": subcontractor_name,
    }
    access_token = create_access_token(token_payload, expires_delta=timedelta(minutes=MOBILE_SUBCONTRACTOR_ACCESS_MINUTES))
    return {
        "ok": True,
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in_seconds": MOBILE_SUBCONTRACTOR_ACCESS_MINUTES * 60,
        "user": _mobile_public_user(token_payload),
    }


def _safe_next(next_path: str | None) -> str:
    raw = _clean(next_path) or "/subcontractor_home?only_active=1"
    if raw.startswith("http://") or raw.startswith("https://") or raw.startswith("//"):
        return "/subcontractor_home?only_active=1"
    if not raw.startswith("/"):
        raw = "/" + raw
    return raw


@router.get("/server-info")
async def mobile_subcontractor_server_info():
    return {
        "ok": True,
        "system": "fns_erp_mobile",
        "portal_type": "subcontractor",
        "mobile_api": True,
        "min_mobile_api_version": 1,
        "server_time": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/auth/login")
async def mobile_subcontractor_login(request: Request, payload: Dict[str, Any] = Body(...)):
    email = _clean(payload.get("email")).lower()
    password = str(payload.get("password") or "")
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password are required")

    async with async_session() as db:
        user_data = await verify_user(email, password, db)
        if _clean(user_data.get("user_type")) != "Subcontractor":
            raise HTTPException(status_code=403, detail="This app is for subcontractor accounts only")
        if not _clean(user_data.get("subcontractor_name")):
            raise HTTPException(status_code=403, detail="This subcontractor login is missing subcontractor_name")

        session = await _issue_session(db, user_data)
        try:
            await record_login(
                db,
                user_email=email,
                user_type="Subcontractor",
                user_name=user_data.get("name") or "",
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
        except TypeError:
            try:
                await record_login(db, email, "Subcontractor", user_data.get("name") or "")
            except Exception:
                pass
        except Exception:
            pass
        return JSONResponse(session)


@router.post("/auth/logout")
async def mobile_subcontractor_logout(
    request: Request,
    user: Dict[str, Any] = Depends(get_mobile_subcontractor_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await record_logout(
            db,
            user_email=user.get("sub") or user.get("email_address"),
            user_type="Subcontractor",
            user_name=user.get("name") or "",
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
    except TypeError:
        try:
            await record_logout(db, user.get("sub") or user.get("email_address"))
        except Exception:
            pass
    except Exception:
        pass
    return {"ok": True}


@router.get("/home")
async def mobile_subcontractor_home(
    user: Dict[str, Any] = Depends(get_mobile_subcontractor_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_defaults(db, PAGE_DEFS)
    perms = await get_effective_flags_for_user(db, _role(user), PAGE_DEFS)
    pages = []
    for page_def in PAGE_DEFS:
        key = page_def.get("key")
        if not key or key in EXCLUDED_HOME_KEYS:
            continue
        if not bool(perms.get(key, False)):
            continue
        pages.append({
            "key": key,
            "label": page_def.get("label") or key.replace("_", " ").title(),
            "group": page_def.get("group") or "installer",
            "icon": PAGE_ICONS.get(key, "•"),
        })
    site_names = await get_subcontractor_site_names(db, user=user, only_active=True)
    return {
        "ok": True,
        "user": _mobile_public_user(user),
        "pages": pages,
        "active_project_count": len(site_names),
        "permissions": {k: bool(v) for k, v in perms.items()},
    }


@router.get("/projects")
async def mobile_subcontractor_projects(
    q: Optional[str] = Query(default=None),
    user: Dict[str, Any] = Depends(get_mobile_subcontractor_user),
    db: AsyncSession = Depends(get_db),
):
    site_names = await get_subcontractor_site_names(db, user=user, only_active=True, q=q)
    projects: List[Dict[str, Any]] = []
    if site_names:
        lowered = [s.lower().strip() for s in site_names]
        rows = (await db.execute(
            select(SiteInfo.site_name, SiteInfo.active_inactive)
            .where(func.lower(func.trim(SiteInfo.site_name)).in_(lowered))
            .order_by(SiteInfo.site_name.asc())
        )).all()
        for site_name, active_inactive in rows:
            projects.append({
                "site_name": site_name,
                "status": active_inactive or "Active",
                "subcontractor_name": user.get("subcontractor_name") or "",
            })
    return {"ok": True, "projects": projects, "count": len(projects)}


@router.get("/session")
async def mobile_subcontractor_web_session(
    request: Request,
    token: str = Query(...),
    next: str = Query(default="/subcontractor_home?only_active=1"),
):
    # This route bridges native mobile Bearer auth into the existing web portal
    # pages, which already use the access_token cookie and all current
    # subcontractor permission / site-scope code.
    _decode_subcontractor_token(token)
    response = RedirectResponse(url=_safe_next(next), status_code=status.HTTP_303_SEE_OTHER)
    _set_access_cookie(response, request, token)
    return response
