import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { CasoModal } from "@/components/CasoModal";
import { SessionProvider } from "@/components/providers/SessionProvider";

export const metadata: Metadata = {
  title: "Velocidad · Pompeyo Carrasco",
  description:
    "Cockpit ejecutivo de stock, líneas de crédito, capital de trabajo y operación comercial",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-[--color-bg] text-[--color-fg]">
        <SessionProvider>
          <div className="flex min-h-screen">
            <Suspense fallback={<div className="w-64 shrink-0 border-r border-[--color-border] bg-[--color-bg-elev-1]" />}>
              <Sidebar />
            </Suspense>
            <div className="flex-1 flex flex-col min-w-0">
              <Header />
              <main className="flex-1 overflow-auto">{children}</main>
            </div>
          </div>
          <CasoModal />
        </SessionProvider>
      </body>
    </html>
  );
}
