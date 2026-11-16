"use client";

import { useCallback, useEffect, useState } from "react";
import { Images } from "lucide-react";
import { Button, Card, CardContent, ImageLightbox } from "@/components/ui";

const formatSize = (bytes) => {
  if (!bytes) return "";
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
};

export default function GalleryClient() {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(0);
  const [deleting, setDeleting] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [zoomSrc, setZoomSrc] = useState(null);

  const fetchImages = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/gallery");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error || `Failed to load the gallery (${response.status}).`);
      }
      setImages(payload.images || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  // Files upload one by one so a single bad file fails alone, not the batch.
  const uploadFiles = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setError("");
    setNotice("");
    setUploading(list.length);
    let done = 0;
    const failures = [];
    for (const file of list) {
      try {
        const formData = new FormData();
        formData.set("file", file);
        const response = await fetch("/api/admin/gallery", { method: "POST", body: formData });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) {
          throw new Error(payload?.error || `Upload failed (${response.status}).`);
        }
        setImages((current) => [payload.image, ...current]);
        done += 1;
      } catch (uploadError) {
        failures.push(`${file.name}: ${uploadError.message}`);
      } finally {
        setUploading((current) => Math.max(0, current - 1));
      }
    }
    if (done) setNotice(`Uploaded ${done} image${done === 1 ? "" : "s"}.`);
    if (failures.length) setError(failures.join(" · "));
  };

  const deleteImage = async (image) => {
    if (!window.confirm(`Delete “${image.name || "this image"}” from the gallery?`)) return;
    setDeleting(image.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/gallery/${image.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error || `Delete failed (${response.status}).`);
      }
      setImages((current) => current.filter((item) => item.id !== image.id));
      setNotice("Image deleted. Templates that already used it keep their own copy.");
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setDeleting("");
    }
  };

  const copyUrl = async (image) => {
    try {
      await navigator.clipboard.writeText(image.url);
      setNotice("Image URL copied.");
    } catch (_error) {
      setError("Could not copy — your browser blocked clipboard access.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Images className="h-6 w-6 text-primary" aria-hidden="true" />
            Gallery
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Internal image library. Upload once, reuse anywhere — currently the source for AI
            template before-photos.
          </p>
        </div>
        <label className={`btn btn-primary ${uploading ? "pointer-events-none opacity-60" : "cursor-pointer"}`}>
          {uploading ? `Uploading ${uploading}…` : "Upload images"}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={Boolean(uploading)}
            onChange={(event) => {
              const files = event.target.files;
              const selection = files ? Array.from(files) : [];
              event.target.value = "";
              uploadFiles(selection);
            }}
          />
        </label>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Loading gallery…</p> : null}

      {!loading && !images.length ? (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Nothing here yet — upload your first images with the button above.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {images.map((image) => (
          <div key={image.id} className="rounded-xl border bg-card p-2.5">
            <button
              type="button"
              className="block w-full cursor-zoom-in"
              onClick={() => setZoomSrc(image.url)}
              aria-label={`Zoom ${image.name || "gallery image"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={image.name || "Gallery image"}
                loading="lazy"
                className="aspect-square w-full rounded-lg object-cover"
              />
            </button>
            <div className="mt-2 truncate text-xs font-medium" title={image.name}>
              {image.name || "Untitled"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {image.width && image.height ? `${image.width}×${image.height}` : ""}
              {image.sizeBytes ? ` · ${formatSize(image.sizeBytes)}` : ""}
            </div>
            <div className="mt-2 flex items-center justify-between gap-1.5">
              <Button variant="ghost" onClick={() => copyUrl(image)}>
                Copy URL
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteImage(image)}
                disabled={Boolean(deleting)}
              >
                {deleting === image.id ? "…" : "Delete"}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <ImageLightbox src={zoomSrc} onClose={() => setZoomSrc(null)} />
    </div>
  );
}
