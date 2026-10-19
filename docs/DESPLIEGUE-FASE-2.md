# Despliegue de las Fases 2 y 3 (Control Bancario, conciliación, cobros y compras)

Incluye cuatro migraciones nuevas. Todas **solo agregan** tablas, columnas e índices; no borran ni cambian datos existentes:

| Migración | Qué agrega |
|---|---|
| `20261018235528_fase2a_control_bancario` | Cuentas bancarias, movimientos, archivos (comprobantes), umbral de revisión |
| `20261019001004_fase2b_conciliacion_extractos` | Extractos importados y sus líneas |
| `20261019032011_fase2c_pagos_y_ventas_web` | Pagos en partes (`ventaId`, `pagoEnPartes`), verificación de pedidos web |
| `20261019041735_fase3_compras_proveedores` | Proveedores, comprobantes de compra, su detalle y asignaciones de pago |

Render Free no tiene Shell: los comandos se corren **desde tu PC**, en `D:\JP\JP_Backend_NodeJS`, en PowerShell.

## 0. Antes de empezar

- Usa una terminal **nueva** (sin variables de otras sesiones).
- Ten a mano la conexión **directa** de Neon (la que NO dice `-pooler`).

## 1. Ensayo en una copia (Neon branch) — recomendado

1. En Neon: **Branches → Create branch** (por ejemplo `ensayo-fase2`) a partir de `main`.
2. Copia su cadena de conexión directa y en PowerShell:

```powershell
$env:DATABASE_URL = "postgresql://...ensayo-fase2..."
npx prisma migrate status          # debe listar SOLO las 4 migraciones de arriba como pendientes
npx prisma migrate deploy
npx prisma migrate diff --from-url "$env:DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```

El último comando debe responder `-- This is an empty migration.` Si muestra un `DROP`, **detente** y avisa.

## 2. Base real

Los mismos comandos con la cadena directa de la rama `main` de Neon:

```powershell
$env:DATABASE_URL = "postgresql://...main..."
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate diff --from-url "$env:DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
Remove-Item Env:DATABASE_URL
```

## 3. Variables en Render (Backblaze B2 para comprobantes)

En Render → servicio del backend → **Environment**, agrega:

Con estas cuatro variables el servidor usa B2 automáticamente:

| Variable | Valor |
|---|---|
| `B2_ENDPOINT` | el "Endpoint" del bucket (por ejemplo `https://s3.us-east-005.backblazeb2.com`) |
| `B2_BUCKET` | nombre del bucket (privado) |
| `B2_KEY_ID` | keyID de la Application Key |
| `B2_APPLICATION_KEY` | applicationKey (solo se muestra una vez al crearla) |

Sin estas variables, la subida de comprobantes responde con error (en producción no se guarda nada en el disco del servidor).

## 4. Publicar

Recién después de los pasos 1–3: unir `develop` en `main` en los dos repositorios (backend y frontend) y subir `main`. Render y el hosting del frontend despliegan solos.

## 5. Comprobaciones

- Panel → **Control Bancario**: crear la cuenta BCP (soles), registrar un movimiento de prueba con comprobante y anularlo.
- **Conciliación**: importar un extracto exportado de la banca por internet del BCP.
- **Ventas & Boletas**: registrar una venta pendiente, un adelanto y el pago del saldo; revisar que Caja Diaria muestre cada pago el día que se recibió.
- **Compras y Proveedores**: registrar un proveedor, una factura con su PDF y pagarla desde Cuentas por pagar.
- **Tienda web**: hacer un pedido de prueba; debe aparecer en "Pedidos web por verificar". Rechazarlo devuelve el stock.

## Qué cambió para el día a día

- Los pedidos de la tienda ya **no cuentan como venta** hasta que confirmas el pago (Ventas & Boletas → Pedidos web por verificar). Para Yape o transferencia hay que indicar la cuenta y el n.º de operación: una captura no basta.
- Los adelantos se registran con **Registrar pago**: entran a caja el día que se reciben y la venta muestra su saldo.
- Un cobro por transferencia o Yape puede registrarse a la vez en **Control Bancario**; ahí se concilia después con el extracto, sin sumarse dos veces como ingreso.
