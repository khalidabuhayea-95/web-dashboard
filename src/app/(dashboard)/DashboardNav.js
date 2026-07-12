"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  Download,
  BellRing,
  BarChart3,
  Files,
  Home,
  Layers,
  Pencil,
  SlidersHorizontal,
  Smartphone,
  Tags,
  Type,
  Users,
} from "lucide-react";

const ICONS = {
  overview: Home,
  templates: Files,
  editor: Pencil,
  settings: SlidersHorizontal,
  mobileSettings: Smartphone,
  users: Users,
  analytics: BarChart3,
  push: BellRing,
  designSystem: Files,
  freepikImport: Download,
  psdImport: Layers,
  fonts: Type,
  categories: Tags,
};

function isActivePath(pathname, href) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function DashboardNav({ navItems }) {
  const pathname = usePathname();

  return (
    <nav className="px-3 pb-6" aria-label="Dashboard navigation">
      <ul className="space-y-1.5">
        {navItems.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = ICONS[item.icon] || Home;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "group flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors",
                  active
                    ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                    : "text-foreground/75 hover:bg-accent hover:text-foreground"
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={clsx(
                    "h-4 w-4 shrink-0 transition-transform",
                    active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                  )}
                />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
