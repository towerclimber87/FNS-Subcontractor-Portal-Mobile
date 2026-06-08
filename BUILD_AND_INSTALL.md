# FNS Subcontractor Portal Mobile — Build and Install Notes

## 1. Install mobile dependencies

From the project root:

```bash
npm install
```

The lock file is included, so installs should use the exact dependency tree.

## 2. Start local Expo testing

```bash
npx expo start
```

Then scan the QR code or run:

```bash
npm run ios
npm run android
```

## 3. Install the ERP backend patch

Copy:

```text
backend_patch/app/routes/mobile_subcontractor_api_route.py
```

into the ERP project at:

```text
app/routes/mobile_subcontractor_api_route.py
```

Then restart the ERP service:

```bash
sudo systemctl restart fns.service
```

## 4. Verify the backend endpoint

Open:

```text
https://fnsportal.com/mobile/subcontractor/api/server-info
```

Expected response includes:

```json
{
  "ok": true,
  "portal_type": "subcontractor",
  "mobile_api": true
}
```

## 5. Build with EAS

Make sure you are logged into Expo/EAS:

```bash
eas login
```

Internal/TestFlight style builds:

```bash
eas build --platform ios --profile preview
neas build --platform android --profile preview
```

Production builds:

```bash
eas build --platform ios --profile production
neas build --platform android --profile production
```

## 6. Current identifiers

```text
iOS bundle identifier: com.fouriernetworksolutions.fnssubcontractorportal
Android package:        com.fouriernetworksolutions.fnssubcontractorportal
App version:            1.0.0
iOS build number:       1
Android version code:   1
```

## 7. What this first build does

The native app handles:

- Subcontractor-only login
- Clean subcontractor landing page
- Logout
- Active / under-construction assigned project list
- Permission-filtered subcontractor tools

The individual subcontractor tools currently open the existing ERP web pages inside a WebView using the mobile session bridge. That keeps the current ERP permissions, uploads, photos, redlines, daily reports, and tracker logic working while each page is rebuilt natively later.
