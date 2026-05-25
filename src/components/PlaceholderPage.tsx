"use client";

import Link from "next/link";
import { Construction, Sparkles } from "lucide-react";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useExcelStore } from "@/lib/store";

export function PlaceholderPage({
  title,
  description,
  bullets,
}: {
  title: string;
  description: string;
  bullets: string[];
}) {
  const { data } = useExcelStore();

  return (
    <div className="p-8 max-w-3xl mx-auto fade-in">
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-[--color-accent] font-semibold">
          <Sparkles className="size-3" />
          En desarrollo
        </div>
        <h1 className="text-[26px] font-semibold tracking-tight mt-1.5">{title}</h1>
        <p className="text-[13.5px] text-[--color-fg-muted] mt-1.5 leading-relaxed">
          {description}
        </p>
      </div>

      <Card variant="glass">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Construction className="size-4 text-[--color-fg-muted]" />
            <CardTitle>Próxima iteración</CardTitle>
          </div>
          <CardDescription>Lo que vas a ver aquí cuando esté listo:</CardDescription>
        </CardHeader>
        <CardBody>
          <ul className="space-y-2.5">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-2.5 text-[13px]">
                <span className="mt-1.5 size-1.5 rounded-full bg-[--color-accent] shrink-0" />
                <span className="text-[--color-fg]">{b}</span>
              </li>
            ))}
          </ul>

          {!data && (
            <div className="mt-6 pt-5 border-t border-[--color-border]">
              <Link
                href="/"
                className="text-[--color-accent] text-sm hover:underline inline-flex items-center gap-1"
              >
                ← Volver a la pantalla de inicio
              </Link>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="mt-4 text-center">
        <Badge tone="muted" size="xs">
          Programado para v1.1
        </Badge>
      </div>
    </div>
  );
}
