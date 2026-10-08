/**
 * tools/empacotar.js — run with:  node tools/empacotar.js
 * -----------------------------------------------------------------------------
 * NOT part of the extension, and NOT a build step. The repository runs as it
 * stands: Load unpacked in a Chromium browser and Load Temporary Add-on in
 * Firefox both read the one manifest.json directly, and nothing here is needed
 * to develop or test. Delete this file and everything still works except making the two
 * store uploads.
 *
 * WHY IT EXISTS. No single MV3 manifest is valid in both browsers today, and
 * the whole difference is the background block:
 *   - Chromium (Chrome, Edge, Brave, Opera…) accepts only
 *     `background.service_worker`; `scripts` is an MV2 key, warned about on
 *     Load unpacked and refused by the Chrome Web Store.
 *   - Firefox accepts only `background.scripts` (it runs the same file as an
 *     event page, not a service worker); a manifest with only
 *     `service_worker` does not load there.
 * The source manifest therefore declares BOTH, which is right for development
 * and wrong for either store. This script derives one package per store from
 * that single source, removing exactly the keys the other browser needs:
 *   - chromium: drops `background.scripts` and `browser_specific_settings`
 *               (Chromium reports the latter as an unrecognised key).
 *   - firefox: drops `background.service_worker`.
 * Every other byte is copied unchanged. There is deliberately no second
 * manifest file in the repository; the list of differences lives here and
 * nowhere else.
 *
 * WHAT GOES IN: manifest.json, icons/ and src/ — nothing else. tools/,
 * reference/ (the government's own code, never ours to distribute) and the
 * docs stay out. Before writing anything it checks that every path the
 * manifest names exists, so a renamed file fails here rather than in review.
 *
 * Output: dist/<nome>-<browser>-<version>.zip, manifest at the zip root, as
 * both stores require. Dependency-free: the zip is written by hand with
 * node:zlib, and entries carry a fixed timestamp so the same tree always
 * produces the same bytes.
 * -----------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const raiz = path.join(__dirname, '..');
const destino = path.join(raiz, 'dist');
const NOME = 'assistente-nfpr';
const INCLUIR = ['manifest.json', 'icons', 'src'];

function falhar(msg) {
  console.error('empacotar: ' + msg);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// The two manifests
// ---------------------------------------------------------------------------

const fonte = JSON.parse(fs.readFileSync(path.join(raiz, 'manifest.json'), 'utf8'));
if (fonte.manifest_version !== 3) falhar('manifest_version is not 3');
if (!fonte.background || !fonte.background.service_worker || !Array.isArray(fonte.background.scripts)) {
  falhar('manifest.json must declare background.service_worker AND background.scripts');
}

function manifestoChromium() {
  const m = structuredClone(fonte);
  m.background = { service_worker: fonte.background.service_worker };
  delete m.browser_specific_settings;
  return m;
}

// AMO refuses every new submission without a data collection declaration
// (required since 2025-11-03). It lives in the source manifest rather than
// being added here, because it is a statement about the extension, not a
// difference between browsers — but a package without it is a package the
// store will bounce, so its absence fails here. `["none"]` is the claim DOCS.md
// makes under *Permissions*, and PRIVACIDADE.md makes to the public: nothing
// leaves the browser except the requests Nota Paraná's own page makes. Change
// the three together.
function manifestoFirefox() {
  const m = structuredClone(fonte);
  m.background = { scripts: fonte.background.scripts.slice() };
  const gecko = m.browser_specific_settings && m.browser_specific_settings.gecko;
  const coleta = gecko && gecko.data_collection_permissions;
  if (!coleta || !Array.isArray(coleta.required) || !coleta.required.length) {
    falhar('manifest.json lacks browser_specific_settings.gecko.data_collection_permissions.required (AMO refuses it)');
  }
  return m;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function listar(rel) {
  const abs = path.join(raiz, rel);
  if (!fs.existsSync(abs)) falhar('missing ' + rel);
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs).sort().flatMap((n) => listar(path.posix.join(rel, n)));
}

const arquivos = INCLUIR.flatMap(listar);
const presentes = new Set(arquivos);

// Every path the manifest names must be inside the package.
function referenciados(m) {
  const r = [];
  const icones = (o) => o && Object.values(o).forEach((p) => r.push(p));
  icones(m.icons);
  if (m.action) { icones(m.action.default_icon); if (m.action.default_popup) r.push(m.action.default_popup); }
  if (m.background) {
    if (m.background.service_worker) r.push(m.background.service_worker);
    (m.background.scripts || []).forEach((p) => r.push(p));
  }
  (m.content_scripts || []).forEach((c) => (c.js || []).concat(c.css || []).forEach((p) => r.push(p)));
  (m.web_accessible_resources || []).forEach((w) => (w.resources || []).forEach((p) => r.push(p)));
  return r;
}
const faltando = referenciados(fonte).filter((p) => !presentes.has(p));
if (faltando.length) falhar('manifest.json names files that do not exist:\n  ' + faltando.join('\n  '));

// ---------------------------------------------------------------------------
// Zip writer (store or deflate, no extras)
// ---------------------------------------------------------------------------

const TABELA_CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 2026-01-01 00:00, DOS format. Fixed so identical trees zip identically.
const DOS_HORA = 0;
const DOS_DATA = ((2026 - 1980) << 9) | (1 << 5) | 1;

function zipar(entradas) {
  const partes = [];
  const central = [];
  let deslocamento = 0;

  for (const { nome, dados } of entradas) {
    const nomeBuf = Buffer.from(nome, 'utf8');
    const comprimido = zlib.deflateRawSync(dados, { level: 9 });
    const usarDeflate = comprimido.length < dados.length;
    const corpo = usarDeflate ? comprimido : dados;
    const metodo = usarDeflate ? 8 : 0;
    const crc = crc32(dados);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(DOS_HORA, 10);
    local.writeUInt16LE(DOS_DATA, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(corpo.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nomeBuf.length, 26);
    local.writeUInt16LE(0, 28);
    partes.push(local, nomeBuf, corpo);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(metodo, 10);
    cd.writeUInt16LE(DOS_HORA, 12);
    cd.writeUInt16LE(DOS_DATA, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(corpo.length, 20);
    cd.writeUInt32LE(dados.length, 24);
    cd.writeUInt16LE(nomeBuf.length, 28);
    cd.writeUInt32LE(deslocamento, 42);
    central.push(cd, nomeBuf);

    deslocamento += local.length + nomeBuf.length + corpo.length;
  }

  const cdBuf = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(cdBuf.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...partes, cdBuf, fim]);
}

// ---------------------------------------------------------------------------
// Build both
// ---------------------------------------------------------------------------

fs.mkdirSync(destino, { recursive: true });

for (const [navegador, manifesto] of [['chromium', manifestoChromium()], ['firefox', manifestoFirefox()]]) {
  const entradas = arquivos.map((rel) => ({
    nome: rel,
    dados: rel === 'manifest.json'
      ? Buffer.from(JSON.stringify(manifesto, null, 2) + '\n', 'utf8')
      : fs.readFileSync(path.join(raiz, rel)),
  }));
  const saida = path.join(destino, `${NOME}-${navegador}-${fonte.version}.zip`);
  fs.writeFileSync(saida, zipar(entradas));
  console.log(`${path.relative(raiz, saida)}  (${entradas.length} files, background: ${Object.keys(manifesto.background).join(', ')})`);
}
