"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Mail, Search } from "lucide-react";
import clsx from "clsx";

import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import Modal from "@/components/ui/modal";
import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import {
  CONTACT_MESSAGE_TOPICS,
  ContactMessageStatuses,
  contactMessageTopicLabel,
} from "@/lib/support/contactMessageFields";
import { publishNavBadge } from "@/lib/dashboard/navBadges";

const PER_PAGE = 20;

// Nav item whose unread badge mirrors this inbox.
const NAV_HREF = "/contact-messages";

const STATUS_FILTERS = [
  { value: "unhandled", label: "Needs attention" },
  { value: "all", label: "All statuses" },
  { value: "new", label: "New" },
  { value: "read", label: "Read" },
  { value: "replied", label: "Replied" },
  { value: "archived", label: "Archived" },
];

const SOURCE_FILTERS = [
  { value: "all", label: "All sources" },
  { value: "web", label: "Website" },
  { value: "mobile", label: "Mobile app" },
];

const TOPIC_FILTERS = [
  { value: "all", label: "All topics" },
  ...CONTACT_MESSAGE_TOPICS.map((topic) => ({ value: topic.value, label: topic.labelEn })),
];

const STATUS_BADGE = {
  new: { variant: "warning", label: "New" },
  read: { variant: "neutral", label: "Read" },
  replied: { variant: "success", label: "Replied" },
  archived: { variant: "neutral", label: "Archived" },
};

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function sourceLabel(source) {
  return source === "mobile" ? "Mobile app" : "Website";
}

const EMPTY_SETTINGS_FORM = {
  enabled: false,
  fromName: "",
  fromEmail: "",
  replyToEmail: "",
  signature: "",
  smtp: { host: "", port: 587, secure: false, username: "", password: "" },
};

/**
 * The mailbox replies are sent from.
 *
 * SMTP rather than a provider SDK, so any mail host works. The password is
 * write-only: the server returns a mask, and leaving the field blank on save
 * keeps the stored credential.
 */
function EmailSettingsModal({ open, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_SETTINGS_FORM);
  const [passwordSet, setPasswordSet] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      setStatus("Loading settings…");
      try {
        const response = await fetch("/api/admin/contact-messages/settings", {
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "Failed to load settings.");
        if (cancelled) return;

        const settings = payload.settings || {};
        setForm({
          enabled: Boolean(settings.enabled),
          fromName: settings.fromName || "",
          fromEmail: settings.fromEmail || "",
          replyToEmail: settings.replyToEmail || "",
          signature: settings.signature || "",
          smtp: {
            host: settings.smtp?.host || "",
            port: settings.smtp?.port ?? 587,
            secure: Boolean(settings.smtp?.secure),
            username: settings.smtp?.username || "",
            // Never prefilled — the server does not hand back the secret.
            password: "",
          },
        });
        setPasswordSet(Boolean(settings.smtp?.passwordSet));
        setStatus("");
      } catch (error) {
        if (!cancelled) setStatus(error.message || "Failed to load settings.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  function update(path, value) {
    setForm((prev) =>
      path.startsWith("smtp.")
        ? { ...prev, smtp: { ...prev.smtp, [path.slice(5)]: value } }
        : { ...prev, [path]: value }
    );
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setStatus("Saving…");
    try {
      const response = await fetch("/api/admin/contact-messages/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Failed to save settings.");
      setStatus("Saved.");
      setPasswordSet(Boolean(payload.settings?.smtp?.passwordSet));
      setForm((prev) => ({ ...prev, smtp: { ...prev.smtp, password: "" } }));
      onSaved?.(payload.settings);
    } catch (error) {
      setStatus(error.message || "Failed to save settings.");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    setStatus("Connecting to the mail server…");
    try {
      const response = await fetch("/api/admin/contact-messages/settings/test", {
        method: "POST",
      });
      const payload = await response.json();
      setStatus(
        payload.ok
          ? "Connected — the mail server accepted these credentials."
          : payload.error || "Could not connect."
      );
    } catch (error) {
      setStatus(error.message || "Could not reach the mail server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} className="max-h-[85vh] overflow-y-auto">
      <form className="space-y-5" onSubmit={save}>
        <div>
          <h2 className="text-lg font-semibold">Reply email</h2>
          <p className="text-sm text-muted-foreground">
            The mailbox that answers contact messages. Customers see this address as the sender,
            and their replies come back to it.
          </p>
        </div>

        <label className="flex items-center gap-2.5 text-sm font-medium">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => update("enabled", event.target.checked)}
          />
          Send replies from the dashboard
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="fromName">Sender name</Label>
            <Input
              id="fromName"
              value={form.fromName}
              placeholder="Nayroz Support"
              onChange={(event) => update("fromName", event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fromEmail">Sender address</Label>
            <Input
              id="fromEmail"
              type="email"
              value={form.fromEmail}
              placeholder="support@nayroz.com"
              onChange={(event) => update("fromEmail", event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="replyToEmail">Reply-to address</Label>
            <Input
              id="replyToEmail"
              type="email"
              value={form.replyToEmail}
              placeholder="Optional — defaults to the sender address"
              onChange={(event) => update("replyToEmail", event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Where the customer&apos;s answer lands. Set this when replies should go to a shared
              inbox rather than the sending mailbox.
            </p>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-border p-4">
          <div className="text-sm font-semibold">Mail server (SMTP)</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="smtpHost">Host</Label>
              <Input
                id="smtpHost"
                value={form.smtp.host}
                placeholder="smtp.gmail.com"
                onChange={(event) => update("smtp.host", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtpPort">Port</Label>
              <Input
                id="smtpPort"
                type="number"
                min={1}
                max={65535}
                value={form.smtp.port}
                onChange={(event) => update("smtp.port", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtpUser">Username</Label>
              <Input
                id="smtpUser"
                value={form.smtp.username}
                autoComplete="off"
                onChange={(event) => update("smtp.username", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtpPass">Password</Label>
              <Input
                id="smtpPass"
                type="password"
                value={form.smtp.password}
                autoComplete="new-password"
                placeholder={passwordSet ? "Saved — leave blank to keep" : ""}
                onChange={(event) => update("smtp.password", event.target.value)}
              />
            </div>
          </div>
          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={form.smtp.secure}
              onChange={(event) => update("smtp.secure", event.target.checked)}
            />
            Use implicit TLS (port 465). Leave off for port 587 / STARTTLS.
          </label>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signature">Signature</Label>
          <Textarea
            id="signature"
            rows={3}
            value={form.signature}
            placeholder="Appended to the bottom of every reply."
            onChange={(event) => update("signature", event.target.value)}
          />
        </div>

        {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button type="submit" variant="primary" disabled={busy}>
            Save
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={testConnection}>
            Test connection
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// The customer's own message plus every reply we have sent, oldest first, so
// the drawer reads as the conversation the customer sees in their mailbox.
function ReplyThread({ message, replies }) {
  return (
    <ol className="space-y-3">
      <li className="rounded-xl border border-border bg-muted/40 p-3">
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs font-semibold">{message.name}</span>
          <span className="text-xs text-muted-foreground">
            {formatDateTime(message.createdAt)}
          </span>
        </div>
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.message}</div>
      </li>

      {replies.map((reply) => {
        const failed = reply.status === "failed";
        return (
          <li
            key={reply.id}
            className={clsx(
              "rounded-xl border p-3",
              failed ? "border-destructive/40 bg-destructive/5" : "border-primary/25 bg-primary/5"
            )}
          >
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs font-semibold">
                {reply.authorName}
                <span className="ml-1.5 font-normal text-muted-foreground">
                  → {reply.toEmail}
                </span>
              </span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {failed ? <Badge variant="destructive">Not delivered</Badge> : null}
                {formatDateTime(reply.createdAt)}
              </span>
            </div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{reply.body}</div>
            {failed && reply.error ? (
              <p className="mt-2 text-xs text-destructive">{reply.error}</p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function ReplyComposer({ enabled, sending, onSend, onOpenSettings }) {
  const [body, setBody] = useState("");

  if (!enabled) {
    return (
      <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        <p>
          Replying from the dashboard needs a sending mailbox. Set the sender address and SMTP
          details once, and replies will thread into the customer&apos;s existing conversation.
        </p>
        <Button variant="secondary" className="mt-3" onClick={onOpenSettings}>
          Set up reply email
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const trimmed = body.trim();
        if (!trimmed) return;
        const ok = await onSend(trimmed);
        // Keep the draft on failure so a bad SMTP config does not cost the
        // admin what they just wrote.
        if (ok) setBody("");
      }}
    >
      <Label htmlFor="replyBody">Reply</Label>
      <Textarea
        id="replyBody"
        rows={5}
        value={body}
        placeholder="Write your reply — it is emailed to the customer and added to this thread."
        onChange={(event) => setBody(event.target.value)}
        disabled={sending}
      />
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={sending || !body.trim()}>
          {sending ? "Sending…" : "Send reply"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Sends from your configured support mailbox.
        </span>
      </div>
    </form>
  );
}

function ContactMessageDetails({
  message,
  replies,
  replyEnabled,
  onClose,
  onStatusChange,
  onDelete,
  onSendReply,
  onOpenSettings,
  sendingReply,
  busy,
}) {
  const topic = contactMessageTopicLabel(message.topic, "en");
  const mailtoHref = `mailto:${encodeURIComponent(message.email)}?subject=${encodeURIComponent(
    `Re: ${topic} — Nayroz support`
  )}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">{message.name}</div>
          <a href={`mailto:${message.email}`} className="text-sm text-primary hover:underline">
            {message.email}
          </a>
        </div>
        <Badge variant={STATUS_BADGE[message.status]?.variant || "neutral"}>
          {STATUS_BADGE[message.status]?.label || message.status}
        </Badge>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Topic</dt>
          <dd>{topic}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Source</dt>
          <dd>{sourceLabel(message.source)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Received</dt>
          <dd>{formatDateTime(message.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Device</dt>
          <dd>{message.device || "—"}</dd>
        </div>
        {message.appVersion ? (
          <div>
            <dt className="text-xs text-muted-foreground">App version</dt>
            <dd>{message.appVersion}</dd>
          </div>
        ) : null}
        {message.mobileUser ? (
          <div>
            <dt className="text-xs text-muted-foreground">Linked account</dt>
            <dd>{message.mobileUser.email || message.mobileUser.name || message.mobileUser.id}</dd>
          </div>
        ) : null}
        {message.handledAt ? (
          <div>
            <dt className="text-xs text-muted-foreground">Handled</dt>
            <dd>{formatDateTime(message.handledAt)}</dd>
          </div>
        ) : null}
      </dl>

      <div>
        <div className="mb-1.5 text-xs text-muted-foreground">
          {replies.length ? `Conversation · ${replies.length + 1} messages` : "Message"}
        </div>
        <ReplyThread message={message} replies={replies} />
      </div>

      <div className="border-t border-border pt-4">
        <ReplyComposer
          enabled={replyEnabled}
          sending={sendingReply}
          onSend={onSendReply}
          onOpenSettings={onOpenSettings}
        />
      </div>

      {message.userAgent || message.ipAddress ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Diagnostics</summary>
          <div className="mt-2 space-y-1 break-all">
            {message.userAgent ? <div>User agent: {message.userAgent}</div> : null}
            {message.ipAddress ? <div>IP: {message.ipAddress}</div> : null}
          </div>
        </details>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {/* Escape hatch for anything the composer cannot do — attachments, or
            looping in a colleague from your own mailbox. */}
        <Button as="a" href={mailtoHref} variant="ghost">
          Open in mail app
        </Button>
        {message.status !== ContactMessageStatuses.REPLIED ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => onStatusChange(message, ContactMessageStatuses.REPLIED)}
          >
            Mark replied
          </Button>
        ) : null}
        {message.status !== ContactMessageStatuses.ARCHIVED ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => onStatusChange(message, ContactMessageStatuses.ARCHIVED)}
          >
            Archive
          </Button>
        ) : null}
        <Button variant="destructive" disabled={busy} onClick={() => onDelete(message)}>
          Delete
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

export default function ContactMessagesClient() {
  const [messages, setMessages] = useState([]);
  const [counts, setCounts] = useState(null);
  const [replies, setReplies] = useState([]);
  const [replyEnabled, setReplyEnabled] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [status, setStatus] = useState("Loading contact messages...");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("unhandled");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [topicFilter, setTopicFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState(null);

  const totalPages = useMemo(
    () => Math.max(Math.ceil(total / PER_PAGE), 1),
    [total]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setAppliedSearch(search.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadMessages = useCallback(async () => {
    setStatus("Loading contact messages...");
    try {
      const params = new URLSearchParams({
        page: String(page),
        perPage: String(PER_PAGE),
        status: statusFilter,
        source: sourceFilter,
        topic: topicFilter,
      });
      if (appliedSearch) params.set("search", appliedSearch);

      const response = await fetch(`/api/admin/contact-messages?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load contact messages.");
      }
      setMessages(payload.messages ?? []);
      setTotal(payload.total ?? 0);
      setCounts(payload.counts ?? null);
      // Every mutation here (open→read, replied, archived, deleted) re-runs this
      // loader, so this one call keeps the sidebar badge in step with the inbox.
      publishNavBadge(NAV_HREF, payload.counts);
      setStatus("");
    } catch (error) {
      setStatus(error.message || "Failed to load contact messages.");
    }
  }, [page, appliedSearch, statusFilter, sourceFilter, topicFilter]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const changeStatus = useCallback(
    async (message, nextStatus) => {
      if (!message?.id) return;
      setBusy(true);
      setStatus("Updating message...");
      try {
        const response = await fetch("/api/admin/contact-messages", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: message.id, status: nextStatus }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to update message.");
        }
        setDetail((current) =>
          current && current.id === message.id ? payload.message : current
        );
        setStatus("Message updated.");
        await loadMessages();
      } catch (error) {
        setStatus(error.message || "Failed to update message.");
      } finally {
        setBusy(false);
      }
    },
    [loadMessages]
  );

  // Opening a message is what marks it read — an explicit button for that
  // would be busywork.
  const openDetail = useCallback(
    async (message) => {
      setDetail(message);
      setReplies([]);
      try {
        const response = await fetch(
          `/api/admin/contact-messages/${encodeURIComponent(message.id)}`
        );
        const payload = await response.json();
        if (response.ok) {
          setDetail(payload.message);
          setReplies(payload.replies ?? []);
          setReplyEnabled(Boolean(payload.replyEnabled));
        }
      } catch {
        // Keep the list row we already have; the drawer stays usable.
      }
      if (message.status === ContactMessageStatuses.NEW) {
        await changeStatus(message, ContactMessageStatuses.READ);
      }
    },
    [changeStatus]
  );

  /**
   * Send one reply. Returns true when it was delivered, so the composer knows
   * whether it is safe to clear the draft.
   *
   * A 502 means the reply was stored but the mail server refused it — the
   * thread still updates so the failure is visible in context rather than as a
   * toast that disappears.
   */
  const sendReply = useCallback(
    async (body) => {
      if (!detail?.id) return false;
      setSendingReply(true);
      setStatus("Sending reply...");
      try {
        const response = await fetch(
          `/api/admin/contact-messages/${encodeURIComponent(detail.id)}/replies`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body }),
          }
        );
        const payload = await response.json();

        if (payload?.reply) {
          setReplies((prev) => [...prev, payload.reply]);
        }
        if (!response.ok || !payload.ok) {
          setStatus(payload?.error || "The reply could not be delivered.");
          return false;
        }

        setStatus("Reply sent.");
        // Refresh so the row shows its new "replied" status and the sidebar
        // badge follows.
        await loadMessages();
        return true;
      } catch (error) {
        setStatus(error.message || "The reply could not be sent.");
        return false;
      } finally {
        setSendingReply(false);
      }
    },
    [detail, loadMessages]
  );

  const handleDelete = useCallback(
    async (message) => {
      if (!message?.id) return;
      const confirmed = window.confirm(
        `Delete the message from ${message.name || message.email}? This removes it from the inbox permanently. This cannot be undone.`
      );
      if (!confirmed) return;

      setBusy(true);
      setStatus("Deleting message...");
      try {
        const response = await fetch(
          `/api/admin/contact-messages?id=${encodeURIComponent(message.id)}`,
          { method: "DELETE" }
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to delete message.");
        }
        setDetail(null);
        setStatus("Message deleted.");
        await loadMessages();
      } catch (error) {
        setStatus(error.message || "Failed to delete message.");
      } finally {
        setBusy(false);
      }
    },
    [loadMessages]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Contact messages</h1>
          <p className="text-sm text-muted-foreground">
            Messages sent from the website contact form and from the mobile app.
          </p>
        </div>
        <Button
          variant="secondary"
          className="inline-flex items-center gap-1.5"
          onClick={() => setSettingsOpen(true)}
        >
          <Mail size={16} strokeWidth={2.25} aria-hidden="true" />
          Email settings
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Inbox</CardTitle>
              <CardSubtitle>
                {counts
                  ? `${counts.new} new · ${counts.read} read · ${counts.replied} replied · ${counts.archived} archived`
                  : ""}
              </CardSubtitle>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Select
                aria-label="Filter by status"
                className="w-44"
                value={statusFilter}
                onChange={(event) => {
                  setPage(1);
                  setStatusFilter(event.target.value);
                }}
              >
                {STATUS_FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>
                    {filter.label}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Filter by source"
                className="w-36"
                value={sourceFilter}
                onChange={(event) => {
                  setPage(1);
                  setSourceFilter(event.target.value);
                }}
              >
                {SOURCE_FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>
                    {filter.label}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Filter by topic"
                className="w-44"
                value={topicFilter}
                onChange={(event) => {
                  setPage(1);
                  setTopicFilter(event.target.value);
                }}
              >
                {TOPIC_FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>
                    {filter.label}
                  </option>
                ))}
              </Select>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search name, email or text…"
                  className="w-64 pl-8"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {status ? <div className="mb-4 text-sm text-muted-foreground">{status}</div> : null}

          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>From</TableHeaderCell>
                <TableHeaderCell>Topic</TableHeaderCell>
                <TableHeaderCell>Message</TableHeaderCell>
                <TableHeaderCell>Source</TableHeaderCell>
                <TableHeaderCell>Received</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {messages.map((message) => (
                <TableRow key={message.id}>
                  <TableCell>
                    <div className="font-medium">{message.name}</div>
                    <div className="text-xs text-muted-foreground">{message.email}</div>
                  </TableCell>
                  <TableCell>{contactMessageTopicLabel(message.topic, "en")}</TableCell>
                  <TableCell>
                    <div className="max-w-md truncate text-muted-foreground">
                      {message.message}
                    </div>
                  </TableCell>
                  <TableCell>{sourceLabel(message.source)}</TableCell>
                  <TableCell>{formatDateTime(message.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[message.status]?.variant || "neutral"}>
                      {STATUS_BADGE[message.status]?.label || message.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => openDetail(message)}>
                        Open
                      </Button>
                      {message.status !== ContactMessageStatuses.REPLIED ? (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => changeStatus(message, ContactMessageStatuses.REPLIED)}
                        >
                          Mark replied
                        </Button>
                      ) : null}
                      <Button
                        variant="destructive"
                        disabled={busy}
                        onClick={() => handleDelete(message)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {!status && messages.length === 0 ? (
            <div className="mt-4 text-sm text-muted-foreground">
              {appliedSearch
                ? "No contact messages match this search."
                : "No contact messages yet."}
            </div>
          ) : null}

          <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
            <Button
              variant="ghost"
              type="button"
              onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
              disabled={page === 1}
            >
              Previous
            </Button>
            <div>
              Page {page} of {totalPages}
            </div>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}
              disabled={page >= totalPages}
            >
              Next
            </Button>
          </div>
        </CardContent>
      </Card>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        className="max-h-[85vh] overflow-y-auto"
      >
        {detail ? (
          <ContactMessageDetails
            message={detail}
            replies={replies}
            replyEnabled={replyEnabled}
            busy={busy}
            sendingReply={sendingReply}
            onClose={() => setDetail(null)}
            onStatusChange={changeStatus}
            onDelete={handleDelete}
            onSendReply={sendReply}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        ) : null}
      </Modal>

      <EmailSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(settings) => setReplyEnabled(Boolean(settings?.configured))}
      />
    </div>
  );
}
