"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { CasoModal } from "@/components/CasoModal";
import { SessionProvider } from "@/components/providers/SessionProvider";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthRoute = pathname.startsWith("/login");

  return (
    <SessionProvider>
      {isAuthRoute ? (
        children
      ) : (
        <div className="flex min-h-screen">
          <Suspense
            fallback={
              <div className="w-64 shrink-0 border-r border-[--color-border] bg-[--color-bg-elev-1]" />
            }
          >
            <Sidebar />
          </Suspense>
          <div className="flex min-w-0 flex-1 flex-col">
            <Header />
            <main className="flex-1 overflow-auto">{children}</main>
          </div>
          <CasoModal />
        </div>
      )}
    </SessionProvider>
  );
}
