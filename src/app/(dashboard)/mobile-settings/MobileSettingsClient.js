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
  Wand2,
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

const MOBILE_IMAGE_UPSCALE_INITIAL_FORM = {
  upscaleModel: "prunaai/p-image-upscale",
};

const MOBILE_IMAGE_EDIT_INITIAL_FORM = {
  editImageModel: "google/nano-banana",
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

const IMAGE_UPSCALE_MODEL_OPTIONS = [
  { value: "prunaai/p-image-upscale", label: "prunaai/p-image-upscale", detail: "Fast · default" },
  { value: "recraft-ai/recraft-crisp-upscale", label: "recraft-ai/recraft-crisp-upscale", detail: "Crisp" },
  { value: "cjwbw/real-esrgan", label: "cjwbw/real-esrgan", detail: "ESRGAN" },
  { value: "google/upscaler", label: "google/upscaler", detail: "Simple" },
  { value: "nightmareai/real-esrgan", label: "nightmareai/real-esrgan", detail: "ESRGAN" },
  { value: "alexgenovese/upscaler", label: "alexgenovese/upscaler", detail: "Face restore" },
];

const IMAGE_EDIT_MODEL_OPTIONS = [
  { value: "google/nano-banana", label: "google/nano-banana", detail: "~$0.039 · default" },
  { value: "qwen/qwen-image-edit-plus", label: "qwen/qwen-image-edit-plus", detail: "~$0.03 · cheapest" },
  { value: "black-forest-labs/flux-kontext-pro", label: "black-forest-labs/flux-kontext-pro", detail: "~$0.04 · consistency" },
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
  if (!value) return "not yet";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "recently";
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

function mapMobileImageUpscaleSettings(settings) {
  return {
    upscaleModel: String(settings?.upscaleModel || "prunaai/p-image-upscale"),
  };
}

function mapMobileImageEditSettings(settings) {
  return {
    editImageModel: String(settings?.editImageModel || "google/nano-banana"),
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
    <div className="rounded-xl border border-border/70 bg-white p-4">
      <div className="mb-4 flex items-center gap-2.5">
        {isAndroid ? (
          <Smartphone className="h-4 w-4 text-[color:var(--ds-primary)]" aria-hidden="true" />
        ) : (
          <Apple className="h-4 w-4 text-[color:var(--ds-primary)]" aria-hidden="true" />
        )}
        <h3 className="text-sm font-semibold text-[color:var(--ds-text)]">{platform}</h3>
      </div>
      <div className="space-y-3.5">
        <FieldBlock id={versionId} label="Minimum version code">
          <Input
            id={versionId}
            type="number"
            min="0"
            inputMode="numeric"
            value={versionValue}
            onChange={onVersionChange}
            disabled={disabled}
            placeholder="e.g. 205"
          />
        </FieldBlock>

        <SwitchRow
          id={toggleId}
          label="Enable cache"
          checked={cacheEnabled}
          onChange={onCacheChange}
          disabled={disabled}
        />

        <FieldBlock id={redirectId} label="Redirect link">
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

function ProviderCard({
  icon: Icon,
  title,
  toggleId,
  toggleLabel,
  enabled,
  onToggle,
  disabled,
  children,
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-white p-4">
      <div className="mb-4 flex items-center gap-2.5">
        <Icon className="h-4 w-4 text-[color:var(--ds-primary)]" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-[color:var(--ds-text)]">{title}</h3>
      </div>
      <div className="space-y-3.5">
        <SwitchRow
          id={toggleId}
          label={toggleLabel}
          checked={enabled}
          onChange={onToggle}
          disabled={disabled}
        />
        <div className="space-y-3.5">{children}</div>
      </div>
    </div>
  );
}

function statusBadge(controls) {
  return {
    tone: controls.hasChanges ? "warning" : "success",
    label: controls.hasChanges ? "Unsaved" : "Synced",
  };
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

  const imageUpscaleSettings = useSettingsForm({
    endpoint: "/api/settings/mobile-app",
    initialForm: MOBILE_IMAGE_UPSCALE_INITIAL_FORM,
    loadingMessage: "Loading image upscale settings...",
    savingMessage: "Saving image upscale settings...",
    successMessage: "Image upscale settings saved.",
    mapSettings: mapMobileImageUpscaleSettings,
    buildPayload: (form) => ({
      upscaleModel: form.upscaleModel,
    }),
  });

  const imageEditSettings = useSettingsForm({
    endpoint: "/api/settings/mobile-app",
    initialForm: MOBILE_IMAGE_EDIT_INITIAL_FORM,
    loadingMessage: "Loading edit image settings...",
    savingMessage: "Saving edit image settings...",
    successMessage: "Edit image settings saved.",
    mapSettings: mapMobileImageEditSettings,
    buildPayload: (form) => ({
      editImageModel: form.editImageModel,
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

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 pb-10 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-[color:var(--ds-text)]">
          Mobile settings
        </h1>
        <p className="mt-1 text-sm text-[color:var(--ds-text-muted)]">
          Release gating, AI model routing, and sign-in for the mobile app.
        </p>
      </div>

      <SettingsSection
        title="App release"
        icon={ShieldCheck}
        badge={statusBadge(releaseControls)}
        footer={
          <SectionFooter
            status={releaseControls.status}
            updatedAt={releaseControls.updatedAt}
            canEdit={releaseControls.canEdit}
            saving={releaseControls.saving}
            hasChanges={releaseControls.hasChanges}
            onSave={releaseControls.save}
            saveLabel="Save"
          />
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
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
      </SettingsSection>

      <SettingsSection
        title="Object removal"
        icon={ShieldEllipsis}
        badge={statusBadge(objectRemovalSettings)}
        footer={
          <SectionFooter
            status={objectRemovalSettings.status}
            updatedAt={objectRemovalSettings.updatedAt}
            canEdit={objectRemovalSettings.canEdit}
            saving={objectRemovalSettings.saving}
            hasChanges={objectRemovalSettings.hasChanges}
            onSave={objectRemovalSettings.save}
            saveLabel="Save"
          />
        }
      >
        <ModelSelect
          id="mobile-object-remove-model"
          label="Model"
          value={objectRemovalSettings.form.objectRemovalModel}
          onChange={(event) =>
            objectRemovalSettings.setForm((current) => ({
              ...current,
              objectRemovalModel: event.target.value,
            }))
          }
          disabled={objectRemovalSettings.disabled}
          options={OBJECT_REMOVAL_MODEL_OPTIONS}
        />
      </SettingsSection>

      <SettingsSection
        title="AI Expand"
        icon={ShieldEllipsis}
        badge={statusBadge(aiExpandSettings)}
        footer={
          <SectionFooter
            status={aiExpandSettings.status}
            updatedAt={aiExpandSettings.updatedAt}
            canEdit={aiExpandSettings.canEdit}
            saving={aiExpandSettings.saving}
            hasChanges={aiExpandSettings.hasChanges}
            onSave={aiExpandSettings.save}
            saveLabel="Save"
          />
        }
      >
        <ModelSelect
          id="mobile-ai-expand-model"
          label="Model"
          value={aiExpandSettings.form.aiExpandModel}
          onChange={(event) =>
            aiExpandSettings.setForm((current) => ({
              ...current,
              aiExpandModel: event.target.value,
            }))
          }
          disabled={aiExpandSettings.disabled}
          options={AI_EXPAND_MODEL_OPTIONS}
        />
      </SettingsSection>

      <SettingsSection
        title="Image upscaling"
        icon={ShieldEllipsis}
        badge={statusBadge(imageUpscaleSettings)}
        footer={
          <SectionFooter
            status={imageUpscaleSettings.status}
            updatedAt={imageUpscaleSettings.updatedAt}
            canEdit={imageUpscaleSettings.canEdit}
            saving={imageUpscaleSettings.saving}
            hasChanges={imageUpscaleSettings.hasChanges}
            onSave={imageUpscaleSettings.save}
            saveLabel="Save"
          />
        }
      >
        <ModelSelect
          id="mobile-image-upscale-model"
          label="Model"
          value={imageUpscaleSettings.form.upscaleModel}
          onChange={(event) =>
            imageUpscaleSettings.setForm((current) => ({
              ...current,
              upscaleModel: event.target.value,
            }))
          }
          disabled={imageUpscaleSettings.disabled}
          options={IMAGE_UPSCALE_MODEL_OPTIONS}
        />
      </SettingsSection>

      <SettingsSection
        title="Edit by prompt"
        icon={Wand2}
        badge={statusBadge(imageEditSettings)}
        footer={
          <SectionFooter
            status={imageEditSettings.status}
            updatedAt={imageEditSettings.updatedAt}
            canEdit={imageEditSettings.canEdit}
            saving={imageEditSettings.saving}
            hasChanges={imageEditSettings.hasChanges}
            onSave={imageEditSettings.save}
            saveLabel="Save"
          />
        }
      >
        <ModelSelect
          id="mobile-edit-image-model"
          label="Default model"
          value={imageEditSettings.form.editImageModel}
          onChange={(event) =>
            imageEditSettings.setForm((current) => ({
              ...current,
              editImageModel: event.target.value,
            }))
          }
          disabled={imageEditSettings.disabled}
          options={IMAGE_EDIT_MODEL_OPTIONS}
        />
      </SettingsSection>

      <SettingsSection
        title="Sign-in & sessions"
        icon={LockKeyhole}
        badge={statusBadge(mobileAuth)}
        footer={
          <SectionFooter
            status={mobileAuth.status}
            updatedAt={mobileAuth.updatedAt}
            canEdit={mobileAuth.canEdit}
            saving={mobileAuth.saving}
            hasChanges={mobileAuth.hasChanges}
            onSave={mobileAuth.save}
            saveLabel="Save"
          />
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <ProviderCard
            icon={Globe}
            title="Google"
            toggleId="mobile-google-enabled"
            toggleLabel="Allow Google sign-in"
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
              hint="One per line."
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
                className="min-h-[96px] text-sm"
              />
            </FieldBlock>
            <FieldBlock
              id="mobile-google-ios-client-ids"
              label="iOS client IDs"
              hint="One per line."
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
                className="min-h-[96px] text-sm"
              />
            </FieldBlock>
          </ProviderCard>

          <ProviderCard
            icon={ShieldEllipsis}
            title="Facebook"
            toggleId="mobile-facebook-enabled"
            toggleLabel="Allow Facebook sign-in"
            enabled={mobileAuth.form.facebookEnabled}
            onToggle={(event) =>
              mobileAuth.setForm((current) => ({
                ...current,
                facebookEnabled: event.target.checked,
              }))
            }
            disabled={mobileAuth.disabled}
          >
            <FieldBlock id="mobile-facebook-app-id" label="App ID">
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
              label="App secret"
              hint="Leave empty to keep the current secret."
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
              emptyCopy="No Facebook secret stored yet."
            />
          </ProviderCard>

          <ProviderCard
            icon={Apple}
            title="Apple"
            toggleId="mobile-apple-enabled"
            toggleLabel="Allow Apple sign-in"
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
              hint="One per line."
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
                className="min-h-[96px] text-sm"
              />
            </FieldBlock>
          </ProviderCard>

          <div className="rounded-xl border border-border/70 bg-white p-4">
            <div className="mb-4 flex items-center gap-2.5">
              <KeyRound className="h-4 w-4 text-[color:var(--ds-primary)]" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-[color:var(--ds-text)]">Bearer sessions</h3>
            </div>
            <div className="space-y-3.5">
              <p className="rounded-lg border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-xs leading-5 text-amber-800">
                Rotating a token secret can sign out clients holding older tokens.
              </p>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <FieldBlock
                  id="mobile-access-token-secret"
                  label="Access token secret"
                  hint="Leave empty to keep current."
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
                <FieldBlock id="mobile-access-token-ttl" label="Access token TTL (min)">
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
                  hint="Leave empty to keep current."
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
                <FieldBlock id="mobile-refresh-token-ttl" label="Refresh token TTL (days)">
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
              <div className="grid gap-2 sm:grid-cols-2">
                <CredentialState
                  configured={mobileAuth.form.accessTokenSecretConfigured}
                  maskedValue={mobileAuth.form.accessTokenSecretMasked}
                  emptyCopy="No access token secret stored yet."
                />
                <CredentialState
                  configured={mobileAuth.form.refreshTokenSecretConfigured}
                  maskedValue={mobileAuth.form.refreshTokenSecretMasked}
                  emptyCopy="No refresh token secret stored yet."
                />
              </div>
            </div>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}

export default MobileSettingsClient;
