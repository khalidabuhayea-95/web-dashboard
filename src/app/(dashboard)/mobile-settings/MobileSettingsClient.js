"use client";

import { Apple, Globe, KeyRound, LockKeyhole, ShieldCheck, ShieldEllipsis, Smartphone } from "lucide-react";

import { Input, Label, Textarea } from "@/components/ui/form";
import {
  CredentialState,
  FieldBlock,
  SectionFooter,
  SettingsSection,
  SwitchRow,
  statusBadge,
  useSettingsForm,
} from "@/components/settings/settingsKit";

const MOBILE_RELEASE_INITIAL_FORM = {
  androidMinimumSupportedVersion: "",
  androidEnableCache: false,
  androidRedirectLink: "",
  iosMinimumSupportedVersion: "",
  iosEnableCache: false,
  iosRedirectLink: "",
};

const MOBILE_AUTH_INITIAL_FORM = {
  googleEnabled: false,
  googleAndroidClientIds: "",
  googleIosClientIds: "",
  facebookEnabled: false,
  facebookAppId: "",
  facebookAppSecret: "",
  facebookAppSecretMasked: "",
  facebookAppSecretConfigured: false,
  appleEnabled: false,
  appleIosBundleIds: "",
  accessTokenSecret: "",
  accessTokenSecretMasked: "",
  accessTokenSecretConfigured: false,
  accessTokenTtlMinutes: "10080",
  refreshTokenSecret: "",
  refreshTokenSecretMasked: "",
  refreshTokenSecretConfigured: false,
  refreshTokenTtlDays: "30",
};

function mapMobileReleaseSettings(settings) {
  return {
    androidMinimumSupportedVersion: String(
      settings?.android?.minimumSupportedVersion ?? ""
    ),
    androidEnableCache: Boolean(settings?.android?.enableCache),
    androidRedirectLink: String(settings?.android?.redirectLink ?? ""),
    iosMinimumSupportedVersion: String(settings?.ios?.minimumSupportedVersion ?? ""),
    iosEnableCache: Boolean(settings?.ios?.enableCache),
    iosRedirectLink: String(settings?.ios?.redirectLink ?? ""),
  };
}

function mapMobileAuthSettings(settings) {
  return {
    googleEnabled: Boolean(settings?.google?.enabled),
    googleAndroidClientIds: (settings?.google?.androidClientIds || []).join("\n"),
    googleIosClientIds: (settings?.google?.iosClientIds || []).join("\n"),
    facebookEnabled: Boolean(settings?.facebook?.enabled),
    facebookAppId: String(settings?.facebook?.appId || ""),
    facebookAppSecret: "",
    facebookAppSecretMasked: String(settings?.facebook?.appSecretMasked || ""),
    facebookAppSecretConfigured: Boolean(settings?.facebook?.appSecretConfigured),
    appleEnabled: Boolean(settings?.apple?.enabled),
    appleIosBundleIds: (settings?.apple?.iosBundleIds || []).join("\n"),
    accessTokenSecret: "",
    accessTokenSecretMasked: String(settings?.bearer?.accessTokenSecretMasked || ""),
    accessTokenSecretConfigured: Boolean(settings?.bearer?.accessTokenSecretConfigured),
    accessTokenTtlMinutes: String(settings?.bearer?.accessTokenTtlMinutes || "10080"),
    refreshTokenSecret: "",
    refreshTokenSecretMasked: String(settings?.bearer?.refreshTokenSecretMasked || ""),
    refreshTokenSecretConfigured: Boolean(settings?.bearer?.refreshTokenSecretConfigured),
    refreshTokenTtlDays: String(settings?.bearer?.refreshTokenTtlDays || "30"),
  };
}

function PlatformCard({
  platform,
  versionId,
  toggleId,
  redirectId,
  versionValue,
  onVersionChange,
  cacheEnabled,
  onCacheChange,
  redirectValue,
  onRedirectChange,
  disabled,
}) {
  const isAndroid = platform === "Android";
  return (
    <div className="rounded-xl border border-border/70 bg-white p-4">
      <div className="mb-4 flex items-center gap-2.5">
        {isAndroid ? (
          <Smartphone className="h-4 w-4 text-[color:var(--ds-primary)]" aria-hidden="true" />
        ) : (
          <Apple className="h-4 w-4 text-[color:var(--ds-primary)]" aria-hidden="true" />
        )}
        <h3 className="text-sm font-semibold text-[color:var(--ds-text)]">{platform}</h3>
      </div>
      <div className="space-y-3.5">
        <FieldBlock id={versionId} label="Minimum version code">
          <Input
            id={versionId}
            type="number"
            min="0"
            inputMode="numeric"
            value={versionValue}
            onChange={onVersionChange}
            disabled={disabled}
            placeholder="e.g. 205"
          />
        </FieldBlock>

        <SwitchRow
          id={toggleId}
          label="Enable cache"
          checked={cacheEnabled}
          onChange={onCacheChange}
          disabled={disabled}
        />

        <FieldBlock id={redirectId} label="Redirect link">
          <Input
            id={redirectId}
            type="url"
            value={redirectValue}
            onChange={onRedirectChange}
            disabled={disabled}
            placeholder={
              isAndroid
                ? "https://play.google.com/store/apps/details?id=..."
                : "https://apps.apple.com/app/id..."
            }
          />
        </FieldBlock>
      </div>
    </div>
  );
}

function ProviderCard({
  icon: Icon,
  title,
  toggleId,
  toggleLabel,
  enabled,
  onToggle,
  disabled,
  children,
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-white p-4">
      <div className="mb-4 flex items-center gap-2.5">
        <Icon className="h-4 w-4 text-[color:var(--ds-primary)]" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-[color:var(--ds-text)]">{title}</h3>
      </div>
      <div className="space-y-3.5">
        <SwitchRow
          id={toggleId}
          label={toggleLabel}
          checked={enabled}
          onChange={onToggle}
          disabled={disabled}
        />
        <div className="space-y-3.5">{children}</div>
      </div>
    </div>
  );
}

function MobileSettingsClient() {
  const releaseControls = useSettingsForm({
    endpoint: "/api/settings/mobile-app",
    initialForm: MOBILE_RELEASE_INITIAL_FORM,
    loadingMessage: "Loading release controls...",
    savingMessage: "Saving release controls...",
    successMessage: "Release controls saved.",
    mapSettings: mapMobileReleaseSettings,
    buildPayload: (form) => ({
      android: {
        minimumSupportedVersion: form.androidMinimumSupportedVersion,
        enableCache: form.androidEnableCache,
        redirectLink: form.androidRedirectLink,
      },
      ios: {
        minimumSupportedVersion: form.iosMinimumSupportedVersion,
        enableCache: form.iosEnableCache,
        redirectLink: form.iosRedirectLink,
      },
    }),
  });






  const mobileAuth = useSettingsForm({
    endpoint: "/api/settings/mobile-auth",
    initialForm: MOBILE_AUTH_INITIAL_FORM,
    loadingMessage: "Loading mobile auth settings...",
    savingMessage: "Saving mobile auth settings...",
    successMessage: "Authentication settings saved.",
    mapSettings: mapMobileAuthSettings,
    buildPayload: (form) => ({
      google: {
        enabled: form.googleEnabled,
        androidClientIds: form.googleAndroidClientIds,
        iosClientIds: form.googleIosClientIds,
      },
      facebook: {
        enabled: form.facebookEnabled,
        appId: form.facebookAppId,
        appSecret: form.facebookAppSecret,
      },
      apple: {
        enabled: form.appleEnabled,
        iosBundleIds: form.appleIosBundleIds,
      },
      bearer: {
        accessTokenSecret: form.accessTokenSecret,
        accessTokenTtlMinutes: form.accessTokenTtlMinutes,
        refreshTokenSecret: form.refreshTokenSecret,
        refreshTokenTtlDays: form.refreshTokenTtlDays,
      },
    }),
  });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 pb-10 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-[color:var(--ds-text)]">
          Mobile settings
        </h1>
        <p className="mt-1 text-sm text-[color:var(--ds-text-muted)]">
          Release gating and sign-in for the mobile app. AI model routing lives in AI settings.
        </p>
      </div>

      <SettingsSection
        title="App release"
        icon={ShieldCheck}
        badge={statusBadge(releaseControls)}
        footer={
          <SectionFooter
            status={releaseControls.status}
            updatedAt={releaseControls.updatedAt}
            canEdit={releaseControls.canEdit}
            saving={releaseControls.saving}
            hasChanges={releaseControls.hasChanges}
            onSave={releaseControls.save}
            saveLabel="Save"
          />
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <PlatformCard
            platform="Android"
            versionId="mobile-android-version-code"
            toggleId="mobile-android-enable-cache"
            redirectId="mobile-android-redirect-link"
            versionValue={releaseControls.form.androidMinimumSupportedVersion}
            onVersionChange={(event) =>
              releaseControls.setForm((current) => ({
                ...current,
                androidMinimumSupportedVersion: event.target.value,
              }))
            }
            cacheEnabled={releaseControls.form.androidEnableCache}
            onCacheChange={(event) =>
              releaseControls.setForm((current) => ({
                ...current,
                androidEnableCache: event.target.checked,
              }))
            }
            redirectValue={releaseControls.form.androidRedirectLink}
            onRedirectChange={(event) =>
              releaseControls.setForm((current) => ({
                ...current,
                androidRedirectLink: event.target.value,
              }))
            }
            disabled={releaseControls.disabled}
          />
          <PlatformCard
            platform="iOS"
            versionId="mobile-ios-version-code"
            toggleId="mobile-ios-enable-cache"
            redirectId="mobile-ios-redirect-link"
            versionValue={releaseControls.form.iosMinimumSupportedVersion}
            onVersionChange={(event) =>
              releaseControls.setForm((current) => ({
                ...current,
                iosMinimumSupportedVersion: event.target.value,
              }))
            }
            cacheEnabled={releaseControls.form.iosEnableCache}
            onCacheChange={(event) =>
              releaseControls.setForm((current) => ({
                ...current,
                iosEnableCache: event.target.checked,
              }))
            }
            redirectValue={releaseControls.form.iosRedirectLink}
            onRedirectChange={(event) =>
              releaseControls.setForm((current) => ({
                ...current,
                iosRedirectLink: event.target.value,
              }))
            }
            disabled={releaseControls.disabled}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Sign-in & sessions"
        icon={LockKeyhole}
        badge={statusBadge(mobileAuth)}
        footer={
          <SectionFooter
            status={mobileAuth.status}
            updatedAt={mobileAuth.updatedAt}
            canEdit={mobileAuth.canEdit}
            saving={mobileAuth.saving}
            hasChanges={mobileAuth.hasChanges}
            onSave={mobileAuth.save}
            saveLabel="Save"
          />
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <ProviderCard
            icon={Globe}
            title="Google"
            toggleId="mobile-google-enabled"
            toggleLabel="Allow Google sign-in"
            enabled={mobileAuth.form.googleEnabled}
            onToggle={(event) =>
              mobileAuth.setForm((current) => ({
                ...current,
                googleEnabled: event.target.checked,
              }))
            }
            disabled={mobileAuth.disabled}
          >
            <FieldBlock
              id="mobile-google-android-client-ids"
              label="Android client IDs"
              hint="One per line."
            >
              <Textarea
                id="mobile-google-android-client-ids"
                value={mobileAuth.form.googleAndroidClientIds}
                onChange={(event) =>
                  mobileAuth.setForm((current) => ({
                    ...current,
                    googleAndroidClientIds: event.target.value,
                  }))
                }
                disabled={mobileAuth.disabled}
                placeholder="com.example.android.apps..."
                className="min-h-[96px] text-sm"
              />
            </FieldBlock>
            <FieldBlock
              id="mobile-google-ios-client-ids"
              label="iOS client IDs"
              hint="One per line."
            >
              <Textarea
                id="mobile-google-ios-client-ids"
                value={mobileAuth.form.googleIosClientIds}
                onChange={(event) =>
                  mobileAuth.setForm((current) => ({
                    ...current,
                    googleIosClientIds: event.target.value,
                  }))
                }
                disabled={mobileAuth.disabled}
                placeholder="com.example.ios.apps..."
                className="min-h-[96px] text-sm"
              />
            </FieldBlock>
          </ProviderCard>

          <ProviderCard
            icon={ShieldEllipsis}
            title="Facebook"
            toggleId="mobile-facebook-enabled"
            toggleLabel="Allow Facebook sign-in"
            enabled={mobileAuth.form.facebookEnabled}
            onToggle={(event) =>
              mobileAuth.setForm((current) => ({
                ...current,
                facebookEnabled: event.target.checked,
              }))
            }
            disabled={mobileAuth.disabled}
          >
            <FieldBlock id="mobile-facebook-app-id" label="App ID">
              <Input
                id="mobile-facebook-app-id"
                value={mobileAuth.form.facebookAppId}
                onChange={(event) =>
                  mobileAuth.setForm((current) => ({
                    ...current,
                    facebookAppId: event.target.value,
                  }))
                }
                disabled={mobileAuth.disabled}
                placeholder="Enter Facebook App ID"
              />
            </FieldBlock>
            <FieldBlock
              id="mobile-facebook-app-secret"
              label="App secret"
              hint="Leave empty to keep the current secret."
            >
              <Input
                id="mobile-facebook-app-secret"
                type="password"
                value={mobileAuth.form.facebookAppSecret}
                onChange={(event) =>
                  mobileAuth.setForm((current) => ({
                    ...current,
                    facebookAppSecret: event.target.value,
                  }))
                }
                disabled={mobileAuth.disabled}
                placeholder={
                  mobileAuth.form.facebookAppSecretConfigured
                    ? "Enter new secret to replace existing"
                    : "Enter Facebook App Secret"
                }
              />
            </FieldBlock>
            <CredentialState
              configured={mobileAuth.form.facebookAppSecretConfigured}
              maskedValue={mobileAuth.form.facebookAppSecretMasked}
              emptyCopy="No Facebook secret stored yet."
            />
          </ProviderCard>

          <ProviderCard
            icon={Apple}
            title="Apple"
            toggleId="mobile-apple-enabled"
            toggleLabel="Allow Apple sign-in"
            enabled={mobileAuth.form.appleEnabled}
            onToggle={(event) =>
              mobileAuth.setForm((current) => ({
                ...current,
                appleEnabled: event.target.checked,
              }))
            }
            disabled={mobileAuth.disabled}
          >
            <FieldBlock
              id="mobile-apple-bundle-ids"
              label="Allowed iOS bundle IDs"
              hint="One per line."
            >
              <Textarea
                id="mobile-apple-bundle-ids"
                value={mobileAuth.form.appleIosBundleIds}
                onChange={(event) =>
                  mobileAuth.setForm((current) => ({
                    ...current,
                    appleIosBundleIds: event.target.value,
                  }))
                }
                disabled={mobileAuth.disabled}
                placeholder="com.example.ios"
                className="min-h-[96px] text-sm"
              />
            </FieldBlock>
          </ProviderCard>

          <div className="rounded-xl border border-border/70 bg-white p-4">
            <div className="mb-4 flex items-center gap-2.5">
              <KeyRound className="h-4 w-4 text-[color:var(--ds-primary)]" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-[color:var(--ds-text)]">Bearer sessions</h3>
            </div>
            <div className="space-y-3.5">
              <p className="rounded-lg border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-xs leading-5 text-amber-800">
                Rotating a token secret can sign out clients holding older tokens.
              </p>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <FieldBlock
                  id="mobile-access-token-secret"
                  label="Access token secret"
                  hint="Leave empty to keep current."
                >
                  <Input
                    id="mobile-access-token-secret"
                    type="password"
                    value={mobileAuth.form.accessTokenSecret}
                    onChange={(event) =>
                      mobileAuth.setForm((current) => ({
                        ...current,
                        accessTokenSecret: event.target.value,
                      }))
                    }
                    disabled={mobileAuth.disabled}
                    placeholder={
                      mobileAuth.form.accessTokenSecretConfigured
                        ? "Enter new secret to replace existing"
                        : "Enter access token secret"
                    }
                  />
                </FieldBlock>
                <FieldBlock
                  id="mobile-access-token-ttl"
                  label="Access token TTL (min)"
                  hint="10080 = 7 days."
                >
                  <Input
                    id="mobile-access-token-ttl"
                    type="number"
                    min="1"
                    inputMode="numeric"
                    value={mobileAuth.form.accessTokenTtlMinutes}
                    onChange={(event) =>
                      mobileAuth.setForm((current) => ({
                        ...current,
                        accessTokenTtlMinutes: event.target.value,
                      }))
                    }
                    disabled={mobileAuth.disabled}
                  />
                </FieldBlock>
                <FieldBlock
                  id="mobile-refresh-token-secret"
                  label="Refresh token secret"
                  hint="Leave empty to keep current."
                >
                  <Input
                    id="mobile-refresh-token-secret"
                    type="password"
                    value={mobileAuth.form.refreshTokenSecret}
                    onChange={(event) =>
                      mobileAuth.setForm((current) => ({
                        ...current,
                        refreshTokenSecret: event.target.value,
                      }))
                    }
                    disabled={mobileAuth.disabled}
                    placeholder={
                      mobileAuth.form.refreshTokenSecretConfigured
                        ? "Enter new secret to replace existing"
                        : "Enter refresh token secret"
                    }
                  />
                </FieldBlock>
                <FieldBlock id="mobile-refresh-token-ttl" label="Refresh token TTL (days)">
                  <Input
                    id="mobile-refresh-token-ttl"
                    type="number"
                    min="1"
                    inputMode="numeric"
                    value={mobileAuth.form.refreshTokenTtlDays}
                    onChange={(event) =>
                      mobileAuth.setForm((current) => ({
                        ...current,
                        refreshTokenTtlDays: event.target.value,
                      }))
                    }
                    disabled={mobileAuth.disabled}
                  />
                </FieldBlock>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <CredentialState
                  configured={mobileAuth.form.accessTokenSecretConfigured}
                  maskedValue={mobileAuth.form.accessTokenSecretMasked}
                  emptyCopy="No access token secret stored yet."
                />
                <CredentialState
                  configured={mobileAuth.form.refreshTokenSecretConfigured}
                  maskedValue={mobileAuth.form.refreshTokenSecretMasked}
                  emptyCopy="No refresh token secret stored yet."
                />
              </div>
            </div>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}

export default MobileSettingsClient;
