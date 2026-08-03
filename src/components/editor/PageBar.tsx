"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, MoreHorizontal, Plus, Trash2 } from "lucide-react";

import { useEditorStore, type EditorPage, type PageBackground } from "@/store/editorStore";

const TILE_HEIGHT_PX = 56;
const TILE_MIN_WIDTH_PX = 40;
const TILE_MAX_WIDTH_PX = 100;
const THUMBNAIL_MAX_WIDTH_PX = 168;
const ACTIVE_CAPTURE_DELAYS_MS = [180, 520, 1050];

/** Downscale a stage capture so the per-page cache stays tiny. */
function downscaleDataUrl(dataUrl: string, maxWidth: number): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const scale = Math.min(1, maxWidth / Math.max(1, image.naturalWidth));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve("");
          return;
        }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      } catch {
        resolve("");
      }
    };
    image.onerror = () => resolve("");
    image.src = dataUrl;
  });
}

function backgroundPreviewStyle(background: PageBackground | undefined) {
  if (!background) return { backgroundColor: "#ffffff" };
  if (background.type === "image" && String(background.imageThumbnailUri || background.imageUri || "").trim()) {
    const uri = String(background.imageThumbnailUri || background.imageUri || "").trim();
    return {
      backgroundImage: `url("${uri.replace(/"/g, '\\"')}")`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  if (background.type === "gradient") {
    return {
      backgroundImage: `linear-gradient(135deg, ${background.gradientFrom || "#ffffff"}, ${background.gradientTo || "#f3f4f6"})`,
    };
  }
  return { backgroundColor: background.color || "#ffffff" };
}

interface PageMenuState {
  pageId: string;
  /** Viewport coords of the tile's top-center — the menu renders `position: fixed` above it, because the strip's overflow-x scroller clips absolutely-positioned children. */
  anchorX: number;
  anchorY: number;
}

interface DragOverState {
  pageId: string;
  position: "before" | "after";
}

export default function PageBar() {
  const pages = useEditorStore((state) => state.pages);
  const activePageId = useEditorStore((state) => state.activePageId);
  const pageThumbnails = useEditorStore((state) => state.pageThumbnails);
  const stageApi = useEditorStore((state) => state.stageApi);
  const setActivePageId = useEditorStore((state) => state.setActivePageId);
  const addPage = useEditorStore((state) => state.addPage);
  const duplicatePage = useEditorStore((state) => state.duplicatePage);
  const deletePage = useEditorStore((state) => state.deletePage);
  const reorderPages = useEditorStore((state) => state.reorderPages);
  const setPageThumbnail = useEditorStore((state) => state.setPageThumbnail);

  const [menu, setMenu] = useState<PageMenuState | null>(null);
  const [dragPageId, setDragPageId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<DragOverState | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const activePage = useMemo(
    () => pages.find((page) => page.id === activePageId) || pages[0] || null,
    [activePageId, pages]
  );

  const tileWidthPx = useMemo(() => {
    const width = Math.max(1, Number(activePage?.width) || 1080);
    const height = Math.max(1, Number(activePage?.height) || 1350);
    const ideal = Math.round((TILE_HEIGHT_PX * width) / height);
    return Math.max(TILE_MIN_WIDTH_PX, Math.min(TILE_MAX_WIDTH_PX, ideal));
  }, [activePage?.height, activePage?.width]);

  const captureActivePageThumbnail = useCallback(() => {
    if (!stageApi?.captureThumbnailDataUrl || !activePage) return;
    // A hidden tab pauses compositing, so a capture taken now is blank. These tiles are also
    // what a save ships to mobile as page previews, so caching a blank one would publish it.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const captured = String(stageApi.captureThumbnailDataUrl() || "").trim();
    if (!captured) return;
    const capturedPageId = activePage.id;
    void downscaleDataUrl(captured, THUMBNAIL_MAX_WIDTH_PX).then((small) => {
      if (small) setPageThumbnail(capturedPageId, small);
    });
  }, [activePage, setPageThumbnail, stageApi]);

  // Keep the active page's tile in sync with the live stage (same retry pattern
  // as the animation filmstrip: the stage settles asynchronously after edits).
  useEffect(() => {
    if (!stageApi?.captureThumbnailDataUrl || !activePage) return;

    let cancelled = false;
    const timeoutIds = ACTIVE_CAPTURE_DELAYS_MS.map((delay) =>
      window.setTimeout(() => {
        if (!cancelled) captureActivePageThumbnail();
      }, delay)
    );

    return () => {
      cancelled = true;
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [activePage, activePage?.background, activePage?.elements, captureActivePageThumbnail, stageApi]);

  // Keep the active tile visible while navigating.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const tile = scroller.querySelector<HTMLElement>(`[data-page-tile="${activePageId}"]`);
    tile?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  }, [activePageId, pages.length]);

  const handleSelectPage = useCallback(
    (pageId: string) => {
      if (pageId === activePageId) return;
      // Snapshot the outgoing page first so its tile stays fresh.
      captureActivePageThumbnail();
      setActivePageId(pageId);
    },
    [activePageId, captureActivePageThumbnail, setActivePageId]
  );

  const handleAddPage = useCallback(() => {
    captureActivePageThumbnail();
    const lastPage = pages[pages.length - 1];
    addPage(lastPage?.id);
  }, [addPage, captureActivePageThumbnail, pages]);

  const handleMenuAction = useCallback(
    (action: "duplicate" | "delete" | "moveLeft" | "moveRight", page: EditorPage) => {
      setMenu(null);
      const index = pages.findIndex((item) => item.id === page.id);
      if (action === "duplicate") {
        captureActivePageThumbnail();
        duplicatePage(page.id);
        return;
      }
      if (action === "delete") {
        deletePage(page.id);
        return;
      }
      if (action === "moveLeft" && index > 0) {
        reorderPages(page.id, pages[index - 1].id, "before");
        return;
      }
      if (action === "moveRight" && index >= 0 && index < pages.length - 1) {
        reorderPages(page.id, pages[index + 1].id, "after");
      }
    },
    [captureActivePageThumbnail, deletePage, duplicatePage, pages, reorderPages]
  );

  const handleDrop = useCallback(
    (targetId: string, position: "before" | "after") => {
      if (dragPageId && dragPageId !== targetId) {
        reorderPages(dragPageId, targetId, position);
      }
      setDragPageId(null);
      setDragOver(null);
    },
    [dragPageId, reorderPages]
  );

  return (
    <div className="border-t border-[#cbd1da] bg-[#eef1f5] px-3 py-2">
      <div
        ref={scrollerRef}
        className="flex items-start gap-2 overflow-x-auto pb-1"
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDragOver(null);
        }}
      >
        <div className="mx-auto flex items-start gap-2">
          {pages.map((page, index) => {
            const isActive = page.id === activePageId;
            const thumbnail = pageThumbnails[page.id] || "";
            const isMenuOpen = menu?.pageId === page.id;
            const isDropTarget = dragOver?.pageId === page.id && dragPageId && dragPageId !== page.id;
            return (
              <div key={page.id} className="relative flex flex-col items-center">
                <div
                  data-page-tile={page.id}
                  draggable
                  onDragStart={() => {
                    setMenu(null);
                    setDragPageId(page.id);
                  }}
                  onDragEnd={() => {
                    setDragPageId(null);
                    setDragOver(null);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setDragOver({
                      pageId: page.id,
                      position: event.clientX - rect.left > rect.width / 2 ? "after" : "before",
                    });
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    handleDrop(page.id, event.clientX - rect.left > rect.width / 2 ? "after" : "before");
                  }}
                  onClick={() => handleSelectPage(page.id)}
                  className={`group relative cursor-pointer overflow-hidden rounded-lg border-2 bg-white shadow-sm transition ${
                    isActive
                      ? "border-[#22828C] ring-2 ring-[#22828C]/25"
                      : "border-[#cad1db] hover:border-[#9aa8b6]"
                  } ${
                    isDropTarget
                      ? dragOver?.position === "after"
                        ? "border-r-4 border-r-[#22828C]"
                        : "border-l-4 border-l-[#22828C]"
                      : ""
                  }`}
                  style={{ width: `${tileWidthPx}px`, height: `${TILE_HEIGHT_PX}px` }}
                  role="button"
                  aria-label={`Go to page ${index + 1}`}
                >
                  {thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbnail}
                      alt=""
                      draggable={false}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full" style={backgroundPreviewStyle(page.background)} />
                  )}

                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (isMenuOpen) {
                        setMenu(null);
                        return;
                      }
                      const tile = event.currentTarget.closest<HTMLElement>("[data-page-tile]");
                      const rect = (tile || event.currentTarget).getBoundingClientRect();
                      setMenu({
                        pageId: page.id,
                        anchorX: rect.left + rect.width / 2,
                        anchorY: rect.top,
                      });
                    }}
                    className={`absolute right-0.5 top-0.5 rounded-md bg-white/90 p-0.5 text-[#4f5d72] shadow-sm transition hover:bg-white ${
                      isMenuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                    aria-label={`Page ${index + 1} actions`}
                  >
                    <MoreHorizontal size={13} />
                  </button>
                </div>

                <span
                  className={`mt-1 text-[10px] font-semibold tabular-nums ${
                    isActive ? "text-[#22828C]" : "text-[#8a93a6]"
                  }`}
                >
                  {index + 1}
                </span>

                {isMenuOpen && menu ? (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setMenu(null)}
                      aria-hidden="true"
                    />
                    <div
                      className="fixed z-50 w-40 -translate-x-1/2 -translate-y-full rounded-xl border border-[#cad1db] bg-white p-1 shadow-lg"
                      style={{ left: `${menu.anchorX}px`, top: `${menu.anchorY - 6}px` }}
                    >
                      <button
                        type="button"
                        onClick={() => handleMenuAction("duplicate", page)}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-medium text-[#1f2a39] hover:bg-[#eef1f5]"
                      >
                        <Copy size={13} /> Duplicate page
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMenuAction("moveLeft", page)}
                        disabled={index === 0}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-medium text-[#1f2a39] hover:bg-[#eef1f5] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span className="inline-block w-[13px] text-center">←</span> Move left
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMenuAction("moveRight", page)}
                        disabled={index === pages.length - 1}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-medium text-[#1f2a39] hover:bg-[#eef1f5] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span className="inline-block w-[13px] text-center">→</span> Move right
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMenuAction("delete", page)}
                        disabled={pages.length <= 1}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-medium text-[#c2410c] hover:bg-[#fef2f2] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 size={13} /> Delete page
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}

          <div className="flex flex-col items-center">
            <button
              type="button"
              onClick={handleAddPage}
              className="flex items-center justify-center rounded-lg border-2 border-dashed border-[#9aa8b6] bg-white/60 text-[#4f5d72] transition hover:border-[#22828C] hover:text-[#22828C]"
              style={{ width: `${tileWidthPx}px`, height: `${TILE_HEIGHT_PX}px` }}
              aria-label="Add page"
              title="Add page"
            >
              <Plus size={18} />
            </button>
            <span className="mt-1 text-[10px] font-semibold text-transparent">+</span>
          </div>
        </div>
      </div>
    </div>
  );
}
