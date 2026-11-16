"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  BellRing,
  Check,
  CheckCircle2,
  History,
  KeyRound,
  Plus,
  Send,
  Smartphone,
  Tag,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";

import Button from "@/components/ui/button";
import Badge from "@/components/ui/badge";
import Modal from "@/components/ui/modal";
import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/form";

function StatusBanner({ status }) {
  if (!status?.message) return null;
  const tone = status.tone || "neutral";
  const cls =
    tone === "success"
      ? "border-emerald-200/80 bg-emerald-50 text-emerald-700"
      : tone === "error"
        ? "border-rose-200/80 bg-rose-50 text-rose-700"
        : "border-[var(--ds-border)] bg-[var(--ds-surface-2)] text-muted-foreground";
  return (
    <div className={clsx("rounded-lg border px-3 py-2 text-sm", cls)} role="status">
      {status.message}
    </div>
  );
}

function SectionLabel({ children }) {
  return <div className="mb-1.5 text-xs font-medium text-muted-foreground">{children}</div>;
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg p-1" style={{ background: "var(--ds-surface-2)" }}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={clsx(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active ? "shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
            style={active ? { background: "var(--ds-surface)", color: "var(--ds-primary)" } : undefined}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    throw new Error(payload?.error || `Request failed (${res.status}).`);
  }
  return payload;
}

const AUDIENCE_OPTIONS = [
  { value: "all", label: "All users" },
  { value: "users", label: "Specific users" },
  { value: "topic", label: "Topic" },
];
const MESSAGE_TYPE_OPTIONS = [
  { value: "notification", label: "Notification" },
  { value: "data", label: "Data only (silent)" },
  { value: "both", label: "Both" },
];
const HISTORY_PAGE_SIZE = 10;

function prettyMessageType(type) {
  return type === "data" ? "Data only (silent)" : type === "both" ? "Notification + data" : "Notification";
}

function formatPlatforms(platforms) {
  if (!Array.isArray(platforms) || !platforms.length) return "";
  return platforms.map((p) => (p === "ios" ? "iOS" : "Android")).join(", ");
}

function formatAudience(campaign) {
  const ref = campaign.audienceRef || {};
  if (campaign.audienceType === "topic") return `Topic: ${ref.topic || "—"}`;
  if (campaign.audienceType === "users") {
    const count = Array.isArray(ref.userIds) ? ref.userIds.length : 0;
    return `Specific users${count ? ` (${count})` : ""}`;
  }
  return "All users";
}

function DetailRow({ label, children }) {
  return (
    <div className="flex justify-between gap-4 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

function CampaignDetails({ campaign, onClose, onDelete }) {
  const payload = campaign.payload || {};
  const platforms = formatPlatforms(campaign.audienceRef?.platforms);
  const image = payload?.notification?.image;
  const data = payload?.data && typeof payload.data === "object" ? payload.data : null;
  const statusVariant =
    campaign.failureCount && !campaign.successCount
      ? "destructive"
      : campaign.status === "skipped"
        ? "warning"
        : "success";

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Push campaign</div>
          <div className="truncate text-lg font-semibold">{campaign.title || "(no title)"}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={statusVariant}>{campaign.status}</Badge>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {campaign.body ? (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{campaign.body}</p>
      ) : null}

      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt="Notification"
          className="max-h-40 w-full rounded-md object-cover"
          style={{ border: "1px solid var(--ds-border)" }}
        />
      ) : null}

      <div className="divide-y rounded-lg border" style={{ borderColor: "var(--ds-border)" }}>
        <DetailRow label="Audience">{formatAudience(campaign)}</DetailRow>
        {platforms ? <DetailRow label="Platforms">{platforms}</DetailRow> : null}
        <DetailRow label="Message type">{prettyMessageType(campaign.messageType)}</DetailRow>
        <DetailRow label="Delivered">
          {campaign.successCount}/{campaign.targetCount}
        </DetailRow>
        <DetailRow label="Failed">
          <span style={campaign.failureCount ? { color: "var(--destructive)" } : undefined}>
            {campaign.failureCount}
          </span>
        </DetailRow>
        <DetailRow label="Sent at">{new Date(campaign.createdAt).toLocaleString()}</DetailRow>
      </div>

      {campaign.error ? (
        <div className="rounded-lg border border-rose-200/80 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <div className="font-medium">Failure reason</div>
          <div className="mt-0.5 break-words">{campaign.error}</div>
        </div>
      ) : null}

      {data && Object.keys(data).length ? (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Data payload</div>
          <ul className="divide-y rounded-lg border text-sm" style={{ borderColor: "var(--ds-border)" }}>
            {Object.entries(data).map(([key, value]) => (
              <li key={key} className="flex justify-between gap-4 px-3 py-1.5">
                <span className="font-mono text-xs">{key}</span>
                <span className="break-all text-right">{String(value)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="rounded-lg border" style={{ borderColor: "var(--ds-border)" }}>
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Raw FCM payload</summary>
        <pre className="overflow-x-auto px-3 pb-3 text-xs" style={{ color: "var(--ds-text-muted)" }}>
          {JSON.stringify(payload, null, 2)}
        </pre>
      </details>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button variant="destructive" onClick={onDelete} className="inline-flex items-center gap-1.5">
          <Trash2 size={15} />
          Delete
        </Button>
      </div>
    </div>
  );
}

export default function PushClient() {
  // --- config ---
  const [config, setConfig] = useState(null);
  const [deviceCounts, setDeviceCounts] = useState({ android: 0, ios: 0, total: 0 });
  const [serviceAccountJson, setServiceAccountJson] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [configStatus, setConfigStatus] = useState(null);

  // --- compose ---
  const [audienceType, setAudienceType] = useState("all");
  const [platforms, setPlatforms] = useState({ android: true, ios: true });
  const [topic, setTopic] = useState("");
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [recipientQuery, setRecipientQuery] = useState("");
  const [recipientResults, setRecipientResults] = useState([]);
  const [messageType, setMessageType] = useState("notification");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [image, setImage] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState(null);
  const [dataRows, setDataRows] = useState([{ key: "", value: "" }]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [android, setAndroid] = useState({
    channelId: "",
    priority: "high",
    sound: "",
    clickAction: "",
    color: "",
    ttlSeconds: "",
  });
  const [apns, setApns] = useState({ sound: "", badge: "", category: "", contentAvailable: false });
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState(null);

  // --- history ---
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [campaignsTotal, setCampaignsTotal] = useState(0);
  const [campaignPage, setCampaignPage] = useState(1);
  const [deletingId, setDeletingId] = useState(null);

  const searchTimer = useRef(null);
  const imageInputRef = useRef(null);

  const loadConfig = useCallback(async () => {
    try {
      const data = await fetchJson("/api/admin/push/config");
      setConfig(data.config);
      setDeviceCounts(
        data.deviceCounts || { android: 0, ios: 0, total: data.deviceCount || 0 },
      );
    } catch (error) {
      setConfigStatus({ tone: "error", message: error.message });
    }
  }, []);

  const loadCampaigns = useCallback(async (page = 1) => {
    try {
      const data = await fetchJson(
        `/api/admin/push/campaigns?page=${page}&pageSize=${HISTORY_PAGE_SIZE}`,
      );
      setCampaigns(data.campaigns || []);
      setCampaignsTotal(data.total || 0);
      setCampaignPage(data.page || page);
    } catch {
      /* non-fatal */
    }
  }, []);

  async function handleDeleteCampaign(id) {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this campaign from history? This only removes the log entry.")
    ) {
      return;
    }
    setDeletingId(id);
    try {
      await fetchJson(`/api/admin/push/campaigns?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setSelectedCampaign(null);
      // If we removed the last row on a page past the first, step back a page.
      const goToPage = campaigns.length <= 1 && campaignPage > 1 ? campaignPage - 1 : campaignPage;
      await loadCampaigns(goToPage);
    } catch (error) {
      if (typeof window !== "undefined") window.alert(error.message || "Failed to delete campaign.");
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    loadConfig();
    loadCampaigns();
  }, [loadConfig, loadCampaigns]);

  // Debounced recipient search for the "specific users" picker.
  useEffect(() => {
    if (audienceType !== "users") return undefined;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const data = await fetchJson(
          `/api/admin/push/recipients?query=${encodeURIComponent(recipientQuery)}`,
        );
        setRecipientResults(data.recipients || []);
      } catch {
        setRecipientResults([]);
      }
    }, 300);
    return () => searchTimer.current && clearTimeout(searchTimer.current);
  }, [recipientQuery, audienceType]);

  async function saveConfig() {
    if (!serviceAccountJson.trim()) {
      setConfigStatus({ tone: "error", message: "Paste your Firebase service account JSON." });
      return;
    }
    setSavingConfig(true);
    setConfigStatus(null);
    try {
      const data = await fetchJson("/api/admin/push/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceAccountJson }),
      });
      setConfig(data.config);
      setServiceAccountJson("");
      setConfigStatus({ tone: "success", message: "Firebase configuration saved." });
    } catch (error) {
      setConfigStatus({ tone: "error", message: error.message });
    } finally {
      setSavingConfig(false);
    }
  }

  function addUser(user) {
    setSelectedUsers((prev) => (prev.some((u) => u.id === user.id) ? prev : [...prev, user]));
  }
  function removeUser(id) {
    setSelectedUsers((prev) => prev.filter((u) => u.id !== id));
  }
  function updateDataRow(index, field, value) {
    setDataRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }
  function addDataRow() {
    setDataRows((prev) => [...prev, { key: "", value: "" }]);
  }
  function removeDataRow(index) {
    setDataRows((prev) => (prev.length <= 1 ? [{ key: "", value: "" }] : prev.filter((_, i) => i !== index)));
  }

  async function handleImageFile(event) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageError("Please choose an image file.");
      return;
    }
    setUploadingImage(true);
    setImageError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/push/upload-image", { method: "POST", body: formData });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Upload failed.");
      setImage(data.url);
    } catch (error) {
      setImageError(error.message || "Upload failed.");
    } finally {
      setUploadingImage(false);
    }
  }

  function buildMessagePayload() {
    const data = {};
    dataRows.forEach((row) => {
      const key = row.key.trim();
      if (key) data[key] = row.value;
    });
    return {
      messageType,
      notification: { title: title.trim(), body: body.trim(), image: image.trim() },
      data,
      android: {
        channelId: android.channelId.trim(),
        priority: android.priority,
        sound: android.sound.trim(),
        clickAction: android.clickAction.trim(),
        color: android.color.trim(),
        ttlSeconds: android.ttlSeconds,
      },
      apns: {
        sound: apns.sound.trim(),
        badge: apns.badge,
        category: apns.category.trim(),
        contentAvailable: apns.contentAvailable,
      },
    };
  }

  const hasContent =
    messageType === "data"
      ? dataRows.some((r) => r.key.trim())
      : Boolean(title.trim() || body.trim()) ||
        (messageType === "both" && dataRows.some((r) => r.key.trim()));

  const selectedPlatforms = Object.entries(platforms)
    .filter(([, on]) => on)
    .map(([key]) => key);

  async function send() {
    setSendStatus(null);
    if (!config?.configured) {
      setSendStatus({ tone: "error", message: "Configure Firebase before sending." });
      return;
    }
    if (!hasContent) {
      setSendStatus({
        tone: "error",
        message: "Add a title/body or at least one data field before sending.",
      });
      return;
    }
    const audience = { type: audienceType };
    if (audienceType === "topic") {
      if (!topic.trim()) {
        setSendStatus({ tone: "error", message: "Enter a topic name." });
        return;
      }
      audience.topic = topic.trim();
    } else if (audienceType === "users") {
      if (!selectedUsers.length) {
        setSendStatus({ tone: "error", message: "Select at least one recipient." });
        return;
      }
      audience.userIds = selectedUsers.map((u) => u.id);
    }

    if (audienceType !== "topic") {
      if (!selectedPlatforms.length) {
        setSendStatus({ tone: "error", message: "Select at least one platform (Android or iOS)." });
        return;
      }
      audience.platforms = selectedPlatforms;
    }

    setSending(true);
    try {
      const result = await fetchJson("/api/admin/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience, message: buildMessagePayload() }),
      });
      const reasons = (result.failures || [])
        .map((f) => `${f.code || "error"}${f.count > 1 ? ` ×${f.count}` : ""}: ${f.message}`)
        .join("; ");
      const bp = result.byPlatform;
      const platformBreakdown = bp
        ? ["android", "ios"]
            .filter((p) => bp[p] && bp[p].total > 0)
            .map((p) => `${p === "ios" ? "iOS" : "Android"} ${bp[p].sent}/${bp[p].total} ${bp[p].failed > 0 ? "✗" : "✓"}`)
            .join(" · ")
        : "";

      let summary;
      if (result.note) {
        summary = result.note;
      } else {
        summary =
          `Sent to ${result.successCount}/${result.targetCount} device(s)` +
          (result.failureCount ? `, ${result.failureCount} failed` : "") +
          (result.prunedTokens ? `, ${result.prunedTokens} stale token(s) pruned` : "");
        if (platformBreakdown) summary += ` — ${platformBreakdown}`;
        summary += ".";
        if (reasons) summary += ` Reason — ${reasons}`;
      }
      setSendStatus({ tone: result.failureCount && !result.successCount ? "error" : "success", message: summary });
      loadCampaigns();
    } catch (error) {
      setSendStatus({ tone: "error", message: error.message });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Push Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Send Firebase Cloud Messaging pushes to all users, specific users, or a topic.
        </p>
      </div>

      {/* Configuration */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-lg"
                style={{ background: "var(--ds-surface-2)", color: "var(--ds-primary)" }}
              >
                <KeyRound size={18} strokeWidth={2} />
              </span>
              <div>
                <CardTitle>Firebase configuration</CardTitle>
                <CardSubtitle>Service account used to authenticate with FCM.</CardSubtitle>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Smartphone size={14} /> {deviceCounts.total} device{deviceCounts.total === 1 ? "" : "s"}
                {deviceCounts.total
                  ? ` · ${deviceCounts.android} Android · ${deviceCounts.ios} iOS`
                  : ""}
              </span>
              <Badge variant={config?.configured ? "success" : "warning"}>
                {config?.configured ? "Configured" : "Not configured"}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {config?.configured ? (
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <SectionLabel>Project ID</SectionLabel>
                <div className="font-medium">{config.projectId || "—"}</div>
              </div>
              <div>
                <SectionLabel>Client email</SectionLabel>
                <div className="truncate font-medium">{config.clientEmail || "—"}</div>
              </div>
            </div>
          ) : null}

          <div>
            <Label htmlFor="sa-json">
              {config?.configured ? "Replace service account JSON" : "Service account JSON"}
            </Label>
            <Textarea
              id="sa-json"
              rows={6}
              value={serviceAccountJson}
              onChange={(e) => setServiceAccountJson(e.target.value)}
              placeholder='Paste the full service account file, e.g. { "type": "service_account", "project_id": "nayroz", ... }'
              className="mt-1 font-mono text-xs"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              From Firebase Console → Project settings → Service accounts → Generate new private key.
              Stored encrypted in your database; the private key is never shown again.
            </p>
          </div>

          <StatusBanner status={configStatus} />

          <div className="flex justify-end">
            <Button type="button" onClick={saveConfig} disabled={savingConfig}>
              <CheckCircle2 size={16} />
              {savingConfig ? "Saving…" : "Save configuration"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Compose */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-lg"
              style={{ background: "var(--ds-surface-2)", color: "var(--ds-primary)" }}
            >
              <BellRing size={18} strokeWidth={2} />
            </span>
            <div>
              <CardTitle>Compose notification</CardTitle>
              <CardSubtitle>Choose an audience and message type, then send.</CardSubtitle>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Audience */}
          <div>
            <SectionLabel>Audience</SectionLabel>
            <Segmented options={AUDIENCE_OPTIONS} value={audienceType} onChange={setAudienceType} />
          </div>

          {audienceType === "topic" ? (
            <div>
              <Label htmlFor="topic">Topic</Label>
              <div className="mt-1 flex items-center gap-2">
                <Tag size={16} className="text-muted-foreground" />
                <Input
                  id="topic"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. all, promos, news_en"
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Devices must subscribe to this topic in the app to receive it.
              </p>
            </div>
          ) : null}

          {audienceType === "users" ? (
            <div className="space-y-2">
              <Label htmlFor="recipient-search">Recipients</Label>
              {selectedUsers.length ? (
                <div className="flex flex-wrap gap-2">
                  {selectedUsers.map((u) => (
                    <span
                      key={u.id}
                      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                      style={{ borderColor: "var(--ds-border)", background: "var(--ds-surface-2)" }}
                    >
                      {u.email || u.name || u.id}
                      <span className="text-muted-foreground">· {u.deviceCount} dev</span>
                      <button type="button" onClick={() => removeUser(u.id)} aria-label="Remove">
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <Input
                id="recipient-search"
                value={recipientQuery}
                onChange={(e) => setRecipientQuery(e.target.value)}
                placeholder="Search mobile users by email or name…"
              />
              {recipientResults.length ? (
                <ul className="max-h-48 overflow-auto rounded-lg border" style={{ borderColor: "var(--ds-border)" }}>
                  {recipientResults.map((u) => (
                    <li
                      key={u.id}
                      className="flex items-center justify-between gap-2 border-b px-3 py-2 text-sm last:border-b-0"
                      style={{ borderColor: "var(--ds-border)" }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{u.email || u.name || u.id}</span>
                        <span className="text-xs text-muted-foreground">{u.deviceCount} device(s)</span>
                      </span>
                      <Button type="button" variant="ghost" onClick={() => addUser(u)} className="shrink-0">
                        <Plus size={14} /> Add
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {/* Platforms — applies to token-based audiences (topics reach all subscribers) */}
          {audienceType !== "topic" ? (
            <div>
              <SectionLabel>Platforms</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {[
                  { key: "android", label: "Android", count: deviceCounts.android },
                  { key: "ios", label: "iOS", count: deviceCounts.ios },
                ].map((p) => {
                  const active = platforms[p.key];
                  return (
                    <button
                      key={p.key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setPlatforms((prev) => ({ ...prev, [p.key]: !prev[p.key] }))}
                      className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors"
                      style={
                        active
                          ? {
                              borderColor: "var(--ds-primary)",
                              background: "color-mix(in oklab, var(--ds-primary) 12%, transparent)",
                              color: "var(--ds-primary)",
                            }
                          : { borderColor: "var(--ds-border)", color: "var(--ds-text-muted)" }
                      }
                    >
                      {active ? <Check size={14} /> : null}
                      {p.label}
                      <span className="text-xs opacity-70">{p.count}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Only devices on the selected platform(s) will receive this message.
              </p>
            </div>
          ) : null}

          {/* Message type */}
          <div>
            <SectionLabel>Message type</SectionLabel>
            <Segmented options={MESSAGE_TYPE_OPTIONS} value={messageType} onChange={setMessageType} />
          </div>

          {/* Notification fields */}
          {messageType !== "data" ? (
            <div className="grid gap-4">
              <div>
                <Label htmlFor="title">Title</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="body">Body</Label>
                <Textarea id="body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="image">Image (optional)</Label>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    id="image"
                    value={image}
                    onChange={(e) => setImage(e.target.value)}
                    placeholder="https://… or upload"
                    className="flex-1"
                  />
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageFile}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={uploadingImage}
                    className="inline-flex shrink-0 items-center gap-1.5"
                  >
                    <Upload size={15} />
                    {uploadingImage ? "Uploading…" : "Upload"}
                  </Button>
                </div>
                {imageError ? <p className="mt-1 text-xs text-destructive">{imageError}</p> : null}
                {image ? (
                  <div className="mt-2 flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image}
                      alt="Notification preview"
                      className="h-14 w-14 rounded-md object-cover"
                      style={{ border: "1px solid var(--ds-border)" }}
                    />
                    <button
                      type="button"
                      onClick={() => setImage("")}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <X size={13} /> Remove
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Data-only messages are delivered silently to the app (no visible notification).
            </p>
          )}

          {/* Data payload */}
          <div>
            <SectionLabel>Data payload (optional)</SectionLabel>
            <div className="space-y-2">
              {dataRows.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={row.key}
                    onChange={(e) => updateDataRow(index, "key", e.target.value)}
                    placeholder="key"
                  />
                  <Input
                    value={row.value}
                    onChange={(e) => updateDataRow(index, "value", e.target.value)}
                    placeholder="value"
                  />
                  <Button type="button" variant="ghost" onClick={() => removeDataRow(index)} aria-label="Remove field">
                    <Trash2 size={15} />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="ghost" onClick={addDataRow}>
                <Plus size={14} /> Add field
              </Button>
            </div>
          </div>

          {/* Advanced */}
          <div className="rounded-lg border" style={{ borderColor: "var(--ds-border)" }}>
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium"
            >
              Advanced (Android &amp; iOS options)
              <span className="text-muted-foreground">{advancedOpen ? "−" : "+"}</span>
            </button>
            {advancedOpen ? (
              <div className="grid gap-4 border-t px-3 py-4 sm:grid-cols-2" style={{ borderColor: "var(--ds-border)" }}>
                <div>
                  <Label>Android channel ID</Label>
                  <Input
                    value={android.channelId}
                    onChange={(e) => setAndroid({ ...android, channelId: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Android priority</Label>
                  <Select
                    value={android.priority}
                    onChange={(e) => setAndroid({ ...android, priority: e.target.value })}
                    className="mt-1"
                  >
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                  </Select>
                </div>
                <div>
                  <Label>Android sound</Label>
                  <Input
                    value={android.sound}
                    onChange={(e) => setAndroid({ ...android, sound: e.target.value })}
                    placeholder="default"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Click action</Label>
                  <Input
                    value={android.clickAction}
                    onChange={(e) => setAndroid({ ...android, clickAction: e.target.value })}
                    placeholder="OPEN_DEAL / deep link"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Android color</Label>
                  <Input
                    value={android.color}
                    onChange={(e) => setAndroid({ ...android, color: e.target.value })}
                    placeholder="#22828C"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>TTL (seconds)</Label>
                  <Input
                    type="number"
                    value={android.ttlSeconds}
                    onChange={(e) => setAndroid({ ...android, ttlSeconds: e.target.value })}
                    placeholder="3600"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>iOS sound</Label>
                  <Input
                    value={apns.sound}
                    onChange={(e) => setApns({ ...apns, sound: e.target.value })}
                    placeholder="default"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>iOS badge</Label>
                  <Input
                    type="number"
                    value={apns.badge}
                    onChange={(e) => setApns({ ...apns, badge: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>iOS category</Label>
                  <Input
                    value={apns.category}
                    onChange={(e) => setApns({ ...apns, category: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <label className="mt-6 inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={apns.contentAvailable}
                    onChange={(e) => setApns({ ...apns, contentAvailable: e.target.checked })}
                  />
                  iOS content-available (background)
                </label>
              </div>
            ) : null}
          </div>

          <StatusBanner status={sendStatus} />

          <div className="flex justify-end">
            <Button type="button" onClick={send} disabled={sending || !config?.configured}>
              <Send size={16} />
              {sending ? "Sending…" : "Send notification"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-lg"
              style={{ background: "var(--ds-surface-2)", color: "var(--ds-primary)" }}
            >
              <History size={18} strokeWidth={2} />
            </span>
            <div>
              <CardTitle>Recent sends</CardTitle>
              <CardSubtitle>
                {campaignsTotal > 0
                  ? `${campaignsTotal} push campaign${campaignsTotal === 1 ? "" : "s"} · click a row for details`
                  : "Push send history."}
              </CardSubtitle>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {campaigns.length ? (
            <>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Audience</th>
                      <th>Sent</th>
                      <th>Failed</th>
                      <th>When</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => (
                      <tr
                        key={c.id}
                        onClick={() => setSelectedCampaign(c)}
                        className="cursor-pointer"
                        title="View details"
                      >
                        <td className="max-w-[260px] truncate">{c.title}</td>
                        <td className="capitalize">
                          <span className="inline-flex items-center gap-1.5">
                            {c.audienceType === "users" ? <Users size={13} /> : c.audienceType === "topic" ? <Tag size={13} /> : <BellRing size={13} />}
                            {c.audienceType}
                          </span>
                        </td>
                        <td className="tabular-nums">{c.successCount}/{c.targetCount}</td>
                        <td className="tabular-nums" style={c.failureCount ? { color: "var(--destructive)" } : undefined}>
                          {c.failureCount}
                        </td>
                        <td className="whitespace-nowrap text-muted-foreground">
                          {new Date(c.createdAt).toLocaleString()}
                        </td>
                        <td className="text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCampaign(c.id);
                            }}
                            disabled={deletingId === c.id}
                            aria-label="Delete campaign"
                            title="Delete"
                            className="text-muted-foreground transition-colors hover:text-[color:var(--destructive)] disabled:opacity-50"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {campaignsTotal > HISTORY_PAGE_SIZE ? (
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {(campaignPage - 1) * HISTORY_PAGE_SIZE + 1}–
                    {Math.min(campaignPage * HISTORY_PAGE_SIZE, campaignsTotal)} of {campaignsTotal}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      disabled={campaignPage <= 1}
                      onClick={() => loadCampaigns(campaignPage - 1)}
                    >
                      Prev
                    </Button>
                    <span>
                      Page {campaignPage} of {Math.max(1, Math.ceil(campaignsTotal / HISTORY_PAGE_SIZE))}
                    </span>
                    <Button
                      variant="secondary"
                      disabled={campaignPage >= Math.ceil(campaignsTotal / HISTORY_PAGE_SIZE)}
                      onClick={() => loadCampaigns(campaignPage + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No notifications sent yet.</p>
          )}
        </CardContent>
      </Card>

      <Modal
        open={!!selectedCampaign}
        onClose={() => setSelectedCampaign(null)}
        className="max-h-[85vh] overflow-y-auto"
      >
        {selectedCampaign ? (
          <CampaignDetails
            campaign={selectedCampaign}
            onClose={() => setSelectedCampaign(null)}
            onDelete={() => handleDeleteCampaign(selectedCampaign.id)}
          />
        ) : null}
      </Modal>
    </div>
  );
}
