# FNS Subcontractor Portal Mobile

A clean Expo/React Native mobile app for subcontractor users. It uses the existing ERP subcontractor login, subcontractor role permissions, and assigned-site filtering as the source of truth.

## What is included

- Subcontractor-only login screen.
- Clean landing page with a header and logout button.
- Only projects under construction / active projects are shown.
- Project tool page with ERP-permission-gated subcontractor pages.
- WebView bridge for existing subcontractor web pages so the app can launch now while individual pages are rebuilt natively later.
- Backend patch route: `backend_patch/app/routes/mobile_subcontractor_api_route.py`.

## Install mobile dependencies

```bash
npm install
npx expo start
```

## Backend patch

Copy this file into the ERP project:

```text
backend_patch/app/routes/mobile_subcontractor_api_route.py -> app/routes/mobile_subcontractor_api_route.py
```

The ERP `app/main.py` already auto-includes route modules under `app.routes`, so no manual router include should be required. Restart the ERP service after copying it.

## Backend endpoints added

- `GET /mobile/subcontractor/api/server-info`
- `POST /mobile/subcontractor/api/auth/login`
- `POST /mobile/subcontractor/api/auth/logout`
- `GET /mobile/subcontractor/api/home`
- `GET /mobile/subcontractor/api/projects`
- `GET /mobile/subcontractor/api/session`

## App identifiers

- iOS display name: `FNS Subcontractor Portal`
- iOS bundle identifier: `com.fouriernetworksolutions.fnssubcontractorportal`
- Android package: `com.fouriernetworksolutions.fnssubcontractorportal`
- Version: `1.0.0`
- iOS build number: `1`
- Android version code: `1`

## Current launch approach

The app is ready for the main flow now. Existing complex subcontractor pages open through WebView using the new `/mobile/subcontractor/api/session` bridge, which sets the existing ERP `access_token` cookie and redirects into the current web page. That lets all current web permissions, uploads, photos, redlines, daily reports, and tracker logic keep working while native versions are built page-by-page.
