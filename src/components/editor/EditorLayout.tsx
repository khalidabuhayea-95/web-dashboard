"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";

import Toolbar from "@/components/editor/Toolbar";
import SidePanel from "@/components/editor/SidePanel";
import PropertiesPanel from "@/components/editor/PropertiesPanel";
import PagesTimeline from "@/components/editor/PagesTimeline";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { useEditorStore } from "@/store/editorStore";
import { buildGoogleFontsStylesheetUrl } from "@/lib/editor/fonts";

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
  const skipNextPasteEventRef = useRef(false);

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

      if (!typingTarget && ctrlOrMeta && !event.altKey && key === "c") {
        if (selectedIds.length > 0) {
          const copied = copySelectedToClipboard();
          if (copied) {
            event.preventDefault();
          }
        }
        return;
      }

      if (!typingTarget && ctrlOrMeta && !event.altKey && key === "v") {
        const pastedIds = pasteFromClipboard();
        if (pastedIds.length > 0) {
          skipNextPasteEventRef.current = true;
          event.preventDefault();
        }
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
    copySelectedToClipboard,
    deleteSelected,
    pasteFromClipboard,
    redo,
    selectedIds.length,
    stageApi,
    undo,
  ]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const typingTarget = isTypingTarget(event.target);
      if (typingTarget) return;

      if (skipNextPasteEventRef.current) {
        skipNextPasteEventRef.current = false;
        event.preventDefault();
        return;
      }

      const clipboard = event.clipboardData;
      if (!clipboard) return;

      const imageItem = Array.from(clipboard.items || []).find(
        (item) => item.kind === "file" && item.type.startsWith("image/")
      );

      if (imageItem) {
        const file = imageItem.getAsFile();
        if (!file) return;
        event.preventDefault();
        void readFileAsDataUrl(file)
          .then((dataUrl) => {
            if (!dataUrl) return;
            addImageElement(dataUrl, { name: "Image" });
          })
          .catch(() => {
            // Ignore clipboard read failure and keep editor responsive.
          });
        return;
      }

      const text = String(clipboard.getData("text/plain") || "").trim();
      if (!text) return;

      event.preventDefault();
      if (isLikelyImageUrl(text)) {
        addImageElement(text, { name: "Image" });
        return;
      }

      addTextElement(text, { name: "Text" });
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addImageElement, addTextElement]);

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
          <PagesTimeline />
        </div>

        <PropertiesPanel collapsed={!showRightSidebar} />
      </div>
    </div>
  );
}
