"use client";

import { useRef, useState } from "react";

import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form";
import { uploadEditorMediaFile } from "@/lib/editor/mediaUpload";

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
  const [svgImportBusy, setSvgImportBusy] = useState(false);
  const [svgImportStatus, setSvgImportStatus] = useState("");
  const [svgImportSummary, setSvgImportSummary] = useState(null);
  const svgImportInputRef = useRef(null);

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

  const handleCanvaSvgFiles = async (files) => {
    const selectedFiles = Array.from(files || []).filter((file) =>
      /\.svg$/i.test(String(file?.name || "").trim()) ||
      String(file?.type || "").toLowerCase().includes("svg")
    );
    if (selectedFiles.length === 0) {
      setSvgImportStatus("Select one or more SVG files exported from Canva.");
      return;
    }

    setSvgImportBusy(true);
    setSvgImportStatus(`Importing ${selectedFiles.length} Canva SVG asset${selectedFiles.length === 1 ? "" : "s"}...`);
    setSvgImportSummary(null);

    let imported = 0;
    let failed = 0;
    const errors = [];

    for (const file of selectedFiles) {
      try {
        const uploaded = await uploadEditorMediaFile(file, "image");
        const response = await fetch("/api/editor/elements/imported", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            source: "canva-svg",
            sourceAssetId: uploaded.path || uploaded.url,
            kind: "vector",
            title: file.name.replace(/\.[^.]+$/, "") || "Canva SVG",
            titleEn: file.name.replace(/\.[^.]+$/, "") || "Canva SVG",
            titleAr: file.name.replace(/\.[^.]+$/, "") || "Canva SVG",
            assetUrl: uploaded.url,
            thumbnailUrl: uploaded.url,
            freeSvg: true,
            sourcePayload: {
              mimeType: uploaded.mimeType || file.type || "image/svg+xml",
              fileName: uploaded.fileName || file.name || "",
              uploadedPath: uploaded.path || "",
              importedVia: "canva-svg",
            },
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(formatErrorMessage(payload, `Failed to import ${file.name}.`));
        }
        imported += 1;
      } catch (error) {
        failed += 1;
        errors.push(error?.message || `Failed to import ${file.name}.`);
      }
    }

    setSvgImportBusy(false);
    if (svgImportInputRef.current) {
      svgImportInputRef.current.value = "";
    }

    if (failed === 0) {
      setSvgImportStatus(`Imported ${imported} Canva SVG asset${imported === 1 ? "" : "s"} into the elements library.`);
    } else if (imported > 0) {
      setSvgImportStatus(`Imported ${imported} asset${imported === 1 ? "" : "s"}, with ${failed} failure${failed === 1 ? "" : "s"}.`);
    } else {
      setSvgImportStatus("Canva SVG import failed.");
    }

    setSvgImportSummary({
      imported,
      failed,
      errors,
    });
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

      <Card>
        <CardHeader>
          <CardTitle>Recolorable asset workflow</CardTitle>
          <CardSubtitle>
            For assets you want to recolor later in web and mobile, prefer Canva&apos;s native SVG export over page capture.
          </CardSubtitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. In Canva, select the element or grouped artwork you want.</p>
          <p>2. Use Canva&apos;s download selection flow and choose <code>SVG</code>.</p>
          <p>3. Import that SVG directly below, or upload it in the editor <code>Upload</code> tab.</p>
          <p>
            Native SVG uploads keep their vector palette for cleaner recoloring. Full Canva template import is still best for layout fidelity, not for converting raster artwork into editable vectors.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import Canva SVG asset</CardTitle>
          <CardSubtitle>
            Add Canva-exported SVG elements directly to the imported elements library so they are ready in the editor and mobile flows.
          </CardSubtitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={svgImportInputRef}
            type="file"
            accept=".svg,image/svg+xml"
            multiple
            className="hidden"
            onChange={(event) => {
              void handleCanvaSvgFiles(event.target.files);
            }}
          />

          <div className="rounded-xl border border-border bg-muted/25 p-4 text-sm text-muted-foreground">
            Canva tip: select the artwork, choose <code>Download selected files</code>, then set the file type to <code>SVG</code>. We&apos;ll keep that vector file intact for cleaner recoloring.
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={svgImportBusy}
              onClick={() => svgImportInputRef.current?.click()}
            >
              {svgImportBusy ? "Importing..." : "Choose Canva SVG files"}
            </Button>
            <a
              href="/editor-pro"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-foreground transition hover:bg-muted"
            >
              Open editor
            </a>
          </div>

          {svgImportStatus ? <div className="text-sm text-muted-foreground">{svgImportStatus}</div> : null}

          {svgImportSummary ? (
            <div className="rounded-xl border border-border bg-white p-4 text-sm">
              <div className="font-medium text-foreground">
                Imported: {svgImportSummary.imported} | Failed: {svgImportSummary.failed}
              </div>
              {svgImportSummary.errors?.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                  {svgImportSummary.errors.slice(0, 3).map((errorMessage) => (
                    <li key={errorMessage}>{errorMessage}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
