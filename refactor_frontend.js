const fs = require('fs');

function walk(dir) {
    let results = [];
    let list;
    try { list = fs.readdirSync(dir); } catch(e) { return results; }
    list.forEach(f => {
        let file = dir + '/' + f;
        let stat = fs.statSync(file);
        if (stat && stat.isDirectory()) results = results.concat(walk(file));
        else if (file.endsWith('.tsx') || file.endsWith('.ts')) results.push(file);
    });
    return results;
}

const files = walk('d:/JP/JP_Frontend_React/src');
let count = 0;

files.forEach(f => {
    let content = fs.readFileSync(f, 'utf8');
    let original = content;
    
    // api.ts case
    if (f.endsWith('api.ts')) {
        content = content.replace(/baseURL:\s*['"`]http:\/\/localhost:3000\/api['"`]/g, 'baseURL: import.meta.env.VITE_API_URL || "http://localhost:3000/api"');
    } else {
        // generic case
        let regex = /["'`]http:\/\/localhost:3000\/api([^"'`]*)["'`]/g;
        content = content.replace(regex, '`${import.meta.env.VITE_API_URL || "http://localhost:3000/api"}$1`');
    }

    // AdminDashboard configuration URL mapping
    if(f.endsWith('AdminDashboard.tsx')) {
        let regex2 = /["'`]http:\/\/localhost:3000\/api\/configuracion([^"'`]*)["'`]/g;
        content = content.replace(regex2, '`${import.meta.env.VITE_API_URL || "http://localhost:3000/api"}/configuracion$1`');
    }

    if (original !== content) {
        fs.writeFileSync(f, content, 'utf8');
        console.log('Updated', f);
        count++;
    }
});
console.log('Total files updated:', count);
