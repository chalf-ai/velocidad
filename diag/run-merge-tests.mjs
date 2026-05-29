#!/usr/bin/env node
/**
 * Runner casero para los tests de MergePolicy.
 * Cero dependencias nuevas. Compila TS productivo a /tmp con `tsc` y
 * ejecuta los .test.js resultantes con `node --test`.
 *
 * Uso: node diag/run-merge-tests.mjs
 */
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";

const PROJECT_ROOT = "/Users/Daviid/velocidad";
const OUT = "/tmp/historico-tests";
const SRC_DIR = `${PROJECT_ROOT}/src/lib/historico`;
const TEST_DIR = `${PROJECT_ROOT}/src/lib/historico/__tests__`;

// Limpiar
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

console.log("══════════════════════════════════════════════════════════════════");
console.log("  Compilando MergePolicy + tests a JS (out: " + OUT + ")");
console.log("══════════════════════════════════════════════════════════════════");

// tsconfig específico para tests (no toca el del proyecto)
const tsconfig = {
  compilerOptions: {
    target: "es2022",
    module: "nodenext",
    moduleResolution: "nodenext",
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    outDir: OUT,
    rootDir: `${PROJECT_ROOT}/src`,
    declaration: false,
    sourceMap: false,
    allowImportingTsExtensions: false,
    types: ["node"],
    typeRoots: [`${PROJECT_ROOT}/node_modules/@types`],
  },
  include: [`${SRC_DIR}/**/*.ts`],
};
import { writeFileSync } from "node:fs";
const tsconfigPath = "/tmp/historico-tests-tsconfig.json";
writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));

try {
  execSync(`npx tsc -p ${tsconfigPath}`, { stdio: "inherit", cwd: PROJECT_ROOT });

  console.log("");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("  Corriendo tests con node --test");
  console.log("══════════════════════════════════════════════════════════════════");

  const testFiles = `${OUT}/lib/historico/__tests__/merge-policy.test.js`;
  try {
    execSync(`node --test ${testFiles}`, { stdio: "inherit" });
    console.log("");
    console.log("✅ TESTS OK");
  } catch (e) {
    console.error("");
    console.error("❌ TESTS FAIL");
    process.exit(1);
  }
} catch (e) {
  console.error("");
  console.error("❌ Build error:", e.message);
  process.exit(1);
}
