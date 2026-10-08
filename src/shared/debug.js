/**
 * debug.js  (shared — content scripts, offline page, popup)
 * -----------------------------------------------------------------------------
 * MODO DE DEPURAÇÃO. The one place that can deliberately open the paths this
 * extension exists to keep shut: a fixed part whose fixed digits can only make
 * dead notes, a key refused red or grey, a forged server answer, a fake clock,
 * a fake outage.
 *
 * WHY IT EXISTS. Verification here is a manual pass against a live government
 * site plus tools/smoke.js for the pure logic, and a whole class of behaviour
 * falls between the two: everything time-dependent (EXPIRADA, FUTURA, the
 * stale-fixed-part bar), every branch of donation.js's answer table, and every
 * outage path. Reaching them for real means changing the system clock, owning
 * a note in exactly that state, or unplugging the router.
 *
 * ARMED FROM THE CONSOLE ONLY. There is no UI that turns this on. Content
 * scripts run in the ISOLATED WORLD, so NFPR is unreachable from the page's own
 * console — you have to switch the devtools context dropdown to the extension's
 * world first. That costs someone who knows this codebase nothing and stops
 * everyone else, which is the whole gate:
 *
 *   NFPR.Debug.ajuda()                          // the flag table, printed
 *   NFPR.Debug.ligar({ relogioFixo: { ano: 2026, mes: 12 } })
 *   NFPR.Debug.desligar()                       // what the red banner's button calls
 *
 * WHAT KEEPS IT HONEST, in order of how much each one matters:
 *
 *   1. A red banner across the registrar for as long as it is armed, listing
 *      the live flags, with "Voltar à segurança" on it. A CONDITION, not a
 *      notification — no dismiss control, nothing persists a dismissal, and it
 *      cannot get stuck hidden while the condition holds. Same reasoning as the
 *      stale-fixed-part bar in painel.js.
 *   2. Every row created through a bypass carries a visible marker, so the
 *      result list can never claim a forced note was an ordinary one.
 *   3. simularEnvio ARMS ITSELF (see ligar) whenever a bypass flag is switched
 *      on. Putting a fabricated key on the real server takes a second,
 *      deliberate call.
 *
 * THE READING RULE. `on(nome)` and `valor(nome)` are the only ways to read this
 * record; nothing else in the codebase touches 'nfpr:debug'. This file ships
 * with the extension: what keeps a volunteer safe is that every flag reads off
 * until the mode is armed, not that the mode is absent.
 *
 * chave.js, parte-fixa.js and cnpj.js NEVER see this module: they stay pure,
 * and every bypass happens at the decision site that calls them.
 *
 * ITS OWN STORAGE KEY, deliberately not a corner of nfpr:config: no debug field
 * can ride along into an entity or fixed part write, versaoConfig stays about
 * the real schema, and the panic switch is one removal of one key. Writes are a
 * plain set rather than config.js's serialized chain — a scanner fires several
 * keys a second, but this record is only ever changed by one person at a
 * console.
 *
 * The cache is SYNCHRONOUS because its readers are: Registrador.aceitar and
 * Relogio.mesCorrente cannot await. It is primed once at load and kept fresh by
 * storage.onChanged; `pronto()` is what the registrars await so they never
 * start on a stale one.
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  const NFPR = (root.NFPR = root.NFPR || {});
  const api = NFPR.api; // browser.js is declared before this file in every loader

  const CHAVE_DEBUG = 'nfpr:debug';

  // Every flag, with the value that means "off". Merged over whatever is stored,
  // so the record keeps working as this list grows.
  const FLAGS_PADRAO = {
    // --- bypasses: these change what the pipeline accepts --------------------
    aceitarChavesInvalidas: false, // red verdicts become sendable
    ignorarInelegibilidade: false, // grey verdicts become sendable
    ignorarDuplicadas: false, // a key can be scanned over and over
    partesFixasSemValidacao: false, // save a fixed part that can only make dead notes
    // --- the network: what donation.js does instead of asking the server -----
    simularEnvio: false, // never POST; answer "sucesso"
    respostaForcada: null, // a server body (or sentence) to classify for real
    erroForcado: null, // 'REDE'|'SERVIDOR'|'SESSAO'|'SESSAO_DUPLICADA'|'ENCERRANDO_SESSAO'
    // --- injected reality ----------------------------------------------------
    relogioFixo: null, // { ano, mes } — time travel, everywhere at once
    forcarConexao: null, // 'online' | 'offline' — no probe is issued
    registroVerboso: false // console tracing through Debug.log
  };

  // Turning any of these on is what auto-arms simularEnvio: each one lets the
  // pipeline reach the network with something it would normally have refused.
  const FLAGS_DE_RISCO = ['aceitarChavesInvalidas', 'ignorarInelegibilidade'];

  const MSG_AJUDA = [
    'MODO DE DEPURAÇÃO — NFPR.Debug',
    '',
    '  ligar(flags)      arma e mescla flags        desligar()   desarma, mantém as flags',
    '  limpar()          apaga o registro           flags()      o estado atual',
    '  on(nome)          flag booleana ligada?      valor(nome)  flag não-booleana',
    '  chaveFalsa({...}) chave com CDV correto      ajuda()      isto aqui',
    '  smoke()           julga todas as chaves de teste no mês atual, com relógio',
    '  snapshot() / restaurar(s) / despejar() / gravar(k, v)     armazenamento cru',
    '',
    'FLAGS',
    '  aceitarChavesInvalidas   aceita chaves vermelhas (CDV, formato, mês, emitente, futura)',
    '  ignorarInelegibilidade   aceita notas cinzas (outro estado, nem NF-e nem NFC-e, fora do prazo)',
    '  ignorarDuplicadas        permite escanear a mesma chave várias vezes',
    '  partesFixasSemValidacao  permite salvar partes fixas que só descrevem notas mortas',
    '  simularEnvio             não envia nada; responde "sucesso"',
    '  respostaForcada          resposta do servidor a fingir (texto ou objeto)',
    '  erroForcado              falha de UMA tentativa — REDE | SERVIDOR | SESSAO |',
    '                           SESSAO_DUPLICADA | ENCERRANDO_SESSAO',
    '  relogioFixo              { ano, mes } — viagem no tempo, para o app inteiro',
    '  forcarConexao            estado do vigia — "online" | "offline"; substitui a',
    '                           sondagem, nenhuma requisição de teste sai',
    '  registroVerboso          rastreamento no console',
    '',
    'CUIDADO: as duas primeiras ligam simularEnvio sozinhas. Para enviar de',
    'verdade uma chave forjada é preciso ligar({ simularEnvio: false }) depois.'
  ].join('\n');

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let estado = { ativo: false, flags: Object.assign({}, FLAGS_PADRAO) };
  const ouvintes = new Set();

  function normalizar(bruto) {
    const r = bruto || {};
    return {
      ativo: !!r.ativo,
      flags: Object.assign({}, FLAGS_PADRAO, r.flags || {})
    };
  }

  function avisar() {
    for (const fn of ouvintes) {
      try {
        fn(estado);
      } catch (e) {
        /* one broken subscriber must not stop the others */
      }
    }
  }

  function persistir() {
    return api.storage.local.set({ [CHAVE_DEBUG]: estado }).catch(() => {});
  }

  // Prime the cache once. Everything below reads it synchronously, so the
  // registrars await this before their first judgement (see Registrador).
  const promessaPronto = (async function primeiraLeitura() {
    try {
      const r = await api.storage.local.get(CHAVE_DEBUG);
      estado = normalizar(r[CHAVE_DEBUG]);
    } catch (e) {
      estado = normalizar(null);
    }
    if (estado.ativo) {
      // Loud on every load, because a machine left armed is the failure that
      // actually costs something.
      console.debug('[NFPR] MODO DE DEPURAÇÃO LIGADO — ' + (resumo().join(', ') || 'sem flags'));
    }
    avisar();
    return estado;
  })();

  // Another surface (the popup, the offline page, a second tab) armed or
  // disarmed it: adopt that, then repaint. Our own writes come back through
  // here too, which only costs an idempotent repaint.
  try {
    api.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local' || !changes[CHAVE_DEBUG]) return;
      estado = normalizar(changes[CHAVE_DEBUG].newValue);
      avisar();
    });
  } catch (e) {
    /* no storage events in the smoke-test sandbox; the cache still works */
  }

  // ---------------------------------------------------------------------------
  // Reading — the only two ways anything else may look at this record
  // ---------------------------------------------------------------------------

  /** A boolean flag, false whenever the mode is disarmed. */
  const on = (nome) => !!(estado.ativo && estado.flags[nome]);

  /** A non-boolean flag ({ ano, mes }, a sentence, a code), null when disarmed. */
  const valor = (nome) => (estado.ativo ? estado.flags[nome] : null) || null;

  const estaAtivo = () => estado.ativo;
  const flags = () => Object.assign({}, estado.flags);

  /**
   * The armed flags, one short string each, for the banner and the console
   * warning. Non-boolean flags print their value — "relogioFixo=12/2026" is the
   * thing you actually need to see.
   */
  function resumo() {
    if (!estado.ativo) return [];
    const fora = [];
    for (const nome of Object.keys(FLAGS_PADRAO)) {
      const v = estado.flags[nome];
      if (!v) continue;
      if (v === true) fora.push(nome);
      else if (nome === 'relogioFixo' && v.ano) {
        fora.push(nome + '=' + String(v.mes).padStart(2, '0') + '/' + v.ano);
      } else if (typeof v === 'string') fora.push(nome + '=' + v);
      else fora.push(nome + '=' + JSON.stringify(v));
    }
    return fora;
  }

  /** Subscribe to arm/disarm/flag changes. Returns an unsubscribe function. */
  function aoMudar(callback) {
    ouvintes.add(callback);
    return () => ouvintes.delete(callback);
  }

  /** Ready when the first storage read has landed. Awaited by both registrars. */
  const pronto = () => promessaPronto;

  /** console.log, but only while registroVerboso is on. */
  function log() {
    if (!on('registroVerboso')) return;
    console.log.apply(console, ['[NFPR]'].concat(Array.prototype.slice.call(arguments)));
  }

  // ---------------------------------------------------------------------------
  // Arming
  // ---------------------------------------------------------------------------

  /**
   * Arm the mode and merge `novas` over the current flags.
   *
   * SIMULARENVIO ARMS ITSELF here. Switching on a flag that lets the pipeline
   * carry something it would normally have refused also switches on the one
   * that keeps it off the wire — unless the caller named simularEnvio in this
   * very call. So testing a red bypass costs one line, and actually donating a
   * fabricated key costs a second, deliberate one.
   *
   * The cache is updated BEFORE the write resolves: `on()` is synchronous and
   * the next scan may be milliseconds away.
   */
  function ligar(novas) {
    novas = novas || {};
    const mescladas = Object.assign({}, estado.flags, novas);
    const armouRisco = FLAGS_DE_RISCO.some((f) => novas[f]);
    if (armouRisco && !Object.prototype.hasOwnProperty.call(novas, 'simularEnvio')) {
      mescladas.simularEnvio = true;
    }
    estado = { ativo: true, flags: mescladas };
    avisar();
    persistir();
    console.debug('[NFPR] MODO DE DEPURAÇÃO LIGADO — ' + (resumo().join(', ') || 'sem flags'));
    return flags();
  }

  /**
   * Disarm, keeping the flags for the next session — this is what the banner's
   * "Voltar à segurança" button calls, and coming back to a still-configured
   * but inert debug mode is the useful behaviour there. Coming back means the
   * CONSOLE (`NFPR.Debug.ligar()`): the 7-click gesture arms with every flag
   * off and never brings these back (debug-ui.js).
   */
  function desligar() {
    estado = { ativo: false, flags: estado.flags };
    avisar();
    persistir();
    console.debug('[NFPR] modo de depuração desligado.');
    return flags();
  }

  /** Forget the record entirely. The panic switch. */
  async function limpar() {
    estado = normalizar(null);
    avisar();
    try {
      await api.storage.local.remove(CHAVE_DEBUG);
    } catch (e) {
      await persistir(); // no remove() in some stubs; an empty record is equivalent
    }
    console.debug('[NFPR] registro de depuração apagado.');
  }

  /**
   * Downgrade a verdict from Chave.avaliar so the pipeline carries a note
   * it would have refused. Identity while disarmed, and identity for a clean
   * key, so the call site reads the same either way.
   *
   * `forcado` records WHICH gate was opened. It travels to the row so the
   * result list says so out loud — a forced note must never be indistinguishable
   * from an ordinary one.
   */
  function ajustarVeredito(av) {
    if (!estado.ativo || !av) return av;
    if (av.gravidade === 'entrada' && on('aceitarChavesInvalidas')) {
      log('veredito forçado (entrada→ok)', av.codigo, av.mensagem);
      return Object.assign({}, av, { gravidade: null, forcado: 'entrada' });
    }
    if (av.gravidade === 'inelegivel' && on('ignorarInelegibilidade')) {
      log('veredito forçado (inelegivel→ok)', av.codigo, av.mensagem);
      return Object.assign({}, av, { gravidade: null, forcado: 'inelegivel' });
    }
    return av;
  }

  // ---------------------------------------------------------------------------
  // Fixtures — build a key for any scenario
  // ---------------------------------------------------------------------------

  // A genuine Paraná NFC-e, field by field, used as the base every override is
  // applied to:  41 | 2501 | 12345678000195 | 65 | 001 | 000001234 | 1 | 12345678
  const BASE43 = '4125011234567800019565001000001234112345678';

  // The spec's field layout, same spans analisarChave reads.
  const SPANS = {
    uf: [0, 2], aa: [2, 4], mm: [4, 6], documentoEmitente: [6, 20], modelo: [20, 22],
    serie: [22, 25], numero: [25, 34], tipoEmissao: [34, 35], codigo: [35, 43]
  };

  /**
   * A 44-digit key with the named fields replaced and the CHECK DIGIT
   * RECOMPUTED, so the field under test is the only thing that can fail.
   *
   *   NFPR.Debug.chaveFalsa()                          a clean, donatable note
   *   NFPR.Debug.chaveFalsa({ mm: '13' })              MES_INVALIDO
   *   NFPR.Debug.chaveFalsa({ uf: '35' })              NAO_PR (grey)
   *   NFPR.Debug.chaveFalsa({ aa: '24' })              EXPIRADA (grey)
   *   NFPR.Debug.chaveFalsa({ modelo: '55' })          an NF-e — exactly as
   *                                                    accepted as the base
   *   NFPR.Debug.chaveFalsa({ modelo: '57' })          TIPO_DOCUMENTO (grey)
   *   NFPR.Debug.chaveFalsa({ documentoEmitente: '12ABC34501DE35' })
   *                                                    an alphanumeric issuer
   *                                                    CNPJ — as donatable as
   *                                                    the base, and the only
   *                                                    way to mint one of these
   *                                                    until a real note turns up
   *   NFPR.Debug.chaveFalsa({ modelo: '55', serie: '930',
   *                           documentoEmitente: '000' + cpf })
   *                                                    a produtor-rural NF-e:
   *                                                    OK, since nothing reads
   *                                                    the série
   *
   * Not itself dangerous — it mints valid digits, nothing more — so it needs no
   * flag and works while the mode is disarmed. tools/smoke.js builds all of its
   * key fixtures with this, which is what keeps the span table honest.
   */
  function chaveFalsa(campos) {
    let s = BASE43 + '0';
    for (const k of Object.keys(campos || {})) {
      const sp = SPANS[k];
      if (!sp) throw new Error('campo desconhecido na chave: ' + k);
      // Upper-cased, so an alphanumeric issuer CNPJ can be written either way.
      const v = String(campos[k]).toUpperCase();
      if (v.length !== sp[1] - sp[0]) {
        throw new Error(k + ' precisa de ' + (sp[1] - sp[0]) + ' caracteres, veio ' + v.length);
      }
      s = s.slice(0, sp[0]) + v + s.slice(sp[1]);
    }
    const b43 = s.slice(0, 43);
    return b43 + NFPR.Chave.calcularCDV(b43 + '0');
  }

  // ---------------------------------------------------------------------------
  // smoke() — the whole verdict table, judged in the browser, in one call
  // ---------------------------------------------------------------------------
  //
  // WHY THIS EXISTS AND tools/smoke.js DOES NOT COVER IT. That script is the
  // exhaustive one, but it runs in Node against stubs. This runs on the surface
  // you are actually looking at: the real load order, the real Intl clock in
  // America/São_Paulo, and whatever is armed right now.
  //
  // IT PASSES THE CLOCK, WHICH IS THE ENTIRE POINT. FUTURA and EXPIRADA carry
  // `relogio: true`, and the runner in chave.js SKIPS a clock-dependent entry
  // when no `agora` was given — deliberately, so a clock-free caller can never
  // receive a time-dependent verdict. The cost is that the obvious console move,
  //
  //   NFPR.Chave.avaliar(chave)          // one argument
  //
  // answers OK for a note dated next month and for one whose deadline passed in
  // April. Nothing is wrong there; the question simply was not asked. Every
  // fixture below is judged with NFPR.Relogio.mesCorrente(), so it cannot be
  // asked wrongly by accident.
  //
  // THE FIXTURES ARE RELATIVE TO THAT SAME CLOCK, never hard-coded months: a
  // literal AAMM starts failing as expired the moment its deadline passes, which
  // is what DOCS.md's hand-built block has to be regenerated for. It also means
  // relogioFixo moves the fixtures and the verdicts together, so the pass is
  // green under time travel — which is itself the check that the fake clock
  // really does reach everything at once.
  //
  // The printed `chave` column is copy-paste fodder for DOCS.md's manual
  // checklist, which needs the digit strings for the month you run it in.

  const dois = (n) => String(n).padStart(2, '0');

  const CPF_EM_CHAVE = '00052998224725'; // '000' + a valid CPF, as [6:20] holds it
  const CNPJ_AVARIADO = '12345678000194'; // BASE43's CNPJ, last digit changed

  const CORES = { entrada: 'vermelho', inelegivel: 'cinza' };

  /**
   * Every case, built against `agora`. `n` is a month offset, so -3 is "the
   * first month past the deadline" whatever month it is today.
   *
   * The expectation is BOTH codigo and gravidade, because the colour is the
   * decision and a check that silently changed sides would otherwise pass here.
   */
  function montarCasos(agora) {
    const mes = (n) => {
      const d = NFPR.Chave.somarMeses(agora, n); // the only month arithmetic
      return { aa: dois(d.ano - 2000), mm: dois(d.mes) };
    };
    const com = (n, extra) => Object.assign(mes(n), extra);
    return [
      { nome: 'K_OK', campos: com(0), codigo: 'OK', gravidade: null,
        porque: 'NFC-e do Paraná, deste mês' },
      { nome: 'K_BADCDV', campos: com(0), avariarCdv: true,
        codigo: 'DIGITO_VERIFICADOR', gravidade: 'entrada',
        porque: 'K_OK com o último dígito trocado' },
      { nome: 'K_SP', campos: com(0, { uf: '35' }),
        codigo: 'NAO_PR', gravidade: 'inelegivel', porque: 'nota real, de outro estado' },
      { nome: 'K_UF99', campos: com(0, { uf: '99' }),
        codigo: 'UF_INEXISTENTE', gravidade: 'entrada', porque: 'estado que não existe' },
      { nome: 'K_NFE', campos: com(0, { modelo: '55' }), codigo: 'OK', gravidade: null,
        porque: 'NF-e do Paraná: aceita como a NFC-e' },
      { nome: 'K_CTE', campos: com(0, { modelo: '57' }),
        codigo: 'TIPO_DOCUMENTO', gravidade: 'inelegivel', porque: 'CT-e: nem NF-e nem NFC-e' },
      { nome: 'K_MES13', campos: com(0, { mm: '13' }),
        codigo: 'MES_INVALIDO', gravidade: 'entrada', porque: 'mês 13' },
      // A letter outside 6..17. On a whole key FORMATO refuses it first;
      // LETRA_FORA_DO_LUGAR answers it while typing, which only tools/smoke.js
      // drives. Red either way, and never grey.
      { nome: 'K_ANO_LETRA', campos: com(0, { aa: '2A' }),
        codigo: 'FORMATO', gravidade: 'entrada', porque: 'letra no ano' },
      { nome: 'K_MODELO_LETRA', campos: com(0, { modelo: '6A' }),
        codigo: 'FORMATO', gravidade: 'entrada', porque: 'letra no modelo' },
      { nome: 'K_SERIE_LETRA', campos: com(0, { serie: '00A' }),
        codigo: 'FORMATO', gravidade: 'entrada', porque: 'letra na série' },
      { nome: 'K_EMITENTE', campos: com(0, { documentoEmitente: CNPJ_AVARIADO }),
        codigo: 'DOCUMENTO_EMITENTE', gravidade: 'entrada', porque: 'CNPJ do emitente não fecha' },
      // The +2 boundary, from both sides. -2 is the last donatable month and -3
      // the first dead one; anything reaching for `mes + 2` breaks one of these
      // for a sixth of the year.
      { nome: 'K_LIMITE', campos: com(-2), codigo: 'OK', gravidade: null,
        porque: 'último mês ainda no prazo (emissão + 2)' },
      { nome: 'K_VELHA', campos: com(-3),
        codigo: 'EXPIRADA', gravidade: 'inelegivel', porque: 'primeiro mês fora do prazo' },
      { nome: 'K_FUTURA', campos: com(1),
        codigo: 'FUTURA', gravidade: 'entrada', porque: 'mês que ainda não chegou' },
      // A produtor rural issues an NF-e (a CPF cannot issue an NFC-e, MOC
      // rejection 337). Nothing reads the série, so it goes out green; whether
      // the reconciliation credits it is the open NF-e question in chave.js.
      { nome: 'K_CPF', campos: com(0, { modelo: '55', serie: '930', documentoEmitente: CPF_EM_CHAVE }),
        codigo: 'OK', gravidade: null,
        porque: 'produtor rural: NF-e, chave válida, sem veredito' },
      // No série is judged. Each of these used to be a verdict.
      { nome: 'K_AVULSA', campos: com(0, { serie: '905' }),
        codigo: 'OK', gravidade: null, porque: 'série avulsa num 65: sem veredito' },
      { nome: 'K_990', campos: com(0, { serie: '990' }),
        codigo: 'OK', gravidade: null, porque: 'série 990: sem veredito' },
      { nome: 'K_SERIE_CPF', campos: com(0, { serie: '930' }),
        codigo: 'OK', gravidade: null, porque: 'série da faixa de CPF num 65: sem veredito' },
      // tpEmis 9 is contingência off-line, which is COMMON on paper receipts
      // and must stay green.
      { nome: 'K_CONTINGENCIA', campos: com(0, { tipoEmissao: '9' }),
        codigo: 'OK', gravidade: null, porque: 'contingência off-line: nota boa' }
    ];
  }

  /**
   * Run every fixture against the current month and print the result.
   *
   *   NFPR.Debug.smoke()                    // table + summary in the console
   *   NFPR.Debug.smoke({ silencioso: true }) // just the returned object
   *
   * Returns { ok, total, falhas, agora, linhas } — `linhas` carries each key,
   * its verdict and the sentence the volunteer would have seen.
   *
   * Needs no flag and works disarmed: it mints digits and reads verdicts,
   * nothing more. It never touches storage and never sends.
   */
  function smoke(opcoes) {
    const silencioso = !!(opcoes && opcoes.silencioso);
    if (!NFPR.Chave || !NFPR.Relogio) {
      console.error('[NFPR] smoke() precisa de chave.js e relogio.js carregados.');
      return null;
    }
    const agora = NFPR.Relogio.mesCorrente();
    const linhas = montarCasos(agora).map((caso) => {
      let chave = chaveFalsa(caso.campos);
      if (caso.avariarCdv) chave = chave.slice(0, 43) + String((Number(chave[43]) + 1) % 10);
      const v = NFPR.Chave.avaliar(chave, agora);
      return {
        nome: caso.nome,
        chave,
        esperado: caso.codigo,
        obtido: v.codigo,
        cor: CORES[v.gravidade] || 'verde',
        ok: v.codigo === caso.codigo && v.gravidade === caso.gravidade,
        porque: caso.porque,
        mensagem: v.mensagem || ''
      };
    });

    const falhas = linhas.filter((l) => !l.ok);
    const resultado = { ok: falhas.length === 0, total: linhas.length, falhas, agora, linhas };
    if (silencioso) return resultado;

    console.log('[NFPR] smoke — mês de referência ' + dois(agora.mes) + '/' + agora.ano +
      (valor('relogioFixo') ? '  (relógio fixo)' : ''));
    if (console.table) console.table(linhas, ['nome', 'chave', 'esperado', 'obtido', 'cor', 'ok']);
    else linhas.forEach((l) => console.log(l.ok ? 'ok  ' : 'FALHOU  ', l.nome, l.chave, l.obtido));
    if (falhas.length) {
      console.error('[NFPR] ' + falhas.length + ' de ' + linhas.length + ' falharam:');
      falhas.forEach((l) =>
        console.error('  ' + l.nome + ': esperado ' + l.esperado + ', veio ' + l.obtido +
          ' — ' + l.porque));
    } else {
      console.log('[NFPR] ' + linhas.length + '/' + linhas.length + ' ok.');
    }
    return resultado;
  }

  // ---------------------------------------------------------------------------
  // Raw storage — deliberately bypassing Config.atualizarConfig
  // ---------------------------------------------------------------------------
  //
  // Breaking storage was never the hard part: any devtools console can already
  // write nonsense into nfpr:config. What was missing is UNDO, which is what
  // makes breaking it on purpose cheap enough to be a test:
  //
  //   const s = await NFPR.Debug.snapshot();
  //   await NFPR.Debug.gravar('nfpr:config', 'lixo');   // reload, watch it cope
  //   await NFPR.Debug.restaurar(s);                    // reload, back to normal

  /** Everything this extension has stored, as a plain object. */
  const despejar = () => api.storage.local.get(null);

  /** A copy of all stored data, to hand back to restaurar(). */
  const snapshot = () => api.storage.local.get(null);

  /** Replace all stored data with a snapshot. Nothing is merged. */
  async function restaurar(dados) {
    if (api.storage.local.clear) await api.storage.local.clear();
    await api.storage.local.set(dados || {});
    return dados;
  }

  /** Write one key raw — no schema, no merge, no serialization. */
  const gravar = (chave, valorBruto) => api.storage.local.set({ [chave]: valorBruto });

  /**
   * Delete stored keys outright. Takes a key or an array of them.
   *
   * NO PAGE RELOAD IS NEEDED after this, and that is not luck: removing a key
   * fires storage.onChanged like any write, and all three subscribers
   * (registrador.js, settings-ui.js, the badge in the service worker) re-READ
   * through Config rather than trusting `newValue` — which arrives undefined
   * here. Config.obterConfig merges defaults on every read, so an absent
   * nfpr:config is simply a fresh one.
   *
   * What does NOT come back is anything held in memory: rows already painted in
   * the results list, and the session de-dup set. Those are not storage-derived
   * and never were.
   */
  const apagar = (chaves) => api.storage.local.remove(chaves);

  function ajuda() {
    console.log(MSG_AJUDA);
    return flags();
  }

  NFPR.Debug = {
    CHAVE_DEBUG,
    FLAGS_PADRAO,
    // reading
    on,
    valor,
    estaAtivo,
    flags,
    resumo,
    aoMudar,
    pronto,
    log,
    // arming
    ligar,
    desligar,
    limpar,
    ajustarVeredito,
    // fixtures + raw storage
    chaveFalsa,
    smoke,
    despejar,
    snapshot,
    restaurar,
    gravar,
    apagar,
    ajuda
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
