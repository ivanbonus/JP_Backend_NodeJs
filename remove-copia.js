const fs = require('fs');
let content = fs.readFileSync('src/controllers/cotizacion.controller.ts', 'utf8');
content = content.replace('nombre: original.nombre + " (Copia)",', 'nombre: original.nombre,');
fs.writeFileSync('src/controllers/cotizacion.controller.ts', content, 'utf8');
