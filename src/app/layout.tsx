import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Velocidad · Pompeyo Carrasco",
  description:
    "Cockpit ejecutivo de stock, líneas de crédito, capital de trabajo y operación comercial",
  icons: {
    apple: "/pompeyo-menu-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-[--color-bg] text-[--color-fg]">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
