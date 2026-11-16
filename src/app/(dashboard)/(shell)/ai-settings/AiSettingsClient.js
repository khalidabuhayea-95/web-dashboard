"use client";

// Everything about how the AI features behave and what they cost.
//
// ★Split out of Mobile settings on 2026-09-03. That page had grown to seven
// sections, five of them AI, and the two halves answer different questions:
// "which build of the app is allowed to run and how do people sign in" versus
// "which model does each tool call and what does a run cost". They also get
// edited by different people at different times. Both still write to the same
// /api/settings/mobile-app blob — this is a UI split, not a data split.

import { Coins, Expand, Eraser, ImagePlus, Maximize2, Wand2 } from "lucide-react";

import { Input, Label } from "@/components/ui/form";
import {
  FieldBlock,
  ModelSelect,
  SectionFooter,
  SettingsSection,
  dollarInputToMicros,
  formatUsd,
  microsToDollarInput,
  statusBadge,
  useSettingsForm,
} from "@/components/settings/settingsKit";
import {
  DEFAULT_MODEL_PRICES_MICROS,
  MEDIA_CREDIT_FEATURE_LABELS,
  SUPPORTED_MEDIA_CREDIT_FEATURES,
  normalizeMediaCreditSettings,
} from "@/lib/media/credits/config.js";

const MODEL_PRICE_IDS = Object.keys(DEFAULT_MODEL_PRICES_MICROS);

function mapObjectRemovalSettings(settings) {
  return {
    objectRemovalModel: String(settings?.objectRemovalModel || "allenhooo/lama"),
  };
}

function mapAiExpandSettings(settings) {
  return {
    aiExpandModel: String(settings?.aiExpandModel || "bria/expand-image"),
  };
}

function mapImageUpscaleSettings(settings) {
  return {
    upscaleModel: String(settings?.upscaleModel || "prunaai/p-image-upscale"),
  };
}

function mapImageEditSettings(settings) {
  return {
    editImageModel: String(settings?.editImageModel || "google/nano-banana"),
  };
}

function mapImageGenerationSettings(settings) {
  return {
    imageGenerationModel: String(
      settings?.imageGenerationModel || "black-forest-labs/flux-schnell"
    ),
  };
}

function mapCreditSettings(settings) {
  // Normalizing here means a settings blob saved before this section existed still
  // renders with every field populated instead of blank inputs.
  const credits = normalizeMediaCreditSettings(settings?.mediaCredits);

  const costs = {};
  for (const feature of SUPPORTED_MEDIA_CREDIT_FEATURES) {
    costs[feature] = String(credits.costs[feature]);
  }

  const modelPrices = {};
  for (const modelId of MODEL_PRICE_IDS) {
    modelPrices[modelId] = microsToDollarInput(credits.modelPrices[modelId]);
  }

  return {
    monthlyAllowance: String(credits.monthlyAllowance),
    costs,
    modelPrices,
  };
}

const OBJECT_REMOVAL_INITIAL_FORM = { objectRemovalModel: "allenhooo/lama" };
const AI_EXPAND_INITIAL_FORM = { aiExpandModel: "bria/expand-image" };
const IMAGE_UPSCALE_INITIAL_FORM = { upscaleModel: "prunaai/p-image-upscale" };
const IMAGE_EDIT_INITIAL_FORM = { editImageModel: "google/nano-banana" };
const IMAGE_GENERATION_INITIAL_FORM = {
  imageGenerationModel: "black-forest-labs/flux-schnell",
};
const CREDITS_INITIAL_FORM = mapCreditSettings({});

const OBJECT_REMOVAL_MODEL_OPTIONS = [
  { value: "selfhost/lama", label: "LaMa (خادمنا)", detail: "Self-hosted · recommended" },
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
  {
    value: "selfhost/real-esrgan",
    label: "Real-ESRGAN (خادمنا)",
    detail: "Self-hosted · same weights, no per-image cost",
  },
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
  {
    value: "black-forest-labs/flux-kontext-pro",
    label: "black-forest-labs/flux-kontext-pro",
    detail: "~$0.04 · consistency",
  },
];

// Text-to-image. Arabic prompts are translated server-side before the call, so a
// model with an English-only text encoder is still usable — and far cheaper.
const IMAGE_GENERATION_MODEL_OPTIONS = [
  {
    value: "black-forest-labs/flux-schnell",
    label: "black-forest-labs/flux-schnell",
    detail: "~$0.003 · default · 4–6s",
  },
  { value: "google/imagen-4-fast", label: "google/imagen-4-fast", detail: "~$0.02 · sharper" },
  {
    value: "google/nano-banana-2-lite",
    label: "google/nano-banana-2-lite",
    detail: "~$0.034 · reads Arabic natively",
  },
];

function AiSettingsClient() {
  const objectRemovalSettings = useSettingsForm({
    endpoint: "/api/settings/mobile-app",
    initialForm: OBJECT_REMOVAL_INITIAL_FORM,
    loadingMessage: "Loading object removal settings...",
    savingMessage: "Saving object removal settings...",
    successMessage: "Object removal settings saved.",
    mapSettings: mapObjectRemovalSettings,
    buildPayload: (form) => ({ objectRemovalModel: form.objectRemovalModel }),
  });

  const aiExpandSettings = useSettingsForm({
    endpoint: "/api/settings/mobile-app",
    initialForm: AI_EXPAND_INITIAL_FORM,
    loadingMessage: "Loading AI Expand settings...",
    savingMessage: "Saving AI Expand settings...",
    successMessage: "AI Expand settings saved.",
    mapSettings: mapAiExpandSettings,
    buildPayload: (form) => ({ aiExpandModel: form.aiExpandModel }),
  });

  const imageUpscaleSettings = useSettingsForm({
    endpoint: "/api/settings/mobile-app",
    initialForm: IMAGE_UPSCALE_INITIAL_FORM,
    loadingMessage: "Loading image upscale settings...",
    savingMessage: "Saving image upscale settings...",
    successMessage: "Image upscale settings saved.",
    mapSettings: mapImageUpscaleSettings,
    buildPayload: (form) => ({ upscaleModel: form.upscaleModel }),
  });

  const imageEditSettings = useSettingsForm({
    endpoint: "/api/settings/mobile-app",
    initialForm: IMAGE_EDIT_INITIAL_FORM,
    loadingMessage: "Loading edit image settings...",
    savingMessage: "Saving edit image settings...",
    successMessage: "Edit image settings saved.",
    mapSettings: mapImageEditSettings,
    buildPayload: (form) => ({ editImageModel: form.editImageModel }),
  });

  const imageGenerationSettings = useSettingsForm({
    endpoint: "/api/settings/mobile-app",
    initialForm: IMAGE_GENERATION_INITIAL_FORM,
    loadingMessage: "Loading image generation settings...",
    savingMessage: "Saving image generation settings...",
    successMessage: "Image generation settings saved.",
    mapSettings: mapImageGenerationSettings,
    buildPayload: (form) => ({ imageGenerationModel: form.imageGenerationModel }),
  });

  const creditSettings = useSettingsForm({
    endpoint: "/api/settings/mobile-app",
    initialForm: CREDITS_INITIAL_FORM,
    loadingMessage: "Loading AI credit settings...",
    savingMessage: "Saving AI credit settings...",
    successMessage: "AI credit settings saved.",
    mapSettings: mapCreditSettings,
    buildPayload: (form) => ({
      mediaCredits: {
        monthlyAllowance: Number(form.monthlyAllowance),
        costs: Object.fromEntries(
          SUPPORTED_MEDIA_CREDIT_FEATURES.map((feature) => [
            feature,
            Number(form.costs[feature]),
          ])
        ),
        modelPrices: Object.fromEntries(
          MODEL_PRICE_IDS.map((modelId) => [
            modelId,
            dollarInputToMicros(form.modelPrices[modelId]),
          ])
        ),
      },
    }),
  });

  // Each feature's currently-selected model, so credit costs can be shown in real
  // dollars. Reads the live form values, so switching a model above updates the
  // figures immediately — before anything is saved.
  const creditFeatureModels = {
    "edit-image": imageEditSettings.form.editImageModel,
    "ai-expand": aiExpandSettings.form.aiExpandModel,
    upscale: imageUpscaleSettings.form.upscaleModel,
    "object-removal": objectRemovalSettings.form.objectRemovalModel,
    "image-generation": imageGenerationSettings.form.imageGenerationModel,
  };

  const creditAllowanceValue = Number(creditSettings.form.monthlyAllowance) || 0;

  const creditCostBreakdown = SUPPORTED_MEDIA_CREDIT_FEATURES.map((feature) => {
    const cost = Number(creditSettings.form.costs[feature]) || 0;
    const modelId = creditFeatureModels[feature] || "";
    const pricePerRun = Number(creditSettings.form.modelPrices[modelId] || 0);
    const runs = cost > 0 ? Math.floor(creditAllowanceValue / cost) : null;

    return {
      feature,
      cost,
      modelId,
      pricePerRun,
      runs,
      // What one user could spend if they used the whole allowance on this action.
      monthlyMax: runs === null ? 0 : runs * pricePerRun,
    };
  });

  // Rank by actual dollars, not by dollars-per-credit: `runs` is floored, so an
  // action costing 8 credits out of a 100-credit allowance strands 4 credits and
  // really spends less than its ratio implies. Comparing the ratio picks the wrong
  // action and under-reports the ceiling.
  const costliestCreditUse = creditCostBreakdown.reduce(
    (worst, row) => (row.monthlyMax > (worst?.monthlyMax ?? -1) ? row : worst),
    null
  );
  const maxMonthlyCostPerUser = costliestCreditUse?.monthlyMax ?? 0;

  const modelSections = [
    {
      key: "object-removal",
      title: "Object removal",
      icon: Eraser,
      controls: objectRemovalSettings,
      fieldId: "object-removal-model",
      label: "Model",
      value: objectRemovalSettings.form.objectRemovalModel,
      onChange: (event) =>
        objectRemovalSettings.setForm((prev) => ({
          ...prev,
          objectRemovalModel: event.target.value,
        })),
      options: OBJECT_REMOVAL_MODEL_OPTIONS,
    },
    {
      key: "ai-expand",
      title: "AI Expand",
      icon: Expand,
      controls: aiExpandSettings,
      fieldId: "ai-expand-model",
      label: "Model",
      value: aiExpandSettings.form.aiExpandModel,
      onChange: (event) =>
        aiExpandSettings.setForm((prev) => ({ ...prev, aiExpandModel: event.target.value })),
      options: AI_EXPAND_MODEL_OPTIONS,
    },
    {
      key: "upscale",
      title: "Image upscaling",
      icon: Maximize2,
      controls: imageUpscaleSettings,
      fieldId: "image-upscale-model",
      label: "Model",
      value: imageUpscaleSettings.form.upscaleModel,
      onChange: (event) =>
        imageUpscaleSettings.setForm((prev) => ({ ...prev, upscaleModel: event.target.value })),
      options: IMAGE_UPSCALE_MODEL_OPTIONS,
    },
    {
      key: "edit-image",
      title: "Edit by prompt",
      icon: Wand2,
      controls: imageEditSettings,
      fieldId: "image-edit-model",
      label: "Model",
      value: imageEditSettings.form.editImageModel,
      onChange: (event) =>
        imageEditSettings.setForm((prev) => ({ ...prev, editImageModel: event.target.value })),
      options: IMAGE_EDIT_MODEL_OPTIONS,
    },
    {
      key: "image-generation",
      title: "Image generation",
      icon: ImagePlus,
      controls: imageGenerationSettings,
      fieldId: "image-generation-model",
      label: "Model",
      value: imageGenerationSettings.form.imageGenerationModel,
      onChange: (event) =>
        imageGenerationSettings.setForm((prev) => ({
          ...prev,
          imageGenerationModel: event.target.value,
        })),
      options: IMAGE_GENERATION_MODEL_OPTIONS,
    },
  ];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 pb-10 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-[color:var(--ds-text)]">
          AI settings
        </h1>
        <p className="mt-1 text-sm text-[color:var(--ds-text-muted)]">
          Which model each AI tool calls, and what a run costs the user.
        </p>
      </div>

      {modelSections.map((section) => (
        <SettingsSection
          key={section.key}
          title={section.title}
          icon={section.icon}
          badge={statusBadge(section.controls)}
          footer={
            <SectionFooter
              status={section.controls.status}
              updatedAt={section.controls.updatedAt}
              canEdit={section.controls.canEdit}
              saving={section.controls.saving}
              hasChanges={section.controls.hasChanges}
              onSave={section.controls.save}
              saveLabel="Save"
            />
          }
        >
          <ModelSelect
            id={section.fieldId}
            label={section.label}
            value={section.value}
            onChange={section.onChange}
            disabled={section.controls.disabled}
            options={section.options}
          />
        </SettingsSection>
      ))}

      <SettingsSection
        title="AI credits"
        icon={Coins}
        badge={statusBadge(creditSettings)}
        footer={
          <SectionFooter
            status={creditSettings.status}
            updatedAt={creditSettings.updatedAt}
            canEdit={creditSettings.canEdit}
            saving={creditSettings.saving}
            hasChanges={creditSettings.hasChanges}
            onSave={creditSettings.save}
            saveLabel="Save"
          />
        }
      >
        <FieldBlock
          id="mobile-credit-allowance"
          label="Monthly credits per user"
          hint="Every user gets this many credits at the start of each month (UTC). Each AI action below deducts its credit cost from this one balance. A specific user can be given a different allowance from the Users page."
        >
          <Input
            id="mobile-credit-allowance"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={creditSettings.form.monthlyAllowance}
            onChange={(event) =>
              creditSettings.setForm((current) => ({
                ...current,
                monthlyAllowance: event.target.value,
              }))
            }
            disabled={creditSettings.disabled}
          />
        </FieldBlock>

        <div className="rounded-xl border border-border/70 bg-[color:var(--ds-primary)]/5 px-4 py-3">
          <p className="text-sm font-medium text-[color:var(--ds-text)]">
            Maximum{" "}
            <span className="text-[color:var(--ds-primary)]">
              {formatUsd(maxMonthlyCostPerUser)}
            </span>{" "}
            per user each month
          </p>
          {costliestCreditUse ? (
            <p className="mt-1 text-xs text-[color:var(--ds-text-muted)]">
              Reached when a user spends all {creditAllowanceValue} credits on{" "}
              {MEDIA_CREDIT_FEATURE_LABELS[costliestCreditUse.feature]}:{" "}
              {costliestCreditUse.runs} runs × {formatUsd(costliestCreditUse.pricePerRun)} on{" "}
              <span className="font-mono">{costliestCreditUse.modelId}</span>. Every other mix
              of actions costs less.
            </p>
          ) : null}
          <p className="mt-1 text-xs text-[color:var(--ds-text-muted)]">
            At that ceiling: 100 users = {formatUsd(maxMonthlyCostPerUser * 100)} · 1,000 users
            = {formatUsd(maxMonthlyCostPerUser * 1000)} per month.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <Label>Credit cost per action</Label>
            <p className="field-help">
              What each AI action costs the user. Expensive actions should cost more so one
              user cannot drain the provider budget on the priciest model.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {creditCostBreakdown.map(({ feature, modelId, pricePerRun, runs, monthlyMax }) => (
              <div key={feature} className="space-y-1.5">
                <Label htmlFor={`mobile-credit-cost-${feature}`}>
                  {MEDIA_CREDIT_FEATURE_LABELS[feature]}
                </Label>
                <Input
                  id={`mobile-credit-cost-${feature}`}
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={creditSettings.form.costs[feature]}
                  onChange={(event) =>
                    creditSettings.setForm((current) => ({
                      ...current,
                      costs: { ...current.costs, [feature]: event.target.value },
                    }))
                  }
                  disabled={creditSettings.disabled}
                />
                {runs === null ? (
                  <p className="field-help">Free — this action never costs credits.</p>
                ) : (
                  <p className="field-help">
                    {runs} runs per user each month ·{" "}
                    <span className="font-medium text-[color:var(--ds-text)]">
                      {formatUsd(pricePerRun)}
                    </span>{" "}
                    per run ={" "}
                    <span className="font-medium text-[color:var(--ds-text)]">
                      {formatUsd(monthlyMax)}
                    </span>{" "}
                    per user
                    {modelId ? (
                      <>
                        {" "}
                        <span className="font-mono text-[color:var(--ds-text-muted)]">
                          {modelId}
                        </span>
                      </>
                    ) : null}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <Label>Provider price per run (USD)</Label>
            <p className="field-help">
              What each model actually costs us per run. These feed the spend report only —
              they never block a request. Update them when the provider changes pricing.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {MODEL_PRICE_IDS.map((modelId) => (
              <div key={modelId} className="space-y-1.5">
                <Label htmlFor={`mobile-model-price-${modelId}`} className="font-mono text-xs">
                  {modelId}
                </Label>
                <Input
                  id={`mobile-model-price-${modelId}`}
                  type="number"
                  min="0"
                  step="0.0001"
                  inputMode="decimal"
                  value={creditSettings.form.modelPrices[modelId]}
                  onChange={(event) =>
                    creditSettings.setForm((current) => ({
                      ...current,
                      modelPrices: { ...current.modelPrices, [modelId]: event.target.value },
                    }))
                  }
                  disabled={creditSettings.disabled}
                />
              </div>
            ))}
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}

export default AiSettingsClient;
