import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

function loadEnvFile(filename) {
  const envPath = resolve(process.cwd(), filename);
  if (!existsSync(envPath)) return;

  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}

async function main() {
  // Prioridad similar a Next.js: .env y luego .env.local
  loadEnvFile(".env");
  loadEnvFile(".env.local");

  if (!process.env.DATABASE_URL) {
    throw new Error(
      "Falta DATABASE_URL. Defínela en .env o .env.local antes de correr este script.",
    );
  }

  const email = process.env.LOCAL_ADMIN_EMAIL ?? "admin@pompeyo.cl";
  const password = process.env.LOCAL_ADMIN_PASSWORD ?? "Admin1234";
  const name = process.env.LOCAL_ADMIN_NAME ?? "Admin Local";

  const prisma = new PrismaClient();

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.upsert({
      where: { email },
      update: {
        name,
        passwordHash,
        rol: "ADMIN",
        activo: true,
      },
      create: {
        email,
        name,
        passwordHash,
        rol: "ADMIN",
        activo: true,
      },
      select: { email: true, rol: true, activo: true },
    });

    console.log("Usuario local listo:");
    console.log(`- email: ${user.email}`);
    console.log(`- password: ${password}`);
    console.log(`- rol: ${user.rol}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("No se pudo crear el usuario local:", err);
  process.exit(1);
});
