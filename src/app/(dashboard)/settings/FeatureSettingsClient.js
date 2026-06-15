"use client";

import { useEffect, useState } from "react";

import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form";

function formatErrorMessage(payload, fallback = "Request failed.") {
  const details = [];
  if (payload?.error && typeof payload.error === "string") {
    details.push(payload.error);
  }
  if (
    payload?.details &&
    typeof payload.details === "string" &&
    payload.details !== payload.error
  ) {
    details.push(payload.details);
  }
  return details.length > 0 ? details.join(" ") : fallback;
}

function TextAreaField({
  id,
  label,
  value,
  onChange,
  placeholder,
  disabled = false,
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        rows={4}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      />
    </div>
  );
}

function ToggleField({ id, label, checked, onChange, disabled = false }) {
  return (
    <label className="flex items-center gap-3 text-sm font-medium text-foreground" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="h-4 w-4 rounded border border-border"
      />
      <span>{label}</span>
    </label>
  );
}

function FreepikSettingsCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyMasked, setApiKeyMasked] = useState("");
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [status, setStatus] = useState("Loading Magnific settings...");

  useEffect(() => {
    let mounted = true;

    const loadSettings = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/settings/freepik", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(formatErrorMessage(payload, "Failed to load Magnific settings."));
        }

        if (!mounted) return;
        const settings = payload?.settings || {};
        setCanEdit(Boolean(payload?.canEdit));
        setApiKeyConfigured(Boolean(settings?.apiKeyConfigured));
        setApiKeyMasked(String(settings?.apiKeyMasked || ""));
        setStatus("");
      } catch (error) {
        if (!mounted) return;
        setStatus(error?.message || "Failed to load Magnific settings.");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadSettings();
    return () => {
      mounted = false;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setStatus("Saving Magnific API key...");
    try {
      const response = await fetch("/api/settings/freepik", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKeyInput,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(formatErrorMessage(payload, "Failed to save Magnific API key."));
      }

      const settings = payload?.settings || {};
      setApiKeyConfigured(Boolean(settings?.apiKeyConfigured));
      setApiKeyMasked(String(settings?.apiKeyMasked || ""));
      setApiKeyInput("");
      setStatus("Magnific API key saved.");
    } catch (error) {
      setStatus(error?.message || "Failed to save Magnific API key.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Magnific Credentials</CardTitle>
        <CardSubtitle>
          Manage the API key used by the Magnific (formerly Freepik) icon and background import flows.
        </CardSubtitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="settings-freepik-api-key">Magnific API key</Label>
          <Input
            id="settings-freepik-api-key"
            type="password"
            value={apiKeyInput}
            onChange={(event) => setApiKeyInput(event.target.value)}
            placeholder={apiKeyConfigured ? "Enter new key to replace existing" : "Enter Magnific API key"}
            disabled={!canEdit || loading}
          />
          {apiKeyConfigured ? (
            <p className="text-xs text-muted-foreground">Configured key: {apiKeyMasked || "********"}</p>
          ) : (
            <p className="text-xs text-muted-foreground">No API key saved yet.</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={handleSave} disabled={saving || !canEdit || loading || !apiKeyInput.trim()}>
            {saving ? "Saving..." : "Save Magnific key"}
          </Button>
          <a
            href="/freepik-import"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-foreground transition hover:bg-muted"
          >
            Open Magnific import
          </a>
        </div>

        {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}
      </CardContent>
    </Card>
  );
}

export function MobileAppSettingsCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [status, setStatus] = useState("Loading mobile app settings...");
  const [form, setForm] = useState({
    androidMinimumSupportedVersion: "",
    androidEnableCache: false,
    iosMinimumSupportedVersion: "",
    iosEnableCache: false,
  });

  useEffect(() => {
    let mounted = true;

    const loadSettings = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/settings/mobile-app", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(formatErrorMessage(payload, "Failed to load mobile app settings."));
        }

        if (!mounted) return;
        const settings = payload?.settings || {};
        setCanEdit(Boolean(payload?.canEdit));
        setForm({
          androidMinimumSupportedVersion: String(
            settings?.android?.minimumSupportedVersion ?? ""
          ),
          androidEnableCache: Boolean(settings?.android?.enableCache),
          iosMinimumSupportedVersion: String(
            settings?.ios?.minimumSupportedVersion ?? ""
          ),
          iosEnableCache: Boolean(settings?.ios?.enableCache),
        });
        setStatus("");
      } catch (error) {
        if (!mounted) return;
        setStatus(error?.message || "Failed to load mobile app settings.");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadSettings();
    return () => {
      mounted = false;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setStatus("Saving mobile app settings...");
    try {
      const response = await fetch("/api/settings/mobile-app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          android: {
            minimumSupportedVersion: form.androidMinimumSupportedVersion,
            enableCache: form.androidEnableCache,
          },
          ios: {
            minimumSupportedVersion: form.iosMinimumSupportedVersion,
            enableCache: form.iosEnableCache,
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(formatErrorMessage(payload, "Failed to save mobile app settings."));
      }

      const settings = payload?.settings || {};
      setForm({
        androidMinimumSupportedVersion: String(
          settings?.android?.minimumSupportedVersion ?? ""
        ),
        androidEnableCache: Boolean(settings?.android?.enableCache),
        iosMinimumSupportedVersion: String(
          settings?.ios?.minimumSupportedVersion ?? ""
        ),
        iosEnableCache: Boolean(settings?.ios?.enableCache),
      });
      setStatus("Mobile app settings saved.");
    } catch (error) {
      setStatus(error?.message || "Failed to save mobile app settings.");
    } finally {
      setSaving(false);
    }
  };

  const disabled = loading || !canEdit;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mobile App Settings</CardTitle>
        <CardSubtitle>
          Configure force-update thresholds and cache behavior for Android and iOS.
        </CardSubtitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4 rounded-xl border border-border p-4">
          <div className="text-sm font-medium">Android</div>
          <div className="space-y-2">
            <Label htmlFor="settings-mobile-app-android-version">
              Minimum supported version code
            </Label>
            <Input
              id="settings-mobile-app-android-version"
              type="number"
              min="0"
              value={form.androidMinimumSupportedVersion}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  androidMinimumSupportedVersion: event.target.value,
                }))
              }
              disabled={disabled}
              placeholder="Leave blank to disable force update"
            />
          </div>
          <ToggleField
            id="settings-mobile-app-android-cache"
            label="Enable cache on Android"
            checked={form.androidEnableCache}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, androidEnableCache: event.target.checked }))
            }
            disabled={disabled}
          />
        </div>

        <div className="space-y-4 rounded-xl border border-border p-4">
          <div className="text-sm font-medium">iOS</div>
          <div className="space-y-2">
            <Label htmlFor="settings-mobile-app-ios-version">
              Minimum supported version code
            </Label>
            <Input
              id="settings-mobile-app-ios-version"
              type="number"
              min="0"
              value={form.iosMinimumSupportedVersion}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  iosMinimumSupportedVersion: event.target.value,
                }))
              }
              disabled={disabled}
              placeholder="Leave blank to disable force update"
            />
          </div>
          <ToggleField
            id="settings-mobile-app-ios-cache"
            label="Enable cache on iOS"
            checked={form.iosEnableCache}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, iosEnableCache: event.target.checked }))
            }
            disabled={disabled}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={handleSave} disabled={saving || disabled}>
            {saving ? "Saving..." : "Save mobile app settings"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Force update is enabled when the app version code is lower than the configured minimum.
        </p>
        {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}
      </CardContent>
    </Card>
  );
}

export function MobileAuthSettingsCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [status, setStatus] = useState("Loading mobile auth settings...");
  const [form, setForm] = useState({
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
    accessTokenTtlMinutes: "60",
    refreshTokenSecret: "",
    refreshTokenSecretMasked: "",
    refreshTokenSecretConfigured: false,
    refreshTokenTtlDays: "30",
  });

  useEffect(() => {
    let mounted = true;

    const loadSettings = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/settings/mobile-auth", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(formatErrorMessage(payload, "Failed to load mobile auth settings."));
        }

        if (!mounted) return;
        const settings = payload?.settings || {};
        setCanEdit(Boolean(payload?.canEdit));
        setForm({
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
          accessTokenTtlMinutes: String(settings?.bearer?.accessTokenTtlMinutes || "60"),
          refreshTokenSecret: "",
          refreshTokenSecretMasked: String(settings?.bearer?.refreshTokenSecretMasked || ""),
          refreshTokenSecretConfigured: Boolean(settings?.bearer?.refreshTokenSecretConfigured),
          refreshTokenTtlDays: String(settings?.bearer?.refreshTokenTtlDays || "30"),
        });
        setStatus("");
      } catch (error) {
        if (!mounted) return;
        setStatus(error?.message || "Failed to load mobile auth settings.");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadSettings();
    return () => {
      mounted = false;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setStatus("Saving mobile auth settings...");
    try {
      const response = await fetch("/api/settings/mobile-auth", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(formatErrorMessage(payload, "Failed to save mobile auth settings."));
      }

      const settings = payload?.settings || {};
      setForm((current) => ({
        ...current,
        facebookAppSecret: "",
        facebookAppSecretMasked: String(settings?.facebook?.appSecretMasked || ""),
        facebookAppSecretConfigured: Boolean(settings?.facebook?.appSecretConfigured),
        accessTokenSecret: "",
        accessTokenSecretMasked: String(settings?.bearer?.accessTokenSecretMasked || ""),
        accessTokenSecretConfigured: Boolean(settings?.bearer?.accessTokenSecretConfigured),
        refreshTokenSecret: "",
        refreshTokenSecretMasked: String(settings?.bearer?.refreshTokenSecretMasked || ""),
        refreshTokenSecretConfigured: Boolean(settings?.bearer?.refreshTokenSecretConfigured),
      }));
      setStatus("Mobile auth settings saved.");
    } catch (error) {
      setStatus(error?.message || "Failed to save mobile auth settings.");
    } finally {
      setSaving(false);
    }
  };

  const disabled = loading || !canEdit;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mobile Auth Settings</CardTitle>
        <CardSubtitle>
          Store Google, Facebook, Apple, and bearer-token settings for the mobile login flows.
        </CardSubtitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4 rounded-xl border border-border p-4">
          <ToggleField
            id="settings-mobile-google-enabled"
            label="Enable Google mobile login"
            checked={form.googleEnabled}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, googleEnabled: event.target.checked }))
            }
            disabled={disabled}
          />
          <TextAreaField
            id="settings-mobile-google-android"
            label="Google Android client IDs"
            value={form.googleAndroidClientIds}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, googleAndroidClientIds: event.target.value }))
            }
            placeholder="One client ID per line"
            disabled={disabled}
          />
          <TextAreaField
            id="settings-mobile-google-ios"
            label="Google iOS client IDs"
            value={form.googleIosClientIds}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, googleIosClientIds: event.target.value }))
            }
            placeholder="One client ID per line"
            disabled={disabled}
          />
        </div>

        <div className="space-y-4 rounded-xl border border-border p-4">
          <ToggleField
            id="settings-mobile-facebook-enabled"
            label="Enable Facebook mobile login"
            checked={form.facebookEnabled}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, facebookEnabled: event.target.checked }))
            }
            disabled={disabled}
          />
          <div className="space-y-2">
            <Label htmlFor="settings-mobile-facebook-app-id">Facebook App ID</Label>
            <Input
              id="settings-mobile-facebook-app-id"
              value={form.facebookAppId}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, facebookAppId: event.target.value }))
              }
              disabled={disabled}
              placeholder="Enter Facebook App ID"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-mobile-facebook-secret">Facebook App Secret</Label>
            <Input
              id="settings-mobile-facebook-secret"
              type="password"
              value={form.facebookAppSecret}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, facebookAppSecret: event.target.value }))
              }
              disabled={disabled}
              placeholder={
                form.facebookAppSecretConfigured
                  ? "Enter new secret to replace existing"
                  : "Enter Facebook App Secret"
              }
            />
            {form.facebookAppSecretConfigured ? (
              <p className="text-xs text-muted-foreground">
                Configured secret: {form.facebookAppSecretMasked || "********"}
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-border p-4">
          <ToggleField
            id="settings-mobile-apple-enabled"
            label="Enable Apple login on iOS"
            checked={form.appleEnabled}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, appleEnabled: event.target.checked }))
            }
            disabled={disabled}
          />
          <TextAreaField
            id="settings-mobile-apple-bundles"
            label="Allowed Apple iOS bundle IDs"
            value={form.appleIosBundleIds}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, appleIosBundleIds: event.target.value }))
            }
            placeholder="One bundle ID per line"
            disabled={disabled}
          />
        </div>

        <div className="space-y-4 rounded-xl border border-border p-4">
          <div className="text-sm font-medium">Mobile bearer tokens</div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="settings-mobile-access-secret">Access token secret</Label>
              <Input
                id="settings-mobile-access-secret"
                type="password"
                value={form.accessTokenSecret}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, accessTokenSecret: event.target.value }))
                }
                disabled={disabled}
                placeholder={
                  form.accessTokenSecretConfigured
                    ? "Enter new secret to replace existing"
                    : "Enter access token secret"
                }
              />
              {form.accessTokenSecretConfigured ? (
                <p className="text-xs text-muted-foreground">
                  Configured secret: {form.accessTokenSecretMasked || "********"}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-mobile-access-ttl">Access token TTL (minutes)</Label>
              <Input
                id="settings-mobile-access-ttl"
                type="number"
                min="1"
                value={form.accessTokenTtlMinutes}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, accessTokenTtlMinutes: event.target.value }))
                }
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-mobile-refresh-secret">Refresh token secret</Label>
              <Input
                id="settings-mobile-refresh-secret"
                type="password"
                value={form.refreshTokenSecret}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, refreshTokenSecret: event.target.value }))
                }
                disabled={disabled}
                placeholder={
                  form.refreshTokenSecretConfigured
                    ? "Enter new secret to replace existing"
                    : "Enter refresh token secret"
                }
              />
              {form.refreshTokenSecretConfigured ? (
                <p className="text-xs text-muted-foreground">
                  Configured secret: {form.refreshTokenSecretMasked || "********"}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-mobile-refresh-ttl">Refresh token TTL (days)</Label>
              <Input
                id="settings-mobile-refresh-ttl"
                type="number"
                min="1"
                value={form.refreshTokenTtlDays}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, refreshTokenTtlDays: event.target.value }))
                }
                disabled={disabled}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={handleSave} disabled={saving || disabled}>
            {saving ? "Saving..." : "Save mobile auth settings"}
          </Button>
        </div>

        {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}
      </CardContent>
    </Card>
  );
}

function CanvaExtensionTokenCard() {
  const [tokenBusy, setTokenBusy] = useState(false);
  const [extensionToken, setExtensionToken] = useState("");
  const [tokenExpiresAt, setTokenExpiresAt] = useState("");
  const [tokenStatus, setTokenStatus] = useState("");

  const handleGenerateExtensionToken = async () => {
    setTokenBusy(true);
    setTokenStatus("Generating extension token...");
    try {
      const response = await fetch("/api/tools/canva-import/extension-token", {
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(formatErrorMessage(payload, "Failed to create token."));
      }
      setExtensionToken(String(payload?.token || ""));
      setTokenExpiresAt(String(payload?.expiresAt || ""));
      setTokenStatus("Extension token generated.");
    } catch (error) {
      setTokenStatus(error?.message || "Failed to create token.");
    } finally {
      setTokenBusy(false);
    }
  };

  const handleCopyToken = async () => {
    if (!extensionToken) return;
    try {
      await navigator.clipboard.writeText(extensionToken);
      setTokenStatus("Token copied to clipboard.");
    } catch (_error) {
      setTokenStatus("Unable to copy token automatically.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Canva Extension Token</CardTitle>
        <CardSubtitle>
          Generate the token used by the Chrome extension for Canva import.
        </CardSubtitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-border bg-muted/25 p-4 text-sm">
          <div className="font-semibold">Extension folder</div>
          <div className="mt-1 text-muted-foreground">
            <code>/Users/khalidabuhayea/AndroidStudioProjects/web-dashboard/extension/canva-importer</code>
          </div>
          <div className="mt-3 text-muted-foreground">
            Load this folder as an unpacked extension in Chrome, then paste the token below into the extension popup.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" onClick={handleGenerateExtensionToken} disabled={tokenBusy}>
            {tokenBusy ? "Generating..." : "Generate extension token"}
          </Button>
          <Button type="button" variant="ghost" onClick={handleCopyToken} disabled={!extensionToken}>
            Copy token
          </Button>
          {tokenExpiresAt ? (
            <span className="text-xs text-muted-foreground">
              Expires: {new Date(tokenExpiresAt).toLocaleString()}
            </span>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="settings-extension-token">Extension token</Label>
          <Input
            id="settings-extension-token"
            value={extensionToken}
            readOnly
            placeholder="Generate token to use in extension"
          />
        </div>

        {tokenStatus ? <div className="text-sm text-muted-foreground">{tokenStatus}</div> : null}
      </CardContent>
    </Card>
  );
}

export default function FeatureSettingsClient() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Centralize credentials and feature configuration here as we move more settings out of the individual tools.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <FreepikSettingsCard />
        <CanvaExtensionTokenCard />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>More Configuration</CardTitle>
          <CardSubtitle>
            Categories remain on their own management screen for now.
          </CardSubtitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <a
            href="/categories"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-foreground transition hover:bg-muted"
          >
            Open categories
          </a>
          <a
            href="/freepik-import"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-foreground transition hover:bg-muted"
          >
            Open Magnific import
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
