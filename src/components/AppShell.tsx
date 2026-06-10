"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { CasoModal } from "@/components/CasoModal";
import { SessionProvider } from "@/components/providers/SessionProvider";
import { SnapshotHydrator } from "@/components/SnapshotHydrator";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthRoute = pathname.startsWith("/login");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Cerrar drawer al cambiar de ruta · cubre navegaciones que no pasan por el
  // onClick del Link (deep-link, back/forward del browser, redirect server).
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  return (
    <SessionProvider>
      {isAuthRoute ? (
        children
      ) : (
        <div className="flex h-screen flex-col overflow-hidden">
          {/* Hidrata el store con el snapshot oficial activo desde la DB. Corre
              una sola vez por sesión; no pisa cargas hechas manualmente. */}
          <SnapshotHydrator />
          <Header onMenuClick={() => setMobileNavOpen(true)} />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <Suspense
              fallback={
                <div className="hidden w-60 shrink-0 border-r border-[--color-border] bg-white lg:block" />
              }
            >
              <Sidebar
                mobileOpen={mobileNavOpen}
                onClose={() => setMobileNavOpen(false)}
              />
            </Suspense>
            <main className="min-w-0 flex-1 overflow-auto">{children}</main>
          </div>
          <CasoModal />
        </div>
      )}
    </SessionProvider>
  );
}
