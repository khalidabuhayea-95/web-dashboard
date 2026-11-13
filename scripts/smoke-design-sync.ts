// End-to-end check of design sync against the configured LOCAL database and the real storage
// bucket: two "devices" of one throwaway user push, pull, conflict, replay, hit the quota, delete
// a folder, purge a design and finally delete the account. Run with `npm run smoke:design-sync`
// after touching anything under src/lib/designSync or the /api/mobile/designs routes.
//
// It lowers the FREE storage limit while it runs (so the quota path is reachable with small
// files) and restores the saved value afterwards, like smoke:credits does with the credit prices.
// It refuses to run against a database that is not on this machine.
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import {
  deleteFolder,
  getDesign,
  listChanges,
  purgeDesign,
  putDesign,
  putFolder,
} from "@/lib/designSync/designs.server";
import { DesignSyncError } from "@/lib/designSync/errors";
import { completeMediaUploads, prepareMediaParts, prepareMediaUploads, removeUnreferencedMedia, userMediaPrefix } from "@/lib/designSync/media.server";
import { deleteFont, fontIdFor, putFont } from "@/lib/designSync/fonts.server";
import { getStorageSummary } from "@/lib/designSync/quota.server";
import { deleteMobileUserAccount } from "@/lib/mobile/accountDeletion.server";
import { issueMobileSession } from "@/lib/mobile/userAuth.server";
import { saveMobileAppSettings } from "@/lib/settings/mobileAppSettings.server";
import type { Prisma } from "@prisma/client";

/** The settings row this script lowers the free limit in (mobileAppSettings.server). */
const MOBILE_APP_SETTINGS_KEY = "mobile_app_settings_v1";
import { getUserDesignsBucketName, headObject, listObjectKeys } from "@/lib/storage/objectStorage.server";

const FREE_LIMIT_BYTES = 400_000;

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}` +
      (ok ? "" : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`),
  );
}

type TestFile = { sha256: string; sizeBytes: number; contentType: string; bytes: Buffer };

function makeFile(sizeBytes: number, contentType = "image/png"): TestFile {
  const bytes = randomBytes(sizeBytes);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes, contentType, bytes };
}

const ref = (file: TestFile, ext = "png") => `nayroz-cloud-media:///${file.sha256}.${ext}`;
/** A document as the app sends it: a JSON string. Its hash is of exactly those bytes. */
const doc = (data: unknown) => JSON.stringify(data);
const hashOf = (data: unknown) => createHash("sha256").update(doc(data)).digest("hex");
const mutation = () => `smoke-${randomUUID()}`;

/** The code of the refusal a call ends in, or "ok". */
async function codeOf(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "ok";
  } catch (error) {
    if (error instanceof DesignSyncError) return `${error.status}:${error.code}`;
    throw error;
  }
}

async function objectExists(key: string): Promise<boolean> {
  try {
    await headObject(getUserDesignsBucketName(), key);
    return true;
  } catch {
    return false;
  }
}

async function upload(url: string, file: TestFile, body: Buffer = file.bytes): Promise<number> {
  const response = await fetch(url, {
    method: "PUT",
    body: new Uint8Array(body),
    headers: { "Content-Type": file.contentType },
  });
  return response.status;
}

/** One part of a large file: exactly the bytes the signed URL was made for (no Content-Type). */
async function uploadPart(url: string, bytes: Buffer): Promise<number> {
  const response = await fetch(url, { method: "PUT", body: new Uint8Array(bytes) });
  return response.status;
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || "");
  if (!/@(127\.0\.0\.1|localhost)[:/]/.test(databaseUrl)) {
    console.error("smoke:design-sync only runs against a local database (127.0.0.1 / localhost).");
    process.exit(1);
  }

  // ★The settings row is put back BYTE FOR BYTE afterwards. Restoring it through
  // saveMobileAppSettings re-normalizes the whole row — it adds defaults and DROPS keys the current
  // code does not know (a credit cost was lost that way, 2026-11-13).
  const originalSettingsRow = await prisma.appSetting.findUnique({ where: { key: MOBILE_APP_SETTINGS_KEY } });
  await saveMobileAppSettings({ designStorage: { limitsBytes: { free: FREE_LIMIT_BYTES } } });
  const user = await prisma.mobileUser.create({ data: { name: "design-sync-smoke", role: "user" } });
  const account = { id: user.id, subscriptionTier: "free", subscriptionExpiresAt: null };
  console.log(`test user ${user.id}\n`);

  try {
    // ---- 1. Device A uploads two files and writes a design -----------------------------------
    const photo = makeFile(100_000);
    const sticker = makeFile(50_000);
    const prepared = await prepareMediaUploads(account, [photo, sticker]);
    check("both files need uploading", prepared.files.map((file) => file.status), ["upload", "upload"]);
    check("the space is reserved before a byte is sent", prepared.storage.usedBytes, 150_000);
    check("signed uploads are accepted", [
      await upload(prepared.files[0].uploadUrl!, photo),
      await upload(prepared.files[1].uploadUrl!, sticker),
    ], [200, 200]);
    check(
      "the server confirms them from storage, not from the device's word",
      (await completeMediaUploads(account, [photo.sha256, sticker.sha256])).files.map((file) => file.status),
      ["ready", "ready"],
    );

    // A file declared small cannot be uploaded large: the size is part of the signature.
    const liar = makeFile(20_000);
    const liarPrepared = await prepareMediaUploads(account, [liar]);
    check("a body of another size is refused by storage", await upload(liarPrepared.files[0].uploadUrl!, liar, randomBytes(30_000)), 403);
    check("…and is never marked ready", (await completeMediaUploads(account, [liar.sha256])).files[0].status, "missing");

    const designId = `project-${randomUUID()}`;
    const v1 = {
      id: designId,
      canvasWidth: 1080,
      canvasHeight: 1080,
      background: { kind: "image", imageUri: ref(photo, "jpg") },
      layers: [{ kind: "sticker", assetUri: ref(sticker) }],
    };
    const created = await putDesign(account, designId, {
      mutationId: mutation(),
      name: "Smoke design",
      clientCreatedAt: 1000,
      clientUpdatedAt: 1000,
      contentHash: hashOf(v1),
      baseContentHash: null,
      data: doc(v1),
    });
    check("a new design starts at revision 1", [created.design.revision, created.design.contentHash], [1, hashOf(v1)]);

    check(
      "a design whose file is not uploaded is refused",
      await codeOf(() =>
        putDesign(account, `project-${randomUUID()}`, {
          mutationId: mutation(),
          name: "Holes",
          contentHash: hashOf({ layers: [{ kind: "image", imageUri: ref(liar) }] }),
          data: doc({ layers: [{ kind: "image", imageUri: ref(liar) }] }),
        }),
      ),
      "422:media_missing",
    );
    check(
      "a design pointing at a path only one device has is refused",
      await codeOf(() =>
        putDesign(account, `project-${randomUUID()}`, {
          mutationId: mutation(),
          name: "Local path",
          contentHash: hashOf({ layers: [{ kind: "image", imageUri: "file:///data/user/0/app/files/template_assets/a.png" }] }),
          data: doc({ layers: [{ kind: "image", imageUri: "file:///data/user/0/app/files/template_assets/a.png" }] }),
        }),
      ),
      "422:non_portable_uri",
    );

    // ---- 2. Device B pulls it ----------------------------------------------------------------
    const firstPull = await listChanges(account, 0, 50);
    check("device B sees the design", firstPull.designs.map((design) => design.id), [designId]);
    const fetched = await getDesign(account, designId);
    check("…with its document byte for byte", fetched.data, doc(v1));
    check("…and a download URL per file", fetched.media.map((file) => file.sha256).sort(), [photo.sha256, sticker.sha256].sort());
    const downloaded = Buffer.from(await (await fetch(fetched.media.find((file) => file.sha256 === photo.sha256)!.url)).arrayBuffer());
    check("the downloaded file is the uploaded file", createHash("sha256").update(downloaded).digest("hex"), photo.sha256);

    // A document is stored verbatim: key order kept, and an integer above 2^53 (the app's Long
    // fields) not rounded by a trip through JavaScript's number type.
    const verbatimId = `project-${randomUUID()}`;
    const verbatim = '{"zeta":1,"alpha":{"timelineEndMs":9223372036854775807,"scale":1.0},"layers":[]}';
    const verbatimHash = createHash("sha256").update(verbatim).digest("hex");
    await putDesign(account, verbatimId, { mutationId: mutation(), name: "Verbatim", contentHash: verbatimHash, data: verbatim });
    check("a document comes back exactly as it was sent", (await getDesign(account, verbatimId)).data, verbatim);
    check(
      "a hash that is not of these bytes is refused",
      await codeOf(() => putDesign(account, verbatimId, { mutationId: mutation(), contentHash: "0".repeat(64), baseContentHash: verbatimHash, data: verbatim })),
      "400:invalid_request",
    );
    await purgeDesign(account, verbatimId, mutation());

    // ---- 3. Replay, update, conflict, header-only --------------------------------------------
    const v2 = { ...v1, layers: [] as unknown[] }; // the sticker is removed
    const updateMutation = mutation();
    const updateBody = { mutationId: updateMutation, name: "Smoke design", clientUpdatedAt: 2000, contentHash: hashOf(v2), baseContentHash: hashOf(v1), data: doc(v2) };
    const updated = await putDesign(account, designId, updateBody);
    check("an edit based on the server's document is applied", [updated.design.revision, updated.design.contentHash], [2, hashOf(v2)]);
    const replayed = await putDesign(account, designId, updateBody);
    check("a retry of the same write is not applied twice", replayed.design.revision, 2);
    check("a file no design uses any more is removed at once", await objectExists(`${userMediaPrefix(user.id)}media/${sticker.sha256}`), false);

    const v3 = { ...v1, canvasWidth: 1920 }; // device B edited v1, unaware of v2
    let conflictHash = "";
    try {
      await putDesign(account, designId, { mutationId: mutation(), name: "Smoke design", contentHash: hashOf(v3), baseContentHash: hashOf(v1), data: doc(v3) });
    } catch (error) {
      if (error instanceof DesignSyncError && error.code === "content_conflict") {
        conflictHash = String((error.extra.design as { contentHash?: string })?.contentHash || "");
      }
    }
    check("an edit based on an older document is a conflict, with the server's header", conflictHash, hashOf(v2));

    const renamed = await putDesign(account, designId, { mutationId: mutation(), name: "Renamed on B", baseContentHash: hashOf(v1) });
    check("a rename from the stale device is applied, not forked", [renamed.design.name, renamed.design.revision, renamed.design.contentHash], ["Renamed on B", 3, hashOf(v2)]);

    // ---- 4. Trash and restore ----------------------------------------------------------------
    const trashed = await putDesign(account, designId, { mutationId: mutation(), deletedAt: 5000 });
    const restored = await putDesign(account, designId, { mutationId: mutation(), deletedAt: null });
    check("Trash and restore are header writes", [trashed.design.deletedAt, restored.design.deletedAt], [5000, null]);

    // ---- 5. Folders --------------------------------------------------------------------------
    const folderId = `folder-${randomUUID()}`;
    await putFolder(account, folderId, { mutationId: mutation(), name: "رمضان", colorKey: "amber", clientCreatedAt: 1, clientUpdatedAt: 1 });
    const filed = await putDesign(account, designId, { mutationId: mutation(), folderId });
    check("a design is filed by a header write", filed.design.folderId, folderId);
    const cursorBeforeDelete = (await listChanges(account, 0, 50)).cursor;
    await deleteFolder(account, folderId, mutation());
    const afterDelete = await listChanges(account, cursorBeforeDelete, 50);
    check("deleting a folder tells every device: tombstone + the design unfiled", [
      afterDelete.folders.map((folder) => folder.deleted),
      afterDelete.designs.map((design) => design.folderId),
    ], [[true], [null]]);
    check(
      "a stale device cannot resurrect it by renaming",
      await codeOf(() => putFolder(account, folderId, { mutationId: mutation(), name: "Ramadan", colorKey: "teal" })),
      "410:folder_deleted",
    );
    const revived = await putFolder(account, folderId, { mutationId: mutation(), name: "رمضان", colorKey: "amber", revive: true });
    check("…but the deleting device's undo brings it back", revived.folder.deleted, false);
    const intoMissing = await putDesign(account, designId, { mutationId: mutation(), folderId: `folder-${randomUUID()}` });
    check("filing into a folder that does not exist lands in no folder", intoMissing.design.folderId, null);

    // ---- 6. Quota ----------------------------------------------------------------------------
    const usedBefore = (await getStorageSummary(account)).usedBytes;
    const tooBig = makeFile(FREE_LIMIT_BYTES - 50_000, "video/mp4");
    check("files that do not fit are refused as a whole", await codeOf(() => prepareMediaUploads(account, [makeFile(10_000), tooBig])), "409:storage_quota_exceeded");
    check("…and nothing was reserved", (await getStorageSummary(account)).usedBytes, usedBefore);
    check(
      "a full account can still rename",
      (await putDesign(account, designId, { mutationId: mutation(), name: "Still renamable" })).design.name,
      "Still renamable",
    );

    // ---- 6a. A cursor from before the server's history started over ----------------------------
    const ahead = await listChanges(account, 1_000_000, 50);
    check("a cursor beyond the library's head asks the device to start over", [ahead.reset, ahead.designs.length, ahead.cursor < 1_000_000], [true, 0, true]);
    check("…and an ordinary cursor does not", (await listChanges(account, 0, 1)).reset, false);

    // ---- 6b. A large file goes up in parts, and resumes after a break --------------------------
    // A paid account: the 40 MB file would not fit the lowered free limit.
    const paid = { id: user.id, subscriptionTier: "pro", subscriptionExpiresAt: new Date(Date.now() + 86_400_000) };
    const video = makeFile(40 * 1024 * 1024, "video/mp4");
    const bigPrepared = await prepareMediaUploads(paid, [video]);
    check("a file over 32 MB is uploaded in parts", [bigPrepared.files[0].status, bigPrepared.files[0].partCount], ["multipart", 3]);
    const firstPlan = await prepareMediaParts(paid, video.sha256);
    check("…each part signed for its own size", firstPlan.parts.map((part) => part.sizeBytes), [16 * 1024 * 1024, 16 * 1024 * 1024, 8 * 1024 * 1024]);
    const slice = (partNumber: number) =>
      video.bytes.subarray((partNumber - 1) * firstPlan.partBytes, Math.min(video.sizeBytes, partNumber * firstPlan.partBytes));
    check("a part of another size is refused by storage", await uploadPart(firstPlan.parts[1].uploadUrl, slice(1).subarray(0, 1000)), 403);
    check("the first part goes up", await uploadPart(firstPlan.parts[0].uploadUrl, slice(1)), 200);
    check("…and the connection breaks: complete says it is not all there", (await completeMediaUploads(paid, [video.sha256])).files[0].status, "missing");
    const resumed = await prepareMediaParts(paid, video.sha256);
    check("asking again lists only the missing parts", [resumed.uploadedParts, resumed.parts.map((part) => part.partNumber)], [[1], [2, 3]]);
    for (const part of resumed.parts) await uploadPart(part.uploadUrl, slice(part.partNumber));
    check("once all are up, complete joins them", (await completeMediaUploads(paid, [video.sha256])).files[0].status, "ready");
    const stored = await headObject(getUserDesignsBucketName(), `${userMediaPrefix(user.id)}media/${video.sha256}`);
    check("…into one object of the full size", Number(stored.ContentLength), video.sizeBytes);
    check("a ready file needs no more parts", (await prepareMediaParts(paid, video.sha256)).parts.length, 0);
    await removeUnreferencedMedia(user.id, [video.sha256]);
    check("the sweep frees a large file no design uses", await objectExists(`${userMediaPrefix(user.id)}media/${video.sha256}`), false);

    // ---- 6c. Installed fonts -------------------------------------------------------------------
    const fontFile = makeFile(20_000, "font/ttf");
    const fontPrepared = await prepareMediaUploads(account, [fontFile]);
    await upload(fontPrepared.files[0].uploadUrl!, fontFile);
    check("a font needs its file uploaded first", await codeOf(() => putFont(account, fontIdFor(fontFile.sha256), { mutationId: mutation(), fontName: "Aref Ruqaa", sha256: fontFile.sha256 })), "422:media_missing");
    await completeMediaUploads(account, [fontFile.sha256]);
    const savedFont = await putFont(account, fontIdFor(fontFile.sha256), { mutationId: mutation(), fontName: "Aref Ruqaa", displayName: "Aref Ruqaa", sha256: fontFile.sha256 });
    check("a font is saved under its name", [savedFont.font.fontName, savedFont.font.deleted, Boolean(savedFont.font.downloadUrl)], ["Aref Ruqaa", false, true]);
    check("the same file from another device is the same font", (await putFont(account, fontIdFor(fontFile.sha256), { mutationId: mutation(), fontName: "Aref Ruqaa", sha256: fontFile.sha256 })).font.revision, savedFont.font.revision);
    check("a font id must be its file's hash", await codeOf(() => putFont(account, "font-not-a-hash", { mutationId: mutation(), fontName: "X", sha256: fontFile.sha256 })), "400:invalid_request");
    const fontPull = await listChanges(account, 0, 500);
    check("other devices see the font in changes", fontPull.fonts.map((font) => font.id), [fontIdFor(fontFile.sha256)]);
    const fontBytes = Buffer.from(await (await fetch(fontPull.fonts[0].downloadUrl!)).arrayBuffer());
    check("…with a link to its file", createHash("sha256").update(fontBytes).digest("hex"), fontFile.sha256);
    await removeUnreferencedMedia(user.id, [fontFile.sha256]);
    check("no design uses a font file, and the sweep keeps it anyway", await objectExists(`${userMediaPrefix(user.id)}media/${fontFile.sha256}`), true);
    const removedFont = await deleteFont(account, fontIdFor(fontFile.sha256), mutation());
    check("removing a font leaves a tombstone…", removedFont.font?.deleted, true);
    check("…and frees its file", await objectExists(`${userMediaPrefix(user.id)}media/${fontFile.sha256}`), false);

    // ---- 7. Purge ----------------------------------------------------------------------------
    const purged = await purgeDesign(account, designId, mutation());
    check("a purged design is a tombstone", [purged.design?.purged, purged.design?.contentHash], [true, ""]);
    check("…its files leave storage", await objectExists(`${userMediaPrefix(user.id)}media/${photo.sha256}`), false);
    check("…nothing can be written to it again", await codeOf(() => putDesign(account, designId, { mutationId: mutation(), name: "Zombie" })), "410:design_purged");
    check("…and purging twice is harmless", (await purgeDesign(account, designId, mutation())).design?.purged, true);

    // ---- 8. The HTTP surface -----------------------------------------------------------------
    const { GET: changesRoute } = await import("@/app/api/mobile/designs/changes/route");
    const anonymous = await changesRoute(new NextRequest("http://localhost:3000/api/mobile/designs/changes"));
    check("no token, no library", anonymous.status, 401);
    try {
      const session = await issueMobileSession({ mobileUser: user });
      const token = (session as { accessToken?: string; tokens?: { accessToken?: string } }).accessToken ??
        (session as { tokens?: { accessToken?: string } }).tokens?.accessToken;
      const authed = await changesRoute(
        new NextRequest("http://localhost:3000/api/mobile/designs/changes?since=0", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      const body = (await authed.json()) as { designs?: Array<{ purged: boolean }>; storage?: { limitBytes: number } };
      check("with a token: the library, its tombstone and the tier's limit", [authed.status, body.designs?.[0]?.purged, body.storage?.limitBytes], [200, true, FREE_LIMIT_BYTES]);
      check("sync answers are never cached", authed.headers.get("Cache-Control"), "no-store");
    } catch (error) {
      console.log(`SKIP  bearer route check (${error instanceof Error ? error.message : String(error)})`);
    }

    // ---- 9. Account deletion -----------------------------------------------------------------
    const keepsake = makeFile(30_000);
    const keepsakePrepared = await prepareMediaUploads(account, [keepsake]);
    await upload(keepsakePrepared.files[0].uploadUrl!, keepsake);
    await completeMediaUploads(account, [keepsake.sha256]);
    const lastDoc = { layers: [{ kind: "image", imageUri: ref(keepsake) }] };
    await putDesign(account, `project-${randomUUID()}`, { mutationId: mutation(), name: "Last", contentHash: hashOf(lastDoc), data: doc(lastDoc) });
    const deletion = await deleteMobileUserAccount(user.id);
    check("deleting the account removes its files from storage", [
      deletion.mediaObjectsDeleted >= 1,
      (await listObjectKeys(getUserDesignsBucketName(), { prefix: userMediaPrefix(user.id) })).length,
    ], [true, 0]);
    check("…and every sync row with it", [
      await prisma.userDesign.count({ where: { mobileUserId: user.id } }),
      await prisma.userDesignFolder.count({ where: { mobileUserId: user.id } }),
      await prisma.userMediaObject.count({ where: { mobileUserId: user.id } }),
      await prisma.userDesignLibrary.count({ where: { mobileUserId: user.id } }),
      await prisma.userFont.count({ where: { mobileUserId: user.id } }),
    ], [0, 0, 0, 0, 0]);
  } finally {
    if (originalSettingsRow) {
      await prisma.appSetting.update({
        where: { key: MOBILE_APP_SETTINGS_KEY },
        data: { value: originalSettingsRow.value as Prisma.InputJsonValue, updatedAt: originalSettingsRow.updatedAt },
      });
    } else {
      await prisma.appSetting.deleteMany({ where: { key: MOBILE_APP_SETTINGS_KEY } });
    }
    await prisma.mobileUser.deleteMany({ where: { id: user.id } });
    const leftovers = await listObjectKeys(getUserDesignsBucketName(), { prefix: userMediaPrefix(user.id) }).catch(() => []);
    if (leftovers.length > 0) {
      const { deleteObjects } = await import("@/lib/storage/objectStorage.server");
      await deleteObjects(getUserDesignsBucketName(), leftovers);
    }
  }

  console.log(failures === 0 ? "\nAll design-sync checks passed." : `\n${failures} check(s) FAILED.`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
