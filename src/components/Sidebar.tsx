"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
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
  GitBranch,
  Layers,
  Link2,
  PackageCheck,
  Receipt,
  ScrollText,
  TestTube2,
  TrendingUp,
  Trophy,
  Truck,
  LogOut,
  UserCircle2,
  Users,
  Warehouse,
} from "lucide-react";
import { cn } from "@/lib/cn";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exactQuery?: string;
  /** Si true, no navega: render gris con badge "Pronto". */
  comingSoon?: boolean;
}

const ROL_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  DIRECTOR: "Director",
  GERENTE_GENERAL: "Gerente General",
  GERENTE: "Gerente",
  JEFE_MARCA: "Jefe de Marca",
};

const ROL_COLOR: Record<string, string> = {
  ADMIN: "bg-red-100 text-red-700",
  DIRECTOR: "bg-violet-100 text-violet-700",
  GERENTE_GENERAL: "bg-amber-100 text-amber-700",
  GERENTE: "bg-blue-100 text-[#3358e8]",
  JEFE_MARCA: "bg-emerald-100 text-emerald-700",
};

const NAV_EXEC: NavItem[] = [
  { href: "/centro-accion", label: "Centro de Acción", icon: Gauge },
  { href: "/score-gerencial", label: "Score Gerencial", icon: Trophy },
  { href: "/dashboard", label: "Sistema de Velocidad Operacional", icon: LayoutDashboard },
  { href: "/stock", label: "Stock Explorer", icon: Warehouse },
  { href: "/lineas", label: "Líneas de crédito", icon: CreditCard },
  { href: "/capital-pagado", label: "Recuperación de Caja", icon: Coins },
  { href: "/saldos", label: "Saldos", icon: Receipt },
  { href: "/provisiones", label: "Provisiones", icon: ClipboardList },
  { href: "/facturados-no-entregados", label: "Facturados no entregados", icon: Truck },
  { href: "/capital-trabajo", label: "Capital de trabajo", icon: Banknote },
  // Tendencias es la lectura HISTÓRICA del sistema de Capital de Trabajo y
  // Velocity OS — por eso vive inmediatamente debajo (no es módulo aparte).
  { href: "/tendencias", label: "Tendencias", icon: TrendingUp },
];

const NAV_MARCAS: NavItem[] = [
  { href: "/kia", label: "KIA Operating View", icon: Car },
  { href: "/usados", label: "Usados · unidad operacional", icon: Car },
];

const NAV_OPERACIONES: NavItem[] = [
  {
    href: "/operaciones/control-de-negocio",
    label: "Control de Negocio",
    icon: ScrollText,
  },
  {
    href: "/operaciones/logistica",
    label: "Logística",
    icon: Truck,
  },
  {
    href: "/operaciones/causa-raiz",
    label: "Causa Raíz",
    icon: GitBranch,
    comingSoon: true,
  },
];

// "Tesorería" — antes era "Operacional". La ruta /velocidad-operacional queda
// fuera del menú (sigue viva por URL directa para auditoría comparativa).
// FNE pasó a Ejecutivo (decisión usuario 2026-06): el equipo lo consume como
// métrica ejecutiva del flujo de entrega, no como bloque de tesorería.
const NAV_TESORERIA: NavItem[] = [
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
      <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[--color-fg-dim]">
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

          if (item.comingSoon) {
            return (
              <div
                key={item.href}
                aria-disabled="true"
                className="flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] text-[--color-fg-dim] cursor-default"
              >
                <Icon
                  className="size-[15px] shrink-0 opacity-60"
                  strokeWidth={1.75}
                />
                <span className="truncate flex-1">{item.label}</span>
                <span className="text-[9px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-[--color-bg-elev-2] text-[--color-fg-dim]">
                  Pronto
                </span>
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] transition",
                active
                  ? "bg-[#3358e8] font-medium text-white"
                  : "text-[--color-fg-muted] hover:bg-[--color-bg-elev-2] hover:text-[--color-fg]",
              )}
            >
              <Icon
                className={cn(
                  "size-[15px] shrink-0 transition",
                  active
                    ? "text-white"
                    : "text-[--color-fg-dim] group-hover:text-[--color-fg-muted]",
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
  const { data: session } = useSession();
  const email = session?.user?.email ?? "usuario@pompeyo.cl";
  const name = session?.user?.name ?? null;
  const rol = session?.user?.rol ?? "";
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);

  const isAdmin = rol === "ADMIN";
  const isDirector = rol === "DIRECTOR";
  const isGerenteGeneral = rol === "GERENTE_GENERAL";

  const canManageUsers = isAdmin || isGerenteGeneral;

  // DIRECTOR solo analiza, no opera
  const showEjecutivo = true;
  const showOperaciones = !isDirector;

  // Sección inferior: Técnico completo para ADMIN y GERENTE_GENERAL
  const navSistema: NavItem[] = [
    ...(isAdmin || isGerenteGeneral ? NAV_TEC : []),
    ...(canManageUsers
      ? [{ href: "/usuarios", label: "Gestión de usuarios", icon: Users }]
      : []),
  ];

  return (
    <aside className="sticky top-0 flex h-full w-60 shrink-0 flex-col border-r border-[--color-border] bg-white">
      <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 pb-4 pt-4">
        {showEjecutivo && <NavSection title="Ejecutivo" items={NAV_EXEC} />}
        <NavSection title="Marcas" items={NAV_MARCAS} />
        {showOperaciones && <NavSection title="Operaciones" items={NAV_OPERACIONES} />}
        <NavSection title="Tesorería" items={NAV_TESORERIA} />
        {navSistema.length > 0 && (
          <NavSection
            title={isAdmin || isGerenteGeneral ? "Técnico" : "Administración"}
            items={navSistema}
          />
        )}
      </nav>

      <div className="border-t border-[--color-border] px-2.5 pt-3 pb-4">
        <div className="rounded-md border border-[--color-border] bg-[--color-bg-elev-1] p-1.5">
          <button
            type="button"
            onClick={() => setLogoutModalOpen(true)}
            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition hover:bg-[--color-bg-elev-2]"
          >
            <UserCircle2 className="size-4 shrink-0 text-[--color-fg-dim]" strokeWidth={1.75} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[12px] text-[--color-fg-muted]" title={email}>
                {name ?? email}
              </span>
              {rol && (
                <span
                  className={cn(
                    "mt-0.5 self-start rounded-full px-1.5 py-px text-[9px] font-semibold leading-tight",
                    ROL_COLOR[rol] ?? "bg-gray-100 text-gray-600",
                  )}
                >
                  {ROL_LABEL[rol] ?? rol}
                </span>
              )}
            </div>
          </button>
        </div>
      </div>

      {logoutModalOpen && <LogoutModal email={email} onClose={() => setLogoutModalOpen(false)} />}
    </aside>
  );
}

function LogoutModal({ email, onClose }: { email: string; onClose: () => void }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] grid place-items-center bg-[#101828]/35 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs rounded-xl border border-[--color-border] bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[14px] font-medium text-[--color-fg]">¿Cerrar sesión?</p>
        <p className="mt-1 text-[12px] text-[--color-fg-muted] truncate" title={email}>
          {email}
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[--color-border] px-3 py-1.5 text-[13px] text-[--color-fg-muted] hover:bg-[--color-bg-elev-2]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#3358e8] px-3 py-1.5 text-[13px] font-medium text-white hover:brightness-110"
          >
            <LogOut className="size-[14px]" strokeWidth={1.75} />
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
