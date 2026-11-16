import { redirect } from "next/navigation";

export default async function LegacyDashboardCatchAll({ params }) {
  const resolvedParams = await params;
  const segments = Array.isArray(resolvedParams?.slug) ? resolvedParams.slug : [];
  const targetPath =
    segments.length > 0
      ? `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`
      : "/";
  redirect(targetPath);
}

