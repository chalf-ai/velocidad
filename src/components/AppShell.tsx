"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { CasoModal } from "@/components/CasoModal";
import { SessionProvider } from "@/components/providers/SessionProvider";
import { SnapshotHydrator } from "@/components/SnapshotHydrator";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthRoute = pathname.startsWith("/login");

  return (
    <SessionProvider>
      {isAuthRoute ? (
        children
      ) : (
        <div className="flex h-screen flex-col overflow-hidden">
          {/* Hidrata el store con el snapshot oficial activo desde la DB. Corre
              una sola vez por sesión; no pisa cargas hechas manualmente. */}
          <SnapshotHydrator />
          <Header />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <Suspense
              fallback={
                <div className="w-60 shrink-0 border-r border-[--color-border] bg-white" />
              }
            >
              <Sidebar />
            </Suspense>
            <main className="min-w-0 flex-1 overflow-auto">{children}</main>
          </div>
          <CasoModal />
        </div>
      )}
    </SessionProvider>
  );
}
