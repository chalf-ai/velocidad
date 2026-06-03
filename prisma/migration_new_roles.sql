-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: Nuevos roles jerárquicos
-- De: ADMIN, JEFE_STOCK, OPERACIONES, READONLY
-- A:  ADMIN, DIRECTOR, GERENTE_GENERAL, GERENTE, JEFE_MARCA
--
-- Mapeo de roles:
--   ADMIN       → ADMIN
--   JEFE_STOCK  → JEFE_MARCA
--   OPERACIONES → JEFE_MARCA  (rol por defecto anterior)
--   READONLY    → DIRECTOR
--
-- Instrucciones:
--   1. Ejecuta este script directamente contra la base de datos PostgreSQL
--   2. Luego corre: npx prisma generate
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: Crear el nuevo tipo enum
CREATE TYPE "Rol_new" AS ENUM ('ADMIN', 'DIRECTOR', 'GERENTE_GENERAL', 'GERENTE', 'JEFE_MARCA');

-- Step 2: Migrar la columna al nuevo tipo usando el mapeo definido
ALTER TABLE "User"
  ALTER COLUMN "rol" TYPE "Rol_new"
  USING (
    CASE "rol"::text
      WHEN 'ADMIN'       THEN 'ADMIN'::"Rol_new"
      WHEN 'JEFE_STOCK'  THEN 'JEFE_MARCA'::"Rol_new"
      WHEN 'OPERACIONES' THEN 'JEFE_MARCA'::"Rol_new"
      WHEN 'READONLY'    THEN 'DIRECTOR'::"Rol_new"
      ELSE 'JEFE_MARCA'::"Rol_new"
    END
  );

-- Step 3: Actualizar el valor por defecto
ALTER TABLE "User" ALTER COLUMN "rol" SET DEFAULT 'JEFE_MARCA'::"Rol_new";

-- Step 4: Reemplazar el tipo antiguo por el nuevo
DROP TYPE "Rol";
ALTER TYPE "Rol_new" RENAME TO "Rol";
