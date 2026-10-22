# invoicing-service

Facturación electrónica de Hacienda de Costa Rica (comprobantes v4.4) como servicio propio en NestJS.
Solo lo consume la API .NET de cotizadores (y nora): el navegador nunca llama a este servicio, porque
maneja el `.p12`.

```
Navegador -> Front Next.js -> API .NET --privado--> invoicing-service -> Hacienda
                                ^                         |
                                +---- webhook firmado ----+
```

## Arrancar en local

```bash
cp .env.example .env              # completar las llaves (openssl rand -hex 32)
docker compose up -d              # PostgreSQL 18 en el puerto 5434
npx prisma migrate deploy
npm run start:dev
```

Swagger UI queda en `http://localhost:3000/docs` (el JSON en `/docs-json`). Con **Authorize** se
cargan `x-admin-key` y `x-api-key` una vez y quedan guardadas al recargar.

La configuración se valida con class-validator al arrancar (`src/shared/infrastructure/config/config.schema.ts`): si falta algo, el
servicio no levanta. Ningún host ni credencial está en el código.

### Dar de alta un emisor y un consumidor

Las rutas de administración usan `x-admin-key` (`ADMIN_API_KEY`), separada de las llaves de los
consumidores.

```bash
# 1. Datos del emisor (el id lo eligen ustedes)
curl -X PUT localhost:3000/v1/emitters/crediride -H "x-admin-key: $ADMIN" -H 'content-type: application/json' \
  -d '{"identificationType":"02","identification":"3101123456","name":"...","activityCode":"791101",
       "province":"1","canton":"01","district":"01","otherSigns":"...","email":"..."}'

# 2. Llave criptográfica y usuario de API de ATV. Se comprueba que el .p12 abra con el PIN
#    y se guarda cifrado con AES-256-GCM (CERT_ENCRYPTION_KEY).
curl -X PUT localhost:3000/v1/emitters/crediride/certificate -H "x-admin-key: $ADMIN" -H 'content-type: application/json' \
  -d "{\"certificateBase64\":\"$(base64 -i llave.p12)\",\"pin\":\"...\",\"apiUser\":\"...\",\"apiPassword\":\"...\"}"

# 3. Un consumidor con los emisores que puede usar. La llave se muestra una sola vez.
curl -X POST localhost:3000/v1/clients -H "x-admin-key: $ADMIN" -H 'content-type: application/json' \
  -d '{"name":"cotizadores","emitterIds":["crediride"],"webhookUrl":"https://api.../webhooks/invoicing"}'
```

## API

Todas las rutas `v1/` (salvo administración y el callback) piden `x-api-key`.

| Método | Ruta | Uso |
|---|---|---|
| POST | `/v1/documents` | Emitir factura (01) o tiquete (04). Header `Idempotency-Key` obligatorio |
| GET | `/v1/documents/:id` · `/v1/documents?externalReference=` | Estado |
| GET | `/v1/documents/:id/xml` · `/response-xml` · `/pdf` | XML firmado, MensajeHacienda y PDF (solo aceptados) |
| POST | `/v1/documents/:id/credit-notes` | Nota de crédito (03), total o parcial, con `Idempotency-Key` |
| GET | `/v1/taxpayers/:identification` | Contribuyente (caché de 1 h) |
| GET | `/v1/cabys?q=` | Búsqueda CABYS (caché de 24 h) |
| PUT | `/v1/emitters/:id` · `/v1/emitters/:id/certificate` | Administración |
| POST · PUT | `/v1/clients` · `/v1/clients/:id` | Administración de consumidores |
| POST | `/v1/hacienda/callback` | callbackUrl de Hacienda; solo adelanta el sondeo |
| GET | `/health` | Terminus, con ping a la base |

### Emitir

```json
POST /v1/documents
Idempotency-Key: <id de la orden>

{
  "emitterId": "crediride",
  "documentType": "01",
  "externalReference": "CR-180054",
  "currency": "USD",
  "paymentMethod": "02",
  "receiver": { "name": "...", "identificationType": "01", "identification": "114560789", "email": "..." },
  "lines": [
    { "cabys": "8551100000000", "description": "Reserva de vuelo", "quantity": 1, "unitPrice": "350.00", "taxRateCode": "10" }
  ],
  "total": "350.00"
}
```

- `unitPrice` va **sin IVA**. El servicio calcula cada línea y el resumen en `Decimal`; `total` es lo
  que cobró quien llama y solo se compara (a dos decimales). Si no calza, la respuesta es **422** con
  el total calculado.
- `taxRateCode` es el `CodigoTarifaIVA` de v4.4 (08 = 13 %, 10 = exenta, …). Solo el 10 suma en los
  totales exentos; los demás, incluidos los de 0 %, suman en gravados.
- En USD el `TipoCambio` es el de venta del BCCR del día (`/indicadores/tc/dolar`).
- La respuesta es **202** con `{ id, key, consecutive, status, ... }`. `Signed` o `Sent` todavía no es
  aceptada: el resultado llega por webhook.

### Webhook

Al llegar a `Accepted`, `Rejected` o `Error` se hace `POST` al `webhookUrl` del consumidor con el
header `x-invoicing-signature: sha256=<hex>`, que es el HMAC-SHA256 de los **bytes crudos** del cuerpo
con `WEBHOOK_SECRET`. El `id` del evento es `<documentId>:<status>`: es estable entre reintentos, para
procesarlo una sola vez. Se reintenta con espera creciente hasta 15 veces.

## Cómo está resuelto lo que fallaba en nora_control

| Problema | Aquí |
|---|---|
| Consecutivo leído y después escrito | `INSERT … ON CONFLICT DO UPDATE … RETURNING` en la misma transacción que guarda el documento (`consecutive-number.ts`) |
| Tres fechas distintas | Un solo `DateTime` en `America/Costa_Rica` para la clave, `FechaEmision` y el JSON de recepción |
| IVA fijo de 13 % y totales del llamador | IVA por línea y totales recalculados (`totals-calculator.ts`) |
| Siempre CRC y efectivo | `CodigoTipoMoneda` con `TipoCambio`, y `MedioPago` según el pago real |
| Montos en `number` | `decimal.js` y `Decimal(18,5)` en PostgreSQL |
| Credenciales en texto plano | `.p12`, PIN y usuario de ATV cifrados con AES-256-GCM; nunca salen en respuestas ni logs |
| Sin notas de crédito | `credit-notes` con `InformacionReferencia`; el original queda bloqueado mientras se comprueba que no se acredite de más |
| Firma con `haciendacostarica-signer` | `xadesjs` + `node-forge` + WebCrypto nativa de Node, sin silenciar `console.log` |
| `ProveedorSistemas` con la cédula del emisor | `SOFTWARE_PROVIDER_ID`, la cédula de quien desarrolla el software |

Un timeout o un 5xx al enviar es ambiguo: antes de reenviar se consulta la clave; un 404 significa
que no llegó y se reenvía **con la misma clave**. El sondeo (`@Cron` cada minuto) toma los documentos
con `FOR UPDATE SKIP LOCKED`, así que varias réplicas no trabajan el mismo documento.

## Pruebas

```bash
npm test             # unitarias + XSD (firma un .p12 de prueba y valida contra los XSD v4.4)
npm run test:e2e     # Testcontainers + PostgreSQL 18: concurrencia, idempotencia, envío y webhooks
npm run test:sandbox # contra el sandbox real de Hacienda; ver variables en test/hacienda-sandbox.e2e-spec.ts
```

Los XSD de `src/documents/infrastructure/xml/xsd/` son los v4.4 oficiales (el CDN de Hacienda los sirve con 403
fuera del navegador; se tomaron de una copia pública). Solo se cambió la ruta del `import` de
`xmldsig-core-schema.xsd`.

## Pendiente

- **La pregunta al contador** (regla 32): qué `CodigoTarifaIVA` lleva cada servicio. El servicio
  acepta el código por línea; la tabla la decide cotizadores. CABYS ya sugiere algo: "Servicios de
  seguros de viaje" (7133700000000) figura con 2 %, no 13 %.
- **`CodigoReferencia` de la nota de crédito parcial**: por defecto 01 (anula) si es total y 04 si
  es parcial; se puede mandar `referenceCode`. Confirmarlo con el contador.
- **Política de firma**: URI y hash SHA-256 de la resolución v4.4 en `xades-signer.ts`. Si el sandbox
  rechaza la firma, es lo primero que hay que revisar.
- No soporta descuentos, exoneraciones, otros cargos ni líneas no sujetas.
