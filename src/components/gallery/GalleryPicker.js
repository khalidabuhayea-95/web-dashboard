"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";

// Reusable picker over the internal gallery (/api/admin/gallery). Opens as a
// modal grid; picking an image calls onSelect(image) and closes. Uploading
// here adds to the library and selects the new image in one step, so "use a
// photo I have on my machine" never needs a detour through the Gallery tab.
export default function GalleryPicker({ open, onClose, onSelect, title = "Choose from gallery" }) {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

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
    if (open) fetchImages();
  }, [open, fetchImages]);

  const uploadAndSelect = async (file) => {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/admin/gallery", { method: "POST", body: formData });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error || `Upload failed (${response.status}).`);
      }
      onSelect(payload.image);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={uploading ? undefined : onClose}
      className="max-h-[85vh] w-[min(720px,92vw)] overflow-y-auto"
      backdropClassName="z-[60]"
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <label className={`btn btn-secondary ${uploading ? "pointer-events-none opacity-60" : "cursor-pointer"}`}>
            {uploading ? "Uploading…" : "Upload new"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                uploadAndSelect(file);
              }}
            />
          </label>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {!loading && !images.length ? (
          <p className="text-sm text-muted-foreground">
            The gallery is empty — upload an image here, or add some in the Gallery tab.
          </p>
        ) : null}

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {images.map((image) => (
            <button
              key={image.id}
              type="button"
              onClick={() => onSelect(image)}
              className="group overflow-hidden rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              title={image.name || undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={image.name || "Gallery image"}
                loading="lazy"
                className="aspect-square w-full object-cover transition-transform group-hover:scale-105"
              />
            </button>
          ))}
        </div>

        <div className="flex justify-end">
          <Button variant="ghost" type="button" onClick={onClose} disabled={uploading}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
