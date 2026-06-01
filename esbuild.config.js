// @ts-check
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');
const isProd = !isWatch;

// Ensure dist/ exists
if (!fs.existsSync('dist')) fs.mkdirSync('dist', { recursive: true });

// Copy static assets into dist/ (manifest references these by filename)
const STATIC = [
  'manifest.json',
  'popup.html',
  'background.js',
  'translations.js',
  'xlsx.full.min.js',
  'icon16.png',
  'icon48.png',
  'icon128.png',
];
for (const file of STATIC) {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join('dist', file));
    console.log(`copied → dist/${file}`);
  }
}

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: {
    popup: 'src/popup.ts',
    content: 'content.ts',
  },
  bundle: true,
  outdir: 'dist',
  target: 'chrome120',
  format: 'iife',
  minify: isProd,
  sourcemap: isWatch ? 'inline' : false,
  logLevel: 'info',
};

if (isWatch) {
  esbuild.context(config).then(ctx => {
    ctx.watch();
    console.log('Watching for changes…');
  });
} else {
  esbuild.build(config)
    .then(() => console.log('Build complete → dist/'))
    .catch(() => process.exit(1));
}
