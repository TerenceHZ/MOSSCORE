import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { drawAppIcon, icoFromPng } = require('../electron/icon.cjs');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build');
mkdirSync(buildDir, { recursive: true });

const png256 = drawAppIcon(256);
const png512 = drawAppIcon(512);
writeFileSync(path.join(buildDir, 'icon.png'), png512);
writeFileSync(path.join(buildDir, 'icon-256.png'), png256);
writeFileSync(path.join(buildDir, 'icon.ico'), icoFromPng(png256));
console.log('[550C] build/icon.png, build/icon.ico written');
