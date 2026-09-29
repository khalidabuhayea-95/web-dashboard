"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  Copy,
  Crown,
  Download,
  Ellipsis,
  EyeOff,
  Film,
  LoaderCircle,
  Menu,
  PackagePlus,
  Redo2,
  Send,
  Share2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";

import DashboardNav from "@/app/(dashboard)/DashboardNav";
import { NayrozIcon } from "@/components/brand/NayrozLogo";
import {
  cx,
  FLOATING_SHADOW,
  MenuItem,
  MenuSeparator,
  ToolButton,
  ToolDivider,
  ToolPopover,
} from "@/components/editor/EditorChrome";
import { dataUrlToFile, uploadEditorMediaFile } from "@/lib/editor/mediaUpload";
import { hasAnimatedTemplateContent } from "@/lib/editor/animationTimeline";
import { PREVIEW_RENDER_FPS } from "@/lib/editor/previewRuntime";
import { buildTemplateShareUrl } from "@/lib/shareLink";
import {
  normalizeTimelinePreviewStatus,
  useEditorStore,
  type EditorDesign,
  type EditorTimelinePreview,
} from "@/store/editorStore";

interface ToolbarProps {
  /** The dashboard's sidebar items, shown in a drawer so the canvas gets the full width. */
  navItems?: unknown[];
  /** Admins only: pricing a template is a monetization decision, not authoring. */
  canManagePremium?: boolean;
}

const TEMPLATE_PREVIEW_VIDEO_MAX_DIMENSION = 240;
/** Per-page ceiling for off-screen preview capture during a save. */
const PAGE_THUMBNAIL_CAPTURE_TIMEOUT_MS = 6000;

function extensionFromMimeType(mimeType: string) {
  const value = String(mimeType || "").trim().toLowerCase();
  if (value.includes("mp4")) return "mp4";
  if (value.includes("webm")) return "webm";
  if (value.includes("quicktime")) return "mov";
  return "webm";
}

function logPreviewProgress(message: string, details?: Record<string, unknown>) {
  if (details && Object.keys(details).length > 0) {
    console.info("[template-preview]", message, details);
    return;
  }
  console.info("[template-preview]", message);
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function buildCanceledPreviewPayload(fallbackPosterDataUrl: string, templateVersion: number, durationMs: number) {
  return {
    status: "not_requested",
    url: null,
    posterUrl: String(fallbackPosterDataUrl || "").trim() || null,
    durationMs,
    version: templateVersion,
    error: null,
  };
}

/**
 * The editor's header: everything that acts on the template as a whole (name, status, history,
 * save / publish, share, export). Selection tools live in ContextToolbar, over the canvas.
 */
export default function Toolbar({ navItems = [], canManagePremium = false }: ToolbarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isPublishingTemplate, setIsPublishingTemplate] = useState(false);
  const [isUnpublishingTemplate, setIsUnpublishingTemplate] = useState(false);
  const [isTogglingPremium, setIsTogglingPremium] = useState(false);
  const [isPublishingElements, setIsPublishingElements] = useState(false);
  const [isDeletingTemplate, setIsDeletingTemplate] = useState(false);
  const [isShareLinkOpen, setIsShareLinkOpen] = useState(false);
  const [shareCopyState, setShareCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [previewToast, setPreviewToast] = useState<{
    tone: "info" | "success" | "error";
    message: string;
  } | null>(null);
  const shareWrapperRef = useRef<HTMLDivElement | null>(null);
  const shareInputRef = useRef<HTMLInputElement | null>(null);
  const shareCopyTimeoutRef = useRef<number | null>(null);
  const previewGenerationIdRef = useRef(0);
  const saveAbortControllerRef = useRef<AbortController | null>(null);
  const previewAbortControllerRef = useRef<AbortController | null>(null);
  const unloadAbortHandledRef = useRef(false);
  const activePreviewCancelRef = useRef<{
    templateId: string;
    preview: ReturnType<typeof buildCanceledPreviewPayload>;
    controller: AbortController;
  } | null>(null);

  const pages = useEditorStore((state) => state.pages);
  const activePageId = useEditorStore((state) => state.activePageId);
  const activeTemplateId = useEditorStore((state) => state.activeTemplateId);
  const activeTemplateName = useEditorStore((state) => state.activeTemplateName);
  const activeTemplateStatus = useEditorStore((state) => state.activeTemplateStatus);
  const activeTemplateCategory = useEditorStore((state) => state.activeTemplateCategory);
  const activeTemplateSubCategory = useEditorStore((state) => state.activeTemplateSubCategory);
  const activeTemplateCategories = useEditorStore((state) => state.activeTemplateCategories);
  const publishCategoryValue = useEditorStore((state) => state.publishCategoryValue);
  const activeTemplateTags = useEditorStore((state) => state.activeTemplateTags);
  const activeTemplateIsPremium = useEditorStore((state) => state.activeTemplateIsPremium);
  const publishCandidateIds = useEditorStore((state) => state.publishCandidateIds);
  const historyIndex = useEditorStore((state) => state.historyIndex);
  const historyLength = useEditorStore((state) => state.history.length);
  const stageApi = useEditorStore((state) => state.stageApi);
  const pageThumbnails = useEditorStore((state) => state.pageThumbnails);
  const designTimeline = useEditorStore((state) => state.designTimeline);
  const timelineIsPlaying = useEditorStore((state) => state.timelineIsPlaying);

  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const exportDesign = useEditorStore((state) => state.exportDesign);
  const setTemplateMeta = useEditorStore((state) => state.setTemplateMeta);
  const updateTimeline = useEditorStore((state) => state.updateTimeline);
  const setTimelinePlaying = useEditorStore((state) => state.setTimelinePlaying);
  const previewGenerationActive = useEditorStore((state) => state.previewGenerationActive);
  const setPreviewGenerationActive = useEditorStore((state) => state.setPreviewGenerationActive);
  const clearTemplateMeta = useEditorStore((state) => state.clearTemplateMeta);
  const bumpImportedElementsRefreshKey = useEditorStore((state) => state.bumpImportedElementsRefreshKey);
  const clearPublishCandidates = useEditorStore((state) => state.clearPublishCandidates);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < historyLength - 1;
  const activePage = useMemo(
    () => pages.find((page) => page.id === activePageId) || pages[0],
    [activePageId, pages]
  );
  const templateQueryKey = useMemo(() => searchParams.toString(), [searchParams]);
  const templateIdFromQuery = useMemo(
    () => String(new URLSearchParams(templateQueryKey).get("templateId") || "").trim(),
    [templateQueryKey]
  );
  // `?regeneratePreview=1` (templates list → "Regenerate preview") forces a fresh video preview.
  const regeneratePreviewFromQuery = useMemo(
    () => /^(1|true|yes)$/i.test(String(new URLSearchParams(templateQueryKey).get("regeneratePreview") || "").trim()),
    [templateQueryKey]
  );

  useEffect(() => {
    if (templateIdFromQuery && templateIdFromQuery !== activeTemplateId) {
      setTemplateMeta({ id: templateIdFromQuery });
    }
  }, [activeTemplateId, setTemplateMeta, templateIdFromQuery]);

  const buildEditorUrl = useCallback((templateId: string) => {
    const params = new URLSearchParams(templateQueryKey);
    if (templateId) {
      params.set("templateId", templateId);
    } else {
      params.delete("templateId");
    }
    const nextQuery = params.toString();
    return nextQuery ? `/editor-pro?${nextQuery}` : "/editor-pro";
  }, [templateQueryKey]);

  const updateTemplateIdInUrl = useCallback(
    (templateId: string) => {
      router.replace(buildEditorUrl(templateId));
    },
    [buildEditorUrl, router]
  );
  const previewTimelineDurationMs = useMemo(
    () => Math.max(1, Math.round(designTimeline.totalDurationMs || activePage?.durationMs || 0)),
    [activePage?.durationMs, designTimeline.totalDurationMs]
  );
  useEffect(() => {
    if (!previewToast) return;
    const timeoutId = window.setTimeout(() => {
      setPreviewToast((current) => (current?.message === previewToast.message ? null : current));
    }, previewToast.tone === "error" ? 5200 : 3200);
    return () => window.clearTimeout(timeoutId);
  }, [previewToast]);

  useEffect(() => {
    const handlePageUnload = () => {
      if (unloadAbortHandledRef.current) return;
      unloadAbortHandledRef.current = true;
      previewGenerationIdRef.current += 1;
      saveAbortControllerRef.current?.abort();
      previewAbortControllerRef.current?.abort();
      setPreviewGenerationActive(false);
      const activePreview = activePreviewCancelRef.current;
      if (!activePreview?.templateId) return;
      void fetch("/api/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activePreview.templateId,
          action: "updatePreview",
          preview: activePreview.preview,
        }),
        keepalive: true,
      }).catch(() => undefined);
    };

    window.addEventListener("beforeunload", handlePageUnload);
    window.addEventListener("pagehide", handlePageUnload);
    return () => {
      window.removeEventListener("beforeunload", handlePageUnload);
      window.removeEventListener("pagehide", handlePageUnload);
    };
  }, [setPreviewGenerationActive]);

  const patchTemplatePreview = useCallback(
    async ({
      id,
      preview,
    }: {
      id: string;
      preview: {
        status?: string | null;
        url?: string | null;
        posterUrl?: string | null;
        durationMs?: number | null;
        version?: number | null;
        error?: string | null;
      } | null;
    }, options?: { signal?: AbortSignal; keepalive?: boolean }) => {
      const response = await fetch("/api/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          action: "updatePreview",
          preview,
        }),
        keepalive: options?.keepalive,
        signal: options?.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to update template preview.");
      }
      return payload?.template || null;
    },
    []
  );

  const generateTemplatePreview = useCallback(
    async ({
      templateId,
      templateVersion,
      fallbackPosterDataUrl,
    }: {
      templateId: string;
      templateVersion: number;
      fallbackPosterDataUrl: string;
    }) => {
      const stageRecorder = stageApi?.recordTimelinePreviewVideo;
      if (!templateId || !stageRecorder) {
        // Both of these used to return in silence, which from the outside is a button that does
        // nothing. Say which one it was.
        setPreviewToast({ tone: "error", message: "The canvas is not ready yet. Try again in a moment." });
        return;
      }
      // A hidden tab pauses compositing: every recorded frame — and the poster — would be blank,
      // and that blank preview would ship to the list and the app. Keep the existing preview.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        setPreviewToast({
          tone: "error",
          message: "Keep this tab open and in front while the preview records.",
        });
        return;
      }

      previewAbortControllerRef.current?.abort();
      const jobId = previewGenerationIdRef.current + 1;
      previewGenerationIdRef.current = jobId;
      const nextGeneratedAt = new Date().toISOString();
      const wasPlaying = timelineIsPlaying;
      const controller = new AbortController();
      const canceledPreview = buildCanceledPreviewPayload(
        fallbackPosterDataUrl || designTimeline.preview.posterUrl || "",
        templateVersion,
        previewTimelineDurationMs
      );
      previewAbortControllerRef.current = controller;
      activePreviewCancelRef.current = {
        templateId,
        preview: canceledPreview,
        controller,
      };
      const announce = (
        tone: "info" | "success" | "error",
        message: string,
        details?: Record<string, unknown>
      ) => {
        logPreviewProgress(message, details);
        if (previewGenerationIdRef.current !== jobId) return;
        setPreviewToast({ tone, message });
      };
      const appendPreviewVersion = (url: string, token: string) => {
        const safeUrl = String(url || "").trim();
        const safeToken = String(token || "").trim();
        if (!safeUrl || !safeToken) return safeUrl;
        try {
          const parsed = new URL(
            safeUrl,
            typeof window !== "undefined" ? window.location.origin : "http://localhost"
          );
          parsed.searchParams.set("v", safeToken);
          if (/^https?:\/\//i.test(safeUrl)) {
            return parsed.toString();
          }
          return `${parsed.pathname}${parsed.search}${parsed.hash}`;
        } catch {
          const separator = safeUrl.includes("?") ? "&" : "?";
          return `${safeUrl}${separator}v=${encodeURIComponent(safeToken)}`;
        }
      };
      const setLocalPreviewState = (patch: Partial<EditorTimelinePreview>) => {
        if (previewGenerationIdRef.current !== jobId) return;
        updateTimeline(
          {
            preview: {
              ...designTimeline.preview,
              ...patch,
            },
          },
          { recordHistory: false }
        );
      };

      try {
        setPreviewGenerationActive(true);
        announce("info", "Generating template preview...");
        setLocalPreviewState({
          status: "processing",
          url: null,
          posterUrl: fallbackPosterDataUrl || designTimeline.preview.posterUrl || null,
          generatedAt: nextGeneratedAt,
          error: null,
        });

        await patchTemplatePreview({
          id: templateId,
          preview: {
            status: "processing",
            posterUrl: null,
            durationMs: previewTimelineDurationMs,
            version: templateVersion,
            error: null,
          },
        }, { signal: controller.signal });
        announce("info", "Recording preview video...");

        setTimelinePlaying(false);
        const recorded = await stageRecorder({
          fps: PREVIEW_RENDER_FPS,
          maxDimension: TEMPLATE_PREVIEW_VIDEO_MAX_DIMENSION,
          durationMs: previewTimelineDurationMs,
          signal: controller.signal,
        });
        if (!recorded?.blob || recorded.blob.size <= 0) {
          throw new Error("Preview renderer did not return a video.");
        }
        announce("info", "Uploading preview assets...", {
          mimeType: recorded.mimeType,
          durationMs: recorded.durationMs,
          width: recorded.width,
          height: recorded.height,
        });

        const videoExtension = extensionFromMimeType(recorded.mimeType);
        const videoFile = new File([recorded.blob], `template-preview-${templateId}.${videoExtension}`, {
          type: recorded.mimeType,
        });
        const uploadedVideo = await uploadEditorMediaFile(videoFile, "video", {
          signal: controller.signal,
          variant: "template-preview-video",
          templateId,
        });

        let posterUrl = fallbackPosterDataUrl || designTimeline.preview.posterUrl || "";
        if (recorded.posterDataUrl) {
          const posterFile = dataUrlToFile(recorded.posterDataUrl, `template-preview-${templateId}.png`);
          const uploadedPoster = await uploadEditorMediaFile(posterFile, "image", {
            signal: controller.signal,
            variant: "template-preview-poster",
            templateId,
          });
          posterUrl = uploadedPoster.url;
        }

        const template = await patchTemplatePreview({
          id: templateId,
          preview: {
            status: "ready",
            url: uploadedVideo.url,
            posterUrl: posterUrl || null,
            durationMs: recorded.durationMs,
            version: templateVersion,
            error: null,
          },
        }, { signal: controller.signal });
        if (previewAbortControllerRef.current === controller) {
          previewAbortControllerRef.current = null;
        }
        if (activePreviewCancelRef.current?.controller === controller) {
          activePreviewCancelRef.current = null;
        }
        const previewVersionToken =
          String(template?.preview?.updatedAt || "").trim() ||
          String(template?.preview?.version || "").trim() ||
          String(Date.parse(nextGeneratedAt) || Date.now());
        const resolvedPreviewUrl = String(template?.preview?.url || "").trim()
          || appendPreviewVersion(uploadedVideo.url, previewVersionToken);
        const resolvedPosterUrl = String(template?.preview?.posterUrl || "").trim()
          || appendPreviewVersion(posterUrl || "", previewVersionToken);

        setLocalPreviewState({
          status: "ready",
          url: resolvedPreviewUrl || null,
          posterUrl: resolvedPosterUrl || null,
          generatedAt: nextGeneratedAt,
          error: null,
        });
        announce("success", "Template preview is ready.", {
          url: resolvedPreviewUrl || null,
        });
      } catch (error) {
        if (isAbortError(error)) {
          logPreviewProgress("Template preview generation canceled.", { templateId, templateVersion });
          if (previewGenerationIdRef.current !== jobId) {
            return;
          }
          if (!unloadAbortHandledRef.current) {
            await patchTemplatePreview({
              id: templateId,
              preview: canceledPreview,
            }).catch(() => undefined);
            setLocalPreviewState({
              status: "not_requested",
              url: null,
              posterUrl: canceledPreview.posterUrl,
              generatedAt: null,
              error: null,
            });
          }
          return;
        }
        const message = error instanceof Error ? error.message : "Failed to generate template preview.";
        await patchTemplatePreview({
          id: templateId,
          preview: {
            status: "failed",
            posterUrl: null,
            durationMs: previewTimelineDurationMs,
            version: templateVersion,
            error: message,
          },
        }, { signal: controller.signal }).catch(() => undefined);

        setLocalPreviewState({
          status: "failed",
          generatedAt: nextGeneratedAt,
          error: message,
        });
        announce("error", `Preview generation failed: ${message}`);
      } finally {
        if (previewAbortControllerRef.current === controller) {
          previewAbortControllerRef.current = null;
        }
        if (activePreviewCancelRef.current?.controller === controller) {
          activePreviewCancelRef.current = null;
        }
        setPreviewGenerationActive(false);
        if (wasPlaying) {
          setTimelinePlaying(true);
        }
      }
    },
    [
      designTimeline.preview,
      patchTemplatePreview,
      previewTimelineDurationMs,
      setPreviewGenerationActive,
      stageApi,
      setTimelinePlaying,
      timelineIsPlaying,
      updateTimeline,
    ]
  );

  /**
   * One preview per page for the mobile page strip. The page bar already caches a capture for
   * every page the user opened; anything still missing is rendered through the hidden export
   * stage so a multi-page save never ships a partial strip. Best-effort — a page that fails to
   * render is simply omitted rather than blocking the save.
   */
  const collectPageThumbnailsForSave = useCallback(
    async (design: EditorDesign) => {
      const designPages = Array.isArray(design?.pages) ? design.pages : [];
      if (designPages.length <= 1) return null;

      const collected: Record<string, string> = {};
      for (const page of designPages) {
        const pageId = String(page?.id || "").trim();
        if (!pageId) continue;

        const cached = String(pageThumbnails[pageId] || "").trim();
        if (cached) {
          collected[pageId] = cached;
          continue;
        }
        if (!stageApi?.captureThumbnailDataUrlForPage) continue;
        try {
          // Hard ceiling per page. Rendering a page off-screen depends on image decoding and
          // frame scheduling, neither of which is guaranteed to make progress (a backgrounded
          // tab throttles both) — the save must never be held hostage by a preview.
          const captured = String(
            (await Promise.race([
              stageApi.captureThumbnailDataUrlForPage(pageId),
              new Promise<string>((resolve) =>
                window.setTimeout(() => resolve(""), PAGE_THUMBNAIL_CAPTURE_TIMEOUT_MS)
              ),
            ])) || ""
          ).trim();
          if (captured) collected[pageId] = captured;
        } catch {
          // Keep saving: a missing page preview only means mobile renders that tile itself.
        }
      }

      return Object.keys(collected).length > 0 ? collected : null;
    },
    [pageThumbnails, stageApi]
  );

  const saveTemplate = useCallback(async () => {
    if (isSavingTemplate) return null;

    let nextName = activeTemplateName.trim();
    if (!nextName) {
      const fallbackName = `Untitled ${new Date().toISOString().slice(0, 10)}`;
      const askedName = window.prompt("Template name", fallbackName);
      if (askedName === null) return null;
      nextName = askedName.trim();
      if (!nextName) {
        window.alert("Template name is required.");
        return null;
      }
    }

    setIsSavingTemplate(true);
    unloadAbortHandledRef.current = false;
    const saveController = new AbortController();
    saveAbortControllerRef.current = saveController;
    try {
      const parsedDesign = JSON.parse(exportDesign()) as EditorDesign;
      // First-frame capture (videos seeked to 0); "" from a hidden tab keeps the stored thumbnail.
      const thumbnailDataUrl = stageApi?.captureTemplateThumbnailDataUrl
        ? await stageApi.captureTemplateThumbnailDataUrl()
        : stageApi?.captureThumbnailDataUrl?.() || "";
      const savedPageThumbnails = await collectPageThumbnailsForSave(parsedDesign);
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(activeTemplateId ? { id: activeTemplateId } : {}),
          name: nextName,
          data: parsedDesign,
          canvasSize: {
            width: Math.max(1, Math.round(activePage?.width || 1080)),
            height: Math.max(1, Math.round(activePage?.height || 1080)),
          },
          category: activeTemplateCategory || "general",
          subCategory: activeTemplateSubCategory || "general",
          // Every placement the template is filed under. The scalars above stay as the
          // primary so a save from an older client shape still lands somewhere sane.
          categories: activeTemplateCategories,
          tags: activeTemplateTags,
          thumbnailDataUrl,
          // Per-page previews for the mobile page strip — one per page, including pages the
          // user never opened (rendered off-screen just above).
          ...(savedPageThumbnails ? { pageThumbnails: savedPageThumbnails } : {}),
        }),
        signal: saveController.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to save template.");
      }

      const template = payload?.template || null;
      if (template?.id) {
        setTemplateMeta({
          id: String(template.id),
          name: String(template.name || nextName),
          status: template.status === "published" ? "published" : "draft",
          category: String(template.category || activeTemplateCategory || "general"),
          subCategory: String(template.subCategory || activeTemplateSubCategory || "general"),
          ...(Array.isArray(template.categories) ? { categories: template.categories } : {}),
          tags: Array.isArray(template.tags) ? template.tags : activeTemplateTags,
        });
        updateTemplateIdInUrl(String(template.id));
      } else {
        setTemplateMeta({ name: nextName });
      }

      if (template?.id) {
        const posterUrl =
          String(template?.preview?.posterUrl || "").trim() ||
          String(template?.thumbnailDataUrl || "").trim() ||
          String(thumbnailDataUrl || "").trim() ||
          null;
        // Saving does NOT record a preview: it is a real-time capture of the whole timeline
        // (13 seconds for a 13-second design) and it would run on every save, including
        // autosaves. The "Generate preview" button in the toolbar is the only trigger, plus
        // the templates list's "Regenerate preview" (which opens the editor with a flag).
        // Just mirror whatever preview the server currently holds into the local timeline.
        const templatePreview = template?.preview || null;
        updateTimeline(
          {
            preview: {
              status: normalizeTimelinePreviewStatus(templatePreview?.status),
              url: String(templatePreview?.url || "").trim() || null,
              posterUrl:
                String(templatePreview?.posterUrl || "").trim() ||
                String(posterUrl || "").trim() ||
                null,
              generatedAt:
                Number.isFinite(Number(templatePreview?.updatedAt))
                  ? new Date(Number(templatePreview.updatedAt)).toISOString()
                  : null,
              error: String(templatePreview?.error || "").trim() || null,
            },
          },
          { recordHistory: false }
        );
      }

      return template;
    } catch (error: unknown) {
      if (isAbortError(error)) {
        return null;
      }
      const message = error instanceof Error ? error.message : "Failed to save template.";
      window.alert(message);
      return null;
    } finally {
      if (saveAbortControllerRef.current === saveController) {
        saveAbortControllerRef.current = null;
      }
      setIsSavingTemplate(false);
    }
  }, [
    activePage?.height,
    activePage?.width,
    activeTemplateCategories,
    activeTemplateCategory,
    activeTemplateId,
    activeTemplateName,
    activeTemplateSubCategory,
    activeTemplateTags,
    collectPageThumbnailsForSave,
    exportDesign,
    isSavingTemplate,
    stageApi,
    setTemplateMeta,
    updateTimeline,
    updateTemplateIdInUrl,
  ]);

  // Save first, then record: the capture reads the live stage, and the server rejects a preview
  // whose version is older than the template's — saving makes both match what is stored.
  const handleGeneratePreview = useCallback(async () => {
    if (previewGenerationActive || isSavingTemplate) return;
    if (!stageApi?.recordTimelinePreviewVideo) {
      window.alert("The canvas is not ready yet. Try again in a moment.");
      return;
    }
    const saved = await saveTemplate();
    const templateId = String(saved?.id || activeTemplateId || "").trim();
    if (!templateId) return;
    await generateTemplatePreview({
      templateId,
      templateVersion: Number(saved?.version || 0),
      fallbackPosterDataUrl:
        String(saved?.preview?.posterUrl || "").trim() ||
        String(saved?.thumbnailDataUrl || "").trim() ||
        String(designTimeline.preview.posterUrl || "").trim(),
    });
  }, [
    activeTemplateId,
    designTimeline.preview.posterUrl,
    generateTemplatePreview,
    isSavingTemplate,
    previewGenerationActive,
    saveTemplate,
    stageApi,
  ]);

  // The templates list's "Regenerate preview" opens the editor with ?regeneratePreview=1. That is
  // an explicit click too, so it runs once the template is loaded — nothing else is automatic.
  const requestedPreviewRef = useRef("");
  useEffect(() => {
    if (!regeneratePreviewFromQuery) return undefined;
    const templateId = String(activeTemplateId || "").trim();
    if (!templateId || requestedPreviewRef.current === templateId) return undefined;
    if (!stageApi?.recordTimelinePreviewVideo) return undefined;
    requestedPreviewRef.current = templateId;
    // Fonts and media are still streaming in right after load; the recorder samples the live stage.
    const timeoutId = window.setTimeout(() => {
      void handleGeneratePreview();
    }, 3000);
    return () => window.clearTimeout(timeoutId);
  }, [activeTemplateId, handleGeneratePreview, regeneratePreviewFromQuery, stageApi]);

  const publishTemplate = useCallback(async () => {
    if (isPublishingTemplate || activeTemplateStatus === "published") return;

    setIsPublishingTemplate(true);
    try {
      const saved = await saveTemplate();
      const templateId = String(saved?.id || "");
      if (!templateId) return;

      const response = await fetch("/api/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: templateId,
          action: "publish",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to publish template.");
      }

      const template = payload?.template;
      if (template?.id) {
        setTemplateMeta({
          id: String(template.id),
          name: String(template.name || activeTemplateName || "Untitled"),
          status: template.status === "published" ? "published" : "draft",
          category: String(template.category || activeTemplateCategory || "general"),
          subCategory: String(template.subCategory || activeTemplateSubCategory || "general"),
          ...(Array.isArray(template.categories) ? { categories: template.categories } : {}),
          tags: Array.isArray(template.tags) ? template.tags : activeTemplateTags,
        });
      } else {
        setTemplateMeta({ status: "published" });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to publish template.";
      window.alert(message);
    } finally {
      setIsPublishingTemplate(false);
    }
  }, [
    activeTemplateCategory,
    activeTemplateName,
    activeTemplateStatus,
    activeTemplateSubCategory,
    activeTemplateTags,
    isPublishingTemplate,
    saveTemplate,
    setTemplateMeta,
  ]);

  /**
   * Flips the open template between free and Nayroz Pro.
   *
   * Saves first, exactly like publish does, so an admin can flag a brand-new
   * design without a save-then-flag two-step. Admin-only on the server; the
   * button is hidden for designers rather than failing on click.
   */
  const toggleTemplatePremium = useCallback(async () => {
    if (isTogglingPremium) return;
    setIsTogglingPremium(true);
    try {
      // Only a template that was never saved needs a save to get an id. Saving an existing
      // one would bump its updatedAt, and the app then drops its ready preview video
      // (isTemplatePreviewStale) — the Pro flag itself never touches the design.
      const saved = activeTemplateId ? null : await saveTemplate();
      const templateId = String(saved?.id || activeTemplateId || "");
      if (!templateId) return;

      const nextValue = !activeTemplateIsPremium;
      const response = await fetch("/api/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: templateId,
          action: "setPremium",
          isPremium: nextValue,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to update the Pro flag.");
      }
      setTemplateMeta({ isPremium: Boolean(payload?.template?.isPremium ?? nextValue) });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to update the Pro flag.";
      window.alert(message);
    } finally {
      setIsTogglingPremium(false);
    }
  }, [
    activeTemplateId,
    activeTemplateIsPremium,
    isTogglingPremium,
    saveTemplate,
    setTemplateMeta,
  ]);

  const unpublishTemplate = useCallback(async () => {
    if (isUnpublishingTemplate || activeTemplateStatus !== "published") return;
    if (!activeTemplateId) {
      window.alert("Save the template first before unpublishing.");
      return;
    }
    const confirmed = window.confirm(
      `Unpublish template "${activeTemplateName.trim() || "Untitled"}"?`
    );
    if (!confirmed) return;

    setIsUnpublishingTemplate(true);
    try {
      const response = await fetch("/api/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeTemplateId,
          action: "unpublish",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to unpublish template.");
      }

      const template = payload?.template;
      if (template?.id) {
        setTemplateMeta({
          id: String(template.id),
          name: String(template.name || activeTemplateName || "Untitled"),
          status: template.status === "published" ? "published" : "draft",
          category: String(template.category || activeTemplateCategory || "general"),
          subCategory: String(template.subCategory || activeTemplateSubCategory || "general"),
          ...(Array.isArray(template.categories) ? { categories: template.categories } : {}),
          tags: Array.isArray(template.tags) ? template.tags : activeTemplateTags,
        });
      } else {
        setTemplateMeta({ status: "draft" });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to unpublish template.";
      window.alert(message);
    } finally {
      setIsUnpublishingTemplate(false);
    }
  }, [
    activeTemplateCategory,
    activeTemplateId,
    activeTemplateName,
    activeTemplateStatus,
    activeTemplateSubCategory,
    activeTemplateTags,
    isUnpublishingTemplate,
    setTemplateMeta,
  ]);

  const publishSelectedElements = useCallback(async () => {
    if (isPublishingElements) return;
    if (!activePage || publishCandidateIds.length === 0) return;

    setIsPublishingElements(true);
    try {
      const parsedDesign = JSON.parse(exportDesign()) as EditorDesign;
      const response = await fetch("/api/editor/elements/publish-from-canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: activeTemplateId || "",
          pageId: activePage.id,
          elementIds: publishCandidateIds,
          categoryValue: publishCategoryValue,
          design: parsedDesign,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to publish selected elements.");
      }

      const publishedCount = Array.isArray(payload?.published) ? payload.published.length : 0;
      const skippedCount = Array.isArray(payload?.skipped) ? payload.skipped.length : 0;
      bumpImportedElementsRefreshKey();
      clearPublishCandidates();

      if (publishedCount === 0 && skippedCount > 0) {
        // Report the server's ACTUAL reason. The old fixed message always blamed
        // "background / full-page", which sent debugging down the wrong path when the real
        // cause was a missing or unresolvable asset source.
        const reasons = Array.from(
          new Set(
            (payload.skipped as Array<{ reason?: string }>)
              .map((entry) => String(entry?.reason || "").trim())
              .filter(Boolean)
          )
        );
        const explain: Record<string, string> = {
          "background-like": "it covers the page (backgrounds are skipped)",
          "unsupported-type": "it is not an image layer",
          "missing-source": "its image source could not be resolved",
          "missing-element": "the layer was not found on the page",
        };
        const detail = reasons.map((reason) => explain[reason] || reason).join("; ");
        window.alert(
          `Nothing was published — ${skippedCount} skipped${detail ? `: ${detail}` : "."}`
        );
        return;
      }

      // No modal on success — the library refresh is the confirmation. Only a partial publish
      // (something skipped) is worth a word, and a passing toast is enough for that.
      if (skippedCount > 0) {
        setPreviewToast({
          tone: "info",
          message: `Published ${publishedCount} element${publishedCount === 1 ? "" : "s"}. Skipped ${skippedCount} background-like item${skippedCount === 1 ? "" : "s"}.`,
        });
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to publish selected elements.";
      window.alert(message);
    } finally {
      setIsPublishingElements(false);
    }
  }, [
    activePage,
    activeTemplateId,
    bumpImportedElementsRefreshKey,
    clearPublishCandidates,
    publishCategoryValue,
    exportDesign,
    isPublishingElements,
    publishCandidateIds,
  ]);

  const deleteTemplate = useCallback(async () => {
    if (isDeletingTemplate) return;
    if (!activeTemplateId) {
      window.alert("Save the template first before deleting.");
      return;
    }

    const confirmed = window.confirm(
      `Delete template "${activeTemplateName.trim() || "Untitled"}"?`
    );
    if (!confirmed) return;

    setIsDeletingTemplate(true);
    try {
      const response = await fetch(`/api/templates/${encodeURIComponent(activeTemplateId)}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete template.");
      }

      clearTemplateMeta();
      window.location.assign(buildEditorUrl(""));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to delete template.";
      window.alert(message);
    } finally {
      setIsDeletingTemplate(false);
    }
  }, [
    activeTemplateId,
    activeTemplateName,
    buildEditorUrl,
    clearTemplateMeta,
    isDeletingTemplate,
  ]);

  // A video preview only means something for a design that moves (video layer or animation); the
  // server clears the preview of a static template on save, so the button is hidden for those.
  const isMotionDesign = useMemo(
    () => hasAnimatedTemplateContent(pages, designTimeline),
    [designTimeline, pages]
  );
  const templateShareUrl = useMemo(
    () => buildTemplateShareUrl(activeTemplateId),
    [activeTemplateId]
  );
  const isTemplateShareable = activeTemplateStatus === "published";

  const closeShareLink = useCallback(() => {
    setIsShareLinkOpen(false);
    setShareCopyState("idle");
    if (shareCopyTimeoutRef.current !== null) {
      window.clearTimeout(shareCopyTimeoutRef.current);
      shareCopyTimeoutRef.current = null;
    }
  }, []);

  const toggleShareLink = useCallback(() => {
    if (!activeTemplateId) {
      window.alert("Save the template first before sharing.");
      return;
    }
    setShareCopyState("idle");
    setIsShareLinkOpen((current) => !current);
  }, [activeTemplateId]);

  const copyShareLink = useCallback(async () => {
    if (!templateShareUrl) return;
    if (shareCopyTimeoutRef.current !== null) {
      window.clearTimeout(shareCopyTimeoutRef.current);
      shareCopyTimeoutRef.current = null;
    }
    try {
      // `navigator.clipboard` is undefined outside a secure context (plain http on a LAN
      // IP), and `writeText` rejects when the document is not focused. Both land here.
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable.");
      }
      await navigator.clipboard.writeText(templateShareUrl);
      setShareCopyState("copied");
      shareCopyTimeoutRef.current = window.setTimeout(() => {
        setShareCopyState((current) => (current === "copied" ? "idle" : current));
        shareCopyTimeoutRef.current = null;
      }, 1800);
    } catch (_error) {
      setShareCopyState("error");
      // Fall back to selecting the link so the user can copy it by hand.
      const input = shareInputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    }
  }, [templateShareUrl]);

  useEffect(() => {
    closeShareLink();
  }, [activeTemplateId, closeShareLink]);

  useEffect(() => {
    if (!isShareLinkOpen) return;
    const input = shareInputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
  }, [isShareLinkOpen]);

  useEffect(() => {
    if (!isShareLinkOpen) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const wrapper = shareWrapperRef.current;
      if (!wrapper) return;
      const target = event.target;
      if (target instanceof Node && wrapper.contains(target)) return;
      closeShareLink();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeShareLink();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeShareLink, isShareLinkOpen]);

  useEffect(() => {
    return () => {
      if (shareCopyTimeoutRef.current !== null) {
        window.clearTimeout(shareCopyTimeoutRef.current);
        shareCopyTimeoutRef.current = null;
      }
    };
  }, []);

  // The dashboard nav opens as a drawer over the editor: the canvas needs the width more than a
  // permanently open sidebar does.
  useEffect(() => {
    if (!isNavOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsNavOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isNavOpen]);

  const isPublished = activeTemplateStatus === "published";
  const templateNameWidthCh = Math.max(8, Math.min(30, (activeTemplateName || "Untitled design").length + 2));
  const publishElementsDisabled =
    isPublishingElements || isDeletingTemplate || publishCandidateIds.length === 0 || !activePage;

  return (
    <>
      <header className="relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-[#eceef0] bg-white px-2 sm:px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <ToolButton
            icon={Menu}
            label="Open navigation"
            onClick={() => setIsNavOpen(true)}
            aria-expanded={isNavOpen}
            aria-haspopup="dialog"
          />
          <ToolDivider />

          <input
            type="text"
            value={activeTemplateName}
            placeholder="Untitled design"
            aria-label="Template name"
            title="Rename template"
            onChange={(event) => setTemplateMeta({ name: event.target.value })}
            className="h-8 min-w-0 rounded-lg bg-transparent px-2 text-[14px] font-semibold text-t-primary outline-none transition-colors placeholder:font-normal placeholder:text-t-tertiary hover:bg-[#f1f2f4] focus:bg-[#f1f2f4]"
            style={{ width: `${templateNameWidthCh}ch` }}
          />

          <span
            className={cx(
              "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium",
              isPublished ? "bg-brand-teal/12 text-brand-teal" : "bg-[#f1f2f4] text-t-secondary"
            )}
            title={isPublished ? "Live in the app" : "Not visible in the app yet"}
          >
            <span className={cx("h-1.5 w-1.5 rounded-full", isPublished ? "bg-brand-teal" : "bg-[#a3a7ad]")} />
            {isPublished ? "Published" : "Draft"}
          </span>

          {canManagePremium ? (
            <button
              type="button"
              onClick={() => void toggleTemplatePremium()}
              disabled={isTogglingPremium || isSavingTemplate || isDeletingTemplate}
              aria-pressed={activeTemplateIsPremium}
              aria-label="Require a Nayroz Pro subscription to use this template"
              title={
                activeTemplateIsPremium
                  ? "This template needs a Nayroz Pro subscription — click to make it free"
                  : "Free template — click to require a Nayroz Pro subscription"
              }
              className={cx(
                "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                activeTemplateIsPremium
                  ? "bg-[#fdeceb] text-[#c2453e] hover:bg-[#fbdedc]"
                  : "text-t-secondary hover:bg-[#f1f2f4]"
              )}
            >
              {isTogglingPremium ? (
                <LoaderCircle size={12} className="animate-spin" />
              ) : (
                <Crown size={12} strokeWidth={2.2} />
              )}
              {activeTemplateIsPremium ? "Pro" : "Free"}
            </button>
          ) : activeTemplateIsPremium ? (
            <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-[#fdeceb] px-2.5 text-[12px] font-medium text-[#c2453e]">
              <Crown size={12} strokeWidth={2.2} /> Pro
            </span>
          ) : null}

          <ToolDivider />
          <ToolButton icon={Undo2} label="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo} />
          <ToolButton icon={Redo2} label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo} />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {publishCandidateIds.length > 0 ? (
            <ToolButton
              icon={PackagePlus}
              label={
                isPublishingElements
                  ? "Publishing…"
                  : `Publish ${publishCandidateIds.length} element${publishCandidateIds.length === 1 ? "" : "s"}`
              }
              showLabel
              onClick={() => void publishSelectedElements()}
              disabled={publishElementsDisabled}
              title="Add the checked image layers to the Elements library"
            />
          ) : null}

          {isMotionDesign ? (
            <ToolButton
              icon={previewGenerationActive ? LoaderCircle : Film}
              label="Generate preview"
              onClick={() => void handleGeneratePreview()}
              disabled={previewGenerationActive || isSavingTemplate || isDeletingTemplate}
              title="Save the template and record a video preview of the timeline (takes about as long as the design runs)"
              className={previewGenerationActive ? "[&>svg]:animate-spin" : undefined}
            />
          ) : null}

          <div className="relative" ref={shareWrapperRef}>
            <ToolButton
              icon={Share2}
              label="Share"
              active={isShareLinkOpen}
              onClick={toggleShareLink}
              disabled={isDeletingTemplate || !activeTemplateId}
              title={activeTemplateId ? "Copy the public share link for this template" : "Save the template first before sharing."}
              aria-haspopup="dialog"
              aria-expanded={isShareLinkOpen}
            />

            {isShareLinkOpen && templateShareUrl ? (
              <div
                role="dialog"
                aria-label="Template share link"
                className={cx("absolute right-0 top-full z-50 mt-2 w-[340px] rounded-2xl bg-white p-3", FLOATING_SHADOW)}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold text-t-primary">Share link</p>
                  <ToolButton icon={X} label="Close" onClick={closeShareLink} className="!h-7 !w-7" />
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <input
                    ref={shareInputRef}
                    type="text"
                    readOnly
                    value={templateShareUrl}
                    aria-label="Public share link"
                    onFocus={(event) => event.currentTarget.select()}
                    onClick={(event) => event.currentTarget.select()}
                    className="h-9 min-w-0 flex-1 rounded-full bg-[#f1f2f4] px-3 text-[12px] text-t-primary outline-none focus:ring-2 focus:ring-brand-teal/30"
                  />
                  <button
                    type="button"
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-brand-teal px-3.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
                    onClick={() => void copyShareLink()}
                  >
                    {shareCopyState === "copied" ? (
                      <>
                        <Check size={14} /> Copied
                      </>
                    ) : (
                      <>
                        <Copy size={14} /> Copy
                      </>
                    )}
                  </button>
                </div>

                {shareCopyState === "error" ? (
                  <p className="mt-2 rounded-xl bg-[#fdecea] px-2.5 py-1.5 text-[12px] text-[#b42318]">
                    Could not reach the clipboard (this needs https or localhost). The link is
                    selected above — copy it manually.
                  </p>
                ) : null}

                {isTemplateShareable ? (
                  <p className="mt-2 text-[12px] leading-snug text-t-secondary">
                    Opens the template in the Nayroz app when installed, otherwise a public web
                    page.
                  </p>
                ) : (
                  <p className="mt-2 rounded-xl bg-[#fff6e5] px-2.5 py-1.5 text-[12px] leading-snug text-[#92400e]">
                    This template is a draft, so the link will 404 for anyone you send it to.
                    Publish it first to make the link work.
                  </p>
                )}
              </div>
            ) : null}
          </div>

          <ToolButton icon={Download} label="Download PNG" onClick={() => stageApi?.exportPng()} />

          <ToolDivider />

          <button
            type="button"
            onClick={() => void saveTemplate()}
            disabled={isSavingTemplate || isDeletingTemplate}
            className={cx(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              // Once live, saving is the main action (it updates the published template).
              isPublished
                ? "bg-brand-teal text-white hover:bg-brand-teal/90"
                : "bg-[#f1f2f4] text-t-primary hover:bg-[#e6e8eb]"
            )}
          >
            {isSavingTemplate ? <LoaderCircle size={14} className="animate-spin" /> : null}
            {isSavingTemplate ? "Saving…" : "Save"}
          </button>

          {!isPublished ? (
            <button
              type="button"
              onClick={() => void publishTemplate()}
              disabled={isPublishingTemplate || isDeletingTemplate}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-brand-teal px-4 text-[13px] font-semibold text-white transition-colors hover:bg-brand-teal/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPublishingTemplate ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={14} />}
              {isPublishingTemplate ? "Publishing…" : "Publish"}
            </button>
          ) : null}

          <ToolPopover
            label="More actions"
            role="menu"
            align="end"
            width={232}
            trigger={({ open, triggerProps }) => (
              <ToolButton icon={Ellipsis} label="More actions" active={open} {...triggerProps} />
            )}
          >
            {(close) => (
              <div className="-m-1.5">
                {isPublished ? (
                  <MenuItem
                    icon={EyeOff}
                    disabled={isUnpublishingTemplate || isDeletingTemplate}
                    onClick={() => {
                      close();
                      void unpublishTemplate();
                    }}
                  >
                    {isUnpublishingTemplate ? "Unpublishing…" : "Unpublish"}
                  </MenuItem>
                ) : null}
                <MenuItem
                  icon={Download}
                  onClick={() => {
                    close();
                    stageApi?.exportPng();
                  }}
                >
                  Download PNG
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  icon={Trash2}
                  tone="danger"
                  disabled={
                    isDeletingTemplate ||
                    isSavingTemplate ||
                    isPublishingTemplate ||
                    isUnpublishingTemplate ||
                    !activeTemplateId
                  }
                  onClick={() => {
                    close();
                    void deleteTemplate();
                  }}
                >
                  {isDeletingTemplate ? "Deleting…" : "Delete template"}
                </MenuItem>
              </div>
            )}
          </ToolPopover>
        </div>
      </header>

      {isNavOpen ? (
        <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-[#101215]/30"
            onClick={() => setIsNavOpen(false)}
          />
          <aside
            className="sidebar absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto shadow-[0_16px_48px_-4px_rgba(0,0,0,0.18)]"
            onClick={(event) => {
              // Following a link leaves the drawer open on the next page otherwise (same route).
              if ((event.target as HTMLElement).closest("a")) setIsNavOpen(false);
            }}
          >
            <div className="flex items-center justify-between gap-3 py-5 pl-6 pr-4">
              <Link href="/" className="flex min-w-0 items-center gap-3 transition-opacity hover:opacity-80">
                <NayrozIcon size={36} className={undefined} title={undefined} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">Nayroz</div>
                  <div className="truncate text-xs text-muted-foreground">Studio console</div>
                </div>
              </Link>
              <ToolButton icon={X} label="Close navigation" onClick={() => setIsNavOpen(false)} />
            </div>
            <DashboardNav navItems={navItems} />
          </aside>
        </div>
      ) : null}

      {previewToast ? (
        <div
          className="editor-status-toast"
          style={
            previewToast.tone === "success"
              ? {
                  borderColor: "#86efac",
                  background: "#f0fdf4",
                }
              : previewToast.tone === "error"
                ? {
                    borderColor: "#fca5a5",
                    background: "#fef2f2",
                  }
                : undefined
          }
        >
          <div className="flex items-start gap-2">
            <span
              className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                previewToast.tone === "success"
                  ? "bg-[#16a34a]"
                  : previewToast.tone === "error"
                    ? "bg-[#dc2626]"
                    : "bg-brand-teal"
              }`}
            />
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-t-secondary">Template preview</p>
              <p className="mt-0.5 text-sm font-medium text-t-primary">{previewToast.message}</p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
