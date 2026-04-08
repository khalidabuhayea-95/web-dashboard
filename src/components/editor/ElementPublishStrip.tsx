"use client";

import { CheckSquare2, Image as ImageIcon, Square, Sparkles } from "lucide-react";
import { useMemo } from "react";

import { getPublishablePageElements } from "@/lib/editor/publishableElements";
import { useEditorStore } from "@/store/editorStore";

export default function ElementPublishStrip() {
  const pages = useEditorStore((state) => state.pages);
  const activePageId = useEditorStore((state) => state.activePageId);
  const publishCandidateIds = useEditorStore((state) => state.publishCandidateIds);
  const setPublishCandidateIds = useEditorStore((state) => state.setPublishCandidateIds);
  const togglePublishCandidate = useEditorStore((state) => state.togglePublishCandidate);

  const activePage = useMemo(
    () => pages.find((page) => page.id === activePageId) || pages[0] || null,
    [activePageId, pages]
  );
  const publishableElements = useMemo(() => getPublishablePageElements(activePage), [activePage]);
  const selectedSet = useMemo(() => new Set(publishCandidateIds), [publishCandidateIds]);

  const allSelected = publishableElements.length > 0 && publishableElements.every((element) => selectedSet.has(element.id));

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#64748b]">
          Publish to Elements
        </div>
        <span className="h-1 w-1 rounded-full bg-[#cbd5e1]" />
        <div className="text-xs text-[#475569]">
          {publishCandidateIds.length > 0 ? `${publishCandidateIds.length} selected` : `${publishableElements.length} reusable images`}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1 rounded-md border border-[#d3d8e1] bg-white px-2 text-[12px] font-medium text-[#334155] hover:bg-[#f8fafc]"
          onClick={() => {
            if (allSelected) {
              setPublishCandidateIds([]);
            } else {
              setPublishCandidateIds(publishableElements.map((element) => element.id));
            }
          }}
          disabled={publishableElements.length === 0}
        >
          {allSelected ? <CheckSquare2 size={14} /> : <Square size={14} />}
          {allSelected ? "Clear" : "Select all"}
        </button>
      </div>

      <div className="min-w-0 flex-1 overflow-x-auto">
        {publishableElements.length === 0 ? (
          <div className="flex h-14 items-center rounded-lg border border-dashed border-[#cbd5e1] bg-white/70 px-3 text-xs text-[#64748b]">
            No reusable image elements on this page.
          </div>
        ) : (
          <div className="flex items-stretch gap-2 pb-1">
            {publishableElements.map((element) => {
              const isSelected = selectedSet.has(element.id);
              const previewSrc = String(element.src || element.rasterOriginalSrc || "").trim();
              return (
                <button
                  key={element.id}
                  type="button"
                  onClick={() => togglePublishCandidate(element.id)}
                  className={[
                    "group flex h-16 w-[172px] shrink-0 items-center gap-2 rounded-xl border bg-white px-2.5 text-left transition",
                    isSelected
                      ? "border-[#2563eb] bg-[#eff6ff] shadow-[inset_0_0_0_1px_rgba(37,99,235,0.12)]"
                      : "border-[#d5dbe5] hover:border-[#94a3b8] hover:bg-[#f8fafc]",
                  ].join(" ")}
                >
                  <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#d8dee8] bg-[#f8fafc]">
                    {previewSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previewSrc} alt={element.name || "Image"} className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon size={16} className="text-[#94a3b8]" />
                    )}
                    <span className="absolute right-1 top-1 rounded-full bg-white/90 p-[2px] text-[#1d4ed8] shadow-sm">
                      {isSelected ? <CheckSquare2 size={11} /> : <Square size={11} />}
                    </span>
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-[#1e293b]">{element.name || "Image"}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-[11px] text-[#64748b]">
                      <Sparkles size={11} />
                      Image layer
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
