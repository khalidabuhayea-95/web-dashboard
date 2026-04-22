"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Copy,
  Download,
  KeyRound,
  Loader2,
  Puzzle,
  Sparkles,
  Wrench,
} from "lucide-react";

import Button from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";

const FREEPIK_INITIAL_FORM = {
  apiKey: "",
};

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
  if (!value) return "Not saved yet";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Recently updated";
  return parsed.toLocaleString();
}

function formatExpiresAt(value) {
  if (!value) return "Not generated yet";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown expiry";
  return parsed.toLocaleString();
}

function mapFreepikSettings(settings) {
  return {
    apiKey: "",
    apiKeyConfigured: Boolean(settings?.apiKeyConfigured),
    apiKeyMasked: String(settings?.apiKeyMasked || ""),
  };
}

function useFreepikSettingsForm() {
  const [form, setForm] = useState(FREEPIK_INITIAL_FORM);
  const [baselineForm, setBaselineForm] = useState(FREEPIK_INITIAL_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [updatedAt, setUpdatedAt] = useState("");
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeyMasked, setApiKeyMasked] = useState("");
  const [status, setStatus] = useState(createStatus("neutral", "Loading Freepik credentials..."));

  useEffect(() => {
    let mounted = true;

    const loadSettings = async () => {
      setLoading(true);
      setStatus(createStatus("neutral", "Loading Freepik credentials..."));

      try {
        const response = await fetch("/api/settings/freepik", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(formatErrorMessage(payload, "Failed to load Freepik settings."));
        }

        if (!mounted) return;
        const nextSettings = mapFreepikSettings(payload?.settings || {});
        setForm({ apiKey: "" });
        setBaselineForm({ apiKey: "" });
        setApiKeyConfigured(nextSettings.apiKeyConfigured);
        setApiKeyMasked(nextSettings.apiKeyMasked);
        setCanEdit(Boolean(payload?.canEdit));
        setUpdatedAt(String(payload?.settings?.updatedAt || ""));
        setStatus(createStatus("neutral", ""));
      } catch (error) {
        if (!mounted) return;
        setStatus(
          createStatus(
            "error",
            error?.message || "We could not load the Freepik configuration."
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
  }, []);

  const hasChanges = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(baselineForm),
    [baselineForm, form]
  );

  const save = async () => {
    setSaving(true);
    setStatus(createStatus("neutral", "Saving Freepik credentials..."));

    try {
      const response = await fetch("/api/settings/freepik", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: form.apiKey,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(formatErrorMessage(payload, "Failed to save Freepik settings."));
      }

      const nextSettings = mapFreepikSettings(payload?.settings || {});
      setForm({ apiKey: "" });
      setBaselineForm({ apiKey: "" });
      setApiKeyConfigured(nextSettings.apiKeyConfigured);
      setApiKeyMasked(nextSettings.apiKeyMasked);
      setUpdatedAt(String(payload?.settings?.updatedAt || ""));
      setStatus(createStatus("success", "Freepik credentials saved."));
    } catch (error) {
      setStatus(
        createStatus(
          "error",
          error?.message || "We could not save the Freepik configuration."
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
    updatedAt,
    apiKeyConfigured,
    apiKeyMasked,
    status,
    hasChanges,
    disabled: loading || !canEdit,
    save,
  };
}

function useCanvaExtensionToken() {
  const [tokenBusy, setTokenBusy] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [extensionToken, setExtensionToken] = useState("");
  const [tokenExpiresAt, setTokenExpiresAt] = useState("");
  const [status, setStatus] = useState(createStatus("neutral", ""));

  const generate = async () => {
    setTokenBusy(true);
    setStatus(createStatus("neutral", "Generating extension token..."));

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
      setStatus(createStatus("success", "Extension token generated."));
    } catch (error) {
      setStatus(createStatus("error", error?.message || "Failed to create token."));
    } finally {
      setTokenBusy(false);
    }
  };

  const copy = async () => {
    if (!extensionToken) return;
    setCopyBusy(true);
    try {
      await navigator.clipboard.writeText(extensionToken);
      setStatus(createStatus("success", "Token copied to clipboard."));
    } catch (_error) {
      setStatus(createStatus("error", "Unable to copy token automatically."));
    } finally {
      setCopyBusy(false);
    }
  };

  return {
    tokenBusy,
    copyBusy,
    extensionToken,
    tokenExpiresAt,
    status,
    generate,
    copy,
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
          : "border-border/70 bg-white/85 text-[color:var(--ds-text-muted)]";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.08em] ${toneClasses}`}
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
        : "border-slate-200/80 bg-white/80 text-[color:var(--ds-text-muted)]";

  return (
    <div
      aria-live="polite"
      className={`rounded-2xl border px-4 py-3 text-sm font-medium shadow-sm ${toneClasses}`}
    >
      {status.message}
    </div>
  );
}

function SurfaceCard({ title, description, icon: Icon, children, className = "" }) {
  return (
    <div
      className={`rounded-[24px] border border-border/70 bg-white/85 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur ${className}`}
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,rgba(59,91,219,0.12),rgba(59,91,219,0.05))] text-[color:var(--ds-primary)]">
          <Icon className="h-4.5 w-4.5" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-base font-semibold tracking-[-0.02em] text-[color:var(--ds-text)]">
            {title}
          </h3>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-[color:var(--ds-text-muted)]">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}

function SettingsSection({ eyebrow, title, description, icon: Icon, badges, children, footer }) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-white/65 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(249,250,253,0.95))] shadow-[0_18px_48px_rgba(15,23,42,0.07)]">
      <div className="border-b border-border/70 px-5 py-5 sm:px-7 sm:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,rgba(59,91,219,0.14),rgba(59,91,219,0.06))] text-[color:var(--ds-primary)] shadow-sm">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[color:var(--ds-text-muted)]">
                  {eyebrow}
                </p>
                <h2 className="mt-1 text-[1.35rem] font-semibold tracking-[-0.03em] text-[color:var(--ds-text)]">
                  {title}
                </h2>
              </div>
            </div>
            <p className="mt-4 max-w-3xl text-[0.96rem] leading-7 text-[color:var(--ds-text-muted)]">
              {description}
            </p>
          </div>

          {badges?.length ? (
            <div className="flex flex-wrap gap-2 lg:justify-end">
              {badges.map((badge) => (
                <StatusPill key={`${badge.tone}-${badge.label}`} tone={badge.tone}>
                  {badge.label}
                </StatusPill>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="space-y-5 px-5 py-5 sm:px-7 sm:py-7">{children}</div>
      {footer ? <div className="border-t border-border/70 px-5 py-5 sm:px-7">{footer}</div> : null}
    </section>
  );
}

function FieldBlock({ id, label, description, hint, children }) {
  return (
    <div className="space-y-2.5">
      <Label htmlFor={id}>{label}</Label>
      {description ? (
        <p className="text-sm leading-6 text-[color:var(--ds-text-muted)]">{description}</p>
      ) : null}
      {children}
      {hint ? <p className="field-help">{hint}</p> : null}
    </div>
  );
}

function CredentialState({ configured, maskedValue, emptyCopy }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/80 bg-slate-50/80 px-4 py-3 text-sm text-[color:var(--ds-text-muted)]">
      {configured ? (
        <span>
          Stored value: <span className="font-medium text-[color:var(--ds-text)]">{maskedValue || "********"}</span>
        </span>
      ) : (
        <span>{emptyCopy}</span>
      )}
    </div>
  );
}

function SectionFooter({ status, updatedAt, canEdit, saving, hasChanges, onSave, saveLabel, saveDisabled }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="text-sm font-medium text-[color:var(--ds-text)]">
            Last synced {formatSavedAt(updatedAt)}
          </div>
          <p className="text-sm text-[color:var(--ds-text-muted)]">
            {canEdit
              ? hasChanges
                ? "You have unsaved edits in this section."
                : "Everything in this section is up to date."
              : "You can review this area, but only admins can change it."}
          </p>
        </div>

        <Button
          type="button"
          onClick={onSave}
          disabled={saveDisabled || !canEdit || saving}
          className="w-full sm:w-auto"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {saving ? "Saving..." : saveLabel}
        </Button>
      </div>
      <StatusBanner status={status} />
    </div>
  );
}

function SettingsWorkspaceClient() {
  const freepik = useFreepikSettingsForm();
  const canva = useCanvaExtensionToken();
  const pageCanEdit = freepik.canEdit;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-10 sm:px-6 lg:px-8">
      <div className="space-y-6">
        <SettingsSection
          eyebrow="Credentials"
          title="Third-party access and import tooling"
          description="Keep operational credentials and import tooling in one maintainable workspace. This page is optimized for quick admin tasks, clearer auditability, and less guesswork when rotating keys or provisioning extension access."
          icon={KeyRound}
          badges={[
            { tone: freepik.hasChanges ? "warning" : "success", label: freepik.hasChanges ? "Unsaved edits" : "Synced" },
            { tone: pageCanEdit ? "neutral" : "warning", label: pageCanEdit ? "Admin controls" : "Read only" },
          ]}
          footer={
            <SectionFooter
              status={freepik.status}
              updatedAt={freepik.updatedAt}
              canEdit={freepik.canEdit}
              saving={freepik.saving}
              hasChanges={freepik.hasChanges}
              onSave={freepik.save}
              saveLabel="Save Freepik credentials"
              saveDisabled={!freepik.form.apiKey.trim()}
            />
          }
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <SurfaceCard
              icon={Download}
              title="Freepik API key"
              description="Manage the API key used by the Freepik icon and background import flows."
            >
              <div className="space-y-4">
                <FieldBlock
                  id="settings-freepik-api-key"
                  label="Freepik API key"
                  description="Paste a replacement key only when rotating credentials."
                  hint="The current key stays active until you save a new one."
                >
                  <Input
                    id="settings-freepik-api-key"
                    type="password"
                    value={freepik.form.apiKey}
                    onChange={(event) =>
                      freepik.setForm((current) => ({
                        ...current,
                        apiKey: event.target.value,
                      }))
                    }
                    disabled={freepik.disabled}
                    placeholder={
                      freepik.apiKeyConfigured
                        ? "Enter new key to replace existing"
                        : "Enter Freepik API key"
                    }
                  />
                </FieldBlock>

                <CredentialState
                  configured={freepik.apiKeyConfigured}
                  maskedValue={freepik.apiKeyMasked}
                  emptyCopy="No Freepik API key is stored yet."
                />
              </div>
            </SurfaceCard>

            <div className="rounded-[24px] border border-[color:var(--ds-primary)]/12 bg-[linear-gradient(135deg,rgba(59,91,219,0.08),rgba(255,255,255,0.95))] px-5 py-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-white/80 text-[color:var(--ds-primary)] shadow-sm">
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-[color:var(--ds-text)]">
                    Operational notes
                  </div>
                  <ul className="space-y-2 text-sm leading-6 text-[color:var(--ds-text-muted)]">
                    <li>Only admins can update stored credentials from this page.</li>
                    <li>Existing keys stay masked after save to reduce accidental exposure.</li>
                    <li>Use the import workspace below to validate new Freepik access after rotation.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          eyebrow="Tooling"
          title="Canva extension access and operational shortcuts"
          description="Provision extension access, copy time-limited tokens, and jump quickly into related workflows without hunting through the dashboard."
          icon={Puzzle}
          badges={[
            { tone: canva.extensionToken ? "success" : "neutral", label: canva.extensionToken ? "Token ready" : "No token generated" },
            { tone: "neutral", label: "Fast operator workflow" },
          ]}
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <SurfaceCard
              icon={Puzzle}
              title="Canva extension token"
              description="Generate the token used by the Chrome extension for Canva import."
            >
              <div className="space-y-4">
                <div className="rounded-[22px] border border-border/70 bg-slate-50/80 px-4 py-4 text-sm leading-6 text-[color:var(--ds-text-muted)]">
                  Load the extension from
                  {" "}
                  <code className="rounded bg-white px-1.5 py-0.5 text-[color:var(--ds-text)]">
                    extension/canva-importer
                  </code>
                  {" "}
                  and paste the generated token into the extension popup.
                </div>

                <FieldBlock
                  id="settings-extension-token"
                  label="Current extension token"
                  description="Tokens are short-lived and should be regenerated when needed."
                  hint={`Expires ${formatExpiresAt(canva.tokenExpiresAt)}`}
                >
                  <Input
                    id="settings-extension-token"
                    value={canva.extensionToken}
                    readOnly
                    placeholder="Generate a token to use in the extension"
                  />
                </FieldBlock>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={canva.generate}
                    disabled={canva.tokenBusy}
                    className="w-full sm:w-auto"
                  >
                    {canva.tokenBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                    {canva.tokenBusy ? "Generating..." : "Generate token"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={canva.copy}
                    disabled={!canva.extensionToken || canva.copyBusy}
                    className="w-full sm:w-auto"
                  >
                    {canva.copyBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                    {canva.copyBusy ? "Copying..." : "Copy token"}
                  </Button>
                </div>

                <StatusBanner status={canva.status} />
              </div>
            </SurfaceCard>

            <SurfaceCard
              icon={Wrench}
              title="Related workflows"
              description="Jump directly into the tools usually used after settings updates."
            >
              <div className="space-y-3">
                <Button as="a" href="/freepik-import" className="w-full justify-between">
                  Open Freepik import
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  as="a"
                  href="/categories"
                  variant="secondary"
                  className="w-full justify-between"
                >
                  Open categories
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </SurfaceCard>
          </div>
        </SettingsSection>
      </div>
    </div>
  );
}

export default SettingsWorkspaceClient;
