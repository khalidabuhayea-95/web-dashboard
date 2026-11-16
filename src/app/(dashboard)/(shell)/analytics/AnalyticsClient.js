"use client";

import { useEffect, useState } from "react";

import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form";

import AnalyticsOverview from "./AnalyticsOverview";
import AiUsageSection from "./AiUsageSection";

const CONFIG_ENDPOINT = "/api/admin/analytics/config";
// The GA4 property Firebase already created for the mobile apps (account
// 340113207). Adding the website as a third data stream on this property keeps
// web + iOS + Android in one report; authuser=1 matches the Google account that
// owns the Firebase project.
const GA_PROPERTY_ID = "531571754";
const GA_STREAMS_URL = `https://analytics.google.com/analytics/web/?authuser=1#/a340113207p${GA_PROPERTY_ID}/admin/streams/table`;
const GA_HOME = "https://analytics.google.com/analytics/web/?authuser=1";
const LOOKER_HOME = "https://lookerstudio.google.com/";

/**
 * The report is opened in a tab rather than framed — an iframe resolves against
 * the browser's *default* Google account, which locked out anyone whose default
 * differs from the report owner. Stored URLs may still be in the /embed/ form
 * from when this page framed them, so strip that back to the viewable URL.
 */
function toReportLink(url) {
  return String(url || "").replace("/embed/reporting/", "/reporting/");
}

function formatErrorMessage(payload, fallback = "Request failed.") {
  const details = [];
  if (payload?.error && typeof payload.error === "string") {
    details.push(payload.error);
  }
  if (payload?.details && typeof payload.details === "string" && payload.details !== payload.error) {
    details.push(payload.details);
  }
  return details.length > 0 ? details.join(" ") : fallback;
}

function ExternalLink({ href, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-foreground transition hover:bg-muted"
    >
      {children}
    </a>
  );
}

function SetupInstructions() {
  return (
    <ol className="list-decimal space-y-2 ps-5 text-sm text-muted-foreground">
      <li>
        Add a <strong>Web</strong> data stream for nayroz.com to the existing{" "}
        <a href={GA_STREAMS_URL} target="_blank" rel="noreferrer noopener" className="underline">
          &ldquo;nayroz&rdquo; GA4 property
        </a>{" "}
        (ID {GA_PROPERTY_ID}) — the one Firebase already feeds from the iOS and Android apps. Copy
        the measurement ID it hands back (<code>G-XXXXXXXXXX</code>).
      </li>
      <li>
        Paste that ID into <code>public/analytics.js</code> so the marketing pages start reporting —
        the report stays empty until the tag is live.
      </li>
      <li>
        In{" "}
        <a href={LOOKER_HOME} target="_blank" rel="noreferrer noopener" className="underline">
          Looker Studio
        </a>
        , create a report from the &ldquo;GA4&rdquo; connector and pick property {GA_PROPERTY_ID}.
        It covers web and both apps, so filter by stream where you want web-only numbers.
      </li>
      <li>
        Copy the report&rsquo;s URL and save it below. It powers the &ldquo;Open full report&rdquo;
        button — the tiles on this page come straight from the GA4 API and work without it.
      </li>
    </ol>
  );
}

export default function AnalyticsClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [config, setConfig] = useState({ configured: false, reportUrl: "", measurementId: "" });
  const [form, setForm] = useState({ reportUrl: "", measurementId: "" });
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState("Loading analytics settings...");

  useEffect(() => {
    let mounted = true;

    const loadSettings = async () => {
      setLoading(true);
      try {
        const response = await fetch(CONFIG_ENDPOINT, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(formatErrorMessage(payload, "Failed to load analytics settings."));
        }

        if (!mounted) return;
        const next = payload?.config || {};
        setCanEdit(Boolean(payload?.canEdit));
        setConfig({
          configured: Boolean(next.configured),
          reportUrl: String(next.reportUrl || ""),
          measurementId: String(next.measurementId || ""),
        });
        setForm({
          reportUrl: String(next.reportUrl || ""),
          measurementId: String(next.measurementId || ""),
        });
        // Nothing to show yet — open the form straight away.
        setShowSettings(!next.configured);
        setStatus("");
      } catch (error) {
        if (!mounted) return;
        setStatus(error?.message || "Failed to load analytics settings.");
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
    setStatus("Saving analytics settings...");
    try {
      const response = await fetch(CONFIG_ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportUrl: form.reportUrl,
          measurementId: form.measurementId,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(formatErrorMessage(payload, "Failed to save analytics settings."));
      }

      const next = payload?.config || {};
      setConfig({
        configured: Boolean(next.configured),
        reportUrl: String(next.reportUrl || ""),
        measurementId: String(next.measurementId || ""),
      });
      setForm({
        reportUrl: String(next.reportUrl || ""),
        measurementId: String(next.measurementId || ""),
      });
      setShowSettings(!next.configured);
      setStatus(next.configured ? "Analytics settings saved." : "Report URL cleared.");
    } catch (error) {
      setStatus(error?.message || "Failed to save analytics settings.");
    } finally {
      setSaving(false);
    }
  };

  const disabled = loading || !canEdit;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Live Google Analytics for the website and both mobile apps.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {config.configured ? (
            <ExternalLink href={toReportLink(config.reportUrl)}>Open full report</ExternalLink>
          ) : null}
          <ExternalLink href={GA_HOME}>Open Google Analytics</ExternalLink>
          {config.configured ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowSettings((value) => !value)}
              disabled={loading}
            >
              {showSettings ? "Hide settings" : "Settings"}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Everything on this page reads the GA4 Data API server-side, so it needs
          no Google session from the viewer. */}
      <AnalyticsOverview />

      {/* Our own database, not GA4 — rendered separately so it still works when
          Google Analytics is not configured. */}
      <AiUsageSection />

      {showSettings ? (
        <Card>
          <CardHeader>
            <CardTitle>{config.configured ? "Report settings" : "Connect Google Analytics"}</CardTitle>
            <CardSubtitle>
              {config.configured
                ? "Point the “Open full report” button at a different Looker Studio report, or clear it to hide the button."
                : "Optional — the tiles above work without it. This only adds a link out to a fuller Looker report."}
            </CardSubtitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {config.configured ? null : <SetupInstructions />}

            <div className="space-y-2">
              <Label htmlFor="analytics-report-url">Looker Studio report URL</Label>
              <Input
                id="analytics-report-url"
                value={form.reportUrl}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, reportUrl: event.target.value }))
                }
                disabled={disabled}
                placeholder="https://lookerstudio.google.com/reporting/…"
              />
              <p className="text-xs text-muted-foreground">
                Share or embed links both work. Only lookerstudio.google.com URLs are accepted.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="analytics-measurement-id">GA4 measurement ID (optional)</Label>
              <Input
                id="analytics-measurement-id"
                value={form.measurementId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, measurementId: event.target.value }))
                }
                disabled={disabled}
                placeholder="G-XXXXXXXXXX"
              />
              <p className="text-xs text-muted-foreground">
                Recorded here for reference. The marketing pages read their ID from{" "}
                <code>public/analytics.js</code>, which is static and cannot be set from the
                dashboard.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={handleSave} disabled={saving || disabled}>
                {saving ? "Saving..." : "Save analytics settings"}
              </Button>
              {config.configured ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setForm({ reportUrl: config.reportUrl, measurementId: config.measurementId });
                    setShowSettings(false);
                  }}
                  disabled={saving}
                >
                  Cancel
                </Button>
              ) : null}
            </div>

            {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}
          </CardContent>
        </Card>
      ) : null}

      {!showSettings && status ? (
        <div className="text-sm text-muted-foreground">{status}</div>
      ) : null}
    </div>
  );
}
