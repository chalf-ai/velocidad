"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useSession } from "next-auth/react";
import {
  UserCog, Plus, KeyRound, ShieldCheck, ShieldOff,
  Loader2, X, Eye, EyeOff, MessageCircle, Phone,
} from "lucide-react";
import { fmtDate } from "@/lib/format";

type Rol = "ADMIN" | "DIRECTOR" | "GERENTE_GENERAL" | "GERENTE" | "JEFE_MARCA";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  rol: Rol;
  activo: boolean;
  telefono: string | null;
  marcas: string[];
  createdAt: string;
}

const ROL_LABEL: Record<Rol, string> = {
  ADMIN: "Admin",
  DIRECTOR: "Director",
  GERENTE_GENERAL: "Gerente General",
  GERENTE: "Gerente",
  JEFE_MARCA: "Jefe de Marca",
};

const ROL_COLOR: Record<Rol, string> = {
  ADMIN: "bg-red-100 text-red-700",
  DIRECTOR: "bg-violet-100 text-violet-700",
  GERENTE_GENERAL: "bg-amber-100 text-amber-700",
  GERENTE: "bg-blue-100 text-[#3358e8]",
  JEFE_MARCA: "bg-emerald-100 text-emerald-700",
};

// Descripción corta para el selector de roles
const ROL_OPTION: Record<Rol, string> = {
  ADMIN: "Admin — sube datos, acceso total",
  DIRECTOR: "Director — análisis genérico, ve todo",
  GERENTE_GENERAL: "Gerente General — gestiona usuarios, ve todo",
  GERENTE: "Gerente — KPIs de sus marcas asignadas",
  JEFE_MARCA: "Jefe de Marca — operacional, sus marcas asignadas",
};

// Roles que ven todas las marcas sin filtro
const ROLES_VEN_TODAS: Rol[] = ["ADMIN", "DIRECTOR", "GERENTE_GENERAL"];

const MARCAS_GRUPO = [
  "KIA MOTORS", "MG", "GEELY", "PEUGEOT", "OPEL",
  "CITROEN", "DFSK", "NISSAN", "NISSAN FLOTAS",
  "SUBARU", "SUZUKI", "GREAT WALL", "DFM", "LEAPMOTOR",
  "LANDKING", "NAMMI", "USADOS",
];

/* ─── Modal overlay ──────────────────────────────────────────────────────── */
function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] grid place-items-center bg-[#101828]/35 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-[--color-border] bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ─── Modal: crear usuario ───────────────────────────────────────────────── */
function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (u: UserRow) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [rol, setRol] = useState<Rol>("JEFE_MARCA");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, name: name || undefined, password, rol }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Error al crear usuario"); return; }
      onCreated(json as UserRow);
      onClose();
    } catch { setError("Error de red"); }
    finally { setLoading(false); }
  }

  return (
    <Modal onClose={onClose}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-[--color-fg]">Nuevo usuario</h2>
        <button type="button" onClick={onClose} className="text-[--color-fg-dim] hover:text-[--color-fg]"><X className="size-4" /></button>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[--color-fg-muted]">Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@pompeyo.cl"
            className="w-full rounded-md border border-[--color-border] bg-white px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3358e8]/40" />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[--color-fg-muted]">Nombre (opcional)</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre completo"
            className="w-full rounded-md border border-[--color-border] bg-white px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3358e8]/40" />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[--color-fg-muted]">Contraseña</label>
          <div className="relative">
            <input type={showPwd ? "text" : "password"} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres"
              className="w-full rounded-md border border-[--color-border] bg-white px-3 py-2 pr-9 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3358e8]/40" />
            <button type="button" onClick={() => setShowPwd((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[--color-fg-dim]">
              {showPwd ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[--color-fg-muted]">Rol</label>
          <select value={rol} onChange={(e) => setRol(e.target.value as Rol)}
            className="w-full rounded-md border border-[--color-border] bg-white px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3358e8]/40">
            {(Object.keys(ROL_OPTION) as Rol[]).map((r) => (
              <option key={r} value={r}>{ROL_OPTION[r]}</option>
            ))}
          </select>
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-md border border-[--color-border] px-3 py-1.5 text-[13px] text-[--color-fg-muted] hover:bg-[--color-bg-elev-2]">Cancelar</button>
          <button type="submit" disabled={loading} className="inline-flex items-center gap-1.5 rounded-md bg-[#3358e8] px-3 py-1.5 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-60">
            {loading && <Loader2 className="size-3.5 animate-spin" />} Crear usuario
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ─── Modal: resetear contraseña ─────────────────────────────────────────── */
function ResetPasswordModal({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/reset-password`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Error al resetear"); return; }
      setDone(true);
    } catch { setError("Error de red"); }
    finally { setLoading(false); }
  }

  return (
    <Modal onClose={onClose}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-[--color-fg]">Resetear contraseña</h2>
        <button type="button" onClick={onClose} className="text-[--color-fg-dim] hover:text-[--color-fg]"><X className="size-4" /></button>
      </div>
      {done ? (
        <div className="space-y-4">
          <p className="rounded-md bg-green-50 px-3 py-2.5 text-[13px] text-green-700">
            Contraseña actualizada para <strong>{user.email}</strong>.
          </p>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="rounded-md bg-[#3358e8] px-3 py-1.5 text-[13px] font-medium text-white hover:brightness-110">Cerrar</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-[13px] text-[--color-fg-muted]">Nueva contraseña para <span className="font-medium text-[--color-fg]">{user.email}</span></p>
          <div className="relative">
            <input type={showPwd ? "text" : "password"} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres"
              className="w-full rounded-md border border-[--color-border] bg-white px-3 py-2 pr-9 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3358e8]/40" />
            <button type="button" onClick={() => setShowPwd((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[--color-fg-dim]">
              {showPwd ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-md border border-[--color-border] px-3 py-1.5 text-[13px] text-[--color-fg-muted] hover:bg-[--color-bg-elev-2]">Cancelar</button>
            <button type="submit" disabled={loading} className="inline-flex items-center gap-1.5 rounded-md bg-[#3358e8] px-3 py-1.5 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-60">
              {loading && <Loader2 className="size-3.5 animate-spin" />} Guardar
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* ─── Modal: configurar WhatsApp y marcas ────────────────────────────────── */
function ConfigModal({
  user, onClose, onSaved,
}: { user: UserRow; onClose: () => void; onSaved: (u: UserRow) => void }) {
  const veTodas = ROLES_VEN_TODAS.includes(user.rol);
  const [telefono, setTelefono] = useState(user.telefono ?? "");
  const [marcas, setMarcas] = useState<string[]>(user.marcas ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleMarca(m: string) {
    setMarcas((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          telefono: telefono.trim() || null,
          marcas: veTodas ? [] : marcas,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Error al guardar"); return; }
      onSaved({ ...user, ...json });
      onClose();
    } catch { setError("Error de red"); }
    finally { setLoading(false); }
  }

  const marcasLabel = user.rol === "GERENTE"
    ? "Marcas de responsabilidad"
    : "Marcas asignadas";

  const marcasHint = user.rol === "GERENTE"
    ? "Marcas sobre las que este gerente es responsable de indicadores."
    : "Marcas que este jefe de marca puede ver y gestionar.";

  return (
    <Modal onClose={onClose}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageCircle className="size-4 text-green-600" strokeWidth={1.75} />
          <h2 className="text-[15px] font-semibold text-[--color-fg]">WhatsApp · Marcas</h2>
        </div>
        <button type="button" onClick={onClose} className="text-[--color-fg-dim] hover:text-[--color-fg]"><X className="size-4" /></button>
      </div>
      <p className="mb-4 text-[12px] text-[--color-fg-muted]">{user.name ?? user.email}</p>

      <form onSubmit={submit} className="space-y-4">
        {/* Teléfono */}
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[--color-fg-muted]">
            Número WhatsApp
          </label>
          <div className="relative">
            <Phone className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[--color-fg-dim]" />
            <input
              type="tel"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="+56912345678"
              className="w-full rounded-md border border-[--color-border] bg-white py-2 pl-8 pr-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3358e8]/40"
            />
          </div>
          <p className="mt-1 text-[11px] text-[--color-fg-dim]">Formato internacional, ej: +56912345678</p>
        </div>

        {/* Marcas */}
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[--color-fg-muted]">
            {veTodas ? "Acceso a marcas" : marcasLabel}
          </label>
          {veTodas ? (
            <div className="flex items-center gap-2 rounded-md border border-[--color-border] bg-[--color-bg-elev-1] px-3 py-2.5">
              <ShieldCheck className="size-3.5 shrink-0 text-violet-600" strokeWidth={2} />
              <span className="text-[12px] text-[--color-fg-muted]">
                Ve todas las marcas — sin restricción de acceso
              </span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                {MARCAS_GRUPO.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleMarca(m)}
                    className={`rounded-md border px-2 py-1.5 text-left text-[11px] font-medium transition ${
                      marcas.includes(m)
                        ? "border-[#3358e8] bg-[#3358e8]/8 text-[#3358e8]"
                        : "border-[--color-border] text-[--color-fg-muted] hover:border-[#3358e8]/40"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-[--color-fg-dim]">{marcasHint}</p>
            </>
          )}
        </div>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-md border border-[--color-border] px-3 py-1.5 text-[13px] text-[--color-fg-muted] hover:bg-[--color-bg-elev-2]">Cancelar</button>
          <button type="submit" disabled={loading} className="inline-flex items-center gap-1.5 rounded-md bg-[#3358e8] px-3 py-1.5 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-60">
            {loading && <Loader2 className="size-3.5 animate-spin" />} Guardar
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ─── Página principal ───────────────────────────────────────────────────── */
export default function UsuariosPage() {
  const { data: session, status } = useSession();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [configTarget, setConfigTarget] = useState<UserRow | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [changingRolId, setChangingRolId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users", { credentials: "include" });
      if (res.ok) setUsers(await res.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  async function toggleActivo(user: UserRow) {
    setTogglingId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ activo: !user.activo }),
      });
      if (res.ok) {
        const updated: UserRow = await res.json();
        setUsers((prev) => prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));
      }
    } finally { setTogglingId(null); }
  }

  async function changeRol(user: UserRow, rol: Rol) {
    setChangingRolId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ rol }),
      });
      if (res.ok) {
        const updated: UserRow = await res.json();
        setUsers((prev) => prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));
      }
    } finally { setChangingRolId(null); }
  }

  if (status === "loading" || loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="size-5 animate-spin text-[--color-fg-dim]" /></div>;
  }

  const userRol = session?.user.rol;
  const canManage = userRol === "ADMIN" || userRol === "GERENTE_GENERAL";

  if (!canManage) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[--color-fg-muted]">
        <ShieldOff className="size-8 text-[--color-fg-dim]" />
        <p className="text-[14px]">Acceso restringido.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <UserCog className="size-5 text-[--color-fg-dim]" strokeWidth={1.75} />
          <div>
            <h1 className="text-[18px] font-semibold text-[--color-fg]">Gestión de usuarios</h1>
            <p className="text-[12px] text-[--color-fg-dim]">
              {users.length} usuario{users.length !== 1 ? "s" : ""} registrado{users.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <button type="button" onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#3358e8] px-3 py-2 text-[13px] font-medium text-white hover:brightness-110">
          <Plus className="size-3.5" strokeWidth={2.5} /> Nuevo usuario
        </button>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-xl border border-[--color-border] bg-white">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[--color-border] bg-[--color-bg-elev-1]">
              {["Usuario", "Rol", "Marcas · WhatsApp", "Estado", "Creado", "Acciones"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-[--color-fg-dim]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[--color-border]">
            {users.map((user) => {
              const isSelf = user.id === session?.user.id;
              const veTodas = ROLES_VEN_TODAS.includes(user.rol);

              return (
                <tr key={user.id} className={`transition hover:bg-[--color-bg-elev-1] ${!user.activo ? "opacity-50" : ""}`}>
                  {/* Usuario */}
                  <td className="px-4 py-3">
                    <p className="font-medium text-[--color-fg]">{user.name ?? "—"}</p>
                    <p className="text-[12px] text-[--color-fg-muted]">{user.email}</p>
                  </td>

                  {/* Rol */}
                  <td className="px-4 py-3">
                    {isSelf ? (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${ROL_COLOR[user.rol]}`}>
                        {ROL_LABEL[user.rol]}
                      </span>
                    ) : (
                      <select
                        value={user.rol}
                        disabled={changingRolId === user.id}
                        onChange={(e) => changeRol(user, e.target.value as Rol)}
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#3358e8]/40 ${ROL_COLOR[user.rol]}`}
                      >
                        {(Object.keys(ROL_LABEL) as Rol[]).map((r) => (
                          <option key={r} value={r}>{ROL_LABEL[r]}</option>
                        ))}
                      </select>
                    )}
                  </td>

                  {/* Marcas · WhatsApp */}
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {user.telefono ? (
                        <span className="inline-flex items-center gap-1 text-[12px] text-green-700">
                          <Phone className="size-3" strokeWidth={2} />
                          {user.telefono}
                        </span>
                      ) : (
                        <span className="text-[12px] text-[--color-fg-dim]">Sin número</span>
                      )}
                      {veTodas ? (
                        <span className={`inline-block self-start rounded-full px-2 py-0.5 text-[10px] font-medium ${ROL_COLOR[user.rol]}`}>
                          Todas las marcas
                        </span>
                      ) : user.marcas.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {user.marcas.map((m) => (
                            <span key={m} className="rounded-full bg-[#3358e8]/8 px-1.5 py-0.5 text-[10px] font-medium text-[#3358e8]">
                              {m}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[11px] text-[--color-fg-dim]">Sin marcas asignadas</span>
                      )}
                    </div>
                  </td>

                  {/* Estado */}
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => !isSelf && toggleActivo(user)}
                      disabled={isSelf || togglingId === user.id}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                        user.activo ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      } disabled:cursor-default disabled:opacity-60`}>
                      {togglingId === user.id ? <Loader2 className="size-3 animate-spin" /> : user.activo ? <ShieldCheck className="size-3" strokeWidth={2} /> : <ShieldOff className="size-3" strokeWidth={2} />}
                      {user.activo ? "Activo" : "Inactivo"}
                    </button>
                  </td>

                  {/* Creado */}
                  <td className="px-4 py-3 text-[12px] text-[--color-fg-dim]">
                    {fmtDate(new Date(user.createdAt))}
                  </td>

                  {/* Acciones */}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button type="button" onClick={() => setConfigTarget(user)}
                        className="inline-flex items-center gap-1 rounded-md border border-[--color-border] px-2.5 py-1.5 text-[12px] text-[--color-fg-muted] hover:bg-[--color-bg-elev-2] hover:text-green-700 transition"
                        title="Configurar WhatsApp y marcas">
                        <MessageCircle className="size-3.5" strokeWidth={1.75} />
                        Configurar
                      </button>
                      <button type="button" onClick={() => setResetTarget(user)}
                        className="inline-flex items-center gap-1 rounded-md border border-[--color-border] px-2.5 py-1.5 text-[12px] text-[--color-fg-muted] hover:bg-[--color-bg-elev-2] hover:text-[--color-fg] transition"
                        title="Resetear contraseña">
                        <KeyRound className="size-3.5" strokeWidth={1.75} />
                        Reset clave
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {users.length === 0 && (
          <div className="py-12 text-center text-[13px] text-[--color-fg-dim]">No hay usuarios registrados.</div>
        )}
      </div>

      {/* Modales */}
      {showCreate && (
        <CreateUserModal onClose={() => setShowCreate(false)} onCreated={(u) => setUsers((prev) => [...prev, u])} />
      )}
      {resetTarget && <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />}
      {configTarget && (
        <ConfigModal
          user={configTarget}
          onClose={() => setConfigTarget(null)}
          onSaved={(u) => setUsers((prev) => prev.map((x) => (x.id === u.id ? u : x)))}
        />
      )}
    </div>
  );
}
