const axios = require('axios');
const fs = require('fs');

async function testPdf() {
    try {
        console.log('Requesting PDF...');
        const res = await axios.post('http://localhost:3000/api/cotizaciones/pdf', {
            clienteNombre: 'TEST CLIENTE',
            cotizacionNumero: 'TEST-123',
            productos: [
                { codigo: 'PROD1', cantidad: 2, descripcion: 'Prueba', precioUnitario: 50, importe: 100 }
            ],
            totalImporte: 100,
            mostrarPreciosUnitarios: true,
            mostrarTotal: true
        }, { responseType: 'arraybuffer' });
        
        fs.writeFileSync('test_manual.pdf', res.data);
        console.log('PDF saved as test_manual.pdf, size:', res.data.length);
    } catch (err) {
        console.error('Error generating PDF:', err.response ? err.response.data.toString() : err.message);
    }
}

testPdf();
