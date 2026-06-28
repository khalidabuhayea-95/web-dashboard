import { initializeApp, getApps, deleteApp, cert } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

import { getPushSettings, isPushConfigured } from "@/lib/settings/pushSettings.server";

// Lazily initialize a dedicated firebase-admin App from the service account
// stored in the DB. The app is cached and re-initialized only when the stored
// credentials change (keyed by a hash of the credential fields).
const APP_NAME = "push-fcm";

let cachedCredentialKey = null;

function credentialKey(serviceAccount) {
  return [serviceAccount.projectId, serviceAccount.clientEmail, serviceAccount.privateKey].join(
    "::",
  );
}

export class PushNotConfiguredError extends Error {
  constructor(message = "Firebase push is not configured.") {
    super(message);
    this.name = "PushNotConfiguredError";
    this.code = "PUSH_NOT_CONFIGURED";
  }
}

async function getOrInitApp() {
  const settings = await getPushSettings();
  if (!isPushConfigured(settings)) {
    throw new PushNotConfiguredError();
  }

  const serviceAccount = settings.serviceAccount;
  const key = credentialKey(serviceAccount);
  const existing = getApps().find((app) => app.name === APP_NAME);

  if (existing && cachedCredentialKey === key) {
    return existing;
  }

  // First init, or credentials changed since last init — recreate the app.
  if (existing) {
    await deleteApp(existing).catch(() => {});
  }

  const app = initializeApp(
    {
      credential: cert({
        projectId: serviceAccount.projectId,
        clientEmail: serviceAccount.clientEmail,
        privateKey: serviceAccount.privateKey,
      }),
    },
    APP_NAME,
  );
  cachedCredentialKey = key;
  return app;
}

export async function getPushMessaging() {
  const app = await getOrInitApp();
  return getMessaging(app);
}

export async function pushConfigured() {
  return isPushConfigured(await getPushSettings());
}
