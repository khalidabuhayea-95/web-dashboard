/**
 * Encodes template preview frames that are rendered one at a time rather than in real time.
 *
 * The live recorder pipes the export canvas into a MediaRecorder, which stamps every frame with
 * the wall clock and only receives frames while the page paints. A background tab never paints,
 * so the frame-by-frame recorder (CanvasEditor) renders each frame itself and hands it here with
 * an explicit index. The result goes to /api/editor/media/encode-preview like the live recording
 * does: a VP8 stream in an IVF file when the browser has WebCodecs, otherwise a JPEG per frame
 * (the encoder's frame-sequence input).
 */

export type PreviewFrameSinkResult =
  | { kind: "video"; file: File; fps: number }
  | { kind: "frames"; files: File[]; fps: number };

export interface PreviewFrameSink {
  /** Encode [source] as frame [index] (0-based, at the sink's fps). */
  add: (source: HTMLCanvasElement, index: number) => Promise<void>;
  finish: () => Promise<PreviewFrameSinkResult>;
  /** Release the encoder; safe after finish() and after a failure. */
  close: () => void;
}

export interface IvfFrame {
  data: Uint8Array;
  /** Presentation time in timebase units (1/fps), i.e. the frame index. */
  pts: number;
}

/**
 * An IVF file (the container libvpx and ffmpeg use for raw VP8/VP9): a 32-byte header, then each
 * frame as a 12-byte header — size, then a 64-bit timestamp — followed by its bytes. The timebase
 * is 1/fps, so a frame's timestamp is simply its index and ffmpeg reads exact timing back.
 */
export function buildIvfFile(
  frames: IvfFrame[],
  { width, height, fps, fourcc = "VP80" }: { width: number; height: number; fps: number; fourcc?: string }
): Blob {
  const header = new ArrayBuffer(32);
  const view = new DataView(header);
  const writeTag = (offset: number, tag: string) => {
    for (let index = 0; index < 4; index += 1) view.setUint8(offset + index, tag.charCodeAt(index) || 0x20);
  };
  writeTag(0, "DKIF");
  view.setUint16(4, 0, true); // version
  view.setUint16(6, 32, true); // header length
  writeTag(8, fourcc);
  view.setUint16(12, width, true);
  view.setUint16(14, height, true);
  view.setUint32(16, Math.max(1, Math.round(fps)), true); // timebase denominator
  view.setUint32(20, 1, true); // timebase numerator
  view.setUint32(24, frames.length, true);
  view.setUint32(28, 0, true);

  const parts: BlobPart[] = [header];
  for (const frame of frames) {
    const frameHeader = new ArrayBuffer(12);
    const frameView = new DataView(frameHeader);
    const pts = Math.max(0, Math.round(frame.pts));
    frameView.setUint32(0, frame.data.byteLength, true);
    frameView.setUint32(4, pts % 0x1_0000_0000, true);
    frameView.setUint32(8, Math.floor(pts / 0x1_0000_0000), true);
    parts.push(frameHeader, frame.data as Uint8Array<ArrayBuffer>);
  }
  return new Blob(parts, { type: "video/x-ivf" });
}

function createVp8PreviewSink(
  config: VideoEncoderConfig,
  fps: number,
  waitForEncoder: () => Promise<void>
): PreviewFrameSink {
  const frames: IvfFrame[] = [];
  let failure: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      frames.push({ data, pts: Math.round((chunk.timestamp * fps) / 1_000_000) });
    },
    error: (error) => {
      failure = error instanceof Error ? error : new Error(String(error || "Preview encoder failed."));
    },
  });
  encoder.configure(config);
  // VP8 wants even dimensions; the export canvas can be a pixel off, so frames go through a canvas
  // of exactly the configured size.
  const scratch = document.createElement("canvas");
  scratch.width = config.width;
  scratch.height = config.height;
  const context = scratch.getContext("2d");
  const frameDurationUs = Math.round(1_000_000 / fps);
  const keyFrameInterval = Math.max(1, Math.round(fps * 2));

  return {
    async add(source, index) {
      if (failure) throw failure;
      if (!context) throw new Error("Preview frame canvas is unavailable.");
      // Rendering can outrun a software encoder; keep its queue short instead of buffering raw
      // frames for the whole template.
      while (encoder.encodeQueueSize > 4) {
        await waitForEncoder();
        if (failure) throw failure;
      }
      context.clearRect(0, 0, scratch.width, scratch.height);
      context.drawImage(source, 0, 0);
      const frame = new VideoFrame(scratch, {
        timestamp: index * frameDurationUs,
        duration: frameDurationUs,
        alpha: "discard",
      });
      try {
        encoder.encode(frame, { keyFrame: index % keyFrameInterval === 0 });
      } finally {
        frame.close();
      }
    },
    async finish() {
      if (failure) throw failure;
      await encoder.flush();
      if (failure) throw failure;
      encoder.close();
      frames.sort((left, right) => left.pts - right.pts);
      const blob = buildIvfFile(frames, { width: config.width, height: config.height, fps });
      return {
        kind: "video",
        file: new File([blob], "preview-source.ivf", { type: "video/x-ivf" }),
        fps,
      };
    },
    close() {
      if (encoder.state !== "closed") {
        try {
          encoder.close();
        } catch {
          // Already closed by an encoder error.
        }
      }
    },
  };
}

function createJpegPreviewSink(fps: number): PreviewFrameSink {
  const files: File[] = [];
  return {
    async add(source, index) {
      const blob = await new Promise<Blob | null>((resolve) => source.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob) throw new Error("Unable to capture a preview frame.");
      // The encoder sorts frames by name, so the index is zero-padded.
      files[index] = new File([blob], `frame-${String(index + 1).padStart(6, "0")}.jpg`, { type: "image/jpeg" });
    },
    async finish() {
      return { kind: "frames", files: files.filter(Boolean), fps };
    },
    close() {},
  };
}

/**
 * A sink for [width]×[height] frames at [fps]. [waitForEncoder] yields while the encoder drains;
 * pass a wait that keeps ticking in a background tab (main-thread timers are throttled there).
 */
export async function createPreviewFrameSink({
  width,
  height,
  fps,
  waitForEncoder,
}: {
  width: number;
  height: number;
  fps: number;
  waitForEncoder: () => Promise<void>;
}): Promise<PreviewFrameSink> {
  const safeFps = Math.max(1, Math.round(fps));
  if (typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined") {
    const config: VideoEncoderConfig = {
      codec: "vp8",
      width: Math.max(2, Math.floor(width / 2) * 2),
      height: Math.max(2, Math.floor(height / 2) * 2),
      // Generous: the server re-encodes to H.264 anyway, so this only has to survive one hop.
      bitrate: 12_000_000,
      framerate: safeFps,
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) return createVp8PreviewSink(config, safeFps, waitForEncoder);
    } catch {
      // Fall through to JPEG frames.
    }
  }
  return createJpegPreviewSink(safeFps);
}
