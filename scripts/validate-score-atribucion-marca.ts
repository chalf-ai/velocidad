/**
 * Validación · atribución de marca del Score == Capital/Tendencias.
 *
 * Tras alinear el filtro de marca (owner/originador) en el Score histórico, el
 * indicador I1 "Caja Comercial Gestionable" del Score debe coincidir VIN a VIN
 * con la métrica de capital (lo que muestra Tendencias) para CADA marca.
 *
 * Read-only. Lee los snapshots activos de prod.
 */
import { PrismaClient } from "@prisma/client";
import {
  rehidratarStock, rehidratarFNE, rehidratarSaldos, rehidratarProvisiones,
  calcularSGLegacyDesdePayloads,
} from "../src/lib/historico/calcular-score-gerencial-historico";
import { capitalDesdePayloads } from "../src/lib/historico/capital-por-corte";

const prisma = new PrismaClient();
async function activo(f: string) {
  const s = await prisma.snapshot.findFirst({ where: { fuente: f as any, activo: true }, orderBy: { createdAt: "desc" }, select: { payload: true } });
  return s?.payload ?? null;
}
(async () => {
  const stock = rehidratarStock(await activo("BASE_STOCK"));
  const fne = rehidratarFNE(await activo("FNE"));
  const saldos = rehidratarSaldos(await activo("SALDOS"));
  const provisiones = rehidratarProvisiones(await activo("PROVISIONES"));
  if (!stock || !fne || !saldos || !provisiones) { console.log("faltan fuentes activas"); return; }

  const marcas = [null, "KIA", "NISSAN", "USADOS", "SUBARU", "MG", "PEUGEOT", "OPEL"];
  console.log("Caja Comercial · Score I1 vs Capital/Tendencias por marca (tras fix):");
  let ok = true;
  for (const m of marcas) {
    const sg = calcularSGLegacyDesdePayloads({ stock, fne, saldos, provisiones, marca: m });
    const i1 = sg.indicadores?.[0]?.casos ?? null;
    const cap = capitalDesdePayloads({ stock, fne, saldos, provisiones, marca: m }).cajaComercial?.unidades ?? null;
    const match = i1 === cap;
    if (!match) ok = false;
    console.log(`  ${(m ?? "TOTAL").padEnd(10)} Score I1=${String(i1).padStart(4)} · Capital=${String(cap).padStart(4)} · ${match ? "OK ✓" : "DIFIERE ✗"}`);
  }
  console.log(ok ? "\nRESULTADO: atribución alineada ✓" : "\nRESULTADO: revisar ✗");
})().finally(() => prisma.$disconnect());
