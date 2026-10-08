/**
 * registrador.js  (shared bootstrap)
 * -----------------------------------------------------------------------------
 * The half of the pipeline that the live donation page and the bundled offline
 * page do identically:
 *
 *   config -> capture -> judge -> de-dup -> freeze CNPJ -> durable queue
 *
 * "Judge" is Chave.avaliar: red verdicts get a toast and are forgotten,
 * grey ones get a row explaining why the note cannot be donated and stop
 * there, and only a clean key reaches the queue. That single verdict is also
 * the ONE place debug mode can open the gate (NFPR.Debug.ajustarVeredito, see
 * src/shared/debug.js) — a forced note then carries `forcado` onto its row, so
 * the list cannot pass it off as an ordinary one.
 *
 * What happens AFTER that is the whole difference between the two, and stays
 * with each caller: content.js sends; entrada.js stops.
 *
 * IT ALSO OWNS THE FIXED PARTS, and that is why they are here rather than in a
 * settings section. A fixed part is WORKING STATE, not configuration: one
 * sitting's worth of text, whose effect is only visible beside the 44 cells. So
 * the judgement (MSG_PARTE_FIXA, problemaDaParteFixa, valeAte), the naming
 * (rotuloParteFixa) and every write live in this file, which both registrars
 * load and the toolbar POPUP does not — exactly the reach wanted, since that
 * window has no key entry to use a fixed part with. The strip that draws it is
 * src/content/strip-parte-fixa.js, and like painel.js it renders and reads no
 * storage: every handler it gets arrives with the state.
 *
 * ...and the LIVE VERDICT while typing, for the same reason: it is the same
 * Chave.avaliarTemplate the fixed parts are judged with, one ParteFixa.compor
 * away.
 *
 * FIXED PARTS ARE A PREFERENCE (on by default), and both halves of switching
 * it off live here too. The preference is read in ONE place (partesFixasLigadas), which decides whether
 * there is an active fixed part at all — so switching it off makes the feature
 * inert rather than merely invisible — and aplicarDica is the single line
 * that tells a volunteer who is TYPING that the option exists, since with the
 * strip hidden nothing else would.
 *
 * This used to be ~90 duplicated lines, several of them byte-identical
 * (aplicarConfig and the Config.aoMudar handler), with the capture options
 * differing only in deveIgnorarEvento. Every rule below therefore had two
 * copies that had to be kept in step by hand — including the load-bearing one:
 *
 *   THE TARGET CNPJ IS FROZEN AT SCAN TIME. A donation belongs to the entity
 *   that was active when the key was scanned, even if the volunteer changes the
 *   active entity before it is sent.
 *
 * NFPR.Registrador.iniciar({
 *   ui,                  // required — an already-mounted NFPR.UI api
 *   msgDuplicada,        // what to say when a key is scanned twice
 *   deveIgnorarEvento,   // keystrokes that belong to the host page, not us
 *   aoAceitarChave({ chave, cnpj, itemId, gravacao })
 *       // called synchronously once a key has passed judgement and de-dup,
 *       // its target is frozen and its row exists. `gravacao` is the durable
 *       // queue write, still in flight: the live page starts sending without
 *       // waiting for it, the offline page awaits it because it is the only
 *       // record the note will ever have. It resolves to whether the key was
 *       // newly added — false for a repeat the bypass let through.
 * }) -> Promise<{ entidadeAtual, bloquearChave, esquecerChave }>
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  const NFPR = (root.NFPR = root.NFPR || {});

  // What a fixed part's own fixed digits already tell us about the notes it
  // describes. These describe the FIXED PART, not a note, so they do not reuse
  // chave.js's per-note wording.
  //
  // They lived in their own settings section until fixed parts stopped being
  // configuration. HERE rather than in a settings section because of where this
  // file is loaded: both registrars, and NOT the toolbar popup — which is
  // exactly the reach wanted, since the popup has no entry to use a fixed part
  // with and therefore no longer manages one.
  //
  // DIGITO_VERIFICADOR is deliberately absent: a template's check digit is
  // unknowable unless all 44 characters are fixed, which temVariaveis refuses
  // one line earlier, so the code cannot be reached.
  //
  // An entry may be a function of the COMPLETED template when the sentence has
  // to read the fixed part's own digits. Only NAO_PR does today, and it is the
  // reason the door exists: the sentence used to be a fixed string naming SP,
  // so a fixed part fixed to 43 was told it described São Paulo notes.
  //
  // "É de notas…", never "descreve notas…": a fixed part is the start of a key
  // the volunteer typed, and "describes" is a word about patterns nobody uses
  // at a donation table.
  const MSG_PARTE_FIXA = {
    NAO_PR: (t) =>
      'Esta parte fixa é de notas ' + NFPR.Chave.origemEstado(t.slice(0, 2)) +
      ', e só notas do Paraná podem ser doadas.',
    TIPO_DOCUMENTO: 'Esta parte fixa não é de NF-e nem de NFC-e, as únicas que podem ser doadas.',
    // A fixed part is where letters will actually be typed — the head of a key
    // is the issuer's CNPJ — so this one says where they may go.
    LETRA_FORA_DO_LUGAR:
      'Esta parte fixa tem uma letra em posição inválida. Apenas o CNPJ do emitente, ' +
      'no início da chave, pode conter letras.',
    // "Confira o que foi digitado", never "os números": a fixed part may carry
    // letters, and one sentence for all four keeps them reading alike.
    MES_INVALIDO: 'O mês desta parte fixa não existe. Confira o que foi digitado.',
    FUTURA: 'Esta parte fixa é de notas com data no futuro. Confira o que foi digitado.',
    EXPIRADA: 'As notas desta parte fixa já passaram do prazo para doar.',
    DOCUMENTO_EMITENTE:
      'O CNPJ do emitente não confere nesta parte fixa. Confira o que foi digitado.',
    UF_INEXISTENTE: 'O início desta parte fixa não corresponde a nenhum estado. Confira o que foi digitado.'
  };

  /**
   * The first thing a fixed part's fixed spans already rule out, or null.
   *
   * NEVER Chave.avaliar: it begins with COMPRIMENTO, FORMATO and
   * DIGITO_VERIFICADOR, and a template is not all digits by definition.
   * avaliarTemplate skips exactly those and lets `campos` drop whatever a '?'
   * makes unknowable, so one table judges both notes and fixed parts.
   *
   * `completar` is what makes the analysis safe to use: a template being typed
   * is shorter than 44 almost the whole time, and analisarChave returns null
   * for those — so the verdict would never appear until the last character,
   * which is the one moment it is useless.
   *
   * The returned verdict carries `texto`: the fixed-part-side sentence, already
   * resolved. Resolving it HERE rather than at each reader is what lets an
   * entry be a function of the template.
   */
  function problemaDaParteFixa(template) {
    // Debug mode saves anything (src/shared/debug.js). One return covers every
    // reader — the editor's live help, the Aplicar button, and the
    // per-fixed-part warning in the list — so a debug session cannot end up
    // with a fixed part the strip shows as broken but applied anyway. The
    // stale-fixed-part bar calls Chave.avaliarTemplate directly and keeps
    // telling the truth.
    if (NFPR.Debug.on('partesFixasSemValidacao')) return null;

    const completo = NFPR.ParteFixa.completar(template);
    const v = NFPR.Chave.avaliarTemplate(completo, NFPR.Relogio.mesCorrente());
    if (v.ok) return null;
    // A rule with no fixed-part sentence of its own falls back to the note's.
    // That is a safety net, not the intended path: smoke.js fails if a rule a
    // template can trigger has no entry above, because the note's sentence
    // talks about "esta chave" and reads oddly on a fixed part.
    const msg = MSG_PARTE_FIXA[v.codigo];
    v.texto = typeof msg === 'function' ? msg(completo) : (msg || v.mensagem);
    return v;
  }

  /**
   * "vale até MM/YYYY" — the last month notes matching this fixed part can be
   * donated. Only when the fixed part fixes BOTH the year and the month; the
   * coarser cases are not worth guessing at, and this is a nicety rather than
   * vital information. Returns null otherwise.
   *
   * The + 2 comes from Chave.somarMeses so it wraps the year: a fixed part
   * fixed to 11/25 reads 01/2026 and one fixed to 12/25 reads 02/2026. That
   * function is the ONLY month arithmetic in the codebase and anything reaching
   * for `mes + 2` here would be wrong for a sixth of all notes.
   */
  function valeAte(template) {
    const a = NFPR.Chave.analisarChave(NFPR.ParteFixa.completar(template));
    if (!a || a.aa === null || a.mm === null) return null;
    const limite = NFPR.Chave.somarMeses({ ano: 2000 + Number(a.aa), mes: Number(a.mm) }, 2);
    return 'vale até ' + String(limite.mes).padStart(2, '0') + '/' + limite.ano;
  }

  /**
   * The fixed part's own FIXED digits, grouped in fours and truncated FROM THE
   * FRONT with a leading ellipsis. Two things about that:
   *
   * The trailing '?' run goes. A stored fixed part is always completed to 44,
   * so without this every unnamed fixed part reads "…?? ???? ???? ???? ????
   * ????" — the padding, and nothing that identifies it. Interior '?'s stay:
   * they are part of the pattern.
   *
   * And it keeps the LAST groups, not the first. Every Paraná key starts
   * `41` and most fixed parts share a long head, so truncating the other way
   * renders a column of identical rows. Whole groups, so the digits stay
   * readable in the fours they are printed in. Four where the text stands in
   * for a name (the strip, a row's name line); `GRUPOS_LINHA_DE_DIGITOS` where
   * it has a line of its own under a name, which is as many as that line fits.
   */
  const GRUPOS_LINHA_DE_DIGITOS = 7;
  function textoCompletoDaParteFixa(template) {
    return NFPR.agruparChave(NFPR.ParteFixa.normalizar(template).replace(/\?+$/, ''));
  }
  function textoDaParteFixa(template, quantos = 4) {
    const grupos = textoCompletoDaParteFixa(template).split(' ');
    return grupos.length > quantos ? '…' + grupos.slice(-quantos).join(' ') : grupos.join(' ');
  }

  /**
   * What to call a fixed part on screen. NAMES ARE OPTIONAL and a blank one is
   * a first-class state, not a missing value — so an unnamed fixed part shows
   * its own digits wherever a name would go, and nothing is ever defaulted to
   * the word "Parte fixa", which named nothing and made every unnamed fixed
   * part look alike.
   */
  function rotuloParteFixa(m) {
    if (!m) return null;
    const nome = (m.nome || '').trim();
    return nome || textoDaParteFixa(m.template);
  }

  /**
   * A keystroke aimed at a real form field OF THE HOST PAGE is the page's,
   * never ours — the government site's own inputs, e.g. inside its entity
   * search dialog.
   *
   * IT CANNOT SEE INTO OUR OWN ROOTS, and must not be credited with it. Capture
   * listens on the document, and from there `composedPath()` stops at a
   * CLOSED shadow root's host: a keystroke in the strip's fixed part field,
   * its filter or a rename field arrives looking like one on the host `div`,
   * which is not a form field. Those fields are kept out of the buffer by
   * `estaAtivo` instead (`ui.editandoParteFixa()`, the strip's `editando()`).
   * It is the default for both registrars because it costs nothing, not
   * because the offline page has fields for it to find.
   */
  function eventoDeCampoExterno(e) {
    const alvo = e.composedPath ? e.composedPath()[0] : e.target;
    if (!alvo || !alvo.tagName) return false;
    // Unreachable while the registrar's root is closed (the proxy is inside
    // it, so the host is what arrives here). Kept because it is the one line
    // standing between an OPEN root and a capture that ignores every key typed
    // into its own entry.
    if (alvo.classList && alvo.classList.contains('nfpr-proxy')) return false;
    if (alvo.isContentEditable) return true;
    const tag = alvo.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  async function iniciar(opcoes) {
    const { Chave, ParteFixa, Config, Audio, Relogio, Debug } = NFPR;
    const ui = opcoes.ui;

    // aceitar() is synchronous and cannot await, so the debug cache has to be
    // primed before the first key can arrive. Awaited here, once, beside the
    // config read it already does.
    await Debug.pronto();

    let cfg = await Config.obterConfig();
    let inst = Config.entidadeAtiva(cfg);

    /**
     * FIXED PARTS ARE A PREFERENCE, ON BY DEFAULT (config.js): a fixed part is
     * a typist's tool, and the volunteer holding a scanner never types a digit,
     * so they may switch the strip off as clutter.
     *
     * Off means the feature is INERT, not merely invisible, and this one line
     * is the whole of it: with no active fixed part, templateAtivo() is null
     * and every fixed part surface downstream — the composition in aceitar, the
     * live verdict's template, the stale-fixed-part bar, the
     * scanned-under-a-fixed-part bar, the strip's own label — goes quiet on its
     * own. Hiding the strip while still applying a fixed part would be the
     * dangerous half: a fixed part puts digits in the cells that nobody typed,
     * and the one-click way out of that lives on the strip that is no longer
     * there.
     *
     * Nothing is deleted by turning it off. `parteFixaAtivaId` stays in
     * storage, so switching it back on restores the sitting exactly as it was
     * left.
     */
    const partesFixasLigadas = () => cfg.preferencias.partesFixas === true;
    let parteFixa = partesFixasLigadas() ? Config.parteFixaAtiva(cfg) : null;

    // Has a note been entered BY HAND in this session? The offer below is for
    // typists and nobody else, and capture is the only thing that can tell the
    // difference: a typed key and a scanned one are both 44 digits by the time
    // they reach here.
    let digitouAMao = false;

    const temCnpj = () => !!(inst && inst.cnpj);
    const templateAtivo = () => (parteFixa && parteFixa.template ? parteFixa.template : null);

    /**
     * Does the active fixed part now describe notes that can no longer be
     * donated?
     *
     * EXPIRADA is the only verdict time can switch on — every other problem is
     * refused when the fixed part is created — so a fixed part that was fine
     * yesterday can only fail this way. Most fixed parts fix the issuer prefix,
     * which spans digits 0–21 and therefore includes AAMM, so this is routine
     * rather than an edge case; a fixed part with a variable AAMM never
     * expires.
     */
    function parteFixaVencida() {
      const template = templateAtivo();
      if (!template) return false;
      // Only EXPIRADA counts. A saved fixed part cannot be carrying any other
      // verdict — creation refuses every one of them, and they are all
      // time-invariant — so an earlier entry firing here would mean the fixed
      // part was saved with validation bypassed (debug mode), and this bar is
      // not the place to say so. The settings list re-checks and words it
      // properly.
      return Chave.avaliarTemplate(
        ParteFixa.completar(template),
        Relogio.mesCorrente()
      ).codigo === 'EXPIRADA';
    }

    // ---- The fixed part surface ---------------------------------------------
    // Everything the strip draws, computed here because this file owns the
    // config reads; the strip reads no storage and makes no request, exactly
    // like painel.js.
    //
    // ORDERED BY LAST USE, and by nothing else. Saved-vs-recent is a LIFECYCLE
    // property — will this still be here tomorrow? — not a selection one, and
    // using it as the primary sort meant whichever tier came first pushed the
    // other out of a popover that is at most a few rows tall. Saved fixed parts
    // are uncapped, so a volunteer with twenty of them never saw a recent
    // again; putting the recents first only moves the burial.
    //
    // Recency is the one dimension the volunteer is actually choosing along:
    // the fixed part just activated is first whatever tier it is in, and the
    // two or three used in this sitting stay at the top. The tier is still on
    // every row — it is what the first button says, `Salvar` or `Renomear` —
    // and it still decides eviction; it just no longer decides position.
    function listaDePartesFixas() {
      return cfg.partesFixas
        .slice()
        .sort((a, b) => (b.usadaEm || 0) - (a.usadaEm || 0))
        .map((m) => {
          const problema = problemaDaParteFixa(m.template);
          return {
            id: m.id,
            nome: m.nome || '',
            template: m.template,
            rotulo: rotuloParteFixa(m),
            texto: textoDaParteFixa(m.template),
            textoLongo: textoDaParteFixa(m.template, GRUPOS_LINHA_DE_DIGITOS),
            // The whole of it, untruncated — the row's hover tooltip, since
            // `texto` keeps only the last four groups.
            textoCompleto: textoCompletoDaParteFixa(m.template),
            variaveis: ParteFixa.contarVariaveis(m.template),
            // No `salva` travels with the row: `nome` already carries it, and a
            // second field saying the same thing is a second field that can
            // disagree.
            //
            // ONE TIME-LINE AT A TIME. While the fixed part is good the row
            // carries the compact "vale até" clause; once it is stale that
            // clause is REPLACED by the sentence below rather than sitting
            // beside it. Since saved fixed parts are never capped or evicted
            // and "Limpar as não salvas" deliberately skips them, this marking
            // is the only thing that ever prompts a stale saved fixed part off
            // the list.
            valeAte: problema ? null : valeAte(m.template),
            // STALE IS NOT THE SAME AS PROBLEMATIC, and the footer's broom
            // needs to know which. Only the clock produces EXPIRADA; every
            // other verdict here is a fixed part that could never describe a
            // donatable note and the editor refuses to save one. They read
            // alike on the row — both are one amber sentence — so the
            // difference travels as a field rather than being recovered by
            // matching the sentence downstream, which is how a reworded string
            // silently changes what a button sweeps.
            vencida: !!problema && problema.codigo === 'EXPIRADA',
            problema: !problema
              ? null
              : problema.codigo === 'EXPIRADA'
                ? 'Fora do prazo: as notas desta parte fixa não podem mais ser doadas. Recomenda-se removê-la.'
                : problema.texto
          };
        });
    }

    /** The live help under the editor, and the gate on Aplicar. */
    function avaliarTextoDeParteFixa(texto) {
      const t = ParteFixa.normalizar(texto || '');
      if (!t) {
        return { texto: 'Insira a parte que se repete nas chaves.', erro: false };
      }
      const completo = ParteFixa.completar(t);
      // A FIXED PART FIXES AT LEAST ONE DIGIT. Nothing but '?' is the whole key
      // typed by hand, so it saves nothing — and it leaves rotuloParteFixa with
      // no digits to name it by, which the strip reads as "no fixed part" while
      // ParteFixa.resolver still flags every good scan as having ignored one.
      if (!ParteFixa.temFixos(completo)) {
        return {
          texto: 'A parte fixa precisa ter ao menos um número. Insira a parte que se repete nas chaves.',
          erro: true
        };
      }
      if (!ParteFixa.temVariaveis(completo)) {
        // 44 fixed digits is the same key every time; the entry would accept
        // nothing at all.
        return {
          texto: 'Esta parte fixa ocupa a chave inteira e não deixa nada a digitar. Remova alguns números do final.',
          erro: true
        };
      }
      // A letter outside the issuer's CNPJ is LETRA_FORA_DO_LUGAR, the first
      // verdict the table asks a template. NO FIXED SPAN MAY FORCE A NON-DONATABLE NOTE. A fixed part cannot
      // guarantee a valid note — the variable digits still have to produce a
      // good check digit — but it must not guarantee an invalid one. Grey
      // blocks like red: "real note, cannot be donated" would describe every
      // note this fixed part could ever produce.
      const problema = problemaDaParteFixa(completo);
      if (problema) return { texto: problema.texto, erro: true };
      const variaveis = ParteFixa.contarVariaveis(completo);
      return {
        texto:
          'A parte fixa tem ' + (ParteFixa.COMPRIMENTO - variaveis) +
          ' — você digita só ' + variaveis + ' em cada nota.',
        erro: false
      };
    }

    /** Stamp `usadaEm` on one fixed part. Ordering is the only thing it feeds.
     * */
    const carimbarUso = (lista, id, agora) =>
      lista.map((m) => (m.id === id ? Object.assign({}, m, { usadaEm: agora }) : m));

    function ativarParteFixa(id) {
      return Config.atualizarConfig((c) => ({
        parteFixaAtivaId: id,
        partesFixas: id ? carimbarUso(c.partesFixas, id, Date.now()) : c.partesFixas
      }));
    }

    /**
     * The editor's Aplicar, and the one place a fixed part is created or
     * changed.
     *
     * EDITING UPDATES IN PLACE, WITH NO GUARD, saved or not — "small
     * adjustments" is the stated use, and forking on every keystroke would be a
     * mode. What makes that safe is the line below it: applying an edit pushes
     * the OLD text to the top of the recent list, so the previous fixed part is
     * never lost. Free undo, one line, and exactly how a clipboard behaves.
     *
     * `novo` comes from "+ Nova parte fixa": with a fixed part already active,
     * that gesture has to make a second one rather than overwrite the first.
     */
    function aplicarTextoDeParteFixa(texto, novo) {
      const t = ParteFixa.normalizar(texto || '');
      // An emptied field means "chave inteira" — when it is the ARMED fixed
      // part's field. Nothing is deleted by it; the fixed part it deactivates
      // is still in the list. An empty "Nova parte fixa" field means nothing at
      // all: the volunteer set out to write a second fixed part and changed
      // their mind, and disarming the first one on the way out answers a
      // question nobody asked.
      if (!t) return novo ? Promise.resolve() : Config.atualizarConfig({ parteFixaAtivaId: null });
      const template = ParteFixa.completar(t);
      return Config.atualizarConfig((c) => {
        const agora = Date.now();
        const ativa = novo ? null : c.partesFixas.find((m) => m.id === c.parteFixaAtivaId);
        let lista;
        let ativaId;
        if (ativa && ativa.template !== template) {
          const jaExiste = c.partesFixas.some((m) => m.id !== ativa.id && m.template === ativa.template);
          lista = c.partesFixas.map((m) =>
            m.id === ativa.id ? Object.assign({}, m, { template, usadaEm: agora }) : m
          );
          if (!jaExiste) {
            lista = lista.concat([
              { id: Config.gerarId(), nome: '', template: ativa.template, usadaEm: agora - 1 }
            ]);
          }
          ativaId = ativa.id;
        } else if (ativa) {
          lista = carimbarUso(c.partesFixas, ativa.id, agora);
          ativaId = ativa.id;
        } else {
          // Re-typing a fixed part that is already in the list simply brings it
          // back to the top rather than filing a twin beside it.
          const existente = c.partesFixas.find((m) => m.template === template);
          if (existente) {
            lista = carimbarUso(c.partesFixas, existente.id, agora);
            ativaId = existente.id;
          } else {
            const nova = { id: Config.gerarId(), nome: '', template, usadaEm: agora };
            lista = c.partesFixas.concat([nova]);
            ativaId = nova.id;
          }
        }
        return { partesFixas: Config.podarPartesFixas(lista, ativaId), parteFixaAtivaId: ativaId };
      });
    }

    const acoesDaParteFixa = {
      aoAtivar: ativarParteFixa,
      aoAplicarTexto: aplicarTextoDeParteFixa,
      // NAMING IS SAVING, so this is also the only way in and out of the saved
      // tier — there is no separate ★ to toggle. Writing a name pins the fixed
      // part; clearing it back to blank lets it go and it starts ageing off the
      // recent list again. Pruned on the way out for that second case: an
      // un-named fixed part rejoins a tier that has a cap, and the eleventh has
      // to fall off in the same write that made it the eleventh.
      aoRenomear: (id, nome) =>
        Config.atualizarConfig((c) => ({
          partesFixas: Config.podarPartesFixas(
            c.partesFixas.map((m) =>
              m.id === id
                ? Object.assign({}, m, { nome: String(nome || '').trim().slice(0, 60) })
                : m
            ),
            c.parteFixaAtivaId
          )
        })),
      aoRemover: (id) =>
        Config.atualizarConfig((c) => ({
          partesFixas: c.partesFixas.filter((m) => m.id !== id),
          parteFixaAtivaId: c.parteFixaAtivaId === id ? null : c.parteFixaAtivaId
        })),
      // A shared machine accumulates other people's fixed parts. This is the
      // one-click answer, and it NEVER touches a saved one — that is what
      // naming a fixed part promises.
      aoLimparNaoSalvas: () =>
        Config.atualizarConfig((c) => {
          const restam = c.partesFixas.filter((m) => Config.parteFixaSalva(m));
          return {
            partesFixas: restam,
            parteFixaAtivaId: restam.some((m) => m.id === c.parteFixaAtivaId) ? c.parteFixaAtivaId : null
          };
        }),
      // THE COMPLEMENT OF THE ONE ABOVE, and deliberately NOT by tier. A stale
      // fixed part is worthless whether or not somebody named it — every note
      // entered under it would die — and the row's own marking is the only
      // thing that ever prompts a stale SAVED fixed part off the list. So this
      // one sweeps both tiers, which is precisely what the other one may never
      // do: between them they cover the two ways a fixed part stops being worth
      // keeping, and neither is a broader version of the other.
      //
      // EXPIRED ONLY, never every marked row, because the label says
      // "vencidas" and a button has to take exactly what it names. The other
      // verdicts a fixed part can carry are not staleness: they mean the fixed
      // part could never describe a donatable note, the editor refuses to save
      // one, and the row that somehow holds one has its own `Remover`. Sweeping
      // those under this word would destroy them under a sentence that never
      // applied to them.
      //
      // Judged by the same `problemaDaParteFixa` the rows are painted from, so
      // the set this takes is the set the list marks as out of time — a
      // predicate of its own would drift, and both directions are silent: it
      // would either leave a marked row sitting there after the sweep, or
      // destroy a row that never said it was stale.
      aoLimparVencidas: () =>
        Config.atualizarConfig((c) => {
          const restam = c.partesFixas.filter((m) => {
            const p = problemaDaParteFixa(m.template);
            return !p || p.codigo !== 'EXPIRADA';
          });
          return {
            partesFixas: restam,
            parteFixaAtivaId: restam.some((m) => m.id === c.parteFixaAtivaId) ? c.parteFixaAtivaId : null
          };
        }),
      // THE 44 CELLS ARE THE PREVIEW. `null` means "put them back the way the
      // active fixed part leaves them" — the preview was a look at a fixed part
      // that was never applied.
      // `caret` is the strip field's own cursor, which is a cell index because
      // a normalised fixed part is one character per cell. It is only
      // meaningful while the editor is open, so closing it (texto === null)
      // hands none.
      aoPreverTexto: (texto, caret) => {
        const t =
          texto === null ? templateAtivo() : texto ? ParteFixa.completar(texto) : null;
        ui.definirParteFixaTemplate(t);
        ui.limparDisplay(texto === null ? null : caret);
      },
      // OPENING THE EDITOR EMPTIES THE ENTRY, and it has to: the cells become
      // the fixed part preview the moment the field opens, so a half-typed key
      // would still be in the buffer while nothing on screen said so — and
      // pressing Enter afterwards would submit digits the volunteer can no
      // longer see. Same reasoning as the reset on every config change: the
      // fixed part is about to move, and a partial entry under the old one is
      // stale either way.
      aoAbrirEditor: () => {
        captura.reset();
        ui.setProgressoEntrada(0);
        mostrarVeredito(null);
      },
      // Back to the entry — UNLESS THE SETTINGS OVERLAY IS UP. The editor also
      // closes when fixed parts are switched off, and the switch is in
      // Preferências: focusing the entry then pulled the keyboard out of the
      // form being used and parked it behind the backdrop, where capture is
      // inert anyway. The overlay hands focus to the entry itself when it
      // closes.
      aoFecharEditor: () => {
        if (!ui.estaAberto()) ui.focarEntrada();
      },
      avaliarTexto: avaliarTextoDeParteFixa
    };

    // What the live verdict line is showing right now, so a SUSPECTED run can
    // keep it (see onMudanca below). Every write goes through here, or the
    // record drifts from the screen.
    let vereditoMostrado = null;
    function mostrarVeredito(v) {
      vereditoMostrado = v;
      ui.setStatusVeredito(v);
    }

    // What a half-typed entry depends on: the entity it will be frozen to and
    // the fixed part whose gaps it fills. See the Config.aoMudar handler.
    function assinaturaDaEntrada() {
      return JSON.stringify([inst ? inst.id : null, inst ? inst.cnpj : null, templateAtivo()]);
    }
    let assinaturaAplicada = assinaturaDaEntrada();

    // `limparEntrada` is false when the change leaves a half-typed entry
    // meaning what it meant, and then nothing about the entry is touched: the
    // cells, the progress pill, the live verdict and the scan-under-a-fixed-
    // part bar all still describe it.
    function aplicarConfig(limparEntrada = true) {
      Audio.setHabilitadoAlerta(cfg.preferencias.somAlerta !== false);
      Audio.setHabilitadoLeitura(!!cfg.preferencias.somLeitura);
      Audio.setHabilitadoSucesso(!!cfg.preferencias.somSucesso);
      ui.setEntidade(inst);
      ui.setAutoEnviar(cfg.preferencias.autoEnviar);
      ui.setFlash(cfg.preferencias.piscar !== false);
      ui.definirParteFixaTemplate(templateAtivo());
      // Before setPartesFixas, so a strip going away closes its editor before
      // anything repaints inside it.
      ui.setPartesFixasVisiveis(partesFixasLigadas());
      ui.setPartesFixas(
        {
          rotulo: rotuloParteFixa(parteFixa),
          variaveis: ParteFixa.contarVariaveis(templateAtivo()),
          template: templateAtivo(),
          // `fixed part` and not cfg.parteFixaAtivaId: with the preference off
          // the stored id survives untouched, and nothing may render as active
          // while nothing is being applied.
          ativaId: parteFixa ? parteFixa.id : null,
          lista: listaDePartesFixas()
        },
        acoesDaParteFixa
      );
      aplicarDica();
      if (limparEntrada) {
        ui.setProgressoEntrada(0);
        mostrarVeredito(null);
      }
      // THE RESTING STATE OF THE STATUS LINE, and deliberately not a condition
      // bar. Debug mode gets one because it can fabricate notes; this cannot —
      // it is a legitimate chosen mode, and an alarm that can never be answered
      // is one people stop reading.
      ui.setStatusRepouso(
        cfg.preferencias.enviarSemValidar === true
          ? {
              texto: 'Envio sem verificação prévia — a decisão cabe ao servidor do Nota Paraná.',
              aviso: true,
              rotulo: 'Preferências',
              aoClicar: () => ui.abrir('config')
            }
          : null
      );
      // The scan-under-a-fixed-part bar is about the fixed part that was armed
      // when it happened, so a change of fixed part (or of entity) answers it;
      // a name filled in by the registry does not.
      if (limparEntrada) ui.setParteFixaIgnorada(null);
      // Deliberately a bar and NOT a bloquearEntrada: a full 44-digit scan
      // beats the fixed part (parte-fixa.js), so the scanner keeps working
      // perfectly with a stale fixed part active and only typed entry under it
      // is dead. Blocking would break scanning for no reason. Runs on load and
      // on every config change, so the banner maintains itself — and the
      // offline page, which shares this bootstrap, gets it free.
      ui.setParteFixaVencida(
        parteFixaVencida()
          ? {
              // EDITING IS THE PRIMARY ANSWER: a fixed part whose month has
              // passed usually needs two digits changed, and throwing it away
              // was the only thing on offer while fixed parts were
              // add-and-remove records.
              aoEditar: () => ui.abrirEditorDeParteFixa(),
              aoDispensar: () => Config.atualizarConfig({ parteFixaAtivaId: null })
            }
          : null
      );
      if (limparEntrada) ui.limparDisplay();
      if (temCnpj()) ui.desbloquearEntrada();
      else ui.bloquearEntrada('Para começar, cadastre a entidade que receberá as doações.');
    }

    /**
     * THE ONE LINE THAT TELLS A TYPIST THE OPTION EXISTS.
     *
     * With fixed parts off there is nothing on screen about them at all, which
     * is the point — and it leaves the one person they were built for with no
     * way to discover them. So: once a note has been entered BY HAND, and only
     * then, the status line under the cells carries the offer.
     *
     * ONLY TYPISTS SEE IT. A scan never raises it, whatever else is going on,
     * because someone reading barcodes will not type a digit all day and a
     * suggestion they can never use is exactly the clutter the preference
     * exists to remove.
     *
     * It is TEXT ON THE STATUS LINE, not a bar and not a toast: the same quiet
     * channel as the live verdict, one line under the cells the volunteer is
     * already looking at, and the lowest of that line's four priorities — a
     * suggestion may never take the line away from a verdict about the note
     * being entered.
     *
     * IT IS ANSWERABLE, and that is what separates it from every condition bar
     * in painel.js. A condition has no dismiss because it is repainted from a
     * state that is still true; this is an offer, and an offer that cannot be
     * refused is furniture for the rest of the volunteer's session. Either
     * button answers it, and so does the switch in Preferências
     * (sec-preferencias.js), in either direction.
     *
     * AN ANSWER IS NOT PERMANENT, and that is deliberate: it is stamped with
     * the moment it was given and expires after Config.PRAZO_DICA_PARTES_FIXAS.
     * These machines are shared and the volunteers rotate, so one person's
     * "Não mostrar" cannot be allowed to speak for everybody who sits down
     * after them — a dismissal that never expires leaves the install silent
     * about the feature for the rest of its life. Nothing here senses that the
     * person changed, because nothing here could; the offer simply becomes
     * askable again, and is still gated on somebody typing by hand.
     *
     * NO SOUND, for the reason the live verdict has none: four cues are the
     * whole set, and nothing here is an event.
     */
    function aplicarDica() {
      const oferecer =
        digitouAMao &&
        !partesFixasLigadas() &&
        Config.dicaPartesFixasVencida(cfg.preferencias.dicaPartesFixasEm);
      ui.setStatusDica(
        !oferecer
          ? null
          : {
              // A question about the volunteer's own receipts, then the same
              // verb as the strip's invitation ("fixar o começo") — see *Words
              // for the fixed part* in CLAUDE.md.
              texto: 'As chaves das suas notas começam iguais? Você pode fixar esse começo e digitar apenas o restante de cada uma.',
              // It arms the preference and NOTHING ELSE — no editor opens by
              // itself. The strip appears carrying its own invitation, which
              // is the next step with the volunteer steering; an editor
              // opening here would take the keyboard just as the next note is
              // about to be entered.
              //
              // AND IT ARMS NO FIXED PART. With the preference off the stored
              // `parteFixaAtivaId` survives untouched, so switching it on would
              // re-arm whatever the last person chose — putting digits nobody
              // typed into the cells at the exact moment this offer has just
              // introduced the feature to somebody who has never met it. That
              // reads as the software being broken, which is the one thing
              // this line exists to avoid. The fixed part itself is not
              // deleted; it is in the list on the strip, one click away.
              //
              // The switch in Preferências deliberately does NOT do this: that
              // is a volunteer who knows what a fixed part is turning their own
              // one back on, and DOCS.md's checklist promises it comes back
              // armed.
              rotulo: 'Ativar',
              aoClicar: () =>
                Config.atualizarConfig({
                  parteFixaAtivaId: null,
                  preferencias: { partesFixas: true, dicaPartesFixasEm: Date.now() }
                }),
              rotuloDispensar: 'Não mostrar',
              aoDispensar: () =>
                Config.atualizarConfig({ preferencias: { dicaPartesFixasEm: Date.now() } })
            }
      );
    }

    /**
     * The debug banner (src/shared/debug.js). A condition, exactly like
     * setParteFixaVencida above: no dismiss control, repainted from the state
     * every time it changes, and its button just disarms the mode — so it
     * cannot get stuck showing, or stuck hidden while debug is on.
     *
     * Here rather than in each caller so both registrars get it free, and so
     * the offline page — which shares this bootstrap — cannot silently miss it.
     */
    function aplicarDebug() {
      ui.setDebug(Debug.estaAtivo(), Debug.resumo(), () => Debug.desligar());
    }

    aplicarConfig();
    aplicarDebug();
    Debug.aoMudar(aplicarDebug);
    if (temCnpj()) ui.focarEntrada();

    // THE KEYBOARD NEVER RESTS ON NOTHING. Capture hears a physical keyboard
    // and a scanner wherever focus is, the bare page included — but an
    // on-screen keyboard delivers its keys only while a field has focus, and
    // with focus on the page it sends nothing at all, not one event (recorded
    // with the Windows one, 2026-10-07; the entry's own read-only input was
    // enough for it). The entry takes the keyboard at load and after every
    // submission, so the gap was a click: pressing on anything that is not a
    // control drops focus to the page, and from then on that keyboard was dead
    // until the volunteer thought to click the 44 cells.
    //
    // So a click, or the window coming back, that leaves the keyboard on
    // nothing hands it to the entry. Only on nothing — a control, a field of
    // ours or the page's own keeps what it was given, and the settings overlay
    // keeps the keyboard inside itself. And never under a text selection:
    // focusing an input collapses it, and dragging across a key on a row is
    // how one is copied.
    function devolverTeclado() {
      if (!temCnpj() || ui.estaAberto()) return;
      const ativo = document.activeElement;
      if (ativo && ativo !== document.body && ativo !== document.documentElement) return;
      const selecao = typeof document.getSelection === 'function' ? document.getSelection() : null;
      if (selecao && String(selecao)) return;
      ui.focarEntrada();
    }
    document.addEventListener('click', devolverTeclado, true);
    root.addEventListener('focus', devolverTeclado);

    // Notes the server rejected without an answer we could read, from this
    // session or any earlier one. Painted by the SHARED bootstrap so both
    // registrars show it: the offline page can never add to the record — it
    // never sends — but a volunteer who lands there after a bad batch is
    // entitled to see that those notes are still unregistered. Not awaited;
    // nothing downstream depends on it and a scan must not wait for storage.
    Config.obterFalhas()
      .then((lista) => ui.setFalhas(lista))
      .catch(() => {});

    // ---- De-dup ---------------------------------------------------------------
    // A key is blocked from the moment it is accepted. Only the caller knows
    // when that should be undone: the live page forgets a key whose send FAILED
    // (so rescanning it is a real retry), while the offline page has no failure
    // path at all and keeps it blocked for the whole session.
    //
    // THREE STATES, not two. A key is either absent (scannable), present with a
    // null value (accepted, queued or sent — a rescan is a plain duplicate), or
    // present with the verdict that refused it. That third case exists because
    // "Esta chave já foi registrada" would be a lie about a note that
    // was refused as ineligible and never registered at all: it stays blocked,
    // because knowing you already scanned it matters more than re-hearing why,
    // but the row has to say the true thing.
    //
    // The map is kept up to date AND consulted whatever the volunteer's
    // `enviarSemValidar` preference says; that preference decides only whether
    // a repeat is refused or merely announced on its own row. The reasoning is
    // at the check itself.
    const registradas = new Map();

    /**
     * THE LIVE VERDICT WHILE TYPING, and it is nearly free.
     *
     * Nothing used to tell a typist they had gone wrong until all 44 digits
     * were in — 38 wasted digits for a mistyped state code, hundreds of times a
     * day. Chave.avaliarTemplate already judges 44 characters of digits and '?'
     * by skipping any rule whose `campos` are unknowable, and a partially typed
     * key IS such a string, so this is one existing function and one existing
     * table:
     *
     *   after digit  2 — UF_INEXISTENTE (red), NAO_PR (grey)
     *                4 — FUTURA (red), EXPIRADA (grey) — the date checks
     *                    judge the whole year until the month is in, so they
     *                    speak only when every month of it would, and
     *                    EXPIRADA then names the year alone
     *                6 — MES_INVALIDO, FUTURA (red), EXPIRADA (grey)
     *               20 — DOCUMENTO_EMITENTE (red)
     *               22 — TIPO_DOCUMENTO (grey)
     *
     * A LETTER OUTSIDE 6..17 IS RED AT THE LETTER ITSELF (LETRA_FORA_DO_LUGAR),
     * whichever span it lands in — the série and the invoice number included,
     * which no other rule reads.
     *
     * Otherwise nothing fires after 22: nothing reads the série or tpEmis (see
     * MODELOS_ACEITOS in chave.js), so the rest is the check digit's, at Enter.
     *
     * THERE ARE NO FALSE POSITIVES, STRUCTURALLY: `campos` guarantees every
     * span a rule reads is complete before the rule is asked, so a verdict that
     * fires on a prefix cannot be un-fired by later digits. Under a fixed part
     * the digits it fixes are known from the start, so a fixed part fixing the
     * issuer prefix settles DOCUMENTO_EMITENTE and TIPO_DOCUMENTO before
     * anything is typed and they simply never fire — correct, since the fixed
     * part was judged when it was applied.
     *
     * IT BLOCKS NOTHING, and it is neither a toast, a row, a bar nor a count.
     * A transient state on the entry, cleared by the next keystroke and
     * superseded by the real verdict at Enter. Typing all 44 digits still
     * produces exactly the row it produces today. It also SPEAKS under
     * `enviarSemValidar` and refuses nothing there either, consistent with that
     * preference's own rule that the checks still run and still speak.
     *
     * NO SOUND, and no fifth cue: it fires several times per note and a sound
     * per span would be intolerable in a shared room. NO SPAN IS HIGHLIGHTED
     * either — the caret is already sitting at the offending span, and pointing
     * at one invites diagnosis-by-position, which is how a volunteer concludes
     * the RECEIPT is bad and bins a good one.
     */
    function vereditoParcial(estado) {
      // Silent during a machine burst: a scan fills 44 cells in ~50 ms and
      // flashing four verdicts on the way past is noise. The scan gets its real
      // verdict at submit, as always. A merely SUSPECTED run is the caller's
      // question (onMudanca, below), not this function's.
      if (estado.rajada || !estado.typed.length) return null;
      // A SCAN CORRECTED BY HAND is judged as the key it is, never through the
      // fixed part: under one, `typed` holds only the scan's head, and the key
      // being corrected is in `raw` (see onMudanca below).
      const parcial = estado.escaneado && templateAtivo()
        ? ParteFixa.compor(null, Chave.chaveParcial(estado.raw))
        : ParteFixa.compor(templateAtivo(), estado.typed);
      const v = Chave.avaliarTemplate(parcial, Relogio.mesCorrente());
      if (v.ok) return null;
      // Red says one thing and names no check: which one fired is a fact about
      // our net, never about the note. "A chave de acesso", not "os números":
      // a key may carry letters, and the red is often for one.
      if (v.gravidade === 'entrada') return { texto: 'Confira a chave de acesso.', erro: true };
      // Grey is half the value. A volunteer holding an out-of-state receipt or
      // a CT-e types all 44 digits to be told so, and now knows at digit 2.
      return { texto: v.mensagem + ' Esta nota não pode ser doada.', aviso: true };
    }

    // ---- Capture --------------------------------------------------------------
    const captura = NFPR.Capture.iniciar({
      // Capture is live whenever an entity is set, the settings/help modal is
      // closed, and no field of the strip's has the keyboard. That last one is
      // NOT belt and braces: the strip's fields sit inside a closed shadow
      // root, where deveIgnorarEvento below cannot see them, so this is the
      // only thing keeping their keystrokes out of the key buffer.
      estaAtivo: () => temCnpj() && !ui.estaAberto() && !ui.editandoParteFixa(),
      // KEYSTROKES AIMED AT A REAL FORM FIELD OF THE HOST PAGE BELONG TO THE
      // PAGE. The test is not site-specific — INPUT / TEXTAREA / SELECT /
      // contentEditable — so it is the default here rather than a parameter
      // each caller remembers.
      deveIgnorarEvento: opcoes.deveIgnorarEvento || eventoDeCampoExterno,
      getAutoEnviar: () => cfg.preferencias.autoEnviar,
      getParteFixaVariaveis: () => ParteFixa.contarVariaveis(templateAtivo()),
      onMudanca(estado) {
        // THE FIXED PART STEPS ASIDE FOR A SCAN. Once a burst is believed, a
        // whole key is arriving and a full 44-digit read beats the fixed part
        // (ParteFixa. resolver) — so drawing the fixed part's fixed digits with
        // the barcode's HEAD in its gaps showed a key nobody scanned, on the
        // cells the volunteer is watching. The cells show the scan's own digits
        // instead, read from `raw` because `typed` is capped at the fixed
        // part's variable count, and with no progress pill, whose "N de M"
        // counts the fixed part's gaps. Display only: the buffers, the resolver
        // and the stored fixed part are untouched, and submitting repaints the
        // cells with the fixed part (limparDisplay reads the template it was
        // left with). The "você escaneou uma nota inteira" bar is aceitar()'s
        // and still raises. A SUSPECTED run keeps the fixed part: nothing is
        // believed yet.
        //
        // AND IT STAYS ASIDE WHEN A PERSON TAKES THE SCAN OVER (`escaneado`).
        // What they are correcting is the scanned key, which lives in `raw`;
        // repainting from `typed` put the fixed part's digits back around the
        // barcode's head the moment the first key was pressed — a key nobody
        // scanned, and not the one Enter would send.
        if ((estado.rajada || estado.escaneado) && templateAtivo()) {
          ui.atualizarDisplay({
            typed: Chave.chaveParcial(estado.raw),
            templateParteFixa: null
          });
          ui.setProgressoEntrada(0);
        } else {
          ui.atualizarDisplay({ typed: estado.typed, templateParteFixa: templateAtivo() });
          ui.setProgressoEntrada(estado.typed.length);
        }
        // A SUSPECTED RUN RAISES NOTHING NEW AND DROPS NOTHING SHOWN. Raising
        // is what suspicion exists to stop: a scan's first few digits must not
        // flash a verdict before the run is long enough to be believed. But a
        // verdict already on screen is one a verdict cannot come back from —
        // no rule un-fires on later digits — so hiding it only blinked the
        // line away for the idle timer's 250 ms and shifted the layout, every
        // time two digits were rolled quickly after a mistake. Keeping it is
        // re-judging it: the text may change (grey to red, say), never vanish.
        // A run that is then CONFIRMED arrives as `rajada` and silences it.
        const v = vereditoParcial(estado);
        mostrarVeredito(estado.suspeita && !vereditoMostrado ? null : v);
      },
      onEnviar(raw, typed, rajada, escaneado) {
        aceitar(raw, typed, rajada, escaneado);
      }
    });

    function aceitar(raw, typed, rajada, escaneado) {
      ui.limparErro();
      ui.flash();
      // Whoever just entered this did it with their fingers, so they are the
      // person fixed parts are for. Before any verdict: the offer is about how
      // the NEXT note gets entered, and a mistyped one is if anything the
      // better moment to mention typing fewer digits. It repaints from the
      // state rather than being set once, so the preference and the dismissal
      // keep their say over it.
      if (!rajada && !digitouAMao) {
        digitouAMao = true;
        aplicarDica();
      }
      // Fixed part resolution lives in ParteFixa so both entry points agree on
      // it.
      //
      // A BUFFER THAT HELD A SCAN IS NEVER COMPOSED, even once a person has
      // taken it over and `rajada` has gone false. Under a fixed part its
      // `typed` is the barcode's head, so composing it is [fixed part] +
      // [head] — a key nobody holds. With a whole 44-run in `raw` it is the
      // scan it always was; without one it is judged as it stands, and a short
      // one is red.
      const { chave, origem } = ParteFixa.resolver(raw, typed, templateAtivo(), rajada || !!escaneado);
      // 'scan' is the misuse case: a whole key arrived while a fixed part was
      // active.
      const ignorouParteFixa = origem === 'scan';
      // ONE verdict, and debug mode's bypasses are the only thing between it
      // and the three branches below. ajustarVeredito is the identity function
      // while the mode is disarmed; when it is armed, a
      // downgraded verdict comes back carrying `forcado`, which travels to the
      // row so the list never passes a forced note off as an ordinary one.
      const bruto = Chave.avaliar(chave, Relogio.mesCorrente());
      const av = Debug.ajustarVeredito(bruto);

      // THE VOLUNTEER'S OWN BYPASS — a real preference, not a debug flag, and
      // deliberately NOT routed through Debug.ajustarVeredito above. That hook
      // is inert until the hidden debug mode is armed, and "Voltar à segurança"
      // disarms it along with every other flag. A volunteer's preference has to
      // work without either, so it is its own mechanism at the same decision
      // site, and a note can legitimately carry both markers.
      //
      // With it on there is no local refusal at all: the verdict still runs and
      // is still shown, but it stops deciding whether to send and starts
      // deciding which SOUND plays and what the row says. The kind of error
      // becomes the server's business — which is the point, not a side effect.
      // See CLAUDE.md, where red staying red with this off is spelled out.
      const semValidar = cfg.preferencias.enviarSemValidar === true;
      // Truthy only for a note that WOULD have been refused. A key that passes
      // on its own merits carries nothing, whatever the preference says: the
      // flag means "this bypassed a gate", never "the toggle was on".
      const avisoLocal =
        semValidar && (av.gravidade === 'entrada' || av.gravidade === 'inelegivel')
          ? av.mensagem
          : null;
      // THE DE-DUP CHECK RUNS WHATEVER THE PREFERENCE SAYS — the preference
      // only decides whether it REFUSES. With it on the note goes out and the
      // repeat becomes a warning on the row, because this check is the one
      // thing here that is not a verdict on the note's digits: it is the only
      // thing that can tell a volunteer they are holding two copies of the same
      // receipt, and that is worth saying even while the note is being sent. It
      // is also the local refusal that costs the least to drop — the
      // programme's monthly reconciliation discards duplicates, so a repeat is
      // a wasted request rather than a corrupted balance (DOCS.md, known gaps).
      const jaRegistrada =
        registradas.has(chave) && !Debug.on('ignorarDuplicadas');
      // The verdict that refused it last time, when there was one — a note
      // refused as ineligible before the preference was switched on. A rescan
      // then repeats that reason rather than claiming the note was registered,
      // which it never was.
      const motivoAnterior = registradas.get(chave);
      // Marker only, and only when the note is actually going out: under the
      // refusal below the repeat is the row's whole STATUS, and saying it twice
      // on one row is noise. Scan-time only, like `parteFixaIgnorada` and
      // `forcado` — "you already scanned this" is a fact about the moment of
      // the scan, and a restored queue makes no rows at all.
      const duplicadaLocal =
        jaRegistrada && semValidar
          ? motivoAnterior
            ? 'Esta nota já foi lida recentemente. ' + motivoAnterior
            : opcoes.msgDuplicada
          : null;
      const marcas = {
        parteFixaIgnorada: ignorouParteFixa,
        forcado: av.forcado,
        semValidacao: avisoLocal,
        duplicada: duplicadaLocal
      };
      ui.limparDisplay();
      ui.setProgressoEntrada(0);
      mostrarVeredito(null);
      ui.focarEntrada();
      // A note TYPED under the fixed part answers the "you scanned a whole key"
      // condition: the fixed part is being used for what it is for, so the bar
      // has nothing left to say and a deliberate alternator is not nagged.
      if (origem === 'parteFixa') ui.setParteFixaIgnorada(null);

      // Red: the digits are wrong, so nothing real was read. Deliberately NOT
      // remembered — rescanning a mistyped key has to be a real retry.
      //
      // THE ENTRY IS ALREADY CLEARED, three lines up, and the clearing is the
      // point rather than housekeeping. Red means the buffer holds a CORRUPT
      // READING, and handing it back for repair invites the volunteer to
      // correct it — eye along the row, change the digit that looks wrong,
      // resubmit — where a patched key that happens to satisfy the check digit
      // is a donation filed for a note nobody ever read. Retyping from the
      // paper is an INDEPENDENT second reading, and the independence is the
      // whole value. That is also why no span is highlighted and why the
      // sentence promises no shortcut.
      //
      // Skipped entirely under the bypass: the note goes out as a warning note
      // instead. No immediate red then, because the note IS being sent and
      // "read the paper again" would be the wrong thing to say — red becomes
      // the server's to give.
      if (av.gravidade === 'entrada' && !semValidar) {
        Audio.erro();
        // THE ONE EXCEPTION, and it is a second CAUSE rather than a repair. A
        // fixed part that fixes too much composes a key that is not the note in
        // the volunteer's hand; the check digit they typed off the paper then
        // fails, and telling them they mistyped it is a sentence about them for
        // a mistake the software made. Its button drops the fixed part and
        // clears the entry like everything else — it does not offer the digits
        // back.
        //
        // Composed here rather than in REGRAS: chave.js judges keys and knows
        // nothing about fixed parts, and its own wording (which COMPRIMENTO and
        // FORMATO keep deliberately, because the cell display lets the
        // volunteer verify those unaided) survives intact in front of it.
        //
        // ONLY FOR A KEY THE FIXED PART COMPOSED. A scan, or a burst with no
        // key in it, was judged as it arrived with the fixed part set aside
        // (ParteFixa.resolver), so the fixed part cannot be the cause — and
        // telling the volunteer it might be invites them to drop one that is
        // fine for typing.
        if (origem === 'parteFixa') {
          ui.mostrarErro(
            av.mensagem + ' Se os números digitados estiverem corretos, a parte fixa “' + rotuloParteFixa(parteFixa) +
              '” talvez não corresponda a esta nota.',
            {
              rotulo: 'Digitar a chave inteira',
              aoClicar: () => Config.atualizarConfig({ parteFixaAtivaId: null })
            }
          );
        } else {
          ui.mostrarErro(av.mensagem);
        }
        return;
      }
      // The third local refusal, and the only one the bypass keeps as a WARNING
      // instead of dropping outright — see `duplicadaLocal` above. With the
      // preference off this is where a repeat stops; with it on the note falls
      // through to the send path carrying the marker instead.
      //
      // No bypass marker is possible on this row: `avisoLocal` is null whenever
      // the preference is off, and this branch is unreachable when it is on.
      // That is the right outcome rather than a coincidence — the row would
      // read "enviada sem checagem" about a note that was not sent at all, and
      // a row may not state something that did not happen to it.
      if (jaRegistrada && !semValidar) {
        Audio.aviso();
        const dupId = ui.adicionarItem(chave, inst.cnpj, marcas);
        ui.atualizarItem(
          dupId,
          motivoAnterior
            ? { estado: 'inelegivel', mensagem: 'Esta nota já foi lida recentemente. ' + motivoAnterior }
            : { estado: 'duplicado', mensagem: opcoes.msgDuplicada }
        );
        return;
      }
      // Grey: a real note that cannot be donated. It gets a row saying why and
      // stops here — never queued, so aoAceitarChave is not called and no
      // request is ever made for it.
      //
      // There is no ordering to arrange between this and the fixed part: a note
      // can only be judged ineligible once its digits are sound, and the fixed
      // part no longer arbitrates anything — ParteFixa.resolver decides by
      // input kind. The two cannot disagree.
      // Skipped under the bypass for the same reason as the red gate, and this
      // is the half that costs a real donation when it is wrong: a grey verdict
      // is our reading of the programme's rules, and the volunteer who switched
      // this on did so to have the SITE answer that question instead.
      if (av.gravidade === 'inelegivel' && !semValidar) {
        registradas.set(chave, av.mensagem);
        Audio.aviso();
        const id = ui.adicionarItem(chave, inst.cnpj, marcas);
        ui.atualizarItem(id, { estado: 'inelegivel', mensagem: av.mensagem });
        return;
      }

      // THE THREE CUES, decided here and nowhere else. Reached only past the
      // returns above, so exactly one of them ever fires.
      //
      //   aviso   — read you, something is off, sending it regardless. Three
      //             things earn it: a whole key that arrived while a fixed part
      //             was active (fixed parts are for TYPING, so this is a misuse
      //             that happened to be harmless — the note registered is the
      //             one that was read, not a composition, and the volunteer has
      //             to hear about it rather than find out later in the list), a
      //             note the bypass is carrying past a verdict, and a repeat
      //             the bypass is sending anyway. That last one is the reason
      //             the de-dup check still runs under the preference: without
      //             the ping, scanning the same receipt twice sounds exactly
      //             like scanning two different ones.
      //   leitura — read you and it looks right.
      //
      // erro is deliberately absent: it belongs on a refusal coming back from
      // the SERVER. Nothing here has asked the server anything yet.
      if (ignorouParteFixa || avisoLocal || duplicadaLocal) Audio.aviso();
      else Audio.leitura();

      // ...and a whole key arriving under a fixed part also raises a CONDITION,
      // on top of the ping and the row marker. Not a per-note alarm: this note
      // registered correctly, and a large warning on every one of them would
      // fire two hundred times for someone who picked the scanner up mid-batch
      // — a warning that fires on success is one people learn to ignore. What
      // is actually wrong is that the fixed part is still armed and no longer
      // applies, which is a fact about the configuration and belongs on a bar.
      if (ignorouParteFixa) {
        ui.setParteFixaIgnorada({
          mensagem:
            'A chave foi escaneada por inteiro, por isso a parte fixa “' + rotuloParteFixa(parteFixa) +
            '” não foi aplicada — ela vale apenas para chaves digitadas.',
          aoDispensar: () => Config.atualizarConfig({ parteFixaAtivaId: null })
        });
      }

      // Freeze the target NOW — see the banner.
      const cnpj = inst.cnpj;
      registradas.set(chave, null);
      const itemId = ui.adicionarItem(chave, cnpj, marcas);
      // The bypass is FROZEN WITH THE NOTE, exactly like the target CNPJ and
      // for the same reason: a note the volunteer deliberately submitted under
      // it, drained after the toggle went off, would otherwise be destroyed at
      // the drain-time re-judge by a setting changed days later. Storing the
      // local reading rather than a bare boolean also lets the restored row say
      // what we thought was wrong, without judging it a second time.
      const gravacao = Config.adicionarNaFila(chave, cnpj, avisoLocal);
      opcoes.aoAceitarChave({ chave, cnpj, itemId, gravacao, semValidacao: avisoLocal });
    }

    // ---- React to settings changes (in-modal or from the popup) ---------------
    //
    // A HALF-TYPED ENTRY SURVIVES EVERY WRITE THAT DOES NOT CHANGE WHAT IT
    // MEANS. It used to be emptied on every config event, and some of those
    // arrive with nobody asking: the registry's official name for an entity
    // saved unverified lands a moment after load (content.js → entidade.js),
    // and the popup writes the same way. The volunteer starts typing, the
    // registry answers, and the digits vanish. Only two things make a partial
    // entry stale — the target (the entry is judged and frozen against the
    // active entity) and the fixed part (the typed digits fill ITS gaps) — so
    // those two, and nothing else, reset it. A preference such as autoEnviar
    // or enviarSemValidar decides what happens at submit, not what the digits
    // already typed are.
    Config.aoMudar(async (tipo) => {
      if (tipo !== 'config') return;
      cfg = await Config.obterConfig();
      inst = Config.entidadeAtiva(cfg);
      parteFixa = partesFixasLigadas() ? Config.parteFixaAtiva(cfg) : null;
      const assinatura = assinaturaDaEntrada();
      const entradaVelha = assinatura !== assinaturaAplicada;
      assinaturaAplicada = assinatura;
      if (entradaVelha) captura.reset();
      aplicarConfig(entradaVelha);
    });

    // ---- NOTHING OPENS ITSELF ------------------------------------------------
    // This used to be `if (!temCnpj()) ui.abrir('config')` — first run threw the
    // settings modal at the volunteer before they had looked at the page. On the
    // live page that lands them in a three-card form at the exact moment the
    // page may also be reporting a session problem, and the loudest thing on
    // screen is then a form rather than the thing that has to be fixed first.
    //
    // The blocking card over the entry already says what is missing and offers
    // one button to go and fix it. That is the same journey with the volunteer
    // steering, which is the whole difference.

    return {
      /** The entity active right now, or null. Never the frozen scan-time one. */
      entidadeAtual: () => inst,
      /**
       * Block a key without going through capture (restoring the queue).
       * `motivo` is the verdict that refused it, when the caller found one
       * itself — a rescan then repeats that reason instead of claiming the
       * note was registered. Restoring the queue passes no motivo.
       */
      bloquearChave: (chave, motivo) => registradas.set(chave, motivo || null),
      /** Unblock a key, so scanning it again is a real retry. */
      esquecerChave: (chave) => registradas.delete(chave)
    };
  }

  NFPR.Registrador = { iniciar };
})(typeof globalThis !== 'undefined' ? globalThis : self);
