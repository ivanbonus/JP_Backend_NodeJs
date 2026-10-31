# Despliegue de la Fase 5A (inventario: recepción de mercadería y costos)

Incluye una migración que **solo agrega** columnas e índices; no borra ni cambia datos existentes:

| Migración | Qué agrega |
|---|---|
| `20261031212522_fase5a_costos_y_recepcion` | Porcentaje de alza de costo (10 % por defecto), unidades por caja y marca "no es mercadería" en las líneas de compra, y trazabilidad de los movimientos de inventario (responsable, stock resultante, costo, factura de origen, reversiones) |

Los movimientos de inventario antiguos quedan como están (sin responsable ni stock resultante): la ficha lo indica.

## 1. Base real (desde tu PC, en `D:\JP\JP_Backend_NodeJS`)

```powershell
$env:DATABASE_URL = "postgresql://...main... (conexión directa, sin -pooler)"
npx prisma migrate status          # debe listar SOLO la migración de arriba como pendiente
npx prisma migrate deploy
npx prisma migrate diff --from-url "$env:DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
Remove-Item Env:DATABASE_URL
```

El último comando debe responder `-- This is an empty migration.`

## 2. Publicar

Unir `develop` en `main` en los dos repositorios (primero el backend) y subir `main`.

## Qué cambió para el día a día

- **Registrar una factura de compra no suma stock.** Al llegar la mercadería: Compras → abrir la factura → **Recibir mercadería**. Se puede recibir una parte y el resto después.
- Si la factura trae **cajas o paquetes**, se indica cuántas unidades trae cada una: el stock sube en unidades y los costos se comparan por unidad.
- Fletes y servicios dentro de una factura se marcan como **"No es mercadería"**.
- El botón **Registrar Ingreso** de Inventario avisa si el producto tiene mercadería facturada sin recibir (para no sumarla dos veces).
- El ojo de cada producto abre su **ficha**: movimientos, compras, historial de costos, proveedores y margen bruto estimado.
- Cambiar el stock al editar un producto queda registrado como **ajuste** en el historial.
