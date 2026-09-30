# Tara

Tara is a mobile-first group planning app for iOS and Android. Every hangout gets a shared board for event details, RSVPs, things to bring, and tasks.

## What is implemented

- Three-page introduction with persistent completion state
- Upcoming and past plan dashboard
- Create and organizer-only edit flows, including optional cover photos
- Guest joining through an invite URL or short code
- Live plan board with RSVP visibility, atomic contribution claims, and assignable tasks
- Per-plan chat with member pings, paged history, unread indicators, and claimable requests linked to the plan board
- Optional Expo push notifications for pings, requests, and successful volunteer claims
- QR and system sharing for invitations
- Firebase Authentication with email/password, Google, and explicit anonymous guest access
- Rate-limited callable mutations, confirmed plan deletion/member removal/leave actions, and locked-down Firestore writes
- Manual plan completion, automatic hourly completion for elapsed dates, immediate backend read-only enforcement, and a 24-hour date-change lock
- Diffed Firestore listeners, deduplicated read receipts/settings, and cached push-token registration to reduce billed operations
- Typed Expo Router routes and native stack navigation

Polls, account linking, attachments, direct messages, typing indicators, and public read receipts are intentionally left for a later milestone.

## Run the app

Requirements: Node.js 22.13 or newer and an iOS/Android simulator, physical device, or web browser.

```sh
npm install
npm start
```

Firebase configuration is required. Copy `.env.example` to `.env` and provide every `EXPO_PUBLIC_FIREBASE_*` value before starting the app.

Useful checks:

```sh
npm run typecheck
npm run lint
npm run doctor
```

## Enable Firebase collaboration

1. Create a Firebase project and enable Anonymous, Email/Password, and Google Authentication, Cloud Firestore, and Storage.
2. Copy `.env.example` to `.env` and fill in the web app configuration values.
3. Save the Google provider's public-facing project name and support email. Copy its Web client ID into `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.
4. Add the SHA-1 fingerprints for every Android signing certificate (development, EAS upload, and Play App Signing), then download fresh `google-services.json` and `GoogleService-Info.plist` files.
5. Deploy Functions together with `firestore.rules`, `firestore.indexes.json`, and `storage.rules`. Direct plan mutations are intentionally denied by the rules because the rate-limited Functions perform them.
6. Create a new development build. Google sign-in uses native code and is not available in Expo Go.
7. Restart Expo so it reads the environment values.

The application starts only when all six `EXPO_PUBLIC_FIREBASE_*` values are present. A connection or permissions failure is shown in the UI and never falls back to local sample data.

## Enable chat notifications and scheduled completion

These features require the Blaze plan because they use Cloud Functions and Cloud Scheduler. Deploy the current backend in `asia-east2`, configure Android FCM v1 in EAS, and use a development build with the Firebase native configuration included.

1. Install the Android development build on a physical device.
2. Start the Expo development server and open the project from the development client.
3. Enable notifications from the banner in a plan chat and verify delivery between two guest sessions.
4. When Apple Developer access becomes available, run the iOS build interactively to create APNs/signing credentials and register a physical test device: `npx eas-cli@latest build --profile development --platform ios`.

Deploy backend changes with `npx firebase-tools deploy --only functions,firestore,storage`. On Windows, set `FUNCTIONS_DISCOVERY_TIMEOUT=60` if Firebase's default source-discovery timeout expires.

## Android testing workflows

- For live editing and Fast Refresh, install the development build and run `npx expo start --dev-client`. This workflow requires Metro to remain running.
- For UI and logic testing without Expo Go or a running terminal, install an internal preview build created with `npx eas-cli@latest build --profile preview --platform android`. The preview APK contains the JavaScript bundle and opens independently.

A preview build is a snapshot of the code at build time. Create another preview build after code or native configuration changes unless over-the-air updates are configured later.

Push delivery is best effort. The backend stores jobs, retries transient failures, checks Expo receipts, removes invalid tokens, and can be disabled by setting `config/push.deliveryEnabled` to `false` in Firestore. Messages remain saved when notification delivery fails.

Backend checks:

```sh
npm run functions:build
npm run test:emulator
```

## Invite/deferred-link setup

The app accepts `/join?code=...` through Expo Router and generates invitation links from `EXPO_PUBLIC_INVITE_BASE_URL`. Point that value at the production Branch link domain after creating the Branch app.

Firebase Dynamic Links is not used because it was retired in 2025. Completing the through-install handoff requires Branch credentials, its Expo config plugin, associated domains/app links, and a development build. Until those credentials exist, the short code shown below every QR is the reliable fallback.

## Project structure

- `src/app` — screens and navigation routes
- `src/components` — shared mobile UI components
- `src/providers` — application state and screen-facing actions
- `src/data` — Firebase repositories and data access
- `firestore.rules` / `storage.rules` — backend authorization

Build profiles for development, internal preview, and production are in `eas.json`.
