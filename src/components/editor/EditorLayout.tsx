"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo } from "react";

import Toolbar from "@/components/editor/Toolbar";
import SidePanel from "@/components/editor/SidePanel";
import PropertiesPanel from "@/components/editor/PropertiesPanel";
import PagesTimeline from "@/components/editor/PagesTimeline";
import PageBar from "@/components/editor/PageBar";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { useEditorStore } from "@/store/editorStore";
import { buildGoogleFontsStylesheetUrl } from "@/lib/editor/fonts";
import {
  extractImageSourceFromClipboardHtml,
  extractTextFromClipboardHtml,
  getClipboardHtml,
  getClipboardImageFile,
  getClipboardSvgDataUrl,
  getClipboardText,
  hasInternalEditorClipboardMarker,
  readImageSourceFromAsyncClipboard,
  renderClipboardHtmlToImageDataUrl,
  writeInternalEditorClipboardMarker,
} from "@/lib/editor/clipboardImport";
import { hasAnimatedTemplateContent } from "@/lib/editor/animationTimeline";

const CanvasEditor = dynamic(() => import("@/components/editor/CanvasEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-slate-100 text-sm text-slate-500 dark:bg-slate-900 dark:text-slate-300">
      Loading canvas engine...
    </div>
  ),
});

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.getAttribute("role") === "textbox") return true;
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Failed to read pasted file."));
    reader.readAsDataURL(file);
  });
}

function isLikelyImageUrl(value: string) {
  const safe = String(value || "").trim();
  return /^https?:\/\/\S+\.(png|jpe?g|gif|webp|avif|bmp)(\?.*)?$/i.test(safe);
}

export default function EditorLayout() {
  const showLeftSidebar = useEditorStore((state) => state.showLeftSidebar);
  const showRightSidebar = useEditorStore((state) => state.showRightSidebar);
  const pages = useEditorStore((state) => state.pages);
  const activePageId = useEditorStore((state) => state.activePageId);
  const setActivePageId = useEditorStore((state) => state.setActivePageId);
  const designTimeline = useEditorStore((state) => state.designTimeline);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const setShowLeftSidebar = useEditorStore((state) => state.setShowLeftSidebar);
  const setShowRightSidebar = useEditorStore((state) => state.setShowRightSidebar);
  const availableFontFamilies = useEditorStore((state) => state.availableFontFamilies);
  const stageApi = useEditorStore((state) => state.stageApi);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const deleteSelected = useEditorStore((state) => state.deleteSelected);
  const copySelectedToClipboard = useEditorStore((state) => state.copySelectedToClipboard);
  const pasteFromClipboard = useEditorStore((state) => state.pasteFromClipboard);
  const addImageElement = useEditorStore((state) => state.addImageElement);
  const addTextElement = useEditorStore((state) => state.addTextElement);
  const showAnimationTimeline = useMemo(
    () => hasAnimatedTemplateContent(pages, designTimeline),
    [designTimeline, pages]
  );
  useEffect(() => {
    const sync = () => {
      if (window.innerWidth < 1024) {
        setShowLeftSidebar(false);
        setShowRightSidebar(false);
      } else {
        setShowLeftSidebar(true);
        setShowRightSidebar(false);
      }
    };

    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [setShowLeftSidebar, setShowRightSidebar]);

  useEffect(() => {
    const id = "editor-google-fonts";
    const href = buildGoogleFontsStylesheetUrl(availableFontFamilies);
    if (!href) return;

    let link = document.getElementById(id) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    if (link.href !== href) {
      link.href = href;
    }
  }, [availableFontFamilies]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const typingTarget = isTypingTarget(event.target);
      const key = event.key.toLowerCase();
      const ctrlOrMeta = event.ctrlKey || event.metaKey;

      if (!typingTarget && ctrlOrMeta && !event.altKey && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if (!typingTarget && ctrlOrMeta && !event.altKey && key === "y") {
        event.preventDefault();
        redo();
        return;
      }

      if (!typingTarget && ctrlOrMeta && event.shiftKey && !event.altKey && key === "m") {
        event.preventDefault();
        void stageApi?.mergeSelectedLayers?.().then((result) => {
          if (!result?.merged && result?.message) {
            window.alert(result.message);
          }
        });
        return;
      }

      if (typingTarget) return;

      if ((event.key === "PageUp" || event.key === "PageDown") && !ctrlOrMeta && !event.altKey) {
        event.preventDefault();
        const currentIndex = pages.findIndex((page) => page.id === activePageId);
        if (currentIndex < 0) return;
        const nextIndex = event.key === "PageUp" ? currentIndex - 1 : currentIndex + 1;
        const nextPage = pages[nextIndex];
        if (nextPage) {
          setActivePageId(nextPage.id);
        }
        return;
      }

      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        !ctrlOrMeta &&
        !event.altKey
      ) {
        event.preventDefault();
        if (selectedIds.length > 0) {
          deleteSelected();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activePageId,
    deleteSelected,
    pages,
    redo,
    selectedIds.length,
    setActivePageId,
    stageApi,
    undo,
  ]);

  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      const typingTarget = isTypingTarget(event.target);
      if (typingTarget) return;
      if (selectedIds.length === 0) return;

      const copied = copySelectedToClipboard();
      if (!copied) return;

      const marked = writeInternalEditorClipboardMarker(event);
      if (marked) {
        event.preventDefault();
      }
    };

    window.addEventListener("copy", onCopy);
    return () => window.removeEventListener("copy", onCopy);
  }, [copySelectedToClipboard, selectedIds.length]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const typingTarget = isTypingTarget(event.target);
      if (typingTarget) return;

      if (hasInternalEditorClipboardMarker(event)) {
        const pastedIds = pasteFromClipboard();
        if (pastedIds.length > 0) {
          event.preventDefault();
        }
        return;
      }

      const imageFile = getClipboardImageFile(event);
      if (imageFile) {
        event.preventDefault();
        void readFileAsDataUrl(imageFile)
          .then((dataUrl) => {
            if (!dataUrl) return;
            addImageElement(dataUrl, { name: "Image" });
          })
          .catch(() => {
            // Ignore clipboard read failure and keep editor responsive.
          });
        return;
      }

      const svgDataUrl = getClipboardSvgDataUrl(event);
      if (svgDataUrl) {
        event.preventDefault();
        addImageElement(svgDataUrl, { name: "Image" });
        return;
      }

      const html = getClipboardHtml(event);
      const htmlImageSource = extractImageSourceFromClipboardHtml(html);
      if (htmlImageSource) {
        event.preventDefault();
        addImageElement(htmlImageSource, { name: "Image" });
        return;
      }

      const text = getClipboardText(event);
      const htmlText = extractTextFromClipboardHtml(html);
      if (html) {
        event.preventDefault();
        const asyncClipboardImageSourcePromise = readImageSourceFromAsyncClipboard();
        void renderClipboardHtmlToImageDataUrl(html)
          .then((renderedImageSource) => {
            if (renderedImageSource) {
              addImageElement(renderedImageSource, { name: "Image" });
              return;
            }

            return asyncClipboardImageSourcePromise.then((clipboardImageSource) => {
              if (clipboardImageSource) {
                addImageElement(clipboardImageSource, { name: "Image" });
                return;
              }

              const fallbackText = text || htmlText;
              if (fallbackText) {
                addTextElement(fallbackText, { name: "Text" });
              }
            });
          })
          .catch(() => {
            const fallbackText = text || htmlText;
            if (fallbackText) {
              addTextElement(fallbackText, { name: "Text" });
            }
          });
        return;
      }

      if (!text) {
        event.preventDefault();
        void readImageSourceFromAsyncClipboard()
          .then((clipboardImageSource) => {
            if (!clipboardImageSource) return;
            addImageElement(clipboardImageSource, { name: "Image" });
          })
          .catch(() => {
            // Ignore clipboard read failure and keep editor responsive.
          });
        return;
      }

      event.preventDefault();
      if (isLikelyImageUrl(text)) {
        addImageElement(text, { name: "Image" });
        return;
      }

      addTextElement(text, { name: "Text" });
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addImageElement, addTextElement, pasteFromClipboard]);

  return (
    <div className="flex h-screen min-h-screen flex-col bg-[#d7d7d9] text-[#1f2a39]">
      <Toolbar
        onToggleLeft={() => setShowLeftSidebar(!showLeftSidebar)}
        onToggleRight={() => setShowRightSidebar(!showRightSidebar)}
      />

      <div className="flex min-h-0 flex-1">
        <SidePanel collapsed={!showLeftSidebar} />

        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 bg-[#d7d7d9]">
            <ErrorBoundary>
              <CanvasEditor />
            </ErrorBoundary>
          </div>
          <PageBar />
          <PagesTimeline showTimeline={showAnimationTimeline} />
        </div>

        <PropertiesPanel collapsed={!showRightSidebar} />
      </div>
    </div>
  );
}
