const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log("Installing ubigeo-peru...");
const tmpDir = path.join(__dirname, 'tmp_ubigeo');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

try {
  execSync('npm init -y', { cwd: tmpDir });
  execSync('npm install ubigeo-peru', { cwd: tmpDir });
  
  const ubigeo = require('./tmp_ubigeo/node_modules/ubigeo-peru');
  
  // Create assets directory if missing
  const assetsDir = path.join(__dirname, '../JP_Frontend_React/src/assets');
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

  const outPath = path.join(assetsDir, 'ubigeo.json');
  
  // Just export the whole thing or formatted
  // ubigeo-peru package exports a single array `reniec` or similar. Let's see what it exports.
  fs.writeFileSync(outPath, JSON.stringify(ubigeo.reniec || ubigeo, null, 2));
  console.log("Successfully saved to: " + outPath);
} catch (e) {
  console.error("Error:", e);
}
