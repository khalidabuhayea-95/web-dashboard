import { requireRole, Roles } from "@/lib/auth/roles";
import GalleryClient from "./GalleryClient";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Gallery",
  description: "Internal image library for the dashboard",
};

export default async function GalleryPage() {
  await requireRole([Roles.ADMIN]);
  return <GalleryClient />;
}
