// Estabilidad: listas sin archivos pesados, fotos/videos por dirección y dashboard liviano.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { env, encenderBase, apagarBase, resetearBase, iniciarServidor, pedir, iniciarSesion, BASE } from './helpers.mjs';

let servidor;
let token;

// PNG de 1x1 píxel y un "video" de prueba de 64 KB
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const VIDEO_BYTES = Buffer.alloc(64 * 1024, 7);
const VIDEO = 'data:video/mp4;base64,' + VIDEO_BYTES.toString('base64');

before(async () => {
    await encenderBase();
    resetearBase();
    servidor = await iniciarServidor();
    token = await iniciarSesion('administrador', env.ADMIN_INITIAL_PASSWORD);
});

after(async () => {
    servidor?.detener();
    await apagarBase();
});

test('productos: las listas devuelven la dirección de la foto, no el archivo', async () => {
    const creado = await pedir('POST', '/inventario', { token, body: { sku: 'P-1', nombre: 'Pastilla', precio: 50, foto: PNG } });
    assert.equal(creado.status, 201, JSON.stringify(creado.data));
    assert.match(creado.data.foto, /\/api\/media\/producto\/\d+\/[0-9a-f]{32}$/);
    await pedir('PATCH', `/inventario/${creado.data.id}/toggle-web`, { token });

    for (const ruta of ['/inventario', '/web/productos-web']) {
        const r = await pedir('GET', ruta, { token });
        assert.equal(r.status, 200);
        const p = r.data.find(x => x.id === creado.data.id);
        assert.ok(p, `producto en ${ruta}`);
        assert.ok(!JSON.stringify(r.data).includes('base64'), `${ruta} no debe incluir archivos`);
        assert.equal(p.foto, creado.data.foto);
        assert.equal(p.fotoTipo, 'image/png');
    }

    // La dirección entrega la imagen real, con caché
    const img = await fetch(creado.data.foto);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.match(img.headers.get('cache-control'), /immutable/);
    assert.equal((await img.arrayBuffer()).byteLength, 70);
    // Con otra huella no entrega nada
    assert.equal((await fetch(creado.data.foto.replace(/[0-9a-f]{32}$/, '0'.repeat(32)))).status, 404);
    globalThis.__prod = creado.data;
});

test('productos: editar sin cambiar la foto la conserva; vaciarla la quita', async () => {
    const p = globalThis.__prod;
    const sinCambio = await pedir('PUT', `/inventario/${p.id}`, { token, body: { ...p, nombre: 'Pastilla delantera', foto: p.foto } });
    assert.equal(sinCambio.status, 200);
    assert.equal(sinCambio.data.foto, p.foto, 'la foto sigue siendo la misma');
    const quitar = await pedir('PUT', `/inventario/${p.id}`, { token, body: { ...p, foto: '' } });
    assert.equal(quitar.data.foto, null);
});

test('novedades: video por dirección, con pedidos por partes para poder adelantarlo', async () => {
    const creada = await pedir('POST', '/web/admin/novedades', { token, body: { titulo: 'Publicación', descripcion: ' ', imagen: VIDEO, estado: 'ACTIVO' } });
    assert.equal(creada.status, 201, JSON.stringify(creada.data));
    const lista = await pedir('GET', '/web/novedades');
    const n = lista.data.find(x => x.id === creada.data.id);
    assert.equal(n.imagenTipo, 'video/mp4');
    assert.ok(!JSON.stringify(lista.data).includes('base64'));

    const parte = await fetch(n.imagen, { headers: { Range: 'bytes=1000-1999' } });
    assert.equal(parte.status, 206);
    assert.equal(parte.headers.get('content-range'), `bytes 1000-1999/${VIDEO_BYTES.length}`);
    assert.equal((await parte.arrayBuffer()).byteLength, 1000);

    const fuera = await fetch(n.imagen, { headers: { Range: `bytes=${VIDEO_BYTES.length + 10}-` } });
    assert.equal(fuera.status, 416);

    const cache = await fetch(n.imagen, { headers: { 'If-None-Match': `"${n.imagen.split('/').pop()}"` } });
    assert.equal(cache.status, 304, 'el navegador puede reutilizar su copia');

    // Editar el texto sin tocar el video lo conserva
    const edit = await pedir('PUT', `/web/admin/novedades/${n.id}`, { token, body: { ...n, descripcion: 'Nuevo texto', imagen: n.imagen } });
    assert.equal(edit.data.imagen, n.imagen);
});

test('dashboard: responde con los totales sin cargar toda la historia', async () => {
    const r = await pedir('GET', '/dashboard', { token });
    assert.equal(r.status, 200);
    assert.ok(r.data.kpis);
    assert.ok(Array.isArray(r.data.chartData.ingresosData));
    assert.ok(Array.isArray(r.data.ultimasTxns));
});

test('la dirección de media no expone otros datos ni acepta tipos desconocidos', async () => {
    assert.equal((await fetch(`${BASE}/media/usuario/1/${'a'.repeat(32)}`)).status, 404);
    assert.equal((await fetch(`${BASE}/media/producto/abc/${'a'.repeat(32)}`)).status, 404);
});
