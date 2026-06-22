import type { Metadata } from "next";
import Link from "next/link";
import { Target } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Velocidad Comercial · Pompeyo Carrasco",
  description: "Torre de control comercial — modelos, negocios y jugadas. App independiente.",
};

/**
 * Shell PROPIO de Velocidad Comercial — independiente de Velocidad Operacional.
 * Sidebar SOLO con navegación comercial. Cero menú de Operacional.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header propio */}
      <header className="h-14 shrink-0 bg-[--color-header-bg] text-[--color-header-fg] flex items-center px-5 gap-3">
        <div className="size-8 rounded-lg bg-white/15 flex items-center justify-center">
          <Target className="size-4.5" />
        </div>
        <div className="leading-tight">
          <div className="text-[14px] font-bold tracking-tight">Velocidad Comercial</div>
          <div className="text-[10px] tracking-[0.14em] uppercase text-[--color-header-fg-muted]">Pompeyo Carrasco</div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar SOLO comercial */}
        <aside className="w-60 shrink-0 border-r border-[--color-border] bg-white hidden lg:flex flex-col">
          <nav className="flex-1 px-2.5 pt-4 space-y-1">
            <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[--color-fg-dim]">
              Velocidad Comercial
            </div>
            <Link
              href="/"
              className="flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] bg-[#3358e8] font-medium text-white"
            >
              <Target className="size-[15px] shrink-0" strokeWidth={1.75} />
              <span className="truncate">Torre de Control</span>
            </Link>
          </nav>
          <div className="px-4 py-3 text-[10px] text-[--color-fg-dim] border-t border-[--color-border]">
            App independiente · separada de Operacional
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-[--color-bg] text-[--color-fg]">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
