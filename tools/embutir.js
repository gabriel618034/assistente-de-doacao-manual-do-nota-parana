/**
 * tools/embutir.js — run with:  node tools/embutir.js
 * -----------------------------------------------------------------------------
 * NOT part of the extension, and NOT a build step. It writes ONE plain script,
 * dist/assistente-nfpr-<version>.js, that runs the donation registrar inside
 * the official page itself, with no extension installed — for the day Nota
 * Paraná carries the assistant natively. Delete this file and the extension is
 * untouched.
 *
 * WHAT IT DOES. Nothing clever, which is the point: every module is already an
 * IIFE hanging off NFPR, ordered by manifest.json, so the browser's own
 * behaviour is reproduced by pasting the files together in that order. Each one
 * goes in under a banner naming it, unchanged but for its comments (see
 * below), so the output reads like the source and an error can be traced back
 * to its file.
 *
 *   1. A stand-in for the three extension APIs the page code uses —
 *      storage.local (get/set/remove/clear), storage.onChanged and
 *      runtime.getURL — over localStorage. It is a LOCAL `chrome`, declared
 *      inside the wrapper, so browser.js picks it up and the page's own
 *      `window.chrome` is never touched.
 *   2. host-page.js, run at once. The extension runs it at document_start; here
 *      that means the script tag must sit in <head>, which is before <body> is
 *      parsed and so still in time to hide #main and #header before they paint.
 *   3. Every other module of the donation page, run at DOMContentLoaded — the
 *      extension's document_idle. Placed LAST in <head>, its listener registers
 *      after jQuery's, so the site's own $(document).ready handlers (the entity
 *      dialog among them) have run first, exactly as they do under the
 *      extension.
 *
 * WHAT IT DOES NOT. The ContaCorrente bounce-back, the offline page, the
 * toolbar badge and popup, and the offline redirect are not included: the
 * first is a second page, and the rest exist only because this is an
 * extension.
 *
 * THE STYLESHEETS RIDE INSIDE IT, and no source file changes to make that
 * work: ui.js fetch()es its five stylesheets through NFPR.url, and the
 * stand-in's getURL answers with data: URLs built from the embedded text. A
 * page whose Content-Security-Policy refuses data: for connect-src will need
 * it allowed. THE ICONS DO NOT: dom.js points an <img> at the extension's two
 * PNGs, and here every .png is answered with a ~400-character SVG of a blue
 * sky over a green hill (ICONE), so the output stays one file.
 *
 * EACH MODULE IS ITS OWN try/catch. As separate content scripts, one file
 * throwing at load leaves the next file running; pasted into one function, it
 * would end everything after it. The catch keeps the old behaviour and names
 * the file in the console.
 *
 * Storage is localStorage, so it is per ORIGIN and per browser profile — the
 * same scope chrome.storage had per profile, and like it shared by everyone who
 * uses that browser. Keys are the extension's own (all `nfpr:`), and clear()
 * removes only those.
 *
 * The result is compiled once with node:vm before it is written, so a broken
 * concatenation fails here and not on the government page. Dependency-free.
 *
 * COMMENTS ARE STRIPPED BY DEFAULT, from the modules, the stand-in and the
 * stylesheets. More than half the source is comments: without them the file
 * is well under half the size, and gzip brings it to about a quarter of that.
 * Code, strings and line structure are otherwise left as they are, so the
 * output still reads, just without the reasons. The per-file banners stay,
 * being the only way to tell the modules apart.
 *
 * OPTIONS
 *   --comentado   keep every comment, and write ...-<version>-comentado.js
 *                 instead: the source verbatim, for reading or debugging.
 *
 * The stripper is a small lexer (strings, template literals with their ${…}
 * nesting, regular expression literals), not a regex over the text: a URL in a
 * string has a `//` in it, and so do regexes that match one. Each stripped
 * module is compiled on its own as well, so a misread names its file.
 * -----------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const destino = path.join(raiz, 'dist');
const NOME = 'assistente-nfpr';
const PAGINA = 'DoacaoDocumentoFiscalCadastrar';

function falhar(msg) {
  console.error('embutir: ' + msg);
  process.exit(1);
}

const OPCOES = ['--comentado'];
const argumentos = process.argv.slice(2);
const desconhecidos = argumentos.filter((a) => OPCOES.indexOf(a) === -1);
if (desconhecidos.length) falhar('unknown option ' + desconhecidos.join(' ') + ' (known: ' + OPCOES.join(' ') + ')');
const COMENTADO = argumentos.indexOf('--comentado') !== -1;
const SEM_COMENTARIOS = !COMENTADO;

// ---------------------------------------------------------------------------
// Comment stripping
// ---------------------------------------------------------------------------

// A comment that is alone on its line takes the line with it; one beside code
// leaves the code, and a block comment between two tokens becomes a space so
// they cannot fuse. Only whitespace OUTSIDE strings is ever touched, which is
// why blank-line collapsing happens here rather than as a pass over the text.
function tirarComentario(saida, fonte, inicio, fim, bloco) {
  const linha = saida.lastIndexOf('\n') + 1;
  const sozinho = saida.slice(linha).trim() === '';
  const depois = /^[ \t]*(\r?\n|$)/.exec(fonte.slice(fim));
  if (sozinho && depois) return { saida: saida.slice(0, linha), i: fim + depois[0].length };
  if (!bloco) return { saida: saida.replace(/[ \t]+$/, ''), i: fim };
  const colado = !/\s$/.test(saida) && !/^\s/.test(fonte.slice(fim));
  return { saida: saida + (colado ? ' ' : ''), i: fim };
}

// After these, a `/` starts a regular expression; after a value it divides.
const ANTES_DE_REGEX = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await'
]);

function semComentariosJs(fonte, nome) {
  let saida = '';
  let i = 0;
  let valor = false; // was the last token a value (so `/` divides)?
  const pilha = []; // brace depths of open ${…} inside template literals
  const n = fonte.length;

  function lerTemplate() {
    // at the opening backtick, or just after a `}` closing a substitution
    while (i < n) {
      const c = fonte[i];
      if (c === '\\') { saida += fonte.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { saida += c; i++; valor = true; return; }
      if (c === '$' && fonte[i + 1] === '{') { saida += '${'; i += 2; pilha.push(0); valor = false; return; }
      saida += c; i++;
    }
    falhar(nome + ': unterminated template literal');
  }

  while (i < n) {
    const c = fonte[i];
    const d = fonte[i + 1];
    if (c === '/' && d === '/') {
      let fim = fonte.indexOf('\n', i);
      if (fim === -1) fim = n;
      ({ saida, i } = tirarComentario(saida, fonte, i, fim, false));
      continue;
    }
    if (c === '/' && d === '*') {
      const fim = fonte.indexOf('*/', i + 2);
      if (fim === -1) falhar(nome + ': unterminated block comment');
      ({ saida, i } = tirarComentario(saida, fonte, i, fim + 2, true));
      continue;
    }
    if (c === '/' && !valor) {
      let j = i + 1;
      let classe = false;
      while (j < n) {
        const r = fonte[j];
        if (r === '\\') { j += 2; continue; }
        if (r === '\n') falhar(nome + ': a regular expression runs off its line at ' + i);
        if (classe) { if (r === ']') classe = false; }
        else if (r === '[') classe = true;
        else if (r === '/') break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(fonte[j])) j++;
      saida += fonte.slice(i, j); i = j; valor = true;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && fonte[j] !== c) j += fonte[j] === '\\' ? 2 : 1;
      saida += fonte.slice(i, j + 1); i = j + 1; valor = true;
      continue;
    }
    if (c === '`') { saida += c; i++; lerTemplate(); continue; }
    if (/[A-Za-z0-9_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(fonte[j])) j++;
      const palavra = fonte.slice(i, j);
      // `.delete` or `.in` is a property name, not the keyword.
      const propriedade = /\.\s*$/.test(saida);
      saida += palavra; i = j; valor = propriedade || !ANTES_DE_REGEX.has(palavra);
      continue;
    }
    if (pilha.length && c === '{') { pilha[pilha.length - 1]++; }
    if (pilha.length && c === '}') {
      if (pilha[pilha.length - 1] === 0) { pilha.pop(); saida += c; i++; lerTemplate(); continue; }
      pilha[pilha.length - 1]--;
    }
    saida += c; i++;
    if (!/\s/.test(c)) valor = c === ')' || c === ']';
  }
  if (pilha.length) falhar(nome + ': unterminated ${ } in a template literal');
  return saida;
}

function semComentariosCss(fonte, nome) {
  let saida = '';
  let i = 0;
  while (i < fonte.length) {
    const c = fonte[i];
    if (c === '/' && fonte[i + 1] === '*') {
      const fim = fonte.indexOf('*/', i + 2);
      if (fim === -1) falhar(nome + ': unterminated comment');
      ({ saida, i } = tirarComentario(saida, fonte, i, fim + 2, true));
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < fonte.length && fonte[j] !== c) j += fonte[j] === '\\' ? 2 : 1;
      saida += fonte.slice(i, j + 1); i = j + 1;
      continue;
    }
    saida += c; i++;
  }
  return saida;
}

const js = (texto, nome) => (SEM_COMENTARIOS ? semComentariosJs(texto, nome) : texto);
const css = (texto, nome) => (SEM_COMENTARIOS ? semComentariosCss(texto, nome) : texto);

const ler = (rel) => {
  const abs = path.join(raiz, rel);
  if (!fs.existsSync(abs)) falhar('missing ' + rel);
  return fs.readFileSync(abs);
};

// ---------------------------------------------------------------------------
// What the manifest says runs on the donation page
// ---------------------------------------------------------------------------

const manifesto = JSON.parse(ler('manifest.json').toString('utf8'));
const daPagina = (manifesto.content_scripts || []).filter((c) =>
  (c.matches || []).some((m) => m.includes(PAGINA))
);
const fase = (quando) => daPagina.filter((c) => c.run_at === quando).flatMap((c) => c.js || []);
const noInicio = fase('document_start');
const noFim = fase('document_idle');
if (!noInicio.length || !noFim.length) {
  falhar('manifest.json no longer declares a document_start AND a document_idle block for ' + PAGINA);
}

// What the page code can ask NFPR.url for. The stylesheets ride inside the
// script, as text. The icons do NOT: they are the extension's own toolbar
// art, base64 makes them a third bigger and it barely compresses, so every
// .png is answered with ICONE instead. entrada.html is the offline page,
// reached by the service worker's redirect, which is not carried here.
const acessiveis = (manifesto.web_accessible_resources || []).flatMap((w) => w.resources || []);
const recursos = acessiveis.filter((p) => path.extname(p) === '.css');

// A rounded square, blue sky over a green hill with a yellow rim, traced from
// the maintainer's 1024px artwork onto a 64-unit grid (corner radius 9.5).
// Colours are the artwork's own averages. Rendered at 256px against the
// original, 1.9% of pixels differ, nearly all on antialiased edges. An SVG
// because it stays sharp at every size the mark is drawn at.
const ICONE = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<clipPath id="c"><rect width="64" height="64" rx="9.5"/></clipPath><g clip-path="url(#c)">' +
  '<path fill="#0166ad" d="M0 0h64v64H0z"/>' +
  '<path fill="#eee111" d="M0 39.3C13.8 31.3 26.3 26.3 38.1 26.2 50 26.1 59.4 30 64 34.8V64H0z"/>' +
  '<path fill="#12923d" d="M0 40.1C13.8 32.5 26.9 28.1 40 28.1 51.3 28.1 60 32.5 64 36.8V64H0z"/>' +
  '</g></svg>'
);

// ---------------------------------------------------------------------------
// The stand-in for the extension APIs
// ---------------------------------------------------------------------------
// Written as a real function so node parses it when this script loads; it is
// copied into the output with toString(). It must stay self-contained.

function criarApi(recursos, icone) {
  var PREFIXO = 'nfpr:';
  var ouvintes = [];

  function ler(k) {
    var bruto = localStorage.getItem(k);
    return bruto === null ? undefined : JSON.parse(bruto);
  }
  function chaves() {
    var r = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(PREFIXO) === 0) r.push(k);
    }
    return r;
  }
  // chrome.storage fires asynchronously and only for keys whose value
  // actually changed; both are kept, the second because a listener that
  // writes on change would otherwise feed itself.
  function avisar(mudancas) {
    if (!Object.keys(mudancas).length) return;
    Promise.resolve().then(function () {
      ouvintes.slice().forEach(function (fn) {
        try { fn(mudancas, 'local'); } catch (e) { console.error('[assistente-nfpr] onChanged', e); }
      });
    });
  }
  function mudar(k, novo) {
    var antes = localStorage.getItem(k);
    var depois = novo === undefined ? null : JSON.stringify(novo);
    if (antes === depois) return null;
    if (depois === null) localStorage.removeItem(k);
    else localStorage.setItem(k, depois);
    return { oldValue: antes === null ? undefined : JSON.parse(antes), newValue: novo };
  }
  function aplicar(pares) {
    var mudancas = {};
    Object.keys(pares).forEach(function (k) {
      var m = mudar(k, pares[k]);
      if (m) mudancas[k] = m;
    });
    avisar(mudancas);
  }

  // Another tab wrote: chrome.storage.onChanged reaches every page of the
  // profile, and the registrars rely on it (a config change in one tab
  // repaints the other). localStorage's own event is that, for other tabs.
  window.addEventListener('storage', function (e) {
    if (!e.key || e.key.indexOf(PREFIXO) !== 0) return;
    var m = {};
    m[e.key] = {
      oldValue: e.oldValue === null ? undefined : JSON.parse(e.oldValue),
      newValue: e.newValue === null ? undefined : JSON.parse(e.newValue)
    };
    avisar(m);
  });

  // `async` everywhere so a localStorage that throws (quota, blocked site
  // data) becomes a rejected promise, which is what config.js already handles.
  var local = {
    get: async function (pedido) {
      var r = {};
      if (pedido == null) {
        chaves().forEach(function (k) { r[k] = ler(k); });
      } else if (typeof pedido === 'string' || Array.isArray(pedido)) {
        [].concat(pedido).forEach(function (k) {
          var v = ler(k);
          if (v !== undefined) r[k] = v;
        });
      } else {
        Object.keys(pedido).forEach(function (k) {
          var v = ler(k);
          r[k] = v === undefined ? pedido[k] : v;
        });
      }
      return r;
    },
    set: async function (pares) { aplicar(pares || {}); },
    remove: async function (k) {
      var pares = {};
      [].concat(k).forEach(function (c) { pares[c] = undefined; });
      aplicar(pares);
    },
    clear: async function () {
      var pares = {};
      chaves().forEach(function (k) { pares[k] = undefined; });
      aplicar(pares);
    }
  };

  // A stylesheet is answered from the text inside this script, an icon with
  // the placeholder. Nothing else is ever asked for.
  var urls = {};
  function getURL(caminho) {
    var p = String(caminho).replace(/^\//, '');
    if (/\.png$/.test(p)) return icone;
    if (!urls[p]) {
      var texto = recursos[p];
      if (texto === undefined) {
        console.warn('[assistente-nfpr] no embedded resource for ' + p);
        return p;
      }
      urls[p] = 'data:text/css;charset=utf-8,' + encodeURIComponent(texto);
    }
    return urls[p];
  }

  return {
    runtime: { getURL: getURL },
    storage: {
      local: local,
      onChanged: {
        addListener: function (fn) { ouvintes.push(fn); },
        removeListener: function (fn) { ouvintes = ouvintes.filter(function (f) { return f !== fn; }); }
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

// A template literal keeps CSS readable, one line per line. Only these three
// sequences mean something inside one.
const literal = (s) => '`' + s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`';

const tabelaRecursos = recursos
  .map((p) => '    ' + JSON.stringify(p) + ': ' + literal(css(ler(p).toString('utf8'), p)))
  .join(',\n');

// Each module was a script of its own, so it must still parse as one — checked
// here, where a stripper misread can be blamed on the right file.
function textoDoModulo(rel) {
  const texto = js(ler(rel).toString('utf8'), rel).replace(/\s+$/, '');
  try {
    new vm.Script(texto, { filename: rel });
  } catch (e) {
    falhar(rel + (SEM_COMENTARIOS ? ' no longer parses once stripped: ' : ' does not parse: ') + e.message);
  }
  return texto;
}

const faixa = (rel) => '// ' + '='.repeat(76) + '\n// ' + rel + '\n// ' + '='.repeat(76);
// The module text goes in byte for byte and UNINDENTED: re-indenting would
// reach inside multi-line template literals (host-page.js builds its CSS in
// them) and change what the page is given.
const modulo = (rel) => [
  faixa(rel),
  'try {',
  textoDoModulo(rel),
  ';} catch (e) { console.error(' + JSON.stringify('[assistente-nfpr] ' + rel) + ', e); }'
].join('\n');

const versao = manifesto.version;
const nomeArquivo = NOME + '-' + versao + (COMENTADO ? '-comentado' : '') + '.js';
const saida = [
  '/*!',
  ' * ' + manifesto.name + ' ' + versao + ' — versão embutida' + (COMENTADO ? ', comentada' : ''),
  ' * Gerado por tools/embutir.js a partir do repositório; não edite este arquivo.',
  ' * Carregue com um único <script> sem defer, o último dentro do <head> da',
  ' * página ' + PAGINA + '.',
  ' */',
  '(function () {',
  '  // The extension APIs the page code uses, over localStorage. Local on',
  '  // purpose: browser.js reads these two names, and window.chrome is left alone.',
  '  var browser;',
  '  var chrome = (' + js(criarApi.toString(), 'criarApi').replace(/\n/g, '\n  ') + ')({',
  tabelaRecursos,
  '  }, ' + JSON.stringify(ICONE) + ');',
  '',
  '  // document_start',
  noInicio.map(modulo).join('\n\n'),
  '',
  '  // document_idle',
  '  function iniciar() {',
  noFim.map(modulo).join('\n\n'),
  '  }',
  "  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);",
  '  else iniciar();',
  '})();',
  ''
].join('\n');

try {
  new vm.Script(saida, { filename: nomeArquivo });
} catch (e) {
  falhar('the assembled script does not parse: ' + e.message);
}

fs.mkdirSync(destino, { recursive: true });
const arquivo = path.join(destino, nomeArquivo);
fs.writeFileSync(arquivo, saida, 'utf8');
console.log(
  path.relative(raiz, arquivo) +
  '  (' + (noInicio.length + noFim.length) + ' modules, ' + recursos.length + ' stylesheets, ' +
  Math.round(Buffer.byteLength(saida) / 1024) + ' KiB)'
);
