// Authoring library for the one-tap Magic Tools. Hand-written (unlike the AI
// template presets, which are generated from the source PDF) — there are few
// enough tools that the wording is worth owning line by line.
//
// Each entry also carries `sample`, which tells scripts/render-magic-tools.mjs
// how to build an honest "before" for the card:
//   ref       — file in the refs-multi folder
//   degrade   — synthetic damage applied first, because a repair tool's card is
//               meaningless if the before already looks good. The after is the
//               model's real output on that degraded input, so the pair is true.
//   generate  — prompt to create a before that no reference photo covers.
//
// The prompts belong to the prompt-driven tools only; the specialist models
// (upscalers, face restore, colorize) take numbers instead, in modelOptions.

export const PRESETS = [
  {
    slug: "enhance-photo",
    titleEn: "Enhance Photo",
    titleAr: "تحسين الصورة",
    subtitleAr: "وضوح وتفاصيل أعلى بضغطة",
    model: "nightmareai/real-esrgan",
    modelOptions: { scale: 2, face_enhance: true },
    prompt: "",
    creditCost: 4,
    sample: { ref: "woman__blazer-green.jpg", degrade: "soft" },
  },
  {
    slug: "remove-background",
    titleEn: "Remove Background",
    titleAr: "إزالة الخلفية",
    subtitleAr: "اقتطاع المنتج بخلفية شفافة",
    model: "local/background-remover",
    modelOptions: null,
    prompt: "",
    creditCost: 2,
    // The old sample was a product already on flat white, so the card showed a
    // cut-out of nothing. The input has to carry a background the tool visibly
    // removes.
    sample: {
      generate:
        "A stainless steel blender on a warm terracotta seamless studio backdrop, soft directional light casting a gentle shadow to one side, clean minimal product photography, vertical 4:5.",
    },
  },
  {
    slug: "remove-people",
    titleEn: "Remove People",
    titleAr: "إزالة الأشخاص",
    subtitleAr: "شيل الناس الزايدين من الخلفية",
    model: "google/nano-banana",
    modelOptions: null,
    prompt:
      "Remove every other person from the photo — bystanders, passers-by and anyone in the background — while keeping the main subject in the foreground exactly identical: the same face, pose, clothing, scale and position. Rebuild the scene where they stood so surfaces, lines, shadows and textures continue seamlessly and the place looks like it was always empty. Change nothing else about the image.",
    creditCost: 8,
    sample: {
      generate:
        "A candid street photograph: one man in a light shirt standing in the foreground on a wide city promenade, several other pedestrians walking at various distances behind him, warm late-afternoon light, realistic depth of field, vertical 4:5.",
    },
  },
  {
    slug: "clean-skin",
    titleEn: "Clean Skin",
    titleAr: "تنقية البشرة",
    subtitleAr: "بشرة صافية بدون ما تتغير الملامح",
    model: "google/nano-banana",
    modelOptions: null,
    prompt:
      "Retouch the skin naturally: clear blemishes, spots, redness and temporary marks. Keep the exact same face and identity — the same features, bone structure, skin tone and natural skin texture with visible pores. Do not smooth the face into plastic, do not slim or reshape anything, and keep permanent features such as moles, freckles, scars and facial hair. Leave the hair, eyes, clothing and background exactly as they are.",
    creditCost: 8,
    sample: { ref: "man__casual-grey.jpg" },
  },
  {
    slug: "enhance-light",
    titleEn: "Enhance Light",
    titleAr: "تحسين الإضاءة",
    subtitleAr: "أنقذ الصور المعتمة والمحروقة",
    model: "google/nano-banana",
    modelOptions: null,
    prompt:
      "Correct the lighting and colour of this photo: lift the shadows so detail returns, recover blown-out highlights, fix the white balance, and add natural contrast and vibrancy for a clean, well-exposed result. This is a lighting and colour correction only — every person, object, texture and detail must stay exactly identical, with nothing added, removed, moved or restyled.",
    creditCost: 8,
    // A studio portrait is the worst possible demo here: its lighting is
    // already perfect, so the card shows the tool doing nothing. The sample has
    // to be a scene whose lighting IS the problem — dim, murky, underexposed —
    // which is also the photo a real user brings to this tool.
    // Daytime on purpose: a night scene stays moody after the fix, so the card
    // barely changes. A bright room underexposed by the camera is both the
    // commonest real complaint and the most visible repair.
    sample: {
      generate:
        "A bright modern living room on a sunny afternoon: a cream sofa with colourful cushions, a wooden coffee table with a vase of fresh flowers, green plants, and tall windows with sunlight pouring in across the floor. Realistic interior photograph, vivid daylight, vertical 4:5.",
      degrade: "dark",
    },
  },
  {
    slug: "restore-photo",
    titleEn: "Restore Photos",
    titleAr: "ترميم الصور القديمة",
    subtitleAr: "خدوش وتشققات وبهتان الزمن",
    model: "flux-kontext-apps/restore-image",
    modelOptions: null,
    prompt: "",
    creditCost: 8,
    sample: { ref: "damaged__old-family.jpg" },
  },
  {
    slug: "colorize-photo",
    titleEn: "Colorize",
    titleAr: "تلوين الأبيض والأسود",
    subtitleAr: "ألوان طبيعية لصور زمان",
    model: "arielreplicate/deoldify_image",
    modelOptions: { model_name: "Stable", render_factor: 35 },
    prompt: "",
    creditCost: 6,
    sample: { ref: "woman__home.jpg", degrade: "grayscale" },
  },
  {
    slug: "unblur-photo",
    titleEn: "Unblur",
    titleAr: "توضيح الصورة",
    subtitleAr: "للصور المهزوزة والصغيرة",
    model: "nightmareai/real-esrgan",
    modelOptions: { scale: 4, face_enhance: true },
    prompt: "",
    creditCost: 4,
    sample: { ref: "man__studio-warm.jpg", degrade: "blur" },
  },
  {
    slug: "face-enhance",
    titleEn: "Face Enhance",
    titleAr: "تحسين الوجه",
    subtitleAr: "ملامح أوضح بدون تغيير الشكل",
    model: "tencentarc/gfpgan",
    modelOptions: { scale: 2 },
    prompt: "",
    creditCost: 4,
    sample: { ref: "woman__blazer-navy.jpg", degrade: "soft" },
  },
  {
    slug: "studio-background",
    titleEn: "Studio Background",
    titleAr: "خلفية استوديو",
    subtitleAr: "خلفية نظيفة واحترافية",
    model: "google/nano-banana",
    modelOptions: null,
    prompt:
      "Replace only the background with a clean professional studio backdrop in a soft neutral tone, with gentle gradient lighting and a natural contact shadow. Keep the main subject perfectly identical — the same face, pose, clothing, colours and edges — cut in cleanly with accurate hair and edge detail, and relight it just enough to sit believably on the new backdrop.",
    creditCost: 8,
    sample: { ref: "man__dramatic.jpg" },
  },
  {
    slug: "remove-text",
    titleEn: "Remove Text",
    titleAr: "إزالة الكتابة",
    subtitleAr: "نظّف الصورة من أي كلام مطبوع",
    model: "google/nano-banana",
    modelOptions: null,
    prompt:
      "Remove the text and lettering that appears in this photo — captions, printed words, price stickers and signage — and rebuild what sits behind them so surfaces, patterns, gradients, shadows and textures continue seamlessly, as if the text was never there. Keep every other element of the image exactly identical.",
    creditCost: 8,
    sample: { ref: "product__arabic-parfum.jpg" },
  },
];

export function getPreset(slug) {
  return PRESETS.find((preset) => preset.slug === slug) || null;
}
