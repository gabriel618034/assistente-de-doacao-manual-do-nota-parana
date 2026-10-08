/**
 * config.js
 * -----------------------------------------------------------------------------
 * Single source of truth for persisted state (chrome.storage.local), shared by
 * the content script, the in-modal settings, and the toolbar popup.
 *
 *   nfpr:config  -> { entidades[], entidadeAtivaId, partesFixas[],
 *                     parteFixaAtivaId, preferencias{} }
 *   nfpr:fila    -> [{ chave, cnpj, em }]  (donations awaiting/needing a
 *                    (re)send across reloads; `cnpj` is the target FROZEN at
 *                    scan time, so changing the active entity never retargets
 *                    old items; `em` is when the volunteer entered it, carried
 *                    so a note drained days later can still report when it was
 *                    read. Legacy plain-string entries are normalised on read.)
 *   nfpr:falhas  -> [{ chave, mensagem, em }]  (notes the server REJECTED and
 *                    this extension could not explain — see below)
 *
 * Defaults are merged on every read, so there is no install-time seeding step
 * and older stored objects keep working as the schema grows.
 *
 * ALL THREE records are written through their own serialized promise chain: a
 * scanner can fire several keys per second, and two interleaved
 * read-modify-write cycles would silently drop one. Config gets the same
 * treatment because several surfaces (this page, the popup, the site's own
 * entity dialog) can write it seconds apart. (The lock is per page; the "one
 * tab at a time" rule still applies across tabs.)
 *
 * There is exactly one way to change config — atualizarConfig — so no caller
 * can reintroduce a whole-object overwrite.
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  const NFPR = (root.NFPR = root.NFPR || {});
  const api = NFPR.api; // browser.js is declared before this file in every loader

  const CONFIG_KEY = 'nfpr:config';
  const FILA_KEY = 'nfpr:fila';
  const FALHAS_KEY = 'nfpr:falhas';

  // Each stored record gets one of these: every read-modify-write of that
  // record runs through it, strictly one after another, so two writes landing
  // in the same instant cannot drop each other's change.
  function criarSerializador() {
    let cadeia = Promise.resolve();
    return function serializar(operacao) {
      const p = cadeia.then(operacao);
      cadeia = p.catch(() => {}); // a failed write must not jam the chain
      return p;
    };
  }

  // How many rejected-and-unexplained notes are kept. They are the ONLY record
  // of a donation that was refused and then dropped from the queue, so unlike
  // the panel's rows this list is durable — but it still cannot grow for ever,
  // and a volunteer who is hundreds behind has a different problem than a list.
  // Oldest fall off the end.
  const LIMITE_FALHAS = 100;

  // How long an answer to the fixed part offer stands before the offer may be
  // made again. A week: long enough that the volunteer who said "Não mostrar"
  // is not asked again during their own sitting or the next one, short enough
  // that somebody who only comes in on Saturdays still gets told the feature
  // exists. Shifts rotate weekly, which is the closest thing to a reason there
  // is — there is no measurement behind it, and it is a knob precisely so it
  // can be moved when there is one. The offer costs nothing on a machine with
  // a scanner: it is still gated on somebody typing by hand.
  const PRAZO_DICA_PARTES_FIXAS = 7 * 24 * 60 * 60 * 1000;

  // Is the fixed part offer allowed to be made? `em` is
  // preferencias.dicaPartesFixasEm: null while it has never been answered,
  // otherwise when it was. ONE place asks, like Config.parteFixaSalva — a
  // second copy of this comparison is a copy that will be short the null case
  // or short the clock.
  function dicaPartesFixasVencida(em, agora) {
    if (!em) return true;
    return (agora || Date.now()) - em > PRAZO_DICA_PARTES_FIXAS;
  }

  const DEFAULT_CONFIG = {
    // Nothing branches on versaoConfig today: it is written, read, and written
    // back unchanged. Kept deliberately — it costs two lines and is the only
    // place a future schema migration could hook into.
    versaoConfig: 1,
    entidades: [], // { id, nome, cnpj, ... }
    entidadeAtivaId: null,
    // { id, nome, template, usadaEm }
    //
    // TWO TIERS, AND THE NAME IS THE TIER. A fixed part with a `nome` is SAVED:
    // pinned by the volunteer, never evicted and never counted against the cap.
    // One with a blank `nome` is a RECENT — a fixed part is working state with
    // a lifetime of one sitting, so simply using one puts it at the top of a
    // short list and ten newer ones push it off.
    //
    // There is no separate `salva` flag, and that is the point: naming a thing
    // IS keeping it, so the volunteer performs one gesture instead of two, and
    // the list can never hold a pinned fixed part nobody can tell apart from
    // the pinned fixed part above it. Clearing a name back to blank is how one
    // is let go.
    //
    // A blank `nome` is therefore a FIRST-CLASS STATE, never defaulted to the
    // word "Parte fixa": the interface substitutes the fixed part's own digits,
    // which is the only thing that tells two unnamed fixed parts apart.
    //
    // `usadaEm` is stamped at activation and at edit, and orders both tiers.
    partesFixas: [],
    parteFixaAtivaId: null,
    preferencias: {
      somAlerta: true,
      // Fires on every accepted scan, so it is off by default: `piscar` already
      // gives per-scan feedback, and a room of volunteers each blipping through
      // a box of receipts is a room nobody can work in. The volunteer who wants
      // it turns it on.
      somLeitura: false,
      somSucesso: false,
      piscar: true, // screen flash on each scan
      autoEnviar: false, // send the instant 44 digits are captured
      // FIXED PARTS ARE ON BY DEFAULT, and `off` means the whole feature is
      // inert — the strip is not drawn AND no fixed part applies, which
      // registrador.js gets by reading the active fixed part as null. Hiding
      // the strip alone would be the dangerous half of it: a fixed part puts
      // digits in the cells the volunteer never typed, and the one-click way
      // out lives on the strip that is no longer there.
      //
      // A fixed part is a TYPIST'S tool — someone reading barcodes never types
      // a digit — so the volunteer with a scanner may switch the strip off as
      // clutter.
      partesFixas: true,
      // ...which leaves the typist who sits down at that machine afterwards
      // with no way to find out the feature exists. One quiet line under the
      // cells tells them, once a note has been entered BY HAND
      // (registrador.js) and never for a scan.
      //
      // THIS FIELD IS WHEN THAT OFFER WAS LAST ANSWERED, not whether it was.
      // `null` means never. It is stamped by any deliberate touch of
      // `partesFixas` — the offer's own two buttons, or the switch in
      // Preferências, in either direction — because someone who has worked the
      // switch knows the option is there and does not need telling.
      //
      // A TIMESTAMP RATHER THAN A BOOLEAN BECAUSE THE ANSWER IS NOT THE
      // VOLUNTEER'S TO GIVE FOR EVER. A boolean made one person's "Não
      // mostrar" bind everybody who ever sits at that machine again, and these
      // machines are shared, the volunteers rotate, and an install that was
      // dismissed once is silent about the feature for the rest of its life.
      // So the answer expires (PRAZO_DICA_PARTES_FIXAS below) and the offer
      // comes back for whoever is typing then. There is no cleverness about WHO
      // is typing — there is nothing here that could know — only the passage of
      // time, and it is still gated on somebody typing by hand.
      dicaPartesFixasEm: null,
      // No local gate at all: every verdict becomes advice and the server
      // decides. Off by default and deliberately not a debug flag — see the
      // long comment at the decision site in registrador.js.
      enviarSemValidar: false,
      encerrarSessoesDuplicadas: true // auto-dismiss the "multiple sessions" server error
    }
  };

  function gerarId() {
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  async function obterConfig() {
    const armazenado = await api.storage.local.get(CONFIG_KEY);
    const cfg = armazenado[CONFIG_KEY] || {};
    return {
      versaoConfig: cfg.versaoConfig || DEFAULT_CONFIG.versaoConfig,
      entidades: Array.isArray(cfg.entidades) ? cfg.entidades : [],
      entidadeAtivaId: cfg.entidadeAtivaId || null,
      partesFixas: Array.isArray(cfg.partesFixas) ? cfg.partesFixas : [],
      parteFixaAtivaId: cfg.parteFixaAtivaId || null,
      preferencias: Object.assign({}, DEFAULT_CONFIG.preferencias, cfg.preferencias || {})
    };
  }

  async function salvarConfig(novo) {
    await api.storage.local.set({ [CONFIG_KEY]: novo });
    return novo;
  }

  // Config mutations are serialized exactly like queue writes below. Without
  // this, five call sites read the whole config, changed one field and wrote
  // the whole object back — so anything another surface (the popup, the other
  // settings form) changed in between was silently reverted. The worst case
  // awaited a network round trip between its read and its write.
  const serializarConfig = criarSerializador();

  /**
   * The ONE way to change stored config. Shallow-merges a patch over the
   * current record, with `preferencias` merged one level deep, and persists.
   *
   * `patch` is either a plain object, or a function `(atual) => patch` for
   * mutations that have to derive the new value from the current one (adding
   * or removing an entity/fixed part). Passing the function form is what keeps
   * the read inside the lock; returning null from it writes nothing.
   */
  function atualizarConfig(patch) {
    return serializarConfig(async () => {
      const atual = await obterConfig();
      const delta = typeof patch === 'function' ? await patch(atual) : patch;
      if (!delta) return atual;
      const novo = Object.assign({}, atual, delta);
      if (delta.preferencias) {
        novo.preferencias = Object.assign({}, atual.preferencias, delta.preferencias);
      }
      return salvarConfig(novo);
    });
  }

  const entidadeAtiva = (cfg) =>
    cfg.entidades.find((i) => i.id === cfg.entidadeAtivaId) || null;

  const parteFixaAtiva = (cfg) =>
    cfg.partesFixas.find((m) => m.id === cfg.parteFixaAtivaId) || null;

  // How many UNNAMED fixed parts are kept. A named one is saved, and saved ones
  // are exempt from the count and from eviction — that is the whole difference
  // between the two tiers.
  const LIMITE_PARTES_FIXAS_RECENTES = 10;

  /** Saved iff named. The one definition; nothing else may ask this. */
  const parteFixaSalva = (m) => !!(m && String(m.nome || '').trim());

  /**
   * Trim the recent tier back to LIMITE_PARTES_FIXAS_RECENTES, oldest by
   * `usadaEm` first. Pure, and always called INSIDE the atualizarConfig lock —
   * the list it prunes is the one that lock just read.
   *
   * `protegidoId` is never dropped whatever its age: evicting the fixed part
   * the volunteer is using right now would empty the strip under their hands.
   *
   * Order is preserved, so nothing else about the stored array moves.
   */
  function podarPartesFixas(lista, protegidoId) {
    const recentes = lista.filter((m) => !parteFixaSalva(m) && m.id !== protegidoId);
    if (recentes.length <= LIMITE_PARTES_FIXAS_RECENTES) return lista;
    const condenados = new Set(
      recentes
        .slice()
        .sort((a, b) => (a.usadaEm || 0) - (b.usadaEm || 0))
        .slice(0, recentes.length - LIMITE_PARTES_FIXAS_RECENTES)
        .map((m) => m.id)
    );
    return lista.filter((m) => !condenados.has(m.id));
  }

  // --- Pending-send queue (durable across page reloads) -----------------------

  // All mutations pass through this chain so they apply strictly in order.
  const serializarFila = criarSerializador();

  async function obterFila() {
    const r = await api.storage.local.get(FILA_KEY);
    const bruto = Array.isArray(r[FILA_KEY]) ? r[FILA_KEY] : [];
    // Migration: entries used to be plain key strings with no frozen target.
    // Normalise them to objects; a null cnpj means "use the active entity".
    return bruto
      .map((e) =>
        typeof e === 'string' ? { chave: e, cnpj: null, em: null } : e && e.chave ? e : null
      )
      .filter(Boolean);
  }

  function salvarFila(arr) {
    return api.storage.local.set({ [FILA_KEY]: arr });
  }

  /**
   * Queue a donation with its target CNPJ frozen at scan time.
   *
   * `em` is stamped HERE, at the moment the volunteer entered the key, and
   * travels with the note. It is not "when we tried to send it": a batch
   * scanned offline on Friday and drained on Monday has to be able to say
   * Friday, because that is the only thing that locates it in the volunteer's
   * own day. Legacy entries have none and read as null.
   *
   * `semValidacao` is the OTHER thing frozen here, and it is frozen for exactly
   * the reason `cnpj` is. It holds the local reading of a note the volunteer's
   * "enviar sem validar" preference carried past a verdict — a string when the
   * note bypassed a gate, null otherwise. Reading the live preference at drain
   * time instead would let a toggle flipped days later destroy a note that was
   * deliberately submitted, which is the same harm as retargeting a queued note
   * when the active entity changes. It travels with the note so the drain can
   * skip its re-judge and the restored row can still say what we thought was
   * wrong.
   *
   * Resolves to whether the key was actually ADDED. A key already queued is
   * left alone — first entry wins, keeping its frozen target — and a caller
   * counting what it stored has to be able to tell: under "enviar sem
   * validar" a repeat reaches this call instead of being refused, and the
   * offline page's count used to go up for a note it never stored twice.
   */
  function adicionarNaFila(chave, cnpj, semValidacao) {
    return serializarFila(async () => {
      const f = await obterFila();
      if (f.some((e) => e.chave === chave)) return false;
      f.push({ chave, cnpj: cnpj || null, em: Date.now(), semValidacao: semValidacao || null });
      await salvarFila(f);
      return true;
    });
  }

  /**
   * Drop a key from the queue.
   *
   * COALESCED, because this is the hot path of a large drain: one settled note
   * meant one read-modify-write of the whole array, so a thousand of them cost a
   * thousand serialized storage round trips over a thousand-element array, all
   * of it behind the notes still being sent. Removals inside the window collapse
   * into a single write.
   *
   * The returned promise still settles when the write that includes this key has
   * landed, so `await Config.removerDaFila(k)` keeps meaning what it always did.
   *
   * A reload inside the window re-sends a note that already landed. That is the
   * duplicate-donation trade DOCS.md already documents and accepts: the monthly
   * reconciliation discards duplicates, and losing a donation is the worse
   * failure.
   */
  const JANELA_REMOCAO_MS = 200;
  let removendo = null; // { chaves:Set, promessa, resolver, timer }

  /**
   * Point every queued note aimed at `deCnpj` at `paraCnpj` instead, and report
   * how many moved.
   *
   * THE ONE DELIBERATE EXCEPTION to "the donation target is frozen at scan
   * time". It is never automatic and never a side effect of changing the active
   * entity: it exists because a note whose target the server has refused
   * outright has no working target at all, so the alternative to moving it is
   * losing it. See CLAUDE.md, which spells the exception out beside the rule.
   *
   * MATCHES THE TARGET EXACTLY, and that is the whole safety property. Entries
   * with a null cnpj are legacy rows that resolve to whatever entity is active
   * at send time — already the good one — so they are left alone, as is every
   * entry aimed anywhere else. Moving a note that still had a working target
   * would file it under the wrong entity and nobody would ever find out, which
   * is the same size of harm as losing it.
   */
  function redirecionarFila(deCnpj, paraCnpj) {
    if (!deCnpj || !paraCnpj || deCnpj === paraCnpj) return Promise.resolve(0);
    return serializarFila(async () => {
      const f = await obterFila();
      let movidas = 0;
      const novo = f.map((e) => {
        if (e.cnpj !== deCnpj) return e;
        movidas += 1;
        return { ...e, cnpj: paraCnpj };
      });
      if (movidas) await salvarFila(novo);
      return movidas;
    });
  }

  function removerDaFila(chave) {
    if (!removendo) {
      const lote = { chaves: new Set(), timer: null, resolver: null, promessa: null };
      lote.promessa = new Promise((resolve) => {
        lote.resolver = resolve;
      });
      lote.timer = setTimeout(() => {
        removendo = null;
        lote.resolver(
          serializarFila(async () => {
            const f = await obterFila();
            const n = f.filter((e) => !lote.chaves.has(e.chave));
            if (n.length !== f.length) await salvarFila(n);
          })
        );
      }, JANELA_REMOCAO_MS);
      removendo = lote;
    }
    removendo.chaves.add(chave);
    return removendo.promessa;
  }

  // --- Rejected and unexplained (durable across page reloads) ----------------
  // The notes the server refused and this extension could NOT account for. They
  // have already been dropped from nfpr:fila and their keys unblocked, so this
  // record is the only trace they ever existed.
  //
  // THAT IS WHY IT IS DURABLE, and the reasoning is worth keeping because the
  // first version got it wrong. The panel's other in-memory state — the retry
  // counter, the in-tab duplicate set, the row list — all describes notes that
  // are still in nfpr:fila, so a reload merely replays them. These are not:
  // they are gone. Holding their only record in a variable meant an ordinary
  // mid-batch navigation destroyed it, and the session bar's "Entrar novamente"
  // is a link that navigates this very tab.
  //
  // Its own key rather than a corner of nfpr:config, for the same reason
  // nfpr:fila has one: "apagar configurações" must not throw it away.
  const serializarFalhas = criarSerializador();

  async function obterFalhas() {
    const r = await api.storage.local.get(FALHAS_KEY);
    const bruto = Array.isArray(r[FALHAS_KEY]) ? r[FALHAS_KEY] : [];
    return bruto.filter((e) => e && e.chave);
  }

  /**
   * Record a note the server rejected without an explanation we can read.
   *
   * ONE ENTRY PER KEY. A rejected key is unblocked, so rescanning it makes a
   * second note record for the same 44 digits; two entries would report "2
   * notas" about one note. The existing entry keeps its place — the list reads
   * oldest first — and takes the newer message and the newer input time.
   */
  function registrarFalha(chave, mensagem, em, semValidacao) {
    return serializarFalhas(async () => {
      const atual = await obterFalhas();
      const i = atual.findIndex((e) => e.chave === chave);
      // `semValidacao` carries the note's own local reading when the volunteer's
      // bypass sent it past a verdict. The page that renders this list opens by
      // telling the volunteer the numbers were right and they did nothing wrong
      // — true BY CONSTRUCTION for every other entry, because nothing else
      // reaches the POST. A bypassed note breaks that construction, so the entry
      // has to carry the fact rather than let the page speak for it.
      const entrada = {
        chave,
        mensagem: mensagem || '',
        // The moment of INPUT or nothing. A legacy plain-string queue entry has
        // no input time, and stamping the failure time here made the page say
        // "Lida em" a moment nobody read the note; with null the line is
        // omitted, as modal.js and CLAUDE.md say.
        em: em || null,
        semValidacao: semValidacao || null
      };
      if (i >= 0) atual[i] = entrada;
      else atual.push(entrada);
      // Oldest off the front once the cap is reached.
      const cortado = atual.slice(Math.max(0, atual.length - LIMITE_FALHAS));
      await api.storage.local.set({ [FALHAS_KEY]: cortado });
      return cortado;
    });
  }

  /**
   * Throw the whole record away, on purpose.
   *
   * THE ONLY THING THAT EMPTIES THIS LIST WITHOUT A NOTE REGISTERING, and it
   * exists because the bar was otherwise permanent: entries leave when their
   * key succeeds later (resolverFalha) or when they fall off the 100 cap, so a
   * note the volunteer will never rescan sat on screen for ever. A red bar that
   * can never be answered stops being read, and then it is not doing the one
   * job it has.
   *
   * IT IS STILL NOT A DISMISS CONTROL. The bar has no ✕ and must not get one —
   * it is a condition, and a count that can be waved away without looking is a
   * count nobody looks at. This is reachable only from INSIDE the page that
   * lists the notes, so clearing it means the volunteer opened it, saw the
   * digits and decided. That is the distinction to preserve if this ever moves.
   *
   * Destructive in the full sense: these notes already left nfpr:fila, so this
   * record is their only trace and nothing anywhere will mention them again.
   * The caller confirms before calling.
   */
  function limparFalhas() {
    return serializarFalhas(async () => {
      await api.storage.local.set({ [FALHAS_KEY]: [] });
      return [];
    });
  }

  /**
   * That key registered on a later attempt, so it is no longer unregistered.
   * Returns the surviving list either way, so callers can repaint from one call.
   */
  function resolverFalha(chave) {
    return serializarFalhas(async () => {
      const atual = await obterFalhas();
      const restam = atual.filter((e) => e.chave !== chave);
      if (restam.length !== atual.length) {
        await api.storage.local.set({ [FALHAS_KEY]: restam });
      }
      return restam;
    });
  }

  /** Subscribe to storage changes. callback('config'|'fila'|'falhas', newValue). */
  function aoMudar(callback) {
    function handler(changes, area) {
      if (area !== 'local') return;
      if (changes[CONFIG_KEY]) callback('config', changes[CONFIG_KEY].newValue);
      if (changes[FILA_KEY]) callback('fila', changes[FILA_KEY].newValue);
      if (changes[FALHAS_KEY]) callback('falhas', changes[FALHAS_KEY].newValue);
    }
    api.storage.onChanged.addListener(handler);
    return () => api.storage.onChanged.removeListener(handler);
  }

  NFPR.Config = {
    gerarId,
    obterConfig,
    atualizarConfig,
    entidadeAtiva,
    parteFixaAtiva,
    parteFixaSalva,
    podarPartesFixas,
    LIMITE_PARTES_FIXAS_RECENTES,
    obterFila,
    adicionarNaFila,
    removerDaFila,
    obterFalhas,
    registrarFalha,
    resolverFalha,
    limparFalhas,
    LIMITE_FALHAS,
    dicaPartesFixasVencida,
    PRAZO_DICA_PARTES_FIXAS,
    redirecionarFila,
    aoMudar
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
