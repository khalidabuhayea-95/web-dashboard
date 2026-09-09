"use client";

// Everything the settings pages share: the load/save hook and the visual
// vocabulary (section shell, status pills, field blocks, footers).
//
// ★Extracted 2026-09-03 when the AI sections moved out of Mobile settings into
// their own tab. Two pages now render the same chrome, and a copy each would
// drift the way the two sidebar nav copies did before navItems.server.js.
// Page-specific pieces — release/auth forms, AI model catalogues — deliberately
// stay with their own page.

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import Button from "@/components/ui/button";
import { Label, Select } from "@/components/ui/form";

function microsToDollarInput(micros) {
  const value = Number(micros || 0) / 1_000_000;
  return value ? String(Number(value.toFixed(6))) : "0";
}

function dollarInputToMicros(value) {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 1_000_000);
}

function formatUsd(value) {
  const amount = Number(value) || 0;
  if (!amount) return "$0.00";
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  const exact = Number(amount.toFixed(6)); // drop float noise, keep real digits
  return Number(exact.toFixed(2)) === exact ? `$${exact.toFixed(2)}` : `$${exact}`;
}

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

function createStatus(tone, message) {
  return { tone, message };
}

function formatSavedAt(value) {
  if (!value) return "not yet";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "recently";
  return parsed.toLocaleString();
}

function useSettingsForm({
  endpoint,
  initialForm,
  loadingMessage,
  savingMessage,
  successMessage,
  mapSettings,
  buildPayload,
}) {
  const [form, setForm] = useState(initialForm);
  const [baselineForm, setBaselineForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [updatedAt, setUpdatedAt] = useState("");
  const [status, setStatus] = useState(createStatus("neutral", loadingMessage));

  useEffect(() => {
    let mounted = true;

    const loadSettings = async () => {
      setLoading(true);
      setStatus(createStatus("neutral", loadingMessage));

      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(formatErrorMessage(payload, "Failed to load settings."));
        }

        if (!mounted) return;
        const nextForm = mapSettings(payload?.settings || {});
        setForm(nextForm);
        setBaselineForm(nextForm);
        setCanEdit(Boolean(payload?.canEdit));
        setUpdatedAt(String(payload?.settings?.updatedAt || ""));
        setStatus(createStatus("neutral", ""));
      } catch (error) {
        if (!mounted) return;
        setStatus(
          createStatus(
            "error",
            error?.message || "We could not load these settings right now."
          )
        );
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadSettings();
    return () => {
      mounted = false;
    };
  }, [endpoint, loadingMessage, mapSettings]);

  const hasChanges = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(baselineForm),
    [baselineForm, form]
  );

  const save = async () => {
    setSaving(true);
    setStatus(createStatus("neutral", savingMessage));

    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(form)),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(formatErrorMessage(payload, "Failed to save settings."));
      }

      const nextForm = mapSettings(payload?.settings || {});
      setForm(nextForm);
      setBaselineForm(nextForm);
      setUpdatedAt(String(payload?.settings?.updatedAt || ""));
      setStatus(createStatus("success", successMessage));
    } catch (error) {
      setStatus(
        createStatus(
          "error",
          error?.message || "We could not save these changes right now."
        )
      );
    } finally {
      setSaving(false);
    }
  };

  return {
    form,
    setForm,
    loading,
    saving,
    canEdit,
    disabled: loading || !canEdit,
    updatedAt,
    status,
    hasChanges,
    save,
  };
}

function StatusPill({ tone = "neutral", children }) {
  const toneClasses =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "error"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-border/70 bg-white/75 text-[color:var(--ds-text-muted)]";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.68rem] font-semibold tracking-[0.06em] uppercase ${toneClasses}`}
    >
      {children}
    </span>
  );
}

function StatusBanner({ status }) {
  if (!status?.message) return null;

  const toneClasses =
    status.tone === "success"
      ? "border-emerald-200/80 bg-emerald-50 text-emerald-700"
      : status.tone === "error"
        ? "border-rose-200/80 bg-rose-50 text-rose-700"
        : "border-border/70 bg-white/80 text-[color:var(--ds-text-muted)]";

  return (
    <div
      aria-live="polite"
      className={`rounded-xl border px-3.5 py-2.5 text-sm font-medium ${toneClasses}`}
    >
      {status.message}
    </div>
  );
}

function SettingsSection({ title, icon: Icon, badge, children, footer }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between gap-4 border-b border-border/70 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[color:var(--ds-primary)]/10 text-[color:var(--ds-primary)]">
            <Icon className="h-4.5 w-4.5" aria-hidden="true" />
          </div>
          <h2 className="text-base font-semibold tracking-[-0.01em] text-[color:var(--ds-text)]">
            {title}
          </h2>
        </div>
        {badge ? <StatusPill tone={badge.tone}>{badge.label}</StatusPill> : null}
      </div>

      <div className="space-y-5 px-5 py-5">{children}</div>
      {footer ? <div className="border-t border-border/70 px-5 py-4">{footer}</div> : null}
    </section>
  );
}

function FieldBlock({ id, label, hint, children }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="field-help">{hint}</p> : null}
    </div>
  );
}

function SwitchRow({ id, label, checked, onChange, disabled = false }) {
  return (
    <label
      htmlFor={id}
      className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-3 transition ${
        disabled
          ? "border-border/60 bg-slate-50/70 opacity-80"
          : "border-border/70 bg-white hover:border-[color:var(--ds-primary)]/35"
      }`}
    >
      <span className="text-sm font-medium text-[color:var(--ds-text)]">{label}</span>
      <span className="relative inline-flex shrink-0 items-center">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          className="peer sr-only"
        />
        <span className="h-7 w-12 rounded-full bg-slate-200 transition peer-checked:bg-[color:var(--ds-primary)] peer-disabled:opacity-60" />
        <span className="pointer-events-none absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

function CredentialState({ configured, maskedValue, emptyCopy }) {
  return (
    <p className="text-xs text-[color:var(--ds-text-muted)]">
      {configured ? (
        <span>
          Stored: <span className="font-medium text-[color:var(--ds-text)]">{maskedValue || "********"}</span>
        </span>
      ) : (
        <span>{emptyCopy}</span>
      )}
    </p>
  );
}

function SectionFooter({ status, updatedAt, canEdit, saving, hasChanges, onSave, saveLabel }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[color:var(--ds-text-muted)]">
          {canEdit ? `Last saved ${formatSavedAt(updatedAt)}` : "Read only — admin access required"}
        </span>
        <Button
          type="button"
          onClick={onSave}
          disabled={!canEdit || saving || !hasChanges}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {saving ? "Saving..." : saveLabel}
        </Button>
      </div>
      <StatusBanner status={status} />
    </div>
  );
}

function ModelSelect({ id, label, value, onChange, disabled, options }) {
  return (
    <FieldBlock id={id} label={label}>
      <Select id={id} value={value} onChange={onChange} disabled={disabled}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} · {option.detail}
          </option>
        ))}
      </Select>
    </FieldBlock>
  );
}

function statusBadge(controls) {
  return {
    tone: controls.hasChanges ? "warning" : "success",
    label: controls.hasChanges ? "Unsaved" : "Synced",
  };
}

export {
  microsToDollarInput,
  dollarInputToMicros,
  formatUsd,
  formatErrorMessage,
  createStatus,
  formatSavedAt,
  useSettingsForm,
  StatusPill,
  StatusBanner,
  SettingsSection,
  FieldBlock,
  SwitchRow,
  CredentialState,
  SectionFooter,
  ModelSelect,
  statusBadge,
};
