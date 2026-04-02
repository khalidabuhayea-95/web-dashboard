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

function FreepikSettingsCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyMasked, setApiKeyMasked] = useState("");
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [status, setStatus] = useState("Loading Freepik settings...");

  useEffect(() => {
    let mounted = true;

    const loadSettings = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/settings/freepik", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(formatErrorMessage(payload, "Failed to load Freepik settings."));
        }

        if (!mounted) return;
        const settings = payload?.settings || {};
        setCanEdit(Boolean(payload?.canEdit));
        setApiKeyConfigured(Boolean(settings?.apiKeyConfigured));
        setApiKeyMasked(String(settings?.apiKeyMasked || ""));
        setStatus("");
      } catch (error) {
        if (!mounted) return;
        setStatus(error?.message || "Failed to load Freepik settings.");
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
    setStatus("Saving Freepik API key...");
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
        throw new Error(formatErrorMessage(payload, "Failed to save Freepik API key."));
      }

      const settings = payload?.settings || {};
      setApiKeyConfigured(Boolean(settings?.apiKeyConfigured));
      setApiKeyMasked(String(settings?.apiKeyMasked || ""));
      setApiKeyInput("");
      setStatus("Freepik API key saved.");
    } catch (error) {
      setStatus(error?.message || "Failed to save Freepik API key.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Freepik Credentials</CardTitle>
        <CardSubtitle>
          Manage the API key used by the Freepik icon and background import flows.
        </CardSubtitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="settings-freepik-api-key">Freepik API key</Label>
          <Input
            id="settings-freepik-api-key"
            type="password"
            value={apiKeyInput}
            onChange={(event) => setApiKeyInput(event.target.value)}
            placeholder={apiKeyConfigured ? "Enter new key to replace existing" : "Enter Freepik API key"}
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
            {saving ? "Saving..." : "Save Freepik key"}
          </Button>
          <a
            href="/freepik-import"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-foreground transition hover:bg-muted"
          >
            Open Freepik import
          </a>
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
            Open Freepik import
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
