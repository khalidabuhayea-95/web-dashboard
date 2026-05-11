"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Apple,
  Globe,
  KeyRound,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  ShieldEllipsis,
  Smartphone,
  Sparkles,
} from "lucide-react";

import Button from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/form";

const MOBILE_RELEASE_INITIAL_FORM = {
  androidMinimumSupportedVersion: "",
  androidEnableCache: false,
  androidRedirectLink: "",
  iosMinimumSupportedVersion: "",
  iosEnableCache: false,
  iosRedirectLink: "",
};

const MOBILE_OBJECT_REMOVAL_INITIAL_FORM = {
  objectRemovalModel: "allenhooo/lama",
};

const MOBILE_AI_EXPAND_INITIAL_FORM = {
  aiExpandModel: "bria/expand-image",
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
  accessTokenTtlMinutes: "60",
  refreshTokenSecret: "",
  refreshTokenSecretMasked: "",
  refreshTokenSecretConfigured: false,
  refreshTokenTtlDays: "30",
};

const OBJECT_REMOVAL_MODEL_OPTIONS = [
  { value: "allenhooo/lama", label: "allenhooo/lama", detail: "Fast baseline" },
  { value: "zylim0702/remove-object", label: "zylim0702/remove-object", detail: "Best value" },
  { value: "bria/eraser", label: "bria/eraser", detail: "Highest quality" },
];

const AI_EXPAND_MODEL_OPTIONS = [
  { value: "allenhooo/lama", label: "allenhooo/lama", detail: "Budget" },
  { value: "luma/reframe-image", label: "luma/reframe-image", detail: "Recommended" },
  { value: "bria/expand-image", label: "bria/expand-image", detail: "Premium" },
];

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

function mapMobileObjectRemovalSettings(settings) {
  return {
    objectRemovalModel: String(settings?.objectRemovalModel || "allenhooo/lama"),
  };
}

function mapMobileAiExpandSettings(settings) {
  return {
    aiExpandModel: String(settings?.aiExpandModel || "bria/expand-image"),
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
    accessTokenTtlMinutes: String(settings?.bearer?.accessTokenTtlMinutes || "60"),
    refreshTokenSecret: "",
    refreshTokenSecretMasked: String(settings?.bearer?.refreshTokenSecretMasked || ""),
    refreshTokenSecretConfigured: Boolean(settings?.bearer?.refreshTokenSecretConfigured),
    refreshTokenTtlDays: String(settings?.bearer?.refreshTokenTtlDays || "30"),
  };
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

function StatusPill({ tone = "neutral", children, className = "" }) {
  const toneClasses =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "error"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-white/60 bg-white/75 text-[color:var(--ds-text-muted)]";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.72rem] font-semibold tracking-[0.08em] uppercase ${toneClasses} ${className}`}
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

function SettingsSection({
  eyebrow,
  title,
  description,
  icon: Icon,
  badges,
  children,
  footer,
}) {
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

function SurfaceCard({ title, description, icon: Icon, children, className = "" }) {
  return (
    <div
      className={`rounded-[24px] border border-border/70 bg-white/80 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur ${className}`}
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

function SwitchRow({ id, label, description, checked, onChange, disabled = false }) {
  return (
    <label
      htmlFor={id}
      className={`flex items-center justify-between gap-4 rounded-[22px] border px-4 py-4 transition ${
        disabled
          ? "border-border/60 bg-slate-50/70 opacity-80"
          : "border-border/70 bg-white/75 hover:border-[color:var(--ds-primary)]/35 hover:bg-white"
      }`}
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-[color:var(--ds-text)]">{label}</div>
        {description ? (
          <p className="mt-1 text-sm leading-6 text-[color:var(--ds-text-muted)]">
            {description}
          </p>
        ) : null}
      </div>

      <span className="relative inline-flex shrink-0 items-center">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          className="peer sr-only"
        />
        <span className="h-8 w-14 rounded-full bg-slate-200 transition peer-checked:bg-[color:var(--ds-primary)] peer-disabled:opacity-60" />
        <span className="pointer-events-none absolute left-1 top-1 h-6 w-6 rounded-full bg-white shadow-sm transition peer-checked:translate-x-6" />
      </span>
    </label>
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

function SectionFooter({ status, updatedAt, canEdit, saving, hasChanges, onSave, saveLabel }) {
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
              : "You can review current configuration, but only admins can make changes."}
          </p>
        </div>

        <Button
          type="button"
          onClick={onSave}
          disabled={!canEdit || saving || !hasChanges}
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
    <SurfaceCard
      icon={isAndroid ? Smartphone : Apple}
      title={platform}
      description={
        isAndroid
          ? "Define rollout behavior for Android clients using version codes."
          : "Keep iOS rollout controls independent so release policies stay predictable."
      }
    >
      <div className="space-y-4">
        <FieldBlock
          id={versionId}
          label="Minimum supported version code"
          description="Apps below this version code will receive forceUpdate=true."
          hint="Leave blank if you do not want to enforce a minimum yet."
        >
          <Input
            id={versionId}
            type="number"
            min="0"
            inputMode="numeric"
            value={versionValue}
            onChange={onVersionChange}
            disabled={disabled}
            placeholder="Example: 205"
          />
        </FieldBlock>

        <SwitchRow
          id={toggleId}
          label="Enable cache"
          description="Controls whether this platform receives enableCache=true from the public mobile settings endpoint."
          checked={cacheEnabled}
          onChange={onCacheChange}
          disabled={disabled}
        />

        <FieldBlock
          id={redirectId}
          label="Redirect link"
          description="Returned by the public mobile settings endpoint so the app can send users to the right store or update destination."
          hint="Leave blank if the app should not receive a redirect link for this platform."
        >
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
    </SurfaceCard>
  );
}

function ModelSelect({
  id,
  label,
  description,
  value,
  onChange,
  disabled,
  options,
}) {
  return (
    <FieldBlock id={id} label={label} description={description}>
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

function SharedModelCard({
  icon,
  title,
  description,
  modelId,
  modelLabel,
  modelDescription,
  modelValue,
  onModelChange,
  disabled,
  options,
}) {
  return (
    <SurfaceCard
      icon={icon}
      title={title}
      description={description}
    >
      <ModelSelect
        id={modelId}
        label={modelLabel}
        description={modelDescription}
        value={modelValue}
        onChange={onModelChange}
        disabled={disabled}
        options={options}
      />
    </SurfaceCard>
  );
}

function ProviderCard({
  icon,
  title,
  description,
  toggleId,
  toggleLabel,
  toggleDescription,
  enabled,
  onToggle,
  disabled,
  children,
}) {
  return (
    <SurfaceCard icon={icon} title={title} description={description}>
      <div className="space-y-4">
        <SwitchRow
          id={toggleId}
          label={toggleLabel}
          description={toggleDescription}
          checked={enabled}
          onChange={onToggle}
          disabled={disabled}
        />
        <div className="space-y-4">{children}</div>
      </div>
    </SurfaceCard>
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

  const objectRemovalSettings = useSettingsForm({
    endpoint: "/api/settings/mobile-app",
    initialForm: MOBILE_OBJECT_REMOVAL_INITIAL_FORM,
    loadingMessage: "Loading object removal settings...",
    savingMessage: "Saving object removal settings...",
    successMessage: "Object removal settings saved.",
    mapSettings: mapMobileObjectRemovalSettings,
    buildPayload: (form) => ({
      objectRemovalModel: form.objectRemovalModel,
    }),
  });

  const aiExpandSettings = useSettingsForm({
    endpoint: "/api/settings/mobile-app",
    initialForm: MOBILE_AI_EXPAND_INITIAL_FORM,
    loadingMessage: "Loading AI Expand settings...",
    savingMessage: "Saving AI Expand settings...",
    successMessage: "AI Expand settings saved.",
    mapSettings: mapMobileAiExpandSettings,
    buildPayload: (form) => ({
      aiExpandModel: form.aiExpandModel,
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

  const pageCanEdit =
    releaseControls.canEdit ||
    objectRemovalSettings.canEdit ||
    aiExpandSettings.canEdit ||
    mobileAuth.canEdit;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-10 sm:px-6 lg:px-8">
      <div className="space-y-6">
        <SettingsSection
          eyebrow="Release"
          title="Rollout and cache behavior"
          description="Set platform-specific version gates and cache behavior without making the screen feel like a low-level admin form. The structure is intentionally split by platform so release managers can scan Android and iOS independently."
          icon={ShieldCheck}
          badges={[
            { tone: releaseControls.hasChanges ? "warning" : "success", label: releaseControls.hasChanges ? "Unsaved edits" : "Synced" },
            { tone: pageCanEdit ? "neutral" : "warning", label: pageCanEdit ? "Admin controls" : "Read only" },
          ]}
          footer={
            <SectionFooter
              status={releaseControls.status}
              updatedAt={releaseControls.updatedAt}
              canEdit={releaseControls.canEdit}
              saving={releaseControls.saving}
              hasChanges={releaseControls.hasChanges}
              onSave={releaseControls.save}
              saveLabel="Save release controls"
            />
          }
        >
          <div className="grid gap-4 lg:grid-cols-2">
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

          <div className="rounded-[24px] border border-[color:var(--ds-primary)]/12 bg-[linear-gradient(135deg,rgba(59,91,219,0.08),rgba(255,255,255,0.95))] px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-white/80 text-[color:var(--ds-primary)] shadow-sm">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-semibold text-[color:var(--ds-text)]">
                  Evaluation model
                </div>
                <p className="text-sm leading-6 text-[color:var(--ds-text-muted)]">
                  `forceUpdate` depends on version code only. `enableCache` and
                  `redirectLink` are platform preferences and do not vary by version code.
                </p>
              </div>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          eyebrow="Media"
          title="Object removal model routing"
          description="Choose one shared Replicate model for both Android and iOS. This keeps object-removal behavior aligned across platforms."
          icon={ShieldEllipsis}
          badges={[
            { tone: objectRemovalSettings.hasChanges ? "warning" : "success", label: objectRemovalSettings.hasChanges ? "Unsaved edits" : "Synced" },
            { tone: "neutral", label: "Shared across platforms" },
          ]}
          footer={
            <SectionFooter
              status={objectRemovalSettings.status}
              updatedAt={objectRemovalSettings.updatedAt}
              canEdit={objectRemovalSettings.canEdit}
              saving={objectRemovalSettings.saving}
              hasChanges={objectRemovalSettings.hasChanges}
              onSave={objectRemovalSettings.save}
              saveLabel="Save object removal routing"
            />
          }
        >
          <SharedModelCard
            icon={ShieldEllipsis}
            title="Object removal model"
            description="Choose one shared Replicate model for both Android and iOS so mobile behavior stays consistent."
            modelId="mobile-object-remove-model"
            modelLabel="Shared model"
            modelDescription="The server uses this same model for Android and iOS object-removal requests."
            modelValue={objectRemovalSettings.form.objectRemovalModel}
            onModelChange={(event) =>
              objectRemovalSettings.setForm((current) => ({
                ...current,
                objectRemovalModel: event.target.value,
              }))
            }
            disabled={objectRemovalSettings.disabled}
            options={OBJECT_REMOVAL_MODEL_OPTIONS}
          />

          <div className="rounded-[24px] border border-[color:var(--ds-primary)]/12 bg-[linear-gradient(135deg,rgba(59,91,219,0.08),rgba(255,255,255,0.95))] px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-white/80 text-[color:var(--ds-primary)] shadow-sm">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-semibold text-[color:var(--ds-text)]">
                  Runtime behavior
                </div>
                <p className="text-sm leading-6 text-[color:var(--ds-text-muted)]">
                  The server uses the selected model directly for all mobile object-removal requests.
                  Android and iOS now share the same model choice, which makes QA and cost tracking simpler.
                </p>
              </div>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          eyebrow="Media"
          title="AI Expand model"
          description="Choose one shared Replicate model for AI Expand. Mobile sends only the original image and target size, and the server handles canvas placement and model-specific preprocessing."
          icon={ShieldEllipsis}
          badges={[
            { tone: aiExpandSettings.hasChanges ? "warning" : "success", label: aiExpandSettings.hasChanges ? "Unsaved edits" : "Synced" },
            { tone: "neutral", label: "Shared across platforms" },
          ]}
          footer={
            <SectionFooter
              status={aiExpandSettings.status}
              updatedAt={aiExpandSettings.updatedAt}
              canEdit={aiExpandSettings.canEdit}
              saving={aiExpandSettings.saving}
              hasChanges={aiExpandSettings.hasChanges}
              onSave={aiExpandSettings.save}
              saveLabel="Save AI Expand settings"
            />
          }
        >
          <SharedModelCard
            icon={ShieldEllipsis}
            title="AI Expand model"
            description="Choose one shared AI Expand tier for both Android and iOS: Budget, Recommended, or Premium."
            modelId="mobile-ai-expand-model"
            modelLabel="Shared model"
            modelDescription="Recommended uses `luma/reframe-image`, with `allenhooo/lama` as Budget and `bria/expand-image` as Premium."
            modelValue={aiExpandSettings.form.aiExpandModel}
            onModelChange={(event) =>
              aiExpandSettings.setForm((current) => ({
                ...current,
                aiExpandModel: event.target.value,
              }))
            }
            disabled={aiExpandSettings.disabled}
            options={AI_EXPAND_MODEL_OPTIONS}
          />

          <div className="rounded-[24px] border border-[color:var(--ds-primary)]/12 bg-[linear-gradient(135deg,rgba(59,91,219,0.08),rgba(255,255,255,0.95))] px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-white/80 text-[color:var(--ds-primary)] shadow-sm">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-semibold text-[color:var(--ds-text)]">
                  Runtime behavior
                </div>
                <p className="text-sm leading-6 text-[color:var(--ds-text-muted)]">
                  Mobile does not send a mask or prompt. The server creates the expansion canvas automatically
                  from the original image and target dimensions, then calls the selected AI Expand model.
                </p>
              </div>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          eyebrow="Security"
          title="Sign-in providers and bearer sessions"
          description="Authentication settings are organized by provider first, then by token lifecycle. This reduces visual noise, keeps credential state visible, and makes risky configuration changes feel deliberate."
          icon={LockKeyhole}
          badges={[
            { tone: mobileAuth.hasChanges ? "warning" : "success", label: mobileAuth.hasChanges ? "Unsaved edits" : "Synced" },
            { tone: "neutral", label: "Secrets stay masked" },
          ]}
          footer={
            <SectionFooter
              status={mobileAuth.status}
              updatedAt={mobileAuth.updatedAt}
              canEdit={mobileAuth.canEdit}
              saving={mobileAuth.saving}
              hasChanges={mobileAuth.hasChanges}
              onSave={mobileAuth.save}
              saveLabel="Save auth settings"
            />
          }
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <ProviderCard
              icon={Globe}
              title="Google sign-in"
              description="Manage trusted mobile client IDs for both Android and iOS."
              toggleId="mobile-google-enabled"
              toggleLabel="Allow Google sign-in"
              toggleDescription="Disable this if the app should temporarily stop accepting Google tokens."
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
                description="Enter one client ID per line."
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
                  className="min-h-[112px] text-sm"
                />
              </FieldBlock>
              <FieldBlock
                id="mobile-google-ios-client-ids"
                label="iOS client IDs"
                description="Keep iOS identities separate so platform verification stays explicit."
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
                  className="min-h-[112px] text-sm"
                />
              </FieldBlock>
            </ProviderCard>

            <ProviderCard
              icon={ShieldEllipsis}
              title="Facebook sign-in"
              description="Configure the public app identifier and rotate the secret when needed."
              toggleId="mobile-facebook-enabled"
              toggleLabel="Allow Facebook sign-in"
              toggleDescription="Use this toggle to pause Facebook sign-in without deleting the underlying credentials."
              enabled={mobileAuth.form.facebookEnabled}
              onToggle={(event) =>
                mobileAuth.setForm((current) => ({
                  ...current,
                  facebookEnabled: event.target.checked,
                }))
              }
              disabled={mobileAuth.disabled}
            >
              <FieldBlock
                id="mobile-facebook-app-id"
                label="Facebook app ID"
                description="Public application identifier used when the mobile SDK returns a Facebook token."
              >
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
                label="Facebook app secret"
                description="Leave empty to keep the current secret. Paste a new value only when rotating credentials."
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
                emptyCopy="No Facebook secret is stored yet."
              />
            </ProviderCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <ProviderCard
              icon={Apple}
              title="Apple sign-in"
              description="Restrict Apple login to the bundle identifiers your mobile app actually uses."
              toggleId="mobile-apple-enabled"
              toggleLabel="Allow Apple sign-in"
              toggleDescription="Recommended for iOS only. Keep bundle IDs up to date when shipping new app flavors."
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
                description="Enter one bundle ID per line."
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
                  className="min-h-[140px] text-sm"
                />
              </FieldBlock>
            </ProviderCard>

            <SurfaceCard
              icon={KeyRound}
              title="Bearer session security"
              description="Sensitive token settings are separated from social login to make high-risk changes visually distinct."
            >
              <div className="space-y-4">
                <div className="rounded-[22px] border border-amber-200/80 bg-amber-50/90 px-4 py-4 text-sm leading-6 text-amber-800">
                  Rotate these secrets carefully. Existing sessions may stop refreshing after a
                  token secret change if the mobile client is still holding older tokens.
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldBlock
                    id="mobile-access-token-secret"
                    label="Access token secret"
                    description="Leave empty to keep the current access token signing secret."
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
                    label="Access token TTL"
                    description="Lifetime in minutes for newly issued access tokens."
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
                    description="Leave empty to keep the current refresh token signing secret."
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
                  <FieldBlock
                    id="mobile-refresh-token-ttl"
                    label="Refresh token TTL"
                    description="Lifetime in days for mobile refresh sessions."
                  >
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

                <div className="grid gap-3 sm:grid-cols-2">
                  <CredentialState
                    configured={mobileAuth.form.accessTokenSecretConfigured}
                    maskedValue={mobileAuth.form.accessTokenSecretMasked}
                    emptyCopy="No access token secret is stored yet."
                  />
                  <CredentialState
                    configured={mobileAuth.form.refreshTokenSecretConfigured}
                    maskedValue={mobileAuth.form.refreshTokenSecretMasked}
                    emptyCopy="No refresh token secret is stored yet."
                  />
                </div>
              </div>
            </SurfaceCard>
          </div>
        </SettingsSection>
      </div>
    </div>
  );
}

export default MobileSettingsClient;
