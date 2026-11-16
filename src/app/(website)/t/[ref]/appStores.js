/**
 * Store destinations used by the public share landing page.
 */

/** Verified from the mobile repo: androidApp `applicationId`. */
export const ANDROID_PACKAGE_NAME = "com.nayroz.android";

export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE_NAME}`;

/**
 * ⚠️ PLACEHOLDER — not a real App Store id.
 *
 * The numeric App Store id is assigned by App Store Connect on first submission
 * and appears nowhere in either repo, so it cannot be derived here. Replace the
 * string below with the digits from
 * App Store Connect > App Information > "Apple ID" (or the `id########` segment
 * of the app's App Store URL); `APP_STORE_URL` then switches itself over.
 *
 * Until then the iOS button points at the site's own download page rather than a
 * fabricated apps.apple.com URL that would 404.
 */
export const APP_STORE_APP_ID = "REPLACE_WITH_APP_STORE_ID";

const APP_STORE_ID_IS_REAL = /^\d+$/.test(APP_STORE_APP_ID);

export const APP_STORE_URL = APP_STORE_ID_IS_REAL
  ? `https://apps.apple.com/app/id${APP_STORE_APP_ID}`
  : "/download.html";
