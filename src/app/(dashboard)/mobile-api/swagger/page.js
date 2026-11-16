import MobileApiSwaggerClient from "@/components/mobile/MobileApiSwaggerClient";

export const metadata = {
  title: "Mobile APIs Swagger",
  description: "Swagger UI for /api/mobile endpoints",
};

export default function MobileApiSwaggerPage() {
  return <MobileApiSwaggerClient />;
}
