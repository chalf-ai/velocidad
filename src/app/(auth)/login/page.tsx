"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

// ─── Formulario (necesita Suspense por useSearchParams) ──────────────────────

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Email o contraseña incorrectos");
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-[--color-fg-muted] mb-1.5">
          Email
        </label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@pompeyo.cl"
          className="w-full rounded-lg border border-[--color-border] bg-[--color-bg] px-3 py-2 text-sm text-[--color-fg] placeholder:text-[--color-fg-subtle] focus:outline-none focus:ring-2 focus:ring-[--color-accent]/50 transition"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-[--color-fg-muted] mb-1.5">
          Contraseña
        </label>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="w-full rounded-lg border border-[--color-border] bg-[--color-bg] px-3 py-2 text-sm text-[--color-fg] placeholder:text-[--color-fg-subtle] focus:outline-none focus:ring-2 focus:ring-[--color-accent]/50 transition"
        />
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-[--color-accent] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition"
      >
        {loading ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}

// ─── Page export ─────────────────────────────────────────────────────────────

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[--color-bg] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo / título */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="text-2xl font-bold text-[--color-fg]">Velocidad</span>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[--color-accent]/10 text-[--color-accent] border border-[--color-accent]/20">
              Pompeyo
            </span>
          </div>
          <p className="text-sm text-[--color-fg-muted]">Stock Command Center</p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-[--color-border] bg-[--color-bg-elev-1] p-6 shadow-lg">
          <h1 className="text-lg font-semibold text-[--color-fg] mb-5">Iniciar sesión</h1>
          <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-[--color-bg]" />}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-4 text-center text-xs text-[--color-fg-subtle]">
          ¿No tienes cuenta? Pide acceso a tu administrador.
        </p>
      </div>
    </div>
  );
}
