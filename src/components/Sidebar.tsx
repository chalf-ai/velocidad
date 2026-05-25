"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Bug,
  CalendarClock,
  Car,
  ClipboardCheck,
  CreditCard,
  Coins,
  LayoutDashboard,
  Banknote,
  ClipboardList,
  Gauge,
  Layers,
  Link2,
  PackageCheck,
  Receipt,
  TestTube2,
  Truck,
  Upload,
  Warehouse,
} from "lucide-react";
import { cn } from "@/lib/cn";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exactQuery?: string;
}

const NAV_EXEC: NavItem[] = [
  { href: "/centro-accion", label: "Centro de Acción", icon: Gauge },
  { href: "/dashboard", label: "Sistema de Velocidad Operacional", icon: LayoutDashboard },
  { href: "/stock", label: "Stock Explorer", icon: Warehouse },
  { href: "/lineas", label: "Líneas de crédito", icon: CreditCard },
  { href: "/capital-pagado", label: "Recuperación de Caja", icon: Coins },
  { href: "/saldos", label: "Saldos", icon: Receipt },
  { href: "/provisiones", label: "Provisiones", icon: ClipboardList },
  { href: "/capital-trabajo", label: "Capital de trabajo", icon: Banknote },
];

const NAV_MARCAS: NavItem[] = [
  { href: "/kia", label: "KIA Operating View", icon: Car },
  { href: "/usados", label: "Usados · unidad operacional", icon: Car },
];

const NAV_OPS: NavItem[] = [
  { href: "/facturados-no-entregados", label: "Facturados no entregados", icon: Truck },
  { href: "/vu-en-fne", label: "Usados pendientes de recuperación", icon: Link2 },
  {
    href: "/stock?naturaleza=puente",
    label: "Capital puente",
    icon: Layers,
    exactQuery: "naturaleza=puente",
  },
  { href: "/tescar", label: "TESCAR", icon: TestTube2 },
  { href: "/vencimientos", label: "Vencimientos", icon: CalendarClock },
  { href: "/alertas", label: "Alertas", icon: AlertTriangle },
];

const NAV_TEC: NavItem[] = [
  { href: "/ingesta", label: "Ingesta Operacional", icon: PackageCheck },
  { href: "/validacion", label: "Validación", icon: ClipboardCheck },
  { href: "/debug/resumen", label: "Debug · Resumen", icon: Bug },
];

function NavSection({ title, items }: { title: string; items: NavItem[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentQs = searchParams.toString();

  return (
    <div>
      <div className="px-3 mb-1.5 text-[10px] uppercase tracking-[0.14em] text-[--color-sidebar-fg-dim] font-semibold">
        {title}
      </div>
      <div className="space-y-px">
        {items.map((item) => {
          const Icon = item.icon;
          const pathBase = item.href.split("?")[0];
          const pathMatch = pathname === pathBase;
          let active = pathMatch;
          if (item.exactQuery) {
            active = pathMatch && currentQs === item.exactQuery;
          } else if (item.href.includes("?")) {
            active = pathMatch;
          } else {
            active = pathMatch && !currentQs;
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] transition",
                active
                  ? "bg-[--color-sidebar-bg-active] text-white"
                  : "text-[--color-sidebar-fg-muted] hover:text-[--color-sidebar-fg] hover:bg-[--color-sidebar-bg-hover]",
              )}
            >
              {active && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-[--color-accent-hi]" />
              )}
              <Icon
                className={cn(
                  "size-[15px] shrink-0 transition",
                  active
                    ? "text-[--color-accent-hi]"
                    : "text-[--color-sidebar-fg-dim] group-hover:text-[--color-sidebar-fg-muted]",
                )}
                strokeWidth={1.75}
              />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 shrink-0 bg-[--color-sidebar-bg] border-r border-[--color-sidebar-border] flex flex-col">
      {/* Brand */}
      <Link
        href="/"
        className="px-5 pt-5 pb-4 flex items-center gap-2.5 hover:opacity-90 transition"
      >
        <div className="size-8 rounded-lg bg-gradient-to-br from-[--color-accent] via-[--color-accent-hi] to-[#818cf8] grid place-items-center shadow-[0_4px_12px_-4px_rgba(88,120,255,0.5)]">
          <Warehouse className="size-4 text-white" strokeWidth={2.25} />
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-tight text-white">
            Stock Command
          </div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-[--color-sidebar-fg-dim]">
            Pompeyo Carrasco
          </div>
        </div>
      </Link>

      <div className="mx-3 h-px bg-[--color-sidebar-border] mb-3" />

      {/* Nav */}
      <nav className="flex-1 px-2.5 space-y-5 overflow-y-auto pb-4">
        <NavSection title="Ejecutivo" items={NAV_EXEC} />
        <NavSection title="Marcas" items={NAV_MARCAS} />
        <NavSection title="Operacional" items={NAV_OPS} />
        <NavSection title="Técnico" items={NAV_TEC} />
      </nav>

      {/* Upload pinned bottom */}
      <div className="px-2.5 pb-4 pt-3 border-t border-[--color-sidebar-border]">
        <Link
          href="/"
          className={cn(
            "flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] transition",
            pathname === "/" || pathname === "/cargar"
              ? "bg-[--color-accent] text-white"
              : "text-[--color-sidebar-fg-muted] hover:text-white hover:bg-[--color-sidebar-bg-hover]",
          )}
        >
          <Upload className="size-[15px]" strokeWidth={1.75} />
          <span>Cargar archivo</span>
        </Link>
      </div>
    </aside>
  );
}
