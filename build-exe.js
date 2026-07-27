/**
 * build-exe.js - Generador de Ejecutable Standalone DuoPlayX para Windows
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

console.log('✨ Generando ejecutable DuoPlayX y accesos directos para Windows...');

const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Iniciar-DuoPlayX.bat
const batContent = `@echo off
title DuoPlayX Server & Client
color 0B
echo =======================================================
echo     ✨ INICIANDO DUOPLAYX - LOCAL SERVER
echo =======================================================
echo.
echo Servidor iniciando en: http://localhost:3000
echo.

start "" "http://localhost:3000"
cmd /c npm start

pause
`;

fs.writeFileSync(path.join(__dirname, 'Iniciar-DuoPlayX.bat'), batContent, 'utf-8');
console.log('✅ Archivo de inicio rapido generado: Iniciar-DuoPlayX.bat');

console.log('📦 Empaquetando ejecutable independiente mediante pkg...');

const pkgCmd = `cmd /c npx -y @yao-pkg/pkg . --targets node18-win-x64 --output dist/DuoPlayX.exe`;

exec(pkgCmd, { cwd: __dirname }, (error, stdout, stderr) => {
  if (error) {
    console.log('⚠️ Aviso durante empaquetado pkg (puedes usar Iniciar-DuoPlayX.bat directamente):', error.message);
  } else {
    console.log(stdout);
    console.log('🎉 ¡Ejecutable independiente creado con exito en: dist/DuoPlayX.exe!');
  }
});
