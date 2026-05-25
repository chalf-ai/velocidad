# Deploy a Netlify

La app es **100% client-side**: parsing Excel (SheetJS), estado (Zustand) y
persistencia (localStorage) corren en el navegador. No hay backend ni API
routes. Por eso usamos el **static export** de Next.js, que produce HTML/JS/CSS
estático servible desde cualquier CDN.

Resultado del último build: 2.4 MB en la carpeta `out/`, 18 páginas
pre-renderizadas como static content.

## Opción A — Drag & drop (más rápido, sin git)

1. En la raíz del proyecto correr:
   ```bash
   npm install
   npm run build
   ```
2. Se genera la carpeta `out/`.
3. Ir a https://app.netlify.com/drop
4. Arrastrar la carpeta `out/` completa al área de drop.
5. Netlify levanta un sitio con URL aleatoria (ej. `https://random-name.netlify.app`).
6. Desde "Site settings → Site information → Change site name" puedes ponerle
   un nombre custom (ej. `stock-command-center-pompeyo`).

Cada vez que quieras actualizar el sitio, repetís `npm run build` y arrastrás
de nuevo. (Netlify guarda el slug del sitio, mantiene la URL.)

## Opción B — Conectar a un repo de Git (auto-deploy)

Más limpia para iterar a futuro porque cada `git push` despliega solo.

1. Subir el código a un repo (GitHub, GitLab o Bitbucket privado).
2. En Netlify → "Add new site" → "Import an existing project".
3. Conectar el provider y elegir el repo.
4. Netlify lee `netlify.toml` (ya está commiteado) y configura:
   - Build command: `npm run build`
   - Publish directory: `out`
   - Node 20
5. Deploy.

A partir de ahí, cada push a la rama principal redeploya automáticamente.

## Opción C — Netlify CLI (deploy desde tu terminal)

Útil si trabajas con feature branches o quieres URLs de preview.

```bash
npm install -g netlify-cli
netlify login                   # abre el navegador para autenticar
netlify init                    # primera vez: link site + config
npm run build
netlify deploy --dir=out        # deploy a una URL de preview
netlify deploy --dir=out --prod # deploy a producción
```

## Archivos que controlan el deploy

| Archivo | Para qué sirve |
|---|---|
| `next.config.ts` | `output: "export"` + `trailingSlash: true` + `images.unoptimized` |
| `netlify.toml` | `command`, `publish`, headers de seguridad y caché |
| `out/` | Bundle producido por `next build` (no versionar — está gitignored por defecto) |

## Configuración importante

- **Node**: el `netlify.toml` fuerza Node 20. Si más adelante el proyecto
  requiere otra versión, cambiar `NODE_VERSION` ahí.
- **Cache de assets**: `/_next/static/*` se sirve con `Cache-Control: immutable`
  (filenames son hash-based, se invalidan solos).
- **Headers de seguridad**: `X-Frame-Options: DENY`, `X-Content-Type-Options:
  nosniff`, etc. Si en el futuro embebes este sitio en un iframe (ej. dentro
  de otra app), tendrías que relajar `X-Frame-Options`.

## Datos sensibles

La app no envía nada a un backend. Todo lo que el usuario carga (Excel de stock,
Autos no entregados, gestiones por VIN) vive solo en el navegador del usuario y
en su `localStorage` local. **Netlify nunca ve esos datos**, solo sirve el
bundle HTML/JS estático.

Si en algún momento agregas un backend (API routes en Next o serverless de
Netlify), revisar este punto antes — ahí sí pasaría data por la red.

## Verificar localmente antes de deployar

```bash
npm run build
npx serve out -p 8080
# Abrir http://localhost:8080
```

`serve` (o cualquier servidor estático) simula bastante bien cómo Netlify
servirá el bundle. Si funciona ahí, funciona en producción.

## Pasos para tu deploy ahora

Lo más rápido:

1. `npm run build` (ya lo hice — la carpeta `out/` está lista).
2. Abrir https://app.netlify.com/drop
3. Arrastrar `out/` (está en `/Users/Daviid/stock-command-center/out/`).
4. Te dará una URL pública en ~30 segundos.

Si quieres URL custom, la cambias en Site Settings después.
