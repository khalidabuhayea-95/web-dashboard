"use client";

import { ZoomIn, ZoomOut } from "lucide-react";

import { useEditorStore } from "@/store/editorStore";

export default function PagesTimeline() {
  const zoomPercent = useEditorStore((state) => state.zoomPercent);
  const stageApi = useEditorStore((state) => state.stageApi);

  return (
    <div className="relative border-t border-[#cbd1da] bg-[#eceef1] px-3 py-1.5">
      <div className="flex items-center justify-center">
        <div className="flex items-center gap-2 rounded-md border border-[#cad1db] bg-white px-2 py-1 text-[#334155]">
          <button type="button" onClick={() => stageApi?.zoomOut()} className="rounded p-1 hover:bg-[#eef2f8]">
            <ZoomOut size={14} />
          </button>
          <span className="min-w-10 text-center text-[13px] font-semibold">{zoomPercent}%</span>
          <button type="button" onClick={() => stageApi?.zoomIn()} className="rounded p-1 hover:bg-[#eef2f8]">
            <ZoomIn size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
