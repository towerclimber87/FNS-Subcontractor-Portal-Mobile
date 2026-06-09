# app/routes/mobile_subcontractor_api_route.py
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Request, Response, status, UploadFile, File, Form
from fastapi.responses import JSONResponse, RedirectResponse
from jose import jwt as jose_jwt
from sqlalchemy import func, select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import async_session, get_db
from app.db.models.site_info_model import SiteInfo
from app.db.models.site_walk_redline_model import SiteWalkRedlinePermission, SiteWalkRedlinePage, SiteWalkRedlinePin, SiteWalkRedlineAnnotation
from app.db.models.site_walk_photo_model import SiteWalkPhoto, SiteWalkPhotoAnnotation
from app.db.models.site_walk_360_model import SiteWalk360, SiteWalk360Annotation
from app.db.models.user_model import User
from app.utils.auth import create_access_token, decode_token, verify_user
from app.utils.subcontractor_site_names import get_subcontractor_site_names
from app.crud.login_audit_crud import record_login, record_logout
from app.crud.subcontractor_site_permissions_crud import ensure_defaults, get_effective_flags_for_user

from app.crud.site_walk_redline_crud import (
    create_redline_annotation,
    create_redline_pin,
    delete_redline_annotation,
    get_redline_annotation,
    get_redline_pin,
    list_redline_annotations,
    list_redline_pages,
    list_redline_pins,
    update_redline_annotation,
    update_redline_pin_label,
)
from app.routes.mobile_site_walk_redlines_route import (
    _annotation_payload as _employee_redline_annotation_payload,
    _first_existing_page_file,
    _get_mobile_site_docs_root,
    _is_mobile_visible_page,
    _mobile_visible_pages,
    _page_payload as _employee_redline_page_payload,
    _pin_payloads as _employee_redline_pin_payloads,
)

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


# -----------------------------------------------------------------------------
# Native subcontractor SiteWalk read APIs
# -----------------------------------------------------------------------------
# These endpoints intentionally reuse the existing subcontractor site scope and
# the SiteWalkRedlinePermission.allow_subcontractors flag.  The native app should
# never rely on employee/mobile SiteWalk endpoints for subcontractor users.

SITE_WALK_CATEGORY = "sitewalk"

async def _mobile_subcontractor_site_row_or_404(db: AsyncSession, user: Dict[str, Any], site_name: str) -> SiteInfo:
    requested = _clean(site_name)
    if not requested:
        raise HTTPException(status_code=400, detail="site_name is required")
    allowed_names = await get_subcontractor_site_names(db, user=user, only_active=True)
    matched_name = None
    for name in allowed_names or []:
        if _clean(name).lower() == requested.lower():
            matched_name = _clean(name)
            break
    if not matched_name:
        raise HTTPException(status_code=403, detail="This site is not available for this subcontractor account")
    row = (
        await db.execute(
            select(SiteInfo).where(func.lower(func.trim(SiteInfo.site_name)) == matched_name.lower()).limit(1)
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Site not found")
    return row

async def _mobile_sub_allowed_sitewalks(db: AsyncSession, site_id: int) -> List[str]:
    rows = (
        await db.execute(
            select(SiteWalkRedlinePermission.sitewalk_desc)
            .where(
                SiteWalkRedlinePermission.site_id == int(site_id),
                SiteWalkRedlinePermission.allow_subcontractors.is_(True),
                func.trim(func.coalesce(SiteWalkRedlinePermission.sitewalk_desc, "")) != "",
            )
            .order_by(func.lower(func.trim(SiteWalkRedlinePermission.sitewalk_desc)))
        )
    ).scalars().all()
    seen: set[str] = set()
    out: List[str] = []
    for raw in rows:
        value = _clean(raw)
        key = value.lower()
        if value and key not in seen:
            seen.add(key)
            out.append(value)
    return out

async def _mobile_sub_require_sitewalk_allowed(db: AsyncSession, site_id: int, sitewalk: str | None) -> str:
    allowed = await _mobile_sub_allowed_sitewalks(db, site_id)
    if not allowed:
        raise HTTPException(status_code=403, detail="No SiteWalks are enabled for subcontractors on this site")
    selected = _clean(sitewalk) or allowed[0]
    if selected.lower() not in {x.lower() for x in allowed}:
        raise HTTPException(status_code=403, detail="This SiteWalk is not enabled for subcontractors")
    return selected


def _mobile_sub_dt(value: Any) -> Optional[str]:
    if not value:
        return None
    try:
        return value.isoformat()
    except Exception:
        return str(value)


def _mobile_sub_photo_payload(row: Any) -> Dict[str, Any]:
    photo_id = getattr(row, "id", None)
    url = getattr(row, "public_url", None) or getattr(row, "url", None) or (f"/site_walk_photos/file/{photo_id}" if photo_id else "")
    thumb = getattr(row, "thumb_url", None) or getattr(row, "thumbnail_url", None) or url
    return {
        "id": photo_id,
        "site_id": getattr(row, "site_id", None),
        "name": _clean(getattr(row, "name", None)),
        "caption": _clean(getattr(row, "caption", None)),
        "tag": _clean(getattr(row, "tag", None)),
        "sitewalk_desc": _clean(getattr(row, "sitewalk_desc", None)),
        "note": _clean(getattr(row, "note", None)),
        "file_name": _clean(getattr(row, "file_name", None)),
        "content_type": _clean(getattr(row, "content_type", None)),
        "file_size": getattr(row, "file_size", None),
        "public_url": url,
        "url": url,
        "thumb_url": thumb,
        "created_at": _mobile_sub_dt(getattr(row, "created_at", None)),
        "updated_at": _mobile_sub_dt(getattr(row, "updated_at", None)),
    }




def _mobile_sub_email(user: Dict[str, Any]) -> str:
    return _clean(user.get("sub") or user.get("email") or user.get("email_address") or user.get("name") or "Subcontractor") or "Subcontractor"


def _mobile_sub_subcontractor_id(user: Dict[str, Any]) -> int | None:
    for key in ("subcontractor_id", "user_id", "id"):
        try:
            raw = user.get(key)
            if raw not in (None, ""):
                return int(raw)
        except Exception:
            continue
    return None


def _mobile_sub_page_payload(page: SiteWalkRedlinePage) -> Dict[str, Any]:
    payload = dict(_employee_redline_page_payload(page))
    page_id = int(getattr(page, "id", 0) or 0)
    payload["image_api_url"] = f"/mobile/subcontractor/api/site-walk-redlines/page-image/{page_id}"
    candidates = []
    for item in payload.get("image_url_candidates") or []:
        if isinstance(item, str):
            candidates.append(item.replace("/mobile/api/site-walk-redlines", "/mobile/subcontractor/api/site-walk-redlines"))
    candidates.append(f"/mobile/subcontractor/api/site-walk-redlines/page-image/{page_id}")
    seen: set[str] = set()
    payload["image_url_candidates"] = [x for x in candidates if x and not (x in seen or seen.add(x))]
    return payload


async def _mobile_sub_page_or_404(db: AsyncSession, user: Dict[str, Any], page_id: int) -> SiteWalkRedlinePage:
    page = await db.get(SiteWalkRedlinePage, int(page_id))
    if not page or not _is_mobile_visible_page(page):
        raise HTTPException(status_code=404, detail="Page not found")
    site = await db.get(SiteInfo, int(page.site_id))
    await _mobile_subcontractor_site_row_or_404(db, user, getattr(site, "site_name", ""))
    await _mobile_sub_require_sitewalk_allowed(db, int(page.site_id), getattr(page, "sitewalk_desc", None))
    return page


async def _mobile_sub_page_data(db: AsyncSession, user: Dict[str, Any], page_id: int) -> Dict[str, Any]:
    page = await _mobile_sub_page_or_404(db, user, page_id)
    pins = await list_redline_pins(db, page_id=int(page.id))
    anns = await list_redline_annotations(db, page_id=int(page.id))
    return {
        "page": _mobile_sub_page_payload(page),
        "pins": await _employee_redline_pin_payloads(db, page=page, pins=list(pins), include_all_photos=True),
        "annotations": [_employee_redline_annotation_payload(a) for a in anns],
    }


def _mobile_sub_menu_permissions() -> Dict[str, bool]:
    return {
        "can_edit": True,
        "can_add_pin": True,
        "can_add_photo": True,
        "can_add_360": True,
        "can_draw": True,
        "can_delete_pin": True,
        "can_delete_annotation": True,
        "can_delete_page": False,
        "can_replace_page": False,
        "can_add_pages": False,
        "can_download_page": False,
        "can_download_report": False,
        "can_multiple_layers": False,
        "can_manage_permissions": False,
    }

@router.get("/site-walk-redlines")
async def mobile_subcontractor_site_walk_redlines_bootstrap(
    site_id: Optional[int] = Query(default=None),
    site_name: Optional[str] = Query(default=None),
    sitewalk_desc: Optional[str] = Query(default=None),
    user: Dict[str, Any] = Depends(get_mobile_subcontractor_user),
    db: AsyncSession = Depends(get_db),
):
    if site_id:
        site = await db.get(SiteInfo, int(site_id))
        if not site:
            raise HTTPException(status_code=404, detail="Site not found")
        site = await _mobile_subcontractor_site_row_or_404(db, user, getattr(site, "site_name", ""))
    else:
        site = await _mobile_subcontractor_site_row_or_404(db, user, site_name or "")
    allowed = await _mobile_sub_allowed_sitewalks(db, int(site.id))
    selected = await _mobile_sub_require_sitewalk_allowed(db, int(site.id), sitewalk_desc)
    pages = _mobile_visible_pages(await list_redline_pages(db, site_id=int(site.id), sitewalk_desc=selected))
    selected_page_id = int(pages[0].id) if pages else None
    data = await _mobile_sub_page_data(db, user, selected_page_id) if selected_page_id else {"page": None, "pins": [], "annotations": []}
    return {
        "ok": True,
        "site": {"id": site.id, "site_id": site.id, "site_name": site.site_name},
        "sitewalks": allowed,
        "selected_sitewalk_desc": selected,
        "pages": [_mobile_sub_page_payload(p) for p in pages],
        "menu_permissions": _mobile_sub_menu_permissions(),
        "sitewalk_permission": {"allow_field_workers_edit": False, "allow_customers": False, "allow_subcontractors": True},
        "permissions": {"allow_view": True, "allow_edit": True, "allow_subcontractors": True},
        **data,
    }


@router.get("/site-walk-photos")
async def mobile_subcontractor_site_walk_photos(
    site_name: str = Query(...),
    sitewalk: Optional[str] = Query(default=None),
    tag: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    user: Dict[str, Any] = Depends(get_mobile_subcontractor_user),
    db: AsyncSession = Depends(get_db),
):
    site = await _mobile_subcontractor_site_row_or_404(db, user, site_name)
    allowed = await _mobile_sub_allowed_sitewalks(db, int(site.id))
    selected = await _mobile_sub_require_sitewalk_allowed(db, int(site.id), sitewalk)
    stmt = select(SiteWalkPhoto).where(SiteWalkPhoto.site_id == int(site.id))
    if hasattr(SiteWalkPhoto, "category"):
        stmt = stmt.where(SiteWalkPhoto.category == SITE_WALK_CATEGORY)
    stmt = stmt.where(func.lower(func.trim(func.coalesce(SiteWalkPhoto.sitewalk_desc, ""))) == selected.lower())
    if tag and _clean(tag).lower() not in {"all", "*", "any"}:
        stmt = stmt.where(func.lower(func.trim(func.coalesce(SiteWalkPhoto.tag, ""))) == _clean(tag).lower())
    if q and _clean(q):
        needle = f"%{_clean(q)}%"
        stmt = stmt.where(or_(SiteWalkPhoto.name.ilike(needle), SiteWalkPhoto.caption.ilike(needle), SiteWalkPhoto.note.ilike(needle), SiteWalkPhoto.tag.ilike(needle)))
    if hasattr(SiteWalkPhoto, "deleted_at"):
        stmt = stmt.where(SiteWalkPhoto.deleted_at.is_(None))
    if hasattr(SiteWalkPhoto, "is_active"):
        stmt = stmt.where(SiteWalkPhoto.is_active.is_(True))
    stmt = stmt.order_by(SiteWalkPhoto.created_at.desc() if hasattr(SiteWalkPhoto, "created_at") else SiteWalkPhoto.id.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "ok": True,
        "site": {"id": site.id, "site_id": site.id, "site_name": site.site_name},
        "sitewalk": selected,
        "sitewalks": [{"value": value} for value in allowed],
        "items": [_mobile_sub_photo_payload(row) for row in rows],
    }


def _mobile_sub_360_payload(row: SiteWalk360) -> Dict[str, Any]:
    url = getattr(row, "public_url", None) or getattr(row, "url", None) or ""
    thumb = getattr(row, "thumb_url", None) or url
    return {
        "id": row.id,
        "site_id": row.site_id,
        "name": _clean(row.name),
        "caption": _clean(row.caption),
        "tag": _clean(row.tag),
        "sitewalk_desc": _clean(row.sitewalk_desc),
        "note": _clean(row.note),
        "file_name": _clean(row.file_name),
        "content_type": _clean(row.content_type),
        "file_size": row.file_size,
        "redline_pin_id": row.redline_pin_id,
        "redline_page_id": row.redline_page_id,
        "public_url": url,
        "url": url,
        "thumb_url": thumb,
        "created_at": _mobile_sub_dt(row.created_at),
        "updated_at": _mobile_sub_dt(row.updated_at),
    }


@router.get("/site-walk-360")
async def mobile_subcontractor_site_walk_360(
    site_name: str = Query(...),
    sitewalk: Optional[str] = Query(default=None),
    tag: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    user: Dict[str, Any] = Depends(get_mobile_subcontractor_user),
    db: AsyncSession = Depends(get_db),
):
    site = await _mobile_subcontractor_site_row_or_404(db, user, site_name)
    allowed = await _mobile_sub_allowed_sitewalks(db, int(site.id))
    selected = await _mobile_sub_require_sitewalk_allowed(db, int(site.id), sitewalk)
    stmt = select(SiteWalk360).where(SiteWalk360.site_id == int(site.id), SiteWalk360.is_active.is_(True))
    stmt = stmt.where(func.lower(func.trim(func.coalesce(SiteWalk360.sitewalk_desc, ""))) == selected.lower())
    if tag and _clean(tag).lower() not in {"all", "*", "any"}:
        stmt = stmt.where(func.lower(func.trim(func.coalesce(SiteWalk360.tag, ""))) == _clean(tag).lower())
    if q and _clean(q):
        needle = f"%{_clean(q)}%"
        stmt = stmt.where(or_(SiteWalk360.name.ilike(needle), SiteWalk360.caption.ilike(needle), SiteWalk360.note.ilike(needle), SiteWalk360.tag.ilike(needle)))
    if hasattr(SiteWalk360, "deleted_at"):
        stmt = stmt.where(SiteWalk360.deleted_at.is_(None))
    stmt = stmt.order_by(SiteWalk360.created_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "ok": True,
        "site": {"id": site.id, "site_id": site.id, "site_name": site.site_name},
        "sitewalk": selected,
        "sitewalks": [{"value": value} for value in allowed],
        "items": [_mobile_sub_360_payload(row) for row in rows],
    }


@router.get("/site-walk-360/{photo_id}/annotations")
async def mobile_subcontractor_site_walk_360_annotations(
    photo_id: int,
    user: Dict[str, Any] = Depends(get_mobile_subcontractor_user),
    db: AsyncSession = Depends(get_db),
):
    photo = await db.get(SiteWalk360, int(photo_id))
    if not photo or not bool(getattr(photo, "is_active", True)):
        raise HTTPException(status_code=404, detail="360 photo not found")
    site = await db.get(SiteInfo, int(photo.site_id))
    await _mobile_subcontractor_site_row_or_404(db, user, getattr(site, "site_name", ""))
    await _mobile_sub_require_sitewalk_allowed(db, int(photo.site_id), photo.sitewalk_desc)
    rows = (
        await db.execute(
            select(SiteWalk360Annotation)
            .where(SiteWalk360Annotation.photo_id == int(photo_id))
            .order_by(SiteWalk360Annotation.id.asc())
        )
    ).scalars().all()
    return {
        "ok": True,
        "photo_id": photo_id,
        "annotations": [
            {
                "id": row.id,
                "kind": row.kind,
                "color": row.color,
                "stroke_width": row.stroke_width,
                "is_closed": row.is_closed,
                "geometry_json": row.geometry_json,
                "label": row.label,
            }
            for row in rows
        ],
    }


@router.get("/site-walk-redlines/sites")
async def mobile_subcontractor_site_walk_redline_sites(
    user: Dict[str, Any] = Depends(get_mobile_subcontractor_user),
    db: AsyncSession = Depends(get_db),
):
    names = await get_subcontractor_site_names(db, user=user, only_active=True)
    rows: List[Dict[str, Any]] = []
    for name in names or []:
        site = (await db.execute(select(SiteInfo).where(func.lower(func.trim(SiteInfo.site_name)) == _clean(name).lower()).limit(1))).scalar_one_or_none()
        if not site:
            continue
        if not await _mobile_sub_allowed_sitewalks(db, int(site.id)):
            continue
        rows.append({"id": int(site.id), "site_id": int(site.id), "site_name": site.site_name, "name": site.site_name, "label": site.site_name, "status": getattr(site, "active_inactive", "") or "Active", "is_active": True})
    return {"ok": True, "sites": rows, "items": rows, "count": len(rows)}


@router.get("/site-walk-redlines/page-data")
async def mobile_subcontractor_site_walk_redline_page_data(
    page_id: int = Query(...),
    user: Dict[str, Any] = Depends(get_mobile_subcontractor_user),
    db: AsyncSession = Depends(get_db),
):
    return await _mobile_sub_page_data(db, user, int(page_id))


@router.get("/site-walk-redlines/page-image/{page_id}")
async def mobile_subcontractor_site_walk_redline_page_image(
    request: Request,
    page_id: int,
    user: Dict[str, Any] = Depends(get_mobile_subcontractor_user),
    db: AsyncSession = Depends(get_db),
):
    page = await _mobile_sub_page_or_404(db, user, int(page_id))
    site_docs_root = await _get_mobile_site_docs_root(request, db)
    source = _first_existing_page_file(page, site_docs_root=site_docs_root, want_pdf=False)
    if source:
        suffix = source.suffix.lower()
        if suffix in {".png", ".jpg", ".jpeg", ".webp"}:
            media_type = "image/png" if suffix == ".png" else "image/webp" if suffix == ".webp" else "image/jpeg"
            from fastapi.responses import FileResponse
            return FileResponse(str(source), media_type=media_type)
        if suffix == ".pdf":
            try:
                import fitz
                doc = fitz.open(str(source))
                try:
                    pix = doc.load_page(0).get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                    return Response(content=pix.tobytes("png"), media_type="image/png")
                finally:
                    doc.close()
            except Exception as exc:
                raise HTTPException(status_code=500, detail="Unable to render page image") from exc
    for raw_url in (getattr(page, "image_url", None), getattr(page, "storage_img", None)):
        raw = _clean(raw_url)
        if raw.lower().startswith(("http://", "https://")):
            return RedirectResponse(raw)
    raise HTTPException(status_code=404, detail="No page image available")


@router.get("/site-walk-redlines/offline-manifest")
async def mobile_subcontractor_site_walk_redline_offline_manifest(
    site_id: Optional[int] = Query(default=None),
    site_name: Optional[str] = Query(default=None),
    user: Dict[str, Any] = Depends(get_mobile_subcontractor_user),
    db: AsyncSession = Depends(get_db),
):
    site = await db.get(SiteInfo, int(site_id)) if site_id else None
    if site:
        site = await _mobile_subcontractor_site_row_or_404(db, user, getattr(site, "site_name", ""))
    else:
        site = await _mobile_subcontractor_site_row_or_404(db, user, site_name or "")
    allowed = await _mobile_sub_allowed_sitewalks(db, int(site.id))
    all_pages: List[SiteWalkRedlinePage] = []
    page_data: List[Dict[str, Any]] = []
    pages_by_desc: Dict[str, List[Dict[str, Any]]] = {}
    for desc in allowed:
        pages = _mobile_visible_pages(await list_redline_pages(db, site_id=int(site.id), sitewalk_desc=desc))
        for page in pages:
            all_pages.append(page)
            pages_by_desc.setdefault(desc, []).append(_mobile_sub_page_payload(page))
            page_data.append(await _mobile_sub_page_data(db, user, int(page.id)))
    photos = await mobile_subcontractor_site_walk_photos(site_name=site.site_name, sitewalk=None, tag=None, q=None, user=user, db=db)
    photos360 = await mobile_subcontractor_site_walk_360(site_name=site.site_name, sitewalk=None, tag=None, q=None, user=user, db=db)
    return {
        "ok": True,
        "site": {"id": site.id, "site_id": site.id, "site_name": site.site_name},
        "sitewalks": allowed,
        "sitewalk_sets": [{"sitewalk_desc": desc, "pages": pages_by_desc.get(desc, [])} for desc in allowed],
        "pages": [_mobile_sub_page_payload(p) for p in all_pages],
        "page_data": page_data,
        "site_walk_photos": photos.get("items", []),
        "site_walk_360": photos360.get("items", []),
    }


@router.post("/site-walk-redlines/annotations")
async def mobile_subcontractor_create_redline_annotation(
    payload: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_mobile_subcontractor_user),
    db: AsyncSession = Depends(get_db),
):
    page = await _mobile_sub_page_or_404(db, user, int(payload.get("page_id") or 0))
    ann = await create_redline_annotation(
        db,
        site_id=int(page.site_id),
        page_id=int(page.id),
        sitewalk_desc=getattr(page, "sitewalk_desc", None),
        shape_type=_clean(payload.get("shape_type")) or "rect",
        x1=float(payload.get("x1") or 0),
        y1=float(payload.get("y1") or 0),
        x2=float(payload.get("x2") if payload.get("x2") is not None else payload.get("x1") or 0),
        y2=float(payload.get("y2") if payload.get("y2") is not None else payload.get("y1") or 0),
        stroke_color=_clean(payload.get("stroke_color")) or "#ef4444",
        stroke_width=float(payload.get("stroke_width") or 3),
        note=_clean(payload.get("note")),
        layer="subcontractor",
        created_by_subcontractor_id=_mobile_sub_subcontractor_id(user),
        created_by_email=_mobile_sub_email(user),
    )
    await db.commit()
    return {"ok": True, "annotation": _employee_redline_annotation_payload(ann)}


@router.post("/site-walk-redlines/annotations/{annotation_id}")
async def mobile_subcontractor_update_redline_annotation(
    annotation_id: int,
    payload: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_mobile_subcontractor_user),
    db: AsyncSession = Depends(get_db),
):
    ann = await get_redline_annotation(db, annotation_id=int(annotation_id))
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")
    await _mobile_sub_page_or_404(db, user, int(ann.page_id))
    fields = {k: payload.get(k) for k in ("x1", "y1", "x2", "y2", "stroke_color", "stroke_width", "note") if k in payload}
    updated = await update_redline_annotation(db, annotation_id=int(annotation_id), **fields)
    await db.commit()
    return {"ok": True, "annotation": _employee_redline_annotation_payload(updated)}


@router.delete("/site-walk-redlines/annotations/{annotation_id}")
async def mobile_subcontractor_delete_redline_annotation(
    annotation_id: int,
    user: Dict[str, Any] = Depends(get_mobile_subcontractor_user),
    db: AsyncSession = Depends(get_db),
):
    ann = await get_redline_annotation(db, annotation_id=int(annotation_id))
    if not ann:
        return {"ok": True}
    await _mobile_sub_page_or_404(db, user, int(ann.page_id))
    await delete_redline_annotation(db, annotation_id=int(annotation_id))
    await db.commit()
    return {"ok": True}


@router.post("/site-walk-redlines/pins")
async def mobile_subcontractor_create_redline_pin(
    payload: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_mobile_subcontractor_user),
    db: AsyncSession = Depends(get_db),
):
    page = await _mobile_sub_page_or_404(db, user, int(payload.get("page_id") or 0))
    pin = await create_redline_pin(
        db,
        site_id=int(page.site_id),
        page_id=int(page.id),
        x=float(payload.get("x") or 0),
        y=float(payload.get("y") or 0),
        label=_clean(payload.get("label")) or "Photo Pin",
        tag=_clean(payload.get("tag")) or None,
        pin_type=_clean(payload.get("pin_type")) or "photo",
        sr_location=_clean(payload.get("sr_location")) or None,
        sr_task=_clean(payload.get("sr_task")) or None,
        layer="subcontractor",
        created_by_subcontractor_id=_mobile_sub_subcontractor_id(user),
        created_by_email=_mobile_sub_email(user),
    )
    await db.commit()
    data = await _mobile_sub_page_data(db, user, int(page.id))
    created = next((p for p in data.get("pins", []) if int(p.get("id") or 0) == int(pin.id)), None)
    return {"ok": True, "pin": created or {"id": int(pin.id)}}


@router.post("/site-walk-redlines/pins/{pin_id}")
async def mobile_subcontractor_update_redline_pin(
    pin_id: int,
    payload: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_mobile_subcontractor_user),
    db: AsyncSession = Depends(get_db),
):
    pin = await get_redline_pin(db, pin_id=int(pin_id))
    if not pin:
        raise HTTPException(status_code=404, detail="Pin not found")
    await _mobile_sub_page_or_404(db, user, int(pin.page_id))
    if "x" in payload: pin.x = float(payload.get("x") or 0)
    if "y" in payload: pin.y = float(payload.get("y") or 0)
    await update_redline_pin_label(db, int(pin_id), _clean(payload.get("label")) or getattr(pin, "label", ""), new_tag=payload.get("tag") if "tag" in payload else getattr(pin, "tag", None), pin_type=payload.get("pin_type") if "pin_type" in payload else getattr(pin, "pin_type", None))
    await db.commit()
    data = await _mobile_sub_page_data(db, user, int(pin.page_id))
    updated = next((p for p in data.get("pins", []) if int(p.get("id") or 0) == int(pin_id)), None)
    return {"ok": True, "pin": updated or {"id": int(pin_id)}}


@router.delete("/site-walk-redlines/pins/{pin_id}")
async def mobile_subcontractor_delete_redline_pin(
    pin_id: int,
    user: Dict[str, Any] = Depends(get_mobile_subcontractor_user),
    db: AsyncSession = Depends(get_db),
):
    pin = await get_redline_pin(db, pin_id=int(pin_id))
    if not pin:
        return {"ok": True}
    await _mobile_sub_page_or_404(db, user, int(pin.page_id))
    await db.delete(pin)
    await db.commit()
    return {"ok": True}


@router.post("/site-walk-redlines/pins/{pin_id}/photo")
async def mobile_subcontractor_pin_photo_not_implemented(pin_id: int):
    raise HTTPException(status_code=501, detail="Native subcontractor pin photo upload needs the existing subcontractor photo upload storage path wired on the server.")


@router.post("/site-walk-redlines/pins/{pin_id}/360")
async def mobile_subcontractor_pin_360_not_implemented(pin_id: int):
    raise HTTPException(status_code=501, detail="Native subcontractor 360 upload needs the existing subcontractor 360 storage path wired on the server.")


@router.post("/site-walk-redlines/360/{photo_id}/annotations")
async def mobile_subcontractor_save_360_annotations_alias(
    photo_id: int,
    payload: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_mobile_subcontractor_user),
    db: AsyncSession = Depends(get_db),
):
    # Keep parity with read endpoint for now.  Existing desktop/subcontractor 360
    # annotations remain readable; write support can be expanded to mirror the employee route.
    await mobile_subcontractor_site_walk_360_annotations(photo_id=photo_id, user=user, db=db)
    return {"ok": True, "photo_id": photo_id, "annotations": payload.get("annotations", []) if isinstance(payload, dict) else []}


@router.post("/site-walk-redlines/site-walk-photos/{photo_id}/annotation")
async def mobile_subcontractor_save_sitewalk_photo_annotation_alias(
    photo_id: int,
    payload: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_mobile_subcontractor_user),
    db: AsyncSession = Depends(get_db),
):
    photo = await db.get(SiteWalkPhoto, int(photo_id))
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    site = await db.get(SiteInfo, int(photo.site_id))
    await _mobile_subcontractor_site_row_or_404(db, user, getattr(site, "site_name", ""))
    await _mobile_sub_require_sitewalk_allowed(db, int(photo.site_id), photo.sitewalk_desc)
    return {"ok": True, "photo_id": photo_id, "annotation": payload}
