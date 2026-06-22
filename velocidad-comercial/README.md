# Velocidad Comercial

**App INDEPENDIENTE** — separada de Velocidad Operacional. Vive en su propia carpeta del repo y se integra con su **propio ECS** (deploy aparte). No comparte shell, sidebar ni navegación con Operacional.

## Qué es
Torre de control comercial gestionable (V2). Arquitectura congelada en
`cesar-core/04-velocity-comercial/V2-ontologia-y-principios.md`.

Flujo: **modelo (puerta) → cola de negocios → negocio → jugada**.
- `/` — portada: modelos como puertas a sus colas.
- `/modelo/[modelo]/cola` — Nivel 2: cola de negocios gestionables.
- `/negocio/[tipo]/[id]` — Nivel 3: bloqueo · dueño · estado de vida · jugada.

## Datos
ROMA en vivo (solo lectura) vía `src/lib/roma.ts` (`ROMA_DATABASE_URL`).
Núcleo = vigentes (VT_Ventas no facturadas ≤90d) con señal: VPP activa /
crédito sin firmar / sin VIN. NO incluye cotizaciones aprobadas.

## Local
```bash
export NVM_DIR="$HOME/.nvm" && \. "$NVM_DIR/nvm.sh"
npm install
# requiere túnel SSH al bastión + ROMA_DATABASE_URL en .env.local
npm run dev
```

## Pendiente para producción (fase ECS)
- **Autenticación** (esta primera versión NO tiene auth — agregar antes del go-live).
- Dockerfile + servicio ECS propios (cluster/servicio/ECR separados de Operacional).
- Dominio propio (ej. `velocidadcomercial.pompeyo.cl`).
