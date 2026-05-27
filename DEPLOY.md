# Deploy en Railway

La app corre como servidor Next.js (SSR, API routes, NextAuth, Prisma).
El deploy activo usa Railway, no export estático.

## Variables de entorno

Configurar en Railway → Service → Variables (mínimo):

- `DATABASE_URL` — PostgreSQL de Railway u otro proveedor
- `AUTH_SECRET` — secreto para NextAuth (`openssl rand -base64 32`)
- `NEXTAUTH_URL` — URL pública del servicio (ej. `https://velocidad.up.railway.app`)

## Deploy automático (recomendado)

1. Conectar el repo de GitHub en [Railway](https://railway.app).
2. Railway lee `railway.toml` y usa Nixpacks:
   - **Build:** `npm ci && npm run build`
   - **Start:** `npm start`
   - **Healthcheck:** `GET /api/health`
3. Cada push a la rama conectada redeploya solo.

## Deploy con Docker

Alternativa usando el `Dockerfile` de la raíz (multi-stage, Node 20 Alpine).
Útil si quieres control total del runtime o desplegar fuera de Railway.

## Migraciones de base de datos

Tras el primer deploy o cambios de schema:

```bash
npm run db:migrate
```

O desde Railway shell / one-off job con `DATABASE_URL` configurada.

## Local (simular producción)

```bash
npm install
npm run build
npm start
```

Abre http://localhost:3000
