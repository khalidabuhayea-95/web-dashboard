import { requireRole, Roles } from "@/lib/auth/roles";

// Auth-gated editor pages (layout calls requireRole → DB). Render on demand.
export const dynamic = "force-dynamic";

// The editor is full-bleed: the dashboard sidebar opens as a drawer from the editor header
// (see Toolbar) instead of permanently taking 288px from the canvas.
export default async function EditorLayout({ children }) {
  await requireRole([Roles.ADMIN, Roles.DESIGNER]);

  return <div className="app-shell editor-app-shell">{children}</div>;
}
