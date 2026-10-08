/**
 * tools/smoke.js — run with:  node tools/smoke.js
 *                 to see WHAT it checked:  node tools/smoke.js --verbose
 * -----------------------------------------------------------------------------
 * NOT part of the extension, and not required to build or run it: there is
 * still no build step, no bundler, no package.json and no test runner. This is
 * a single dependency-free Node script you can delete without consequence.
 *
 * What it buys you, given that verification here is otherwise a 77-step manual
 * pass against a live government site:
 *
 *   1. It loads every module in manifest order against stubbed browser globals,
 *      so a missing dependency or a load-order mistake fails here instead of
 *      silently breaking the registrar on a volunteer's machine.
 *   2. It asserts the pure logic that has no DOM — CDV, key extraction from a
 *      QR-code URL, fixed part arithmetic, CNPJ validation.
 *   3. It drives synthetic keystrokes through the real capture engine to pin
 *      the F1 regression: a scanned 44-digit key must beat an active fixed
 *      part. Revert that one line in capture.js and this script fails.
 *   4. It drives NFPR.Registrador.iniciar — the wiring between a verdict and
 *      what the volunteer sees — with real keystrokes, and checks that each of
 *      the three branches is reached: red toast and nothing queued, grey row and
 *      nothing queued, or queued with the target CNPJ frozen.
 *   5. It drives NFPR.Donation.doar against stubbed responses to keep the two
 *      session verdicts apart: a duplicate session must never be reported as an
 *      expired one, because "entrar novamente" is what causes it.
 *   6. It proves the debug mode (src/shared/debug.js) SHIPS INERT — every flag
 *      off, every hook the identity function — then arms each one, checks it
 *      opens exactly the gate it claims, and disarms. Debug mode is also what
 *      makes the deadline assertions above testable at all, since it is the
 *      only way to move the clock. Debug mode ships with the extension, hidden
 *      behind its gesture, so "inert until armed" is the property that matters.
 *   7. It loads content.js in worlds of its own and drives the send pipeline
 *      against stubbed answers, and it reads the load-bearing CSS and HTML as
 *      declarations. Both were added after a mutation pass broke 26 of the
 *      rules CLAUDE.md says this script pins, one at a time, and 13 passed.
 *      A rule this script claims is a rule someone has seen it fail on.
 *   8. It runs the background script in a context of its own, far enough to
 *      tell a stopped load (left alone) from a failed one (sent to the
 *      offline page) in both browsers' spellings.
 *
 * EVERY CHECKPOINT REPORTS ITS ASSERTION COUNT, and --verbose names each one as
 * it passes. Without that this script was mute about its own coverage: 160-odd
 * assertions produced nine lines of output, none of which named a passing check,
 * so "is X covered?" could not be answered without reading the whole file. It
 * was asked, about things that were covered.
 *
 * It does not and cannot cover the network layer, a real DOM or layout, timing
 * beyond the movable performance.now() stub below, or anything that needs the
 * real site. DOCS.md's checklist covers those.
 * -----------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Positional root, ignoring flags — so `--verbose` can be passed on its own.
const raiz = process.argv.slice(2).find((a) => !a.startsWith('-')) || path.join(__dirname, '..');
// --verbose names every assertion as it passes. Without it this script is mute
// about what it checked, which makes "is X covered?" unanswerable without
// reading the whole file — the question that prompted adding this.
const VERBOSE = process.argv.includes('--verbose');

const noop = () => {};
// A response body both ways a real Response offers it. donation.js reads the
// token page as BYTES and decodes them itself — `text()` is always UTF-8, and
// that page is windows-1252 — while ui.js still reads its stylesheets as text.
// `bytes` defaults to the UTF-8 encoding of the string; pass others to model a
// page written in another charset.
const corpoDe = (s, bytes) => ({
  text: () => Promise.resolve(s),
  arrayBuffer: () => Promise.resolve(bytes || new TextEncoder().encode(s).buffer)
});
// ONE WORLD PER vm CONTEXT, built by a factory rather than written once at the
// top, because there are now two of them. The second exists for the orchestrator
// checkpoint at the bottom: content.js installs a document listener, a
// connectivity watchdog and a storage subscription the moment it loads, and
// those must not leak into every checkpoint that runs after it — which is
// exactly why it used to be excluded from the module list altogether.
//
// A hand-maintained second copy of these stubs was the obvious alternative and
// the wrong one: this repository has already paid for two copies of one thing
// drifting apart.
function criarMundo() {
  // Every element ever built, so a test can look for one by attribute. The stub
  // keeps no parent/child links, so this flat list is the only way to see inside
  // a rendered tree.
  const criados = [];
  // WHERE THE KEYBOARD IS. `focus()` records here and the document reports it
  // as its activeElement. It used to be a noop, which made every question of
  // the form "where does the keyboard go" unaskable — and those are exactly the
  // bugs that are silent everywhere else: a control left focused behind a
  // backdrop, or a list repaint that drops the keyboard on nothing.
  const foco = { el: null };
  const elemento = (tag) => {
    const e = {
      tagName: String(tag || 'div').toUpperCase(), atributos: {},
      className: '', style: { cssText: '', setProperty: noop },
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      // Children are tracked (append/replace only) so a test can count what a
      // widget actually rendered — the pip row is a count, and a stub that
      // forgets its children cannot show it is wrong.
      filhos: [],
      // parentNode is maintained, and two live code paths read it: painel.js
      // only removes the empty-list hint and an evicted row when they are
      // actually IN the document. Left permanently null (as it was) those
      // branches never ran under test, so the eviction the panel is built
      // around was exercised nowhere.
      appendChild: function (c) { e.filhos.push(c); c.parentNode = e; return c; },
      replaceChildren: function () {
        e.filhos = Array.prototype.slice.call(arguments);
        e.filhos.forEach((c) => { c.parentNode = e; });
      },
      // `remove` records instead of doing nothing, because a surface that takes
      // ITSELF off the screen is a real behaviour a test has to be able to see:
      // the duplicate-session banner hands over to the session condition bar by
      // removing itself, and a noop here cannot tell that from a banner that
      // simply sat there saying the wrong thing.
      removeChild: noop, remove: function () { e.removido = true; },
      // Real, because two things now depend on WHERE a node landed: the results
      // list puts the newest row at the front, and the header strip is inserted
      // into the government bar ahead of the site's own user block. A noop
      // could not tell either of those from a node that never arrived.
      // `firstChild` is undefined on this stub, and indexOf(undefined) is -1,
      // which lands at the front — the same place a real insertBefore(n, null)
      // would NOT, but the same place painel.js is actually asking for.
      insertBefore: function (n, ref) {
        const i = e.filhos.indexOf(ref);
        e.filhos.splice(i < 0 ? 0 : i, 0, n);
        n.parentNode = e;
        return n;
      },
      setAttribute: (k, v) => { e.atributos[k] = v; },
      removeAttribute: (k) => { delete e.atributos[k]; },
      // Real, because `hidden` is how every bar and the fixed part popover say
      // whether they are showing, and a widget that toggles ITSELF has to be
      // able to ask.
      hasAttribute: (k) => Object.prototype.hasOwnProperty.call(e.atributos, k),
      escutas: {},
      addEventListener: (tipo, fn) => { (e.escutas[tipo] = e.escutas[tipo] || []).push(fn); },
      // The shadow root records too: there are three of them now, and which
      // surface went into which one is the whole of the merged header.
      attachShadow: function () {
        e.sombra = {
          filhos: [],
          appendChild: function (c) { e.sombra.filhos.push(c); return c; }
        };
        return e.sombra;
      },
      querySelector: () => null, querySelectorAll: () => [],
      focus: function () { foco.el = e; }, select: noop,
      // Real, over the tracked children, because focus-restoring code asks it
      // ("was the keyboard inside this list?") before a repaint throws the
      // children away. Every node answers to the one stub document: the
      // separate shadow roots are not modelled here, and a test that needs one
      // replaces getRootNode on the element it is about.
      contains: function (alvo) {
        if (alvo === e) return true;
        return e.filhos.some((f) => f && typeof f.contains === 'function' && f.contains(alvo));
      },
      getRootNode: () => documentoStub,
      textContent: '', innerHTML: '', hidden: false, parentNode: null,
      // A real form control's .value is always a string, never undefined. Leaving
      // it unset let code that reads it before anything is typed see a value no
      // browser can produce.
      value: ''
    };
    criados.push(e);
    return e;
  };

  // Real listener registry, so tests can dispatch synthetic keystrokes at the
  // capture-phase engine the way a scanner would.
  const ouvintes = {};
  const janelaOuvintes = {}; // the same, for listeners put on the window
  const documentoStub = {
    createElement: elemento,
    createTextNode: () => ({}),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (tipo, fn) => { (ouvintes[tipo] = ouvintes[tipo] || []).push(fn); },
    removeEventListener: (tipo, fn) => {
      ouvintes[tipo] = (ouvintes[tipo] || []).filter((f) => f !== fn);
    },
    documentElement: elemento(),
    body: elemento(),
    get activeElement() { return foco.el; }
  };

  const guardado = {}; // backing store for the chrome.storage.local stub below

  // A MOVABLE performance clock. It used to be `now: () => 0`, which made every
  // synthetic keystroke gap 0 ms — so capture.js read the whole file as one
  // machine burst and its 35 ms heuristic was unobservable. Two behaviours now
  // hang off that heuristic and had to become testable: a burst discarding a
  // human's leftovers, and the live typing verdict staying silent during a
  // scan. Left at 0 it behaves exactly as before, so every existing assertion
  // is untouched; tests that care advance it themselves.
  const relogioPerf = { ms: 0 };

  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, Error, Date, Math, JSON, Array, Object, String, Number, Boolean, RegExp, Set, Map, WeakSet,
    // Node's own, with full ICU: windows-1252 is the charset the site's token
    // page is actually written in, and a stub decoder would prove nothing.
    TextDecoder,
    fetch: () => Promise.resolve({ ok: true, status: 200, ...corpoDe(''), json: () => Promise.resolve({}) }),
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    DOMParser: class { parseFromString() { return documentoStub; } },
    AudioContext: class { constructor() { this.state = 'running'; } },
    navigator: { onLine: true },
    location: { href: '', reload: noop, replace: noop },
    // Real enough to be read back. content.js keeps its one-automatic-attempt
    // marker here, and a stub that forgot it would let the loop it guards
    // against pass unnoticed.
    sessionStorage: (() => {
      const m = new Map();
      return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: (k) => { m.delete(k); }
      };
    })(),
    performance: { now: () => relogioPerf.ms },
    document: documentoStub,
    requestAnimationFrame: noop,
    // Kept, not dropped: the registrar listens for the WINDOW getting focus
    // back, and a test has to be able to fire that.
    addEventListener: (tipo, fn) => { (janelaOuvintes[tipo] = janelaOuvintes[tipo] || []).push(fn); },
    chrome: {
      runtime: { getURL: (p) => 'chrome-extension://x/' + p, getManifest: () => ({ version: '0' }) },
      // A real (if tiny) storage: enough that a write can be read back, and that
      // remove/clear take their actual path instead of the catch branch.
      storage: {
        local: {
          get: async (k) => (k == null ? { ...guardado } : { [k]: guardado[k] }),
          set: async (o) => { Object.assign(guardado, o); },
          remove: async (k) => { for (const c of [].concat(k)) delete guardado[c]; },
          clear: async () => { for (const c of Object.keys(guardado)) delete guardado[c]; }
        },
        onChanged: { addListener: noop, removeListener: noop }
      },
      tabs: { create: async () => {}, update: async () => {} },
      action: { setBadgeText: noop, setBadgeBackgroundColor: noop, setBadgeTextColor: noop }
    }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return { criados, elemento, ouvintes, janelaOuvintes, documentoStub, guardado, sandbox, relogioPerf, foco };
}

// The world every checkpoint below shares, destructured into the names they
// already use.
const mundoPadrao = criarMundo();
const { criados, elemento, ouvintes, janelaOuvintes, documentoStub, guardado, sandbox, relogioPerf, foco } = mundoPadrao;

const manifest = JSON.parse(fs.readFileSync(path.join(raiz, 'manifest.json'), 'utf8'));
// The registrar content-script array is the full graph; skip the two
// orchestrators, which start doing real work the moment they load.
const arquivos = manifest.content_scripts[2].js.filter(
  (f) => !/content\.js$|modal-entidade\.js$/.test(f)
);
// The same graph WITH the orchestrator, for the checkpoint at the bottom that
// loads it deliberately, in a world of its own. modal-entidade.js stays out of
// both: it scrapes a dialog that exists only on the government page.
const todosOsModulos = manifest.content_scripts[2].js.filter(
  (f) => !/modal-entidade\.js$/.test(f)
);

for (const rel of arquivos) {
  const codigo = fs.readFileSync(path.join(raiz, rel), 'utf8');
  try {
    vm.runInContext(codigo, sandbox, { filename: rel });
  } catch (e) {
    console.error('LOAD FAILED  ' + rel + '\n  ' + e.message);
    process.exit(1);
  }
}

const NFPR = sandbox.NFPR;
// Debug mode ships with the extension like every other module, so it is
// expected unconditionally: a loader line dropped by accident fails here.
const esperado = ['api', 'url', 'el', 'iconeMarca', 'agruparChave', 'Site', 'Chave', 'Cnpj', 'Relogio', 'Entidade',
                  'Config', 'Audio', 'Capture', 'Connectivity', 'Donation', 'Despacho', 'SettingsUI', 'ParteFixa',
                  'UI', 'Painel', 'StripParteFixa', 'Modal', 'Registrador', 'Sessao',
                  'secaoEntidades', 'secaoPreferencias', 'Debug', 'DebugUI'];
const faltando = esperado.filter((k) => !NFPR[k]);
if (faltando.length) {
  console.error('MISSING from NFPR: ' + faltando.join(', '));
  process.exit(1);
}
console.log('loaded ' + arquivos.length + ' modules; NFPR has all ' + esperado.length + ' expected members');

// --- the settings form must at least build ---------------------------------
// Exercises all three section factories and the composer against the DOM stub.
try {
  const alvo = elemento();
  NFPR.SettingsUI.montar(alvo, {});
} catch (e) {
  console.error('SettingsUI.montar threw: ' + e.message);
  process.exit(1);
}
console.log('SettingsUI.montar builds both sections');

// --- a few pure-logic assertions on the parts that have no DOM ---------------
const { Chave, ParteFixa, Cnpj } = NFPR;
let falhas = 0;
let passes = 0;
function ok(nome, real, esperadoValor) {
  const bate = JSON.stringify(real) === JSON.stringify(esperadoValor);
  if (!bate) {
    console.error('FAIL ' + nome + ': got ' + JSON.stringify(real) +
      ', want ' + JSON.stringify(esperadoValor));
    falhas++;
    return;
  }
  passes += 1;
  if (VERBOSE) console.log('    ok  ' + nome);
}

/** A checkpoint: stop on any failure so far, otherwise say what has passed. */
function marco(texto) {
  if (falhas) { console.error(falhas + ' assertion(s) failed'); process.exit(1); }
  console.log(texto + '  [' + passes + ' asserções]');
}

// A real PR key: first 43 digits + the CDV they produce. Every field has to be
// genuine now that the table reads the issuer document and the month — the
// previous fixture had two stray digits before the CNPJ, which shifted every
// field after MM two places left and made it a CT-e from an invalid issuer.
//   41 | 2501 | 12345678000195 | 65 | 001 | 000001234 | 1 | 12345678 | CDV
const base43 = '4125011234567800019565001000001234112345678';
const chave = base43 + Chave.calcularCDV(base43 + '0');

// Two fixed clocks, so nothing here rots. AGORA is the one the date verdicts
// are pinned against; NA_EMISSAO is the fixture's OWN month, which makes both
// date checks neutral so a structural verdict is what comes back. That second
// one replaces the old clock-free validarChave — an entry point that existed
// because fixed parts used to consult it, and went away with phase 3.
const AGORA = { ano: 2025, mes: 8 };
const NA_EMISSAO = { ano: 2025, mes: 1 };

ok('avaliar(ok)', Chave.avaliar(chave, NA_EMISSAO).ok, true);
ok('avaliar(short)', Chave.avaliar('41', NA_EMISSAO).codigo, 'COMPRIMENTO');
ok('avaliar(bad CDV)',
  Chave.avaliar(base43 + (chave[43] === '9' ? '8' : '9'), NA_EMISSAO).codigo,
  'DIGITO_VERIFICADOR');

// extrairChave must find the key inside a QR-code URL.
const url = 'http://www.fazenda.pr.gov.br/nfce/qrcode?p=' + chave + '|2|1|1|ABCDEF';
ok('extrairChave(qr url)', Chave.extrairChave(url), chave);

// --- analisarChave: the field layout, and the '?' rule ----------------------
ok('analisarChave(complete key) decodes every field', Chave.analisarChave(chave), {
  uf: '41', aa: '25', mm: '01', documentoEmitente: '12345678000195', modelo: '65',
  serie: '001', numero: '000001234', tipoEmissao: '1', codigo: '12345678', cdv: '7'
});
ok('analisarChave(short) is null', Chave.analisarChave(chave.slice(0, 43)), null);
ok('analisarChave(empty) is null', Chave.analisarChave(''), null);

// A template is 44 characters of digits and '?'. A span containing '?' is
// unknowable, so it yields null — EXACTLY there, and nowhere else.
const comVariaveis = (a, b) => chave.slice(0, a) + '?'.repeat(b - a) + chave.slice(b);
const nulos = (analise) => Object.keys(analise).filter((k) => analise[k] === null).sort();
ok('a ? inside documentoEmitente nulls documentoEmitente alone',
  nulos(Chave.analisarChave(comVariaveis(10, 11))), ['documentoEmitente']);
ok('a ? inside serie nulls serie alone',
  nulos(Chave.analisarChave(comVariaveis(23, 24))), ['serie']);
// The 35-fixed + 9-variable shape the fixed part fixture below uses: those nine
// positions are codigo and the check digit, and tipoEmissao at [34] survives.
ok('the nine trailing variable digits null codigo and cdv, nothing else',
  nulos(Chave.analisarChave(comVariaveis(35, 44))), ['cdv', 'codigo']);
// aa and mm are separate spans: a fixed part may fix the year and leave the
// month free, which is what makes the fixed part range checks in registrador.js
// possible.
ok('mm variable leaves aa readable',
  [Chave.analisarChave(comVariaveis(4, 6)).aa, Chave.analisarChave(comVariaveis(4, 6)).mm],
  ['25', null]);
ok('aa variable leaves mm readable',
  [Chave.analisarChave(comVariaveis(2, 4)).aa, Chave.analisarChave(comVariaveis(2, 4)).mm],
  [null, '01']);

// contarVariaveis: the five call sites it replaced.
ok('ParteFixa.contarVariaveis(null)', ParteFixa.contarVariaveis(null), 44);
ok('ParteFixa.contarVariaveis("")', ParteFixa.contarVariaveis(''), 44);
ok('ParteFixa.contarVariaveis(14 ?)', ParteFixa.contarVariaveis('4125010712345678000195650010000012341'.padEnd(44, '?')), 7);
ok('ParteFixa.contarVariaveis(partial)', ParteFixa.contarVariaveis('4125'), 40);

// ParteFixa.resolver decides by WHAT KIND OF INPUT ARRIVED, never by whether a
// validation passed. A 44-digit run in `raw` is a scan, a paste or a QR URL —
// that is the input. Anything shorter is typing, so the fixed part composes.
const parteFixa = '41250112345678000195650010000012341' + '?'.repeat(9);
ok('ParteFixa.resolver(a whole key under a fixed part is a scan, and says so)',
  ParteFixa.resolver(chave, '1234', parteFixa), { chave: chave, origem: 'scan' });
// No fixed part, so there is no misuse to report whatever arrived.
ok('ParteFixa.resolver(no fixed part, nothing to report)',
  ParteFixa.resolver(chave, chave, null), { chave: chave, origem: 'direto' });
// 35 fixed chars, then 2 of the 9 variable slots filled, then it stops.
const parcial = ParteFixa.resolver('12', '12', parteFixa);
ok('ParteFixa.resolver(fixed part when raw partial)', [parcial.chave.length, parcial.origem], [37, 'parteFixa']);

// A stuck key: the volunteer's 9 typed digits are complete and correct in
// `typed`, then a key repeats until the buffer passes 44 digits.
const digitados = chave.slice(35); // what an entry of `chave` under a fixed part types: 9 digits
const comTeclaPresa = digitados + '5'.repeat(40);
const lixo = Chave.extrairChave(comTeclaPresa);
ok('a stuck key really does yield a full-length non-key',
  [lixo.length, Chave.avaliar(lixo, NA_EMISSAO).ok], [44, false]);
// THE ACCEPTED COST of deciding by input kind: past 44 digits this is no longer
// distinguishable from a scan, so it is judged as read instead of being quietly
// rebuilt from the fixed part. Red, and one note re-entered.
ok('ParteFixa.resolver(a polluted buffer is judged as read, not composed)',
  ParteFixa.resolver(comTeclaPresa, digitados, parteFixa), { chave: lixo, origem: 'scan' });

// THE PHASE-1 REGRESSION GUARD, and the reason this phase exists. A corrupted
// scan under an active fixed part must come back as the digits that were READ.
//
// `typed` here is what capture.js actually produces for a scan under a fixed
// part — the barcode's FIRST 9 digits — not the correct tail a typed entry
// would have typed. The old assertion passed `chave.slice(35)` for both, so the
// composition happened to rebuild the right key and the test read far more
// reassuring than the behaviour was.
const chaveQuebrada = base43 + (chave[43] === '9' ? '8' : '9');
const cabecaDoBarcode = chaveQuebrada.slice(0, 9);
ok('a broken scan comes back as it was read, never composed',
  ParteFixa.resolver(chaveQuebrada, cabecaDoBarcode, parteFixa),
  { chave: chaveQuebrada, origem: 'scan' });
ok('...so it is judged red, which is what sends the volunteer back to the paper',
  Chave.avaliar(chaveQuebrada, NA_EMISSAO).codigo, 'DIGITO_VERIFICADOR');
// What the old rule produced from exactly these inputs: [fixed part] + [barcode
// head], a key nobody scanned, ~10% of which satisfy the check digit and were
// donated silently. Asserted as a NON-result so the bug cannot come back.
ok('...and never the fabrication the old rule built from the fixed part',
  ParteFixa.resolver(chaveQuebrada, cabecaDoBarcode, parteFixa).chave ===
    ParteFixa.aplicar(parteFixa, cabecaDoBarcode), false);
// With no fixed part there was never anything to compose from.
ok('...with no fixed part, the broken scan is reported as it came',
  ParteFixa.resolver(chaveQuebrada, chaveQuebrada, null).chave, chaveQuebrada);

// A BURST SHORTER THAN 44 IS STILL A SCAN. A shop's own barcode read under a
// fixed part carries no 44-run, so the run test alone let it compose [fixed
// part] + [barcode head] — about one in ten of those passed every local check.
// With capture's confirmed-burst flag, it is judged as it came: red.
const barcodeCurto = '78912345678901234567';
ok('a short burst under a fixed part is judged as read, never composed',
  ParteFixa.resolver(barcodeCurto, barcodeCurto.slice(0, 9), parteFixa, true),
  { chave: barcodeCurto, origem: 'rajada' });
ok('...which is red, for its length',
  Chave.avaliar(barcodeCurto, NA_EMISSAO).gravidade, 'entrada');
// The flag is what decides: the same buffer TYPED still composes, which is what
// a fixed part is for.
ok('...while the same digits typed still compose with the fixed part',
  ParteFixa.resolver(barcodeCurto.slice(0, 9), barcodeCurto.slice(0, 9), parteFixa, false).origem,
  'parteFixa');
// The fabrication, sampled: across 2000 short bursts, the old rule composed
// keys that pass every local check; the flagged resolver composes none.
(function () {
  let antes = 0;
  let agora = 0;
  let semente = 7;
  const aleatorio = () => (semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let n = 0; n < 2000; n += 1) {
    let b = '';
    const tam = 20 + Math.floor(aleatorio() * 24);
    while (b.length < tam) b += String(Math.floor(aleatorio() * 10));
    const cabeca = b.slice(0, 9);
    if (Chave.avaliar(ParteFixa.aplicar(parteFixa, cabeca), NA_EMISSAO).ok) antes += 1;
    if (Chave.avaliar(ParteFixa.resolver(b, cabeca, parteFixa, true).chave, NA_EMISSAO).ok) agora += 1;
  }
  ok('the old composition really did fabricate valid keys from short bursts', antes > 0, true);
  ok('...and a flagged short burst never yields one', agora, 0);
})();

ok('cnpj.validar', Cnpj.validar('11222333000181'), true);
ok('cnpj.validar(bad)', Cnpj.validar('11222333000182'), false);

const CPF_VALIDO = '52998224725';
const DOC_CPF = '000' + CPF_VALIDO; // how a CPF issuer sits in [6:20]
const DOC_CNPJ = '12345678000195';
ok('cnpj.validarCpf', Cnpj.validarCpf(CPF_VALIDO), true);
ok('cnpj.validarCpf(bad)', Cnpj.validarCpf('52998224724'), false);
// The repunit guard matters here specifically: a half-filled fixed part
// template is full of zeros, and 00000000000 satisfies the arithmetic.
ok('cnpj.validarCpf(repunit)', Cnpj.validarCpf('00000000000'), false);

// Relogio must resolve a real timezone. There is deliberately no Intl stub in
// the sandbox above — vm.createContext gives the context its own intrinsics,
// and a stub would shadow the real one with something that cannot do zones.
const agoraReal = NFPR.Relogio.mesCorrente();
ok('Relogio.mesCorrente reads America/Sao_Paulo',
  [agoraReal.ano > 2000, agoraReal.mes >= 1 && agoraReal.mes <= 12], [true, true]);

// --- the structural verdicts ------------------------------------------------
// Rebuild the fixture with one field replaced, recomputing the check digit so
// the field under test is the only thing that can fail.
//
// DELIBERATELY LOCAL, even though NFPR.Debug.chaveFalsa does exactly this: a
// fixture builder borrowed from the code under test cannot catch that code
// being wrong. The duplication is paid for by the cross-check below.
const SPANS = {
  uf: [0, 2], aa: [2, 4], mm: [4, 6], documentoEmitente: [6, 20], modelo: [20, 22],
  serie: [22, 25], numero: [25, 34], tipoEmissao: [34, 35], codigo: [35, 43]
};
function chaveCom(campos) {
  let s = chave;
  for (const k of Object.keys(campos)) {
    s = s.slice(0, SPANS[k][0]) + campos[k] + s.slice(SPANS[k][1]);
  }
  const b43 = s.slice(0, 43);
  return b43 + Chave.calcularCDV(b43 + '0');
}
// Judge a fixture at its own emission month, so FUTURA and EXPIRADA are both
// neutral and whatever comes back is the STRUCTURAL verdict.
const cod = (c) => {
  const a = Chave.analisarChave(c);
  return Chave.avaliar(c, { ano: 2000 + Number(a.aa), mes: Number(a.mm) }).codigo;
};
// Does the issuer checksum refuse this key? That is separate from whether the
// note can be donated — which is why a CPF-issued key can be `false` below and
// still be ineligible.
const docInvalido = (c) => cod(c) === 'DOCUMENTO_EMITENTE';

// Two span tables that must agree, asserted rather than hoped for: a fixture
// built from a stale table silently tests the wrong digits.
ok('Debug.chaveFalsa agrees with the local builder, field for field',
  [{}, { mm: '13' }, { uf: '35' }, { documentoEmitente: '12345678000000' },
   { serie: '930' }, { modelo: '55' }, { aa: '24' }]
    .map((c) => NFPR.Debug.chaveFalsa(c) === chaveCom(c)),
  [true, true, true, true, true, true, true]);
ok('Debug.chaveFalsa refuses a field of the wrong width', (() => {
  try { NFPR.Debug.chaveFalsa({ mm: '1' }); return 'aceitou'; } catch (e) { return 'recusou'; }
})(), 'recusou');

ok('an impossible month 00', cod(chaveCom({ mm: '00' })), 'MES_INVALIDO');
ok('an impossible month 13', cod(chaveCom({ mm: '13' })), 'MES_INVALIDO');
ok('December is a month', cod(chaveCom({ mm: '12' })), 'OK');

// A LETTER OUTSIDE 6..17 IS RED AT THE LETTER, BEFORE THE KEY IS WHOLE.
// `Number('2A')` is NaN and every comparison with NaN is false, so a letter in
// the year or month once judged clean while typing, one in the model fell
// through to the GREY of another document — "não pode ser doada" said about a
// typo — and one in the série or the invoice number said nothing at all until
// Enter, since no rule reads those spans. A whole key meets FORMATO first, as
// it always did; the live verdict and a fixed part template meet
// LETRA_FORA_DO_LUGAR. Every numeric index is swept, so a window that drifted
// by one either way fails here.
const aoVivo = (t) => {
  const v = Chave.avaliarTemplate(ParteFixa.completar(t), AGORA);
  return [v.codigo, v.gravidade];
};
const base25 = chaveCom({ aa: '25', mm: '08' });
const ate20 = base25.slice(0, 20);
const letraEm = (i) => aoVivo(base25.slice(0, i) + 'A');
ok('a letter at any index outside 6..17 is red the moment it is typed, never grey',
  [0, 1, 2, 3, 4, 5, 18, 19, 20, 21, 22, 24, 25, 33, 34, 35, 42, 43]
    .map(letraEm).filter((v) => v[0] !== 'LETRA_FORA_DO_LUGAR' || v[1] !== 'entrada'),
  []);
ok('...while a letter inside 6..17 is the issuer, and says nothing yet',
  [6, 11, 17].map(letraEm), [['OK', null], ['OK', null], ['OK', null]]);
ok('...and a fixed part template\'s \'?\' is not a letter',
  [aoVivo('41??????????????????65???'), aoVivo(ate20 + '65' + '?'.repeat(22))],
  [['OK', null], ['OK', null]]);
ok('...while the same spans in digits judge as they always did',
  [aoVivo('4125'), aoVivo('412508'), aoVivo(ate20 + '65')[0], aoVivo(ate20 + '57')[0]],
  [['OK', null], ['OK', null], 'OK', 'TIPO_DOCUMENTO']);
ok('...and a whole key with one is FORMATO, as before',
  [chaveCom({ aa: '2A' }), chaveCom({ mm: '0A' }), chaveCom({ modelo: '6A' }),
   chaveCom({ serie: '00A' })]
    .map((c) => Chave.avaliar(c, NA_EMISSAO).codigo),
  ['FORMATO', 'FORMATO', 'FORMATO', 'FORMATO']);

// A WHOLE EXPIRED YEAR NAMES THE YEAR. Four digits in, the month is unknown,
// so the date checks judge the whole year and EXPIRADA fires only when every
// month of it is past. It used to name December for any note of that year.
// Both sides of the edge: December's deadline is the February after.
const soAno = (agora) => Chave.avaliarTemplate(ParteFixa.completar('4124'), agora);
ok('a whole expired year is named, and no month is',
  [soAno({ ano: 2025, mes: 2 }).codigo, soAno({ ano: 2025, mes: 3 }).codigo,
   soAno({ ano: 2025, mes: 3 }).mensagem],
  ['OK', 'EXPIRADA', 'Nota de 2024 — o prazo para doá-la já passou.']);
ok('a CDV-valid key with a garbage issuer document',
  cod(chaveCom({ documentoEmitente: '12345678000000' })), 'DOCUMENTO_EMITENTE');

// A foreign-state note and a CT-e are REAL documents, so they are grey, not
// red. This used to be asserted as "still passes validarChave", because the
// location of a check decided whether a fixed part could fabricate over it.
// Phase 1 removed that coupling and phase 3 removed the function, so the
// durable property is the COLOUR — pinned in the grey block further down.

// [6:20] IS EITHER A CNPJ OR A ZERO-PADDED CPF, AND THE SÉRIE DOES NOT PICK.
// It used to, through a band table with four exceptions, and that table was
// the thing that kept refusing real notes. A damaged document rarely satisfies
// either checksum, so accepting either loses next to no corruption detection.
// THIS is what fails if someone brings the série back into it: a padded CPF
// on an ordinary série, and a CNPJ in the CPF band, both pass — and a
// document satisfying neither is still refused, whatever the série.
ok('the issuer may be either document, on any série',
  ['001', '905', '915', '930', '980', '995'].map((serie) =>
    [docInvalido(chaveCom({ serie: serie, documentoEmitente: DOC_CNPJ })),
     docInvalido(chaveCom({ serie: serie, documentoEmitente: DOC_CPF })),
     docInvalido(chaveCom({ serie: serie, documentoEmitente: '12345678000000' }))]),
  Array(6).fill([false, false, true]));
// A padded CPF has to BE padded: eleven valid CPF digits anywhere else in the
// span are not a CPF.
ok('a CPF not padded with 000 is not a CPF',
  docInvalido(chaveCom({ documentoEmitente: '9' + DOC_CPF.slice(1) })), true);

// NA_EMISSAO, so the fixture's own aa/mm make the date verdicts neutral and the
// issuer check is what surfaces.
const estrutura = (t) => Chave.avaliarTemplate(ParteFixa.completar(t), NA_EMISSAO).codigo;
const semSerie = (doc) =>
  chave.slice(0, 6) + doc + chave.slice(20, 22) + '???' + chave.slice(25);
ok('a fixed part fixing the issuer is judged on it alone',
  [estrutura(semSerie(DOC_CNPJ)), estrutura(semSerie(DOC_CPF)),
   estrutura(semSerie('12345678000000'))],
  ['OK', 'OK', 'DOCUMENTO_EMITENTE']);
// A template that leaves the issuer itself variable cannot be judged on it.
ok('variable issuer skips the check', estrutura('41'.padEnd(44, '?')), 'OK');
// And avaliarTemplate skips exactly the three a template cannot answer: this
// one is 44 characters of '?' plus a prefix, so COMPRIMENTO passes but FORMATO
// and DIGITO_VERIFICADOR would both fire if `escopo` were ignored.
ok('a template is never judged on format or check digit',
  Chave.avaliar('41'.padEnd(44, '?'), NA_EMISSAO).codigo, 'FORMATO');

// --- the contextual verdicts ------------------------------------------------
// ALWAYS a fixed `agora` (declared with the fixture above), so none of this
// rots. The clock is injected precisely so these assertions can pin a date.
const av = (c, agora) => Chave.avaliar(c, agora || AGORA);
const avCod = (c, agora) => [av(c, agora).codigo, av(c, agora).gravidade];

// The donation window is three calendar months — Decreto 8.249/2017, art. 12,
// "último dia do segundo mês subsequente" — not the one the site's FAQ still
// documents. 08/2025 accepts 06, 07 and 08; 05 is gone.
ok('same month', avCod(chaveCom({ aa: '25', mm: '08' })), ['OK', null]);
ok('one month back', avCod(chaveCom({ aa: '25', mm: '07' })), ['OK', null]);
ok('two months back — the +2 boundary is the whole point',
  avCod(chaveCom({ aa: '25', mm: '06' })), ['OK', null]);
ok('three months back', avCod(chaveCom({ aa: '25', mm: '05' })), ['EXPIRADA', 'inelegivel']);
ok('next month cannot exist yet', avCod(chaveCom({ aa: '25', mm: '09' })), ['FUTURA', 'entrada']);

// The +2 wraps the year: 12/2025 is good until 02/2026, not 14/2025.
ok('December is still valid in the February after',
  avCod(chaveCom({ aa: '25', mm: '12' }), { ano: 2026, mes: 2 }), ['OK', null]);
ok('...and gone in the March after',
  avCod(chaveCom({ aa: '25', mm: '12' }), { ano: 2026, mes: 3 }), ['EXPIRADA', 'inelegivel']);
ok('...and the sentence says so',
  av(chaveCom({ aa: '25', mm: '12' }), { ano: 2026, mes: 3 }).mensagem,
  'Nota de dezembro de 2025 — o prazo para doá-la foi até fevereiro de 2026.');
// The other direction: a January note judged from the December before it.
ok('a January note is still in the future in the November before',
  avCod(chaveCom({ aa: '26', mm: '01' }), { ano: 2025, mes: 11 }), ['FUTURA', 'entrada']);

// Grey: the note is real, only its usefulness is in question.
ok('a foreign-state note is grey, not red',
  avCod(chaveCom({ uf: '35', aa: '25', mm: '08' })), ['NAO_PR', 'inelegivel']);
ok('...and names the state it found',
  av(chaveCom({ uf: '35', aa: '25', mm: '08' })).mensagem,
  'Nota de São Paulo — o Nota Paraná só aceita notas do Paraná.');
// A cUF that is not a state DOES NOT EXIST, so it is corrupted input — red, and
// never a grey "note from somewhere else". ESTADOS is the authority and must
// stay complete: an omission there refuses a real note as a typo.
ok('an unlisted cUF is red, not grey',
  avCod(chaveCom({ uf: '99', aa: '25', mm: '08' })), ['UF_INEXISTENTE', 'entrada']);
// TWO MODELS ARE ACCEPTED: 65, the NFC-e, and 55, the NF-e. Both answer 200
// at the POST; an unknown model is refused `Tipo de documento inválido`.
// Both can be donated (see MODELOS_ACEITOS in chave.js). The neighbours of
// each are pinned
// so a range test (`>= 55`) or a single-model test left behind cannot pass.
ok('an NF-e key is accepted exactly like an NFC-e',
  avCod(chaveCom({ modelo: '55', aa: '25', mm: '08' })), ['OK', null]);
ok('only 55 and 65 are accepted — the neighbours of each are grey',
  ['54', '55', '56', '64', '65', '66']
    .map((m) => avCod(chaveCom({ modelo: m, aa: '25', mm: '08' }))[0]),
  ['TIPO_DOCUMENTO', 'OK', 'TIPO_DOCUMENTO', 'TIPO_DOCUMENTO', 'OK', 'TIPO_DOCUMENTO']);
ok('a CT-e key is grey — a CT-e is a real document',
  avCod(chaveCom({ modelo: '57', aa: '25', mm: '08' })), ['TIPO_DOCUMENTO', 'inelegivel']);
ok('...and names the document type, and both papers this page takes',
  av(chaveCom({ modelo: '57', aa: '25', mm: '08' })).mensagem,
  'Esta chave é de um CT-e (conhecimento de transporte). Só NF-e e NFC-e podem ser doadas.');
ok('an unlisted document type falls back to the vaguer sentence',
  av(chaveCom({ modelo: '99', aa: '25', mm: '08' })).mensagem,
  'Esta chave não é de uma NF-e nem de uma NFC-e, as únicas que podem ser doadas.');
// ...and accepting the model waives NOTHING else: an NF-e meets every other
// check exactly as an NFC-e does, red and grey alike.
const nfe = (extra) => chaveCom(Object.assign({ modelo: '55', aa: '25', mm: '08' }, extra));
ok('an NF-e meets every other check exactly like an NFC-e',
  [cod(nfe({}).slice(0, 43) + (nfe({})[43] === '0' ? '1' : '0')),
   avCod(nfe({ documentoEmitente: '12345678000000' }))[0],
   avCod(nfe({ uf: '99' }))[0],
   avCod(nfe({ mm: '13' }))[0],
   avCod(nfe({ aa: '25', mm: '09' }))[0],
   avCod(nfe({ uf: '35' }))[0],
   avCod(nfe({ aa: '25', mm: '05' }))[0]],
  ['DIGITO_VERIFICADOR', 'DOCUMENTO_EMITENTE', 'UF_INEXISTENTE', 'MES_INVALIDO', 'FUTURA',
   'NAO_PR', 'EXPIRADA']);

// A produtor rural's note is as real as any other — padded CPF in [6:20] — and
// a CPF can only issue an NF-e (MOC rejection 337). Nothing reads the série
// any more, so it is accepted like any NF-e. Its issuer checksum is happy
// either way, which is the whole reason that check is a corruption detector
// and never an eligibility rule.
const notaDeCpf = chaveCom({ modelo: '55', serie: '930', documentoEmitente: DOC_CPF, aa: '25', mm: '08' });
ok('a produtor rural\'s NF-e is accepted — nothing reads the série', avCod(notaDeCpf), ['OK', null]);
ok('...and its issuer checksum is happy — a CPF is a valid issuer',
  docInvalido(notaDeCpf), false);

// --- NO SÉRIE AND NO tpEmis IS JUDGED ---------------------------------------
// A fixture in AGORA's window, so only a série or tpEmis rule could fire.
const serieCod = (serie, extra) =>
  avCod(chaveCom(Object.assign({ serie: serie, aa: '25', mm: '08' }, extra || {})))[0];

// Every one of these was once a verdict, and each could refuse a real note:
// the avulsa série on an NFC-e (red), 910–919 (read as CPF-only), 990–999 (grey
// "exceptional operations", red for most tpEmis), and last the CPF band
// 920–979 (EMITENTE_CPF), removed on 2026-09-28. This is what fails if one
// comes back.
ok('no série raises a verdict, on either model, under any tpEmis or issuer',
  ['000', '889', '890', '905', '909', '910', '919', '920', '930', '979', '980', '989', '990', '999']
    .map((serie) => [serieCod(serie), serieCod(serie, { modelo: '55' }),
      serieCod(serie, { tipoEmissao: '3' }), serieCod(serie, { tipoEmissao: '9' }),
      serieCod(serie, { documentoEmitente: DOC_CPF }),
      serieCod(serie, { modelo: '55', documentoEmitente: DOC_CPF })])
    .every((r) => r.every((c) => c === 'OK')),
  true);
ok('no tpEmis raises a verdict',
  '0123456789'.split('').map((tp) => serieCod('001', { tipoEmissao: tp })).every((c) => c === 'OK'),
  true);
// ...and a model that is neither is still the MODEL's grey, whatever the série.
ok('an avulsa série on a CT-e is a real document of the wrong type',
  serieCod('905', { modelo: '57' }), 'TIPO_DOCUMENTO');
// A structural failure carries gravidade too, so callers branch on one field
// for every outcome.
ok('structural failures come back red', avCod('41'), ['COMPRIMENTO', 'entrada']);

// The red field codes are distinct but say the same thing, because the
// volunteer's next action is identical for all of them.
ok('the four red field codes share one sentence',
  [av(chaveQuebrada, NA_EMISSAO).mensagem,
   av(chaveCom({ documentoEmitente: '12345678000000' }), NA_EMISSAO).mensagem,
   av(chaveCom({ mm: '13' }), NA_EMISSAO).mensagem,
   av(chaveCom({ aa: '25', mm: '09' })).mensagem]
    .filter((m, _i, a) => m === a[0]).length, 4);

// The "+ 2 months" that both the EXPIRADA sentence and the fixed parts list's
// "Vale até" print. It WRAPS THE YEAR — anything reaching for `mes + 2`
// directly is wrong for a sixth of all notes.
ok('somarMeses(11/2025, 2)', Chave.somarMeses({ ano: 2025, mes: 11 }, 2), { ano: 2026, mes: 1 });
ok('somarMeses(12/2025, 2)', Chave.somarMeses({ ano: 2025, mes: 12 }, 2), { ano: 2026, mes: 2 });
ok('somarMeses(01/2025, 2)', Chave.somarMeses({ ano: 2025, mes: 1 }, 2), { ano: 2025, mes: 3 });

// --- fixed part date ranges (a template's aa/mm need not both be fixed) ------
function comTemplate(campos, variaveis) {
  let s = chaveCom(campos);
  for (const k of variaveis) {
    s = s.slice(0, SPANS[k][0]) + '?'.repeat(SPANS[k][1] - SPANS[k][0]) + s.slice(SPANS[k][1]);
  }
  return s;
}
const ctxCod = (t, agora) =>
  Chave.avaliarTemplate(ParteFixa.completar(t), agora || AGORA).codigo;

ok('a fixed part fixed to a future year is future even with a free month',
  ctxCod(comTemplate({ aa: '27' }, ['mm'])), 'FUTURA');
ok('a fixed part fixed to an old year is expired even with a free month',
  ctxCod(comTemplate({ aa: '24' }, ['mm'])), 'EXPIRADA');
ok('a fixed part fixed to this year with a free month is neither',
  ctxCod(comTemplate({ aa: '25' }, ['mm'])), 'OK');
// A month with no year means nothing, so both date checks skip — but the month
// itself is still judged. One table, and `campos` is what tells them apart.
ok('a free year skips both date verdicts',
  ctxCod(comTemplate({ mm: '06' }, ['aa'])), 'OK');
ok('...while the impossible month is still caught',
  ctxCod(comTemplate({ mm: '13' }, ['aa'])), 'MES_INVALIDO');
// A fixed part is judged on its model like a note, and an NF-e is accepted.
// The série is never asked, fixed or not.
ok('a fixed part fixed to an NF-e is accepted like a note',
  ctxCod(comTemplate({ modelo: '55', aa: '25', mm: '08' }, ['documentoEmitente'])), 'OK');
ok('a fixed part fixed to a CT-e describes only notes nobody can donate',
  ctxCod(comTemplate({ modelo: '57', aa: '25', mm: '08' }, ['documentoEmitente'])), 'TIPO_DOCUMENTO');
ok('a fixed part fixed to a CPF-band série is not judged on it',
  ctxCod(comTemplate({ serie: '930', aa: '25', mm: '08' }, ['documentoEmitente'])), 'OK');

// --- THE REGRESSION GUARD FOR THE WHOLE DESIGN ------------------------------
// One scanned key per grey reason. Each must BEAT the active fixed part (so the
// note registered is the one that was actually read, not a composition) and
// come back ineligible. If someone makes one of these red, the scanned note
// stops starts losing to the fixed part and this is what fails.
[
  ['expired', chaveCom({ aa: '24', mm: '01' }), 'EXPIRADA'],
  ['foreign state', chaveCom({ uf: '35', aa: '25', mm: '08' }), 'NAO_PR'],
  ['CT-e', chaveCom({ modelo: '57', aa: '25', mm: '08' }), 'TIPO_DOCUMENTO']
].forEach(function (caso) {
  const [nome, lida, codigo] = caso;
  ok('a scanned ' + nome + ' note beats the fixed part and is judged ineligible',
    [ParteFixa.resolver(lida, digitados, parteFixa), avCod(lida)],
    [{ chave: lida, origem: 'scan' }, [codigo, 'inelegivel']]);
});

// --- ADDING A RULE MUST NOT NEED A SECOND PLACE REMEMBERED ------------------
// REGRAS is internal to chave.js, so this reads the source. Every rule a fixed
// part template can trigger (anything not `escopo: 'chave'`) needs its own
// sentence in MSG_PARTE_FIXA, or the fixed part editor falls back to a
// sentence about "esta chave". This is the check that says so the day a rule
// is added, instead of a volunteer seeing it first.
{
  const fonteChave = fs.readFileSync(path.join(raiz, 'src/shared/chave.js'), 'utf8');
  const blocoRegras = fonteChave.slice(fonteChave.indexOf('const REGRAS = ['),
    fonteChave.indexOf('function aplicarRegras'));
  const entradas = blocoRegras.split("codigo: '").slice(1);
  const codigosDeTemplate = entradas
    .filter((e) => !/escopo:\s*'chave'/.test(e.slice(0, e.indexOf('testar'))))
    .map((e) => e.slice(0, e.indexOf("'")));
  const fonteReg = fs.readFileSync(path.join(raiz, 'src/shared/registrador.js'), 'utf8');
  const blocoMsg = fonteReg.slice(fonteReg.indexOf('const MSG_PARTE_FIXA = {'));
  const chavesMsg = (blocoMsg.slice(0, blocoMsg.indexOf('\n  };')).match(/^ {4}([A-Z_]+):/gm) || [])
    .map((l) => l.trim().slice(0, -1));
  ok('REGRAS parses into its entries (guards the check below against a silent no-op)',
    entradas.length >= 10 && codigosDeTemplate.indexOf('TIPO_DOCUMENTO') !== -1, true);
  ok('every rule a fixed part can trigger has its own fixed-part sentence',
    codigosDeTemplate.filter((c) => chavesMsg.indexOf(c) === -1), []);
}

// --- ParteFixa.compor: what is known SO FAR, always 44 characters --------------
// aplicar BREAKS OUT of its loop when the typed digits run out, dropping every
// fixed digit that comes after the last filled '?'. Right for composing a key,
// wrong for judging a half-typed one — a fixed part fixes digits AFTER the ones
// being typed, and those are known from the start. This is the difference, and
// it is what makes the live verdict possible at all.
ok('compor keeps trailing fixed digits where aplicar drops them',
  [ParteFixa.aplicar('41??65' + '?'.repeat(38), '2'),
   ParteFixa.compor('41??65' + '?'.repeat(38), '2')],
  ['412', '412?65' + '?'.repeat(38)]);
ok('compor with no fixed part is completar', ParteFixa.compor(null, '4125'), ParteFixa.completar('4125'));
ok('compor is always 44 characters', [ParteFixa.compor(null, '').length, ParteFixa.compor(null, chave).length],
  [44, 44]);
ok('...and a full entry under a fixed part composes the same key aplicar does',
  ParteFixa.compor(parteFixa, digitados), ParteFixa.aplicar(parteFixa, digitados));

// --- F1 regression: a scanned key must survive an active fixed part ----------
// This is the defect the cleanup started from. With a fixed part active,
// capture.js capped `typed` at the fixed part's '?' count and returned BEFORE
// appending to `raw`, so raw stopped growing at 9 chars, extrairChave found no
// 44-digit run, and resolverChave composed the fixed part with the barcode's
// FIRST 9 digits.
//
// `opcoes.intervalo(i)` is the gap in ms BEFORE character i, so a test can put
// a human and a scanner in the same buffer. Left out, every gap is 0 and the
// whole string reads as one machine burst, which is what every assertion
// written before the clock became movable assumed.
function digitarNoCapture(texto, variaveis, opcoes) {
  opcoes = opcoes || {};
  let recebido = null;
  // The last state capture EMITTED, as opposed to what it submitted. The two
  // answer different questions and the buffer bugs live in the first one.
  let ultimo = { typed: '', raw: '', rajada: false, suspeita: false };
  // Every state the entry was PAINTED with, in order. The last one is usually
  // what a test wants; the whole sequence is what catches a scan flashing the
  // url it arrived wrapped in.
  const pintados = [];
  const c = NFPR.Capture.iniciar({
    getParteFixaVariaveis: () => variaveis,
    getAutoEnviar: () => !!opcoes.autoEnviar,
    onMudanca(e) { ultimo = e; pintados.push(e.typed); },
    onEnviar(raw, typed, rajada, escaneado) { recebido = { raw, typed, rajada, escaneado }; }
  });
  const keydown = ouvintes.keydown[ouvintes.keydown.length - 1];
  texto.split('').forEach(function (ch, i) {
    if (opcoes.intervalo) relogioPerf.ms += opcoes.intervalo(i);
    // '<' stands for Backspace, so a test can put a correction in the string.
    keydown({ key: ch === '<' ? 'Backspace' : ch, preventDefault: noop, stopPropagation: noop });
  });
  if (opcoes.terminador !== false) {
    keydown({ key: 'Enter', preventDefault: noop, stopPropagation: noop });
  }
  if (opcoes.manter) {
    return { capture: c, leitura: () => recebido, estado: () => ultimo, pintados };
  }
  c.destruir();
  relogioPerf.ms = 0;
  if (recebido) recebido.pintados = pintados;
  return recebido;
}

const varDaParteFixa = ParteFixa.contarVariaveis(parteFixa); // 9
const scan = digitarNoCapture(chave, varDaParteFixa);
ok('capture keeps the full scan in raw', scan.raw, chave);
ok('capture still caps typed at the fixed part', scan.typed.length, varDaParteFixa);
ok('scanned key beats the fixed part end-to-end, flagged as a scan',
   ParteFixa.resolver(scan.raw, scan.typed, parteFixa), { chave: chave, origem: 'scan' });

// And with no fixed part at all, nothing changed.
const semParteFixa = digitarNoCapture(chave, 44);
ok('no fixed part: raw and typed both full', [semParteFixa.raw, semParteFixa.typed], [chave, chave]);

// --- A MACHINE BURST DOES NOT INHERIT A PERSON'S DIGITS ---------------------
// Nothing used to own the buffers: FIM_SCAN_MS clears the `escaneando` flag and
// never the text, so six digits abandoned earlier were still there when the
// next barcode arrived. `[their 6][the barcode's first 38]` is a 44-digit run
// extrairChave finds — a red refusal on a perfect scan, and nothing to do with
// fixed parts. Human gaps of 200 ms, then the scan at 0 ms after its own first
// character.
const sujo = digitarNoCapture('123456' + chave, 44, { intervalo: (i) => (i <= 6 ? 200 : 0) });
ok('a burst discards the digits a human left in the buffer',
  [sujo.raw, sujo.typed], [chave, chave]);

// --- ...AND A PERSON TYPING INTO A SCANNED BUFFER TAKES IT OVER -------------
// The flag used to last until the buffer emptied, so correcting a bad read by
// hand was still "a scan": the live verdict stayed silent while the volunteer
// typed, and the note never counted as typed, so nobody offered them fixed
// parts. A partial read of 20, then the rest by hand at 200 ms.
const corrigida = digitarNoCapture(chave, 44, { intervalo: (i) => (i < 20 ? 0 : 200) });
ok('a scan finished by hand is submitted as typed',
  [corrigida.typed, corrigida.rajada], [chave, false]);
// Backspace hands it over outright: no scanner ever sends one.
const apagada = digitarNoCapture(chave.slice(0, 20) + '<' + chave[19], 44,
  { intervalo: (i) => (i < 20 ? 0 : 200) });
ok('a Backspace in a scanned buffer makes it a person\'s',
  [apagada.typed, apagada.rajada], [chave.slice(0, 20), false]);
// A scan nobody touched stays a scan, or nothing above means anything.
ok('...while a scan nobody touched is still a scan',
  digitarNoCapture(chave, 44).rajada, true);
// THE ONE THAT KEEPS THE RULE SAFE. A main-thread stall mid-scan delivers one
// key after a long gap and the rest at machine speed behind it. Read as a
// person, that key would make the NEXT machine key discard everything before
// it as a person's leftovers — the scan's own head — and a perfect read would
// be refused. One keystroke of probation is what tells the two apart.
const travada = digitarNoCapture(chave, 44, { intervalo: (i) => (i === 20 ? 300 : 0) });
ok('a scan that stalls mid-read is still one scan, head and all',
  [travada.raw, travada.typed, travada.rajada], [chave, chave, true]);
// ...and the probation key must never auto-submit. Under a fixed part `typed`
// holds the scan's HEAD, so a stall landing on the key that fills the variable
// count would compose [fixed part] + [barcode head] — the fabrication this file
// exists to prevent — if autoEnviar fired on it.
const travadaNoLimite = digitarNoCapture(chave, varDaParteFixa, {
  autoEnviar: true,
  intervalo: (i) => (i === varDaParteFixa - 1 ? 300 : 0)
});
ok('a stall on the last variable digit never auto-submits a composition',
  [travadaNoLimite.raw, travadaNoLimite.rajada], [chave, true]);
// A person who typed ONE digit into a stale read and then scanned is not
// caught by the probation: the new scan's first character is a slow key too,
// and it spends it. The burst behind it discards the old buffer as usual.
const velhaMaisUm = digitarNoCapture('4125011' + '9' + chave, 44,
  { intervalo: (i) => (i < 7 ? 0 : i === 7 || i === 8 ? 200 : 0) });
ok('...and one hand digit then a new scan still starts the scan clean',
  [velhaMaisUm.raw, velhaMaisUm.typed], [chave, chave]);
// A SECOND SCAN ONTO AN UNSUBMITTED ONE IS NOT A STALL. A scanner that sends no
// Enter: key A read and left there, key B read three seconds later. B's first
// digit is slow and its second fast — the shape of a stalled scan resuming — so
// B was kept as A's continuation, the first 44-run was still A, and Enter
// submitted A while B vanished. Once B's own key is complete, A goes.
const base43B = '4125011234567800019565001000009876112345678';
const chaveB = base43B + Chave.calcularCDV(base43B + '0');
const duasLeituras = digitarNoCapture(chave + chaveB, 44,
  { intervalo: (i) => (i === 44 ? 3000 : 0) });
ok('a second scan onto an unsubmitted one submits the second',
  [duasLeituras.raw, duasLeituras.typed, duasLeituras.rajada], [chaveB, chaveB, true]);
ok('...and the cells show the second, not the first',
  duasLeituras.pintados[duasLeituras.pintados.length - 1], chaveB);
// (Two QR codes back to back are checked in the async block further down: a QR
// read starts with a letter, and what tells the second one apart is the idle
// timer having ended the first, which a synchronous run never lets fire.)
const qrDe = (k) => 'https://www.fazenda.pr.gov.br/nfce/qrcode?p=' + k + '|2|1|1|0123456789ABCDEF0123456789ABCDEF01234567';
// THE GUARD ON THAT GUARD. A scan can also stall AFTER its key is complete,
// inside the QR code's tail, and that is a real resumption: discarding there
// would throw the only key away. The tail never holds a key-shaped run — not
// even an off-line NFC-e's, whose 56-character hex digest (digVal: base64,
// hex-encoded) uppercases into a 44+ run of [0-9A-F] — so nothing is discarded.
const digestOffline = '71375A66336B50394C6D325877385274315662364E6334596830453D';
const qrOffline = 'https://www.fazenda.pr.gov.br/nfce/qrcode?p=' + chave +
  '|2|1|15|55.00|' + digestOffline + '|1|' + '0123456789ABCDEF0123456789ABCDEF01234567';
ok('the off-line digest fixture really is a 44+ run of key characters',
  /^[0-9A-Z]{44,}$/.test(digestOffline), true);
[qrDe(chave), qrOffline].forEach(function (qr, n) {
  const noRabo = qr.indexOf('|2|') + 3; // the digit after "|2|": slow, then fast
  const travadaNoRabo = digitarNoCapture(qr, 44, { intervalo: (i) => (i === noRabo ? 300 : 0) });
  ok('a QR scan that stalls in its tail keeps its key' + (n ? ' (off-line, hex digest)' : ''),
    [Chave.extrairChave(travadaNoRabo.raw), travadaNoRabo.typed], [chave, chave]);
});

// --- A SCAN CORRECTED BY HAND IS THE KEY THAT IS SENT --------------------------
// A scanner that sends no Enter, a QR code read and left in the buffer, and a
// volunteer who Backspaces over the last digit shown and types another. The
// Backspace used to trim `raw`'s last character — the url's tail — while the
// cells showed `typed`, so the cells said one key and the scanned 44-run still
// in `raw` was what went out. Now the first Backspace cuts `raw` down to the
// key, and the two edit together.
const chaveTroca = chave.slice(0, 43) + (chave[43] === '9' ? '8' : '9');
const qrLido = qrDe(chave);
const qrCorrigido = digitarNoCapture(qrLido + '<' + chaveTroca[43], 44,
  { intervalo: (i) => (i >= qrLido.length ? 300 : 0) });
ok('a Backspace after a QR scan takes the key\'s last digit, not the url\'s',
  [qrCorrigido.typed,
   ParteFixa.resolver(qrCorrigido.raw, qrCorrigido.typed, null, qrCorrigido.rajada).chave],
  [chaveTroca, chaveTroca]);
// ...and it is still the scan the capture reports, whoever holds it now: the
// flag registrador.js reads to never compose it with a fixed part.
ok('...and the buffer still says it held a scan, though a person now holds it',
  [qrCorrigido.rajada, qrCorrigido.escaneado], [false, true]);
// Typed by hand from the start, nothing is a scan.
ok('a key typed by hand never says it held a scan',
  digitarNoCapture(chave, 44, { intervalo: () => 200 }).escaneado, false);

// --- A PASTE THAT DOES NOT FIT IS NOT COMPOSED ----------------------------------
// A paste with no whole key in it used to be appended to `typed` whole, past
// the fixed part's variable count, and the composition then took only the
// FIRST N characters: twelve digits pasted where nine fit went out as the
// fixed part plus the first nine, the last three dropped without a word — a
// misaligned key, and about one in ten of those passes the check digit.
const colarNoCapture = (texto, variaveis) => {
  let recebido = null;
  const c = NFPR.Capture.iniciar({
    getParteFixaVariaveis: () => variaveis,
    onEnviar(raw, typed, rajada, escaneado) { recebido = { raw, typed, rajada, escaneado }; }
  });
  const colar = ouvintes.paste[ouvintes.paste.length - 1];
  colar({ clipboardData: { getData: () => texto }, preventDefault: noop });
  const antesDoEnter = recebido;
  ouvintes.keydown[ouvintes.keydown.length - 1]({ key: 'Enter', preventDefault: noop, stopPropagation: noop });
  c.destruir();
  relogioPerf.ms = 0;
  return { antesDoEnter, recebido };
};
const colouDemais = colarNoCapture('123456789012', varDaParteFixa);
ok('a paste longer than the fixed part leaves is judged at once, as it came',
  [!!colouDemais.antesDoEnter,
   colouDemais.recebido && ParteFixa.resolver(colouDemais.recebido.raw, colouDemais.recebido.typed,
     parteFixa, colouDemais.recebido.rajada || colouDemais.recebido.escaneado).origem],
  [true, 'rajada']);
// ...while one that fits is typing, and waits for Enter like typing does.
const colouCerto = colarNoCapture(chave.slice(35), varDaParteFixa);
ok('a paste that fits the fixed part composes, like the digits typed',
  [!!colouCerto.antesDoEnter,
   colouCerto.recebido && ParteFixa.resolver(colouCerto.recebido.raw, colouCerto.recebido.typed,
     parteFixa, colouCerto.recebido.rajada || colouCerto.recebido.escaneado)],
  [false, { chave: chave, origem: 'parteFixa' }]);
// A whole key pasted goes out as it always did.
const colouChave = colarNoCapture('chave: ' + chave, varDaParteFixa);
ok('a pasted whole key is submitted as it is',
  [!!colouChave.antesDoEnter, colouChave.antesDoEnter && colouChave.antesDoEnter.raw], [true, chave]);

// --- ONE FAST GAP IS NOT A SCANNER --------------------------------------------
// A hand rolling across adjacent keys (`321`, `45`) lands two or three keydowns
// inside 35 ms. Read as a burst, the first fast gap threw away every digit
// typed before it. Here the whole key is typed at 200 ms with runs of three
// fast keys, then of four — the observed ceiling, and one past it.
[3, 4].forEach(function (rolados) {
  const periodo = rolados + 2;
  const rolada = digitarNoCapture(chave, 44,
    { intervalo: (i) => (i % periodo >= 1 && i % periodo < rolados ? 10 : 200) });
  ok('fingers rolling ' + rolados + ' keys keep every digit and stay typing',
    [rolada.raw, rolada.typed, rolada.rajada], [chave, chave, false]);
});
// ...while five keys in a row at machine speed still are a scan, and the
// discard reaches back to where that run began, not to where it was believed.
const leftoverRapido = digitarNoCapture('12345' + chave, 44,
  { intervalo: (i) => (i <= 5 ? 200 : 0) });
ok('a burst believed on its fifth key still discards what came before its first',
  [leftoverRapido.raw, leftoverRapido.typed, leftoverRapido.rajada], [chave, chave, true]);
// THE GUARD THE LONGER RUN NEEDS. A scan under a fixed part with a short
// variable count fills it before the run is long enough to be believed;
// auto-sending then would compose [fixed part] + [barcode head]. The only
// submission must be Enter's, carrying the whole read.
const cabecaCurta = digitarNoCapture(chave, 3, {
  autoEnviar: true,
  intervalo: (i) => (i === 0 ? 1000 : 0)
});
ok('a scan filling a short fixed part before it is believed never auto-submits',
  [cabecaCurta.raw, cabecaCurta.rajada], [chave, true]);

// --- Esc empties the entry, and only when there is something to empty --------
(function () {
  const eventos = [];
  const capture = NFPR.Capture.iniciar({
    getParteFixaVariaveis: () => 44,
    onMudanca(e) { eventos.push(e.typed); },
    onEnviar() { eventos.push('ENVIOU'); }
  });
  const keydown = ouvintes.keydown[ouvintes.keydown.length - 1];
  let bloqueados = 0;
  const esc = () =>
    keydown({ key: 'Escape', preventDefault: () => { bloqueados += 1; }, stopPropagation: noop });
  for (const ch of '123456') keydown({ key: ch, preventDefault: noop, stopPropagation: noop });
  esc();
  ok('Esc clears a buffer that holds something, and submits nothing',
    [eventos[eventos.length - 1], eventos.indexOf('ENVIOU'), bloqueados], ['', -1, 1]);
  // WITH AN EMPTY BUFFER IT FALLS THROUGH UNTOUCHED, which is what lets Esc go
  // on meaning whatever it means to the page (and to the settings overlay).
  esc();
  ok('...and is not consumed when there is nothing to clear', bloqueados, 1);
  capture.destruir();
})();

marco('capture owns its buffer, and Esc empties it');

// --- A READING ENDS ONCE ----------------------------------------------------
// Some scanners close a read with a burst of terminators — six Tabs, CR and
// LF. The first submits and empties the buffer; the rest used to reach the
// browser, where Tab walked focus through the panel, into the government page
// and out to the address bar, and the next scan was typed wherever it landed.
// 1.0.1 answered by swallowing every Tab while capture was live, which also
// took the keyboard away from every control. The rule now is the tail's:
// swallowed when it belongs to a reading, left alone when a person pressed it.
// "Swallowed" is preventDefault, which is all that keeps the browser out of it.
(function () {
  const monta = (opcoes) => {
    const envios = [];
    const c = NFPR.Capture.iniciar(Object.assign({
      getParteFixaVariaveis: () => 44,
      onEnviar(raw, typed) { envios.push(typed); }
    }, opcoes || {}));
    const keydown = ouvintes.keydown[ouvintes.keydown.length - 1];
    // Sends `teclas` (an array of keys, or of event objects) `gap` ms apart,
    // the first one `antes` ms after whatever came before; answers which of
    // them were swallowed.
    const tecla = (teclas, gap, antes) => teclas.map((t, i) => {
      relogioPerf.ms += i === 0 ? antes : gap;
      let engolida = false;
      keydown(Object.assign({ preventDefault: () => { engolida = true; }, stopPropagation: noop },
        typeof t === 'string' ? { key: t } : t));
      return engolida;
    });
    const fim = () => { c.destruir(); relogioPerf.ms = 0; };
    return { envios, tecla, fim };
  };
  const SEIS = ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab'];
  const todas = (n, v) => Array.from({ length: n }, () => v);

  // The report that started it: a key, then six Tabs, all at machine speed.
  let m = monta();
  m.tecla(chave.split(''), 2, 1000);
  ok('a burst of Tabs behind a scan is one termination: one key out, no Tab reaches the browser',
    [m.tecla(SEIS, 2, 2), m.envios], [todas(6, true), [chave]]);
  // ...and the next reading is none the worse for it.
  m.tecla(chaveB.split(''), 2, 1500);
  m.tecla(['Enter'], 2, 2);
  ok('...and the next scan is read whole', m.envios, [chave, chaveB]);
  m.fim();

  // CR, LF and a Tab: the mix is the same tail.
  m = monta();
  m.tecla(chave.split(''), 2, 1000);
  ok('CR, LF and a Tab behind a scan are one termination too',
    [m.tecla(['Enter', 'Enter', 'Tab'], 2, 2), m.envios], [todas(3, true), [chave]]);
  m.fim();

  // A scanner too slow for the 35 ms heuristic is read as a typist — and its
  // tail is still its tail, because the entry ended a moment ago.
  m = monta();
  m.tecla(chave.split(''), 60, 1000);
  ok('a slow scanner\'s tail is swallowed by the window its own submission opened',
    [m.tecla(SEIS, 60, 60), m.envios], [todas(6, true), [chave]]);
  // The window closes: 250 ms of silence and Tab is the person's again.
  ok('...and once it has gone quiet, Tab moves focus again', m.tecla(['Tab'], 0, 300), [false]);
  m.fim();

  // autoEnviar sends a typed key at its last digit, so the terminator behind
  // it finds an empty buffer. It is still that entry's terminator.
  m = monta({ getAutoEnviar: () => true });
  m.tecla(chave.split(''), 60, 1000);
  ok('a key that went out by auto-send still owns the terminator behind it',
    [m.envios, m.tecla(['Tab', 'Tab'], 60, 60)], [[chave], [true, true]]);
  m.fim();

  // A QR code holding no key leaves nothing to submit, so no terminator of
  // its tail is "the one that submitted". Speed alone has to carry it.
  m = monta();
  m.tecla('HTTP://EXEMPLO.COM/ABC'.split(''), 2, 1000);
  ok('the tail of a reading that held no key is swallowed on speed alone',
    [m.tecla(SEIS, 2, 2), m.envios], [todas(6, true), []]);
  m.fim();

  // THE OTHER HALF, AND THE ONE 1.0.1 BROKE: a person walking the controls.
  m = monta();
  ok('Tab pressed by hand on an empty entry is the browser\'s, every time',
    m.tecla(['Tab', 'Tab', 'Tab'], 180, 1000), [false, false, false]);
  ok('...and so is Enter on the button it landed on', m.tecla(['Enter'], 0, 120), [false]);
  // Shift+Tab is two keydowns a few ms apart. Measured from the Shift it
  // would be a machine-speed Tab.
  ok('Shift+Tab is not a burst: the gap is not measured from the Shift',
    m.tecla(['Shift', { key: 'Tab', shiftKey: true }], 5, 800), [false, false]);
  // A held Tab auto-repeats at about 30 ms. No scanner can send a repeat.
  ok('a held Tab keeps moving focus',
    m.tecla([{ key: 'Tab' }, { key: 'Tab', repeat: true }, { key: 'Tab', repeat: true }], 30, 800),
    [false, false, false]);
  // Typing a key and ending it by hand: one Tab, consumed as the terminator.
  m.tecla(chave.split(''), 200, 800);
  ok('a typed key still ends on Tab, and that Tab moves nothing',
    [m.tecla(['Tab'], 0, 200), m.envios], [[true], [chave]]);
  // THE ACCEPTED COST, pinned so it is not mistaken for a bug or "fixed" by
  // swallowing every Tab again: a tail with nothing in front of it lets its
  // first terminator through.
  ok('a bare tail lets its first terminator through and swallows the rest',
    m.tecla(SEIS, 2, 1000), [false, true, true, true, true, true]);
  // A browser shortcut is never ours.
  ok('Ctrl+Tab passes even inside a tail',
    m.tecla([{ key: 'Tab', ctrlKey: true }], 0, 2), [false]);
  m.fim();
})();

marco('a reading ends once, and a Tab pressed by hand still moves focus');

marco('pure logic: CDV, extraction, fields, the two models, deadlines, fixed parts');

// ---------------------------------------------------------------------------
// THE ALPHANUMERIC CNPJ, FROM THE ARITHMETIC TO THE KEYBOARD
// ---------------------------------------------------------------------------
// The issuer's CNPJ may carry uppercase letters in its first twelve characters
// (IN RFB 2.229/2024, in production since 07/2026), so the key does too — at
// indices 6..17 and NOWHERE ELSE, because [18:20] is the CNPJ's own check
// digits and every other span was always numeric.
//
// Everything below is either that window or the arithmetic that reads it: each
// character's ASCII value minus 48. That mapping is a no-op on digits, which is
// why all 500-odd numeric assertions in this file still pass untouched — and
// why the failures worth catching are letters accepted where one cannot stand,
// not numeric keys breaking.
(function () {
  // THE ONE PUBLISHED VECTOR, from Receita Federal itself. If this line fails
  // the mapping is wrong and nothing else here is worth reading.
  ok('Cnpj.validar(12ABC34501DE35) — the published example',
    Cnpj.validar('12ABC34501DE35'), true);
  ok('...its check digits are load-bearing', Cnpj.validar('12ABC34501DE36'), false);
  ok('...and a numeric CNPJ is untouched by the new mapping',
    Cnpj.validar('11222333000181'), true);
  // The check digits are NUMERIC. A letter there is not an unlucky CNPJ, it is
  // a fourteen-character string that is not one.
  ok('a letter in the check digits is not a CNPJ', Cnpj.validar('12ABC34501DEA5'), false);
  ok('Cnpj.formatar formats it the way the site does ("AA.AAA.AAA/AAAA-00")',
    Cnpj.formatar('12abc34501de35'), '12.ABC.345/01DE-35');
  // TWO STRIPS, AND CONFUSING THEM IS A DATA-LOSS BUG: validarCpf must keep the
  // digits-only one, or an alphanumeric span reaches it short and unreadable.
  ok('Cnpj.limpar keeps letters, soDigitos does not',
    [Cnpj.limpar('12.ABC.345/01DE-35'), Cnpj.soDigitos('12.ABC.345/01DE-35')],
    ['12ABC34501DE35', '123450135']);

  // ---- the key -------------------------------------------------------------
  const chaveAlfa = chaveCom({ documentoEmitente: '12ABC34501DE35' });
  ok('an alphanumeric issuer passes every check a numeric one does',
    Chave.avaliar(chaveAlfa, NA_EMISSAO).ok, true);
  // The letters are IN the sum, not skipped over: zeroing them changes the
  // check digit. A CDV that ignored them would accept both.
  ok('the letters reach the check digit',
    Chave.calcularCDV(chaveAlfa) === Chave.calcularCDV(chaveAlfa.replace(/[A-Z]/g, '0')),
    false);
  ok('...and the key is self-consistent', Chave.calcularCDV(chaveAlfa), chaveAlfa[43]);

  // ---- the window, which is the whole of FORMATO ----------------------------
  // BOTH ENDS OF [6:18], from one fixture: A1.234.567/890Z-88 is a valid CNPJ
  // with a letter in its first character and in its twelfth, which land on key
  // indices 6 and 17. Nothing is spliced in, so the CNPJ's own check digits
  // still hold and the verdict is about the window alone.
  const chaveBordas = chaveCom({ documentoEmitente: 'A1234567890Z88' });
  ok('a letter at 6 and at 17 is the issuer, and the key is fine',
    [chaveBordas[6], chaveBordas[17], Chave.avaliar(chaveBordas, NA_EMISSAO).codigo],
    ['A', 'Z', 'OK']);
  // ...and one character outside it either way is corrupted input. The check
  // digit is recomputed each time, so FORMATO is the only thing that can fire —
  // it sits above DOCUMENTO_EMITENTE in the table, which is what makes a letter
  // in the issuer's own check digits read as a format error rather than as a
  // broken checksum.
  const comLetraEm = (i) => {
    const s = chaveAlfa.slice(0, i) + 'A' + chaveAlfa.slice(i + 1);
    const b43 = s.slice(0, 43);
    return Chave.avaliar(b43 + Chave.calcularCDV(b43 + '0'), NA_EMISSAO).codigo;
  };
  ok('a letter at 5, at 18 (the CNPJ check digits) or in the série is FORMATO',
    [comLetraEm(5), comLetraEm(18), comLetraEm(23)],
    ['FORMATO', 'FORMATO', 'FORMATO']);
  ok('Chave.posicaoAlfanumerica is that window and nothing else',
    [5, 6, 17, 18].map(Chave.posicaoAlfanumerica), [false, true, true, false]);
  // A CPF NEVER WENT ALPHANUMERIC, and the CPF band must keep saying so.
  ok('a letter in a CPF-band issuer is still refused',
    cod(chaveCom({ serie: '930', documentoEmitente: '000A1234567890' })),
    'DOCUMENTO_EMITENTE');

  // ---- extraction ----------------------------------------------------------
  ok('extrairChave(alphanumeric barcode)', Chave.extrairChave(chaveAlfa), chaveAlfa);
  ok('extrairChave(lower case) — a key typed or pasted in lower case is the key',
    Chave.extrairChave(chaveAlfa.toLowerCase()), chaveAlfa);
  const qrAlfa = 'https://www.fazenda.pr.gov.br/nfce/qrcode?p=' + chaveAlfa + '|2|1|1|ABCDEF';
  // UPPER-CASING THE WHOLE URL MUST NOT MANUFACTURE A RUN. Every token of it —
  // HTTPS, FAZENDA, QRCODE — is closed by a separator that is not a key
  // character, so the key stays the only run of 44.
  ok('extrairChave(qr url with an alphanumeric key)', Chave.extrairChave(qrAlfa), chaveAlfa);
  ok('extrairChave(a formatted key, pasted with its spaces)',
    Chave.extrairChave(NFPR.agruparChave(chaveAlfa)), chaveAlfa);

  // ---- what the cells show mid-scan ----------------------------------------
  // chaveParcial replaced `raw.replace(/\D/g, '')`, which worked only because a
  // key was all digits and the URL around it was all letters and punctuation.
  ok('chaveParcial(a whole key inside a url) is the key',
    Chave.chaveParcial(qrAlfa), chaveAlfa);
  ok('...mid-read it is the key prefix, not the url around it',
    Chave.chaveParcial('https://www.fazenda.pr.gov.br/nfce/qrcode?p=41260912ABC'),
    '41260912ABC');
  ok('...and for a plain barcode it is simply what has arrived',
    Chave.chaveParcial(chaveAlfa.slice(0, 20)), chaveAlfa.slice(0, 20));

  // ---- fixed parts ----------------------------------------------------------
  // The head of a key is the issuer's CNPJ, so a fixed part is the thing most
  // likely to hold letters from now on.
  ok('ParteFixa.normalizar keeps letters and upper-cases them',
    ParteFixa.normalizar('4126 09 12abc345/01de35?'), '41260912ABC34501DE35?');

  // ---- the keyboard --------------------------------------------------------
  // EVERY KEY CHARACTER IS ACCEPTED, WHEREVER IT IS TYPED. Where a letter may
  // stand is a VERDICT (FORMATO, and the live verdict while typing), never a
  // filter on the keystroke: an entry that swallows letters in silence reads as
  // broken, which is exactly how it was first reported.
  const devagar = (texto) => digitarNoCapture(texto, 44, { intervalo: () => 200 });
  ok('a letter typed where the issuer starts enters the buffer',
    devagar('412609A').typed, '412609A');
  ok('...and so does one typed where the key is numeric — the verdict refuses it',
    devagar('4126A09').typed, '4126A09');
  ok('...which FORMATO is what says, on the whole key',
    Chave.avaliar('4126A0' + chaveAlfa.slice(6), NA_EMISSAO).codigo, 'FORMATO');
  ok('...and a lower-case one is stored the way a key is written',
    devagar('412609a').typed, '412609A');

  // A LETTER NEVER CONFIRMS A BURST. Four quick letters satisfy RAJADA_MINIMA
  // as easily as four quick digits, and marcarRajada's answer to a burst is to
  // DISCARD everything typed before the run — so rattling off letters, or
  // simply holding one down, emptied the entry of digits that were already
  // correct. Reported from real use; the gaps below are the ones that did it.
  {
    const r = digitarNoCapture('412609ABCDE', 44, {
      terminador: false, manter: true, intervalo: (i) => (i < 6 ? 200 : 25)
    });
    ok('letters rattled off do not turn the buffer into a scan',
      [r.leitura(), r.estado().typed, r.estado().rajada],
      [null, '412609ABCDE', false]);
    r.capture.destruir();
    relogioPerf.ms = 0;
  }
  // ...while a run of DIGITS still is one, which is the half that must not
  // break: same speed, same threshold, opposite answer.
  {
    const r = digitarNoCapture(chaveAlfa, 44, { terminador: false, manter: true });
    ok('...and a burst of digits is still believed', r.estado().rajada, true);
    r.capture.destruir();
    relogioPerf.ms = 0;
  }

  // A SCAN ARRIVING ON TOP OF A PARTLY TYPED BUFFER. The volunteer has eight
  // characters in the entry and scans a note. Indices 6..17 are exactly where
  // the caret is, so a positional rule let the URL's own letters in — the entry
  // read `41260912HTTPS…` with the key welded on behind it. Deriving `typed`
  // from `raw` cannot have that bug: chaveParcial separates the key from the
  // text around it, wherever the buffer happened to be.
  {
    const lido = digitarNoCapture('41260912' + qrAlfa, 44, {
      intervalo: (i) => (i < 8 || i === 8 ? 200 : 5)
    });
    ok('a QR scan over a partly typed entry submits the scanned key alone',
      [Chave.extrairChave(lido.raw), lido.typed, lido.rajada],
      [chaveAlfa, chaveAlfa, true]);
  }
  // NOTHING FROM THE URL IS EVER PAINTED INTO THE CELLS. A QR code arrives as
  // a row of runs — HTTPS, WWW, FAZENDA, PR, GOV, BR, NFCE, QRCODE — and each
  // of them became the entry for a few milliseconds as the scan swept past:
  // two dozen repaints of words at a volunteer who is watching that box. Two
  // rules stop it, and this asserts the outcome of both. chaveParcial only
  // reports a run that could BEGIN a key, which no word can; and while
  // characters are arriving fast a letter is only appended where a key could
  // carry one, which is what keeps the pre-confirmation frames clean too.
  ok('chaveParcial ignores a run that cannot begin a key',
    [Chave.chaveParcial('https://www.fazenda.pr.gov.br/nfce/qrcode'),
     Chave.chaveParcial('https://www.fazenda.pr.gov.br/nfce/qrcode?p=41260912ABC')],
    ['', '41260912ABC']);
  // ...and NOT by looking for "41": the registrar shows out-of-state notes and
  // names the state they came from, so a key opening 35 or 43 has to reach the
  // cells like any other.
  ok('...while an out-of-state key is still key material', Chave.chaveParcial('3526086180'), '3526086180');
  {
    const lido = digitarNoCapture(qrAlfa, 44);
    const palavras = lido.pintados.filter((t) => /^[A-Z]{2}/.test(t));
    ok('a QR scan paints no word from its own url', palavras, []);
    ok('...and every frame it does paint could be the start of a key',
      lido.pintados.filter((t) => t && !/^[0-9]{1,6}[0-9A-Z]{0,12}[0-9]*$/.test(t) && t.length > 1),
      []);
  }
  // The whole thing at scanner speed from an empty entry, through the URL.
  {
    const lido = digitarNoCapture(qrAlfa, 44);
    ok('a QR burst carrying an alphanumeric key submits that key',
      [Chave.extrairChave(lido.raw), lido.typed, lido.rajada], [chaveAlfa, chaveAlfa, true]);
  }
  // A PLAIN CODE-128A BARCODE — no URL, letters in the middle, nothing
  // separating them from the digits.
  {
    const lido = digitarNoCapture(chaveAlfa, 44);
    ok('a plain alphanumeric barcode arrives whole', lido.typed, chaveAlfa);
  }
})();

marco('the alphanumeric CNPJ travels from the keyboard to the check digit');

// --- the registrar UI must build, and its whole public API must run ---------
(async function () {
  try {
    // --- the AudioContext is unlocked by a gesture that can unlock it -------
    // A WORLD OF ITS OWN, because the shared one's context is born running and
    // its document has capture's listeners on it. Here the context starts
    // SUSPENDED, as a browser makes it outside user activation, and resume()
    // is refused until the stub says activation has happened. The first build
    // listened for one gesture of any kind and then stopped: Shift right after
    // load, and every cue was silent for the rest of the page.
    const mundoDeAudio = (comAtivacao) => {
      const ouv = {};
      const estado = { liberado: false, criados: 0, tons: 0, ctx: null };
      const nada = () => {};
      const param = { setValueAtTime: nada, linearRampToValueAtTime: nada,
                      exponentialRampToValueAtTime: nada };
      class ContextoStub {
        constructor() {
          estado.criados += 1;
          estado.ctx = this;
          this.state = 'suspended';
          this.currentTime = 0;
          this.destination = {};
        }
        resume() {
          if (!estado.liberado) return Promise.reject(new Error('not allowed to start'));
          this.mudar('running');
          return Promise.resolve();
        }
        mudar(s) { this.state = s; if (this.onstatechange) this.onstatechange(); }
        createOscillator() {
          estado.tons += 1;
          return { frequency: param, connect: nada, disconnect: nada, start: nada, stop: nada };
        }
        createGain() { return { gain: param, connect: nada, disconnect: nada }; }
      }
      const nav = comAtivacao ? { userActivation: { isActive: false } } : {};
      const sb = {
        console, Promise, setTimeout, clearTimeout,
        navigator: nav,
        AudioContext: ContextoStub,
        document: {
          addEventListener: (t, f) => { (ouv[t] = ouv[t] || []).push(f); },
          removeEventListener: (t, f) => { ouv[t] = (ouv[t] || []).filter((g) => g !== f); }
        }
      };
      sb.globalThis = sb;
      sb.self = sb;
      vm.createContext(sb);
      vm.runInContext(fs.readFileSync(path.join(raiz, 'src/content/audio.js'), 'utf8'), sb,
        { filename: 'src/content/audio.js' });
      const gesto = async (tipo) => {
        for (const f of (ouv[tipo] || []).slice()) f({});
        for (let i = 0; i < 5; i += 1) await Promise.resolve();
      };
      const armado = () => (ouv.keydown || []).length > 0;
      const tocou = () => { const antes = estado.tons; sb.NFPR.Audio.erro(); return estado.tons > antes; };
      return { estado, nav, gesto, armado, tocou };
    };

    {
      // No way to ask about activation: the first gesture is spent, refused,
      // and the second one — a real click — has to be able to try again.
      const a = mundoDeAudio(false);
      await a.gesto('keydown');
      ok('a refused first gesture leaves the cues silent and the listeners armed',
        [a.estado.criados, a.estado.ctx.state, a.armado(), a.tocou()], [1, 'suspended', true, false]);
      a.estado.liberado = true;
      await a.gesto('mousedown');
      ok('...and a second gesture resumes the same context, and the cues play',
        [a.estado.criados, a.estado.ctx.state, a.tocou()], [1, 'running', true]);
      ok('...after which nothing listens any more', a.armado(), false);
      // Suspended by the system later: the next gesture brings it back.
      a.estado.ctx.mudar('suspended');
      ok('a context suspended later re-arms the listeners', a.armado(), true);
      await a.gesto('touchend');
      ok('...and the next gesture resumes it', [a.estado.ctx.state, a.tocou(), a.armado()],
        ['running', true, false]);
    }
    {
      // Where the browser says a gesture is not activation (Shift, Esc), it is
      // skipped outright: no context yet, so no warning in the console.
      const b = mundoDeAudio(true);
      await b.gesto('keydown');
      ok('a gesture without user activation creates no context', [b.estado.criados, b.armado()], [0, true]);
      b.nav.userActivation.isActive = true;
      b.estado.liberado = true;
      await b.gesto('keydown');
      ok('...and the first one with it starts the context', [b.estado.criados, b.estado.ctx.state,
        b.tocou(), b.armado()], [1, 'running', true, false]);
    }
    marco('a gesture that cannot start the sound does not use up the chance to');

    // --- autoEnviar fires at the END of a burst, never at its 44th digit ----
    // THE ASSERTION THAT PINS THE QR BUG. A QR scan is
    // `…/nfce/qrcode?p=<44 digits>|2|1|1|ABC`, so with no fixed part the run of
    // 44 completed MID-READING: the key went out correctly at digit 44, reset()
    // emptied both buffers, the trailing `2`, `1`, `1` landed in a fresh
    // `typed`, and the scanner's own Enter submitted `211` as a key. A correct
    // registration followed by a spurious red toast, on every QR scan, whenever
    // the preference was on.
    const qr = 'https://www.fazenda.pr.gov.br/nfce/qrcode?p=' + chave + '|2|1|1|ABC';
    const lerQr = async (comEnter) => {
      const enviados = [];
      const c = NFPR.Capture.iniciar({
        getParteFixaVariaveis: () => 44,
        getAutoEnviar: () => true,
        onEnviar(raw) { enviados.push(NFPR.Chave.extrairChave(raw)); }
      });
      const keydown = ouvintes.keydown[ouvintes.keydown.length - 1];
      for (const ch of qr) keydown({ key: ch, preventDefault: noop, stopPropagation: noop });
      if (comEnter) keydown({ key: 'Enter', preventDefault: noop, stopPropagation: noop });
      await new Promise((r) => setTimeout(r, 300)); // past FIM_SCAN_MS
      c.destruir();
      return enviados;
    };
    ok('a QR burst under autoEnviar submits exactly once, with the right key',
      await lerQr(true), [chave]);
    // ...and the idle timer is the safety net for a scanner that sends no
    // terminator at all. Never both: the terminator resets the buffer, so the
    // timer then finds nothing to send.
    ok('...and a burst with no terminator still submits once, at its end',
      await lerQr(false), [chave]);
    // FINGERS WHOSE LAST DIGITS WERE ROLLED. The digit path holds auto-send
    // back while a fast run might still become a scan; when it ends short, the
    // idle timer is what sends it — once, as typed, with the verdict released.
    {
      const rolada = digitarNoCapture(chave, 44, {
        autoEnviar: true,
        terminador: false,
        manter: true,
        intervalo: (i) => (i >= 41 ? 10 : 200)
      });
      ok('...a typed key ending in rolled digits is held while the run is suspect',
        rolada.leitura(), null);
      await new Promise((r) => setTimeout(r, 300)); // past FIM_SCAN_MS
      ok('...and sent as typed once the run ends short',
        rolada.leitura(), { raw: chave, typed: chave, rajada: false, escaneado: false });
      rolada.capture.destruir();
      relogioPerf.ms = 0;
    }
    // TWO QR CODES, NO ENTER BETWEEN THEM. The first read ends (the idle timer
    // fires), the second arrives three seconds later; Enter must carry the
    // second key, never silently the first.
    {
      const enviados = [];
      const c = NFPR.Capture.iniciar({
        getParteFixaVariaveis: () => 44,
        onEnviar(raw) { enviados.push(NFPR.Chave.extrairChave(raw)); }
      });
      const keydown = ouvintes.keydown[ouvintes.keydown.length - 1];
      for (const ch of qrDe(chave)) keydown({ key: ch, preventDefault: noop, stopPropagation: noop });
      await new Promise((r) => setTimeout(r, 300)); // past FIM_SCAN_MS
      relogioPerf.ms += 3000;
      for (const ch of qrDe(chaveB)) keydown({ key: ch, preventDefault: noop, stopPropagation: noop });
      keydown({ key: 'Enter', preventDefault: noop, stopPropagation: noop });
      c.destruir();
      relogioPerf.ms = 0;
      ok('two QR codes with no Enter between them submit the second', enviados, [chaveB]);
    }
    marco('autoEnviar waits for the end of a scan');

    const ui = await NFPR.UI.montar({ modoOffline: true, montarEm: elemento() });
    // THE CONTRACT IS WHAT THE CALLERS CALL. This list used to be written by
    // hand, and it was short: setStatusDica and setPartesFixasVisiveis, which
    // registrador.js calls on every config change, were not on it — so either
    // could have been renamed in painel.js, passed here, and thrown on the live
    // page the first time a preference moved. It is read out of the callers
    // now: every `ui.x(` in the three files that drive a mounted UI, plus what
    // modal-entidade.js reaches through NFPR.UI.instancia. The written names
    // are the ones only this file calls.
    const chamadasDaUi = new Set(['setPartesFixasVisiveis', 'setStatusDica']);
    [
      ['src/shared/registrador.js', /\bui\.([A-Za-z]\w*)\s*\(/g],
      ['src/content/content.js', /\bui\.([A-Za-z]\w*)\s*\(/g],
      ['src/offline/entrada.js', /\bui\.([A-Za-z]\w*)\s*\(/g],
      ['src/content/modal-entidade.js', /\binstancia\.([A-Za-z]\w*)\s*\(/g]
    ].forEach(function (par) {
      const fonte = fs.readFileSync(path.join(raiz, par[0]), 'utf8');
      for (const m of fonte.matchAll(par[1])) chamadasDaUi.add(m[1]);
    });
    ok('the callers were actually read, not an empty set passed off as a clean bill',
      chamadasDaUi.size > 30, true);
    // BOTH registrars hand UI.montar the storage write behind "Limpar a
    // lista". The shared bootstrap shows the failures list on the offline page
    // too, and without the option ui.js's fallback empties the bar and writes
    // nothing — the list is back on the next load, with nothing on screen to
    // say the click did not take.
    ['src/content/content.js', 'src/offline/entrada.js'].forEach(function (f) {
      const fonte = fs.readFileSync(path.join(raiz, f), 'utf8');
      ok(f + ' passes aoLimparFalhas → Config.limparFalhas to UI.montar',
        /aoLimparFalhas:\s*\(\)\s*=>\s*Config\.limparFalhas\(\)/.test(fonte), true);
    });
    const faltando = Array.from(chamadasDaUi).filter((k) => typeof ui[k] !== 'function');
    if (faltando.length) {
      console.error('UI api missing: ' + faltando.join(', '));
      process.exit(1);
    }
    // THE INSTRUCTION HALF GOES WITH THE BLOCK. "Escaneie a nota…" describes
    // something that cannot happen while the entry is blocked — there is
    // nowhere to send a note yet — and an instruction that does not work is
    // worse than none on the one screen a first-time volunteer is trying to
    // read. It moved out of `dica`, which was hidden for good by the first row,
    // and into the empty results list, where its lifetime is right for free —
    // so the rule survives and the assertion moves with it.
    const instrucao = criados.find((e) => e.className === 'nfpr-results-empty-instrucao');
    const listaVazia = criados.find((e) => e.className === 'nfpr-results-empty');
    ui.bloquearEntrada('x');
    ok('blocking the entry drops the instruction half of the empty list',
      !!instrucao.atributos.hidden, true);
    ui.desbloquearEntrada();
    ok('...and unblocking brings it back', !!instrucao.atributos.hidden, false);

    const id = ui.adicionarItem('41250107123456780001956500100000123412345672', '11222333000181');
    ui.atualizarItem(id, { estado: 'sucesso', mensagem: 'ok' });
    ui.setConexao('rede');
    ui.setConexao('online');
    ui.setConexao(null);
    ui.setEntidade({ nome: 'X', cnpj: '11222333000181' });
    ui.setPartesFixas({ rotulo: 'M', variaveis: 42, template: '41'.padEnd(44, '?'), lista: [], ativaId: null }, {});
    ui.setProgressoEntrada(3);
    ui.setStatusVeredito({ texto: 'x', aviso: true });
    ui.setStatusVeredito(null);
    ui.setStatusRepouso({ texto: 'y', aviso: true, rotulo: 'Preferências', aoClicar() {} });
    ui.setStatusRepouso(null);
    ui.setParteFixaIgnorada({ mensagem: 'm', aoDispensar() {} });
    ui.setParteFixaIgnorada(null);
    // The stale-fixed-part bar's way out is a button wired to the handler that
    // comes WITH the state, so registrador.js can own the deactivation without
    // this file ever touching storage.
    let dispensou = 0;
    ui.setParteFixaVencida({ aoDispensar: () => { dispensou += 1; } });
    const btnDispensar = criados.find((e) => e.textContent === 'Digitar a chave inteira');
    if (!btnDispensar || btnDispensar.tagName !== 'BUTTON') {
      console.error('the stale-fixed-part bar is missing its "usar sem parte fixa" button');
      process.exit(1);
    }
    for (const fn of btnDispensar.escutas.click || []) fn({});
    if (dispensou !== 1) {
      console.error('the stale-fixed-part bar action did not reach its handler');
      process.exit(1);
    }
    ui.setParteFixaVencida(null);
    ui.definirParteFixaTemplate(null);
    ui.atualizarDisplay({ typed: '123', templateParteFixa: null });
    ui.limparDisplay();
    // ...BUT IT DOES NOT COME BACK OVER A LIST THAT HAS ROWS. The first scan
    // retires the hint for good, and desbloquearEntrada runs on EVERY config
    // change rather than only on the one that unblocks the entry — so an
    // unguarded restore pops "Escaneie a chave de acesso…" back over a screen
    // full of results the moment a preference is toggled or a fixed part is
    // added. A row exists by now, which is what makes this the other half.
    // ...AND THE GUARD THAT USED TO BE NEEDED HERE IS GONE, on purpose. `dica`
    // sat above the entry, so desbloquearEntrada — which runs on EVERY config
    // change, not only the one that unblocks — had to check the list was empty
    // or it popped a hint back over a screen full of results. The instruction
    // is inside the empty-list element now, which the first row takes out of
    // the document, so there is nothing left to pop back.
    ui.bloquearEntrada('x');
    ui.desbloquearEntrada();
    ok('the instruction cannot come back over a list that already has rows',
      !!listaVazia.removido, true);
    ui.setAutoEnviar(true);
    ui.setFlash(true);
    ui.mostrarErro('e');
    ui.limparErro();
    ui.mostrarToast('t', 'ok');
    ui.flash();
    ui.abrir('ajuda');
    ui.abrir('config');
    if (ui.estaAberto() !== true) {
      console.error('estaAberto should be true after abrir');
      process.exit(1);
    }
    // The connection action button is a code path the default mount never
    // reaches.
    const clicar = (e) => { for (const fn of (e && e.escutas.click) || []) fn({ target: e, closest: () => null }); };
    const porTexto = (t) => criados.find((e) => e.textContent === t);
    let clicouConexao = false;
    const ui2 = await NFPR.UI.montar({
      montarEm: elemento(),
      conexaoPermanente: true,
      acaoConexao: { rotulo: 'ir', aoClicar() { clicouConexao = true; } }
    });
    ui2.setConexao('verificando', 'checando');
    ui2.setConexao('online', 'pronto');
    clicar(porTexto('ir'));
    ok('the connection bar runs its own action', clicouConexao, true);

    // THE PANEL BUILDS NO DUPLICATE-SESSION BANNER, in any state. There was one,
    // and it narrated the same /sair the session condition bar narrates — two
    // surfaces on one event, which is how they ended up disagreeing about what
    // to do next. Everything it did is that bar now, content.js driving it,
    // including the first moment, which is painted at load before any note has
    // failed. Asserted as ABSENT rather than simply unused: a builder nothing
    // shows is a second narrator waiting to be switched back on.
    ok('the panel builds no duplicate-session banner of its own',
      criados.some((e) => /nfpr-sessao-bar|nfpr-sessao-dismiss/.test(e.className)),
      false);

    // A note whose scan overrode the active fixed part has to say so in the
    // row, not only in the moment's warning ping.
    ui2.adicionarItem('4'.repeat(44), '11222333000181', { parteFixaIgnorada: true });
    if (!criados.some((e) => /parte fixa não usada/.test(e.textContent))) {
      console.error('a fixed-part-overriding scan is not flagged in its result row');
      process.exit(1);
    }

    // Same rule, for the one thing worse than an overridden fixed part: a note
    // debug mode pushed through a gate that exists to stop it. If this marker
    // ever stops rendering, the result list starts lying about what it
    // contains.
    ui2.adicionarItem('4'.repeat(44), '11222333000181', { forcado: 'entrada' });
    ui2.adicionarItem('4'.repeat(44), '11222333000181', { forcado: 'inelegivel' });
    const marcas = criados.filter((e) => /forçada em depuração/.test(e.textContent));
    if (marcas.length !== 2 || !/chave inválida/.test(marcas[0].textContent) ||
        !/nota não doável/.test(marcas[1].textContent)) {
      console.error('a debug-forced row is not flagged, or does not say which gate opened');
      process.exit(1);
    }

    // The debug bar carries its own way out, exactly like the stale-fixed-part
    // one. Driven through `ui` — the FIRST mount — because porTexto/criados
    // scan in creation order and both mounts build a bar.
    let desarmou = 0;
    ui.setDebug(true, ['aceitarChavesInvalidas'], () => { desarmou += 1; });
    const btnSeguranca = porTexto('Voltar à segurança');
    if (!btnSeguranca || btnSeguranca.tagName !== 'BUTTON') {
      console.error('the debug bar is missing its "Voltar à segurança" button');
      process.exit(1);
    }
    clicar(btnSeguranca);
    if (desarmou !== 1) {
      console.error('the debug bar action did not reach its handler');
      process.exit(1);
    }
    ui.setDebug(false, []);

    // Same rule for a note refused because of the duplicate session: its
    // action is a button wired to the same request, not a link.
    let pedidoDoItem = 0;
    const idDup = ui2.adicionarItem('4'.repeat(44), '11222333000181');
    ui2.atualizarItem(idDup, {
      estado: 'erro',
      mensagem: NFPR.Donation.MSG_SESSAO_DUPLICADA,
      acao: { rotulo: 'Encerrar todas as sessões', aoClicar() { pedidoDoItem += 1; } }
    });
    const btnItem = porTexto('Encerrar todas as sessões');
    if (!btnItem || btnItem.tagName !== 'BUTTON') {
      console.error('the duplicate-session result item is missing its action button');
      process.exit(1);
    }
    clicar(btnItem);
    if (pedidoDoItem !== 1) {
      console.error('the result item action did not run');
      process.exit(1);
    }
    // The modal's config page must NOT be the element SettingsUI mounts onto.
    // SettingsUI.montar adds .nfpr-settings to whatever it is handed, and
    // .nfpr-settings sets `display: flex` while .nfpr-view sets `display: none`
    // - equal specificity, so load order decided and the config form was stuck
    // permanently open, with Ajuda and Depuracao opening BESIDE it. The stub's
    // classList is inert, so .nfpr-settings itself is unobservable here; what
    // gets asserted is the structural invariant that prevents the collision.
    const classes = (e) => String((e && e.className) || '').split(/\s+/);
    const tem = (e, c) => classes(e).indexOf(c) !== -1;
    const vistas = criados.filter((e) => tem(e, 'nfpr-view'));
    ok('the modal built its pages', vistas.length > 0, true);
    // Config and Depuracao are the two pages that MOUNT a form; Ajuda builds its
    // own copy inline and so has no inner box to look for.
    const paginasComFormulario = ['nfpr-view-config', 'nfpr-view-depuracao'];
    for (const marca of paginasComFormulario) {
      const vista = vistas.filter((v) => tem(v, marca));
      ok('the modal built ' + marca, vista.length > 0, true);
      // THE FORM HAS TO BE IN THE BOX, not merely the box on the page. Handing
      // SettingsUI.montar the view itself still builds the inner box — empty —
      // so "an inner box exists" passed on exactly the bug it names. The form's
      // sections land as the box's children and nowhere else.
      const corpo = (v) => v.filhos.find((f) => tem(f, 'nfpr-view-corpo'));
      ok(
        marca + ' mounts its form in an inner box, not on the page itself',
        vista.every((v) => !!corpo(v) && corpo(v).filhos.length > 0),
        true
      );
      // Config holds its box alone; Depuracao a page head and its box.
      ok(
        marca + ' has nothing of the form as a direct child of the page',
        vista.every((v) => v.filhos.length === (marca === 'nfpr-view-config' ? 1 : 2)),
        true
      );
    }
    console.log('UI.montar builds; every method of its public API runs');

    // --- THE MERGED HEADER ---------------------------------------------------
    // The registrar's header strip has two homes and the choice is made from
    // one question: is the government page's #header there? On the live page it
    // is, and the strip goes INSIDE it — that is the whole of the merge, and
    // the reason two stacked headers became one 54px bar.
    //
    // Both halves are pinned because both are silent when wrong. A strip that
    // failed to reach the bar would simply not be on screen (the panel no
    // longer draws it), and a strip that reached the bar while ALSO staying on
    // the panel would draw the entity chip twice.
    const marcaBarra = criados.length;
    const paginaOffline = criados.find((e) => tem(e, 'nfpr-registrar-page'));
    ok(
      'with no site header the strip stays on the panel, exactly as before',
      paginaOffline.filhos.some((f) => tem(f, 'nfpr-reg-head')),
      true
    );

    const sysInfo = elemento();
    const barraDoSite = elemento();
    barraDoSite.appendChild(sysInfo);
    const buscarIdAntes = documentoStub.getElementById;
    documentoStub.getElementById = (id) =>
      id === 'header' ? barraDoSite : id === 'system-info' ? sysInfo : id === 'main' ? elemento() : null;
    const uiBarra = await NFPR.UI.montar({});
    documentoStub.getElementById = buscarIdAntes;

    const hostCab = criados.slice(marcaBarra).find((e) => e.id === 'nfpr-cabecalho-host');
    ok('a shadow host is built for the strip', !!hostCab, true);
    // BEFORE #system-info, not appended after it: the row has to read
    // logo · ours · theirs, so that "this tool" and "your account" are two
    // clusters rather than one queue of five controls.
    ok(
      'it is inserted into the site header ahead of the site user block',
      barraDoSite.filhos.map((f) => (f === hostCab ? 'nosso' : f === sysInfo ? 'deles' : '?')),
      ['nosso', 'deles']
    );
    const strip = hostCab.sombra.filhos.find((f) => tem(f, 'nfpr-reg-head'));
    ok('the strip itself went into that root', !!strip, true);
    ok('and was built in its bar form, not the panel one', tem(strip, 'nfpr-reg-head-barra'), true);
    ok(
      'the site logo is right beside it, so ours is left out',
      strip.filhos.some((f) => tem(f, 'nfpr-reg-icon')),
      false
    );
    const paginaBarra = criados.slice(marcaBarra).find((e) => tem(e, 'nfpr-registrar-page'));
    ok(
      'and the panel no longer carries a header of its own',
      paginaBarra.filhos.some((f) => tem(f, 'nfpr-reg-head')),
      false
    );

    // The chip IS the settings button now. There is no second one, and that is
    // deliberate: the bar it sits in already has the SITE's "Configurações" in
    // it, and two identical labels opening different things is worse than one
    // of them carrying only a gear.
    const chipAlvo = strip.filhos.find((f) => tem(f, 'nfpr-chip-alvo'));
    ok(
      'the chip is a real button, labelled for what it opens',
      [chipAlvo.tagName, chipAlvo.atributos.title],
      ['BUTTON', 'Configurações']
    );
    ok(
      'and the old separate Configurações button is gone from both homes',
      criados.some((e) => tem(e, 'nfpr-btn-config')),
      false
    );

    // ORDER, which nothing else can see. Both controls render either way round
    // and look fine in isolation, so a reordered array in painel.js is silent:
    // the home link belongs beside the government logo, where every site puts
    // one, and the chip belongs against the hairline that divides our half of
    // the bar from theirs.
    ok(
      'the home link sits ahead of the chip, and is a real anchor to the site',
      strip.filhos
        .filter((f) => tem(f, 'nfpr-inicio') || tem(f, 'nfpr-chip-alvo'))
        .map((f) => f.tagName + ':' + (f.atributos.href || 'chip')),
      ['A:' + NFPR.Site.URL_INICIO, 'BUTTON:chip']
    );
    // The offline page is the one home without it: the site is unreachable
    // there by definition, and the connection strip's own "Abrir o site de
    // doação" re-probes before navigating, which an ordinary link cannot.
    ok(
      'and the offline page carries no link to a site it cannot reach',
      paginaOffline.filhos
        .find((f) => tem(f, 'nfpr-reg-head'))
        .filhos.some((f) => tem(f, 'nfpr-inicio')),
      false
    );

    // The chip carries no visible caption now, so its hover TITLE is the only
    // thing left saying whose CNPJ this is — an unlabelled CNPJ in a header
    // otherwise reads as the volunteer's own. It is written in both states,
    // and it is the state it is in that has to be right: promising a target
    // when none is chosen is worse than saying nothing.
    const nomeAlvo = chipAlvo.filhos
      .find((f) => tem(f, 'nfpr-chip-alvo-col'))
      .filhos.find((f) => tem(f, 'nfpr-chip-alvo-nome'));
    uiBarra.setEntidade({ nome: 'AMARAS', cnpj: '11222333000181' });
    ok(
      'with a target, the chip names it and says whose CNPJ it is',
      [nomeAlvo.textContent, chipAlvo.atributos.title],
      ['AMARAS', 'Configurações — doando para AMARAS']
    );
    uiBarra.setEntidade(null);
    // The empty ring is classList, which this stub ignores; the title is not.
    ok(
      'with no target it names none, rather than promising one',
      [nomeAlvo.textContent, chipAlvo.atributos.title],
      ['Nenhuma entidade', 'Configurações — nenhuma entidade escolhida']
    );
    // Unnamed until the registry answers: the name line goes empty (CSS
    // collapses it) and the CNPJ is what the title says the notes go to.
    uiBarra.setEntidade({ nome: '', cnpj: '11222333000181' });
    ok('an entity with no name yet is its CNPJ alone, in the chip and its title',
      [nomeAlvo.textContent, chipAlvo.atributos.title],
      ['', 'Configurações — doando para 11.222.333/0001-81']);
    uiBarra.setEntidade(null);

    // --- the registrar pipeline, end to end ----------------------------------
    // Registrador.iniciar is the wiring: capture -> ParteFixa.resolver ->
    // Chave.avaliar -> one of three branches (red toast and forgotten,
    // grey row and stopped, or queued). Nothing else in this file drives it —
    // digitarNoCapture above talks to Capture directly — so the step between a
    // verdict and what the volunteer actually sees had no coverage at all.
    // That is precisely the path phase 1 changed.
    //
    // The clock is the REAL one here, because Registrador reads
    // Relogio.mesCorrente() itself. Fixtures are therefore built FROM it rather
    // than pinned to a date, so nothing in this block rots.
    const agoraReg = NFPR.Relogio.mesCorrente();
    const notaDeHoje = chaveCom({
      aa: String(agoraReg.ano - 2000).padStart(2, '0'),
      mm: String(agoraReg.mes).padStart(2, '0')
    });
    // A second donatable key sharing the first 35 digits, so one fixed part
    // describes both and the two scenarios below cannot collide in the de-dup
    // map.
    const base43Alt = notaDeHoje.slice(0, 35) + '87654321';
    const notaDeHoje2 = base43Alt + Chave.calcularCDV(base43Alt + '0');
    const parteFixaDeHoje = notaDeHoje.slice(0, 35) + '?'.repeat(9);

    // THE FIXTURE THAT MAKES THIS WORTH RUNNING: a corrupted scan whose OLD-RULE
    // composition — [the fixed part] + [the barcode's first 9 digits] — was
    // itself a perfectly valid, donatable key. That is the ~10% case phase 1
    // removed, and before it this scan registered a note nobody scanned while
    // the real one was lost. Searched rather than hard-coded so it survives the
    // fixture moving.
    let scanFabricavel = null;
    let fabricada = null;
    for (let p = 0; p < 9 && !scanFabricavel; p += 1) {
      for (let d = 0; d < 10; d += 1) {
        if (String(d) === notaDeHoje[p]) continue;
        const corrompida = notaDeHoje.slice(0, p) + d + notaDeHoje.slice(p + 1);
        const composta = ParteFixa.aplicar(parteFixaDeHoje, corrompida.slice(0, 9));
        if (Chave.avaliar(composta, agoraReg).ok) {
          scanFabricavel = corrompida;
          fabricada = composta;
          break;
        }
      }
    }
    // ONE DIGIT IS NOT ALWAYS ENOUGH. About one month in ten the UNCORRUPTED
    // scan's own first nine digits already compose a valid key, and then no
    // single wrong digit can: changing one of the first eight moves the
    // composed key's check digit away from the ninth, and the ninth is already
    // the right one. The search found nothing and this file stopped here for
    // the whole of October 2026. So a second digit is allowed to be wrong: any
    // of the first eight, plus the ninth set to whatever the composition needs.
    for (let p = 0; p < 8 && !scanFabricavel; p += 1) {
      for (let d = 0; d < 10; d += 1) {
        if (String(d) === notaDeHoje[p]) continue;
        const cabeca = notaDeHoje.slice(0, p) + d + notaDeHoje.slice(p + 1, 8);
        const dv = Chave.calcularCDV(notaDeHoje.slice(0, 35) + cabeca + '0');
        const corrompida = cabeca + dv + notaDeHoje.slice(9);
        const composta = ParteFixa.aplicar(parteFixaDeHoje, corrompida.slice(0, 9));
        if (!Chave.avaliar(corrompida, agoraReg).ok && Chave.avaliar(composta, agoraReg).ok) {
          scanFabricavel = corrompida;
          fabricada = composta;
          break;
        }
      }
    }
    if (!scanFabricavel) {
      console.error('could not build a scan whose fixed part composition is donatable');
      process.exit(1);
    }
    ok('the old rule would have donated a key nobody scanned',
      [Chave.avaliar(scanFabricavel, agoraReg).ok, Chave.avaliar(fabricada, agoraReg).ok],
      [false, true]);

    await NFPR.Config.atualizarConfig({
      entidades: [{ id: 'e1', nome: 'Entidade', cnpj: '11222333000181' }],
      entidadeAtivaId: 'e1',
      partesFixas: [{ id: 'm1', nome: 'M', template: parteFixaDeHoje }],
      parteFixaAtivaId: 'm1'
    });

    // --- fixed parts are ON by default; off means inert ----------------------
    // With the default on, the offer is only ever reached once someone has
    // turned fixed parts off. The switch stamps an answer when it does, so the
    // offer then waits out PRAZO_DICA_PARTES_FIXAS; the checks below switch the
    // preference off WITHOUT stamping, which is that same state after expiry.
    //
    // Both halves of "off" are silent when wrong: a fixed part still
    // composing behind a hidden strip puts digits in the cells that nobody
    // typed with the one-click way out nowhere on screen. The fixture above is
    // deliberately left in place — a stored, ACTIVE fixed part — because "off"
    // has to beat it.
    ok('fixed parts are on by default, and the offer is armed',
      [(await NFPR.Config.obterConfig()).preferencias.partesFixas,
       NFPR.Config.dicaPartesFixasVencida(
         (await NFPR.Config.obterConfig()).preferencias.dicaPartesFixasEm)],
      [true, true]);
    await NFPR.Config.atualizarConfig({ preferencias: { partesFixas: false } });

    const marcaOff = criados.length;
    const uiOff = await NFPR.UI.montar({ modoOffline: true, montarEm: elemento() });
    let recusasOff = 0;
    const uiOffEnv = Object.assign({}, uiOff, {
      mostrarErro: function () { recusasOff += 1; return uiOff.mostrarErro.apply(uiOff, arguments); }
    });
    let aceitasOff = [];
    await NFPR.Registrador.iniciar({
      ui: uiOffEnv,
      msgDuplicada: 'x',
      aoAceitarChave(info) { aceitasOff.push(info); }
    });
    const doOff = (sel) => criados.slice(marcaOff).find(sel);
    const stripOff = doOff((e) => e.className === 'nfpr-strip');
    const dicaMsg = doOff((e) => e.className === 'nfpr-strip-status-msg');
    const dicaBarra = doOff((e) => e.tagName === 'P' && /^nfpr-strip-status/.test(e.className));
    const dicaAcao = doOff((e) => e.className === 'nfpr-strip-status-acao');
    const dicaNao = doOff((e) => e.className === 'nfpr-strip-status-acao nfpr-strip-status-dispensar');
    const teclasOff = ouvintes.keydown[ouvintes.keydown.length - 1];
    // gap 0 is a machine burst (the perf clock never moves); 200 ms is a
    // person. That distinction is the whole of who gets offered a fixed part.
    const entrarOff = (texto, gap) => {
      recusasOff = 0;
      aceitasOff = [];
      for (const ch of texto) {
        relogioPerf.ms += gap === undefined ? 200 : gap;
        teclasOff({ key: ch, preventDefault: noop, stopPropagation: noop });
      }
      teclasOff({ key: 'Enter', preventDefault: noop, stopPropagation: noop });
    };
    const oferta = () =>
      dicaBarra.atributos.hidden ? null : [dicaMsg.textContent, dicaAcao.textContent,
        dicaNao.atributos.hidden ? null : dicaNao.textContent];

    ok('...so the strip is not drawn at all', !!stripOff.atributos.hidden, true);
    // A SCAN NEVER RAISES IT. Someone reading barcodes will not type a digit
    // all day, and a suggestion they can never use is exactly the clutter the
    // preference exists to remove.
    entrarOff(notaDeHoje, 0);
    ok('a scanned note queues and is offered nothing',
      [aceitasOff.length, oferta()], [1, null]);
    // ...and the fixed part is INERT, not merely invisible: these are the nine
    // digits that compose a whole key when it is armed, and here they are just
    // nine digits, refused for length. Nothing queued, and no fabricated note.
    entrarOff(notaDeHoje2.slice(35));
    ok('a stored, active fixed part composes nothing while the preference is off',
      [aceitasOff.length, recusasOff], [0, 1]);
    // ...which is the moment the typist is told the option exists — even
    // though that note was refused. The offer is about how the NEXT one gets
    // entered.
    ok('typing by hand raises the offer, with a way in and a way out',
      oferta(),
      ['As chaves das suas notas começam iguais? Você pode fixar esse começo e digitar apenas o restante de cada uma.',
       'Ativar', 'Não mostrar']);

    // Its first button arms the preference and answers the offer for good.
    // Nothing opens itself: the strip appears carrying its own invitation.
    for (const fn of dicaAcao.escutas.click || []) fn({});
    await new Promise((r) => setTimeout(r, 0));
    const cfgLigada = await NFPR.Config.obterConfig();
    const prefsLigadas = cfgLigada.preferencias;
    ok('"Ativar" turns fixed parts on and stops offering them',
      [prefsLigadas.partesFixas,
       NFPR.Config.dicaPartesFixasVencida(prefsLigadas.dicaPartesFixasEm)],
      [true, false]);
    // ...AND IT ARMS NO FIXED PART. The fixture above left `parteFixaAtivaId:
    // 'm1'` stored and merely inert, which is exactly the trap: switching the
    // preference on without clearing it would fill the cells with a stranger's
    // digits at the moment this offer has just introduced fixed parts to
    // somebody who has never met one. Silent when wrong — the strip appears
    // either way.
    ok('...and arms no fixed part, so the cells stay 44 empty ones',
      cfgLigada.parteFixaAtivaId, null);

    // The other button is the whole reason this is an offer and not a
    // condition bar: it has to be refusable, or it is furniture for the rest
    // of the volunteer's life on a shared machine.
    await NFPR.Config.atualizarConfig({
      preferencias: { partesFixas: false, dicaPartesFixasEm: null }
    });
    const marcaNao = criados.length;
    const uiNao = await NFPR.UI.montar({ modoOffline: true, montarEm: elemento() });
    await NFPR.Registrador.iniciar({ ui: uiNao, msgDuplicada: 'x', aoAceitarChave() {} });
    const doNao = (sel) => criados.slice(marcaNao).find(sel);
    const barraNao = doNao((e) => e.tagName === 'P' && /^nfpr-strip-status/.test(e.className));
    const naoMostrar = doNao(
      (e) => e.className === 'nfpr-strip-status-acao nfpr-strip-status-dispensar');
    const teclasNao = ouvintes.keydown[ouvintes.keydown.length - 1];
    for (const ch of '99') {
      relogioPerf.ms += 200;
      teclasNao({ key: ch, preventDefault: noop, stopPropagation: noop });
    }
    teclasNao({ key: 'Enter', preventDefault: noop, stopPropagation: noop });
    ok('a fresh session offers it again while it has not been answered',
      !barraNao.atributos.hidden, true);
    for (const fn of naoMostrar.escutas.click || []) fn({});
    await new Promise((r) => setTimeout(r, 0));
    const prefsNao = (await NFPR.Config.obterConfig()).preferencias;
    ok('"Não mostrar" ends the offer without turning fixed parts on',
      [prefsNao.partesFixas, NFPR.Config.dicaPartesFixasVencida(prefsNao.dicaPartesFixasEm)],
      [false, false]);

    const marcaMudo = criados.length;
    const uiMudo = await NFPR.UI.montar({ modoOffline: true, montarEm: elemento() });
    await NFPR.Registrador.iniciar({ ui: uiMudo, msgDuplicada: 'x', aoAceitarChave() {} });
    const barraMudo = criados.slice(marcaMudo).find(
      (e) => e.tagName === 'P' && /^nfpr-strip-status/.test(e.className));
    const teclasMudo = ouvintes.keydown[ouvintes.keydown.length - 1];
    for (const ch of '99') {
      relogioPerf.ms += 200;
      teclasMudo({ key: ch, preventDefault: noop, stopPropagation: noop });
    }
    teclasMudo({ key: 'Enter', preventDefault: noop, stopPropagation: noop });
    ok('...and it stays answered on the next load', !!barraMudo.atributos.hidden, true);

    // BUT NOT FOR EVER. These machines are shared and the volunteers rotate,
    // so an answer is stamped rather than latched and expires after
    // PRAZO_DICA_PARTES_FIXAS — otherwise one person's "Não mostrar" is the
    // last word on the feature for the life of the install. Nothing senses that
    // the person changed; the answer simply ages out. Asserted against the
    // exported constant rather than a number written twice.
    ok('the expiry is what un-answers it, and null is never answered',
      [NFPR.Config.dicaPartesFixasVencida(null),
       NFPR.Config.dicaPartesFixasVencida(Date.now()),
       NFPR.Config.dicaPartesFixasVencida(Date.now() - NFPR.Config.PRAZO_DICA_PARTES_FIXAS - 1)],
      [true, false, true]);
    await NFPR.Config.atualizarConfig({
      preferencias: { dicaPartesFixasEm: Date.now() - NFPR.Config.PRAZO_DICA_PARTES_FIXAS - 1 }
    });
    const marcaVelha = criados.length;
    const uiVelha = await NFPR.UI.montar({ modoOffline: true, montarEm: elemento() });
    await NFPR.Registrador.iniciar({ ui: uiVelha, msgDuplicada: 'x', aoAceitarChave() {} });
    const barraVelha = criados.slice(marcaVelha).find(
      (e) => e.tagName === 'P' && /^nfpr-strip-status/.test(e.className));
    const teclasVelha = ouvintes.keydown[ouvintes.keydown.length - 1];
    for (const ch of '99') {
      relogioPerf.ms += 200;
      teclasVelha({ key: ch, preventDefault: noop, stopPropagation: noop });
    }
    teclasVelha({ key: 'Enter', preventDefault: noop, stopPropagation: noop });
    ok('...so a stale answer offers it to whoever is typing now',
      !!barraVelha.atributos.hidden, false);

    // THE CHECK-DIGIT HINT, pinned as what it is: a deliberate exception to
    // "nothing speaks after 22" (CLAUDE.md). The entry box goes red once every
    // variable digit is in and the check digit fails — before Enter, and only
    // with autoEnviar off, since with it on the key is already on its way —
    // and the next change takes it off again. The stub's classList is inert, so
    // the entry box gets a recording one; nothing else here reads it.
    const marcaCdv = criados.length;
    const uiCdv = await NFPR.UI.montar({ modoOffline: true, montarEm: elemento() });
    await NFPR.Registrador.iniciar({ ui: uiCdv, msgDuplicada: 'x', aoAceitarChave() {} });
    const caixaCdv = criados.slice(marcaCdv).find((e) => e.className === 'nfpr-entry');
    const classesCdv = new Set();
    caixaCdv.classList = {
      add: (c) => classesCdv.add(c), remove: (c) => classesCdv.delete(c),
      contains: (c) => classesCdv.has(c),
      toggle: (c, f) => { if (f) classesCdv.add(c); else classesCdv.delete(c); }
    };
    const vermelhaCdv = () => classesCdv.has('nfpr-entry-cdv-err');
    const cdvErrado = notaDeHoje.slice(0, 43) + ((Number(notaDeHoje[43]) + 1) % 10);
    const teclasCdv = ouvintes.keydown[ouvintes.keydown.length - 1];
    const teclaCdv = (k) => {
      relogioPerf.ms += 200;
      teclasCdv({ key: k, preventDefault: noop, stopPropagation: noop });
    };
    for (const ch of cdvErrado.slice(0, 43)) teclaCdv(ch);
    ok('the check-digit hint is silent while a digit is still missing', vermelhaCdv(), false);
    teclaCdv(cdvErrado[43]);
    ok('...fires, before Enter, once all 44 are in and the check digit fails',
      vermelhaCdv(), true);
    teclaCdv('Backspace');
    ok('...and the next change takes it off', vermelhaCdv(), false);
    teclaCdv(notaDeHoje[43]);
    ok('...and a key whose check digit holds never lights it', vermelhaCdv(), false);
    teclaCdv('Escape');
    uiCdv.setAutoEnviar(true);
    uiCdv.atualizarDisplay({ typed: cdvErrado, templateParteFixa: null });
    ok('...never with autoEnviar on, when the key is already on its way', vermelhaCdv(), false);
    uiCdv.setAutoEnviar(false);
    const parteFixaCdv = cdvErrado.slice(0, 35) + '?'.repeat(9);
    uiCdv.atualizarDisplay({ typed: cdvErrado.slice(35, 43), templateParteFixa: parteFixaCdv });
    ok('...under a fixed part, silent until every VARIABLE digit is in', vermelhaCdv(), false);
    uiCdv.atualizarDisplay({ typed: cdvErrado.slice(35), templateParteFixa: parteFixaCdv });
    ok('...and judging the composed key once they are', vermelhaCdv(), true);
    uiCdv.definirParteFixaTemplate(null);
    uiCdv.limparDisplay();
    ok('...and an emptied entry is never red', vermelhaCdv(), false);

    // A SCAN CORRECTED BY HAND IS TYPING, for both of the things that ask. The
    // live verdict is silent during a burst and the offer is for typists, and
    // both used to read the buffer's ORIGIN — so a volunteer fixing a bad read
    // by hand got no verdict while typing and was never offered fixed parts.
    const marcaRaj = criados.length;
    const uiRaj = await NFPR.UI.montar({ modoOffline: true, montarEm: elemento() });
    await NFPR.Registrador.iniciar({ ui: uiRaj, msgDuplicada: 'x', aoAceitarChave() {} });
    const doRaj = (sel) => criados.slice(marcaRaj).find(sel);
    const barraRaj = doRaj((e) => e.tagName === 'P' && /^nfpr-strip-status/.test(e.className));
    const msgRaj = doRaj((e) => e.className === 'nfpr-strip-status-msg');
    const teclasRaj = ouvintes.keydown[ouvintes.keydown.length - 1];
    const teclaRaj = (k, gap) => {
      relogioPerf.ms += gap;
      teclasRaj({ key: k, preventDefault: noop, stopPropagation: noop });
    };
    // Five keys, four gaps at machine speed: a scanner's. Two would be fingers
    // rolling across adjacent keys, which is not a scan at all.
    teclaRaj('9', 200);
    for (let i = 0; i < 4; i += 1) teclaRaj('9', 0);
    ok('a scanned state that does not exist says nothing while it arrives',
      !!barraRaj.atributos.hidden, true);
    teclaRaj('1', 200);
    ok('...but a digit typed into it lifts the silence, and the verdict speaks',
      [msgRaj.textContent, /nfpr-strip-status-err/.test(barraRaj.className)],
      ['Confira a chave de acesso.', true]);
    teclaRaj('Enter', 200);
    ok('...and the note counts as typed, so the typist is offered fixed parts',
      msgRaj.textContent,
      'As chaves das suas notas começam iguais? Você pode fixar esse começo e digitar apenas o restante de cada uma.');

    // Everything from here on is the fixed part machinery itself, which needs
    // the preference the volunteer would have switched on to reach any of it —
    // and the fixed part "Ativar" correctly disarmed above.
    await NFPR.Config.atualizarConfig({
      parteFixaAtivaId: 'm1',
      preferencias: { partesFixas: true, dicaPartesFixasEm: Date.now() }
    });

    // A recording wrapper rather than a scan of `criados`: this block is about
    // WHICH branch ran, and the real UI is already exercised above.
    const marcaReg = criados.length;
    const baseReg = await NFPR.UI.montar({ modoOffline: true, montarEm: elemento() });
    let eventosReg = [];
    const uiReg = Object.assign({}, baseReg);
    ['mostrarErro', 'adicionarItem', 'atualizarItem'].forEach(function (m) {
      uiReg[m] = function () {
        eventosReg.push([m].concat(Array.prototype.slice.call(arguments)));
        return baseReg[m].apply(baseReg, arguments);
      };
    });

    // WHICH CUE PLAYED is now part of what this block pins. The read cue and
    // the success chime are different promises ("I read you" / "the government
    // has it") and the verdict is what chooses between read-cue and aviso, so a
    // wrong branch here is silent in every other assertion.
    let sons = [];
    ['erro', 'aviso', 'leitura', 'sucesso'].forEach(function (m) {
      const real = NFPR.Audio[m];
      NFPR.Audio[m] = function () { sons.push(m); return real.apply(NFPR.Audio, arguments); };
    });

    let aceitas = [];
    await NFPR.Registrador.iniciar({
      ui: uiReg,
      msgDuplicada: 'Esta nota já foi lida recentemente.',
      aoAceitarChave(info) { aceitas.push(info); }
    });
    ok('...and with the preference on the strip is drawn',
      !!(criados.slice(marcaReg).find((e) => e.className === 'nfpr-strip') || {}).atributos.hidden,
      false);

    // `gap` is the time before each key. Left at 0 the whole string is a
    // confirmed scanner burst, which is what a scan is; TYPING needs a human
    // gap, and until a burst stopped being composed with the fixed part the
    // difference was invisible — "typing" here was a scan all along.
    const teclarNoRegistrador = (texto, gap) => {
      eventosReg = [];
      aceitas = [];
      sons = [];
      const fn = ouvintes.keydown[ouvintes.keydown.length - 1];
      for (const ch of texto) {
        relogioPerf.ms += gap || 0;
        fn({ key: ch, preventDefault: noop, stopPropagation: noop });
      }
      relogioPerf.ms += gap || 0;
      fn({ key: 'Enter', preventDefault: noop, stopPropagation: noop });
    };
    const DIGITANDO = 200;
    const chamadas = (m) => eventosReg.filter((e) => e[0] === m);

    // 1. TYPING under a fixed part — the only thing a fixed part is for. Nine
    // digits compose.
    teclarNoRegistrador(notaDeHoje2.slice(35), DIGITANDO);
    ok('typing under a fixed part composes, queues, and flags no override',
      [aceitas.length, aceitas[0] && aceitas[0].chave,
       chamadas('adicionarItem').length,
       !!((chamadas('adicionarItem')[0] || [])[3] || {}).parteFixaIgnorada,
       chamadas('mostrarErro').length],
      [1, notaDeHoje2, 1, false, 0]);
    // A clean read gets the READ CUE and nothing else. Not sucesso(): nothing
    // has been sent, and the offline page used to play that very chime here,
    // claiming a registration it can never make.
    ok('a clean read plays the read cue alone', sons, ['leitura']);

    // 2. A whole key scanned while a fixed part is active: misuse, but harmless
    //    — the note registered is the one that was read, and the row says so.
    teclarNoRegistrador(notaDeHoje);
    ok('a scan under a fixed part registers what was read, marked as an override',
      [aceitas.length, aceitas[0] && aceitas[0].chave, aceitas[0] && aceitas[0].cnpj,
       (chamadas('adicionarItem')[0] || [])[3].parteFixaIgnorada],
      [1, notaDeHoje, '11222333000181', true]);
    // An override is a warning, so it takes aviso INSTEAD of the read cue —
    // never both, and never the read cue alone.
    ok('a fixed part override warns instead of playing the read cue', sons, ['aviso']);

    // THE FIXED PART STEPS ASIDE WHILE A SCAN ARRIVES, and comes back once it
    // is submitted. Drawn with the fixed part, the cells showed its fixed
    // digits with the barcode's head in the gaps: a key nobody scanned. The
    // real cells, not a recording — the class on each one is what the volunteer
    // sees.
    const celulasReg = criados.slice(marcaReg)
      .filter((e) => /^nfpr-cell nfpr-cell-/.test(e.className || ''));
    const fixasReg = () => celulasReg.filter((c) => /nfpr-cell-fixo/.test(c.className)).length;
    ok('the armed fixed part fixes cells in the empty entry', [celulasReg.length, fixasReg() > 0], [44, true]);
    const teclasParteFixa = ouvintes.keydown[ouvintes.keydown.length - 1];
    for (const ch of notaDeHoje) teclasParteFixa({ key: ch, preventDefault: noop, stopPropagation: noop });
    ok('once a scan is believed, the cells show what it reads and no fixed part',
      [fixasReg(), celulasReg.map((c) => c.textContent).join('')], [0, notaDeHoje]);
    teclasParteFixa({ key: 'Enter', preventDefault: noop, stopPropagation: noop });
    ok('...and submitting puts the fixed part back', fixasReg() > 0, true);

    // 3. THE PHASE-1 GUARD, end to end. Under the old rule this scan produced
    //    `fabricada` — valid, donatable, and not the note in anyone's hand.
    //    It must now be a red toast with NO row and nothing queued.
    teclarNoRegistrador(scanFabricavel);
    ok('a corrupted scan under a fixed part is refused, never fabricated into a donation',
      [chamadas('mostrarErro').length, chamadas('adicionarItem').length, aceitas.length],
      [1, 0, 0]);
    // A REFUSAL CLEARS THE ENTRY, and the clearing is the point rather than
    // housekeeping. Red means the buffer holds a CORRUPT READING; handing it
    // back for repair invites the volunteer to correct it — eye along the row,
    // change the digit that looks wrong, resubmit — and a patched key that
    // happens to satisfy the check digit is a donation filed for a note nobody
    // ever read. Retyping from the paper is an INDEPENDENT second reading.
    // Keeping the digits was proposed during design and rejected; this is the
    // guard that stops it coming back by accident. (`celulasReg` is the same
    // 44 cells the scan-under-a-fixed-part check above looked at.)
    // Counted as FILLED cells rather than empty text: a fixed part paints its
    // own fixed digits into the display at rest, so "no text anywhere" would be
    // false for a reason that has nothing to do with the buffer.
    ok('...and the entry is emptied, so the recovery is a fresh reading',
      [celulasReg.length, celulasReg.filter((c) => /-preenchido$/.test(c.className)).length],
      [44, 0]);
    // A SCAN IS NEVER BLAMED ON THE FIXED PART. It was judged as it arrived,
    // with the fixed part set aside, so the fixed part cannot be the cause —
    // saying it might be invites the volunteer to drop one that is fine for
    // typing. This used to be asserted the other way round.
    const toqueScan = chamadas('mostrarErro')[0];
    ok('a red SCAN under a fixed part names no fixed part and offers no way out of one',
      [/parte fixa/.test(toqueScan[1]), toqueScan[2]], [false, undefined]);
    // A BURST WITH NO KEY IN IT — a shop's own barcode — is a scan too, and red:
    // never composed with the fixed part into a key nobody holds.
    teclarNoRegistrador('78912345678901234567');
    ok('a short burst under a fixed part is refused, not composed and queued',
      [chamadas('mostrarErro').length, chamadas('adicionarItem').length, aceitas.length,
       /parte fixa/.test((chamadas('mostrarErro')[0] || [])[1])],
      [1, 0, 0, false]);
    // THE ONE THING A REFUSAL DOES SAY WHEN A FIXED PART IS ACTIVE, and it is a
    // second CAUSE rather than a repair: a fixed part that fixes too much
    // composes a key that is not the note in the volunteer's hand, and telling
    // them they mistyped it is a sentence about them for a mistake the software
    // made. Its button drops the fixed part; it does not offer the digits back.
    // Only a TYPED entry is composed, so only a typed one can say it.
    const finalErrado = notaDeHoje2.slice(35, 43) + (notaDeHoje2[43] === '9' ? '8' : '9');
    teclarNoRegistrador(finalErrado, DIGITANDO);
    const toqueParteFixa = chamadas('mostrarErro')[0];
    ok('a red TYPED entry under a fixed part names the fixed part as a second cause, with a way out',
      [/parte fixa/.test(toqueParteFixa[1]), toqueParteFixa[2] && toqueParteFixa[2].rotulo,
       typeof (toqueParteFixa[2] || {}).aoClicar],
      [true, 'Digitar a chave inteira', 'function']);

    // 4. Grey: a real note that cannot be donated gets a row and stops there.
    teclarNoRegistrador(chaveCom({ aa: '20', mm: '01' }));
    ok('an expired note gets a row explaining itself and is never queued',
      [chamadas('adicionarItem').length, aceitas.length,
       (chamadas('atualizarItem')[0] || [])[2].estado],
      [1, 0, 'inelegivel']);

    // --- the fixed part editor is strict -------------------------------------
    // Driven through the STRIP's own field, which is where a volunteer meets it
    // now that fixed parts are working state rather than configuration. It used
    // to be the settings form's; the guard did not move, only its home.
    //
    // Only clock-free verdicts are asserted: the live handler reads the real
    // clock (by design), so a date case would rot.
    const campoParteFixa = criados
      .slice(marcaReg)
      .find((e) => typeof e.placeholder === 'string' && /parte que se repete nas chaves/.test(e.placeholder));
    const statusParteFixaMsg = criados
      .slice(marcaReg)
      .find((e) => e.className === 'nfpr-strip-status-msg');
    const statusParteFixa = criados
      .slice(marcaReg)
      .find((e) => e.tagName === 'P' && /^nfpr-strip-status/.test(e.className));
    if (!campoParteFixa || !statusParteFixaMsg) {
      console.error('the strip fixed part field was not built');
      process.exit(1);
    }
    const digitarParteFixa = (v) => {
      campoParteFixa.value = v;
      for (const fn of campoParteFixa.escutas.input || []) fn({});
      return statusParteFixaMsg.textContent;
    };
    const parteFixaBloqueada = () => /nfpr-strip-status-err/.test(statusParteFixa.className);

    digitarParteFixa('41' + '?'.repeat(42));
    ok('a fixed part that only fixes the Paraná prefix is allowed', parteFixaBloqueada(), false);
    // AND IT NAMES THE STATE THE DIGITS ACTUALLY GIVE. The sentence was once a
    // fixed string naming SP, so every foreign-state fixed part read as São
    // Paulo.
    ok('a foreign-state fixed part is refused and names the state',
      [/notas de São Paulo,/.test(digitarParteFixa('35' + '?'.repeat(42))), parteFixaBloqueada()],
      [true, true]);
    ok('...and a fixed part fixed to RS says Rio Grande do Sul',
      [/notas do Rio Grande do Sul,/.test(digitarParteFixa('43' + '?'.repeat(42))), parteFixaBloqueada()],
      [true, true]);
    // A LETTER ONLY BELONGS IN THE ISSUER'S CNPJ. FORMATO is `escopo:
    // 'chave'` and never sees a template, so this is LETRA_FORA_DO_LUGAR's to
    // say; without it the fixed part below passes everything, since no entry
    // reads the série at all.
    ok('a fixed part with a letter outside the issuer CNPJ is refused, and says why',
      [/letra em posição inválida/.test(digitarParteFixa('41' + '?'.repeat(20) + 'A1B' + '?'.repeat(19))),
       parteFixaBloqueada()],
      [true, true]);
    // ...and the same letters inside the window are an ordinary alphanumeric
    // issuer, which is the whole point of the feature.
    ok('...while a fixed part holding an alphanumeric issuer CNPJ is allowed',
      [digitarParteFixa('4126' + '??' + '12ABC34501DE35' + '?'.repeat(24)), parteFixaBloqueada()][1],
      false);
    // NO SÉRIE DESCRIBES ANYTHING UNDONATABLE any more — not the avulsa band,
    // not 990–999, not the CPF band, on either model, whatever tpEmis says.
    // Year and month stay variable so this stays clock-free.
    const comTpEmis = (inicio25, tp) => inicio25 + '?'.repeat(9) + tp + '?'.repeat(9);
    ok('a fixed part on série 890, 905, 930 or 990 is allowed, on either model',
      ['890', '905', '930', '990'].map((serie) =>
        ['65', '55'].map((m) =>
          [digitarParteFixa(comTpEmis('41' + '?'.repeat(18) + m + serie, '1')), parteFixaBloqueada()][1])),
      [[false, false], [false, false], [false, false], [false, false]]);
    // THE MODEL, AS A FIXED PART SEES IT. Only the models that are neither NF-e
    // nor NFC-e are refused, and they say which two papers the page does take.
    ok('a fixed part fixed to a model that is neither is refused, naming both papers',
      [digitarParteFixa('41' + '?'.repeat(18) + '57'), parteFixaBloqueada()],
      ['Esta parte fixa não é de NF-e nem de NFC-e, as únicas que podem ser doadas.', true]);
    // A fixed part with nothing left to type would accept nothing at all.
    ok('a fixed part with no variable digits is refused',
      [/não deixa nada a digitar/.test(digitarParteFixa(notaDeHoje)), parteFixaBloqueada()],
      [true, true]);
    // ...AND THE MIRROR: a fixed part with no FIXED digits. Nothing but '?'
    // saves nobody a digit and has nothing to be named by, so the strip read it
    // as "no fixed part" — hiding the one-click way out — while every good scan
    // was still flagged as having ignored it. One press of the space bar made
    // one.
    ok('a fixed part with no fixed digits is refused, however many ? it has',
      ['?', '????', '?'.repeat(44)].map((t) =>
        [/ao menos um número/.test(digitarParteFixa(t)), parteFixaBloqueada()]),
      [[true, true], [true, true], [true, true]]);
    digitarParteFixa(''); // leave the field as the next block expects to find it

    marco('the registrar pipeline routes every verdict to the right branch');

    // --- the live verdict while typing, and the fixed part store's two tiers ----
    // A fresh registrar of its own, with NO FIXED PART: the block above
    // deliberately runs under a fixed part that fixes the first 35 digits, so
    // every check the live verdict can reach is already settled there and none
    // of them would fire. An empty fixed part list as well as no active one:
    // the block above left `m1` behind, and the two-tier assertions further
    // down count what is stored.
    await NFPR.Config.atualizarConfig({ partesFixas: [], parteFixaAtivaId: null });
    const marcaVer = criados.length;
    const uiVer = await NFPR.UI.montar({ modoOffline: true, montarEm: elemento() });
    await NFPR.Registrador.iniciar({
      ui: uiVer,
      msgDuplicada: 'x',
      aoAceitarChave() {}
    });
    const doVer = (sel) => criados.slice(marcaVer).find(sel);
    const msgVer = doVer((e) => e.className === 'nfpr-strip-status-msg');
    const barraVer = doVer((e) => e.tagName === 'P' && /^nfpr-strip-status/.test(e.className));
    const progVer = doVer((e) => e.className === 'nfpr-strip-progresso');
    const campoVer = doVer(
      (e) => typeof e.placeholder === 'string' && /parte que se repete nas chaves/.test(e.placeholder));
    const teclasVer = ouvintes.keydown[ouvintes.keydown.length - 1];
    // HUMAN SPEED. Under 35 ms capture reads the whole thing as a scanner and
    // the verdict is deliberately silent, which is the last assertion here.
    const digitarDevagar = (texto, gap) => {
      for (const ch of texto) {
        relogioPerf.ms += gap === undefined ? 200 : gap;
        teclasVer({ key: ch, preventDefault: noop, stopPropagation: noop });
      }
    };
    const apagarEntrada = () => {
      relogioPerf.ms += 200;
      teclasVer({ key: 'Escape', preventDefault: noop, stopPropagation: noop });
    };
    // [text, colour] or null. The line is one element with a fixed priority —
    // editor, then verdict, then the resting bypass notice — and only the
    // verdict is in play here.
    const linhaVer = () =>
      barraVer.atributos.hidden
        ? null
        : [msgVer.textContent, /nfpr-strip-status-err/.test(barraVer.className) ? 'red' : 'grey'];
    const aoDigitar = (texto) => {
      apagarEntrada();
      digitarDevagar(texto);
      return linhaVer();
    };

    // Nothing to say before anything is typed, and nothing on a good prefix at
    // ANY length. `campos` is what makes that structural rather than lucky: a
    // rule is only asked once every span it reads is complete, so a verdict
    // that fires on a prefix can never be un-fired by later digits.
    ok('an empty entry says nothing', linhaVer(), null);
    let falouCedo = null;
    apagarEntrada();
    for (let i = 0; i < 44 && !falouCedo; i += 1) {
      digitarDevagar(notaDeHoje[i]);
      if (linhaVer()) falouCedo = [i + 1, linhaVer()];
    }
    ok('a good key says nothing at any prefix length', falouCedo, null);
    // No fixed part is armed here, and the cells already show the count.
    ok('...and the strip shows no count without a fixed part', progVer.textContent, '');

    // The five moments a check becomes answerable. Red says one thing and names
    // no check — which of the four fired is a fact about our net, never about
    // the note. Grey carries the verdict's own sentence and adds the outcome,
    // which is half the value: an out-of-state receipt is knowable at digit 2
    // instead of after 44.
    ok('digit 2: a state that does not exist is red',
      aoDigitar('99'), ['Confira a chave de acesso.', 'red']);
    const outroEstado = aoDigitar('35');
    ok('digit 2: a real state that is not Paraná is grey, and says why',
      [/^Nota de São Paulo —/.test(outroEstado[0]),
       /Esta nota não pode ser doada\.$/.test(outroEstado[0]), outroEstado[1]],
      [true, true, 'grey']);
    ok('digit 6: an impossible month is red',
      aoDigitar(notaDeHoje.slice(0, 4) + '13'), ['Confira a chave de acesso.', 'red']);
    // DIGIT 4: a year whose every month is past its deadline is grey already,
    // and names the year alone — the month has not been typed. It used to say
    // "Nota de dezembro de …" for any note of that year.
    const anoVelho = agoraReg.ano - 2;
    ok('digit 4: a whole expired year is grey, and names no month',
      aoDigitar('41' + String(anoVelho - 2000).padStart(2, '0')),
      ['Nota de ' + anoVelho + ' — o prazo para doá-la já passou. Esta nota não pode ser doada.',
       'grey']);
    // A LETTER OUTSIDE THE ISSUER SPAN IS RED AT THE LETTER. Capture takes
    // letters anywhere at human speed — where one may stand is a verdict,
    // never a filter — so these reach the table as typed. The série and the
    // invoice number are read by no other rule, so without LETRA_FORA_DO_LUGAR
    // the last two said nothing until Enter.
    ok('a letter in the year, month, model, série or number is red while typing',
      [aoDigitar('41A'), aoDigitar(notaDeHoje.slice(0, 4) + '0A'),
       aoDigitar(notaDeHoje.slice(0, 20) + '6A'), aoDigitar(notaDeHoje.slice(0, 23) + 'A'),
       aoDigitar(notaDeHoje.slice(0, 30) + 'A')],
      [['Confira a chave de acesso.', 'red'], ['Confira a chave de acesso.', 'red'],
       ['Confira a chave de acesso.', 'red'], ['Confira a chave de acesso.', 'red'],
       ['Confira a chave de acesso.', 'red']]);
    // The issuer's own check digits, at 20. Changing the last digit of that
    // span is exactly what a mis-scan does.
    const docRuim = notaDeHoje.slice(0, 19) + (notaDeHoje[19] === '7' ? '6' : '7');
    ok('digit 20: an issuer document that fails its own checksum is red',
      aoDigitar(docRuim), ['Confira a chave de acesso.', 'red']);
    ok('digit 22: a document that is neither an NF-e nor an NFC-e is grey',
      aoDigitar(notaDeHoje.slice(0, 20) + '57')[1], 'grey');
    // An NF-e is accepted like any note, so at 22 it says nothing.
    ok('digit 22: an NF-e says nothing',
      aoDigitar(notaDeHoje.slice(0, 20) + '55'), null);
    // NOTHING SPEAKS AFTER 22. No entry reads the série or tpEmis, so a série
    // from any band — the CPF one included, with a CPF in the issuer span —
    // stays silent through 35 and after.
    const ate35 = (inicio25, tp) => inicio25 + notaDeHoje.slice(25, 34) + (tp || notaDeHoje[34]);
    const emitentePf = notaDeHoje.slice(0, 6) + '000' + '11144477735' + '65';
    ok('digit 35: no série says anything, whatever the band or tpEmis',
      [aoDigitar(ate35(notaDeHoje.slice(0, 22) + '890')),
       aoDigitar(ate35(emitentePf + '930')),
       aoDigitar(ate35(emitentePf + '930', '3')),
       aoDigitar(ate35(notaDeHoje.slice(0, 22) + '990'))],
      [null, null, null, null]);

    // SILENT DURING A SCAN. A burst fills 44 cells in ~50 ms, and flashing four
    // verdicts on the way past is noise for nobody — the scan gets its real
    // verdict at submit, as always.
    apagarEntrada();
    digitarDevagar('99999', 0);
    ok('a machine burst raises no live verdict', linhaVer(), null);
    apagarEntrada();

    // A SUSPECTED RUN RAISES NOTHING NEW... one fast gap is not yet a burst,
    // and a scan's first digits must not flash a verdict on the way past.
    digitarDevagar('9');
    digitarDevagar('9', 0);
    ok('a suspected run raises no live verdict of its own', linhaVer(), null);
    apagarEntrada();
    // ...AND DROPS NOTHING SHOWN. Two digits rolled quickly after a mistake
    // used to hide the line until the idle timer brought it back: a blink and a
    // layout shift, for a run that was fingers. No verdict un-fires on later
    // digits, so the line has nothing to hide. Read after EACH key, since the
    // blink lived between them and the idle timer.
    digitarDevagar('99');
    const piscou = [];
    for (const ch of '12') {
      digitarDevagar(ch, 10);
      piscou.push(linhaVer());
    }
    ok('a suspected run keeps a verdict already on screen',
      piscou, [['Confira a chave de acesso.', 'red'], ['Confira a chave de acesso.', 'red']]);
    apagarEntrada();

    // ---- the fixed part store's two tiers -----------------------------------
    // NAMING IS SAVING: a fixed part with a `nome` is the saved tier, one with
    // a blank name is a recent. There is no `salva` flag to set, so a fixture
    // that gives a fixed part a name IS the fixture that saves it.
    //
    // Pure first: saved fixed parts are exempt from the count AND from
    // eviction, and the one in use is never dropped out from under the
    // volunteer's hands.
    const muitas = [];
    for (let i = 0; i < 12; i += 1) {
      muitas.push({ id: 'r' + i, nome: '', template: '4' + i, usadaEm: i });
    }
    muitas.push({ id: 'fixa', nome: 'Fixa', template: '99', usadaEm: 0 });
    const podada = NFPR.Config.podarPartesFixas(muitas, null);
    ok('a saved fixed part survives newer unsaved ones, which fall off oldest first',
      [podada.length, podada.some((m) => m.id === 'fixa'), podada.some((m) => m.id === 'r0'),
       podada.some((m) => m.id === 'r11')],
      [11, true, false, true]);
    ok('...and the fixed part in use is never evicted',
      NFPR.Config.podarPartesFixas(muitas, 'r0').some((m) => m.id === 'r0'), true);

    // Through the strip, end to end: applying an edit changes the active fixed
    // part IN PLACE and pushes the old text to the top of the recents. Free
    // undo, one line, and the reason editing needs no confirmation.
    const aplicarNoCampo = async (texto) => {
      campoVer.value = texto;
      for (const fn of campoVer.escutas.input || []) fn({});
      for (const fn of campoVer.escutas.keydown || []) {
        fn({ key: 'Enter', preventDefault: noop, stopPropagation: noop });
      }
      await new Promise((r) => setTimeout(r, 0));
      return NFPR.Config.obterConfig();
    };
    const primeira = notaDeHoje.slice(0, 22);
    const segunda = notaDeHoje.slice(0, 25);
    let cfgParteFixa = await aplicarNoCampo(primeira);
    ok('writing a fixed part into the strip creates it and activates it',
      [cfgParteFixa.partesFixas.length, !!cfgParteFixa.parteFixaAtivaId,
       NFPR.Config.parteFixaAtiva(cfgParteFixa).template],
      [1, true, NFPR.ParteFixa.completar(primeira)]);
    cfgParteFixa = await aplicarNoCampo(segunda);
    const anterior = cfgParteFixa.partesFixas.find((m) => m.id !== cfgParteFixa.parteFixaAtivaId);
    ok('editing it updates in place and keeps the previous text as a recent',
      [cfgParteFixa.partesFixas.length, NFPR.Config.parteFixaAtiva(cfgParteFixa).template,
       anterior && anterior.template, NFPR.Config.parteFixaSalva(anterior)],
      [2, NFPR.ParteFixa.completar(segunda), NFPR.ParteFixa.completar(primeira), false]);

    // "Limpar as não salvas" empties the recent tier and NEVER touches a saved
    // fixed part. A shared machine accumulates other people's fixed parts; this
    // is the one-click answer, and having named a fixed part is what promises
    // it is safe.
    await NFPR.Config.atualizarConfig((c) => ({
      partesFixas: c.partesFixas.map((m) =>
        m.id === c.parteFixaAtivaId ? Object.assign({}, m, { nome: 'Guardada' }) : m)
    }));
    const btnLimparParteFixa = doVer((e) => e.textContent === 'Limpar as não salvas');
    for (const fn of (btnLimparParteFixa && btnLimparParteFixa.escutas.click) || []) fn({});
    await new Promise((r) => setTimeout(r, 0));
    const cfgLimpa = await NFPR.Config.obterConfig();
    ok('clearing the unsaved leaves the saved ones, and the active one active',
      [cfgLimpa.partesFixas.length, NFPR.Config.parteFixaSalva(cfgLimpa.partesFixas[0]),
       cfgLimpa.parteFixaAtivaId === cfgParteFixa.parteFixaAtivaId],
      [1, true, true]);

    // ONE BUTTON IS THE WHOLE TWO-TIER MODEL, and it is the half no store
    // assertion can see: `Salvar` while the fixed part is a recent, `Renomear`
    // once it is kept, the same field either way. The label is chosen at paint
    // time, so a wrong branch there is silent everywhere else — it is driven
    // through the real list.
    //
    // TWO MOUNTS, because the storage stub has no onChanged: a strip only ever
    // sees the config it started with, so the label after a rename has to be
    // read off a registrar that started with the renamed fixed part.
    const molde = NFPR.ParteFixa.completar(notaDeHoje.slice(0, 22));
    const listaCom = async (parteFixa) => {
      await NFPR.Config.atualizarConfig({
        partesFixas: parteFixa ? [parteFixa] : [],
        parteFixaAtivaId: parteFixa ? parteFixa.id : null
      });
      const marca = criados.length;
      const u = await NFPR.UI.montar({ modoOffline: true, montarEm: elemento() });
      await NFPR.Registrador.iniciar({ ui: u, msgDuplicada: 'x', aoAceitarChave() {} });
      const meu = (sel) => criados.slice(marca).find(sel);
      // The label is read off the inner span: pintarRotulo REASSIGNS the
      // button's className to carry the invitation state, so matching on that
      // would find nothing half the time.
      const nome = meu((e) => e.className === 'nfpr-strip-nome');
      const limpar = meu((e) => e.className === 'nfpr-strip-limpar');
      const seta = meu((e) => e.className === 'nfpr-strip-seta');
      const desdeAgora = criados.length;
      for (const fn of (seta && seta.escutas.click) || []) fn({});
      const achar = (t) => criados.slice(desdeAgora)
        .find((e) => e.tagName === 'BUTTON' && e.textContent === t);
      return { nome, limpar, achar, campoDepoisDe: (botao) => {
        const antes = criados.length;
        for (const fn of botao.escutas.click || []) fn({});
        return criados.slice(antes).find((e) => e.tagName === 'INPUT' && e.placeholder);
      } };
    };
    const escrever = async (campo, texto) => {
      campo.value = texto;
      for (const fn of campo.escutas.keydown || []) fn({ key: 'Enter', preventDefault: noop });
      await new Promise((r) => setTimeout(r, 0));
      return NFPR.Config.obterConfig();
    };

    // THE STRIP'S TWO RESTING STATES. With nothing armed the label is an
    // INVITATION, not a status — "Chave inteira — 44 números" was true and
    // answered a question nobody had — and there is no escape button, because
    // there is nothing to escape from. Both halves are silent when wrong: an
    // invitation that never appears just looks like a label, and an escape left
    // on screen with no fixed part armed does nothing when clicked.
    const semParteFixa = await listaCom(null);
    ok('with no fixed part the strip invites rather than reports, and offers no escape',
      [semParteFixa.nome.textContent, semParteFixa.limpar.hasAttribute('hidden')],
      ['+ Fixar o começo da chave', true]);

    // ...and with one armed, the way out is ONE CLICK on the strip itself. The
    // cells then hold digits the volunteer never typed, so this cannot be two
    // clicks deep inside a popover they have no reason to open.
    const armada = await listaCom({ id: 'esc', nome: 'Padaria', template: molde, usadaEm: 5 });
    ok('with a fixed part armed the strip names it and shows the one-click way out',
      [armada.nome.textContent, armada.limpar.hasAttribute('hidden')],
      ['Padaria — só 22 números por nota', false]);
    for (const fn of armada.limpar.escutas.click || []) fn({});
    await new Promise((r) => setTimeout(r, 0));
    const cfgSemParteFixa = await NFPR.Config.obterConfig();
    ok('...and it DEACTIVATES, leaving the fixed part in the list to be picked again',
      [cfgSemParteFixa.parteFixaAtivaId, cfgSemParteFixa.partesFixas.length], [null, 1]);

    const recente = await listaCom({ id: 'sem', nome: '', template: molde, usadaEm: 5 });
    ok('an unnamed fixed part offers Salvar, and no Renomear anywhere in the list',
      [!!recente.achar('Salvar'), !!recente.achar('Renomear')], [true, false]);
    // The field: blank, and captioned by the fixed part's OWN DIGITS rather
    // than a made-up default — the only thing that tells two unnamed fixed
    // parts apart.
    const campoSalvar = recente.campoDepoisDe(recente.achar('Salvar'));
    ok('...opening a field that is blank and placeheld by its own digits',
      [campoSalvar && campoSalvar.value, /^…?[\d ]+$/.test((campoSalvar && campoSalvar.placeholder) || '')],
      ['', true]);
    const cfgNomeada = await escrever(campoSalvar, 'Padaria');
    ok('naming it IS saving it, and no separate flag is ever written',
      [NFPR.Config.parteFixaSalva(NFPR.Config.parteFixaAtiva(cfgNomeada)),
       NFPR.Config.parteFixaAtiva(cfgNomeada).nome,
       'salva' in NFPR.Config.parteFixaAtiva(cfgNomeada)],
      [true, 'Padaria', false]);

    // Clearing the name is the ONLY way back out of the saved tier — it is what
    // the ★ used to do, and it has to stay reachable or a saved fixed part
    // could never be let go. Blanks count as blank: a name of spaces is no
    // name.
    const guardada = await listaCom({ id: 'com', nome: 'Padaria', template: molde, usadaEm: 5 });
    ok('a named fixed part offers Renomear, and no Salvar',
      [!!guardada.achar('Renomear'), !!guardada.achar('Salvar')], [true, false]);
    const cfgSolta = await escrever(guardada.campoDepoisDe(guardada.achar('Renomear')), '   ');
    ok('clearing the name lets the fixed part go back to the recent tier',
      [NFPR.Config.parteFixaSalva(NFPR.Config.parteFixaAtiva(cfgSolta)),
       NFPR.Config.parteFixaAtiva(cfgSolta).nome],
      [false, '']);

    // --- ONE LIST, ORDERED BY LAST USE, WITH A FILTER ONCE IT IS LONG -------
    // Saved and recent used to be two blocks in one scrolling box, and two
    // blocks in one box means whichever comes first pushes the other off the
    // bottom: the saved tier is uncapped, so twenty named fixed parts hid every
    // recent, and leading with the recents only swaps which half disappears.
    // The tier is still on every row — it is what the first button says — but
    // it no longer decides position. All of this is silent when wrong: a list
    // in the wrong order still renders, and a filter that matched nothing still
    // draws a popover.
    const listaDe = async (partesFixas, ativaId) => {
      await NFPR.Config.atualizarConfig({ partesFixas, parteFixaAtivaId: ativaId || null });
      const marca = criados.length;
      const u = await NFPR.UI.montar({ modoOffline: true, montarEm: elemento() });
      await NFPR.Registrador.iniciar({ ui: u, msgDuplicada: 'x', aoAceitarChave() {} });
      const meu = (sel) => criados.slice(marca).find(sel);
      const campo = meu((e) => e.className === 'nfpr-partes-busca-campo');
      const busca = meu((e) => e.className === 'nfpr-partes-busca');
      const seta = meu((e) => e.className === 'nfpr-strip-seta');
      const desdeAgora = criados.length;
      for (const fn of (seta && seta.escutas.click) || []) fn({});
      // Every filter repaint appends a fresh set of rows to the flat `criados`
      // list, so a reader that did not slice would see every paint at once.
      const lidos = (desde) => ({
        linhas: criados.slice(desde)
          .filter((e) => /^nfpr-partes-item( |$)/.test(e.className)),
        nomes: criados.slice(desde)
          .filter((e) => e.className === 'nfpr-partes-item-nome').map((e) => e.textContent),
        subs: criados.slice(desde)
          .filter((e) => e.className === 'nfpr-partes-item-sub').map((e) => e.textContent),
        // The warning line carries a second class, so it is deliberately NOT in
        // `subs` above — the two say different kinds of thing.
        alertas: criados.slice(desde)
          .filter((e) => /nfpr-partes-item-alerta/.test(e.className)).map((e) => e.textContent),
        fixa: criados.slice(desde).some((e) => /nfpr-partes-item-fixa/.test(e.className)),
        vazio: criados.slice(desde).find((e) => e.className === 'nfpr-partes-vazio')
      });
      return {
        ui: u,
        campo,
        busca,
        corpo: meu((e) => e.className === 'nfpr-partes-lista'),
        limparNaoSalvas: meu((e) => e.textContent === 'Limpar as não salvas'),
        limparVencidas: meu((e) => e.textContent === 'Limpar as vencidas'),
        aberto: lidos(desdeAgora),
        filtrar: (texto) => {
          const antes = criados.length;
          campo.value = texto;
          for (const fn of campo.escutas.input || []) fn({});
          return lidos(antes);
        }
      };
    };
    const moldeA = NFPR.ParteFixa.completar(notaDeHoje.slice(0, 22));
    // A DIFFERENT ISSUER, not a shorter prefix of the same one: every fixed
    // part here shares the head of `notaDeHoje`, so a template that is a prefix
    // of another is found by every digit search aimed at either. It is a CT-e,
    // which makes it a fixed part the list marks for something other than
    // time (see the brooms below).
    const moldeB = NFPR.ParteFixa.completar(ate35(emitentePf.slice(0, 20) + '57' + '930'));

    const porUso = await listaDe([
      { id: 'velha', nome: 'Guardada há meses', template: moldeA, usadaEm: 1 },
      { id: 'nova', nome: '', template: moldeB, usadaEm: 9 }
    ]);
    ok('a saved fixed part does not outrank a recent one: last use is the whole order',
      porUso.aberto.nomes.slice(1).map((n) => (/Guardada/.test(n) ? 'salva' : 'recente')),
      ['recente', 'salva']);
    // THE DIGITS APPEAR ONCE. An unnamed fixed part already shows them where a
    // name would go, so repeating them underneath cost the tier that grows on
    // its own a second line each, on the list that had run out of room.
    ok('an unnamed row does not print its digits twice',
      [/^…?[\d ]+$/.test(porUso.aberto.nomes[1]), porUso.aberto.subs[0].indexOf('…') === -1],
      [true, true]);

    // --- THE WHOLE ROW CHOOSES, AND CHOOSING SCROLLS HOME -------------------
    // Both halves are silent when wrong. A row whose click never reaches the
    // handler is simply a row that does nothing when clicked, which is exactly
    // what it looked like before; and a click on `Remover` that ALSO activates
    // the fixed part it is removing leaves no trace on screen at all.
    //
    // `closest` stands in for the real event's walk up from whatever was hit:
    // null means the click landed on the row's own text, a truthy answer means
    // it landed on something with its own job.
    const naLinha = (linha, alvo) => {
      for (const fn of linha.escutas.click || []) fn({ target: { closest: () => alvo || null } });
    };
    // The rows are [Chave inteira, nova, velha] — ordered by last use — so the
    // second fixed part row is `velha`, and it is not the active one.
    porUso.corpo.scrollTop = 120;
    naLinha(porUso.aberto.linhas[2]);
    await new Promise((r) => setTimeout(r, 0));
    ok('clicking anywhere on a row picks that fixed part, not just the radio dot',
      (await NFPR.Config.obterConfig()).parteFixaAtivaId, 'velha');
    // The list is ordered by last use, so the fixed part just picked is now the
    // first row. Left where it was, the volunteer is looking at whatever slid
    // into the place they were, with nothing saying the click landed.
    ok('...and the list scrolls home, where the fixed part it just moved now is',
      porUso.corpo.scrollTop, 0);

    const comAcoes = await listaDe([
      { id: 'a', nome: 'Padaria', template: moldeA, usadaEm: 2 },
      { id: 'b', nome: 'Mercado', template: moldeB, usadaEm: 1 }
    ], 'a');
    naLinha(comAcoes.aberto.linhas[2], { tagName: 'BUTTON' });
    await new Promise((r) => setTimeout(r, 0));
    ok('a click on Salvar, Renomear or Remover does not also pick the row',
      (await NFPR.Config.obterConfig()).parteFixaAtivaId, 'a');
    // The radio fires its own change; handling the click here as well would
    // activate twice, and re-picking the active row would restamp its last use
    // and reorder the list under a click that asked for nothing.
    const antesDoNada = (await NFPR.Config.obterConfig()).partesFixas
      .find((m) => m.id === 'a').usadaEm;
    naLinha(comAcoes.aberto.linhas[1]);
    await new Promise((r) => setTimeout(r, 0));
    ok('...and clicking the row already chosen changes nothing at all',
      (await NFPR.Config.obterConfig()).partesFixas.find((m) => m.id === 'a').usadaEm,
      antesDoNada);

    // A SEARCH BOX OVER A SHORT LIST is furniture that claims the list is
    // longer than it is; over twenty it is the only way to reach the
    // eighteenth. The threshold is the whole of that decision.
    const partesFixasDe = (n) => Array.from({ length: n }, (_, i) => ({
      id: 'f' + i, nome: 'Loja ' + i, template: moldeA, usadaEm: n - i
    }));
    const curta = await listaDe(partesFixasDe(NFPR.StripParteFixa.LIMITE_SEM_FILTRO));
    ok('at the threshold there is no filter at all',
      curta.busca.hasAttribute('hidden'), true);

    const longa = await listaDe(
      partesFixasDe(NFPR.StripParteFixa.LIMITE_SEM_FILTRO + 1).concat([
        { id: 'nomeada', nome: 'Padaria do Zé', template: moldeB, usadaEm: 99 }
      ])
    );
    const totalLonga = NFPR.StripParteFixa.LIMITE_SEM_FILTRO + 2;
    // The placeholder does double duty: what the field is for, and how many
    // fixed parts are behind it — the one number that says whether scrolling or
    // typing is the shorter route.
    ok('past it the filter appears and names the count',
      [longa.busca.hasAttribute('hidden'), longa.campo.placeholder],
      [false, 'Procurar entre ' + totalLonga + ' partes fixas']);

    // ACCENT- AND CASE-INSENSITIVE, because a volunteer hunting a fixed part
    // does not spell it the way they saved it.
    ok('it matches a name without its accents or its case',
      longa.filtrar('PADARIA DO ZE').nomes.slice(1), ['Padaria do Zé']);
    // NAMES AND DIGITS: an unnamed fixed part has nothing but digits, and those
    // are exactly the tier that grows on its own.
    ok('...and it matches the digits, spaced or not',
      [longa.filtrar('11144477735').nomes.slice(1),
       longa.filtrar(NFPR.agruparChave('11144477735')).nomes.slice(1)],
      [['Padaria do Zé'], ['Padaria do Zé']]);
    // "Chave inteira" is not a fixed part: it is the radio group's zero state
    // and the destination of the commonest correction there is, so no filter
    // takes it away and it is pinned above the scroll rather than riding it.
    const semNada = longa.filtrar('zzzz');
    ok('a search that matches nothing keeps the way back to the whole key',
      [semNada.nomes, semNada.fixa, !!semNada.vazio],
      [['Chave inteira — 44 números'], true, true]);

    // --- THE FOOTER'S TWO BROOMS ARE CONDITIONAL ---------------------------
    // A control that clears nothing is not idle furniture in a frame this
    // tight: it is a claim that there is something to clear, on the one surface
    // a volunteer consults to find out whether there is. Both halves are silent
    // when wrong — a button that never appears looks like a feature nobody
    // built, and one that always appears looks like a list that never gets
    // clean.
    const vencido = NFPR.ParteFixa.completar(chaveCom({
      aa: String(agoraReg.ano - 2001).padStart(2, '0'),
      mm: String(agoraReg.mes).padStart(2, '0')
    }).slice(0, 22));

    const semVarrer = await listaDe([
      { id: 's1', nome: 'Padaria', template: moldeA, usadaEm: 2 },
      { id: 's2', nome: 'Mercado', template: moldeB, usadaEm: 1 }
    ]);
    ok('with every fixed part saved and none stale, the footer offers no broom at all',
      [semVarrer.limparNaoSalvas.hasAttribute('hidden'),
       semVarrer.limparVencidas.hasAttribute('hidden')],
      [true, true]);
    // AND `moldeB` IS MARKED WHILE THAT HOLDS. It is a CT-e fixed part, so
    // the list draws it with an amber sentence — but it is not STALE, it is
    // a fixed part that could never describe a donatable note. The broom is
    // named for one of the two and must take only that one, or a row is
    // destroyed under a word that never applied to it. The two facts read alike
    // on the row, which is exactly why `vencida` travels beside the sentence
    // instead of being recovered from it.
    ok('...even though a fixed part marked for something other than time is on the list',
      [semVarrer.aberto.alertas.length, semVarrer.limparVencidas.hasAttribute('hidden')],
      [1, true]);

    const comRecente = await listaDe([
      { id: 's1', nome: 'Padaria', template: moldeA, usadaEm: 2 },
      { id: 'r1', nome: '', template: moldeB, usadaEm: 1 }
    ]);
    ok('one unsaved fixed part brings back "Limpar as não salvas", and only that one',
      [comRecente.limparNaoSalvas.hasAttribute('hidden'),
       comRecente.limparVencidas.hasAttribute('hidden')],
      [false, true]);

    // THE STALE BROOM SWEEPS BOTH TIERS, and that is the whole reason it is not
    // just a wider "Limpar as não salvas": a stale fixed part is worthless
    // however carefully it was named, and the row's marking is the only thing
    // that ever prompts a stale SAVED fixed part off the list. Sparing the
    // saved ones here would spare exactly the fixed parts this button exists
    // for.
    const comVencida = await listaDe([
      { id: 'v1', nome: 'Vencida e guardada', template: vencido, usadaEm: 3 },
      { id: 'v2', nome: '', template: vencido, usadaEm: 2 },
      { id: 'ok1', nome: 'Boa e guardada', template: moldeA, usadaEm: 1 }
    ], 'v1');
    ok('a stale fixed part brings back "Limpar as vencidas", saved or not',
      [comVencida.limparVencidas.hasAttribute('hidden'),
       comVencida.aberto.linhas.length],
      [false, 4]);
    for (const fn of comVencida.limparVencidas.escutas.click || []) fn({});
    await new Promise((r) => setTimeout(r, 0));
    const depoisDeVarrer = await NFPR.Config.obterConfig();
    ok('...and it takes the saved stale one with the recent one, sparing the good fixed part',
      [depoisDeVarrer.partesFixas.map((m) => m.id), depoisDeVarrer.parteFixaAtivaId],
      [['ok1'], null]);

    // THE FILTER IS NEVER FOCUSED AUTOMATICALLY — this popover lives in the
    // registrar's own root precisely so a scan mid-list still registers, and a
    // field that grabbed focus on open would swallow the next barcode. What it
    // must do is stand capture down WHILE it is focused, exactly as the fixed
    // part editor and the rename field do: without that, every Backspace typed
    // in here is eaten by the key buffer and the field simply refuses to be
    // corrected.
    ok('opening the list does not take the keyboard from the scanner',
      longa.ui.editandoParteFixa(), false);
    for (const fn of longa.campo.escutas.focus || []) fn({});
    ok('...and focusing the filter stands capture down',
      longa.ui.editandoParteFixa(), true);
    for (const fn of longa.campo.escutas.blur || []) fn({});
    ok('...only for as long as it holds the focus',
      longa.ui.editandoParteFixa(), false);

    // Hand the store back the way the tier assertions left it: the caret check
    // below mounts a registrar and clicks the strip's label, which reads
    // differently with no fixed part armed.
    await NFPR.Config.atualizarConfig({
      partesFixas: [{ id: 'com', nome: '', template: molde, usadaEm: 5 }],
      parteFixaAtivaId: 'com'
    });

    // --- the editor's caret follows the FIELD, never the first '?' -----------
    // The 44 cells are the fixed part editor's preview, so they also show which
    // character is being edited. That position cannot be derived the way it is
    // for a key being typed (`typed.length`, the next cell a keystroke fills):
    // nobody is typing into the cells here, and the moment the fixed part
    // contains a `?` the derived caret lands on that first variable slot and
    // stays there while the volunteer edits somewhere else entirely. It is
    // handed in from the strip field's own cursor instead. Asserted through the
    // real editor because the wrong cell blinking is silent in every other
    // check.
    const celulasDe = (marca) =>
      criados.slice(marca).filter((e) => /^nfpr-cell nfpr-cell-/.test(e.className));
    const marcaCaret = criados.length;
    const uiCaret = await NFPR.UI.montar({ modoOffline: true, montarEm: elemento() });
    await NFPR.Registrador.iniciar({ ui: uiCaret, msgDuplicada: 'x', aoAceitarChave() {} });
    const celulasCaret = celulasDe(marcaCaret);
    const doCaret = (sel) => criados.slice(marcaCaret).find(sel);
    const rotuloCaret = doCaret((e) => e.className === 'nfpr-strip-rotulo');
    const campoCaret = doCaret(
      (e) => typeof e.placeholder === 'string' && /parte que se repete nas chaves/.test(e.placeholder));
    for (const fn of rotuloCaret.escutas.click || []) fn({ preventDefault: noop });
    const piscando = () =>
      celulasCaret.reduce((acc, c, i) => (/ nfpr-cell-atual$|-atual$/.test(c.className) ? acc.concat(i) : acc), []);
    const editarParteFixa = (texto, pos, evento) => {
      campoCaret.value = texto;
      campoCaret.selectionStart = pos;
      campoCaret.selectionEnd = pos;
      for (const fn of campoCaret.escutas[evento || 'input'] || []) fn({});
      return piscando();
    };
    ok('the caret sits at the end of a fixed part with no ? in it yet',
      editarParteFixa('123456', 6), [6]);
    // The case in the bug report: the fixed part gained a '?' and the blink
    // jumped backwards onto it, then refused to move again.
    ok('...and stays with the cursor once a ? is in the fixed part',
      editarParteFixa('123456?890', 10), [10]);
    ok('...over a digit the fixed part fixes, as one cell and not two',
      editarParteFixa('123456?890', 8), [8]);
    // Moving the cursor without typing moves what is being edited.
    ok('a click inside the field moves the caret with no text change',
      editarParteFixa('123456?890', 2, 'click'), [2]);

    // SPACE TYPES A '?'. The key has no spaces, so the space bar is free, and
    // it is the one character in this field that is not on the number pad the
    // volunteer already has a hand on. Driven through the real keydown, cursor
    // and all, because it is a text edit and not just a keystroke.
    const espaco = (texto, ini, fim) => {
      campoCaret.value = texto;
      campoCaret.selectionStart = ini;
      campoCaret.selectionEnd = fim === undefined ? ini : fim;
      for (const fn of campoCaret.escutas.keydown || []) {
        fn({ key: ' ', preventDefault: noop, stopPropagation: noop });
      }
      return [campoCaret.value, piscando()[0]];
    };
    ok('space types a ? at the cursor and moves past it',
      espaco('1234', 4), ['1234?', 5]);
    ok('...in the middle of a fixed part, without disturbing the rest',
      espaco('123456', 2), ['12?3456', 3]);
    // Typing a character over a selection replaces it, as any field does.
    ok('...and over a selection, replacing it',
      espaco('123456', 2, 5), ['12?6', 3]);
    // A full fixed part has no room, so the '?' is not there and the cursor may
    // not advance past a character that was never inserted.
    ok('...but not into a fixed part that is already 44 long',
      espaco('9'.repeat(44), 44), ['9'.repeat(44), 43]);

    // --- CANCELAR AND ESCAPE PUT EVERYTHING BACK, AND WRITE NOTHING ----------
    // The cells are the editor's preview, so backing out has three things to
    // undo and all three are silent when missed: cells still showing a fixed
    // part nobody applied, a field still claiming the keyboard from capture,
    // and the keyboard itself left inside a row that has just been hidden.
    const linhaEditorCaret = doCaret((e) => /nfpr-strip-linha-editor/.test(e.className));
    const proxyCaret = doCaret((e) => e.className === 'nfpr-proxy');
    const btnCancelarCaret = criados.slice(marcaCaret).find((e) =>
      e.tagName === 'BUTTON' && e.textContent === 'Cancelar' && /nfpr-btn-sm/.test(e.className));
    const moldeNasCelulas = () => celulasCaret.map((c) => c.textContent || '?').join('');
    const antesDeRecuar = JSON.stringify((await NFPR.Config.obterConfig()).partesFixas);
    const recuarCom = async (gesto) => {
      for (const fn of rotuloCaret.escutas.click || []) fn({ preventDefault: noop });
      editarParteFixa('9999', 4); // the preview now shows a fixed part nobody applied
      const previa = moldeNasCelulas().slice(0, 4);
      gesto();
      await new Promise((r) => setTimeout(r, 0));
      return [previa, moldeNasCelulas().slice(0, 22), !!linhaEditorCaret.atributos.hidden,
        uiCaret.editandoParteFixa(), foco.el === proxyCaret,
        JSON.stringify((await NFPR.Config.obterConfig()).partesFixas) === antesDeRecuar];
    };
    const recuado = [ '9999', molde.slice(0, 22), true, false, true, true ];
    ok('Escape backs out of the editor: the armed fixed part\'s cells, the keyboard on the entry, nothing written',
      await recuarCom(() => {
        for (const fn of campoCaret.escutas.keydown || []) {
          fn({ key: 'Escape', preventDefault: noop, stopPropagation: noop });
        }
      }), recuado);
    ok('...and Cancelar does exactly the same',
      await recuarCom(() => {
        for (const fn of btnCancelarCaret.escutas.click || []) fn({});
      }), recuado);

    // AND THE FIELD OPENS WITH NO TRAILING '?'. A stored fixed part is
    // completed to 44, so editing one used to mean arrowing past a wall of
    // question marks that said nothing `ParteFixa.completar` does not say with
    // silence. Only the ones BETWEEN digits carry information. Trimmed on the
    // way in only — the space shortcut above proves a '?' typed at the end
    // survives, which is what makes a middle one reachable at all.
    await NFPR.Config.atualizarConfig({
      partesFixas: [{ id: 'cauda', nome: '', template: NFPR.ParteFixa.completar('41????65'), usadaEm: 9 }],
      parteFixaAtivaId: 'cauda'
    });
    const marcaCauda = criados.length;
    const uiCauda = await NFPR.UI.montar({ modoOffline: true, montarEm: elemento() });
    await NFPR.Registrador.iniciar({ ui: uiCauda, msgDuplicada: 'x', aoAceitarChave() {} });
    const doCauda = (sel) => criados.slice(marcaCauda).find(sel);
    for (const fn of doCauda((e) => e.className === 'nfpr-strip-rotulo').escutas.click || []) {
      fn({ preventDefault: noop });
    }
    const campoCauda = doCauda(
      (e) => typeof e.placeholder === 'string' && /parte que se repete nas chaves/.test(e.placeholder));
    ok('editing a stored fixed part opens on its digits, not on 36 question marks',
      campoCauda.value, '41????65');

    // AND IT SAYS WHICH FIXED PART IT IS EDITING. One text field does two jobs
    // — writing a new fixed part and rewriting the armed one — and applying an
    // edit overwrites that fixed part in place. The text alone cannot tell them
    // apart: an existing fixed part opens pre-filled with digits
    // indistinguishable from freshly typed ones, and the placeholder, the only
    // other thing that could have named it, is never on screen in exactly that
    // case. Asserted in both directions because the branch is picked at paint
    // time and a wrong one is silent in every other check.
    await NFPR.Config.atualizarConfig({
      partesFixas: [{ id: 'nomeada', nome: 'AMARAS', template: NFPR.ParteFixa.completar('41'), usadaEm: 9 }],
      parteFixaAtivaId: 'nomeada'
    });
    const marcaLeg = criados.length;
    const uiLeg = await NFPR.UI.montar({ modoOffline: true, montarEm: elemento() });
    await NFPR.Registrador.iniciar({ ui: uiLeg, msgDuplicada: 'x', aoAceitarChave() {} });
    const doLeg = (sel) => criados.slice(marcaLeg).find(sel);
    const legenda = doLeg((e) => e.className === 'nfpr-strip-legenda');
    for (const fn of doLeg((e) => e.className === 'nfpr-strip-rotulo').escutas.click || []) {
      fn({ preventDefault: noop });
    }
    ok('the fixed part editor names the fixed part it is about to rewrite',
      legenda.textContent, 'Editando “AMARAS”');
    // "+ Nova parte fixa" makes a SECOND fixed part rather than overwriting the
    // armed one, so the same field has to stop naming it.
    for (const fn of doLeg((e) => e.className === 'nfpr-strip-seta').escutas.click || []) {
      fn({ preventDefault: noop });
    }
    for (const fn of doLeg((e) => e.className === 'nfpr-partes-nova').escutas.click || []) {
      fn({ preventDefault: noop });
    }
    ok('...and stops naming one when it is writing a new fixed part',
      legenda.textContent, 'Nova parte fixa');
    // An empty "Nova parte fixa" applied is the volunteer changing their mind
    // about a SECOND fixed part. It used to be read as "chave inteira" and
    // disarm the first one on the way out.
    const campoLeg = doLeg(
      (e) => typeof e.placeholder === 'string' && /parte que se repete nas chaves/.test(e.placeholder));
    campoLeg.value = '';
    for (const fn of campoLeg.escutas.keydown || []) {
      fn({ key: 'Enter', preventDefault: noop, stopPropagation: noop });
    }
    await new Promise((r) => setTimeout(r, 0));
    ok('...and applying it empty writes nothing, leaving the armed fixed part armed',
      (await NFPR.Config.obterConfig()).parteFixaAtivaId, 'nomeada');

    await NFPR.Config.atualizarConfig({ partesFixas: [], parteFixaAtivaId: null });
    marco('the live verdict speaks while typing, and fixed parts are working state');

    // =========================================================================
    // THE KEYBOARD
    // =========================================================================
    // Not a keyboard-first design, and nothing here pretends it is. The bar is
    // lower and firmer: a mouse that breaks in the middle of a sitting must not
    // end the sitting, so every control is reachable with enough keystrokes,
    // and the keyboard is never left on something the volunteer cannot see.
    // Every assertion below is about a failure that is silent until someone
    // presses a key — a focus that went nowhere looks exactly like one that
    // went somewhere.
    await NFPR.Config.atualizarConfig({
      entidades: [{ id: 'e1', nome: 'Entidade', cnpj: '11222333000181' }],
      entidadeAtivaId: 'e1',
      partesFixas: [{ id: 'k1', nome: 'Padaria', template: NFPR.ParteFixa.completar(notaDeHoje.slice(0, 22)), usadaEm: 5 }],
      parteFixaAtivaId: 'k1',
      preferencias: { partesFixas: true }
    });
    const marcaTec = criados.length;
    const nOuvintes = { keydown: ouvintes.keydown.length, click: ouvintes.click.length };
    const uiTec = await NFPR.UI.montar({ modoOffline: true, montarEm: elemento() });
    // What this mount put on the document: the overlay's keyboard listener and
    // the strip's outside-click listener. Captured before the registrar adds
    // capture's own, and dispatched to alone — every earlier mount is still
    // listening too.
    const doMonte = {
      keydown: ouvintes.keydown.slice(nOuvintes.keydown),
      click: ouvintes.click.slice(nOuvintes.click)
    };
    await NFPR.Registrador.iniciar({ ui: uiTec, msgDuplicada: 'x', aoAceitarChave() {} });
    const capturaTec = ouvintes.keydown[ouvintes.keydown.length - 1];
    const doTec = (sel) => criados.slice(marcaTec).find(sel);
    const modalTec = doTec((e) => e.className === 'nfpr-modal');
    const chipTec = doTec((e) => e.className === 'nfpr-chip-alvo');
    const proxyTec = doTec((e) => e.className === 'nfpr-proxy');
    const ajudaTec = doTec((e) => e.className === 'nfpr-help-btn');
    const voltasTec = criados.slice(marcaTec).filter((e) => e.className === 'nfpr-back');
    const stripTec = doTec((e) => e.className === 'nfpr-strip');
    const rotuloTec = doTec((e) => /^nfpr-strip-rotulo( |$)/.test(e.className));
    const linhaEdTec = doTec((e) => /nfpr-strip-linha-editor/.test(e.className));
    const campoTec = doTec(
      (e) => typeof e.placeholder === 'string' && /parte que se repete nas chaves/.test(e.placeholder));
    const popTec = doTec((e) => e.className === 'nfpr-partes-pop');
    const setaTec = doTec((e) => e.className === 'nfpr-strip-seta');
    const clique = (alvo) => { for (const fn of alvo.escutas.click || []) fn({}); };
    const noModal = (ev) => { for (const fn of doMonte.keydown) fn(ev); };
    const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

    // The count pill exists only under a fixed part, where it counts the
    // digits the fixed part leaves (22 here). Without one it is empty — above.
    const progTec = doTec((e) => /^nfpr-strip-progresso/.test(e.className));
    for (const ch of notaDeHoje.slice(22, 25)) {
      relogioPerf.ms += 200;
      capturaTec({ key: ch, preventDefault: noop, stopPropagation: noop });
    }
    ok('under a fixed part the strip counts the digits it leaves',
      [progTec.textContent, /nfpr-strip-progresso-visivel/.test(progTec.className)], ['3 de 22', true]);
    relogioPerf.ms += 200;
    capturaTec({ key: 'Escape', preventDefault: noop, stopPropagation: noop });
    ok('...and the pill goes with the entry', progTec.textContent, '');

    // --- the settings overlay -------------------------------------------------
    // The keyboard used to stay on whatever opened it — the chip, behind the
    // backdrop, still ringed — so the first Tab went on through the page.
    foco.el = chipTec;
    uiTec.abrir('config');
    ok('opening settings takes the keyboard into the dialog, off the chip behind it',
      foco.el === modalTec, true);
    // Every page switch hides the button that was pressed to make it, so each
    // one has to say where the keyboard goes next.
    clique(ajudaTec);
    ok('Ajuda puts the keyboard on its own way back', foco.el === voltasTec[0], true);
    clique(voltasTec[0]);
    ok('...and the way back lands on Ajuda, not on the button that just vanished',
      foco.el === ajudaTec, true);
    uiTec.abrir('falhas');
    ok('a page opened from a bar takes the keyboard on its own way back',
      foco.el === voltasTec[1], true);
    const limparTec = doTec((e) => e.textContent === 'Limpar a lista');
    const cancelarTec = criados.slice(marcaTec).find((e) =>
      e.tagName === 'BUTTON' && e.textContent === 'Cancelar' && e.className === 'nfpr-btn nfpr-btn-ghost');
    clique(limparTec);
    const noPrimeiroPasso = foco.el === cancelarTec;
    clique(cancelarTec);
    ok('the two-step clear keeps the keyboard with it, and offers Cancelar first',
      [noPrimeiroPasso, foco.el === limparTec], [true, true]);

    // TAB STAYS INSIDE. Without it Tab walked off the last control into the
    // government page behind the backdrop. The stub has no layout, so the
    // dialog is handed a tab order of its own: two plain stops, a radio group
    // whose CHECKED member is the last stop, and two controls Tab never reaches
    // — one not on screen, one disabled — placed after it, where a naive
    // "last element" would pick them.
    uiTec.abrir('config');
    const parada = (extra) => Object.assign({
      tabIndex: 0, disabled: false, getClientRects: () => [{}],
      focus() { foco.el = this; }
    }, extra);
    const pA = parada({}), pB = parada({});
    const r1 = parada({ type: 'radio', name: 'g', checked: false });
    const r2 = parada({ type: 'radio', name: 'g', checked: true });
    const ordemTab = [pA, pB, r1, r2, parada({ getClientRects: () => [] }), parada({ disabled: true })];
    const qsaOriginal = modalTec.querySelectorAll;
    const containsOriginal = modalTec.contains;
    modalTec.querySelectorAll = () => ordemTab;
    modalTec.contains = (x) => x === modalTec || ordemTab.includes(x);
    const tab = (de, shift) => {
      foco.el = de;
      let impedido = false;
      noModal({ key: 'Tab', shiftKey: !!shift, preventDefault: () => { impedido = true; }, stopPropagation: noop });
      return [foco.el, impedido];
    };
    ok('Tab past the last stop wraps to the first',
      tab(r2)[0] === pA, true);
    ok('...Shift+Tab before the first wraps to the last — the checked radio, not something hidden',
      tab(pA, true)[0] === r2, true);
    ok('...a step in the middle is left to Tab itself',
      tab(pB), [pB, false]);
    ok('...a keyboard that got outside is brought back in at the top',
      tab(proxyTec)[0] === pA, true);
    ok('...and from the dialog itself, Shift+Tab reaches the bottom',
      tab(modalTec, true)[0] === r2, true);
    modalTec.querySelectorAll = qsaOriginal;
    modalTec.contains = containsOriginal;
    noModal({ key: 'Escape', preventDefault: noop, stopPropagation: noop });
    await pausa(40);
    ok('Escape closes it, and the keyboard goes back to the entry',
      [uiTec.estaAberto(), foco.el === proxyTec], [false, true]);

    // --- the strip going away under the keyboard ------------------------------
    // Fixed parts are switched off in Preferências, which is to say from inside
    // the overlay — and the editor survives the overlay opening over it.
    // Closing the editor used to focus the entry, pulling the keyboard out of
    // the form being used and parking it behind the backdrop.
    clique(rotuloTec);
    const editorAberto = [uiTec.editandoParteFixa(), foco.el === campoTec];
    // The overlay closes by handing the keyboard to the entry. With the editor
    // still open that was the wrong place: the field kept its claim on capture
    // and the keyboard sat on the entry box, where nothing typed went anywhere.
    uiTec.abrir('config');
    uiTec.fechar();
    await pausa(40);
    ok('closing settings over an open fixed part editor gives the keyboard back to the editor',
      foco.el === campoTec, true);
    uiTec.abrir('config');
    uiTec.setPartesFixasVisiveis(false);
    ok('switching fixed parts off from Preferências closes the editor and leaves the keyboard in the form',
      [editorAberto, !!linhaEdTec.atributos.hidden, !!stripTec.atributos.hidden,
       uiTec.editandoParteFixa(), foco.el === modalTec],
      [[true, true], true, true, false, true]);
    uiTec.fechar();
    await pausa(40);
    // The same switch flipped from the toolbar popup, with nothing over the
    // page: the editor goes, and the keyboard goes back to an entry that
    // accepts keys again — the editor's claim on capture has to go with it.
    uiTec.setPartesFixasVisiveis(true);
    clique(rotuloTec);
    uiTec.setPartesFixasVisiveis(false);
    const celulasTec = criados.slice(marcaTec).filter((c) => /^nfpr-cell nfpr-cell-/.test(c.className));
    relogioPerf.ms += 200;
    capturaTec({ key: '7', preventDefault: noop, stopPropagation: noop });
    ok('...and from anywhere else, back to an entry that takes keys again',
      [foco.el === proxyTec, uiTec.editandoParteFixa(),
       celulasTec.some((c) => /preenchido/.test(c.className))],
      [true, false, true]);
    relogioPerf.ms += 200;
    capturaTec({ key: 'Escape', preventDefault: noop, stopPropagation: noop });
    // THE LIST, closed with the keyboard inside it. It used to be left on a
    // row that had just been hidden.
    uiTec.setPartesFixasVisiveis(true);
    clique(setaTec);
    const radiosLista = () => criados.slice(marcaTec)
      .filter((e) => e.type === 'radio' && e.name === 'nfpr-strip-partes');
    radiosLista().pop().focus();
    uiTec.setPartesFixasVisiveis(false);
    ok('a list hidden under the keyboard hands it to the entry, not to nothing',
      [!!popTec.atributos.hidden, foco.el === proxyTec], [true, true]);
    uiTec.setPartesFixasVisiveis(true);

    // --- Escape in the list ---------------------------------------------------
    // Without a mouse the only way out of the list was the ▾ that opened it.
    clique(setaTec);
    radiosLista().pop().focus();
    for (const fn of popTec.escutas.keydown || []) {
      fn({ key: 'Escape', preventDefault: noop, stopPropagation: noop });
    }
    ok('Escape anywhere in the list closes it, and the keyboard goes back to the ▾',
      [!!popTec.atributos.hidden, foco.el === setaTec], [true, true]);
    // ...but the rename field's Escape is the rename's, and it stops there, or
    // cancelling a name would take the whole list down with it.
    clique(setaTec);
    const desdeRen = criados.length;
    clique(criados.slice(marcaTec).filter((e) => e.tagName === 'BUTTON' && e.textContent === 'Renomear').pop());
    const campoNome = criados.slice(desdeRen).find((e) => e.tagName === 'INPUT' && e.placeholder);
    let parouNoNome = false;
    for (const fn of campoNome.escutas.keydown || []) {
      fn({ key: 'Escape', preventDefault: noop, stopPropagation: () => { parouNoNome = true; } });
    }
    ok('...while Escape in a rename cancels the rename and goes no further',
      [parouNoNome, !popTec.atributos.hidden], [true, true]);

    // --- the outside click, and the closed shadow root ------------------------
    // TWO LISTENERS, because a listener on the document sees a click from our
    // closed root as a click on its HOST: from out there, Renomear inside the
    // list is indistinguishable from the government page. That once closed the
    // list before Renomear's own handler ran, and renaming did nothing at all.
    // The stub models no shadow roots, so the strip is given one.
    const hostFalso = { tagName: 'DIV' };
    const raizFalsa = {
      host: hostFalso, escutas: {}, activeElement: null,
      addEventListener(tipo, fn) { (this.escutas[tipo] = this.escutas[tipo] || []).push(fn); }
    };
    const raizOriginal = stripTec.getRootNode;
    stripTec.getRootNode = () => raizFalsa;
    clique(setaTec); // closes what the rename left open
    clique(setaTec); // ...and opens it again, which is when the inner listener is attached
    const clicarEm = (visto, dentro) => {
      for (const fn of doMonte.click) fn({ composedPath: () => visto });
      if (dentro) for (const fn of raizFalsa.escutas.click || []) fn({ composedPath: () => dentro });
      return !!popTec.atributos.hidden;
    };
    const renomearNaLista = criados.slice(marcaTec)
      .filter((e) => e.tagName === 'BUTTON' && e.textContent === 'Renomear').pop();
    ok('a click inside the list — on Renomear — leaves it open, though the document only sees our host',
      clicarEm([hostFalso, documentoStub], [renomearNaLista, popTec, stripTec, hostFalso]), false);
    ok('...a click elsewhere in our own panel closes it, decided by the listener that can see where',
      clicarEm([hostFalso, documentoStub], [proxyTec, hostFalso]), true);
    clique(setaTec);
    ok('...and a click on the government page closes it from the document',
      clicarEm([{ tagName: 'SPAN' }, documentoStub], null), true);
    stripTec.getRootNode = raizOriginal;

    // --- the entity list, through its own repaint -----------------------------
    // The row's radio is invisible by design, so Tab reached it with nothing on
    // screen moving (the CSS ring is not something this stub can see). And
    // choosing is an arrow key, which writes config, which REBUILDS the list —
    // destroying the radio that had just been chosen, so every choice from the
    // keyboard dropped the keyboard on nothing.
    const secEnt = NFPR.secaoEntidades({});
    const ent = (id) => ({ id: id, nome: id.toUpperCase(), cnpj: '11222333000181' });
    const pintarEnt = (ids, ativa) => {
      const desde = criados.length;
      secEnt.render({ entidades: ids.map(ent), entidadeAtivaId: ativa });
      return {
        radios: criados.slice(desde).filter((e) => e.type === 'radio' && e.name === 'nfpr-inst-ativa'),
        remover: (id) => criados.slice(desde).find((e) => e.textContent === 'Remover' && e.nfprId === id)
      };
    };
    const antesEnt = pintarEnt(['a', 'b'], 'a');
    const radioB = antesEnt.radios.find((r) => r.nfprId === 'b');
    radioB.focus(); // an arrow key moves the check onto B...
    const depoisEnt = pintarEnt(['a', 'b'], 'b'); // ...which wrote config, which repainted
    ok('choosing an entity from the keyboard keeps the keyboard on it through the repaint',
      [foco.el !== radioB, depoisEnt.radios.indexOf(foco.el) !== -1, foco.el.nfprId],
      [true, true, 'b']);
    depoisEnt.remover('b').focus();
    const semB = pintarEnt(['a'], 'a');
    ok('removing an entity leaves the keyboard on the checked radio, never on the next Remover',
      [semB.radios.indexOf(foco.el) !== -1, foco.el.nfprId], [true, 'a']);
    semB.remover('a').focus();
    pintarEnt([], null);
    ok('...and on the add form once the list is empty',
      foco.el.placeholder, '00.000.000/0000-00');
    foco.el = proxyTec;
    pintarEnt(['a'], 'a');
    ok('a repaint leaves a keyboard that was somewhere else alone', foco.el === proxyTec, true);

    // --- and no ARIA ----------------------------------------------------------
    // See CLAUDE.md, Conventions. The job begins with reading a printed
    // receipt, so screen-reader semantics served nobody and cost upkeep —
    // including an assertion written to pin one. Checked in the source, which
    // also covers the markup this stub never builds (SVG strings, popup.html).
    //
    // Every way this codebase could write one: an `aria-` anything, `role:` /
    // `role=` in attrs or markup, a CSS `[role…]` selector, and — missed until
    // the audit's mutation pass — the QUOTED name, which is how both
    // `setAttribute('role', …)` and a `'role':` key in attrs spell it.
    const ARIA = /aria-[a-z]|\brole\s*[:=]\s*['"]|\[role[\]=]|['"]role['"]\s*[:,]/;
    ok('the ARIA scan recognises every spelling it is meant to catch',
      ["el('div', { attrs: { 'aria-label': 'x' } })", "attrs: { role: 'dialog' }",
       '<div role="dialog">', '[role=dialog] {}', "e.setAttribute('role', 'button')",
       'e.setAttribute("role", "button")', "attrs: { 'role': 'status' }", '{ "role": "x" }']
        .map((s) => ARIA.test(s)),
      [true, true, true, true, true, true, true, true]);
    ok('...and not the ordinary words around it',
      ['// this role is the entry\'s', 'var papel = roles.length', "class: 'nfpr-variant'"]
        .map((s) => ARIA.test(s)),
      [false, false, false]);
    const semAria = [];
    (function varrer(dir) {
      for (const nome of fs.readdirSync(dir)) {
        const cheio = path.join(dir, nome);
        if (fs.statSync(cheio).isDirectory()) varrer(cheio);
        else if (/\.(js|html|css)$/.test(nome) &&
          ARIA.test(fs.readFileSync(cheio, 'utf8'))) {
          semAria.push(path.relative(raiz, cheio));
        }
      }
    })(path.join(raiz, 'src'));
    ok('no ARIA attribute or role anywhere in src/', semAria, []);

    await NFPR.Config.atualizarConfig({ partesFixas: [], parteFixaAtivaId: null });
    marco('the keyboard reaches everything, and is never left on nothing');

    // =========================================================================
    // THE LOAD-BEARING CSS AND HTML
    // =========================================================================
    // CLAUDE.md calls these load-bearing, and none of them is a behaviour the
    // stub DOM can run: they are declarations, so they are checked as
    // declarations. Each one is silent when broken — a dropdown clipped by the
    // bar, a dropdown frozen open, two pixels of scrolling, an invisible form
    // that still takes Tab — and each survived the audit's mutation pass.
    //
    // PARSED, NOT GREPPED. "No overflow on #header" is about the rule whose
    // SUBJECT is #header — `#header .x{overflow:hidden}` is fine, and so is
    // `text-overflow` — and a grep can be right about neither. The parser is
    // deliberately small (flat rules, at-rules unwrapped) and is itself checked
    // against the mutations it exists to catch, below, so a parser that finds
    // nothing cannot pass for a stylesheet with nothing wrong in it.
    const partirNoTopo = (s, separador) => {
      const partes = [];
      let fundo = 0;
      let atual = '';
      for (const ch of s) {
        if (ch === '(' || ch === '[') fundo += 1;
        else if (ch === ')' || ch === ']') fundo -= 1;
        if (fundo === 0 && separador.test(ch)) { partes.push(atual); atual = ''; } else atual += ch;
      }
      partes.push(atual);
      return partes.map((p) => p.trim()).filter(Boolean);
    };
    const semParenteses = (s) => {
      let fundo = 0;
      let fora = '';
      for (const ch of s) {
        if (ch === '(') fundo += 1;
        if (fundo === 0) fora += ch;
        if (ch === ')') fundo -= 1;
      }
      return fora;
    };
    // [{ sujeitos: [the last compound of each selector, parentheses dropped],
    //    seletores: [...], decl }] for every rule, at-rules unwrapped.
    const regrasCss = (texto) => {
      const plano = texto
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/@(media|supports|container|layer)[^{;]*\{/g, '');
      const regras = [];
      const re = /([^{}]+)\{([^{}]*)\}/g;
      let m;
      while ((m = re.exec(plano))) {
        const seletorTexto = m[1].split(';').pop();
        const seletores = partirNoTopo(seletorTexto, /,/);
        regras.push({
          seletores,
          sujeitos: seletores.map((s) => {
            const compostos = partirNoTopo(s, /[\s>+~]/);
            return semParenteses(compostos[compostos.length - 1] || '');
          }),
          decl: m[2]
        });
      }
      return regras;
    };
    const declara = (decl, prop) => new RegExp('(^|[;{])\\s*' + prop + '\\s*:', 'i').test(decl);
    // Every rule whose subject is `alvo` and which declares `prop`.
    const violacoes = (texto, alvo, prop) => regrasCss(texto)
      .filter((r) => r.sujeitos.some((s) => alvo.test(s)) && declara(r.decl, prop))
      .map((r) => r.seletores.join(',') + '{' + r.decl + '}');
    const HEADER = /#header(?![\w-])/;
    const OPCOES_CONTA = /\.user-config-options(?![\w-])/;
    const OVERFLOW = 'overflow(-[xy])?';

    // The checker, against the breakages it is for.
    ok('the CSS check finds overflow on #header, inside a media query too',
      [violacoes('#header{height:54px;overflow:visible !important}', HEADER, OVERFLOW).length,
       violacoes('@media (max-width:440px){#header{padding:0;overflow-x:hidden}}', HEADER, OVERFLOW).length,
       violacoes('#header:has(#user-config){overflow:hidden}', HEADER, OVERFLOW).length],
      [1, 1, 1]);
    ok('...and not a descendant\'s overflow, nor text-overflow on #header',
      [violacoes('#header #user-info span{overflow:hidden}', HEADER, OVERFLOW).length,
       violacoes('#header{text-overflow:ellipsis}', HEADER, OVERFLOW).length,
       violacoes('#header-x{overflow:hidden}', HEADER, OVERFLOW).length],
      [0, 0, 0]);
    ok('the CSS check finds display on .user-config-options wherever it is the subject',
      [violacoes('.user-config-options{display:block !important}', OPCOES_CONTA, 'display').length,
       violacoes('#header .user-config-options:hover{left:0;display:none}', OPCOES_CONTA, 'display').length,
       violacoes('.user-config-options a{display:block}', OPCOES_CONTA, 'display').length],
      [1, 1, 0]);

    // host-page.js builds its sheets as JS strings, so it is RUN, in a world of
    // its own, and what is checked is the CSS it actually hands the page.
    // (Its 4 s reveal timer is stubbed out: a live timer would hold the process
    // open for nothing.)
    const mundoHost = criarMundo();
    mundoHost.sandbox.setTimeout = noop;
    vm.runInContext(fs.readFileSync(path.join(raiz, 'src/content/host-page.js'), 'utf8'),
      mundoHost.sandbox, { filename: 'src/content/host-page.js' });
    const cssHost = mundoHost.criados
      .filter((e) => e.tagName === 'STYLE').map((e) => e.textContent).join('\n');
    ok('host-page.js styles the bar at all (so the next two checks read something)',
      [regrasCss(cssHost).some((r) => r.sujeitos.some((s) => HEADER.test(s))),
       regrasCss(cssHost).some((r) => r.sujeitos.some((s) => OPCOES_CONTA.test(s)))],
      [true, true]);
    // Their account dropdown hangs below the 54px bar; any overflow on it clips
    // the dropdown to nothing.
    ok('no overflow is declared on #header', violacoes(cssHost, HEADER, OVERFLOW), []);
    // jQuery's fadeIn writes display inline; an !important display pins the
    // dropdown open or shut for the life of the page.
    ok('no display is declared on .user-config-options',
      violacoes(cssHost, OPCOES_CONTA, 'display'), []);

    // THE FOOTER'S HEIGHT IS PUBLISHED, NEVER RESTATED. painel.js reserves
    // exactly what host-page.js styles with; a second copy of the number is a
    // clipped footer or a gap under the panel the day the two disagree.
    const ALTURA_RODAPE_HOST = mundoHost.sandbox.__nfprHostPage.alturaRodape;
    const regraRodape = regrasCss(cssHost).find((r) => r.seletores.indexOf('#footer') !== -1);
    ok('host-page.js publishes the footer height it styles with',
      [typeof ALTURA_RODAPE_HOST, new RegExp('(^|;)height:' + ALTURA_RODAPE_HOST + 'px')
        .test(regraRodape && regraRodape.decl)],
      ['number', true]);
    const semComentarios = (js) => js
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
    const codigoPainel = semComentarios(fs.readFileSync(path.join(raiz, 'src/content/painel.js'), 'utf8'));
    ok('painel.js reads the published footer height...',
      /\.alturaRodape\b/.test(codigoPainel), true);
    ok('...and never writes the number itself',
      new RegExp('(^|[^\\w.])' + ALTURA_RODAPE_HOST + '(?![\\w.])').test(codigoPainel), false);

    // EVERY WRITTEN PIXEL HEIGHT NEEDS border-box. `all: initial` on :host resets
    // box-sizing to content-box, so a border or padding renders OUTSIDE the
    // number we computed — two pixels of invisible scrolling on the government
    // page, or a popover's footer cut off by the panel. Found by what the code
    // writes rather than listed by hand, so a third written height is checked
    // the day it appears.
    const cssRegistrador = ['src/content/base.css', 'src/content/registrar.css']
      .map((f) => fs.readFileSync(path.join(raiz, f), 'utf8')).join('\n');
    const alturasEscritas = [];
    for (const rel of ['src/content/painel.js', 'src/content/strip-parte-fixa.js', 'src/content/ui.js']) {
      const js = semComentarios(fs.readFileSync(path.join(raiz, rel), 'utf8'));
      const re = /(\w+)\.style\.(height|maxHeight)\s*=/g;
      let m;
      while ((m = re.exec(js))) {
        const def = new RegExp('var ' + m[1] + " = el\\(\\s*'\\w+',\\s*\\{[\\s\\S]{0,300}?class: '([\\w-]+)")
          .exec(js);
        alturasEscritas.push(def ? def[1] : rel + ':' + m[1] + ' (class not found)');
      }
    }
    ok('the elements given a written height are the two CLAUDE.md names',
      alturasEscritas.slice().sort(), ['nfpr-partes-pop', 'nfpr-registrar-page']);
    ok('...and each declares box-sizing: border-box on its own rule',
      alturasEscritas.map((c) => regrasCss(cssRegistrador).some((r) =>
        r.sujeitos.indexOf('.' + c) !== -1 && r.seletores.indexOf('.' + c) !== -1 &&
        /(^|;)\s*box-sizing\s*:\s*border-box/.test(r.decl))),
      alturasEscritas.map(() => true));

    // THE CLOSED OVERLAY LEAVES THE TAB ORDER. Opacity and pointer-events hide
    // it from the eye and the mouse and from nothing else; `visibility` is what
    // takes its controls out of Tab, and the open state has to give it back.
    const regrasModal = regrasCss(fs.readFileSync(path.join(raiz, 'src/content/modal.css'), 'utf8'));
    const codigoModal = fs.readFileSync(path.join(raiz, 'src/content/modal.js'), 'utf8');
    const visibilidade = (sel) => regrasModal
      .filter((r) => r.seletores.indexOf(sel) !== -1)
      .map((r) => (/(^|;)\s*visibility\s*:\s*(\w+)/.exec(r.decl) || [])[2])
      .filter(Boolean);
    ok('modal.js opens and closes the overlay by the classes the CSS keys on',
      [/class: 'nfpr-modal'/.test(codigoModal),
       /modal\.classList\.add\('nfpr-on'\)/.test(codigoModal),
       /modal\.classList\.remove\('nfpr-on'\)/.test(codigoModal)],
      [true, true, true]);
    ok('the closed overlay is visibility: hidden, the open one visible',
      [visibilidade('.nfpr-modal'), visibilidade('.nfpr-modal.nfpr-on')],
      [['hidden'], ['visible']]);

    // THE OFFLINE PAGE NEVER SENDS, and the way that is kept true is that it
    // never loads the module that can. Comments stripped, so a loader line
    // commented out is not mistaken for one that runs.
    const htmlEntrada = fs.readFileSync(path.join(raiz, 'src/offline/entrada.html'), 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '');
    const scriptsEntrada = [];
    {
      const re = /<script[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
      let m;
      while ((m = re.exec(htmlEntrada))) scriptsEntrada.push(m[1]);
    }
    ok('entrada.html loads the shared registrar (so the next check reads something)',
      scriptsEntrada.some((s) => /registrador\.js$/.test(s)), true);
    ok('entrada.html never loads donation.js',
      scriptsEntrada.filter((s) => /donation\.js$/.test(s)), []);

    marco('the load-bearing CSS and HTML say what CLAUDE.md says they say');

    // =========================================================================
    // THE ENTRY SURVIVES WHAT DOES NOT CHANGE IT, AND A VANISHING CONTROL
    // HANDS THE KEYBOARD ON
    // =========================================================================
    // Both are about config writes landing under a volunteer who is working,
    // so this mount gets what the shared stub lacks: a storage that tells its
    // listeners about a write, the way chrome.storage does. Installed before
    // the registrar subscribes and taken down at the end, so no other mount in
    // this world starts hearing writes it was never built to hear.
    await NFPR.Config.atualizarConfig({
      entidades: [
        { id: 'e1', nome: 'Entidade', cnpj: '11222333000181' },
        { id: 'e2', nome: 'Outra', cnpj: '11444777000161' }
      ],
      entidadeAtivaId: 'e1',
      partesFixas: [{ id: 'k1', nome: 'Padaria', template: NFPR.ParteFixa.completar(notaDeHoje.slice(0, 22)), usadaEm: 5 }],
      parteFixaAtivaId: null,
      preferencias: { partesFixas: true }
    });
    const ouvintesCfg = [];
    const onChangedCompartilhado = sandbox.chrome.storage.onChanged.addListener;
    const setCompartilhado = sandbox.chrome.storage.local.set;
    const marcaEnt = criados.length;
    const uiEnt = await NFPR.UI.montar({ modoOffline: true, montarEm: elemento() });
    sandbox.chrome.storage.onChanged.addListener = (f) => ouvintesCfg.push(f);
    sandbox.chrome.storage.local.set = async (o) => {
      await setCompartilhado(o);
      const mudancas = {};
      for (const k of Object.keys(o)) mudancas[k] = { newValue: o[k] };
      ouvintesCfg.forEach((f) => f(mudancas, 'local'));
    };
    let aceitasEnt = [];
    await NFPR.Registrador.iniciar({
      ui: uiEnt, msgDuplicada: 'x', aoAceitarChave(i) { aceitasEnt.push(i); }
    });
    sandbox.chrome.storage.onChanged.addListener = onChangedCompartilhado;
    const capturaEnt = ouvintes.keydown[ouvintes.keydown.length - 1];
    const teclaEnt = (k, gap) => {
      relogioPerf.ms += gap == null ? 200 : gap;
      capturaEnt({ key: k, preventDefault: noop, stopPropagation: noop });
    };
    const doEnt = (sel) => criados.slice(marcaEnt).find(sel);
    const celulasEnt = criados.slice(marcaEnt).filter((c) => /^nfpr-cell nfpr-cell-/.test(c.className));
    const preenchidasEnt = () => celulasEnt.filter((c) => /-preenchido$/.test(c.className)).length;
    const proxyEnt = doEnt((e) => e.className === 'nfpr-proxy');
    // A write, and then long enough for the registrar's async handler to read
    // the config back and repaint.
    const escreverEnt = async (patch) => {
      await NFPR.Config.atualizarConfig(patch);
      await pausa(20);
    };

    // --- the entry --------------------------------------------------------------
    // The registry's official name for an entity saved unverified lands a moment
    // after load, and it is an ordinary config write. It used to empty the
    // entry: the volunteer started typing, the registry answered, the digits
    // vanished. A preference toggled from the popup did the same.
    for (const ch of notaDeHoje.slice(0, 10)) teclaEnt(ch);
    await escreverEnt((c) => ({
      entidades: c.entidades.map((e) =>
        e.id === 'e1' ? Object.assign({}, e, { nome: 'NOME OFICIAL', verificada: true }) : e)
    }));
    await escreverEnt({ preferencias: { somSucesso: true } });
    ok('a name filled in by the registry, or a preference, leaves a half-typed entry on screen',
      preenchidasEnt(), 10);
    for (const ch of notaDeHoje.slice(10)) teclaEnt(ch);
    teclaEnt('Enter');
    ok('...and in the buffer, so finishing it submits the whole key to the same entity',
      [aceitasEnt.length, aceitasEnt[0] && aceitasEnt[0].chave, aceitasEnt[0] && aceitasEnt[0].cnpj],
      [1, notaDeHoje, '11222333000181']);
    // What the entry DOES depend on still empties it: the fixed part whose
    // gaps the digits fill, and the entity they will be frozen to.
    aceitasEnt = [];
    for (const ch of notaDeHoje.slice(22, 30)) teclaEnt(ch);
    await escreverEnt({ parteFixaAtivaId: 'k1' });
    const semParteFixaVelha = preenchidasEnt();
    teclaEnt('Enter');
    ok('arming a fixed part still empties the entry typed without it',
      [semParteFixaVelha, aceitasEnt.length], [0, 0]);
    await escreverEnt({ parteFixaAtivaId: null });
    for (const ch of notaDeHoje.slice(0, 10)) teclaEnt(ch);
    await escreverEnt({ entidadeAtivaId: 'e2' });
    const semEntidadeVelha = preenchidasEnt();
    teclaEnt('Enter');
    ok('...and so does switching the entity it would have gone to',
      [semEntidadeVelha, aceitasEnt.length], [0, 0]);
    await escreverEnt({ entidadeAtivaId: 'e1' });

    // --- a scan corrected by hand, end to end ------------------------------------
    // A scanner that sends no Enter leaves the read in the buffer, and a
    // volunteer may correct it before pressing Enter. What they correct is the
    // key the cells show, and that is the key judged — never the url's tail,
    // and never [fixed part] + [the barcode's head].
    const chaveNova = (n) => {
      const b = notaDeHoje.slice(0, 25) + n + notaDeHoje.slice(34, 43);
      return b + Chave.calcularCDV(b + '0');
    };
    const toquesEnt = [];
    const mostrarErroEnt = uiEnt.mostrarErro;
    uiEnt.mostrarErro = function (msg) {
      toquesEnt.push(msg);
      return mostrarErroEnt.apply(uiEnt, arguments);
    };
    const escanearSemEnter = (texto) => {
      teclaEnt(texto[0]);
      for (const ch of texto.slice(1)) teclaEnt(ch, 0);
    };
    const fixasEnt = () => celulasEnt.filter((c) => /nfpr-cell-fixo/.test(c.className)).length;
    // Under a fixed part: a plain barcode, one Backspace, Enter. The Backspace
    // used to take the key's last digit off `raw`, which left no 44-run, and
    // Enter COMPOSED the fixed part with the barcode's first digits.
    await escreverEnt({ parteFixaAtivaId: 'k1' });
    aceitasEnt = [];
    const lidaSob = chaveNova('000007777');
    escanearSemEnter(lidaSob);
    teclaEnt('Backspace');
    ok('a scan under a fixed part, Backspaced, shows the scan minus one and no fixed part',
      [preenchidasEnt(), fixasEnt()], [43, 0]);
    teclaEnt('Enter');
    ok('...and Enter judges what is shown, never [fixed part] + [barcode head]',
      [aceitasEnt.length, toquesEnt.length, /parte fixa/.test(toquesEnt[0] || '')], [0, 1, false]);
    // The same, finished by retyping the digit: the scan it always was.
    escanearSemEnter(lidaSob);
    teclaEnt('Backspace');
    teclaEnt(lidaSob[43]);
    teclaEnt('Enter');
    ok('...while retyping the digit sends the scanned key',
      [aceitasEnt.length, aceitasEnt[0] && aceitasEnt[0].chave], [1, lidaSob]);
    // The live verdict judges the same thing. Under a fixed part that fixes
    // only the state, [fixed part] + [barcode head] puts `41` where the year
    // goes, so a perfectly good scan being corrected was told to check its
    // digits.
    await escreverEnt((c) => ({
      partesFixas: c.partesFixas.concat([{ id: 'k3', nome: 'Estado', template: NFPR.ParteFixa.completar('41'), usadaEm: 7 }]),
      parteFixaAtivaId: 'k3'
    }));
    // The line keeps its last text when it hides, so what counts is whether
    // it is showing a red verdict now.
    const msgEnt = doEnt((e) => e.className === 'nfpr-strip-status-msg');
    const linhaEnt = doEnt((e) => e.tagName === 'P' && /^nfpr-strip-status/.test(e.className));
    escanearSemEnter(chaveNova('000005555'));
    teclaEnt('Backspace');
    ok('...and the live verdict judges the scan being corrected, not a composition of it',
      !linhaEnt.atributos.hidden && msgEnt.textContent === 'Confira a chave de acesso.', false);
    teclaEnt('Escape');
    // With no fixed part, a QR code whose last digit was misread, corrected by
    // hand. The corrected key is the one sent.
    await escreverEnt({ parteFixaAtivaId: null });
    aceitasEnt = [];
    toquesEnt.length = 0;
    const certa = chaveNova('000006666');
    const lidaErrada = certa.slice(0, 43) + (certa[43] === '9' ? '8' : '9');
    escanearSemEnter(qrDe(lidaErrada));
    teclaEnt('Backspace');
    teclaEnt(certa[43]);
    teclaEnt('Enter');
    ok('a QR scan corrected by hand sends the corrected key, not the one still in the url',
      [aceitasEnt.length, aceitasEnt[0] && aceitasEnt[0].chave, toquesEnt.length], [1, certa, 0]);
    uiEnt.mostrarErro = mostrarErroEnt;

    // --- controls that hide themselves -------------------------------------------
    // Nearly every button on a bar is answered by the bar going away. Pressed
    // from the keyboard, each one left it on an element that no longer exists,
    // and the next Tab started at the top of the government page.
    const pressionar = async (botao) => {
      botao.focus();
      clique(botao);
      await pausa(20);
    };
    // The strip's own way out, hidden by the config change its click makes.
    await escreverEnt({ parteFixaAtivaId: 'k1' });
    const limparEnt = doEnt((e) => e.className === 'nfpr-strip-limpar');
    await pressionar(limparEnt);
    ok('"Digitar a chave inteira" on the strip hands the keyboard to the entry as it goes',
      [!!limparEnt.atributos.hidden, foco.el === proxyEnt], [true, true]);
    // The stale-fixed-part bar's second button.
    const molVelho = NFPR.ParteFixa.completar(chaveCom({ aa: '20', mm: '01' }).slice(0, 22));
    await escreverEnt((c) => ({
      partesFixas: c.partesFixas.concat([{ id: 'k2', nome: 'Velha', template: molVelho, usadaEm: 6 }]),
      parteFixaAtivaId: 'k2'
    }));
    const barraVencida = doEnt((e) => e.className === 'nfpr-parte-fixa-vencida-bar');
    const sairVencida = doEnt((e) => e.className === 'nfpr-parte-fixa-vencida-acao');
    const vencidaNaTela = !barraVencida.atributos.hidden;
    await pressionar(sairVencida);
    ok('...so does the one on the stale-fixed-part bar',
      [vencidaNaTela, !!barraVencida.atributos.hidden, foco.el === proxyEnt], [true, true, true]);
    // The scan-under-a-fixed-part bar's. A key this registrar has not seen, so
    // de-dup does not answer first.
    await escreverEnt({ parteFixaAtivaId: 'k1' });
    const baseIgn = notaDeHoje.slice(0, 25) + '000008888' + notaDeHoje.slice(34, 43);
    const chaveIgn = baseIgn + Chave.calcularCDV(baseIgn + '0');
    teclaEnt(chaveIgn[0]);
    for (const ch of chaveIgn.slice(1)) teclaEnt(ch, 0);
    teclaEnt('Enter', 0);
    const barraIgn = doEnt((e) => e.className === 'nfpr-parte-fixa-ignorada-bar');
    const ignNaTela = !barraIgn.atributos.hidden;
    await pressionar(doEnt((e) => e.className === 'nfpr-parte-fixa-ignorada-acao'));
    ok('...and the one on the scan-under-a-fixed-part bar',
      [ignNaTela, !!barraIgn.atributos.hidden, foco.el === proxyEnt], [true, true, true]);
    // The status line's offer. Driven through the strip's own surface: the
    // offer's conditions (typing by hand, fixed parts off, no recent answer)
    // are pinned in their own checkpoint, and this is about where the keyboard
    // goes when the answer takes the line away.
    const dicaEnt = { texto: 'x', rotulo: 'Ativar', aoClicar: noop, rotuloDispensar: 'Não mostrar', aoDispensar: noop };
    uiEnt.setStatusDica(dicaEnt);
    doEnt((e) => /nfpr-strip-status-dispensar/.test(e.className)).focus();
    uiEnt.setStatusDica(null);
    ok('"Não mostrar" going with the offer hands the keyboard to the entry', foco.el === proxyEnt, true);
    uiEnt.setStatusDica(dicaEnt);
    doEnt((e) => e.className === 'nfpr-strip-status-acao').focus();
    uiEnt.setStatusDica(null);
    ok('...and so does "Ativar"', foco.el === proxyEnt, true);
    // The refused-entity bar (cleared by content.js once its notes are moved)
    // and the debug banner (cleared by its own "Voltar à segurança").
    uiEnt.setEntidadeRecusada({ mensagem: 'x', rotulo: 'Enviar para OUTRA', aoClicar: noop });
    doEnt((e) => e.className === 'nfpr-entidade-cond-acao').focus();
    uiEnt.setEntidadeRecusada(null);
    ok('the refused-entity bar going away hands the keyboard to the entry', foco.el === proxyEnt, true);
    uiEnt.setDebug(true, [], noop);
    doEnt((e) => e.className === 'nfpr-debug-acao').focus();
    uiEnt.setDebug(false, []);
    ok('...and so does the debug banner', foco.el === proxyEnt, true);

    // --- the keyboard never rests on nothing ---------------------------------
    // An on-screen keyboard sends its keys only while a field has focus; with
    // focus on the bare page it sends nothing at all (recorded 2026-10-07).
    // A click on anything that is not a control drops focus there, so the
    // entry takes it back — and only then.
    const devolverEnt = ouvintes.click.filter((f) => f.name === 'devolverTeclado').pop();
    const aoVoltarEnt = (janelaOuvintes.focus || []).filter((f) => f.name === 'devolverTeclado').pop();
    foco.el = documentoStub.body;
    devolverEnt({});
    ok('a click that leaves the keyboard on the page hands it to the entry',
      foco.el === proxyEnt, true);
    foco.el = documentoStub.body;
    aoVoltarEnt({});
    ok('...and so does the window coming back with the keyboard on nothing',
      foco.el === proxyEnt, true);
    // A control that took the click keeps the keyboard.
    const controleEnt = elemento('button');
    foco.el = controleEnt;
    devolverEnt({});
    ok('a click that put the keyboard on a control leaves it there', foco.el === controleEnt, true);
    // Dragging across a key on a row is how one is copied, and focusing an
    // input collapses the selection.
    foco.el = documentoStub.body;
    documentoStub.getSelection = () => ({ toString: () => '4126 1011' });
    devolverEnt({});
    ok('...and a click that ends a text selection takes nothing', foco.el === documentoStub.body, true);
    delete documentoStub.getSelection;
    // The settings overlay keeps the keyboard inside itself.
    uiEnt.abrir('config');
    foco.el = documentoStub.body;
    devolverEnt({});
    const comModalAberto = foco.el === documentoStub.body;
    uiEnt.fechar();
    ok('...nor does one made while the settings overlay is open', comModalAberto, true);
    // Only a keyboard that was IN the thing. One anywhere else — the settings
    // overlay, most often — is left exactly where it is.
    const alheio = elemento('button');
    uiEnt.setEntidadeRecusada({ mensagem: 'x', rotulo: 'y', aoClicar: noop });
    alheio.focus();
    uiEnt.setEntidadeRecusada(null);
    ok('a bar going away leaves a keyboard that was elsewhere alone', foco.el === alheio, true);

    // --- adding an entity, with Enter pressed twice ---------------------------------
    // The button is disabled during the registry lookup, the field's Enter was
    // not. The second call read the label back as "Verificando…" — so that is
    // what it restored, for the life of the form — and saved the same CNPJ
    // again, which the first call had just added: a successful add ended in
    // red with "Esta entidade já está cadastrada."
    let cnpjNovo = null;
    for (let dv = 0; dv < 100 && !cnpjNovo; dv += 1) {
      const c = '12345678000' + '1' + String(dv).padStart(2, '0');
      if (NFPR.Cnpj.validar(c)) cnpjNovo = c;
    }
    const fetchCompartilhado = sandbox.fetch;
    const consultasPendentes = [];
    sandbox.fetch = () => new Promise((r) => consultasPendentes.push(() => r({
      ok: true, status: 200, redirected: false, type: 'basic', url: '',
      json: () => Promise.resolve({ idEntidade: 9, nmEmpresarial: 'ASSOCIACAO NOVA', nmMunicipio: 'CURITIBA' })
    })));
    const marcaSec = criados.length;
    NFPR.secaoEntidades({});
    const doSec = (sel) => criados.slice(marcaSec).find(sel);
    const campoSec = doSec((e) => e.placeholder === '00.000.000/0000-00');
    const botaoSec = doSec((e) => e.tagName === 'BUTTON' && e.textContent === 'Adicionar entidade');
    const ajudaSec = doSec((e) => e.tagName === 'P' && /^nfpr-help/.test(e.className));
    campoSec.value = NFPR.Cnpj.formatar(cnpjNovo);
    const enterSec = () => {
      for (const fn of campoSec.escutas.keydown || []) fn({ key: 'Enter', preventDefault: noop });
    };
    enterSec();
    await pausa(5);
    enterSec();
    await pausa(5);
    const consultasFeitas = consultasPendentes.length;
    consultasPendentes.forEach((soltar) => soltar());
    await pausa(40);
    sandbox.fetch = fetchCompartilhado;
    const cfgSec = await NFPR.Config.obterConfig();
    ok('Enter twice while an entity is being verified asks and saves once',
      [consultasFeitas, cfgSec.entidades.filter((e) => e.cnpj === cnpjNovo).length], [1, 1]);
    ok('...and the form comes back as it was, saying nothing about a duplicate',
      [botaoSec.textContent, botaoSec.disabled, /já está cadastrada/.test(ajudaSec.textContent)],
      ['Adicionar entidade', false, false]);

    sandbox.chrome.storage.local.set = setCompartilhado;
    marco('a half-typed entry survives what does not change it, a vanishing control hands the keyboard on, and an entity is added once');

    // --- the volunteer's own bypass ------------------------------------------
    // "Enviar tudo, mesmo com erro": no local gate at all. The verdict still
    // runs and still speaks, but it stops deciding whether to send and starts
    // deciding which CUE plays and what the row says — so the two branches
    // pinned above (red toast + nothing queued, grey row + nothing queued) must
    // both invert, and the note must reach the queue carrying its reading.
    //
    // This half had no coverage of any kind and is the half whose failure is
    // invisible: a note the volunteer chose to send, refused locally anyway,
    // looks exactly like one they mistyped.
    await NFPR.Config.atualizarConfig({
      parteFixaAtivaId: null, // the fixed part has done its job above; judge whole keys now
      preferencias: { enviarSemValidar: true }
    });
    const baseBypass = await NFPR.UI.montar({ modoOffline: true, montarEm: elemento() });
    let eventosBypass = [];
    const uiBypass = Object.assign({}, baseBypass);
    ['mostrarErro', 'adicionarItem', 'atualizarItem'].forEach(function (m) {
      uiBypass[m] = function () {
        eventosBypass.push([m].concat(Array.prototype.slice.call(arguments)));
        return baseBypass[m].apply(baseBypass, arguments);
      };
    });
    let aceitasBypass = [];
    await NFPR.Registrador.iniciar({
      ui: uiBypass,
      msgDuplicada: 'Esta nota já foi lida recentemente.',
      aoAceitarChave(info) { aceitasBypass.push(info); }
    });
    const teclarNoBypass = (texto) => {
      eventosBypass = [];
      aceitasBypass = [];
      sons = [];
      const fn = ouvintes.keydown[ouvintes.keydown.length - 1];
      for (const ch of texto) fn({ key: ch, preventDefault: noop, stopPropagation: noop });
      fn({ key: 'Enter', preventDefault: noop, stopPropagation: noop });
    };
    const chamadasBypass = (m) => eventosBypass.filter((e) => e[0] === m);

    // A key our own table calls RED. With the bypass on there is no toast and
    // no refusal: it gets a row, it is queued, and the row carries the reading.
    const ruim = notaDeHoje.slice(0, 43) + (notaDeHoje[43] === '7' ? '6' : '7');
    ok('a red key really was red', Chave.avaliar(ruim, agoraReg).gravidade, 'entrada');
    teclarNoBypass(ruim);
    ok('the bypass sends a red key instead of refusing it',
      [chamadasBypass('mostrarErro').length, chamadasBypass('adicionarItem').length,
       aceitasBypass.length, aceitasBypass[0] && aceitasBypass[0].chave,
       !!(aceitasBypass[0] && aceitasBypass[0].semValidacao)],
      [0, 1, 1, ruim, true]);
    // The marker is what stops a forced send reading as an ordinary one, so it
    // rides on the row from the first paint.
    ok('a bypassed row carries the local reading as a marker',
      (chamadasBypass('adicionarItem')[0] || [])[3].semValidacao,
      Chave.avaliar(ruim, agoraReg).mensagem);
    // aviso, NOT erro. erro belongs on a refusal coming back from the server,
    // and nothing has asked the server anything yet.
    ok('a bypassed key warns rather than buzzing', sons, ['aviso']);
    ok('...and its queue write reports the key as newly added',
      await aceitasBypass[0].gravacao, true);

    // Grey behaves the same way, and this is the half that costs a real
    // donation when it is wrong: an eligibility verdict is our reading of the
    // programme's rules, and the volunteer switched this on to have the SITE
    // answer that instead.
    const velha = chaveCom({ aa: '20', mm: '01' });
    teclarNoBypass(velha);
    ok('the bypass sends an ineligible note instead of stopping at a grey row',
      [aceitasBypass.length, aceitasBypass[0] && aceitasBypass[0].chave,
       !!(aceitasBypass[0] && aceitasBypass[0].semValidacao)],
      [1, velha, true]);
    await aceitasBypass[0].gravacao;

    // A key that passes on its own merits carries NOTHING, whatever the
    // preference says. The flag means "this bypassed a gate", never "the toggle
    // was on" — get that wrong and every ordinary note is marked as forced.
    // Deliberately a key NEITHER earlier block has queued: notaDeHoje2 is
    // already in nfpr:fila from case 1, and adicionarNaFila no-ops on a key it
    // already holds — so reusing it would let the storage assertion below pass
    // against a pre-existing entry that never went through this path at all.
    const base43Limpa = notaDeHoje.slice(0, 25) + '000009999' + notaDeHoje.slice(34, 43);
    const limpa = base43Limpa + Chave.calcularCDV(base43Limpa + '0');
    ok('the clean fixture really is donatable', Chave.avaliar(limpa, agoraReg).ok, true);
    teclarNoBypass(limpa);
    ok('a clean key under the bypass is unmarked and plays the read cue',
      [aceitasBypass.length, aceitasBypass[0] && aceitasBypass[0].semValidacao,
       (chamadasBypass('adicionarItem')[0] || [])[3].semValidacao, sons.join()],
      [1, null, null, 'leitura']);
    await aceitasBypass[0].gravacao;

    // THE FROZEN FLAG, in storage. This is what makes the feature survive a
    // reload: content.js reads it off the queue entry to skip its drain-time
    // re-judge, so without it the whole batch is destroyed on the next load.
    const filaBypass = await NFPR.Config.obterFila();
    const entradaRuim = filaBypass.find((e) => e.chave === ruim);
    const entradaLimpa = filaBypass.find((e) => e.chave === limpa);
    ok('nfpr:fila freezes the bypass on the note, and only on the notes it carried',
      [!!entradaRuim, entradaRuim && entradaRuim.semValidacao === Chave.avaliar(ruim, agoraReg).mensagem,
       !!entradaLimpa, entradaLimpa && entradaLimpa.semValidacao],
      [true, true, true, null]);

    // THE THIRD LOCAL REFUSAL, and the one the preference treats differently
    // from red and grey: de-dup still RUNS and still speaks, it just stops
    // refusing. A repeat is sent, and the row says it is a repeat — the check
    // is not a verdict on the digits, it is the only thing that can tell a
    // volunteer they are holding two copies of one receipt. `limpa` is already
    // in `registradas` from the block above, so this is the branch that would
    // otherwise catch it.
    teclarNoBypass(limpa);
    ok('the bypass sends a repeat instead of refusing it, and says it is a repeat',
      [aceitasBypass.length, aceitasBypass[0] && aceitasBypass[0].chave,
       (chamadasBypass('adicionarItem')[0] || [])[3].duplicada,
       ((chamadasBypass('atualizarItem')[0] || [])[2] || {}).estado, sons.join()],
      [1, limpa, 'Esta nota já foi lida recentemente.', undefined, 'aviso']);
    // `limpa` passes on its own merits, so this row carries the repeat marker
    // and NOT the bypass marker. The two say different things — "you already
    // scanned this" against "we would have refused this" — and a row that wore
    // both here would be claiming a verdict that never happened.
    ok('a repeat that passes on its own merits wears only the repeat marker',
      [(chamadasBypass('adicionarItem')[0] || [])[3].semValidacao,
       aceitasBypass[0] && aceitasBypass[0].semValidacao],
      [null, null]);
    // The queue keeps its first entry, and the write SAYS so. The offline page
    // counts only what was added; counting every successful write reported a
    // note more than was saved each time the bypass let a repeat through.
    ok('...and its queue write reports that nothing new was stored',
      await aceitasBypass[0].gravacao, false);

    await NFPR.Config.atualizarConfig({ preferencias: { enviarSemValidar: false } });
    marco('the bypass preference turns every verdict into advice, frozen on the note');

    // --- session verdicts ----------------------------------------------------
    // A duplicate session must never be reported as an expired one: the login
    // link is precisely the wrong advice, since logging in again is what
    // created the second session.
    const erroDe = async () => {
      try {
        await NFPR.Donation.doar('4'.repeat(44), '11222333000181');
        return { codigo: '(no error)' };
      } catch (e) {
        return e;
      }
    };
    const respostaDeLogin = {
      ok: true, status: 200, redirected: true, type: 'basic',
      url: 'https://notaparana.pr.gov.br/nfprweb/publico/login',
      ...corpoDe('<html><body></body></html>')
    };
    sandbox.fetch = () => Promise.resolve(respostaDeLogin);

    NFPR.Donation.setSessaoDuplicada(false);
    const semDuplicada = await erroDe();
    ok('login redirect alone is an expired session', semDuplicada.codigo, 'SESSAO');

    // The page IS the duplicate-session screen: the server answers our token
    // request with a bare login redirect that says nothing about it, so only
    // the latch can keep the verdict honest.
    NFPR.Donation.setSessaoDuplicada(true);
    const comDuplicada = await erroDe();
    ok('duplicate-session page: login redirect keeps the real reason',
      [comDuplicada.codigo, comDuplicada.link && comDuplicada.link.href],
      ['SESSAO_DUPLICADA', NFPR.Site.URL_SAIR]);
    NFPR.Donation.setSessaoDuplicada(false);

    // Same verdict from the other direction: no latch, but the token page
    // itself comes back carrying the sentence (a duplicate raised mid-batch).
    documentoStub.body.textContent = 'O usuário autenticado possui mais de uma sessão ativa';
    sandbox.fetch = () => Promise.resolve({
      ok: true, status: 200, redirected: false, type: 'basic',
      url: NFPR.Site.URL_DOACAO, ...corpoDe('<html></html>')
    });
    const sentencaNoCorpo = await erroDe();
    documentoStub.body.textContent = '';
    ok('sentence in the token page is a duplicate session, not an expired one',
      sentencaNoCorpo.codigo, 'SESSAO_DUPLICADA');

    // --- which answers are worth another attempt -----------------------------
    // The retry budget itself lives in content.js, which this script cannot
    // load (it starts sending on import). What IS testable here is the half
    // that decides whether a retry happens at all: `recuperavel`, which is set
    // on EVERYTHING except the five answers donation.js can actually read.
    // `chave` is optional and matters to exactly one branch — the invalid-key
    // refusal, which reads it to tell an alphanumeric issuer apart from a
    // numeric one. Everything else here judges the ANSWER.
    const respostaDoar = (corpo, chave) => {
      documentoStub.querySelector = () => ({ value: 'tok' }); // the form token
      sandbox.fetch = (u) => Promise.resolve({
        ok: true, status: 200, redirected: false, type: 'basic', url: String(u),
        ...corpoDe('<html></html>'),
        json: () => Promise.resolve(corpo)
      });
      return NFPR.Donation.doar(chave || '4'.repeat(44), '11222333000181');
    };

    // Unrecognised answers are retried, whichever field they arrive in — none
    // of these sentences are specially matched, they are just examples of text
    // this code has never been taught to read. All of them land as `erro`,
    // carrying the site's own sentence when it sent one, relayed as-is rather
    // than replaced with something invented.
    const semelhanca = 'Uma frase que este código nunca viu.';
    const rMensagem = await respostaDoar({ mensagem: semelhanca });
    ok('an unfamiliar mensagem is retried, relayed as-is',
      [rMensagem.estado, rMensagem.mensagem, rMensagem.recuperavel],
      ['erro', semelhanca, true]);
    const rChave = await respostaDoar({ chaveAcesso: semelhanca });
    ok('...and an unfamiliar chaveAcesso rejection likewise',
      [rChave.estado, rChave.recuperavel], ['erro', true]);
    const rErro = await respostaDoar({ erro: semelhanca });
    ok('...and a generic erro field likewise', [rErro.estado, rErro.recuperavel], ['erro', true]);

    // The two bodies with nothing to relay get this code's own wording instead
    // of inventing detail the site never gave it.
    const rVazio = await respostaDoar({ algoNovo: 'x' });
    ok('a body with no field we know is retried, with our own wording',
      [rVazio.estado, rVazio.recuperavel], ['erro', true]);
    if (!/sem informar o resultado/i.test(rVazio.mensagem)) {
      console.error('a fieldless body should say the site gave no detail, got: ' + rVazio.mensagem);
      process.exit(1);
    }

    // The six we CAN read stay terminal: retrying them is pointless.
    const rSucesso = await respostaDoar({ mensagem: 'Registrada com sucesso.' });
    ok('success is terminal', [rSucesso.estado, rSucesso.recuperavel], ['sucesso', undefined]);
    const rPrazo = await respostaDoar({ chaveAcesso: 'Fora do prazo para doar.' });
    ok('the donation deadline is terminal — waiting cannot un-expire it',
      [rPrazo.estado, rPrazo.recuperavel], ['inelegivel', undefined]);
    // Grey, not red: a CT-e is a real document, so nothing was mistyped. The
    // note simply cannot be donated on this page.
    const rTipoDoc = await respostaDoar({ chaveAcesso: 'Tipo de documento inválido.' });
    ok('an invalid document type is terminal, and it is not a typo',
      [rTipoDoc.estado, rTipoDoc.recuperavel], ['inelegivel', undefined]);
    // cUF is not 41. Decided ahead of the date and the document type — a key
    // wrong on all three comes back with THIS, not with either of those. Grey and terminal for the same reason as the two above: a note
    // from another state is a genuine note, and retrying cannot move the shop.
    const rOutroEstado = await respostaDoar({
      chaveAcesso: 'Esta nota não pode ser doada. Motivo: Estabelecimento emitente não está localizado no Estado do Paraná.'
    });
    ok('an issuer outside Paraná is terminal, and it is not a typo',
      [rOutroEstado.estado, rOutroEstado.recuperavel], ['inelegivel', undefined]);
    // The half that keeps it OFF the failures list: `reconhecida` is what tells
    // content.js this answer was read rather than relayed. Without it the note
    // burns the whole retry budget and is then filed as unexplained — on an
    // answer that explains itself completely.
    ok('...and it is READ, so it never reaches "erros desconhecidos"',
      rOutroEstado.reconhecida, true);
    // It opens with the same "Esta nota não pode ser doada. Motivo:" as
    // "Procedimento inválido", which is retried and never deleted — matching
    // that prefix would delete every refused request. Guarded further down, by
    // the PROCEDIMENTO_INVALIDO assertion: it now runs past this branch too.
    const rChaveInv = await respostaDoar({ chaveAcesso: 'Chave de acesso inválida.' });
    ok('an invalid access key is terminal — the key itself, not the attempt',
      [rChaveInv.estado, rChaveInv.recuperavel], ['erro', undefined]);
    // Terminal AND deleted AND unlisted: re-reading the paper yields the same
    // digits and the same refusal. See the note further down.
    ok('...so retrying it is pointless, not merely discouraged',
      rChaveInv.recuperavel, undefined);
    const rCnpj = await respostaDoar({ cnpjEntidade: 'Entidade não cadastrada.' });
    ok('an unregistered entity is terminal — it is the config, not the note',
      [rCnpj.estado, rCnpj.recuperavel], ['erro', undefined]);
    // It carries a CODE, so content.js can latch it instead of matching the
    // government's wording. Without this the refusal is indistinguishable from
    // any other terminal error and every note aimed at that entity is deleted
    // from the durable queue one at a time.
    ok('an unregistered entity is named, not just described',
      rCnpj.codigo, 'ENTIDADE_RECUSADA');

    // --- the shrug, and why the HTTP STATUS must not decide ------------------
    // The government's catch-all failure is HTTP 500 WITH a JSON body, and
    // SERVIDOR is an outage code that latches the connectivity watchdog and
    // parks the whole queue. If donation.js judged the status before reading
    // the body, ONE impossible note would fake a site-wide outage.
    //
    // It does not: the only status>=500 check on the POST path lives inside the
    // catch of resp.json(), so it fires only when there is nothing to read.
    // This asserts that ordering, because it is invisible in the source — it
    // rests on WHERE a check sits, and any tidy-up that hoists it breaks it.
    const CORPO_SHRUG = { erro: 'A aplicação retornou que não foi possível concluir a ação solicitada.' };
    const respostaComStatus = (status, corpo, ilegivel) => {
      documentoStub.querySelector = () => ({ value: 'tok' });
      sandbox.fetch = (u, o) => Promise.resolve(
        o && o.method === 'POST'
          ? { ok: false, status, redirected: false, type: 'basic', url: String(u),
              json: () => ilegivel ? Promise.reject(new Error('nao e json')) : Promise.resolve(corpo) }
          : { ok: true, status: 200, redirected: false, type: 'basic', url: String(u),
              ...corpoDe('<html></html>') }
      );
      return NFPR.Donation.doar('4'.repeat(44), '11222333000181');
    };
    const r500 = await respostaComStatus(500, CORPO_SHRUG, false);
    ok('a 500 carrying a readable body is judged by the BODY, not the status',
      [r500.estado, r500.codigo, r500.recuperavel], ['erro', 'SEM_DIAGNOSTICO', true]);
    // The sentence IS relayed, verbatim. It used to be replaced with our own
    // wording, because repeating it would claim a diagnosis that does not exist
    // — the same words answer three unrelated causes. What changed is that the
    // row now carries a muted [nfprweb] in front of it, so the sentence is
    // plainly the site's rather than ours, which was the entire objection.
    ok('the shrug is relayed in the words the site sent',
      r500.mensagem, CORPO_SHRUG.erro);
    ok('...and still carries its provenance, so it cannot read as our verdict',
      r500.fonte, 'nfprweb');
    // The field is matched on TRUTHINESS, so it need not be a string. Relaying
    // a bare `true` to a volunteer would be worse than saying nothing was said.
    const rShrugVazio = await respostaComStatus(500, { erro: true }, false);
    ok('a shrug with nothing readable in the field falls back to our wording',
      rShrugVazio.mensagem, NFPR.Donation.MSG_SEM_DIAGNOSTICO);
    // A 500 we cannot read IS the server struggling — that one still throws,
    // and it parks notes through the connectivity latch without deleting any.
    let cod500 = null;
    try { await respostaComStatus(500, null, true); } catch (e) { cod500 = e.codigo; }
    ok('a 500 with no readable body is still a real outage', cod500, 'SERVIDOR');
    // Same code by a different door: nothing recognisable to act on.
    const rNada = await respostaDoar({ algoDesconhecido: 1 });
    ok('a body with no field we know is the same condition as the shrug',
      rNada.codigo, 'SEM_DIAGNOSTICO');

    // --- which answers this code has a POLICY for ----------------------------
    // `reconhecida` marks the branches that matched a sentence or a field, and
    // reading one is exactly what lets the orchestrator pick a plan: finish the
    // matter, or keep the note in nfpr:fila behind a bar. Its one consumer is
    // the panel's "erros desconhecidos" list, which collects the residue —
    // notes destroyed with nothing holding them, where the volunteer is the
    // only actor left. Set HERE rather than guessed at the panel, because only
    // this table knows whether a message was READ or merely RELAYED, and the
    // two look identical by the time a row renders them.
    //
    // The pair below is the one worth reading twice: an invalid access key is
    // recognised AND terminal AND deleted, which looks like a hole in the rule
    // and is not. A corrupted read cannot produce that answer — the key layout
    // and its módulo-11 check digit are fixed by federal law, so our test and
    // the site's cannot disagree, and ours is otherwise the stricter. A
    // mis-scan either fails our net first or comes back `sucesso`. The digits
    // here are self-consistent and deterministically refused, so re-reading the
    // paper changes nothing and there is nowhere to send anyone.
    for (const [nome, r] of [['success', rSucesso], ['the deadline', rPrazo],
                             ['an invalid document type', rTipoDoc],
                             ['an invalid access key', rChaveInv],
                             ['an unregistered entity', rCnpj]]) {
      ok(nome + ' is an answer this code can explain', r.reconhecida, true);
    }
    // Letters change none of it: the server validates alphanumeric keys, so
    // the same refusal on one is just as final and is NOT retried.
    const rChaveInvAlfa = await respostaDoar(
      { chaveAcesso: 'Chave de acesso inválida.' },
      '41260912ABC34501DE35650010000123451123456785'
    );
    ok('the same refusal on a key carrying letters is explained and terminal',
      [rChaveInvAlfa.estado, rChaveInvAlfa.reconhecida, rChaveInvAlfa.recuperavel],
      ['erro', true, undefined]);

    // ...and the ones it cannot. Nothing marks these, which is the whole point:
    // the note goes to the volunteer with its digits, because the row cannot
    // tell them what happened to it.
    const rSentenca = await respostaDoar({ chaveAcesso: 'Alguma recusa que nunca vimos.' });
    ok('a rejection sentence we have never seen is NOT explained',
      [rSentenca.estado, rSentenca.reconhecida], ['erro', undefined]);
    const rMsg = await respostaDoar({ mensagem: 'Algo aconteceu.' });
    ok('...nor is an unrecognised mensagem', rMsg.reconhecida, undefined);
    ok('...nor the shrug, which is the definition of unexplained',
      r500.reconhecida, undefined);
    ok('...nor a body with no field we know', rNada.reconhecida, undefined);

    // --- a request refused ABOVE the note ------------------------------------
    // "Procedimento inválido" arrives on chaveAcesso, like a verdict on the
    // key. Every other sentence in that field proves the engine read our 44
    // digits; this one proves only that the request was thrown out before it
    // ever got there. A stale form token produces it, and so does a malformed
    // `documentoComChaveAcesso`, so the code is named after
    // the ANSWER, the list of triggers not being known to be complete.
    const PROC_INVALIDO = 'Esta nota não pode ser doada. Motivo: Procedimento inválido.';
    const rProc = await respostaDoar({ chaveAcesso: PROC_INVALIDO });
    ok('a request refused above the note is retryable, and named for the answer',
      [rProc.estado, rProc.codigo, rProc.recuperavel], ['erro', 'PROCEDIMENTO_INVALIDO', true]);

    // --- the health probe -----------------------------------------------------
    // A POST GUARANTEED TO BE REFUSED IS NOT A DONATION CLAIM. Everything below
    // is about keeping that guarantee true.
    const SONDA = NFPR.Donation.CHAVE_SONDA;
    // The `41` is not decoration: the cUF is the FIRST field the engine decides
    // (a key wrong in every field is answered by naming only the state, ahead
    // of the date and the model). A probe key from another state would be refused at
    // gate one, read as healthy all the same, and prove only that two digits
    // were parsed. The probe is worth having for the DEPTH of the refusal.
    ok('the probe key is structurally sound, so only the DEADLINE refuses it',
      [SONDA.length, SONDA.slice(0, 2), SONDA.slice(20, 22),
       String(NFPR.Chave.calcularCDV(SONDA.slice(0, 43)))],
      [44, '41', '65', SONDA[43]]);
    ok('the probe key is a quarter-century past its deadline', SONDA.slice(2, 6), '0101');
    // Belt and braces: the CNPJ is the net under the deadline check. It must
    // never be empty or missing — both are observed to produce the shrug, and a
    // probe that shrugs at itself reports "not healthy" for ever, silently
    // killing the reaper. Not '0' either, in case the stack reads zero as absent.
    ok('the probe CNPJ is present and not zero',
      [!!NFPR.Donation.CNPJ_SONDA, NFPR.Donation.CNPJ_SONDA !== '0',
       Number(NFPR.Donation.CNPJ_SONDA) > 0], [true, true, true]);
    // OUR OWN validator refuses this key, so it can never be mistaken for a
    // scanned note: if it ever reached the scan path it would be stopped before
    // leaving the machine.
    ok('our own checks call the probe key red, so it can never be scanned in',
      NFPR.Chave.avaliar(SONDA, { ano: 2026, mes: 8 }).gravidade, 'entrada');

    const sondaCom = (corpo, ilegivel) => {
      documentoStub.querySelector = () => ({ value: 'tok' });
      sandbox.fetch = (u, o) => Promise.resolve(
        o && o.method === 'POST'
          ? { ok: false, status: 400, redirected: false, type: 'basic', url: String(u),
              json: () => ilegivel ? Promise.reject(new Error('nao e json')) : Promise.resolve(corpo) }
          : { ok: true, status: 200, redirected: false, type: 'basic', url: String(u),
              ...corpoDe('<html></html>') }
      );
      return NFPR.Donation.sondarSaude();
    };
    // A specific refusal on EITHER field proves validation ran. Matched on the
    // field, never the sentence: which of the two answers wins is the engine's
    // business, and hanging a data-loss guard off government wording is the
    // thing ENTIDADE_RECUSADA already exists to avoid.
    // The probe's healthy answer as the live server gives it, verbatim — an
    // HTTP 400 (sondaCom's POST status) carrying this one field.
    ok('the expected deadline refusal reads as healthy',
      await sondaCom({ chaveAcesso: 'O prazo para doar esta nota expirou. A doação deve ocorrer no ' +
        'máximo até o mês seguinte a data de emissão da nota.' }), 'saudavel');
    ok('the CNPJ refusal underneath it reads as healthy too',
      await sondaCom({ cnpjEntidade: 'Não existem dados para o CNPJ informado.' }), 'saudavel');
    // EVERY failure mode answers 'confuso'. The only thing a probe licenses is
    // deleting a note that ran out of retries, so the fail-safe answer is
    // always "don't".
    ok('the shrug reads as confused', await sondaCom(CORPO_SHRUG), 'confuso');
    // THE TRAP, and it is about the probe's OWN token. "Procedimento inválido"
    // arrives on chaveAcesso, so a probe that merely asks "is there a
    // chaveAcesso field?" reads its own refused token as a validator answering
    // and reports HEALTHY — licensing deletion at the exact moment nothing is
    // getting through and not one queued note is at fault.
    ok('a request refused above the note never reads as healthy',
      await sondaCom({ chaveAcesso: PROC_INVALIDO }), 'confuso');
    ok('an unreadable answer reads as confused', await sondaCom(null, true), 'confuso');
    ok('a body with nothing we know reads as confused', await sondaCom({ x: 1 }), 'confuso');
    // A `mensagem` is NEVER healthy. Any sentence there proves nothing, and
    // reading one as healthy licensed the reaper to delete shrugging notes in
    // the middle of an incident. Not even an acceptance: the probe is built to
    // be refused, so "sucesso" on it means the probe or the server is broken.
    ok('a mensagem on the probe reads as confused',
      await sondaCom({ mensagem: 'Erro ao processar' }), 'confuso');
    ok('...and so does an acceptance, which the probe must never get',
      await sondaCom({ mensagem: 'Documento fiscal doado com sucesso!' }), 'confuso');
    sandbox.fetch = () => Promise.reject(new Error('rede caiu'));
    ok('a probe that cannot leave the machine reads as confused',
      await NFPR.Donation.sondarSaude(), 'confuso');
    // THE ONE FAILURE THE PROBE DOES NOT SWALLOW. While the confused-server
    // latch holds, the probe is the only thing still talking to the site — the
    // pool is paused — so a login that dies mid-incident is found here or
    // nowhere. It used to answer 'confuso' like everything else, and the bar
    // went on promising an automatic resumption that could never come. It
    // rejects with the session error instead; a rejection licenses deleting
    // nothing either, so the fail-safe is intact. (This assertion used to say
    // "reads as confused" and passed only because the fetch before it was still
    // rejecting, so the missing token was never reached.)
    const rejeicaoDe = async (p) => {
      try {
        return { resolveu: await p };
      } catch (e) {
        return e;
      }
    };
    documentoStub.querySelector = () => null;
    sandbox.fetch = (u) => Promise.resolve({
      ok: true, status: 200, redirected: false, type: 'basic', url: String(u), ...corpoDe('<html></html>')
    });
    ok('a probe whose own token fetch finds no login reports the session, not confusion',
      (await rejeicaoDe(NFPR.Donation.sondarSaude())).codigo, 'SESSAO');
    sandbox.fetch = (u, o) => (o && o.redirect === 'manual'
      ? Promise.resolve({ type: 'opaqueredirect', status: 0 })
      : Promise.reject(new TypeError('Failed to fetch')));
    ok('...and so does one bounced to the identity provider',
      (await rejeicaoDe(NFPR.Donation.sondarSaude())).codigo, 'SESSAO');

    // --- the token is fetched AFTER the note is judged ------------------------
    // Not before, and never held: a token warmed early goes stale across a
    // bathroom break, and the only reason it cannot today is that doar() fetches
    // one immediately before the POST. Loading the module must request nothing
    // at all, and the GET must come first and exactly once.
    const ordem = [];
    documentoStub.querySelector = () => ({ value: 'tok' });
    sandbox.fetch = (u, o) => {
      ordem.push(o && o.method === 'POST' ? 'POST' : 'GET');
      return Promise.resolve({
        ok: true, status: 200, redirected: false, type: 'basic', url: String(u),
        ...corpoDe('<html></html>'),
        json: () => Promise.resolve({ mensagem: 'Doado com sucesso!' })
      });
    };
    await NFPR.Donation.doar('4'.repeat(44), '11222333000181');
    ok('one donation is one fresh token then one POST, in that order',
      ordem, ['GET', 'POST']);
    documentoStub.querySelector = () => null;

    // --- Sessao.conferir: is this login still good? --------------------------
    // It exists to keep the volunteer out of a lock in the SITE's own code:
    // pressing Pesquisar in the government entity dialog on a dead session runs
    // JSON.parse('') inside a jQuery .fail handler, the throw skips the
    // .always() that would take blockUI's overlay down, and the dialog is dead
    // until the page reloads.
    const pedidos = [];
    const conferirCom = (resp) => {
      sandbox.fetch = (u, o) => {
        pedidos.push({ url: String(u), redirect: o && o.redirect });
        return typeof resp === 'function' ? resp() : Promise.resolve(resp);
      };
      return NFPR.Sessao.conferir();
    };

    // THE ONE THAT MATTERS. Followed, the 302 lands cross-origin on the identity
    // provider and fetch throws, which is indistinguishable from an unplugged
    // cable; stopped, the same page answers opaqueredirect and the answer is
    // readable. redirect:'manual' IS the check, so it is asserted, not assumed.
    ok('a bounce to the identity provider is a dead session',
      await conferirCom({ type: 'opaqueredirect', status: 0 }), 'MORTA');
    ok('...and it is asked for with redirect:manual, on the login target',
      pedidos[0], { url: NFPR.Site.URL_DOACAO, redirect: 'manual' });
    ok('a page that answers is a live session',
      await conferirCom({ type: 'basic', status: 200 }), 'VIVA');
    ok('a refusal is a dead session',
      await conferirCom({ type: 'basic', status: 403 }), 'MORTA');
    // THE FAIL-SAFE, and the whole reason this is three states and not a
    // boolean: not being able to ask is not an answer. Reading it as "logged
    // out" would shut the volunteer's dialog every time the wifi hiccups —
    // a worse bug than the lock being fixed, because it fires when nothing
    // is wrong.
    ok('a probe that cannot leave the machine decides nothing',
      await conferirCom(() => Promise.reject(new Error('rede caiu'))), 'INDEFINIDA');

    // Single-flight: the watcher fires on every search, healthy ones included.
    pedidos.length = 0;
    let soltar;
    const presa = new Promise((r) => { soltar = r; });
    sandbox.fetch = (u, o) => { pedidos.push({ url: String(u), redirect: o && o.redirect }); return presa; };
    const duas = Promise.all([NFPR.Sessao.conferir(), NFPR.Sessao.conferir()]);
    soltar({ type: 'basic', status: 200 });
    ok('a burst of asks costs one request', (await duas, pedidos.length), 1);
    // ...and the answer is deliberately not cached afterwards: its whole value
    // is that it can change between one search and the next.
    await conferirCom({ type: 'opaqueredirect', status: 0 });
    ok('the next ask is asked again', pedidos.length, 2);

    // The ANNOUNCEMENT, which is what turns "the entity dialog is unavailable"
    // into the queue actually stopping. Without it the volunteer reads a toast
    // about entity search while the notes behind them walk into a wall, and the
    // "Entrar novamente" button — the only thing on screen that ends this —
    // never appears. content.js subscribes; the latch there does the rest.
    let mortesAnunciadas = 0;
    NFPR.Sessao.aoDescobrirMorta(() => { mortesAnunciadas += 1; });
    await conferirCom({ type: 'basic', status: 200 });
    ok('a live session announces nothing', mortesAnunciadas, 0);
    await conferirCom(() => Promise.reject(new Error('rede caiu')));
    ok('...and neither does one that could not be asked', mortesAnunciadas, 0);
    await conferirCom({ type: 'opaqueredirect', status: 0 });
    ok('a proved-dead session is announced', mortesAnunciadas, 1);

    // --- a failed request is not a dead session --------------------------------
    // A dead session is a LATCH — the pool stops, everything goes amber, the bar
    // says "Sua sessão expirou" — so it must be proved, never inferred from a
    // request that merely failed. Two doors used to infer it.
    const fetchAntesDaRede = sandbox.fetch; // put back at the end of this block
    const tokenOk = {
      ok: true, status: 200, redirected: false, type: 'basic', url: NFPR.Site.URL_DOACAO
    };
    documentoStub.querySelector = () => ({ value: 'tok' });
    // (a) The body read failing was taken for an empty page, which has no
    // token, which is what a dead login looks like. The parser finds no token
    // here, as it would in an empty page — so reading the failure as one fails.
    documentoStub.querySelector = () => null;
    sandbox.fetch = () => Promise.resolve(Object.assign({}, tokenOk, {
      arrayBuffer: () => Promise.reject(new TypeError('network error'))
    }));
    ok('a token page whose body breaks mid-read is the server, never the session',
      (await erroDe()).codigo, 'SERVIDOR');
    documentoStub.querySelector = () => ({ value: 'tok' });
    // (b) The POST threw, and the follow-up question — the same GET
    // Sessao.conferir asks — got a plain 200, which was read as "the server is
    // alive, so it must be the session". A 200 proves the login is FINE.
    const postCaiCom = (sonda) => {
      sandbox.fetch = (u, o) => {
        if (o && o.method === 'POST') return Promise.reject(new TypeError('Failed to fetch'));
        if (o && o.redirect === 'manual') return Promise.resolve(sonda);
        return Promise.resolve(Object.assign({}, tokenOk, corpoDe('<html></html>')));
      };
      return erroDe();
    };
    ok('a POST that fails while the login page answers 200 is transient, not a dead session',
      (await postCaiCom({ type: 'basic', status: 200 })).codigo, 'SERVIDOR');
    ok('...while a bounce to the identity provider still is one',
      (await postCaiCom({ type: 'opaqueredirect', status: 0 })).codigo, 'SESSAO');
    ok('...and so is an outright refusal',
      (await postCaiCom({ type: 'basic', status: 403 })).codigo, 'SESSAO');
    ok('the send path and Sessao.conferir read that answer with one function',
      [NFPR.Donation.sessaoPelaResposta({ type: 'basic', status: 200 }),
       NFPR.Donation.sessaoPelaResposta({ type: 'opaqueredirect', status: 0 }),
       NFPR.Donation.sessaoPelaResposta({ type: 'basic', status: 404 })],
      ['VIVA', 'MORTA', 'INDEFINIDA']);

    // --- the duplicate-session page, in the charset it is written in -----------
    // The page is windows-1252 (reference/ has a saved copy), and Response.text()
    // always decodes UTF-8, so "sessão" arrived as "sess�o" and the
    // sentence never matched: a duplicate session met mid-sitting was reported
    // as an EXPIRED one, with "Entrar novamente" — the advice that makes them.
    // The bytes here are the sentence as that page stores it, 0xE3 for "ã".
    const FRASE_DUPLICADA = 'Ops! O usuário autenticado possui mais de uma sessão ativa.';
    const emLatin1 = Uint8Array.from(Buffer.from(FRASE_DUPLICADA, 'latin1')).buffer;
    ok('the fixture is the page as served: decoded as UTF-8 it no longer matches',
      NFPR.Site.RE_SESSAO_DUPLICADA.test(new TextDecoder('utf-8').decode(emLatin1)), false);
    const parserAntes = sandbox.DOMParser;
    sandbox.DOMParser = class {
      parseFromString(html) { return { body: { textContent: html }, querySelector: () => null }; }
    };
    const paginaEm = (bytes) => {
      sandbox.fetch = () => Promise.resolve(Object.assign({}, tokenOk, corpoDe(FRASE_DUPLICADA, bytes)));
      return erroDe();
    };
    ok('the duplicate-session page, in its own windows-1252, is recognised',
      (await paginaEm(emLatin1)).codigo, 'SESSAO_DUPLICADA');
    ok('...and so is the same sentence served as UTF-8',
      (await paginaEm()).codigo, 'SESSAO_DUPLICADA');
    sandbox.DOMParser = parserAntes;

    // --- valid JSON that is not an object ------------------------------------
    // `null` parses. Reading a field off it threw a TypeError past every branch
    // into the orchestrator's catch-all, which deletes the note on its FIRST
    // attempt — no retry, no probe — and records "Cannot read properties of null".
    const rNulo = await respostaDoar(null);
    ok('a JSON null body says nothing: the shrug\'s code, retried, never a crash',
      [rNulo.estado, rNulo.codigo, rNulo.recuperavel, rNulo.fonte],
      ['erro', 'SEM_DIAGNOSTICO', true, 'nfprweb']);
    const rSolto = await respostaDoar('uma frase solta');
    ok('...and so does a bare JSON string', [rSolto.codigo, rSolto.recuperavel], ['SEM_DIAGNOSTICO', true]);
    documentoStub.querySelector = () => null;

    // --- the registry: only its own "no such entity" says "not registered" -----
    // NAO_ENCONTRADA latches the entity as refused, parks the queue behind "não
    // aceita doações" and refuses to save it. A 200 whose body is not an entity
    // is the registry failing to answer — maintenance, an HTML page served as
    // 200 — and it used to be read as that verdict.
    //
    // WHAT THE REGISTRY ACTUALLY SAYS for a CNPJ it does not know is 204 No
    // Content, empty (observed 2026-09-29), and this is that answer as fetch
    // hands it over: ok, and a body that fails to parse. The first cut of the
    // rule above read it as unavailable — a parse failure — so every bogus CNPJ
    // was saved unverified and never refused.
    const registroCom = (resp) => {
      sandbox.fetch = () => Promise.resolve(Object.assign(
        { ok: true, status: 200, redirected: false, type: 'basic', url: 'x' }, resp));
      return NFPR.Entidade.consultar('11222333000181');
    };
    ok('the registry\'s real "no such entity" — 204, empty — is "not registered"',
      (await registroCom({ status: 204, json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')) })).motivo,
      'NAO_ENCONTRADA');
    ok('a registry 200 carrying an HTML page is unavailable, never "not registered"',
      (await registroCom({ json: () => Promise.reject(new SyntaxError('Unexpected token <')) })).motivo,
      'INDISPONIVEL');
    ok('...and so is a 200 with no entity in it',
      (await registroCom({ json: () => Promise.resolve({}) })).motivo, 'INDISPONIVEL');
    ok('...while a 404 still is "not registered"',
      (await registroCom({ ok: false, status: 404 })).motivo, 'NAO_ENCONTRADA');

    // --- nothing waits for ever ---------------------------------------------------
    // The 20 s deadline was cleared the moment the HEADERS arrived, so a body
    // that stalled held its caller for ever: six of them held the whole send
    // pool with nothing on screen, and a stalled probe kept the confused-server
    // latch shut while its bar promised it would lift. The entity lookup and
    // Sessao.conferir had no deadline at all. Time is compressed a thousandfold
    // (20 s → 20 ms), with a real AbortController so the abort actually reaches
    // the stalled read; each wait is raced against half a second, so a hang
    // FAILS here instead of hanging the script.
    const stAntes = sandbox.setTimeout;
    const acAntes = sandbox.AbortController;
    sandbox.setTimeout = (fn, ms) => setTimeout(fn, Math.max(0, (ms || 0) / 1000));
    sandbox.AbortController = AbortController;
    const aTempo = (p) => Promise.race([
      p, new Promise((r) => setTimeout(() => r({ codigo: '(ainda esperando)', motivo: '(ainda esperando)' }), 500))
    ]);
    // With no signal to wait on it simply never settles — which is exactly what
    // a request made without a deadline does, and what the race below catches.
    const esperaAbortar = (sinal) => new Promise((_, rej) => sinal && sinal.addEventListener('abort', () =>
      rej(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))));
    const corpoQueNaoAcaba = (sinal) => Object.assign({}, tokenOk, {
      arrayBuffer: () => esperaAbortar(sinal),
      json: () => esperaAbortar(sinal)
    });
    documentoStub.querySelector = () => ({ value: 'tok' });
    sandbox.fetch = (u, o) => Promise.resolve(corpoQueNaoAcaba(o.signal));
    ok('a token page whose body never finishes is given up on as too slow',
      (await aTempo(erroDe())).codigo, 'SERVIDOR');
    sandbox.fetch = (u, o) => Promise.resolve(o && o.method === 'POST'
      ? corpoQueNaoAcaba(o.signal)
      : Object.assign({}, tokenOk, corpoDe('<html></html>')));
    ok('...and so is a donation answer whose body never finishes',
      (await aTempo(erroDe())).codigo, 'SERVIDOR');
    ok('a probe whose answer never finishes comes back, confused',
      await aTempo(NFPR.Donation.sondarSaude()), 'confuso');
    documentoStub.querySelector = () => null;
    sandbox.fetch = (u, o) => Promise.resolve(corpoQueNaoAcaba(o.signal));
    ok('an entity lookup whose body never finishes is unavailable rather than a hang',
      (await aTempo(NFPR.Entidade.consultar('11222333000181'))).motivo, 'INDISPONIVEL');
    sandbox.fetch = (u, o) => esperaAbortar(o.signal);
    ok('a session check that never answers comes back, having proved nothing',
      await aTempo(NFPR.Sessao.conferir()), 'INDEFINIDA');
    sandbox.setTimeout = stAntes;
    sandbox.AbortController = acAntes;
    sandbox.fetch = fetchAntesDaRede;

    // --- redirecting a stranded queue ----------------------------------------
    // THE SAFETY PROPERTY: only notes whose frozen target is the refused CNPJ
    // may move. A note still aimed at a working entity that gets swept along
    // would be filed under the wrong one and nobody would ever find out, which
    // is the same size of harm as losing it.
    const RUIM = '11222333000181';
    const BOM = '12345678000195';
    const OUTRA = '11444777000161';
    guardado['nfpr:fila'] = [
      { chave: 'a'.repeat(44), cnpj: RUIM },
      { chave: 'b'.repeat(44), cnpj: OUTRA },
      { chave: 'c'.repeat(44), cnpj: null },
      { chave: 'd'.repeat(44), cnpj: RUIM }
    ];
    const movidas = await NFPR.Config.redirecionarFila(RUIM, BOM);
    ok('redirect reports how many notes it moved', movidas, 2);
    const depois = await NFPR.Config.obterFila();
    ok('only the notes aimed at the refused CNPJ moved',
      depois.map((e) => e.cnpj), [BOM, OUTRA, null, BOM]);
    ok('redirect never invents or drops a note',
      depois.map((e) => e.chave[0]).join(''), 'abcd');
    ok('a null target is left alone — it resolves to the active entity anyway',
      depois[2].cnpj, null);
    ok('redirecting to the same CNPJ is a no-op',
      await NFPR.Config.redirecionarFila(BOM, BOM), 0);
    ok('redirect refuses a missing target rather than nulling the queue',
      [await NFPR.Config.redirecionarFila(RUIM, null),
       await NFPR.Config.redirecionarFila(null, BOM)], [0, 0]);
    delete guardado['nfpr:fila'];

    // --- adding an entity activates it ---------------------------------------
    // Every one, not just the first ever saved. Adding a second used to look
    // like nothing had happened — the chip still named the old one and the next
    // note went there. `consulta` is passed in so this needs no network: an
    // unverifiable lookup still saves, on the local check digits alone.
    delete guardado['nfpr:config'];
    const semRede = { ok: false, motivo: 'INDISPONIVEL' };
    const umaEnt = await NFPR.Entidade.salvar(RUIM, { consulta: semRede });
    const cfgUma = await NFPR.Config.obterConfig();
    ok('the first entity saved becomes active',
      [umaEnt.estado, cfgUma.entidadeAtivaId === umaEnt.entidade.id], ['salva', true]);
    const duasEnt = await NFPR.Entidade.salvar(OUTRA, { consulta: semRede });
    const cfgDuas = await NFPR.Config.obterConfig();
    ok('...and so does the next one, immediately',
      [duasEnt.estado, cfgDuas.entidadeAtivaId === duasEnt.entidade.id,
       cfgDuas.entidades.length],
      ['salva', true, 2]);
    ok('a repeat is refused and leaves the active one alone',
      [(await NFPR.Entidade.salvar(OUTRA, { consulta: semRede })).estado,
       (await NFPR.Config.obterConfig()).entidadeAtivaId === duasEnt.entidade.id],
      ['duplicada', true]);

    // --- an entity is NAMED by the registry, never by the volunteer ------------
    // Saved unverified, it carries no name at all — not a typed one, and not a
    // stand-in like "Entidade 11.222…" — and is shown by its CNPJ. The first
    // registry answer names it; a failed lookup leaves it exactly as it was.
    ok('an entity saved without the registry has no name',
      [umaEnt.entidade.nome, umaEnt.entidade.verificada], ['', false]);
    {
      const fetchAntes = sandbox.fetch;
      sandbox.fetch = (u) => String(u).endsWith(RUIM)
        ? Promise.resolve({ ok: true, status: 200, redirected: false, url: String(u),
            json: () => Promise.resolve({ idEntidade: 7, nmEmpresarial: 'ASSOCIACAO X',
              nmFantasia: 'AMARAS', nmMunicipio: 'CURITIBA', cnpj: RUIM }) })
        : Promise.reject(new Error('sem rede'));
      const resultados = await NFPR.Entidade.completarNomes();
      const cfgNomes = await NFPR.Config.obterConfig();
      const porCnpj = (c) => cfgNomes.entidades.find((e) => e.cnpj === c);
      ok('completarNomes writes the official name onto the entity the registry confirms',
        [porCnpj(RUIM).nome, porCnpj(RUIM).municipio, porCnpj(RUIM).verificada],
        ['AMARAS', 'CURITIBA', true]);
      ok('...leaves one it could not ask about unnamed and unverified',
        [porCnpj(OUTRA).nome, porCnpj(OUTRA).verificada], ['', false]);
      ok('...and hands back every answer, so content.js need not ask twice',
        [resultados[RUIM].ok, resultados[OUTRA].motivo], [true, 'INDISPONIVEL']);
      ok('...without touching which entity is active',
        cfgNomes.entidadeAtivaId, duasEnt.entidade.id);
      let pedidos = 0;
      sandbox.fetch = () => { pedidos += 1; return Promise.reject(new Error('sem rede')); };
      await NFPR.Entidade.completarNomes();
      ok('a verified entity is never asked about again', pedidos, 1);
      sandbox.fetch = fetchAntes;
    }
    delete guardado['nfpr:config'];

    marco('session verdicts and retryable refusals are classified');

    // =========================================================================
    // A THOUSAND NOTES: THE SEND POOL, AND THE PANEL UNDER A LARGE QUEUE
    // =========================================================================
    // The scenario is a volunteer who scanned a thousand notes offline and
    // reloads the donation page today with a working connection. content.js is
    // never loaded here (it starts working the moment it does), which is why the
    // scheduler lives in its own module: NFPR.Despacho is the part worth testing
    // and it is pure.
    const espera = () => new Promise((r) => setTimeout(r, 0));

    {
      const ordem = [];
      const soltar = [];
      let ativos = 0;
      let pico = 0;
      const pool = NFPR.Despacho.criar({
        largura: 3,
        executar: (t) => {
          ordem.push(t.n);
          ativos += 1;
          pico = Math.max(pico, ativos);
          return new Promise((r) => soltar.push(() => { ativos -= 1; r(); }));
        }
      });
      for (let i = 0; i < 10; i += 1) pool.enfileirar({ n: i });
      await espera();
      ok('the pool runs at most `largura` donations at once', pico, 3);
      ok('...taking them in the order they were entered', ordem, [0, 1, 2]);
      ok('...and holds the rest', [pool.emVoo(), pool.pendentes()], [3, 7]);

      soltar.shift()();
      await espera();
      ok('a finished donation frees its slot for the next in line', ordem, [0, 1, 2, 3]);

      // A dead session refuses every note identically. The caller latches it and
      // pauses, so the remaining notes cost nothing instead of one doomed
      // request each — the whole reason this is a condition and not a verdict.
      pool.pausar();
      const parados = pool.esvaziar();
      ok('pausing plus esvaziar takes every waiting note out in one go',
        [parados.length, pool.pendentes(), parados[0].n], [6, 0, 4]);
      ok('...without touching what is already in flight', pool.emVoo(), 3);
      pool.enfileirar({ n: 99 });
      await espera();
      ok('...and a paused pool dispatches nothing new', ordem.includes(99), false);
      while (soltar.length) soltar.shift()();
      await espera();
      ok('...not even as slots come free', ordem.includes(99), false);
      pool.retomar();
      await espera();
      ok('retomar starts it again', ordem.includes(99), true);
    }

    {
      // A worker that throws must still free its slot: a few rejections in a
      // thousand-note drain would otherwise shrink the pool a little at a time
      // until nothing moved at all.
      let vezes = 0;
      const pool = NFPR.Despacho.criar({
        largura: 1,
        executar: () => { vezes += 1; return Promise.reject(new Error('x')); }
      });
      pool.enfileirar({});
      pool.enfileirar({});
      await espera();
      await espera();
      ok('a donation that throws still frees its slot', vezes, 2);
      ok('largura 1 is the strictly sequential behaviour, still available',
        NFPR.Despacho.criar({ largura: 1, executar: () => Promise.resolve() }).emVoo(), 0);
    }

    {
      // The urgent lane. A note the volunteer just scanned goes out ahead of a
      // backlog they are not watching — they are standing there holding the
      // paper, and the backlog has two months of deadline left.
      const ordem = [];
      const soltar = [];
      const pool = NFPR.Despacho.criar({
        largura: 1,
        executar: (t) => {
          ordem.push(t.n);
          return new Promise((r) => soltar.push(r));
        }
      });
      for (let i = 0; i < 5; i += 1) pool.enfileirar({ n: 'fila' + i });
      await espera();
      pool.enfileirar({ n: 'scan1' }, true);
      pool.enfileirar({ n: 'scan2' }, true);
      pool.enfileirar({ n: 'fila9' });
      soltar.shift()();
      await espera();
      soltar.shift()();
      await espera();
      soltar.shift()();
      await espera();
      ok('a scanned note jumps the whole backlog',
        ordem, ['fila0', 'scan1', 'scan2', 'fila1']);
      ok('...and the queue depth counts both lanes', pool.pendentes(), 4);
      ok('...while esvaziar empties both', pool.esvaziar().length, 4);
    }

    {
      // The panel under a large queue. TWO SURFACES: the indicator says how
      // much is left, the list says what happened. They were once the same
      // thing — every queued note got a row, rows were rationed by priority,
      // and a fresh scan could not outrank the notes already sending, so
      // scanning right after a reload showed nothing at all.
      const marca = criados.length;
      // `aoLimparFalhas` is what the live page supplies to empty nfpr:falhas
      // from inside the page that lists the notes. Spied here so the two-step
      // below can be driven end to end.
      let limpezasPedidas = 0;
      // criados/porTexto scan in CREATION ORDER across every mount in this file,
      // and two modals were built before this one — so an unscoped lookup finds
      // the FIRST modal's buttons, which have no aoLimparFalhas and silently do
      // nothing. Same trap the debug block hit; mark the boundary and slice.
      const marcaUi3 = criados.length;
      const ui3 = await NFPR.UI.montar({
        modoOffline: true,
        montarEm: elemento(),
        aoLimparFalhas: function () { limpezasPedidas += 1; return []; }
      });
      const novos = () => criados.slice(marca);
      const linhas = () => novos().filter((e) => e.atributos['data-id']).length;
      const LIM = NFPR.Painel.LIMITE_LINHAS;

      // A scan ALWAYS gets its row, whatever else is going on. This is the one
      // that regressed: it is the volunteer's only confirmation the key was read.
      const ids = [];
      for (let i = 0; i < 1000; i += 1) {
        ids.push(ui3.adicionarItem(String(i).padStart(44, '0'), '11222333000181'));
      }
      ok('every scan builds its row, no matter how much is already queued',
        linhas(), 1000);
      const vivos = novos().filter((e) => e.atributos['data-id']).slice(-LIM);
      ok('...while the list itself keeps only the newest LIMITE_LINHAS',
        vivos.length, LIM);

      // AND THE LIST SNAPS BACK TO THE TOP FOR IT. Rows go in newest-first and
      // .nfpr-results is the only element in the panel that scrolls, so a
      // volunteer who scrolled down earlier would have every new row appear
      // off-screen above them — including the row for the note in their hand,
      // which is their only confirmation the key was read.
      const listaEl = criados.slice(marcaUi3).find((e) => e.className === 'nfpr-results');
      listaEl.scrollTop = 480;
      ui3.adicionarItem('5'.repeat(44), '11222333000181');
      ok('a new row scrolls the list back to the top', listaEl.scrollTop, 0);

      // A row that scrolled off the end takes its record with it, and updating
      // it is a harmless no-op. That is only SAFE because the outcome that
      // matters was written to storage first — see the nfpr:falhas block below.
      // It used to be the whole story, and the bug was real: with a pool six
      // wide, a note can easily have LIMITE_LINHAS newer scans land before it
      // answers, and the terminal answer was then recorded NOWHERE AT ALL.
      //
      // Read off the evicted row ITSELF: its record is gone from `porId`, so
      // the update finds nothing and the element keeps the state it left with.
      // This used to be ok(…, true, true), which could not fail — a panel that
      // kept every record for ever passed it.
      const linhaDe = (id) => novos().find((e) => e.atributos['data-id'] === id);
      ui3.atualizarItem(ids[0], { estado: 'erro', mensagem: 'o site recusou' });
      ok('a row that scrolled off the end is out of the document',
        linhaDe(ids[0]).removido === true, true);
      ok('...and updating it touches nothing, because its record went with it',
        linhaDe(ids[0]).className, 'nfpr-res nfpr-res-enviando');
      ui3.atualizarItem(ids[999], { estado: 'sucesso', mensagem: 'ok' });
      ok('...while a row still on the list takes the same update',
        linhaDe(ids[999]).className, 'nfpr-res nfpr-res-sucesso');

      // ---- nfpr:falhas: the only trace of a note that was rejected and dropped
      // DURABLE ON PURPOSE. These notes have already left nfpr:fila with their
      // keys unblocked, so nothing else remembers them — and the first version
      // kept the list in a variable inside painel.js, where any navigation
      // destroyed it. The session bar's own "Entrar novamente" is a link that
      // navigates this very tab, so that was an ordinary mid-batch action.
      delete guardado['nfpr:falhas'];
      const K1 = '1'.repeat(44);
      const K2 = '2'.repeat(44);
      ok('nothing is recorded until something is rejected',
        (await NFPR.Config.obterFalhas()).length, 0);

      await NFPR.Config.registrarFalha(K1, 'o site recusou', 1700000000000);
      const f1 = await NFPR.Config.obterFalhas();
      ok('a rejected-and-unexplained note is recorded', f1.length, 1);
      ok('...with its digits, because that is what identifies it', f1[0].chave, K1);
      ok('...the sentence the site gave', f1[0].mensagem, 'o site recusou');
      ok('...and WHEN THE VOLUNTEER ENTERED IT, not when it was sent', f1[0].em, 1700000000000);
      ok('...in storage, so a reload or a navigation cannot lose it',
        Array.isArray(guardado['nfpr:falhas']), true);

      // ONE ENTRY PER KEY. A rejected key is unblocked, so rescanning it makes a
      // second note record for the same 44 digits; two entries would report
      // "2 notas" about one note.
      await NFPR.Config.registrarFalha(K2, 'outra recusa', 1700000001000);
      await NFPR.Config.registrarFalha(K1, 'recusou de novo', 1700000002000);
      const f2 = await NFPR.Config.obterFalhas();
      ok('the same key rejected twice is still one entry', f2.length, 2);
      ok('...carrying the newer sentence', f2[0].mensagem, 'recusou de novo');
      ok('...and keeping its place, so the list stays oldest-first', f2[0].chave, K1);

      // It empties itself: a key that registers later is no longer unregistered.
      const f3 = await NFPR.Config.resolverFalha(K1);
      ok('a key that registers later comes off the record', f3.length, 1);
      ok('...leaving the others alone', f3[0].chave, K2);
      ok('resolving a key that was never there changes nothing',
        (await NFPR.Config.resolverFalha('9'.repeat(44))).length, 1);

      // CAPPED. It is the only record of these notes, but it still cannot grow
      // for ever — and a volunteer hundreds behind has a problem no list fixes.
      const LIMF = NFPR.Config.LIMITE_FALHAS;
      for (let i = 0; i < LIMF + 25; i += 1) {
        await NFPR.Config.registrarFalha(String(i).padStart(44, '7'), 'x', 1700000000000 + i);
      }
      const cheio = await NFPR.Config.obterFalhas();
      ok('the record is capped', cheio.length, LIMF);
      ok('...and it is the OLDEST that fall off the end',
        cheio[cheio.length - 1].chave, String(LIMF + 24).padStart(44, '7'));

      // THE DELIBERATE EMPTY, and the only thing that clears this record
      // without a note registering. Before it existed the bar was permanent:
      // entries leave on resolverFalha or by falling off the cap, so a note
      // nobody is ever going to rescan kept a red bar on screen for good — and
      // a bar that can never be answered stops being read.
      const vazio = await NFPR.Config.limparFalhas();
      ok('clearing the record empties it and reports the empty list',
        [vazio.length, (await NFPR.Config.obterFalhas()).length], [0, 0]);
      ok('clearing an already-empty record is harmless',
        (await NFPR.Config.limparFalhas()).length, 0);

      // NO INPUT TIME IS NOT "NOW". A legacy plain-string queue entry (the one
      // migration kept on purpose) reads back with `em: null`, and that null is
      // what reaches registrarFalha. Stamped with the failure time, the page
      // said "Lida em <the moment it failed>" about a note nobody read then;
      // null is what makes it omit the line.
      const filaAntesLegado = guardado['nfpr:fila'];
      guardado['nfpr:fila'] = ['3'.repeat(44)];
      const legado = (await NFPR.Config.obterFila())[0];
      await NFPR.Config.registrarFalha(legado.chave, 'x', legado.em);
      ok('a note with no input time is recorded with none, never back-dated',
        [legado.em, (await NFPR.Config.obterFalhas())[0].em], [null, null]);
      guardado['nfpr:fila'] = filaAntesLegado;
      await NFPR.Config.limparFalhas();
      delete guardado['nfpr:falhas'];

      // ---- nfpr:fila holds a key once ------------------------------------------
      // A rejected key is unblocked, so rescanning it calls adicionarNaFila
      // again while the first copy may still be queued. A second entry is a
      // second POST of the same note on the next drain. The FIRST entry wins:
      // its target and its moment of input are frozen, and a rescan aimed
      // elsewhere must not retarget it.
      const filaAntes = guardado['nfpr:fila'];
      delete guardado['nfpr:fila'];
      await NFPR.Config.adicionarNaFila(K1, '11222333000181');
      await NFPR.Config.adicionarNaFila(K2, '11222333000181');
      await NFPR.Config.adicionarNaFila(K1, '11444777000161', 'motivo');
      const filaDup = await NFPR.Config.obterFila();
      ok('a key added to the queue twice is queued once',
        filaDup.map((e) => e.chave), [K1, K2]);
      ok('...keeping the first entry\'s frozen target and reading',
        [filaDup[0].cnpj, filaDup[0].semValidacao], ['11222333000181', null]);
      if (filaAntes === undefined) delete guardado['nfpr:fila'];
      else guardado['nfpr:fila'] = filaAntes;

      // ---- the bar, which only DRAWS what it is handed ------------------------
      const barraFalhas = novos().find((e) => e.className === 'nfpr-falhas-bar');
      const falhasMsg = novos().find((e) => e.className === 'nfpr-falhas-msg');
      ui3.setFalhas([]);
      ok('the failures bar is hidden while nothing has been rejected',
        !!barraFalhas.atributos.hidden, true);
      ui3.setFalhas([{ chave: K1, mensagem: 'x', em: 1700000000000 }]);
      ok('...and shows the moment something is', !!barraFalhas.atributos.hidden, false);
      // FLAT, NOT HEDGED. Exactly one answer files a donation — 200 OK with a
      // `mensagem` containing "sucesso" — and anything else is the server
      // actively rejecting it, so these demonstrably were not filed. "podem não
      // ter sido registradas" was an early draft and understates in the
      // expensive direction.
      ok('...saying flatly that they were not registered',
        /não foi registrada/.test(falhasMsg.textContent), true);
      ok('...and never hedging it', /pode/.test(falhasMsg.textContent), false);
      // AND IT SAYS NOTHING ABOUT THE PRINTED RECEIPTS. This extension reports
      // what registered and what did not; sorting or keeping the paper is the
      // charity's own process and out of scope however well-meant. A draft read
      // "Separe esses papéis", which is exactly the line not to cross.
      ok('...and never telling the volunteer what to do with the paper',
        /papel|papéis|descart|separe|guarde/i.test(falhasMsg.textContent), false);
      ui3.setFalhas([
        { chave: K1, mensagem: 'x', em: 1700000000000 },
        { chave: K2, mensagem: 'y', em: 1700000001000 }
      ]);
      ok('...and counts notes', /2 notas não foram registradas/.test(falhasMsg.textContent), true);

      // The page behind it, rebuilt from the panel's list on every open.
      const marcaPagina = criados.length;
      ui3.abrir('falhas');
      const daPagina = (c) => criados.slice(marcaPagina).filter((e) => String(e.className).indexOf(c) === 0);
      ok('the failures page lists one card per note', daPagina('nfpr-falha-card').length, 2);
      ok('...leading with the digits, spaced so they can be read',
        daPagina('nfpr-falha-chave')[0].textContent, NFPR.agruparChave(K1));
      // The input time, to the second. It is what places the note in the
      // volunteer's own day, so a missing one must be omitted rather than faked.
      ok('...and carrying the time it was entered, to the second',
        /\d{2}:\d{2}:\d{2}/.test(daPagina('nfpr-falha-em')[0].textContent), true);
      ui3.setFalhas([{ chave: K1, mensagem: 'x', em: null }]);
      const marcaSemData = criados.length;
      ui3.abrir('falhas');
      ok('...omitted entirely when the entry predates the field',
        criados.slice(marcaSemData).filter((e) => String(e.className).indexOf('nfpr-falha-em') === 0).length, 0);
      ui3.fechar();

      // ---- clearing the record, from inside the page ---------------------------
      // THE BAR STILL HAS NO ✕, and that is the rule this must not break: it is
      // a condition, and a count that can be waved away without looking is a
      // count nobody looks at. The control lives on the PAGE instead, so
      // reaching it means the volunteer opened it and saw the digits.
      ui3.setFalhas([
        { chave: K1, mensagem: 'x', em: 1700000000000 },
        { chave: K2, mensagem: 'y', em: 1700000001000 }
      ]);
      ui3.abrir('falhas');
      // Searched across ALL created elements, not a slice taken at open: the
      // footer is built once with the modal and re-appended on every paint,
      // unlike the cards, which are rebuilt each time.
      const deUi3 = (t) => criados.slice(marcaUi3).find((e) => e.textContent === t);
      // BY SUBTREE, not by text across the whole mount: "Cancelar" is also the
      // fixed part editor's button, built with the panel and therefore FIRST in
      // `criados`, so a flat search by label silently clicked the wrong one.
      const dentroDe = (raiz, t) => {
        const pilha = [raiz];
        while (pilha.length) {
          const n = pilha.shift();
          if (n !== raiz && n.textContent === t) return n;
          for (const f of n.filhos || []) pilha.push(f);
        }
        return null;
      };
      const btnLimparHist = deUi3('Limpar a lista');
      const caixaConfirma = criados.slice(marcaUi3)
        .find((e) => e.className === 'nfpr-falhas-confirma');
      ok('the failures page offers a way to clear the record',
        [!!btnLimparHist, btnLimparHist && btnLimparHist.tagName], [true, 'BUTTON']);
      // TWO STEPS, because this is genuinely destructive: these notes already
      // left nfpr:fila, so the record is their only trace. One misclick would
      // be unrecoverable, and confirm() is forbidden everywhere here.
      ok('...which does not fire on the first click',
        [!!caixaConfirma.atributos.hidden, limpezasPedidas], [true, 0]);
      clicar(btnLimparHist);
      ok('...it asks first, naming how many notes go',
        [!!caixaConfirma.atributos.hidden, limpezasPedidas], [false, 0]);
      clicar(dentroDe(caixaConfirma, 'Cancelar'));
      ok('...and cancelling puts it away without clearing anything',
        [!!caixaConfirma.atributos.hidden, limpezasPedidas], [true, 0]);
      clicar(btnLimparHist);
      clicar(deUi3('Apagar'));
      await new Promise((r) => setImmediate(r));
      ok('confirming clears the record and hides the bar',
        [limpezasPedidas, !!barraFalhas.atributos.hidden], [1, true]);

      ui3.setFalhas([]);
      ok('...and the bar clears when the record empties',
        !!barraFalhas.atributos.hidden, true);

      // The indicator. Pending work is a quantity and never a row.
      const indicador = novos().find((e) => e.className === 'nfpr-fila');
      const texto = novos().find((e) => e.className === 'nfpr-fila-texto');
      const preenche = novos().find((e) => e.className === 'nfpr-fila-barra-fill');
      const linhasAntes = linhas();

      ui3.setFila({ restantes: 0 });
      ok('an empty queue shows nothing at all', !!indicador.atributos.hidden, true);

      ui3.setFila({ restantes: 900 });
      ok('a queue is drawn as an amount', texto.textContent, '900 notas na fila');
      ok('...and a brand-new batch starts the bar at zero', preenche.style.width, '0%');
      ui3.setFila({ restantes: 450 });
      ok('...which then fills as the queue drains', preenche.style.width, '50%');
      // Notes scanned mid-drain are NEW WORK, not lost ground. Without the
      // restart the fill lurches backwards on every scan, which reads as the
      // extension undoing itself.
      ui3.setFila({ restantes: 600 });
      ok('any increase restarts the bar instead of rewinding it',
        preenche.style.width, '0%');
      ui3.setFila({ restantes: 300 });
      ok('...and it fills again from the new baseline', preenche.style.width, '50%');
      ui3.setFila({ restantes: 1 });
      ok('...and the singular is said properly', texto.textContent, '1 nota na fila');
      ui3.setFila({ restantes: 0 });
      ok('...and an emptied queue clears the fill', preenche.style.width, '0%');

      ok('NONE of that ever created a row — pending work is not a list',
        linhas(), linhasAntes);

      // The bar subtracts blue rows, so work is never announced twice. Counted
      // from the rows themselves: a scanned note is blue from the instant it is
      // read, whether or not the pool had a slot, and so is one on a retry
      // timer — neither is "in the pool", and both must still be subtracted.
      const marca2 = criados.length;
      const ui4 = await NFPR.UI.montar({ modoOffline: true, montarEm: elemento() });
      ok('a fresh panel has no rows sending', ui4.contarEnviando(), 0);
      const a = ui4.adicionarItem('1'.repeat(44), '11222333000181');
      const b = ui4.adicionarItem('2'.repeat(44), '11222333000181');
      ok('a new row counts as sending the moment it exists', ui4.contarEnviando(), 2);
      ui4.atualizarItem(a, { estado: 'sucesso', mensagem: 'ok' });
      ok('...and stops once it settles', ui4.contarEnviando(), 1);
      ui4.atualizarItem(b, { estado: 'aguardando', mensagem: 'guardada' });
      ok('...or once it is parked amber', ui4.contarEnviando(), 0);
      void marca2;

      // A dead session is a condition on the bar, never a red note.
      const barraSessao = novos().find((e) => e.className === 'nfpr-sessao-cond-bar');
      ok('the session bar starts hidden', !!barraSessao.atributos.hidden, true);
      ui3.setSessao({ mensagem: 'expirou', rotulo: 'Entrar', href: '/login' });
      ok('...and shows when the session dies', !!barraSessao.atributos.hidden, false);
      // THE WAY OUT MUST ASK, NEVER NAVIGATE. This is the duplicate-session
      // offer, which now lives only here: it has to be a BUTTON wired to
      // sessao.js's one background /sair. A plain anchor would leave the page
      // that is supposed to report how the termination went — and opening a
      // second tab is how you get a second session in the first place.
      let pedidosDeEncerrar = 0;
      ui3.setSessao({ mensagem: 'duplicada', rotulo: 'Encerrar todas as sessões',
        aoClicar() { pedidosDeEncerrar += 1; } });
      const botaoSessao = novos().concat(criados)
        .find((e) => e.className === 'nfpr-sessao-cond-acao');
      for (const fn of botaoSessao.escutas.click || []) fn({});
      ok('the duplicate-session offer is a button that asks, not a link',
        [botaoSessao.tagName, !!botaoSessao.atributos.hidden, pedidosDeEncerrar,
         criados.some((e) => e.atributos.href === NFPR.Site.URL_SAIR)],
        ['BUTTON', false, 1, false]);
      // THE ACTION IS RESERVED BEFORE IT IS AVAILABLE. This bar changes message
      // under the volunteer — "Encerrando as sessões abertas…" becomes "Sua
      // sessão expirou. / Entrar novamente" — and showing the link only at the
      // end made the bar grow at the moment there was something to read. The
      // label is drawn in its final position, with NO href, so it is inert:
      // following it while /sair is in flight kills the request.
      const linkSessao = novos().find((e) => e.className === 'nfpr-sessao-cond-link' ||
        /nfpr-acao-inerte/.test(e.className));
      ui3.setSessao({ mensagem: 'Encerrando as sessões abertas…', rotulo: 'Entrar novamente',
        pendente: true });
      ok('the waiting state reserves the action it is about to offer, inert',
        [!!barraSessao.atributos.hidden, !!linkSessao.atributos.hidden,
         linkSessao.textContent, linkSessao.atributos.href,
         /nfpr-acao-inerte/.test(linkSessao.className)],
        [false, false, 'Entrar novamente', undefined, true]);
      ui3.setSessao({ mensagem: 'expirou', rotulo: 'Entrar', href: '/login' });
      ok('...and the same element goes live, so nothing moves',
        [linkSessao.atributos.href, /nfpr-acao-inerte/.test(linkSessao.className)],
        ['/login', false]);
      ui3.setSessao(null);
      ok('...and is a condition, so it clears itself', !!barraSessao.atributos.hidden, true);

      // A server that cannot judge donations is the same shape of thing, with
      // one difference worth pinning: it is the ONLY bar with no action on it.
      // Nothing on this machine can fix someone else's server, the extension is
      // already holding the notes and re-probing on a backoff, and a button
      // here could only lie about who is in control.
      const barraServidor = novos().find((e) => e.className === 'nfpr-servidor-cond-bar');
      ok('the confused-server bar starts hidden', !!barraServidor.atributos.hidden, true);
      ui3.setServidorConfuso({ mensagem: '3 notas estão guardadas.' });
      ok('...and shows when the server cannot judge', !!barraServidor.atributos.hidden, false);
      ok('...carrying no button, because there is nothing for anyone to do',
        barraServidor.filhos.every((f) => f.tagName !== 'BUTTON' && f.tagName !== 'A'), true);
      ui3.setServidorConfuso(null);
      ok('...and it clears itself too', !!barraServidor.atributos.hidden, true);

      // Queue removals coalesce: a thousand settled notes used to mean a
      // thousand serialized read-modify-writes of a thousand-element array.
      const fila = [];
      for (let i = 0; i < 50; i += 1) fila.push({ chave: 'k' + i, cnpj: null });
      guardado['nfpr:fila'] = fila;
      let escritas = 0;
      const setReal = sandbox.chrome.storage.local.set;
      sandbox.chrome.storage.local.set = async (o) => {
        if (o['nfpr:fila']) escritas += 1;
        return setReal(o);
      };
      const espere = [];
      for (let i = 0; i < 50; i += 1) espere.push(NFPR.Config.removerDaFila('k' + i));
      await Promise.all(espere);
      sandbox.chrome.storage.local.set = setReal;
      ok('fifty removals in one window cost one write', escritas, 1);
      // The queue carries the moment of INPUT, so a batch scanned offline on
      // Friday and drained on Monday can still report Friday. Legacy entries
      // (plain strings, or objects written before the field) read as null and
      // are simply omitted rather than back-dated to the drain.
      delete guardado['nfpr:fila'];
      await NFPR.Config.adicionarNaFila('8'.repeat(44), '11222333000181');
      const [entrada] = await NFPR.Config.obterFila();
      ok('a queued note remembers when it was entered', typeof entrada.em, 'number');
      guardado['nfpr:fila'] = ['7'.repeat(44)];
      ok('...and a legacy plain-string entry reads as null, never as now',
        (await NFPR.Config.obterFila())[0].em, null);
      delete guardado['nfpr:fila'];
      ok('...and every key really is gone', (await NFPR.Config.obterFila()).length, 0);
      delete guardado['nfpr:fila'];
    }

    marco('a large queue: bounded pool, quantity indicator, bounded outcome list');

    // =========================================================================
    // DEBUG MODE (src/shared/debug.js)
    // =========================================================================
    // LAST ON PURPOSE. Arming it changes the clock, the network layer and what
    // the pipeline accepts — globally, for every module already loaded — so any
    // assertion above it would be testing a rigged build. It disarms itself at
    // the end for the same reason.
    const Debug = NFPR.Debug;
    await Debug.pronto();

    // Debug mode announces every arm, disarm and wipe on the console — that
    // loudness is the point in a browser, and pure noise here, where this block
    // does it about thirty times. Captured for the duration so the run stays
    // readable, then CHECKED rather than discarded: anything that is not one of
    // debug mode's own announcements is a real warning and gets printed.
    // `console` is passed into the sandbox by reference, so patching it here
    // reaches every module inside it.
    const avisos = [];
    const debugOriginal = console.debug;
    console.debug = function () {
      avisos.push(Array.prototype.join.call(arguments, ' '));
    };

    // --- it ships inert ------------------------------------------------------
    // The property everything else depends on: with nothing stored, every flag
    // reads false and every hook is the identity function.
    ok('debug mode is disarmed with nothing stored', Debug.estaAtivo(), false);
    ok('...so every flag reads off',
      Object.keys(Debug.FLAGS_PADRAO).filter((f) => Debug.on(f) || Debug.valor(f)), []);
    ok('...and resumo has nothing to show', Debug.resumo(), []);
    const vermelho = Chave.avaliar('41', AGORA);
    const cinza = Chave.avaliar(chaveCom({ aa: '24', mm: '01' }), AGORA);
    ok('...and ajustarVeredito is the identity function',
      [Debug.ajustarVeredito(vermelho).gravidade, Debug.ajustarVeredito(cinza).gravidade],
      ['entrada', 'inelegivel']);

    // --- the clock -----------------------------------------------------------
    // relogio.js is the one place that reads a clock, so overriding it there
    // has to move every verdict at once. A note that is fine today must go
    // EXPIRADA purely because the month moved.
    const agoraAntes = NFPR.Relogio.mesCorrente();
    const notaDeAgora = chaveCom({
      aa: String(agoraAntes.ano - 2000).padStart(2, '0'),
      mm: String(agoraAntes.mes).padStart(2, '0')
    });
    ok('a note emitted this month is donatable right now',
      Chave.avaliar(notaDeAgora, NFPR.Relogio.mesCorrente()).gravidade, null);

    Debug.ligar({ relogioFixo: { ano: 2030, mes: 6 } });
    ok('relogioFixo moves Relogio.mesCorrente', NFPR.Relogio.mesCorrente(), { ano: 2030, mes: 6 });
    ok('...and the same note is now past the deadline',
      [Chave.avaliar(notaDeAgora, NFPR.Relogio.mesCorrente()).codigo,
       Chave.avaliar(notaDeAgora, NFPR.Relogio.mesCorrente()).gravidade],
      ['EXPIRADA', 'inelegivel']);
    ok('...and resumo names it', Debug.resumo(), ['relogioFixo=06/2030']);
    Debug.limpar();
    ok('limpar puts the clock back', NFPR.Relogio.mesCorrente(), agoraAntes);

    // --- smoke(): the browser-side fixture pass -------------------------------
    // Debug.smoke() restates REGRAS' colours as an expectation table, in a file
    // nobody reads until something has already gone wrong. Asserting it here is
    // what stops that table rotting quietly. Silent, because it prints seventeen
    // rows.
    ok('Debug.smoke passes at the real clock', Debug.smoke({ silencioso: true }).ok, true);
    // Its fixtures are built RELATIVE to Relogio.mesCorrente, so time travel has
    // to move the fixtures and the verdicts together — and January is the month
    // where "three months back" wraps the year, which is what a stray `mes - 3`
    // would get wrong.
    Debug.ligar({ relogioFixo: { ano: 2027, mes: 1 } });
    ok('...and under time travel across a year boundary',
      Debug.smoke({ silencioso: true }).ok, true);
    Debug.limpar();

    // --- simularEnvio arms itself -------------------------------------------
    // The one safety interlock: switching on a bypass also switches on the flag
    // that keeps the result off the wire. Donating a fabricated key has to be a
    // second, deliberate call.
    ok('arming a red bypass arms simularEnvio too',
      Debug.ligar({ aceitarChavesInvalidas: true }).simularEnvio, true);
    ok('...and naming simularEnvio explicitly still wins',
      Debug.ligar({ ignorarInelegibilidade: true, simularEnvio: false }).simularEnvio, false);

    // --- the verdict bypasses ------------------------------------------------
    Debug.ligar({ aceitarChavesInvalidas: true, ignorarInelegibilidade: true });
    const vDown = Debug.ajustarVeredito(vermelho);
    const cDown = Debug.ajustarVeredito(cinza);
    ok('a red verdict is downgraded, and says which gate opened',
      [vDown.gravidade, vDown.forcado, vDown.codigo], [null, 'entrada', 'COMPRIMENTO']);
    ok('a grey verdict likewise',
      [cDown.gravidade, cDown.forcado, cDown.codigo], [null, 'inelegivel', 'EXPIRADA']);
    // A clean key must come back untouched, so the call site reads the same
    // either way and no ordinary row ever gets a `forcado` marker.
    ok('a clean verdict is never marked',
      Debug.ajustarVeredito(Chave.avaliar(chaveCom({ aa: '25', mm: '08' }), AGORA)).forcado,
      undefined);

    // --- the fake network ----------------------------------------------------
    // Every branch below must answer BEFORE the token fetch, so a request would
    // be a bug rather than a slow test.
    sandbox.fetch = () => { throw new Error('depuração não deveria pedir nada à rede'); };
    Debug.limpar();
    Debug.ligar({ simularEnvio: true });
    const rSim = await NFPR.Donation.doar(chave, '11222333000181');
    ok('simularEnvio answers success without a request', rSim.estado, 'sucesso');
    // PROVENANCE, and simularEnvio is the one answer that must NOT carry it.
    // The muted [nfprweb] prefix says the site produced (or decided) this
    // sentence; here nothing left the machine and the sentence says
    // "Simulação:", so tagging it would be a plain lie on the row.
    ok('a simulated answer claims no provenance', rSim.fonte, undefined);

    // respostaForcada goes through the REAL classifier — a bypass that skipped
    // it would prove nothing about donation.js.
    Debug.ligar({ respostaForcada: 'Fora do prazo para doar.' });
    const rForcPrazo = await NFPR.Donation.doar(chave, '11222333000181');
    ok('a forced sentence is classified for real, not waved through',
      [rForcPrazo.estado, rForcPrazo.recuperavel], ['inelegivel', undefined]);
    Debug.ligar({ respostaForcada: { mensagem: 'Registrada com sucesso.' } });
    ok('...and a forced body works the same way',
      (await NFPR.Donation.doar(chave, '11222333000181')).estado, 'sucesso');
    Debug.ligar({ respostaForcada: { cnpjEntidade: 'Entidade não cadastrada.' } });
    const rForcCnpj = await NFPR.Donation.doar(chave, '11222333000181');
    ok('...including the terminal entity rejection',
      [rForcCnpj.estado, rForcCnpj.recuperavel], ['erro', undefined]);
    // THE SHRUG, which is the whole reason the object shape has to be reachable
    // from the debug FORM as well as from here: a bare sentence becomes
    // `chaveAcesso`, so `{erro: ...}` is the one answer no sentence can express
    // — and it is the answer the health probe and the confused-server latch
    // exist for. Without it neither could be exercised on a real page.
    Debug.ligar({ respostaForcada: { erro: 'A aplicação retornou que não foi possível concluir a ação solicitada.' } });
    const rForcShrug = await NFPR.Donation.doar(chave, '11222333000181');
    ok('...and the shrug, which no forced SENTENCE could ever produce',
      [rForcShrug.estado, rForcShrug.codigo, rForcShrug.recuperavel],
      ['erro', 'SEM_DIAGNOSTICO', true]);
    // EVERY branch of the response table is server-side by construction, so the
    // tag is stamped on the way OUT of classificarResposta rather than written
    // into each object literal — which is what stops a branch added later from
    // forgetting it. These four came in as a bare sentence, a body, a terminal
    // entity refusal and the shrug: four different doors, one answer.
    //
    // The shrug matters most: its sentence is OURS ("O site respondeu…"),
    // written because the site gave us nothing to relay, and it still takes the
    // prefix. Provenance is where the failure was DECIDED, not who wrote the
    // words — the maintainer reading a volunteer's screenshot needs to know
    // which side broke.
    ok('every classified answer carries its provenance, whichever door it came in',
      [rForcPrazo.fonte, rForcCnpj.fonte, rForcShrug.fonte],
      ['nfprweb', 'nfprweb', 'nfprweb']);

    // erroForcado reaches the orchestrator's catch branch, which is otherwise
    // only reachable by unplugging the router or breaking your own session.
    const codigoForcado = async (cod) => {
      Debug.ligar({ respostaForcada: null, erroForcado: cod });
      try {
        await NFPR.Donation.doar(chave, '11222333000181');
        return '(no error)';
      } catch (e) {
        return e.codigo;
      }
    };
    ok('erroForcado throws the coded errors content.js branches on',
      [await codigoForcado('REDE'), await codigoForcado('SERVIDOR'),
       await codigoForcado('SESSAO'), await codigoForcado('SESSAO_DUPLICADA'),
       await codigoForcado('ENCERRANDO_SESSAO')],
      ['REDE', 'SERVIDOR', 'SESSAO', 'SESSAO_DUPLICADA', 'ENCERRANDO_SESSAO']);

    // --- the fake connection -------------------------------------------------
    // 'offline' has to beat a machine that is perfectly connected, and neither
    // value may issue a probe (the fetch stub above still throws).
    Debug.limpar();
    const quedas = [];
    let voltas = 0;
    const sonda = NFPR.Connectivity.iniciar({
      urlSonda: NFPR.Site.URL_DOACAO,
      aoCair: (m) => quedas.push(m),
      aoVoltar: () => { voltas += 1; }
    });
    Debug.ligar({ forcarConexao: 'offline' });
    ok('forcarConexao=offline is believed on a connected machine',
      await sonda.verificarAgora(), false);

    // THE BUG THIS EXISTS FOR: forcing the probe alone changed nothing on the
    // live page, whose watchdog stays idle until a send fails — so the note
    // went out for real. A forced outage has to stop the SEND.
    let saiu = null;
    try {
      await NFPR.Donation.doar(chave, '11222333000181');
      saiu = '(enviou)';
    } catch (e) {
      saiu = e.codigo;
    }
    ok('...and it stops the send, so nothing reaches the site', saiu, 'REDE');

    // Switching it on must be felt at once, and reported as a network outage
    // rather than "site fora do ar" — interfaceViva() is what keeps the whole
    // file agreeing about that.
    ok('...and the drop is announced immediately, as REDE', quedas, ['REDE']);

    Debug.ligar({ forcarConexao: 'online' });
    ok('forcarConexao=online proves reachability with no request',
      await sonda.verificarAgora(), true);
    ok('...and the recovery is announced, so parked notes resend', voltas, 1);
    // Release it, or its backoff timer keeps this process alive for ever and it
    // goes on reacting to every Debug.ligar in the blocks below.
    sonda.parar();

    // --- fixed part creation opens up ----------------------------------------
    // The same strip field the strictness block above drives, so the bypass is
    // exercised exactly where the guard is.
    (function () {
      Debug.limpar();
      digitarParteFixa('35' + '?'.repeat(42));
      ok('a foreign-state fixed part is still refused while disarmed', parteFixaBloqueada(), true);
      Debug.ligar({ partesFixasSemValidacao: true });
      digitarParteFixa('35' + '?'.repeat(42));
      ok('...and accepted once partesFixasSemValidacao is armed', parteFixaBloqueada(), false);
      digitarParteFixa('');
    })();

    // --- the "Recomeçar" card deletes exactly what it says -------------------
    // The load-bearing part is the negative: wiping the flags mid-session would
    // take the fake clock out from under whatever you were testing.
    await Debug.gravar('nfpr:config', { entidades: [{ id: 'x' }] });
    await Debug.gravar('nfpr:fila', [{ chave: '4'.repeat(44), cnpj: null }]);
    Debug.ligar({ relogioFixo: { ano: 2030, mes: 6 } });

    await Debug.apagar(['nfpr:fila']);
    let restante = await Debug.despejar();
    ok('emptying the queue leaves config and the debug record alone',
      [!!restante['nfpr:fila'], !!restante['nfpr:config'], !!restante['nfpr:debug']],
      [false, true, true]);

    await Debug.apagar(['nfpr:config', 'nfpr:fila']);
    restante = await Debug.despejar();
    ok('...and wiping the volunteer\'s data still leaves the debug record',
      [!!restante['nfpr:config'], !!restante['nfpr:debug']], [false, true]);
    ok('...so the fake clock survives the wipe',
      NFPR.Relogio.mesCorrente(), { ano: 2030, mes: 6 });
    // An absent nfpr:config is a fresh one, which is why no reload is needed.
    const zerada = await NFPR.Config.obterConfig();
    ok('...and Config reads defaults back out of nothing',
      [zerada.entidades, zerada.parteFixaAtivaId, zerada.preferencias.somAlerta], [[], null, true]);
    Debug.limpar();

    // --- the seven-click gesture --------------------------------------------
    // Driven through the real document-level listener, the way a scanner is
    // driven through the real capture engine above.
    // Its own scope: its helpers reuse names taken earlier in this function.
    {
      Debug.limpar();
      const contagens = [];
      let ativou = null;

      const parar = NFPR.DebugUI.observarGesto({
        seletor: 'span.fn.org',
        aoContar: (faltam) => contagens.push(faltam),
        aoAtivar: (jaEstava) => { ativou = jaEstava; }
      });
      // The stub document has no host page, so observarGesto's absent-target
      // warning fires here every run. That is nominal — and worth asserting,
      // because that one line is all that stands between a typo'd selector and
      // a gesture that silently never works.
      await new Promise((r) => setTimeout(r, 0)); // let the deferred check run
      ok('the gesture reports a selector that matches nothing',
        avisos.some((m) => m.indexOf('span.fn.org') !== -1), true);
      const noAlvo = { closest: (s) => (s === 'span.fn.org' ? noAlvo : null) };
      const foraDoAlvo = { closest: () => null };
      const clicarEm = (alvo, n) => {
        for (let i = 0; i < (n || 1); i += 1) {
          for (const fn of ouvintes.click || []) fn({ target: alvo });
        }
      };

      clicarEm(noAlvo, 6);
      ok('six clicks are not seven', [Debug.estaAtivo(), ativou], [false, null]);
      ok('...and the last four count down out loud', contagens, [4, 3, 2, 1]);
      clicarEm(noAlvo, 1);
      ok('the seventh arms the mode, with every flag still off',
        [Debug.estaAtivo(), ativou, Debug.resumo()], [true, false, []]);

      // Repeating the gesture while armed is INERT: the caller is told so it
      // can say "you are already a developer", and nothing else moves — no
      // re-arming, no flags touched, and (by having no such call at all) no
      // page opened. The flags form stays reachable only from the banner.
      Debug.ligar({ ignorarDuplicadas: true });
      ativou = null;
      contagens.length = 0;
      clicarEm(noAlvo, 7);
      ok('repeating it while armed reports that it was already on', ativou, true);
      ok('...still counts, so the caller can swap the message', contagens, [4, 3, 2, 1]);
      ok('...and changes nothing about the state',
        [Debug.estaAtivo(), Debug.flags().ignorarDuplicadas], [true, true]);

      // "Consecutive" is enforced: one click anywhere else breaks the run.
      Debug.limpar();
      ativou = null;
      clicarEm(noAlvo, 3);
      clicarEm(foraDoAlvo, 1);
      clicarEm(noAlvo, 6);
      ok('a click elsewhere restarts the count', [Debug.estaAtivo(), ativou], [false, null]);
      clicarEm(noAlvo, 1);
      ok('...and the run that follows still arms it at seven', Debug.estaAtivo(), true);

      // THE STATE THE GESTURE MUST NOT INHERIT. "Voltar à segurança" keeps the
      // flags on purpose, and `ligar` merges — so a gesture on a machine where
      // debug mode was once used re-armed a live red-key bypass. Every check
      // above starts from Debug.limpar(), which removes exactly that state.
      Debug.limpar();
      Debug.ligar({ aceitarChavesInvalidas: true, simularEnvio: false, relogioFixo: { ano: 2030, mes: 6 } });
      Debug.desligar();
      ok('left behind: a bypass flag, disarmed', [Debug.estaAtivo(), Debug.flags().aceitarChavesInvalidas],
        [false, true]);
      clicarEm(noAlvo, 7);
      ok('...and the gesture arms with every flag off anyway',
        [Debug.estaAtivo(), Debug.resumo(), Debug.flags().relogioFixo], [true, [], null]);

      // An element that is not the target must never match, which is what keeps
      // our own shadow-root clicks (retargeted to the host) out of the count.
      parar();
      Debug.limpar();
      clicarEm(noAlvo, 7);
      ok('the listener really is removed', Debug.estaAtivo(), false);

      // The debug page exists in the modal, built during UI.montar above, and
      // is reachable only by name — no header button leads to it.
      ok('the modal has a Depuração page',
        criados.some((e) => e.textContent === 'Depuração'), true);
      ok('...and "Cuidado!" is a button, not a link',
        (criados.find((e) => e.textContent === 'Cuidado!') || {}).tagName, 'BUTTON');

      // "Fila esvaziada." answers a click; it is not state. Closing the overlay
      // must clear it, or the next open still shows an answer to a question
      // nobody just asked. Emptying it is also what hides it again.
      //
      // ALL of them, not the first: this form has three one-shot lines now
      // (cleanup, clock, smoke), and each new one has to be added to aoFechar by
      // hand. Asserting the class rather than a chosen element is what makes the
      // fourth one fail here instead of on a volunteer's screen.
      const antes = criados.length;
      const painelDbg = NFPR.DebugUI.montar(elemento());
      const novos = criados.slice(antes);
      const estados = novos.filter((e) => e.tagName === 'P' && /nfpr-help-status/.test(e.className));
      estados.forEach((e, i) => { e.textContent = 'resposta ' + i; });
      painelDbg.aoFechar();
      ok('closing the overlay clears every one-shot status line',
        estados.map((e) => e.textContent + '|' + /nfpr-help-ok|nfpr-help-err/.test(e.className)),
        estados.map(() => '|false'));
      ok('...and there are three of them', estados.length, 3);

      // The smoke button is the fixture generator run as a check. It must reach
      // Debug.smoke, and the page — not just the console — has to carry the
      // answer, because this form exists for the machine with no devtools open.
      const botaoSmoke = novos.find((e) => e.textContent === 'Conferir os vereditos');
      ok('the debug page has a button that runs the whole verdict table',
        !!(botaoSmoke && botaoSmoke.escutas.click), true);
      // It prints a row per case, which is the point in a browser and pure
      // noise here — console.debug is already captured a few hundred lines up.
      const logOriginal = console.log;
      const tableOriginal = console.table;
      console.log = noop;
      console.table = noop;
      for (const fn of botaoSmoke.escutas.click || []) fn({});
      console.log = logOriginal;
      console.table = tableOriginal;
      // The count is read from Debug.smoke itself, so adding a fixture does not
      // break this line.
      const totalCasos = Debug.smoke({ silencioso: true }).total;
      ok('...and it reports the result on the page, not only in the console',
        estados.some((e) => e.textContent.indexOf(totalCasos + ' de ' + totalCasos + ' casos') !== -1 &&
          /nfpr-help-ok/.test(e.className)), true);
      painelDbg.aoFechar();

      // --- the month/year pair is ONE value -----------------------------------
      // Filling one box used to write relogioFixo: null, and the repaint that
      // followed wiped the digits that had just been typed.
      Debug.limpar();
      const campo = (ph) => novos.find((e) => e.placeholder === ph);
      const mes = campo('mês');
      // The year box takes the key's own two digits, so the FIELD and the
      // RECORD are in different formats and every assertion below crosses that
      // seam on purpose: type '30', store { ano: 2030 }.
      const ano = campo('aa');
      const digitar = (campoEl, v) => {
        campoEl.value = v;
        for (const fn of campoEl.escutas.input || []) fn({});
      };

      digitar(mes, '12');
      ok('half a pair writes nothing...', Debug.valor('relogioFixo'), null);
      ok('...and is not wiped by the repaint', [mes.value, ano.value], ['12', '']);

      // A change elsewhere repaints the whole form — the half-typed pair has to
      // survive that too, which the focus guard alone never covered.
      Debug.ligar({ ignorarDuplicadas: true });
      ok('...nor by a repaint triggered by another control', [mes.value, ano.value], ['12', '']);

      digitar(ano, '30');
      ok('completing the pair composes the century',
        Debug.valor('relogioFixo'), { ano: 2030, mes: 12 });
      ok('...and the whole extension moves with it',
        NFPR.Relogio.mesCorrente(), { ano: 2030, mes: 12 });
      // The record is 2030 and the box says 30 — the repaint has to convert
      // BACK, or the field loses a century every time another control changes.
      Debug.ligar({ ignorarDuplicadas: false });
      ok('...and a repaint puts two digits back in the box, not four', Number(ano.value), 30);

      // Out of range is incomplete, not "clear it".
      digitar(mes, '13');
      ok('an impossible month leaves the stored value alone',
        [Debug.valor('relogioFixo'), mes.value], [{ ano: 2030, mes: 12 }, '13']);

      // '00' is a year, not an empty box: 2000 is inside the band and the pair
      // is complete. Anything reading it as falsy sends the form back to the
      // real clock while the volunteer is looking at two filled boxes.
      digitar(mes, '12');
      digitar(ano, '00');
      ok('year 00 is the year 2000, not a blank', Debug.valor('relogioFixo'), { ano: 2000, mes: 12 });
      digitar(ano, '99');
      ok('99 is the top of the band', Debug.valor('relogioFixo'), { ano: 2099, mes: 12 });
      // Four digits is what someone typing out of habit produces, and it must
      // not silently become the year 2026 + 2000.
      digitar(ano, '2026');
      ok('...and a four-digit year is refused, leaving the digits alone',
        [Debug.valor('relogioFixo'), ano.value], [{ ano: 2099, mes: 12 }, '2026']);
      digitar(ano, '30');

      // Emptying BOTH is how you go back to the real clock.
      digitar(mes, '');
      digitar(ano, '');
      ok('clearing both boxes restores the real clock', Debug.valor('relogioFixo'), null);
      Debug.limpar();
    }

    // --- and it all switches back off ---------------------------------------
    // desligar keeps the flags but makes every one of them inert — which is
    // exactly what the banner's "Voltar à segurança" button does. Armed here
    // explicitly rather than inheriting whatever the blocks above left, so
    // reordering them cannot quietly hollow this out.
    Debug.ligar({ partesFixasSemValidacao: true, forcarConexao: 'offline' });
    const guardadas = Debug.desligar();
    ok('desligar keeps the flags on record', guardadas.partesFixasSemValidacao, true);
    ok('...but nothing reads them any more',
      [Debug.estaAtivo(), Debug.on('partesFixasSemValidacao'), Debug.valor('forcarConexao'),
       Debug.ajustarVeredito(vermelho).gravidade],
      [false, false, null, 'entrada']);
    await Debug.limpar();

    // Hand the console back, then account for what was swallowed. Everything
    // debug.js and debug-ui.js say for themselves is expected; anything else
    // was a real warning that this run would otherwise have buried.
    console.debug = debugOriginal;
    const ESPERADO = /(MODO DE DEPURAÇÃO LIGADO|modo de depuração desligado|registro de depuração apagado|gesto de depuração)/;
    const inesperados = avisos.filter((m) => !ESPERADO.test(m));
    inesperados.forEach((m) => console.error('UNEXPECTED WARN  ' + m));
    ok('nothing warned except debug mode announcing itself', inesperados.length, 0);

    marco('debug mode ships inert, opens every gate it claims, and closes them again' +
      ' (' + avisos.length + ' avisos previstos silenciados)');

    // =========================================================================
    // THE ORCHESTRATOR, DRIVEN FOR REAL
    // =========================================================================
    // content.js is excluded from the module list at the top of this file
    // because it "starts doing real work the moment it loads". That real work
    // is THE DRAIN — the loop that replays nfpr:fila on page load — and it was
    // therefore the largest completely uncovered thing in the codebase.
    //
    // So instead of avoiding the startup, this USES it: seed nfpr:config and
    // nfpr:fila into a fresh world, load the full module list INCLUDING
    // content.js, and the restore loop drives processar() over every seeded
    // note. Nothing in src/ had to change to make this reachable.
    //
    // ITS OWN WORLD, because the reason for the original exclusion is real:
    // content.js installs a document keydown listener, a connectivity watchdog
    // and a Config subscription that would otherwise outlive this checkpoint
    // and sit underneath every one after it.
    //
    // WHAT IT PINS. The drain-time re-judge is a gate with a bypass: a note the
    // volunteer's "enviar tudo" preference carried past a verdict must be sent
    // anyway, and its permission to do that is FROZEN ON THE NOTE (nfpr:fila's
    // semValidacao) rather than read live from the preference. Get that wrong
    // and an offline batch is destroyed on the next page load, silently — the
    // row looks exactly like an ordinary refusal. Nothing else can catch it:
    // the scan-side checkpoint above cannot reach processar at all.
    const mundoOrq = criarMundo();
    // debug-ui.js arms a timer that warns when the host page has no
    // span.fn.org to hang the 7-click gesture on — true of every stub, and the
    // one warning expected here. Captured rather than printed, and what is
    // asserted afterwards is that A DRAIN WARNS ABOUT NOTHING ELSE: an
    // orchestrator quietly complaining its way through a thousand notes is
    // something no volunteer would ever report.
    const avisosOrq = [];
    const debugAntesOrq = console.debug;
    console.debug = function () { avisosOrq.push(Array.prototype.join.call(arguments, ' ')); };
    const postados = [];
    // A token GET that parses, and a POST that lands terminally so no retry
    // timer ever arms — this checkpoint settles on microtasks alone.
    mundoOrq.sandbox.fetch = (u, o) => {
      if (o && o.method === 'POST') {
        postados.push(JSON.parse(o.body));
        return Promise.resolve({
          ok: true, status: 200, redirected: false, type: 'basic', url: String(u),
          json: () => Promise.resolve({ mensagem: 'Documento fiscal doado com sucesso!' })
        });
      }
      return Promise.resolve({
        ok: true, status: 200, redirected: false, type: 'basic', url: String(u),
        ...corpoDe('<html></html>')
      });
    };
    mundoOrq.sandbox.DOMParser = class {
      parseFromString() {
        return { querySelector: () => ({ value: 'tok' }), body: { textContent: '' } };
      }
    };

    // Load everything except the orchestrator first, so its own Chave/Relogio
    // build the fixtures — same reason the registrar block builds from the real
    // clock rather than a written date: nothing here can rot into next month.
    const semOrquestrador = todosOsModulos.filter((f) => !/content\.js$/.test(f));
    for (const rel of semOrquestrador) {
      vm.runInContext(fs.readFileSync(path.join(raiz, rel), 'utf8'),
        mundoOrq.sandbox, { filename: rel });
    }
    const O = mundoOrq.sandbox.NFPR;
    const agoraOrq = O.Relogio.mesCorrente();
    const chaveOrq = (aa, mm, uf) => {
      const b43 = (uf || '41') + aa + mm + '61803398874911' + '65' + '001' + '000012345' + '1' + '87654321';
      return b43 + O.Chave.calcularCDV(b43 + '0');
    };
    const aaOrq = String(agoraOrq.ano - 2000).padStart(2, '0');
    const mmOrq = String(agoraOrq.mes).padStart(2, '0');
    const boaOrq = chaveOrq(aaOrq, mmOrq);
    // Same digits, last one changed: our table calls it red.
    const ruimOrq = boaOrq.slice(0, 43) + (boaOrq[43] === '7' ? '6' : '7');
    // Grey WITHOUT a clock: a São Paulo note is undonatable whatever the date.
    const foraOrq = chaveOrq(aaOrq, mmOrq, '35');
    // Grey only BY the clock: long past the deadline. The drain no longer
    // judges that — the server does, on its own clock.
    const velhaOrq = chaveOrq('20', '01');
    ok('the orchestrator fixtures are what this checkpoint assumes',
      [O.Chave.avaliar(boaOrq, agoraOrq).gravidade || 'ok',
       O.Chave.avaliar(ruimOrq, agoraOrq).gravidade,
       O.Chave.avaliar(foraOrq, null).gravidade,
       O.Chave.avaliar(velhaOrq, agoraOrq).gravidade,
       O.Chave.avaliar(velhaOrq, null).gravidade],
      ['ok', 'entrada', 'inelegivel', 'inelegivel', null]);

    // `verificada: true` IS LOAD-BEARING and cost an afternoon to find. Without
    // it the pre-drain re-verification runs, the stubbed registry answer does
    // not look like a hit, the entity is latched as REFUSED — and then nothing
    // sends at all and every assertion below passes while testing nothing.
    mundoOrq.guardado['nfpr:config'] = {
      versaoConfig: 1,
      entidades: [{ id: 'e1', nome: 'E', cnpj: '11222333000181', verificada: true }],
      entidadeAtivaId: 'e1', partesFixas: [], parteFixaAtivaId: null, preferencias: {}
    };
    mundoOrq.guardado['nfpr:fila'] = [
      { chave: ruimOrq, cnpj: '11222333000181', em: Date.now(),
        semValidacao: 'A chave informada não é válida.' },
      { chave: foraOrq, cnpj: '11222333000181', em: Date.now(), semValidacao: null },
      { chave: velhaOrq, cnpj: '11222333000181', em: Date.now(), semValidacao: null },
      { chave: boaOrq, cnpj: '11222333000181', em: Date.now(), semValidacao: null }
    ];

    vm.runInContext(fs.readFileSync(path.join(raiz, 'src/content/content.js'), 'utf8'),
      mundoOrq.sandbox, { filename: 'src/content/content.js' });

    // Despacho is pure-promise with no timers, so draining the microtask queue
    // settles the whole pool. (Config.removerDaFila coalesces over a 200 ms
    // window, which is why the assertions below read the REQUESTS that were
    // made rather than what is left in nfpr:fila — the stronger claim in any
    // case: what matters is whether the note was sent.)
    for (let i = 0; i < 200; i += 1) await new Promise((r) => setImmediate(r));

    console.debug = debugAntesOrq;
    ok('draining a restored queue warns about nothing of its own',
      avisosOrq.filter((m) => m.indexOf('span.fn.org') === -1), []);

    const enviadas = postados.map((p) => p.chaveAcesso);
    ok('the drain skips its re-judge for a note the bypass already carried',
      enviadas.includes(ruimOrq), true);
    ok('...and still refuses an ineligible note without spending a request',
      enviadas.includes(foraOrq), false);
    // THE DEADLINE IS THE SERVER'S AT DRAIN TIME. Judged on the volunteer's
    // clock, a wrong clock destroyed whole restored batches; the server's clock
    // is the right one, and a note that really expired comes back grey from it.
    ok('...but leaves the deadline to the server, sending an expired note to be judged there',
      enviadas.includes(velhaOrq), true);
    ok('...while an ordinary good note goes out as always',
      enviadas.includes(boaOrq), true);
    ok('exactly three of the four restored notes reached the server',
      enviadas.length, 3);
    // Each POST carries the note's own frozen target and a token of its own —
    // the drain must not batch or share either.
    ok('every drained POST carries its frozen target and its own token',
      [postados.every((p) => p.cnpjEntidade === '11222333000181'),
       postados.every((p) => p.value === 'tok'),
       postados.every((p) => p.documentoComChaveAcesso === 'true')],
      [true, true, true]);

    // --- the dead session found by the OTHER door ----------------------------
    // Sessao.conferir() proves it when the volunteer opens the site's entity
    // dialog. Nothing about that is special to the dialog: it is the same
    // condition a note comes back with, so it must reach the same latch — pool
    // paused, bar painted, one way out. The bug this pins is a private toast
    // and a queue that keeps going.
    const barraOrq = mundoOrq.criados.find((e) => e.className === 'nfpr-sessao-cond-bar');
    ok('the orchestrator starts with no session bar', !!barraOrq.atributos.hidden, true);
    mundoOrq.sandbox.fetch = () => Promise.resolve({ type: 'opaqueredirect', status: 0 });
    await O.Sessao.conferir();
    for (let i = 0; i < 50; i += 1) await new Promise((r) => setImmediate(r));
    const msgOrq = mundoOrq.criados.find((e) => e.className === 'nfpr-sessao-cond-msg');
    const linkOrq = mundoOrq.criados.find((e) => e.className === 'nfpr-sessao-cond-link');
    ok('a session proved dead by the probe paints the same bar as a failed note',
      [!!barraOrq.atributos.hidden, msgOrq.textContent, linkOrq.atributos.href],
      [false, O.Donation.MSG_SESSAO + ' As notas continuam guardadas.',
       O.Donation.LINK_LOGIN.href]);

    marco('the orchestrator drains a restored queue, gate and bypass alike');

    // =========================================================================
    // A DRAIN DESTROYS NOTHING IT DID NOT SEND
    // =========================================================================
    // Two ways a restored batch used to vanish on load without one request
    // reaching the site: the volunteer's clock being wrong, and debug mode's
    // simulated send. Each gets a fresh world of its own, seeded and drained
    // exactly like the checkpoint above; what is read back is what was POSTed
    // and what is left in nfpr:fila once removerDaFila's 200 ms coalescing
    // window has closed.
    const drenarEmMundoNovo = async (fila, debug) => {
      const mundo = criarMundo();
      const debugAntes = console.debug;
      console.debug = noop; // debug mode announcing itself; asserted elsewhere
      const postadas = [];
      mundo.sandbox.fetch = (u, o) => {
        if (o && o.method === 'POST') {
          postadas.push(JSON.parse(o.body).chaveAcesso);
          return Promise.resolve({
            ok: true, status: 200, redirected: false, type: 'basic', url: String(u),
            json: () => Promise.resolve({ mensagem: 'Documento fiscal doado com sucesso!' })
          });
        }
        return Promise.resolve({
          ok: true, status: 200, redirected: false, type: 'basic', url: String(u),
          ...corpoDe('<html></html>')
        });
      };
      mundo.sandbox.DOMParser = class {
        parseFromString() {
          return { querySelector: () => ({ value: 'tok' }), body: { textContent: '' } };
        }
      };
      if (debug) mundo.guardado['nfpr:debug'] = { ativo: true, flags: debug };
      mundo.guardado['nfpr:config'] = {
        versaoConfig: 1,
        entidades: [{ id: 'e1', nome: 'E', cnpj: '11222333000181', verificada: true }],
        entidadeAtivaId: 'e1', partesFixas: [], parteFixaAtivaId: null, preferencias: {}
      };
      mundo.guardado['nfpr:fila'] = fila.map((chave) =>
        ({ chave, cnpj: '11222333000181', em: Date.now(), semValidacao: null }));
      for (const rel of semOrquestrador) {
        vm.runInContext(fs.readFileSync(path.join(raiz, rel), 'utf8'), mundo.sandbox, { filename: rel });
      }
      // What each row was TOLD, recorded at the panel's door: the stub's text
      // nodes keep no text, so the rendered row cannot be read back.
      const linhas = [];
      const montarReal = mundo.sandbox.NFPR.UI.montar;
      mundo.sandbox.NFPR.UI.montar = async function () {
        const u = await montarReal.apply(this, arguments);
        const atualizarReal = u.atualizarItem;
        u.atualizarItem = function (id, dados) {
          linhas.push(dados);
          return atualizarReal.apply(u, arguments);
        };
        return u;
      };
      vm.runInContext(fs.readFileSync(path.join(raiz, 'src/content/content.js'), 'utf8'),
        mundo.sandbox, { filename: 'src/content/content.js' });
      for (let i = 0; i < 200; i += 1) await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 250)); // past removerDaFila's coalescing
      console.debug = debugAntes;
      return {
        postadas,
        restantes: (mundo.guardado['nfpr:fila'] || []).map((e) => e.chave),
        linhas
      };
    };
    // A note of September 2026: a month-back clock calls it FUTURA (red), a
    // clock four months on calls it EXPIRADA (grey). Neither is true.
    const notaDeSetembro = chaveOrq('26', '09');
    ok('the clock fixtures are what this checkpoint assumes',
      [O.Chave.avaliar(notaDeSetembro, { ano: 2026, mes: 8 }).codigo,
       O.Chave.avaliar(notaDeSetembro, { ano: 2027, mes: 1 }).codigo,
       O.Chave.avaliar(notaDeSetembro, { ano: 2026, mes: 9 }).codigo],
      ['FUTURA', 'EXPIRADA', 'OK']);
    const atrasado = await drenarEmMundoNovo([notaDeSetembro], { relogioFixo: { ano: 2026, mes: 8 } });
    ok('a clock set BACKWARDS no longer destroys a restored note: it is sent',
      atrasado.postadas, [notaDeSetembro]);
    const adiantado = await drenarEmMundoNovo([notaDeSetembro], { relogioFixo: { ano: 2027, mes: 1 } });
    ok('...nor does a clock set FORWARDS: the deadline is the server\'s to judge',
      adiantado.postadas, [notaDeSetembro]);

    // A SIMULATED SEND PROVES NOTHING AND DELETES NOTHING. The success path it
    // used to take removes the note from nfpr:fila, so a restored batch drained
    // on an armed page was gone — every note labelled "Simulação", none sent.
    const simulado = await drenarEmMundoNovo([boaOrq, notaDeSetembro], { simularEnvio: true });
    ok('a drain under simularEnvio sends nothing', simulado.postadas, []);
    ok('...and leaves every restored note in nfpr:fila',
      simulado.restantes.slice().sort(), [boaOrq, notaDeSetembro].sort());
    const finais = simulado.linhas.filter((d) => d.estado !== 'enviando');
    ok('...and says so on each row, amber rather than green',
      finais.map((d) => [d.estado, /^Simulação: nada foi enviado/.test(d.mensagem)]),
      [['aguardando', true], ['aguardando', true]]);

    marco('a drain destroys nothing it did not send');

    // =========================================================================
    // REDIRECTING A REFUSED TARGET, MID-DRAIN
    // =========================================================================
    // "Enviar para X" on the refused-entity bar is the ONE place a frozen
    // target is ever rewritten, and the whole question is WHEN the click lands.
    // Notes park one at a time, as the pool feeds each to processar and it hits
    // the refused-target check — so on a restored batch the click almost always
    // arrives while most of them are still WAITING in the pool, never parked,
    // holding the refused CNPJ in memory. Clearing the latch re-opens the check
    // for exactly those, and they went straight back out to the CNPJ the
    // volunteer had just moved them off.
    //
    // Unassertable anywhere else: it is not a property of a function, it is a
    // property of the moment. So this clicks the bar FROM INSIDE the paint that
    // announces it, which is exactly that moment and nothing has to be timed.
    const mundoRedir = criarMundo();
    const CNPJ_RECUSADO = '11222333000181';
    const CNPJ_BOM = '11444777000161';
    const avisosRedir = [];
    const debugAntesRedir = console.debug;
    console.debug = function () { avisosRedir.push(Array.prototype.join.call(arguments, ' ')); };
    const postadosRedir = [];
    let refusas = 0;
    mundoRedir.sandbox.fetch = (u, o) => {
      if (o && o.method === 'POST') {
        const corpo = JSON.parse(o.body);
        postadosRedir.push(corpo);
        // The refusal is a fact about the CONFIGURATION and is deterministic:
        // the same CNPJ is refused every time it is asked about. The good one
        // answers a real success, so re-aimed notes settle instead of taking
        // the retry ladder, whose waits are real timers this harness cannot
        // advance.
        const mau = corpo.cnpjEntidade === CNPJ_RECUSADO;
        const resposta = {
          ok: !mau, status: mau ? 400 : 200, redirected: false, type: 'basic', url: String(u),
          json: () => Promise.resolve(
            mau
              ? { cnpjEntidade: 'Entidade não cadastrada para receber doações.' }
              : { mensagem: 'Documento fiscal doado com sucesso!' }
          )
        };
        if (!mau) return Promise.resolve(resposta);
        // THE FIRST REFUSAL HAS TO LAND ALONE, and this is what makes the
        // checkpoint discriminate at all. The pool sends LARGURA_ENVIO at once;
        // if every answer resolves in the same microtask drain, a sibling
        // refusal re-latches before the pool can dispatch anything, and the bug
        // hides behind its own siblings. Real latency spreads them out, so the
        // rest are held while the first one is acted on — which is precisely
        // the window the volunteer clicks in.
        refusas += 1;
        const atraso = refusas === 1 ? 0 : 400;
        return new Promise((r) => setTimeout(() => r(resposta), atraso));
      }
      return Promise.resolve({
        ok: true, status: 200, redirected: false, type: 'basic', url: String(u),
        ...corpoDe('<html></html>')
      });
    };
    mundoRedir.sandbox.DOMParser = class {
      parseFromString() {
        return { querySelector: () => ({ value: 'tok' }), body: { textContent: '' } };
      }
    };
    for (const rel of semOrquestrador) {
      vm.runInContext(fs.readFileSync(path.join(raiz, rel), 'utf8'),
        mundoRedir.sandbox, { filename: rel });
    }
    const R = mundoRedir.sandbox.NFPR;
    const agoraRedir = R.Relogio.mesCorrente();
    const chaveRedir = (n) => {
      const b43 = '41' + String(agoraRedir.ano - 2000).padStart(2, '0') +
        String(agoraRedir.mes).padStart(2, '0') + '61803398874911' + '65' + '001' +
        String(1000000000 + n).slice(1) + '1' + '87654321';
      return b43 + R.Chave.calcularCDV(b43 + '0');
    };
    // Enough that the pool (LARGURA_ENVIO 6) cannot possibly have fed them all
    // through processar by the time the first refusal comes back.
    const filaRedir = [];
    for (let i = 0; i < 24; i += 1) {
      filaRedir.push({ chave: chaveRedir(i), cnpj: CNPJ_RECUSADO, em: Date.now(), semValidacao: null });
    }
    // The ACTIVE entity is the good one while the queue is aimed at the refused
    // one — the real shape of this: a batch queued offline against a CNPJ that
    // turns out not to be registered, and a working entity chosen afterwards.
    // It is also what makes the bar offer "Enviar para" rather than "Abrir
    // configurações", which is the button under test.
    mundoRedir.guardado['nfpr:config'] = {
      versaoConfig: 1,
      entidades: [
        { id: 'mau', nome: 'Recusada', cnpj: CNPJ_RECUSADO, verificada: true },
        { id: 'bom', nome: 'Boa', cnpj: CNPJ_BOM, verificada: true }
      ],
      entidadeAtivaId: 'bom', partesFixas: [], parteFixaAtivaId: null, preferencias: {}
    };
    mundoRedir.guardado['nfpr:fila'] = filaRedir;

    // Click the bar from inside the paint that creates it — the mid-drain
    // instant, with the latch just closed and the queue still full. Once only:
    // the redirect repaints, and a re-latch from work already in flight paints
    // again, neither of which is a new decision by the volunteer.
    let cliques = 0;
    let postadosNoClique = 0;
    const montarRealRedir = R.UI.montar;
    R.UI.montar = async function (op) {
      const api = await montarRealRedir.call(R.UI, op);
      const setReal = api.setEntidadeRecusada;
      api.setEntidadeRecusada = function (info) {
        const r = setReal.call(api, info);
        if (info && /^Enviar para/.test(info.rotulo || '') && !cliques) {
          cliques += 1;
          postadosNoClique = postadosRedir.length;
          info.aoClicar();
        }
        return r;
      };
      return api;
    };

    vm.runInContext(fs.readFileSync(path.join(raiz, 'src/content/content.js'), 'utf8'),
      mundoRedir.sandbox, { filename: 'src/content/content.js' });
    // SETTLING HERE NEEDS REAL TIME, not just microtasks. A note leaving the
    // queue goes through Config.removerDaFila, which coalesces over a 200 ms
    // window, and processar does not return until that resolves — so a pool
    // slot is not freed until the timer fires. The other orchestrator
    // checkpoint settles on microtasks alone only because it sends fewer notes
    // than the pool is wide, so it never waits for a slot.
    for (let i = 0; i < 12; i += 1) {
      await new Promise((r) => setTimeout(r, 120));
      for (let j = 0; j < 40; j += 1) await new Promise((r) => setImmediate(r));
    }
    console.debug = debugAntesRedir;

    const paraRecusado = postadosRedir.filter((p) => p.cnpjEntidade === CNPJ_RECUSADO);
    const depoisDoClique = postadosRedir.slice(postadosNoClique)
      .filter((p) => p.cnpjEntidade === CNPJ_RECUSADO);
    ok('the refused target is discovered once and then latched', cliques, 1);
    // THE ASSERTION THIS CHECKPOINT EXISTS FOR. Before the fix the pool went on
    // dispatching its still-pending notes at the refused CNPJ the instant the
    // latch was cleared, and the bar came back seconds after being fixed.
    ok('...and not one request goes to it after the queue is moved off',
      depoisDoClique.length, 0);
    // In-flight requests cannot be recalled, so the ceiling is what the pool
    // had out when the latch closed — never the size of the batch.
    ok('the refused CNPJ never sees more requests than the pool is wide',
      paraRecusado.length <= 6, true);
    // The redirect is only worth anything if the notes actually go somewhere.
    // Everything except the in-flight residue: those few come back refused,
    // re-latch, and park for a second click, which is documented and bounded.
    ok('the whole batch bar the in-flight few is re-aimed at the working entity',
      postadosRedir.filter((p) => p.cnpjEntidade === CNPJ_BOM).length >= 24 - 6, true);
    ok('redirecting a refused target warns about nothing of its own',
      avisosRedir.filter((m) => m.indexOf('span.fn.org') === -1), []);

    // --- ...and with nothing to move, choosing a working entity clears the bar -
    // The refusal is latched per CNPJ for the life of the page, so the bar used
    // to survive the fix: the volunteer switched to a good entity and the bar
    // stayed, now offering to move zero notes to it — which reads as the NEW
    // entity being the one refused. Here the refusal comes from the registry at
    // load (an unverified entity, a 404), the queue is empty, and the switch is
    // an ordinary config write.
    {
      const mundoVazio = criarMundo();
      // The shared stub has no onChanged, and the switch below is only seen by
      // content.js through one. This world gets a real one: every write fires
      // its listeners the way chrome.storage does, after the value is stored.
      const ouvintesStorage = [];
      const armazem = mundoVazio.sandbox.chrome.storage;
      const setOriginal = armazem.local.set;
      armazem.onChanged = {
        addListener: (f) => ouvintesStorage.push(f),
        removeListener: (f) => { const i = ouvintesStorage.indexOf(f); if (i !== -1) ouvintesStorage.splice(i, 1); }
      };
      armazem.local.set = async (o) => {
        await setOriginal(o);
        const mudancas = {};
        for (const k of Object.keys(o)) mudancas[k] = { newValue: o[k] };
        ouvintesStorage.forEach((f) => f(mudancas, 'local'));
      };
      mundoVazio.sandbox.fetch = (u) => Promise.resolve(
        String(u).indexOf(CNPJ_RECUSADO) !== -1
          ? { ok: false, status: 404, redirected: false, type: 'basic', url: String(u),
              json: () => Promise.resolve({}) }
          : { ok: true, status: 200, redirected: false, type: 'basic', url: String(u),
              json: () => Promise.resolve({}), ...corpoDe('<html></html>') }
      );
      for (const rel of semOrquestrador) {
        vm.runInContext(fs.readFileSync(path.join(raiz, rel), 'utf8'),
          mundoVazio.sandbox, { filename: rel });
      }
      const V = mundoVazio.sandbox.NFPR;
      mundoVazio.guardado['nfpr:config'] = {
        versaoConfig: 1,
        entidades: [
          { id: 'mau', nome: '', cnpj: CNPJ_RECUSADO, verificada: false },
          { id: 'bom', nome: 'Boa', cnpj: CNPJ_BOM, verificada: true }
        ],
        entidadeAtivaId: 'mau', partesFixas: [], parteFixaAtivaId: null, preferencias: {}
      };
      let barra = 'nunca pintada';
      const montarRealVazio = V.UI.montar;
      V.UI.montar = async function (op) {
        const api = await montarRealVazio.call(V.UI, op);
        const setReal = api.setEntidadeRecusada;
        api.setEntidadeRecusada = function (info) {
          barra = info ? info.rotulo : null;
          return setReal.call(api, info);
        };
        return api;
      };
      const avisosVazio = [];
      const debugAntesVazio = console.debug;
      console.debug = function () { avisosVazio.push(Array.prototype.join.call(arguments, ' ')); };
      vm.runInContext(fs.readFileSync(path.join(raiz, 'src/content/content.js'), 'utf8'),
        mundoVazio.sandbox, { filename: 'src/content/content.js' });
      const assentar = async () => {
        await new Promise((r) => setTimeout(r, 50));
        for (let j = 0; j < 40; j += 1) await new Promise((r) => setImmediate(r));
      };
      await assentar();
      ok('an active entity the registry refuses raises the bar, pointing at settings',
        barra, 'Abrir configurações');
      await V.Config.atualizarConfig({ entidadeAtivaId: 'bom' });
      await assentar();
      ok('...choosing a working entity with nothing aimed at the refused one clears it',
        barra, null);
      await V.Config.atualizarConfig({ entidadeAtivaId: 'mau' });
      await assentar();
      ok('...and choosing the refused one again brings it back, since the latch stays',
        barra, 'Abrir configurações');
      console.debug = debugAntesVazio;
      ok('a refused entity at load warns about nothing of its own',
        avisosVazio.filter((m) => m.indexOf('span.fn.org') === -1), []);
    }

    // --- EVERY unregistered entity the load-time lookups find is latched -------
    // Entidade.completarNomes already asks the registry about every unverified
    // entity to name them, and content.js used to read only the active one's
    // answer. An unregistered entity sitting in the list then went unnoticed
    // until it was chosen and the server refused its first note. Now every
    // answer latches: silently, and invisibly while nothing is aimed there —
    // and the bar is up the moment that entity is chosen, before any request.
    {
      const CNPJ_RECUSADO_2 = '12345678000195';
      async function mundoComDuasRecusadas(ativaId) {
        const mundo = criarMundo();
        const ouvintes = [];
        const armazem = mundo.sandbox.chrome.storage;
        const setOriginal = armazem.local.set;
        armazem.onChanged = {
          addListener: (f) => ouvintes.push(f),
          removeListener: (f) => { const i = ouvintes.indexOf(f); if (i !== -1) ouvintes.splice(i, 1); }
        };
        armazem.local.set = async (o) => {
          await setOriginal(o);
          const mudancas = {};
          for (const k of Object.keys(o)) mudancas[k] = { newValue: o[k] };
          ouvintes.forEach((f) => f(mudancas, 'local'));
        };
        const perguntados = [];
        mundo.sandbox.fetch = (u) => {
          const url = String(u);
          const recusado = url.indexOf(CNPJ_RECUSADO) !== -1 || url.indexOf(CNPJ_RECUSADO_2) !== -1;
          if (recusado) perguntados.push(url);
          return Promise.resolve(recusado
            ? { ok: false, status: 404, redirected: false, type: 'basic', url,
                json: () => Promise.resolve({}) }
            : { ok: true, status: 200, redirected: false, type: 'basic', url,
                json: () => Promise.resolve({}), ...corpoDe('<html></html>') });
        };
        for (const rel of semOrquestrador) {
          vm.runInContext(fs.readFileSync(path.join(raiz, rel), 'utf8'),
            mundo.sandbox, { filename: rel });
        }
        const N = mundo.sandbox.NFPR;
        let erros = 0;
        N.Audio.erro = () => { erros += 1; };
        mundo.guardado['nfpr:config'] = {
          versaoConfig: 1,
          entidades: [
            { id: 'mau', nome: '', cnpj: CNPJ_RECUSADO, verificada: false },
            { id: 'mau2', nome: '', cnpj: CNPJ_RECUSADO_2, verificada: false },
            { id: 'bom', nome: 'Boa', cnpj: CNPJ_BOM, verificada: true }
          ],
          entidadeAtivaId: ativaId, partesFixas: [], parteFixaAtivaId: null, preferencias: {}
        };
        const estado = { barra: 'nunca pintada', mensagem: '' };
        const montarReal = N.UI.montar;
        N.UI.montar = async function (op) {
          const api = await montarReal.call(N.UI, op);
          const setReal = api.setEntidadeRecusada;
          api.setEntidadeRecusada = function (info) {
            estado.barra = info ? info.rotulo : null;
            estado.mensagem = info ? info.mensagem : '';
            return setReal.call(api, info);
          };
          return api;
        };
        const avisos = [];
        const debugAntes = console.debug;
        console.debug = function () { avisos.push(Array.prototype.join.call(arguments, ' ')); };
        vm.runInContext(fs.readFileSync(path.join(raiz, 'src/content/content.js'), 'utf8'),
          mundo.sandbox, { filename: 'src/content/content.js' });
        const assentar = async () => {
          await new Promise((r) => setTimeout(r, 50));
          for (let j = 0; j < 40; j += 1) await new Promise((r) => setImmediate(r));
        };
        await assentar();
        console.debug = debugAntes;
        ok('latching every unregistered entity warns about nothing of its own',
          avisos.filter((m) => m.indexOf('span.fn.org') === -1), []);
        return { N, estado, assentar, erros: () => erros, perguntados };
      }

      const boaAtiva = await mundoComDuasRecusadas('bom');
      ok('the load-time lookups ask about every unverified entity, once each',
        boaAtiva.perguntados.length, 2);
      ok('with a working entity active and nothing aimed at the refused ones, no bar and no sound',
        [boaAtiva.estado.barra === null || boaAtiva.estado.barra === 'nunca pintada', boaAtiva.erros()],
        [true, 0]);
      await boaAtiva.N.Config.atualizarConfig({ entidadeAtivaId: 'mau2' });
      await boaAtiva.assentar();
      // THE ASSERTION THIS EXISTS FOR. Before, the inactive entity's answer was
      // thrown away, so choosing it raised nothing until a note was refused.
      ok('...choosing an INACTIVE entity the lookups found unregistered raises the bar at once',
        boaAtiva.estado.barra, 'Abrir configurações');
      ok('...naming both refused CNPJs, and still without a sound',
        [boaAtiva.estado.mensagem.indexOf(boaAtiva.N.Cnpj.formatar(CNPJ_RECUSADO)) !== -1,
         boaAtiva.estado.mensagem.indexOf(boaAtiva.N.Cnpj.formatar(CNPJ_RECUSADO_2)) !== -1,
         boaAtiva.erros()],
        [true, true, 0]);

      const mauAtiva = await mundoComDuasRecusadas('mau');
      ok('with a refused entity active the bar is up at load, and the alarm sounds once',
        [mauAtiva.estado.barra, mauAtiva.erros()], ['Abrir configurações', 1]);
    }

    marco('a refused target is redirected mid-drain, pool included');

    // =========================================================================
    // FIRST RUN ON A DUPLICATE SESSION
    // =========================================================================
    // The worst screen this extension can show: nothing configured, so the
    // entry is blocked and a card asks for a CNPJ, while the site also reports
    // a duplicate session and a bar asks them to log in. Two calls to action,
    // and the louder one is the wrong one — configuring now cannot verify the
    // CNPJ, so it saves an unverified entity, which is the one starting state
    // the refused-entity machinery exists to survive.
    //
    // So the panel takes the screen and finishes it: one sentence, /sair, and a
    // reload. What is pinned here is that it happens AT ALL, that it happens
    // exactly once, and that the loop guard holds.
    async function primeiroUsoComSessaoDuplicada(marcadorJaGasto, sairTrava) {
      const mundo = criarMundo();
      const principal = mundo.elemento();
      principal.textContent = 'Ops! O usuário autenticado possui mais de uma sessão ativa.';
      mundo.documentoStub.getElementById = (id) => (id === 'main' ? principal : null);
      let recargas = 0;
      mundo.sandbox.location.reload = () => { recargas += 1; };
      // A COMPRESSED CLOCK for the hanging case, so the ten-second deadline
      // costs half a second of test instead of eleven. Only that world: the
      // normal path settles in milliseconds and has no reason to distort time.
      // Date.now() is left alone, which is harmless here — the floor it feeds
      // is only read on the branch that never runs when /sair hangs.
      if (sairTrava) {
        const FATOR = 20;
        const stReal = mundo.sandbox.setTimeout;
        const siReal = mundo.sandbox.setInterval;
        mundo.sandbox.setTimeout = (fn, ms) => stReal(fn, Math.max(0, (ms || 0) / FATOR));
        mundo.sandbox.setInterval = (fn, ms) => siReal(fn, Math.max(1, (ms || 0) / FATOR));
      }
      if (marcadorJaGasto) mundo.sandbox.sessionStorage.setItem('nfpr:auto-encerrou', '1');
      const avisos = [];
      const debugAntes = console.debug;
      console.debug = function () { avisos.push(Array.prototype.join.call(arguments, ' ')); };
      // `sairTrava` is the case the countdown exists for: encerrar() has no
      // timeout of its own, so a request that never settles would leave the
      // volunteer on a takeover with no way out and no way to know.
      // `sairTrava` hangs THE /sair REQUEST ONLY. Hanging every fetch also
      // hangs ui.js's stylesheet loads, so montar() never resolves, nothing is
      // ever built, and the checkpoint passes by testing nothing.
      mundo.sandbox.fetch = (u) => (sairTrava && /sair/.test(String(u))
        ? new Promise(() => {})
        : Promise.resolve({
            ok: true, status: 200, redirected: false, type: 'basic', url: String(u),
            ...corpoDe('<html></html>'), json: () => Promise.resolve({})
          }));
      mundo.sandbox.DOMParser = class {
        parseFromString() {
          return { querySelector: () => ({ value: 'tok' }), body: { textContent: '' } };
        }
      };
      // NOTHING CONFIGURED — that is what makes this first run, and it is also
      // what makes the reload safe: with no entity the entry is blocked, so no
      // note can be queued and none can be in flight.
      mundo.guardado['nfpr:config'] = {
        versaoConfig: 1, entidades: [], entidadeAtivaId: null,
        partesFixas: [], parteFixaAtivaId: null, preferencias: {}
      };
      for (const rel of semOrquestrador) {
        vm.runInContext(fs.readFileSync(path.join(raiz, rel), 'utf8'),
          mundo.sandbox, { filename: rel });
      }
      // Capture the UI so `estaAberto` can be asked. The modal announces itself
      // open through classList, which this stub deliberately ignores, so the
      // API is the only honest witness.
      const N = mundo.sandbox.NFPR;
      let apiUI = null;
      const montarReal = N.UI.montar;
      N.UI.montar = async function (op) {
        apiUI = await montarReal.call(N.UI, op);
        return apiUI;
      };
      vm.runInContext(fs.readFileSync(path.join(raiz, 'src/content/content.js'), 'utf8'),
        mundo.sandbox, { filename: 'src/content/content.js' });
      // The reload waits out a readable floor, so this one needs real time.
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setTimeout(r, 120));
        for (let j = 0; j < 20; j += 1) await new Promise((r) => setImmediate(r));
      }
      console.debug = debugAntes;
      const takeover = mundo.criados.find((e) => e.className === 'nfpr-takeover');
      const msg = mundo.criados.find((e) => e.className === 'nfpr-takeover-msg');
      const det = mundo.criados.find((e) => e.className === 'nfpr-takeover-detalhe');
      return {
        recargas,
        avisos: avisos.filter((m) => m.indexOf('span.fn.org') === -1),
        takeoverVisivel: takeover ? !takeover.atributos.hidden : false,
        texto: msg ? msg.textContent : '',
        detalhe: det ? det.textContent : '',
        marcador: mundo.sandbox.sessionStorage.getItem('nfpr:auto-encerrou'),
        // The settings modal must NOT have opened itself. That line lived in
        // the shared bootstrap, so it fired on both registrars — first run threw
        // a three-card form at the volunteer before they had looked at the page.
        abriuSozinho: !!(apiUI && apiUI.estaAberto())
      };
    }

    const primeiro = await primeiroUsoComSessaoDuplicada(false);
    ok('first run on a duplicate session takes the screen and says one thing',
      [primeiro.takeoverVisivel, primeiro.texto], [true, 'Encerrando as sessões abertas…']);
    ok('...and reloads by itself, exactly once',
      primeiro.recargas, 1);
    ok('...leaving the one-attempt marker behind',
      primeiro.marcador, '1');
    ok('...and nothing opened the settings form on its own',
      primeiro.abriuSozinho, false);
    ok('first run warns about nothing of its own', primeiro.avisos, []);

    // THE LOOP GUARD. /sair can fail to take, and the only sign is the server
    // still reporting two sessions — so the same screen comes back. Reloading
    // again from there repeats for ever, wearing a reassuring message the whole
    // time, which is the worst way for this to break because it looks like it
    // is working. One automatic attempt, then it is the volunteer's.
    const segundo = await primeiroUsoComSessaoDuplicada(true);
    ok('a second pass never reloads again, whatever the screen still says',
      [segundo.recargas, segundo.takeoverVisivel], [0, false]);

    // THE COUNTER DECIDES NOTHING. It ticks ten seconds down because /sair
    // answers at ~10.4 s, so it very nearly IS the wait — but the reload
    // happens when the request resolves and at no other time. A counter that
    // also expired into a reload would cut /sair off just before it lands and
    // leave the duplicate session exactly where it was.
    const travado = await primeiroUsoComSessaoDuplicada(false, true);
    ok('a /sair still in flight never reloads, however long the counter has run',
      travado.recargas, 0);
    ok('...and the takeover stays up, counting, rather than freezing silently',
      [travado.takeoverVisivel, /Recarregando em \d+ s|será recarregada em instantes/
        .test(travado.detalhe)],
      [true, true]);

    marco('first run on a duplicate session finishes itself, once');

    // =========================================================================
    // THE SEND PIPELINE INVENTS NO CONDITION AND LOSES NONE
    // =========================================================================
    // Four orchestrator behaviours that are properties of a sequence rather
    // than of a function, so each gets a whole world, drained. `orquestrar`
    // is the shape every orchestrator checkpoint above writes out by hand.
    //
    // `fator` compresses the world's timers — the probe backoff starts at 4 s,
    // the watchdog's at 4 s, the retry ladder at 1.2 s — and nothing else:
    // Date.now() is untouched, and removerDaFila's 200 ms window shrinks too.
    // The token page is real text now (donation.js decodes it itself), so the
    // parser stub reads it: a page containing `tok` carries a form token, one
    // without is what a dead login serves.
    async function orquestrar(op) {
      const mundo = criarMundo();
      // Every timer the world arms is kept, so `desligar` can end it. A world
      // left with the server latch closed probes for ever, and a live timer is
      // a process that never exits.
      const timers = [];
      let desligado = false;
      {
        const fator = op.fator || 1;
        const stReal = mundo.sandbox.setTimeout;
        const siReal = mundo.sandbox.setInterval;
        mundo.sandbox.setTimeout = (fn, ms) => {
          if (desligado) return 0;
          const t = stReal(fn, Math.max(0, (ms || 0) / fator));
          timers.push(t);
          return t;
        };
        mundo.sandbox.setInterval = (fn, ms) => {
          if (desligado) return 0;
          const t = siReal(fn, op.fator ? Math.max(1, (ms || 0) / fator) : ms);
          timers.push(t);
          return t;
        };
      }
      const desligar = () => { desligado = true; timers.forEach((t) => clearTimeout(t)); };
      mundo.sandbox.fetch = op.fetch;
      mundo.sandbox.DOMParser = class {
        parseFromString(html) {
          return {
            querySelector: () => (/tok/.test(html) ? { value: 'tok' } : null),
            body: { textContent: html }
          };
        }
      };
      mundo.guardado['nfpr:config'] = op.config || {
        versaoConfig: 1,
        entidades: [{ id: 'e1', nome: 'E', cnpj: CNPJ_RECUSADO, verificada: true }],
        entidadeAtivaId: 'e1', partesFixas: [], parteFixaAtivaId: null, preferencias: {}
      };
      mundo.guardado['nfpr:fila'] = op.fila.map((e) => Object.assign(
        { cnpj: CNPJ_RECUSADO, em: Date.now(), semValidacao: null }, e));
      if (op.antes) op.antes(mundo);
      for (const rel of semOrquestrador) {
        vm.runInContext(fs.readFileSync(path.join(raiz, rel), 'utf8'), mundo.sandbox, { filename: rel });
      }
      const N = mundo.sandbox.NFPR;
      // Every module is loaded and content.js is not yet: the one moment a
      // test can stand between the orchestrator and what it calls — the pool
      // it builds, the chime it plays, the failure record it writes. content.js
      // reaches all of them through NFPR at call time, so a wrapper put here is
      // the one it uses.
      if (op.carregado) op.carregado(N);
      // What each row was TOLD, at the panel's door — the stub's text nodes
      // keep no text, so a rendered row cannot be read back.
      const linhas = [];
      const montarReal = N.UI.montar;
      N.UI.montar = async function (o) {
        const api = await montarReal.call(N.UI, o);
        const atualizarReal = api.atualizarItem;
        api.atualizarItem = function (id, dados) {
          linhas.push(dados);
          return atualizarReal.apply(api, arguments);
        };
        if (op.aoMontar) op.aoMontar(api);
        return api;
      };
      vm.runInContext(fs.readFileSync(path.join(raiz, 'src/content/content.js'), 'utf8'),
        mundo.sandbox, { filename: 'src/content/content.js' });
      return { mundo, N, linhas, desligar };
    }
    const assentar = async (vezes, ms) => {
      for (let i = 0; i < vezes; i += 1) {
        await new Promise((r) => setTimeout(r, ms));
        for (let j = 0; j < 30; j += 1) await new Promise((r) => setImmediate(r));
      }
    };
    const barra = (mundo, nome) => {
      const b = mundo.criados.find((e) => e.className === 'nfpr-' + nome + '-cond-bar');
      const m = mundo.criados.find((e) => e.className === 'nfpr-' + nome + '-cond-msg');
      return b && !b.atributos.hidden ? m.textContent : null;
    };
    const PAGINA_COM_TOKEN = '<input name="value" value="tok">';
    const respostaJson = (u, corpo, status) => Promise.resolve({
      ok: !status || status < 400, status: status || 200, redirected: false, type: 'basic',
      url: String(u), json: () => Promise.resolve(corpo)
    });
    const respostaPagina = (u, html) => Promise.resolve({
      ok: true, status: 200, redirected: false, type: 'basic', url: String(u), ...corpoDe(html)
    });
    const avisosHeron = [];
    const debugAntesHeron = console.debug;
    console.debug = function () { avisosHeron.push(Array.prototype.join.call(arguments, ' ')); };

    // --- a login that dies while the server latch holds -----------------------
    // The shrug latches "the server cannot judge donations" and PAUSES THE POOL,
    // so from then on the probe is the only request this page makes. The login
    // expires during the incident; the probe's own token fetch is what finds
    // it. It used to answer 'confuso' like any failure, so the server bar went
    // on promising "retomado automaticamente" for ever, and the one action that
    // fixes things — logging in — never appeared.
    {
      let sessaoViva = true;
      let pedidosDeToken = 0;
      const postados = [];
      const { mundo, linhas } = await orquestrar({
        fator: 20,
        fila: [{ chave: chaveRedir(201) }],
        fetch: (u, o) => {
          if (o && o.method === 'POST') {
            const corpo = JSON.parse(o.body);
            postados.push(corpo.chaveAcesso);
            // The probe's first answer is the shrug too, and the login lapses
            // right after it: the NEXT probe finds no form token.
            if (corpo.chaveAcesso === NFPR.Donation.CHAVE_SONDA) sessaoViva = false;
            return respostaJson(u, CORPO_SHRUG, 500);
          }
          if (/DoacaoDocumentoFiscalCadastrar/.test(String(u))) {
            pedidosDeToken += 1;
            return respostaPagina(u, sessaoViva ? PAGINA_COM_TOKEN : '<html></html>');
          }
          return respostaPagina(u, '');
        }
      });
      await assentar(8, 100); // the second probe fires 4 s / 20 after the latch
      const tokensAoAssentar = pedidosDeToken;
      await assentar(4, 100);
      ok('a login lost under the server latch is found by the probe, and the bar says so',
        [barra(mundo, 'sessao'), barra(mundo, 'servidor')],
        [NFPR.Donation.MSG_SESSAO + ' As notas continuam guardadas.', null]);
      ok('...the parked note moves behind the login, still queued, never sent again',
        [linhas[linhas.length - 1].mensagem,
         (mundo.guardado['nfpr:fila'] || []).map((e) => e.chave),
         postados.filter((c) => c !== NFPR.Donation.CHAVE_SONDA).length],
        ['Guardada — será enviada quando você entrar novamente no Nota Paraná.', [chaveRedir(201)], 1]);
      ok('...and the probe stops asking once there is nothing it can release',
        pedidosDeToken, tokensAoAssentar);
    }

    // --- the redirect reaches every note, wherever it is waiting ---------------
    // "Enviar para X" rewrote nfpr:fila and the pool, and nothing else — so a
    // note parked behind an outage, or sitting on a retry timer, kept the
    // refused CNPJ in memory, went out to it when released, and brought the bar
    // back after the volunteer had fixed it. Three notes aimed at the refused
    // CNPJ: A is refused (the latch, and the click), B loses its connection
    // (the watchdog holds it), C gets a sentence nobody taught us (a retry
    // timer holds it). A's refusal lands LAST, so both are already held when
    // the click comes, and the connection returns with the click.
    {
      const [A, B, C] = [chaveRedir(301), chaveRedir(302), chaveRedir(303)];
      let conexaoCaida = true;
      const postados = [];
      let postadosNoClique = -1;
      await orquestrar({
        fator: 20,
        fila: [{ chave: A }, { chave: B }, { chave: C }],
        config: {
          versaoConfig: 1,
          entidades: [
            { id: 'mau', nome: 'Recusada', cnpj: CNPJ_RECUSADO, verificada: true },
            { id: 'bom', nome: 'Boa', cnpj: CNPJ_BOM, verificada: true }
          ],
          entidadeAtivaId: 'bom', partesFixas: [], parteFixaAtivaId: null, preferencias: {}
        },
        fetch: (u, o) => {
          if (o && o.method === 'POST') {
            const corpo = JSON.parse(o.body);
            postados.push(corpo);
            if (corpo.cnpjEntidade === CNPJ_BOM) {
              return respostaJson(u, { mensagem: 'Documento fiscal doado com sucesso!' });
            }
            if (corpo.chaveAcesso === B) return Promise.reject(new TypeError('Failed to fetch'));
            if (corpo.chaveAcesso === C) {
              return respostaJson(u, { chaveAcesso: 'Uma frase que este código nunca viu.' }, 400);
            }
            return new Promise((r) => setTimeout(() =>
              r(respostaJson(u, { cnpjEntidade: 'Entidade não cadastrada para receber doações.' }, 400)), 20));
          }
          // The follow-up to B's failure, and the watchdog's probe: both
          // redirect:'manual', both unanswered until the connection returns.
          if (o && o.redirect === 'manual') {
            return conexaoCaida
              ? Promise.reject(new TypeError('Failed to fetch'))
              : Promise.resolve({ type: 'basic', status: 200, ok: true });
          }
          return respostaPagina(u, /DoacaoDocumentoFiscalCadastrar/.test(String(u)) ? PAGINA_COM_TOKEN : '');
        },
        aoMontar(api) {
          const setReal = api.setEntidadeRecusada;
          api.setEntidadeRecusada = function (info) {
            const r = setReal.call(api, info);
            if (info && /^Enviar para/.test(info.rotulo || '') && postadosNoClique < 0) {
              postadosNoClique = postados.length;
              conexaoCaida = false;
              info.aoClicar();
            }
            return r;
          };
        }
      });
      await assentar(12, 100);
      const depois = postados.slice(Math.max(0, postadosNoClique));
      ok('the refused-entity bar was clicked with B and C both held elsewhere',
        [postadosNoClique, postados.slice(0, 3).map((p) => p.cnpjEntidade)],
        [3, [CNPJ_RECUSADO, CNPJ_RECUSADO, CNPJ_RECUSADO]]);
      ok('...and not one request goes to the refused CNPJ after it',
        depois.filter((p) => p.cnpjEntidade === CNPJ_RECUSADO).map((p) => p.chaveAcesso), []);
      ok('...while all three go to the working entity, once each',
        depois.filter((p) => p.cnpjEntidade === CNPJ_BOM).map((p) => p.chaveAcesso).sort(),
        [A, B, C].sort());
    }

    // --- after /sair, the session is latched --------------------------------------
    // /sair closes every session, ours included, and the bar says exactly that.
    // Nothing latched it, so the next note spent a request discovering the dead
    // login, buzzed, and repainted the bar with "Sua sessão expirou" — replacing
    // the one sentence that said why. Here /sair answers at once, so it settles
    // before the drain and the restored note is "the next note".
    {
      let pedidosDeToken = 0;
      let postados = 0;
      const { mundo, N } = await orquestrar({
        fila: [{ chave: chaveRedir(401) }],
        antes(m) {
          const principal = m.elemento();
          principal.textContent = 'Ops! O usuário autenticado possui mais de uma sessão ativa.';
          m.documentoStub.getElementById = (id) => (id === 'main' ? principal : null);
        },
        fetch: (u, o) => {
          if (o && o.method === 'POST') {
            postados += 1;
            return respostaJson(u, { mensagem: 'Documento fiscal doado com sucesso!' });
          }
          if (/sair/.test(String(u))) return Promise.resolve({ type: 'opaqueredirect', status: 0 });
          if (o && o.redirect === 'manual') return Promise.resolve({ type: 'opaqueredirect', status: 0 });
          if (/DoacaoDocumentoFiscalCadastrar/.test(String(u))) {
            pedidosDeToken += 1;
            return respostaPagina(u, '<html></html>'); // every session is closed
          }
          return respostaPagina(u, '');
        }
      });
      await assentar(4, 80);
      const ENCERRADAS = 'As sessões foram encerradas, inclusive esta. As notas continuam guardadas.';
      ok('after /sair the next note is held for the login without a request',
        [pedidosDeToken, postados, (mundo.guardado['nfpr:fila'] || []).length], [0, 0, 1]);
      ok('...and the bar keeps saying why', barra(mundo, 'sessao'), ENCERRADAS);
      // The same dead login found by another door must not repaint it either.
      await N.Sessao.conferir();
      await assentar(1, 20);
      ok('...even when the dead login is proved again by another door',
        barra(mundo, 'sessao'), ENCERRADAS);
    }

    // --- a storage write that fails settles a note ONCE ---------------------------
    // The terminal path awaited removerDaFila inside processar's try, so a
    // rejected write (an update invalidating the extension context) ran the
    // catch-all as well: a second settle, and the note's nfpr:falhas entry
    // written with the STORAGE error. The note here is refused with the one red
    // answer that is final and recognised, so nothing belongs in nfpr:falhas.
    {
      const { mundo, linhas } = await orquestrar({
        fila: [{ chave: chaveRedir(501) }],
        antes(m) {
          const local = m.sandbox.chrome.storage.local;
          const setReal = local.set;
          local.set = (o) => ('nfpr:fila' in o
            ? Promise.reject(new Error('Extension context invalidated.'))
            : setReal(o));
        },
        fetch: (u, o) => (o && o.method === 'POST'
          ? respostaJson(u, { chaveAcesso: 'Chave de acesso inválida.' }, 400)
          : respostaPagina(u, /DoacaoDocumentoFiscalCadastrar/.test(String(u)) ? PAGINA_COM_TOKEN : ''))
      });
      await assentar(4, 100); // past removerDaFila's 200 ms window
      ok('a failed storage write settles the note once, with the site\'s own answer',
        linhas.filter((d) => d.estado !== 'enviando').map((d) => [d.estado, d.mensagem]),
        [['erro', 'Chave de acesso inválida.']]);
      ok('...and writes no storage error into the failures list',
        mundo.guardado['nfpr:falhas'] || [], []);
    }

    console.debug = debugAntesHeron;
    ok('the send-pipeline worlds warn about nothing of their own',
      avisosHeron.filter((m) => m.indexOf('span.fn.org') === -1), []);

    marco('the send pipeline invents no condition and loses none');

    // =========================================================================
    // WHAT CLAUDE.md SAYS THE ORCHESTRATOR DOES, DRIVEN THROUGH IT
    // =========================================================================
    // Each of these was claimed and not pinned: the audit broke them one at a
    // time and this script still passed. They are sequences inside content.js,
    // so each gets a world of its own, and each reads the thing the rule is
    // ABOUT — the durable record, the pool, the chime — rather than a
    // consequence that could arrive by another route.
    const avisosLichen = [];
    const debugAntesLichen = console.debug;
    console.debug = function () { avisosLichen.push(Array.prototype.join.call(arguments, ' ')); };
    const tokenOuVazio = (u) => respostaPagina(u,
      /DoacaoDocumentoFiscalCadastrar/.test(String(u)) ? PAGINA_COM_TOKEN : '');
    // Count one Config writer's calls for one key.
    const espiarFalhas = (N, contagem) => {
      const real = N.Config.registrarFalha;
      N.Config.registrarFalha = function (chave) {
        contagem[chave] = (contagem[chave] || 0) + 1;
        return real.apply(N.Config, arguments);
      };
    };

    // --- an unexplained answer, from a note whose ROW WAS EVICTED in flight ----
    // The first of content.js's two anotarFalha calls. Five answers nobody
    // taught us spend the budget and the note leaves nfpr:fila for good, so
    // nfpr:falhas is its only trace — and here its row was pushed off the list
    // by LIMITE_LINHAS newer ones while it was still being sent, which is the
    // case that used to record the answer nowhere at all.
    {
      const K = chaveRedir(601);
      const FRASE = 'Uma frase que este código nunca viu.';
      const EM = 1700000000000;
      const chamadas = {};
      let postados = 0;
      let linhaDaNota = null;
      const { mundo, desligar } = await orquestrar({
        fator: 100,
        fila: [{ chave: K, em: EM }],
        carregado: (N) => espiarFalhas(N, chamadas),
        aoMontar(api) {
          const atualizar = api.atualizarItem;
          api.atualizarItem = function (id, dados) {
            const r = atualizar.apply(api, arguments);
            if (linhaDaNota == null && dados.estado === 'enviando') {
              linhaDaNota = id;
              for (let i = 0; i < NFPR.Painel.LIMITE_LINHAS; i += 1) {
                api.adicionarItem(String(i).padStart(44, '3'), CNPJ_RECUSADO);
              }
            }
            return r;
          };
        },
        fetch: (u, o) => {
          if (o && o.method === 'POST') {
            postados += 1;
            return respostaJson(u, { chaveAcesso: FRASE }, 400);
          }
          return tokenOuVazio(u);
        }
      });
      await assentar(8, 100); // the whole retry ladder, and removerDaFila's window
      const linhaEl = mundo.criados.find((e) => e.atributos['data-id'] === linhaDaNota);
      ok('the note spent its whole budget, and its row was evicted while it did',
        [postados, !!linhaEl && linhaEl.removido === true], [5, true]);
      ok('...and still, its unexplained answer is recorded, with its digits and its moment of input',
        (mundo.guardado['nfpr:falhas'] || []).map((e) => [e.chave, e.mensagem, e.em]),
        [[K, FRASE, EM]]);
      ok('...once', chamadas[K], 1);
      ok('...while the note itself has left nfpr:fila',
        (mundo.guardado['nfpr:fila'] || []).map((e) => e.chave), []);
      desligar();
    }

    // --- an exception nobody classified -----------------------------------------
    // The second anotarFalha. REDE, SERVIDOR and the three session codes are
    // handled above it, so anything reaching the catch-all is a failure this
    // code cannot read — exactly what the record exists for.
    {
      const K = chaveRedir(602);
      const FALHA = 'Uma falha que nada aqui classificou.';
      const chamadas = {};
      const { mundo, linhas, desligar } = await orquestrar({
        fila: [{ chave: K, em: 1700000000000 }],
        carregado(N) {
          espiarFalhas(N, chamadas);
          N.Donation.doar = () => Promise.reject(new Error(FALHA));
        },
        fetch: tokenOuVazio
      });
      await assentar(4, 100);
      ok('an unclassified exception is recorded in nfpr:falhas with the note\'s digits',
        (mundo.guardado['nfpr:falhas'] || []).map((e) => [e.chave, e.mensagem]), [[K, FALHA]]);
      ok('...once, and its row says the same thing',
        [chamadas[K], linhas.filter((d) => d.estado !== 'enviando').map((d) => [d.estado, d.mensagem])],
        [1, [['erro', FALHA]]]);
      desligar();
    }

    // --- a dead session PAUSES the pool ----------------------------------------
    // Not only "nothing more is sent": enfileirar's own latch check would
    // give that much. The rule is that the pool stops, so nothing a later path
    // hands it — a release, a retry — can walk into the wall.
    {
      let pool = null;
      let postados = 0;
      const { mundo, desligar } = await orquestrar({
        fila: [{ chave: chaveRedir(611) }, { chave: chaveRedir(612) }],
        carregado(N) {
          const criar = N.Despacho.criar;
          N.Despacho.criar = function () { pool = criar.apply(N.Despacho, arguments); return pool; };
        },
        fetch: (u, o) => {
          if (o && o.method === 'POST') { postados += 1; return respostaJson(u, {}); }
          if (o && o.redirect === 'manual') return Promise.resolve({ type: 'opaqueredirect', status: 0 });
          return respostaPagina(u, '<html></html>'); // a dead login serves no token
        }
      });
      await assentar(3, 50);
      ok('a SESSAO answer latches the session, and nothing is POSTed',
        [barra(mundo, 'sessao'), postados],
        [NFPR.Donation.MSG_SESSAO + ' As notas continuam guardadas.', 0]);
      ok('...and PAUSES the pool, rather than leaving it to the latch checks',
        [!!pool, pool && pool.estaPausado(), pool && pool.pendentes()], [true, true, 0]);
      desligar();
    }

    // --- the retry timer re-enters through the one way in ------------------------
    // A is refused with a sentence nobody taught us, so a RETRY TIMER holds it.
    // B shrugs, the probe shrugs too, and the server latch closes — pausing the
    // pool — while A's timer is still running. When it fires, A has to be
    // parked behind the latch and counted on the bar. Handed to the pool
    // directly, it sat in a paused pool: a blue row promising a retry, counted
    // by nothing.
    {
      const [A, B] = [chaveRedir(621), chaveRedir(622)];
      let pool = null;
      const { mundo, desligar } = await orquestrar({
        fator: 20,
        fila: [{ chave: A }, { chave: B }],
        carregado(N) {
          const criar = N.Despacho.criar;
          N.Despacho.criar = function () { pool = criar.apply(N.Despacho, arguments); return pool; };
        },
        fetch: (u, o) => {
          if (o && o.method === 'POST') {
            const corpo = JSON.parse(o.body);
            if (corpo.chaveAcesso === A) {
              return respostaJson(u, { chaveAcesso: 'Uma frase que este código nunca viu.' }, 400);
            }
            return respostaJson(u, CORPO_SHRUG, 500); // B, and every probe
          }
          return tokenOuVazio(u);
        }
      });
      await assentar(3, 100); // A's first retry fires at 1.2 s / 20
      ok('a retry firing under the server latch is parked and counted on the bar',
        barra(mundo, 'servidor'),
        'O site do Nota Paraná não está conseguindo registrar doações no momento. ' +
        '2 notas estão guardadas. O envio será retomado automaticamente quando o site se normalizar.');
      ok('...and never lands in the paused pool', [pool.estaPausado(), pool.pendentes()], [true, 0]);
      desligar();
    }

    // --- "Procedimento inválido" is arbitrated by the probe --------------------
    // It shares SEM_VEREDITO with the shrug: a refusal made above the note, so
    // the probe is asked before the budget is touched. Taken out of the set it
    // silently becomes an ordinary retry — five requests, and no bar when the
    // server really is refusing everything.
    {
      const K = chaveRedir(631);
      const postados = [];
      const { mundo, desligar } = await orquestrar({
        fator: 20,
        fila: [{ chave: K }],
        fetch: (u, o) => {
          if (o && o.method === 'POST') {
            const corpo = JSON.parse(o.body);
            postados.push(corpo.chaveAcesso);
            if (corpo.chaveAcesso === K) return respostaJson(u, { chaveAcesso: 'Procedimento inválido.' }, 400);
            return respostaJson(u, CORPO_SHRUG, 500); // the probe: the server is confused
          }
          return tokenOuVazio(u);
        }
      });
      await assentar(3, 100);
      ok('"Procedimento inválido" asks the probe before retrying',
        postados.slice(0, 2), [K, NFPR.Donation.CHAVE_SONDA]);
      ok('...which parks the note behind the server bar instead of spending its budget',
        [postados.filter((c) => c === K).length, !!barra(mundo, 'servidor')], [1, true]);
      desligar();
    }

    // --- a drain is silent; a scan is not ----------------------------------------
    // Nobody is standing at the scanner while a restored queue drains, so a
    // chime per note is noise nobody can attribute. The scan afterwards is the
    // control: it proves the spy is connected, so the silence means something.
    {
      let chimes = 0;
      const postados = [];
      const { mundo, desligar } = await orquestrar({
        fila: [{ chave: chaveRedir(641) }, { chave: chaveRedir(642) }],
        carregado(N) {
          const sucesso = N.Audio.sucesso;
          N.Audio.sucesso = function () { chimes += 1; return sucesso.apply(N.Audio, arguments); };
        },
        fetch: (u, o) => {
          if (o && o.method === 'POST') {
            postados.push(JSON.parse(o.body).chaveAcesso);
            return respostaJson(u, { mensagem: 'Documento fiscal doado com sucesso!' });
          }
          return tokenOuVazio(u);
        }
      });
      await assentar(3, 50);
      ok('a drained note that registers plays no success chime',
        [postados.length, chimes], [2, 0]);
      const tecla = (k) => {
        for (const fn of (mundo.ouvintes.keydown || []).slice()) {
          fn({ key: k, preventDefault: noop, stopPropagation: noop });
        }
      };
      for (const ch of chaveRedir(643)) tecla(ch);
      tecla('Enter');
      await assentar(3, 50);
      ok('...while a scanned one does, once',
        [postados[postados.length - 1], chimes], [chaveRedir(643), 1]);
      desligar();
    }

    // --- a server grey is remembered WITH its reason --------------------------
    // The local grey blocks the key carrying its verdict, so a rescan says why.
    // The server's grey blocked it bare, so the same rescan said only that the
    // note had been read before — as if it might have registered.
    {
      const K = chaveRedir(651);
      const PRAZO = 'O prazo para doar esta nota expirou.';
      const { mundo, linhas, desligar } = await orquestrar({
        fila: [],
        // The cues are not what this world is about, and its AudioContext stub
        // has no voice to play the repeat's ping with.
        carregado(N) {
          ['erro', 'aviso', 'leitura', 'sucesso'].forEach((m) => { N.Audio[m] = noop; });
        },
        fetch: (u, o) => (o && o.method === 'POST'
          ? respostaJson(u, { chaveAcesso: PRAZO }, 400)
          : tokenOuVazio(u))
      });
      const tecla = (k) => {
        for (const fn of (mundo.ouvintes.keydown || []).slice()) {
          fn({ key: k, preventDefault: noop, stopPropagation: noop });
        }
      };
      await assentar(1, 20);
      for (const ch of K) tecla(ch);
      tecla('Enter');
      await assentar(3, 50);
      ok('the server greys a note the local table let through',
        linhas.some((d) => d.estado === 'inelegivel' && d.mensagem === PRAZO), true);
      linhas.length = 0;
      for (const ch of K) tecla(ch);
      tecla('Enter');
      await assentar(1, 20);
      ok('...and rescanning it repeats the server\'s reason, not just "already read"',
        linhas.map((d) => d.mensagem),
        ['Esta nota já foi lida recentemente. ' + PRAZO]);
      desligar();
    }

    console.debug = debugAntesLichen;
    ok('these worlds warn about nothing of their own',
      avisosLichen.filter((m) => m.indexOf('span.fn.org') === -1), []);

    marco('the orchestrator does what CLAUDE.md says, driven through it');

    // --- the background script leaves a STOPPED load alone, in both browsers --
    // The volunteer pressed Stop; swapping in the offline page would be
    // hostile. Chrome says so by name. Firefox does not: its webNavigation
    // builds `Error code ${status}` from the raw nsresult, a number, so
    // NS_BINDING_ABORTED (0x804B0002) arrives as "Error code 2152398850" and
    // the named exemption never matched there. Written out in decimal here,
    // independently of the source's spelling, because a hex string in the list
    // would be the same bug again. Its own context: the file is standalone and
    // registers listeners the moment it runs.
    {
      const escutasErro = [];
      const trocadas = [];
      const evento = () => ({ addListener: noop });
      const sbSw = {
        console, Promise,
        addEventListener: noop,
        navigator: { onLine: true },
        browser: {
          runtime: { getURL: (p) => 'moz-extension://x/' + p, onStartup: evento() },
          storage: { local: { get: () => Promise.resolve({}) }, onChanged: evento() },
          action: { setBadgeText: noop, setBadgeBackgroundColor: noop, setBadgeTextColor: noop },
          declarativeNetRequest: {
            getDynamicRules: () => Promise.resolve([]),
            updateDynamicRules: () => Promise.resolve()
          },
          webNavigation: {
            onBeforeNavigate: evento(),
            onErrorOccurred: { addListener: (fn) => escutasErro.push(fn) }
          },
          tabs: { update: (id, o) => { trocadas.push(o.url); return Promise.resolve(); } }
        }
      };
      sbSw.self = sbSw;
      vm.createContext(sbSw);
      vm.runInContext(fs.readFileSync(path.join(raiz, 'src/background/service-worker.js'), 'utf8'),
        sbSw, { filename: 'src/background/service-worker.js' });
      const trocou = async (error) => {
        trocadas.length = 0;
        await escutasErro[0]({
          frameId: 0, tabId: 7, error,
          url: 'https://notaparana.pr.gov.br/nfprweb/DoacaoDocumentoFiscalCadastrar'
        });
        return trocadas.slice();
      };
      ok('Firefox: a stopped load of the donation page is left alone',
        await trocou('Error code 2152398850'), []);
      ok('Chrome: a stopped load is left alone', await trocou('net::ERR_ABORTED'), []);
      ok('Firefox: a refused connection still goes to the offline page',
        await trocou('Error code 2152398861'), ['moz-extension://x/src/offline/entrada.html']);
      ok('Chrome: a timed-out load still goes to the offline page',
        await trocou('net::ERR_CONNECTION_TIMED_OUT'), ['moz-extension://x/src/offline/entrada.html']);
    }
    marco('the background script tells a stopped load from a failed one');

    // --- the panel height is measured by ONE owner ----------------------------
    // painel.js and ui.js both scheduled ajustarAltura for the next frame and
    // both bound it to `resize`, so every resize measured twice. ui.js keeps
    // it: it is the one that knows the panel is in the document.
    {
      const m = criarMundo();
      const quadros = [];
      const redimensionar = [];
      m.sandbox.requestAnimationFrame = (fn) => { quadros.push(fn); };
      m.sandbox.addEventListener = (tipo, fn) => { if (tipo === 'resize') redimensionar.push(fn); };
      for (const rel of semOrquestrador) {
        vm.runInContext(fs.readFileSync(path.join(raiz, rel), 'utf8'), m.sandbox, { filename: rel });
      }
      const apiAltura = await m.sandbox.NFPR.UI.montar({ modoOffline: true, montarEm: m.elemento() });
      ok('the panel height is scheduled once and bound to resize once',
        [quadros.filter((f) => f === apiAltura.ajustarAltura).length,
         redimensionar.filter((f) => f === apiAltura.ajustarAltura).length],
        [1, 1]);
    }
    marco('the panel height has one owner');
  } catch (e) {
    console.error('UI.montar threw: ' + e.stack);
    process.exit(1);
  }
})();

