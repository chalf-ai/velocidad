"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";

// ─── Formulario interno (usa useSearchParams → necesita Suspense) ─────────────

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
      {/* Email */}
      <div className="space-y-1.5">
        <label
          htmlFor="email"
          className="block text-xs font-medium"
          style={{ color: "var(--color-fg-muted)" }}
        >
          Correo electrónico
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@pompeyo.cl"
          className="w-full rounded-lg px-3.5 py-2.5 text-sm outline-none transition-all"
          style={{
            background: "var(--color-bg-elev-2)",
            border: "1px solid var(--color-border)",
            color: "var(--color-fg)",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--color-accent)";
            e.currentTarget.style.boxShadow =
              "0 0 0 3px var(--color-accent-glow)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--color-border)";
            e.currentTarget.style.boxShadow = "none";
          }}
        />
      </div>

      {/* Password */}
      <div className="space-y-1.5">
        <label
          htmlFor="password"
          className="block text-xs font-medium"
          style={{ color: "var(--color-fg-muted)" }}
        >
          Contraseña
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="w-full rounded-lg px-3.5 py-2.5 text-sm outline-none transition-all"
          style={{
            background: "var(--color-bg-elev-2)",
            border: "1px solid var(--color-border)",
            color: "var(--color-fg)",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--color-accent)";
            e.currentTarget.style.boxShadow =
              "0 0 0 3px var(--color-accent-glow)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--color-border)";
            e.currentTarget.style.boxShadow = "none";
          }}
        />
      </div>

      {/* Error */}
      {error && (
        <div
          className="flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-sm"
          style={{
            background: "var(--color-danger-dim)",
            border: "1px solid rgba(220,38,38,0.18)",
            color: "var(--color-danger)",
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            className="shrink-0"
          >
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M8 5v3.5M8 11h.01"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        className="relative w-full overflow-hidden rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-all disabled:cursor-not-allowed disabled:[background:none] disabled:bg-[--color-accent-dim] disabled:text-[--color-accent] disabled:shadow-none"
        style={{
          background:
            "linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-hi) 100%)",
          boxShadow: "0 1px 3px rgba(51,88,232,0.35), 0 1px 1px rgba(51,88,232,0.2)",
        }}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg
              className="animate-spin"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="rgba(255,255,255,0.3)"
                strokeWidth="2.5"
              />
              <path
                d="M12 2a10 10 0 0 1 10 10"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
            Ingresando…
          </span>
        ) : (
          "Ingresar"
        )}
      </button>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LoginPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{ background: "var(--color-bg)" }}
    >
      {/* Card */}
      <div className="w-full max-w-[400px]">

        {/* Branding sobre la card */}
        <div className="mb-6 flex flex-col items-center gap-2">
          <div
            className="flex w-full justify-center rounded-2xl px-6 py-5 shadow-sm"
            style={{
              background:
                "linear-gradient(135deg, #0e1729 0%, #182238 55%, #1f2c47 100%)",
              border: "1px solid var(--color-sidebar-border)",
            }}
          >
            <Image
              src="/pompeyo-carrasco-logo.png"
              alt="Pompeyo Carrasco"
              width={300}
              height={114}
              priority
              className="h-auto w-[260px]"
            />
          </div>
          <p
            className="text-xs tracking-wide uppercase font-medium"
            style={{ color: "var(--color-fg-dim)", letterSpacing: "0.08em" }}
          >
            Pompeyo Carrasco · Stock Command Center
          </p>
        </div>

        {/* Surface card */}
        <div className="surface top-strip">
          {/* Strip gradient interior */}
          <style>{`
            .login-card.top-strip::before {
              background: linear-gradient(90deg, var(--color-accent) 0%, var(--color-accent-hi) 60%, #818cf8 100%);
            }
          `}</style>
          <div
            className="top-strip rounded-xl"
            style={{
              background: "var(--color-bg-elev-1)",
              border: "1px solid var(--color-border)",
              borderRadius: "14px",
              boxShadow:
                "0 1px 3px rgba(15,23,42,0.06), 0 4px 16px rgba(15,23,42,0.04)",
              overflow: "hidden",
            }}
          >
            {/* Top accent strip */}
            <div
              className="h-[3px] w-full"
              style={{
                background:
                  "linear-gradient(90deg, var(--color-accent) 0%, var(--color-accent-hi) 60%, #818cf8 100%)",
              }}
            />

            <div className="p-7">
              <div className="mb-5">
                <h1
                  className="text-base font-semibold"
                  style={{ color: "var(--color-fg)" }}
                >
                  Iniciar sesión
                </h1>
                <p
                  className="mt-0.5 text-xs"
                  style={{ color: "var(--color-fg-dim)" }}
                >
                  Acceso restringido al equipo Pompeyo.
                </p>
              </div>

              <Suspense
                fallback={
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="h-10 animate-pulse rounded-lg"
                        style={{ background: "var(--color-bg-elev-3)" }}
                      />
                    ))}
                  </div>
                }
              >
                <LoginForm />
              </Suspense>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p
          className="mt-5 text-center text-xs"
          style={{ color: "var(--color-fg-faint)" }}
        >
          ¿Sin acceso? Contacta al administrador del sistema.
        </p>
      </div>
    </div>
  );
}
