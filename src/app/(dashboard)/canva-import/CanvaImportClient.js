"use client";

import { useState } from "react";

import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form";

function formatErrorMessage(payload, fallback = "Import failed.") {
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
  if (details.length > 0) return details.join(" ");
  return fallback;
}

export default function CanvaImportClient() {
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Canva Import</h1>
        <p className="text-sm text-muted-foreground">
          Use the Chrome extension to import Canva designs into your templates.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Chrome extension import</CardTitle>
          <CardSubtitle>
            Use your logged-in Canva browser session and push directly into dashboard templates.
          </CardSubtitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-border bg-muted/25 p-4 text-sm">
            <div className="mb-2 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
              High-fidelity mode (Recommended)
            </div>
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
            <Label htmlFor="extension-token">Extension token</Label>
            <Input id="extension-token" value={extensionToken} readOnly placeholder="Generate token to use in extension" />
          </div>

          {tokenStatus ? <div className="text-sm text-muted-foreground">{tokenStatus}</div> : null}
        </CardContent>
      </Card>
    </div>
  );
}
