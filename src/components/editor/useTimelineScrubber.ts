"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface TimelineScrubberBounds {
  left: number;
  width: number;
}

interface ScrubSessionState {
  pointerId: number | null;
  initialClientX: number;
  initialTime: number;
}

interface UseTimelineScrubberOptions {
  totalDurationMs: number;
  contentWidthPx: number;
  deadZonePx?: number;
  snapMs?: number | null;
  invertDirection?: boolean;
  clampMin?: number;
  clampMax?: number;
  getBounds: () => TimelineScrubberBounds | null;
  getCurrentTime: () => number;
  onCommit: (time: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function useTimelineScrubber({
  totalDurationMs,
  contentWidthPx,
  deadZonePx = 2,
  snapMs = null,
  invertDirection = true,
  clampMin = 0,
  clampMax,
  getBounds,
  getCurrentTime,
  onCommit,
  onStart,
  onEnd,
}: UseTimelineScrubberOptions) {
  const sessionRef = useRef<ScrubSessionState | null>(null);
  const pendingClientXRef = useRef<number | null>(null);
  const scrubRafRef = useRef<number | null>(null);
  const lastCommittedTimeRef = useRef<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [activePointerId, setActivePointerId] = useState<number | null>(null);

  const safeClampMax = Number.isFinite(clampMax) ? Number(clampMax) : totalDurationMs;

  const getScrubTimeFromPointer = useCallback(
    (clientX: number) => {
      const bounds = getBounds();
      if (!bounds || bounds.width <= 0 || contentWidthPx <= 0 || totalDurationMs <= 0) {
        return null;
      }

      const session = sessionRef.current;
      const rawTime = session
        ? (() => {
            const rawDeltaPx = clientX - session.initialClientX;
            if (Math.abs(rawDeltaPx) <= deadZonePx) return session.initialTime;
            const directionalDeltaPx =
              rawDeltaPx - Math.sign(rawDeltaPx) * deadZonePx;
            const deltaMs = (directionalDeltaPx / contentWidthPx) * totalDurationMs;
            return invertDirection ? session.initialTime - deltaMs : session.initialTime + deltaMs;
          })()
        : (() => {
            const progress = clamp((clientX - bounds.left) / bounds.width, 0, 1);
            return (invertDirection ? 1 - progress : progress) * totalDurationMs;
          })();

      const snappedTime =
        Number.isFinite(Number(snapMs)) && Number(snapMs) > 0
          ? Math.round(rawTime / Number(snapMs)) * Number(snapMs)
          : rawTime;

      return clamp(snappedTime, clampMin, safeClampMax);
    },
    [clampMin, contentWidthPx, deadZonePx, getBounds, invertDirection, safeClampMax, snapMs, totalDurationMs]
  );

  const commitScrubTime = useCallback(
    (targetTime: number | null) => {
      if (!Number.isFinite(targetTime as number)) return;
      const safeTime = clamp(Number(targetTime), clampMin, safeClampMax);
      const threshold =
        Number.isFinite(Number(snapMs)) && Number(snapMs) > 0 ? Math.max(0.001, Number(snapMs) / 2) : 0.001;
      if (
        lastCommittedTimeRef.current !== null &&
        Math.abs(lastCommittedTimeRef.current - safeTime) < threshold
      ) {
        return;
      }
      lastCommittedTimeRef.current = safeTime;
      onCommit(safeTime);
    },
    [clampMin, onCommit, safeClampMax, snapMs]
  );

  const flushPendingScrub = useCallback(() => {
    const pendingClientX = pendingClientXRef.current;
    pendingClientXRef.current = null;
    if (pendingClientX === null) return;
    commitScrubTime(getScrubTimeFromPointer(pendingClientX));
  }, [commitScrubTime, getScrubTimeFromPointer]);

  const requestScrubUpdate = useCallback(
    (clientX: number) => {
      pendingClientXRef.current = clientX;
      if (scrubRafRef.current !== null) return;
      scrubRafRef.current = window.requestAnimationFrame(() => {
        scrubRafRef.current = null;
        flushPendingScrub();
      });
    },
    [flushPendingScrub]
  );

  const startScrubbing = useCallback(
    (clientX: number, pointerId: number | null) => {
      sessionRef.current = {
        pointerId,
        initialClientX: clientX,
        initialTime: getCurrentTime(),
      };
      setActivePointerId(pointerId);
      setIsScrubbing(true);
      onStart?.();
    },
    [getCurrentTime, onStart]
  );

  const updateScrubbing = useCallback(
    (clientX: number) => {
      if (!sessionRef.current) return;
      requestScrubUpdate(clientX);
    },
    [requestScrubUpdate]
  );

  const endScrubbing = useCallback(() => {
    if (!sessionRef.current) return;
    if (scrubRafRef.current !== null) {
      window.cancelAnimationFrame(scrubRafRef.current);
      scrubRafRef.current = null;
    }
    flushPendingScrub();
    pendingClientXRef.current = null;
    lastCommittedTimeRef.current = null;
    sessionRef.current = null;
    setActivePointerId(null);
    setIsScrubbing(false);
    onEnd?.();
  }, [flushPendingScrub, onEnd]);

  useEffect(
    () => () => {
      if (scrubRafRef.current !== null) {
        window.cancelAnimationFrame(scrubRafRef.current);
        scrubRafRef.current = null;
      }
      pendingClientXRef.current = null;
      lastCommittedTimeRef.current = null;
      sessionRef.current = null;
      setActivePointerId(null);
    },
    []
  );

  return {
    isScrubbing,
    activePointerId,
    startScrubbing,
    updateScrubbing,
    endScrubbing,
  };
}
