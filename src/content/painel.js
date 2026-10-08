/**
 * painel.js  (content + offline page)
 * -----------------------------------------------------------------------------
 * The REGISTRAR: the everyday surface, mounted on the page itself rather than
 * behind a button, so scanning or typing needs nothing opened first.
 *
 * It owns the live 44-cell key display, the entry box and its CDV hint, the
 * queue indicator, the results list with its nine states, the connection bar,
 * the session bar, the two fixed part bars, the entity chip and the inline
 * error toast — and it composes NFPR.StripParteFixa, the strip under the cells
 * that says what the next note will be read as.
 *
 * THREE SURFACES, THREE JOBS, and keeping them apart is the whole design:
 *
 *   the QUEUE INDICATOR says how much work is left. Pending notes are a
 *   QUANTITY — a depleting bar, never rows.
 *
 *   the ITEM LIST says what HAPPENED to them. Bounded scrollback, newest first,
 *   holding notes that just came off the scanner and notes that have settled.
 *
 *   the FAILURES BAR says which notes the server REJECTED without an answer we
 *   could read. Those are gone from nfpr:fila, so it is their only record; it
 *   is fed from `nfpr:falhas` (durable, capped) and this file only draws it.
 *
 * The first two were once the same thing: every queued note got a row, and rows
 * were then rationed by priority. The two rules fight — a fresh scan could not
 * outrank the notes already sending, so scanning right after a reload showed
 * NOTHING, while the same scan worked once a few greens existed to evict.
 * Pending work is not a list. Do not give it rows again — and do not solve the
 * third surface by giving failures a reserved slice of the row budget, which is
 * that same priority table wearing a different hat.
 *
 * ROWS AND RECORDS ARE BOTH CAPPED HERE, and that is only safe because nothing
 * durable depends on them: a rejected note is written to `nfpr:falhas` by the
 * orchestrator BEFORE this file is told anything. It was not always so — a row
 * evicted while its note was still in flight took the record with it,
 * atualizarItem no-oped, and the terminal answer was recorded nowhere at all.
 * If an outcome ever needs to survive again, put it in storage, not in a longer
 * -lived variable in here.
 *
 * NFPR.Painel.criar(opcoes) -> { elemento, cabecalho, api }
 *   elemento              the panel root; the caller puts it in a shadow root
 *   cabecalho             the header strip — a child of `elemento` by default,
 *                         and handed out separately so ui.js can mount it into
 *                         the government page's own header instead (see
 *                         opcoes.cabecalhoSeparado). Always returned, so the
 *                         caller need not remember which it asked for.
 *   opcoes.cabecalhoSeparado  build the header for the merged bar rather than
 *                         for the panel: no brand mark (the site's logo is
 *                         already beside it), no spacer, and the CALLER mounts
 *                         it. The panel then starts at its body.
 *   opcoes.modoOffline    the bundled offline registrar: no link back to the
 *                         site, which is unreachable there by definition
 *   opcoes.conexaoPermanente / opcoes.acaoConexao   see the connection bar below
 *   opcoes.aoPedirConfig  called (with an optional page name) when the
 *                         volunteer asks for settings; ui.js wires it to the
 *                         modal, which this file knows nothing about
 *
 * This file RENDERS. It makes no request and reads no storage.
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  var NFPR = (root.NFPR = root.NFPR || {});
  var Cnpj = NFPR.Cnpj;
  var el = NFPR.el; // shared DOM builder (src/shared/dom.js)

  // Trusted static markup, like the brand mark above. It lives here rather than
  // in dom.js because exactly one surface draws it: the entity chip, which is
  // the only door into settings now that the labelled button is gone.
  // Same contract as the gear: trusted static markup, drawn by one surface.
  var ICONE_CASA =
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M9.5 20v-6h5v6"/></svg>';
  var ICONE_ENGRENAGEM =
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="3"/>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 ' +
    '1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 ' +
    '19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 ' +
    '.33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 ' +
    '0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 ' +
    '0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 ' +
    '2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 ' +
    '1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  var agruparChave = NFPR.agruparChave; // 44 digits, spaced in fours (dom.js)

  var MARGEM_INFERIOR = 15; // matches .nfpr-registrar-page's margin-bottom
  var ALTURA_MINIMA = 320; // never collapse the panel on a very short window

  // HOW FAR BACK THE ITEM LIST REMEMBERS. It is a scrollback of outcomes, not a
  // view of the queue, so this bounds how much history the volunteer can look
  // back over — never how much work is pending. Single place its size lives;
  // edit it here to test other values. Module scope rather than inside criar()
  // so tools/smoke.js can assert against whatever it currently is instead of
  // hardcoding a number that goes stale the moment it is tuned.
  var LIMITE_LINHAS = 20;

  function criar(opcoes) {
    opcoes = opcoes || {};
    var abrirConfig = opcoes.aoPedirConfig || function () {};

    // NO DUPLICATE-SESSION BANNER. There was one, and every state of it has
    // been folded into the session condition bar below, which content.js drives
    // through setSessao. The banner narrated the same /sair the condition bar
    // narrated, so the two ran side by side saying overlapping things and then
    // disagreeing about what to do next — the banner ended on "Atualize a
    // página" while the bar said "Entrar novamente", and the bar was right,
    // since /sair closes our session too. What survived it is one line in
    // content.js: paint the condition bar at load, when the screen is there and
    // no note has failed yet to reveal it. One event, one narrator.
    //
    // That is also why this file no longer takes `opcoes.sessao` at all. It
    // renders; who is having a session problem is not its business.

    // ---- State ----------------------------------------------------------------
    // `itens` holds ROWS, newest first, capped at LIMITE_LINHAS. It is not a
    // record of the queue — the queue is a quantity, drawn by setFila above —
    // and it is not the record of a NOTE either: that is `porId`, which outlives
    // the row (see the item list below).
    var itens = []; // display order, 0 = top; the record objects `porId` holds
    var seqId = 0;
    var entidadeAtual = null;
    var parteFixaAtual = null; // { template } of the active fixed part, for display defaults
    var autoEnviarAtual = false;

    // ==========================================================================
    // REGISTRAR ELEMENTS (mounted on the page)
    // ==========================================================================
    // ELEVEN GROUPS OF FOUR, FLOWING LIKE TEXT. The chave is printed in eleven
    // groups of four and the groups are what the eye keeps its place by, so the
    // groups are real elements; the LINES are not. They wrap the way words in a
    // paragraph wrap — left-aligned, as many per line as fit — so the display
    // costs one line of height wherever there is room for one (every viewport
    // from ~1000px up) and only breaks where the room runs out.
    //
    // It used to build three fixed rows of 4/4/3 at every width, which spent
    // ~100px of vertical space on a panel that is sized to the viewport and
    // never scrolls, even on a monitor with room for all 44 side by side. The
    // objection then was that free wrapping centred a short last line so no
    // column lined up with the one above; the answer is that columns lining up
    // was never the point — the grid in registrar.css makes a wrapped line
    // start where the one above started, which is what a block of text does,
    // the cell SIZE ladder there is what keeps one line possible as the panel
    // narrows, and once it cannot, the lines split the eleven groups evenly.
    var cells = [];
    var grupos = [];
    var cellsWrap = el('div', { class: 'nfpr-cells' });
    for (var g = 0; g < 11; g += 1) {
      var grupo = el('div', { class: 'nfpr-cell-group' });
      for (var c2 = 0; c2 < 4; c2 += 1) {
        var cel = el('span', { class: 'nfpr-cell nfpr-cell-vazio', text: '' });
        cells.push(cel);
        grupo.appendChild(cel);
      }
      grupos.push(grupo);
      cellsWrap.appendChild(grupo);
    }
    // NO inputmode: 'numeric' — a key may carry uppercase letters in the
    // issuer's CNPJ, and a numeric touch keyboard cannot type one.
    var proxy = el('input', {
      class: 'nfpr-proxy',
      readOnly: true
    });

    var entradaArea = el(
      'div',
      {
        class: 'nfpr-entry',
        onClick: function () {
          proxy.focus();
        }
      },
      [cellsWrap, proxy]
    );

    var bloqueio = el('div', { class: 'nfpr-bloqueio', attrs: { hidden: 'hidden' } });

    // THE ENTRY, OR THE FIXED PART EDITOR IF IT IS OPEN. The settings overlay
    // closes by calling this (api.focarEntrada), and the editor survives the
    // overlay opening over it; focusing the entry box then left the editor's
    // field open and claiming the keyboard for itself, with the keyboard
    // somewhere else, so nothing typed went anywhere.
    function focarEntrada() {
      if (strip.api.retomarFoco()) return;
      proxy.focus();
    }

    // Whether the keyboard is on `no` or anything inside it. Asked through the
    // node's own root, because from outside a closed shadow root the document
    // only ever reports the host.
    function focoEm(no) {
      var raiz = no.getRootNode ? no.getRootNode() : null;
      var ativo = raiz && raiz.activeElement;
      return !!ativo && typeof no.contains === 'function' && no.contains(ativo);
    }

    // A CONTROL THAT HIDES ITSELF HANDS THE KEYBOARD ON. Nearly every button on
    // a bar is answered by the bar going away — "Digitar a chave inteira" drops
    // the fixed part that raised the bar, "Voltar à segurança" disarms the mode
    // it reports — so the volunteer who pressed it from the keyboard was left
    // on an element that no longer exists, and the next Tab started at the top
    // of the government page. Every bar hides through here, and the keyboard
    // goes where the work continues: the entry. Only if it was IN the bar — a
    // bar hiding while the keyboard is in the settings overlay, or anywhere
    // else, takes nothing from anyone.
    function esconder(no) {
      var tinhaFoco = focoEm(no);
      no.setAttribute('hidden', 'hidden');
      if (tinhaFoco) focarEntrada();
    }

    // The takeover overlay — see setTakeover below. Built once, hidden, and laid
    // over the whole body when the panel has one thing to say and nothing to
    // ask.
    var takeoverMsg = el('p', { class: 'nfpr-takeover-msg' });
    var takeoverDetalhe = el('p', { class: 'nfpr-takeover-detalhe' });
    var takeover = el(
      'div',
      { class: 'nfpr-takeover', attrs: { hidden: 'hidden' } },
      [el('div', { class: 'nfpr-takeover-card' }, [
        el('span', { class: 'nfpr-takeover-giro' }),
        takeoverMsg,
        takeoverDetalhe
      ])]
    );

    // ---- Connection status bar ------------------------------------------------
    // One bar, two behaviours, because the two pages mean different things by it:
    //
    //   live page (default) — hidden while everything works, amber during an
    //   outage, green for six seconds once the queue starts resending.
    //
    //   offline page (opcoes.conexaoPermanente) — always visible, because the
    //   connection IS the subject of that page: it starts neutral while the
    //   first probe runs and carries the only route back to the site
    //   (opcoes.acaoConexao). It never auto-hides.
    //
    // The offline page used to have its own strip in entrada.html/.css with a
    // second DOM structure, a second CSS block and four more message strings
    // for the same three states.
    var MSG_CONEXAO = {
      verificando: 'Verificando a conexão…',
      rede: 'Sem conexão com a internet. Você pode continuar escaneando: as notas ficam guardadas e serão enviadas automaticamente quando a conexão voltar.',
      servidor: 'O site do Nota Paraná não está respondendo. Você pode continuar escaneando: as notas ficam guardadas e serão enviadas automaticamente quando o site voltar.',
      online: 'Conexão restabelecida. Enviando as notas guardadas…'
    };
    var CLASSE_CONEXAO = {
      verificando: 'nfpr-conexao-bar-neutra',
      rede: 'nfpr-conexao-bar-off',
      servidor: 'nfpr-conexao-bar-off',
      online: 'nfpr-conexao-bar-ok'
    };

    var conexaoMsg = el('span', { class: 'nfpr-conexao-msg' });
    var conexaoAcao = opcoes.acaoConexao
      ? el('button', {
          class: 'nfpr-conexao-acao',
          type: 'button',
          text: opcoes.acaoConexao.rotulo,
          attrs: { hidden: 'hidden' },
          onClick: function () {
            opcoes.acaoConexao.aoClicar(conexaoAcao);
          }
        })
      : null;
    var conexaoBar = el(
      'div',
      { class: 'nfpr-conexao-bar', attrs: { hidden: 'hidden' } },
      [conexaoMsg, conexaoAcao]
    );
    var conexaoTimer = null;

    /** setConexao(estado, mensagem?) — mensagem overrides the default wording. */
    function setConexao(estado, mensagem) {
      clearTimeout(conexaoTimer);
      conexaoBar.classList.remove(
        'nfpr-conexao-bar-off',
        'nfpr-conexao-bar-ok',
        'nfpr-conexao-bar-neutra'
      );
      if (conexaoAcao) {
        // The way back is offered ONLY once a probe has actually reached the
        // site — never on navigator.onLine alone (see NFPR.Connectivity).
        if (estado === 'online') conexaoAcao.removeAttribute('hidden');
        else esconder(conexaoAcao);
      }

      if (!CLASSE_CONEXAO[estado]) {
        if (!opcoes.conexaoPermanente) esconder(conexaoBar);
        return;
      }
      conexaoBar.classList.add(CLASSE_CONEXAO[estado]);
      conexaoMsg.textContent = mensagem || MSG_CONEXAO[estado];
      conexaoBar.removeAttribute('hidden');
      if (estado === 'online' && !opcoes.conexaoPermanente) {
        conexaoTimer = setTimeout(function () {
          esconder(conexaoBar);
        }, 6000);
      }
    }
    // ---- Stale-fixed-part bar -----------------------------------------------
    // Shown while the ACTIVE fixed part describes notes that can no longer be
    // donated. Most fixed parts fix the issuer prefix, which spans digits 0–21
    // and therefore includes AAMM, so this is routine rather than an edge case
    // — a fixed part with a variable AAMM is the escape hatch and never
    // expires.
    //
    // IT MUST NEVER BLOCK INPUT. A full 44-digit scan beats the fixed part
    // (see parte-fixa.js), so the scanner keeps working perfectly with a stale
    // fixed part active; only TYPED entry under it is dead. Blocking the way
    // the unconfigured -CNPJ case does would break scanning for no reason, so
    // this is a bar, not a bloqueio, and it says so.
    // The way out, so the volunteer is back to full-key entry without a trip to
    // settings. The handler arrives WITH the state, not as a mount option: this
    // file reads no storage, and the module that knows how to deactivate a
    // fixed part (registrador.js, shared by both pages) only ever sees an
    // already-mounted UI. Threading it through ui.js would have meant each page
    // writing the deactivation itself.
    var dispensarParteFixa = function () {};
    var editarParteFixa = function () {};
    // EDITING IS THE PRIMARY ANSWER now that a fixed part is a piece of text: a
    // fixed part whose month has passed usually needs two digits changed, and
    // until this existed the only thing on offer was throwing it away. "Digitar
    // a chave inteira" stays beside it — the volunteer who has moved on to a
    // different batch wants exactly that, and it is one click.
    var parteFixaVencidaEditar = el('button', {
      class: 'nfpr-parte-fixa-vencida-acao nfpr-parte-fixa-vencida-acao-primaria',
      type: 'button',
      text: 'Editar a parte fixa',
      onClick: function () {
        editarParteFixa();
      }
    });
    var parteFixaVencidaAcao = el('button', {
      class: 'nfpr-parte-fixa-vencida-acao',
      type: 'button',
      text: 'Digitar a chave inteira',
      onClick: function () {
        dispensarParteFixa();
      }
    });
    var parteFixaVencidaMsg = el('span', {
      class: 'nfpr-parte-fixa-vencida-msg',
      text:
        'Esta parte fixa é de notas que já passaram do prazo, portanto nenhuma chave digitada com ela pode ser doada. ' +
        'A leitura por código de barras não é afetada.'
    });
    var parteFixaVencidaBar = el(
      'div',
      { class: 'nfpr-parte-fixa-vencida-bar', attrs: { hidden: 'hidden' } },
      [parteFixaVencidaMsg, parteFixaVencidaEditar, parteFixaVencidaAcao]
    );

    /**
     * setParteFixaVencida(info | null)
     *   info = { mensagem?, aoDispensar?, aoEditar? }
     *
     * A condition, not a notification: there is no dismiss control, and it
     * disappears the moment the fixed part is removed or deactivated. Nothing
     * has to persist a dismissal, and it cannot get stuck dismissed while the
     * condition holds.
     */
    function setParteFixaVencida(info) {
      var dados = info || null;
      if (dados) {
        if (typeof dados.aoDispensar === 'function') dispensarParteFixa = dados.aoDispensar;
        if (typeof dados.aoEditar === 'function') editarParteFixa = dados.aoEditar;
        if (dados.mensagem) parteFixaVencidaMsg.textContent = dados.mensagem;
        parteFixaVencidaBar.removeAttribute('hidden');
      } else {
        esconder(parteFixaVencidaBar);
      }
    }

    // ---- The fixed part was armed and a whole key was scanned ---------------
    // A CONDITION, NOT A PER-NOTE ALARM, and that is the whole design. The note
    // that registered is the one that was actually scanned — correctly — so
    // there is nothing wrong with it, and a large warning per note would fire
    // two hundred times for a volunteer who picked the scanner up mid-batch. A
    // warning that fires on success is one people learn to ignore.
    //
    // What IS wrong is that the fixed part is still armed and no longer
    // applies. The two existing per-note signals are unchanged: the `aviso`
    // ping and the row marker "⚠ parte fixa não usada — chave lida inteira".
    var dispensarIgnorada = function () {};
    var parteFixaIgnoradaMsg = el('span', { class: 'nfpr-parte-fixa-ignorada-msg' });
    var parteFixaIgnoradaBar = el(
      'div',
      { class: 'nfpr-parte-fixa-ignorada-bar', attrs: { hidden: 'hidden' } },
      [
        parteFixaIgnoradaMsg,
        el('button', {
          class: 'nfpr-parte-fixa-ignorada-acao',
          type: 'button',
          text: 'Digitar a chave inteira',
          onClick: function () {
            dispensarIgnorada();
          }
        })
      ]
    );

    /**
     * setParteFixaIgnorada(info | null)
     *   info = { mensagem, aoDispensar }
     *
     * Cleared when the fixed part is dropped OR when a note is typed under it,
     * so it cannot get stuck on and a deliberate alternator is not nagged after
     * the first note. Both of those are the caller's to decide, which is why
     * this takes the state rather than watching for it.
     */
    function setParteFixaIgnorada(info) {
      if (!info) {
        esconder(parteFixaIgnoradaBar);
        return;
      }
      parteFixaIgnoradaMsg.textContent = info.mensagem || '';
      dispensarIgnorada = info.aoDispensar || function () {};
      parteFixaIgnoradaBar.removeAttribute('hidden');
    }

    // ---- Session bar ----------------------------------------------------------
    // A DEAD SESSION IS A CONDITION, NOT A VERDICT ON ANY NOTE. Same contract as
    // the stale-fixed-part bar above: no dismiss control, repainted from the
    // state, so it cannot get stuck showing or stuck hidden while the session
    // is dead.
    //
    // This exists because the alternative was writing "sua sessão expirou" in
    // red on every note in the queue — a thousand of them, each claiming the
    // note failed, when nothing is wrong with any of them and all of them are
    // safely queued. The note says "guardada"; the bar says what to do.
    var acaoSessao = function () {};
    var sessaoTexto = el('span', { class: 'nfpr-sessao-cond-msg' });
    var sessaoBotao = el('button', {
      class: 'nfpr-sessao-cond-acao',
      type: 'button',
      onClick: function () {
        acaoSessao();
      }
    });
    var sessaoLink = el('a', { class: 'nfpr-sessao-cond-link', attrs: { hidden: 'hidden' } });
    var sessaoCondBar = el(
      'div',
      { class: 'nfpr-sessao-cond-bar', attrs: { hidden: 'hidden' } },
      [sessaoTexto, sessaoBotao, sessaoLink]
    );

    /**
     * setSessao(info | null)
     *   info = { mensagem, rotulo?, aoClicar?, href?, pendente? }
     *
     * `aoClicar` renders a button (ending the other sessions is a background
     * request, and navigating away would throw away its answer); `href` renders
     * a real anchor (logging in is a page). Never both.
     *
     * `pendente` shows the label with NEITHER — the action this bar is about to
     * offer, drawn in its final position and inert. It exists because this one
     * bar changes message under the volunteer: "Encerrando as sessões abertas…"
     * becomes "Sua sessão expirou. / Entrar novamente", and a button that
     * appears only at the end makes the bar grow at the exact moment there is
     * something to read. Inert rather than merely muted: following that link
     * while /sair is in flight navigates away and kills the request.
     */
    function setSessao(info) {
      if (!info) {
        esconder(sessaoCondBar);
        return;
      }
      sessaoTexto.textContent = info.mensagem || '';
      if (info.pendente) {
        // "Encerrar as outras sessões" goes pending under its own click.
        esconder(sessaoBotao);
        sessaoLink.textContent = info.rotulo || 'Entrar novamente';
        sessaoLink.removeAttribute('href'); // an anchor without one is not a link
        sessaoLink.className = 'nfpr-sessao-cond-link nfpr-acao-inerte';
        sessaoLink.removeAttribute('hidden');
        sessaoCondBar.removeAttribute('hidden');
        return;
      }
      sessaoLink.className = 'nfpr-sessao-cond-link';
      if (info.aoClicar) {
        acaoSessao = info.aoClicar;
        sessaoBotao.textContent = info.rotulo || 'Resolver';
        sessaoBotao.removeAttribute('hidden');
      } else {
        esconder(sessaoBotao);
      }
      if (info.href) {
        sessaoLink.textContent = info.rotulo || 'Entrar novamente';
        sessaoLink.setAttribute('href', info.href);
        sessaoLink.removeAttribute('hidden');
      } else {
        esconder(sessaoLink);
      }
      sessaoCondBar.removeAttribute('hidden');
    }

    // ---- Refused-entity bar ---------------------------------------------------
    // A CNPJ the server will not accept donations for is a fact about the
    // CONFIGURATION, not about any note — so it gets the same treatment as a
    // dead session: one bar, no dismiss control, repainted from the state.
    //
    // It exists because the alternative was what the build used to do: report
    // the refusal red on every note aimed at that entity and delete each one
    // from the durable queue as it arrived. A whole offline batch could be
    // erased in seconds while the screen showed hundreds of identical red rows,
    // none of which named the actual problem or offered the actual fix.
    var acaoEntidade = function () {};
    var entidadeTexto = el('span', { class: 'nfpr-entidade-cond-msg' });
    var entidadeBotao = el('button', {
      class: 'nfpr-entidade-cond-acao',
      type: 'button',
      onClick: function () {
        acaoEntidade();
      }
    });
    var entidadeCondBar = el(
      'div',
      { class: 'nfpr-entidade-cond-bar', attrs: { hidden: 'hidden' } },
      [entidadeTexto, entidadeBotao]
    );

    /**
     * setEntidadeRecusada(info | null)
     *   info = { mensagem, rotulo, aoClicar }
     *
     * Always a button, never a link: both of its states do something in this
     * page (open settings, or move the stranded notes). Navigating away would
     * abandon a queue that is the only record those notes have.
     */
    function setEntidadeRecusada(info) {
      if (!info) {
        esconder(entidadeCondBar);
        return;
      }
      entidadeTexto.textContent = info.mensagem || '';
      acaoEntidade = info.aoClicar || function () {};
      entidadeBotao.textContent = info.rotulo || 'Resolver';
      entidadeCondBar.removeAttribute('hidden');
    }

    // ---- Confused-server bar --------------------------------------------------
    // The server answered in a way that diagnoses nothing, and a probe
    // confirmed it cannot judge donations right now. A condition, like the
    // three above: no dismiss control, repainted from the state.
    //
    // THE ONLY BAR WITH NO ACTION ON IT, and that is the honest shape rather
    // than an omission. The other three name something a human can do — log in,
    // close the other sessions, point the notes at an entity that can receive.
    // This one does not: nothing on this machine can fix someone else's server,
    // and the extension is already doing the only useful thing by holding on to
    // the notes and asking again on a backoff. A button here could only lie
    // about who is in control, which is the defect the duplicate-session screen
    // is already filed under.
    var servidorTexto = el('span', { class: 'nfpr-servidor-cond-msg' });
    var servidorCondBar = el(
      'div',
      { class: 'nfpr-servidor-cond-bar', attrs: { hidden: 'hidden' } },
      [servidorTexto]
    );

    /**
     * setServidorConfuso(info | null)
     *   info = { mensagem }
     */
    function setServidorConfuso(info) {
      if (!info) {
        esconder(servidorCondBar);
        return;
      }
      servidorTexto.textContent = info.mensagem || '';
      servidorCondBar.removeAttribute('hidden');
    }

    // ---- Notes the server rejected and we could not explain ------------------
    // THE CASE THIS EXISTS FOR: every client-side check passed, the probe proved
    // the server healthy, and the POST was still rejected five times running
    // with an answer nothing here can read. The note is then dropped from
    // nfpr:fila and its key unblocked — correct, since a healthy server that
    // keeps rejecting a note means the note can never be filed — and what has
    // just been thrown away looks perfectly good from here. Nobody will mention
    // it again, and its row is one long batch away from scrolling off the end.
    //
    // RENDER ONLY. The list itself is `nfpr:falhas`, owned by config.js and fed
    // in by the orchestrator, exactly like every other bar above. It has to be
    // durable rather than a variable in this file: these notes are GONE from
    // the queue, so this is their only record, and an ordinary mid-batch
    // navigation would have destroyed it — the session bar's own "Entrar
    // novamente" is a link that navigates this very tab.
    //
    // It says nothing about the printed receipts. This extension reports what
    // was registered and what was not; the paper is the charity's business.
    var falhasAtuais = [];
    var falhasTexto = el('span', { class: 'nfpr-falhas-msg' });
    var falhasBar = el(
      'div',
      { class: 'nfpr-falhas-bar', attrs: { hidden: 'hidden' } },
      [
        falhasTexto,
        // A button, not a link: the destination is a page in our own overlay,
        // and the same call the Configurações button makes.
        el('button', {
          class: 'nfpr-falhas-acao',
          type: 'button',
          text: 'Ver detalhes',
          onClick: function () {
            abrirConfig('falhas');
          }
        })
      ]
    );

    /**
     * setFalhas(lista)
     *   lista = [{ chave, mensagem, em }], oldest first
     *
     * Says "não foram registradas" flatly. Exactly one answer files a donation
     * — 200 OK with a `mensagem` containing "sucesso" — and anything else is the
     * server actively rejecting it, so every note here demonstrably was not
     * filed. Hedging would let the volunteer conclude it probably went through.
     */
    function setFalhas(lista) {
      falhasAtuais = Array.isArray(lista) ? lista : [];
      if (!falhasAtuais.length) {
        esconder(falhasBar);
        return;
      }
      falhasTexto.textContent =
        falhasAtuais.length === 1
          ? '1 nota não foi registrada.'
          : falhasAtuais.length + ' notas não foram registradas.';
      falhasBar.removeAttribute('hidden');
    }

    // --- Debug mode (src/shared/debug.js) --------------------------------------
    // The loudest bar in the panel, because it is the only one that means the
    // notes in the list below may be fabricated. Modelled on the
    // stale-fixed-part bar above and for the same reason: A CONDITION, NOT A
    // NOTIFICATION. No dismiss control, repainted from the state on every
    // change, and its one button simply disarms the mode — so it cannot get
    // stuck showing, and it cannot get stuck hidden while debug is on.
    //
    // The flag list is rendered as TEXT (it is short and it names the exact
    // bypasses that are live), which is the whole reason a volunteer or a
    // developer glancing at a machine can tell what state it is in.
    var desarmarDebug = function () {};
    var debugFlags = el('span', { class: 'nfpr-debug-flags nfpr-mono' });
    var debugBar = el(
      'div',
      { class: 'nfpr-debug-bar', attrs: { hidden: 'hidden' } },
      [
        el('span', { class: 'nfpr-debug-msg' }, [
          // "Cuidado!" is the way into the flags form. A BUTTON, not an anchor:
          // the destination is a view in our own overlay, and a real href would
          // navigate away from the page holding the notes. Same call the
          // Configurações button makes, with a page name.
          el('button', {
            class: 'nfpr-debug-config',
            type: 'button',
            text: 'Cuidado!',
            attrs: { title: 'Abrir as opções de depuração' },
            onClick: function () {
              abrirConfig('depuracao');
            }
          }),
          el('strong', { text: ' Modo de depuração ligado.' }),
          document.createTextNode(' As notas registradas podem ser inválidas.'),
          debugFlags
        ]),
        el('button', {
          class: 'nfpr-debug-acao',
          type: 'button',
          text: 'Voltar à segurança',
          onClick: function () {
            desarmarDebug();
          }
        })
      ]
    );

    /**
     * setDebug(ativo, resumo[], aoDesarmar?)
     *
     * `resumo` is NFPR.Debug.resumo() — one short string per armed flag. The
     * handler arrives with the state for the same reason the stale-fixed-part
     * one does: this file reads no storage, and the module that knows how to
     * disarm (registrador.js, shared by both pages) only ever sees a mounted
     * UI.
     */
    function setDebug(ativo, resumo, aoDesarmar) {
      if (typeof aoDesarmar === 'function') desarmarDebug = aoDesarmar;
      debugFlags.textContent = (resumo && resumo.length) ? resumo.join(' · ') : '';
      if (ativo) debugBar.removeAttribute('hidden');
      else esconder(debugBar);
    }

    var toastErro = el('div', { class: 'nfpr-toast-erro', attrs: { hidden: 'hidden' } });
    var toastTimer = null;

    // ---- The strip, and its one status line -----------------------------------
    // What the next note will be read as, plus the control that changes it. It
    // replaces two elements that were each wrong in their own way:
    //
    //   `dica` — one line of instruction, hidden by adicionarItem on the first
    //   row and NEVER restored except onto an empty list, so the only sentence
    //   explaining how to work vanished permanently after note one, on machines
    //   volunteers move between. Its sentence lives in the empty results list
    //   now, which gives it the right lifetime for free.
    //
    //   `parteFixaInfo` — a pill that only ever REPORTED the fixed part. Saying
    //   what is active and being the way to change it is one job, not two.
    var strip = NFPR.StripParteFixa.criar();

    // ---- The queue indicator --------------------------------------------------
    // PENDING WORK IS A QUANTITY, NOT A LIST. Giving every queued note a row and
    // then rationing rows is what made the list incoherent: a fresh scan could
    // not outrank the notes already sending, so scanning right after a reload
    // showed nothing at all. So the queue is shown as what it is — an amount —
    // and the list below is left to say what HAPPENED.
    var filaBarraFill = el('div', { class: 'nfpr-fila-barra-fill' });
    var filaBarra = el('div', { class: 'nfpr-fila-barra' }, [filaBarraFill]);
    var filaTexto = el('span', { class: 'nfpr-fila-texto' });
    var filaIndicador = el(
      'div',
      { class: 'nfpr-fila', attrs: { hidden: 'hidden' } },
      [filaTexto, filaBarra]
    );

    // Where the bar measures progress from. Not a total handed in by the
    // caller: ANY INCREASE RESTARTS THE BAR. A bar is a promise about a batch of
    // work, and notes scanned mid-drain are new work, not lost ground — without
    // the restart the fill lurches backwards every time someone scans, which
    // reads as the extension undoing itself.
    var filaBase = 0;
    var filaAnterior = 0;

    /**
     * setFila({ restantes })
     *
     * `restantes` is what is still WAITING — notes in flight are excluded by the
     * caller, because they already have rows of their own saying "Enviando…"
     * and counting them here shows the same work twice. Notes parked behind an
     * outage do count: nothing else on screen speaks for them.
     *
     * It used to report how many were in flight as well. That number is pinned
     * at LARGURA_ENVIO for the whole of any queue worth showing a bar for, so it
     * read "enviando 6" forever and told nobody anything.
     */
    function setFila(estado) {
      var restantes = (estado && estado.restantes) || 0;
      if (restantes <= 0) {
        filaIndicador.setAttribute('hidden', 'hidden');
        filaBase = 0;
        filaAnterior = 0;
        filaBarraFill.style.width = '0%';
        return;
      }
      filaIndicador.removeAttribute('hidden');
      filaTexto.textContent =
        restantes === 1 ? '1 nota na fila' : restantes + ' notas na fila';
      if (restantes > filaAnterior) {
        filaBase = restantes; // new work: start the bar over rather than rewind it
        filaBarraFill.style.width = '0%';
      } else {
        filaBarraFill.style.width =
          Math.round(((filaBase - restantes) / filaBase) * 100) + '%';
      }
      filaAnterior = restantes;
    }

    var listaResultados = el('div', { class: 'nfpr-results' });
    // THE INSTRUCTION LIVES HERE, and this is the right lifetime for it: it is
    // on screen exactly while there is nothing else to read, and it goes when
    // the list has something to say instead. `dica` sat above the entry, was
    // retired for good by the first row, and never came back — so on a machine
    // volunteers move between, the one sentence explaining how to work was
    // gone after note one.
    //
    // The existing rule survives: while the entry is BLOCKED the instruction
    // half is dropped, because "escaneie a nota" cannot happen while there is
    // nowhere to send one, and an instruction that does not work is worse than
    // none on the one screen a first-time volunteer is reading.
    var entradaBloqueada = false;
    var resultadosVazioInstrucao = el('span', {
      class: 'nfpr-results-empty-instrucao',
      text: 'Escaneie a nota ou digite a chave de acesso e pressione Enter.'
    });
    var resultadosVazio = el('p', { class: 'nfpr-results-empty' }, [
      resultadosVazioInstrucao,
      el('span', { text: 'O resultado de cada nota aparece aqui, as mais recentes no topo.' })
    ]);
    listaResultados.appendChild(resultadosVazio);

    function pintarVazio() {
      if (entradaBloqueada) resultadosVazioInstrucao.setAttribute('hidden', 'hidden');
      else resultadosVazioInstrucao.removeAttribute('hidden');
    }

    // ---- Registrar header ----------------------------------------------------
    // THE ENTITY CHIP IS THE WAY INTO SETTINGS. There used to be a separate
    // "Configurações" button beside it, and on the live page that button now
    // shares one bar with the SITE's own "Configurações" — two identical labels
    // a few centimetres apart, opening completely different things (ours:
    // entities, fixed parts, preferences; theirs: password, e-mail, cadastro).
    // One of them had to stop saying the word, and it is not the site's:
    // relabelling someone else's control is a bigger liberty than not labelling
    // ours.
    //
    // So the chip became the button, and the gear is attached to the thing it
    // configures. It carries no "Doando para" caption: the phrase said what the
    // CNPJ IS, but it said it in every state of a bar with finite room. The
    // chip's hover title carries it instead (setEntidade keeps it current),
    // because an unlabelled CNPJ in a header can be read as the volunteer's own.
    var chipNome = el('span', { class: 'nfpr-chip-alvo-nome', text: 'Nenhuma entidade' });
    // Monospace is added by setEntidade, not declared here: this line holds a
    // CNPJ most of the time and a sentence the rest of it, and "clique para
    // escolher" set in a tabular mono face reads like a machine identifier.
    var chipCnpj = el('span', {
      class: 'nfpr-chip-alvo-cnpj',
      text: 'clique para escolher'
    });
    // Its own class family, .nfpr-chip-alvo. The old one was .nfpr-chip, whose
    // rules lived in modal.css — one shadow root away, at a specificity
    // registrar.css could match but never beat, so which file won came down to
    // load order (that is why it carried a calc(100vw - 450px) max-width and
    // why hiding it needed a scoped selector). Nothing in the modal ever drew
    // one, so those rules are simply gone now.
    var chip = el(
      'button',
      {
        class: 'nfpr-chip-alvo',
        type: 'button',
        // The visible text is CONTEXT (which entity), not a label for what the
        // button does — and when the strip is narrow that text is display:none.
        // So what it opens is written into the title, and setEntidade keeps
        // the context in it.
        attrs: { title: 'Configurações' },
        onClick: function () {
          abrirConfig();
        }
      },
      // Icon FIRST, text after — the order the site's account pill beside it
      // is laid out in too (host-page.js), so the two read as one set.
      [
        el('span', { class: 'nfpr-chip-alvo-gear', html: ICONE_ENGRENAGEM }),
        el('span', { class: 'nfpr-chip-alvo-col' }, [chipNome, chipCnpj])
      ]
    );

    // ---- Back to the site --------------------------------------------------
    // A plain anchor, not a button: it navigates, and a real link is what gives
    // it middle-click, "open in new tab" and a status-bar preview for free.
    //
    // Absent on the offline page, and that is not tidiness. There the site is
    // by definition unreachable, and the connection strip already carries the
    // one way back — "Abrir o site de doação", which re-probes at click time
    // precisely so a dead link does not bounce the volunteer straight back. An
    // unguarded second door beside it would be exactly what that guard exists
    // to prevent.
    var inicio = opcoes.modoOffline
      ? null
      : el(
          'a',
          {
            class: 'nfpr-inicio',
            attrs: {
              href: NFPR.Site.URL_INICIO,
              title: 'Ir para a página inicial do Nota Paraná'
            }
          },
          [
            el('span', { class: 'nfpr-inicio-icone', html: ICONE_CASA }),
            el('span', { class: 'nfpr-inicio-rotulo', text: 'Início' })
          ]
        );

    // Two contexts, one markup. In the panel (the offline page) the head is the
    // panel's own blue strip and carries the brand mark, with the chip pushed
    // right by the spacer. In the BAR (the live page, mounted into the site's
    // #header by ui.js) the government logo is already at the left, so a second
    // mark beside it is noise, and the chip sits alone at the left — leaving
    // the space between us and their user block, which is what makes "ours"
    // and "theirs" read as two clusters rather than one queue.
    var regHead = el(
      'div',
      { class: 'nfpr-reg-head' + (opcoes.cabecalhoSeparado ? ' nfpr-reg-head-barra' : '') },
      [
        opcoes.cabecalhoSeparado ? null : NFPR.iconeMarca('nfpr-reg-icon'),
        opcoes.cabecalhoSeparado ? null : el('span', { class: 'nfpr-spacer' }),
        // Before the chip in both homes. In the BAR that puts it next to the
        // government logo, where a home link is on every site anyone has ever
        // used, and it leaves the chip against the hairline that separates our
        // half from theirs. smoke.js asserts the order: it is invisible in the
        // rendered strip until someone reorders this array by accident.
        inicio,
        chip
      ]
    );

    var regBody = el('div', { class: 'nfpr-reg-body' }, [
      debugBar, // above everything: nothing else changes what the list MEANS
      conexaoBar,
      sessaoCondBar, // a dead session is a condition, exactly like the two above
      entidadeCondBar, // and so is a target the server refuses outright
      servidorCondBar, // and so is a server that cannot judge donations at all
      parteFixaVencidaBar, // both bars can be showing, so it sits below conexaoBar
      parteFixaIgnoradaBar, // ...and so can this one: different fixed part, different fault
      bloqueio,
      entradaArea,
      strip.elemento, // immediately under the cells: what the next note becomes
      strip.status, // ...and the one line that says why, in one priority order
      filaIndicador, // how much is left to do; the list below says what happened
      falhasBar, // ...and which notes were rejected, which neither of them says
      listaResultados,
      takeover // last, and absolutely positioned: it covers everything above it
    ]);

    // The head is only a child of the panel when it has nowhere better to be.
    // On the live page ui.js mounts it into the government header instead —
    // same element, same setEntidade, a different shadow root.
    var registrarPage = el(
      'div',
      { class: 'nfpr-registrar-page' },
      opcoes.cabecalhoSeparado ? [regBody, toastErro] : [regHead, regBody, toastErro]
    );

    // Size the panel so its bottom lands on the bottom of the viewport. The
    // results list then takes the slack purely in CSS (flex: 1, min-height: 0,
    // overflow-y: auto) — no per-row measurement.
    //
    // The one thing CSS cannot express here is how far down the page we start:
    // that depends on the height of the government site's header, above #main.
    // So it is measured — once at mount and again only on a real viewport
    // resize.
    //
    // What this replaces mattered: the old version wrote listaResultados.style
    // .height from inside a ResizeObserver watching document.documentElement.
    // The write changed the document's height, which re-fired the observer,
    // which wrote again. It converged, but on the way it raised Chrome's
    // "ResizeObserver loop completed with undelivered notifications" error —
    // which lands on the government page's window.onerror — and it re-ran on
    // every result row inserted, i.e. on every scan. The observer was never
    // disconnected either.
    //
    // A `resize` listener cannot feed itself: changing our own height does not
    // resize the viewport.
    //
    // The other thing it cannot express is the government page's own #footer,
    // which sits below us in normal flow. Landing our bottom on the bottom of
    // the viewport pushes that footer off-screen by exactly its own height —
    // and with `scrollbar-width: none` on <html> (ui.js) nothing on screen says
    // the page scrolls at all, so it was not below the fold so much as gone.
    // That was the right trade while it was the ~90px slab the site ships;
    // host-page.js now shrinks it to one small row, so we reserve its height
    // and let it show.
    //
    // Read from host-page.js rather than restated here: it is the same number
    // that file styles with, and a second copy would drift into a clipped
    // footer or a gap under the panel. Undefined on the offline page — no host
    // footer, no host-page.js — where this reserves nothing, as before.
    function reservaRodape() {
      var hp = root.__nfprHostPage;
      return (hp && hp.alturaRodape) || 0;
    }

    function ajustarAltura() {
      var topo = registrarPage.getBoundingClientRect().top;
      var altura = window.innerHeight - topo - MARGEM_INFERIOR - reservaRodape();
      registrarPage.style.height = Math.max(ALTURA_MINIMA, altura) + 'px';
    }
    // Scheduled and bound by ui.js, once the panel is in the document and has
    // somewhere to measure from — not here as well, which ran every resize
    // twice.

    // ---- Cell rendering -------------------------------------------------------
    //
    // `caret` overrides WHICH cell blinks, and only the fixed part editor
    // passes it. Normally the caret is derived: it sits at `typed.length`, the
    // next cell a keystroke would fill. While the fixed part editor is open
    // nobody is typing into the cells at all — the text is going into the
    // strip's field — so the derived position is wrong the moment the fixed
    // part contains a `?`: it lands on the first variable slot and stays there,
    // ignoring the character the volunteer is actually editing. With the
    // override the blink follows the field's own text cursor, which is 1:1 with
    // the cells because a normalised fixed part is nothing but digits and `?`.
    function renderCells(typed, templateParteFixa, caret) {
      typed = typed || '';
      limparErro();
      var modelo = new Array(44);
      if (templateParteFixa) {
        var vi = 0;
        for (var i = 0; i < 44; i += 1) {
          var ch = templateParteFixa[i];
          if (ch && ch !== '?') {
            modelo[i] = { t: ch, e: 'fixo' };
          } else {
            if (vi < typed.length) modelo[i] = { t: typed[vi], e: 'preenchido' };
            else if (vi === typed.length) modelo[i] = { t: '', e: 'atual' };
            else modelo[i] = { t: '', e: 'vazio' };
            vi += 1;
          }
        }
      } else {
        for (var j = 0; j < 44; j += 1) {
          if (j < typed.length) modelo[j] = { t: typed[j], e: 'preenchido' };
          else if (j === typed.length) modelo[j] = { t: '', e: 'atual' };
          else modelo[j] = { t: '', e: 'vazio' };
        }
      }
      // THE GROUP BEING FILLED CARRIES A LIGHT OUTLINE, and it is the only
      // landmark bigger than one cell. An eye running along a printed number
      // needs somewhere to come back to, and the single blinking caret is a
      // point rather than a place. Nothing else in this display is ever
      // highlighted — see the rule about not pointing at a span.
      var grupoAtual = -1;
      var forcado = typeof caret === 'number' && caret >= 0 ? Math.min(caret, 43) : -1;
      for (var k = 0; k < 44; k += 1) {
        var m = modelo[k];
        var celk = cells[k];
        var estadoCel = m.e;
        // With an explicit caret the derived one has to go, or two cells blink.
        if (forcado >= 0 && estadoCel === 'atual') estadoCel = 'vazio';
        var classe = 'nfpr-cell nfpr-cell-' + estadoCel;
        if (k === forcado) {
          // On an empty cell the caret replaces the state outright (its dotted
          // placeholder would show through otherwise); over a digit the fixed
          // part fixes it is an extra class, so the cell keeps reading as
          // fixed.
          classe = estadoCel === 'vazio' ? 'nfpr-cell nfpr-cell-atual'
            : 'nfpr-cell nfpr-cell-' + estadoCel + ' nfpr-cell-atual';
        }
        if (celk.textContent !== m.t) celk.textContent = m.t;
        celk.className = classe;
        if (estadoCel === 'atual' || k === forcado) grupoAtual = Math.floor(k / 4);
      }
      for (var gi = 0; gi < grupos.length; gi += 1) {
        grupos[gi].className = 'nfpr-cell-group' + (gi === grupoAtual ? ' nfpr-cell-group-atual' : '');
      }
      var limite = NFPR.ParteFixa.contarVariaveis(templateParteFixa);

      // CDV hint: highlight the entry area when all digits are present but the
      // check digit fails, so the volunteer knows to re-check before sending.
      // Clear it immediately on any change (typed.length < limit).
      //
      // KEPT ON PURPOSE, and it is an exception to "a refusal clears the
      // entry" only in appearance (CLAUDE.md): this is the volunteer
      // re-checking their own reading before it is ever submitted. Once Enter
      // is pressed a red verdict still clears the entry. Off under autoEnviar,
      // where the key is already on its way.
      var cdvErro = false;
      if (!autoEnviarAtual && typed.length === limite && limite > 0) {
        // Reconstruct the full 44-digit key from the fixed part + typed digits.
        var chaveCompleta = '';
        if (templateParteFixa) {
          var vt = 0;
          for (var p = 0; p < templateParteFixa.length && chaveCompleta.length < 44; p += 1) {
            chaveCompleta += templateParteFixa[p] !== '?' ? templateParteFixa[p] : (typed[vt++] || '');
          }
        } else {
          chaveCompleta = typed;
        }
        if (chaveCompleta.length === 44) {
          cdvErro = NFPR.Chave.calcularCDV(chaveCompleta) !== chaveCompleta[43];
        }
      }
      entradaArea.classList.toggle('nfpr-entry-cdv-err', cdvErro);
    }

    var ESTADO_LABEL = {
      enviando: 'Enviando…',
      sucesso: 'Registrada com sucesso',
      inelegivel: 'Não pode ser doada',
      erro: 'Não registrada',
      duplicado: 'Repetida',
      aguardando: 'Guardada',
      encerrando_sessao: 'Encerrando as sessões abertas…'
    };

    // ---- The item list --------------------------------------------------------
    // A BOUNDED LOG OF WHAT HAPPENED, newest at the top. Not a view of pending
    // work: that is the queue indicator above, and conflating the two is what
    // made this list incoherent. Every row here is either a note the volunteer
    // just scanned (which must appear the instant it is read, whatever else is
    // going on) or a note that has settled.
    //
    // Eviction is therefore plain: the oldest ROW falls off the end. There is no
    // priority table any more, because there is no longer a queue of pending
    // rows competing with outcomes for space.
    //
    // Dropping the record with the row is safe ONLY because the outcome is
    // recorded somewhere else first: content.js writes a rejected-and-
    // unexplained note to `nfpr:falhas` before it ever tells this file. It was
    // not always so, and the bug that came of it is worth remembering — with a
    // pool six wide, LIMITE_LINHAS newer scans landing before a slow note came
    // back is ordinary, and when it did come back atualizarItem had nothing to
    // update, so the terminal answer was recorded NOWHERE AT ALL. The fix is
    // durable storage owned by the orchestrator, not a longer-lived record here.
    var porId = new Map(); // id -> row; itens is display order

    function adicionarItem(chave, cnpj, opcoesItem) {
      opcoesItem = opcoesItem || {};
      var id = 'it-' + ++seqId;
      var statusEl = el('span', { class: 'nfpr-res-status', text: ESTADO_LABEL.enviando });
      // Subtle target marker: only rendered when this note's frozen target
      // differs from the entity active right now (e.g. notes queued offline
      // before the config changed). The everyday case stays clean.
      var cnpjDiferente = cnpj && !(entidadeAtual && entidadeAtual.cnpj === cnpj);
      var cnpjEl = cnpjDiferente
        ? el('span', {
            class: 'nfpr-res-cnpj',
            text: '→ ' + Cnpj.formatar(cnpj),
            attrs: { title: 'Será doada à entidade deste CNPJ' }
          })
        : null;
      // Same idea, for the other thing about a row that can surprise someone
      // reading it later: the active fixed part did not apply to this note,
      // because the whole key arrived in the reading.
      var parteFixaEl = opcoesItem.parteFixaIgnorada
        ? el('span', {
            class: 'nfpr-res-parte-fixa-ignorada',
            text: '⚠ parte fixa não usada — chave lida inteira',
            attrs: {
              title:
                'A parte fixa não foi aplicada a esta nota: a chave foi lida por inteiro, ' +
                'e prevaleceu a leitura.'
            }
          })
        : null;
      // The third thing that can surprise someone reading this list later, and
      // by far the worst: debug mode let a note through a gate that exists to
      // stop it. A forced row must never be indistinguishable from an ordinary
      // one, so it says which gate was opened.
      var forcadaEl = opcoesItem.forcado
        ? el('span', {
            class: 'nfpr-res-forcada',
            text:
              '⚠ forçada em depuração — ' +
              (opcoesItem.forcado === 'entrada' ? 'chave inválida' : 'nota não doável'),
            attrs: {
              title:
                'O modo de depuração está ligado e deixou esta nota passar por uma ' +
                'verificação que normalmente a recusaria.'
            }
          })
        : null;
      // The volunteer's own bypass carried this note past a verdict, so the row
      // has to say what that verdict was. The ROW IS BLUE like every other
      // in-flight row and this is a marker on it, never a colour of its own:
      // blue means "being sent" and this note is being sent. Giving it a
      // private colour would break the one thing the panel's colours are for,
      // and red would be a lie — nothing has refused it yet, and "read the
      // paper again" is exactly the wrong thing to say about a note that is on
      // its way to the server. Red is the server's to give from here.
      var semValidacaoEl = opcoesItem.semValidacao
        ? el('span', {
            class: 'nfpr-res-sem-validacao',
            text: '⚠ enviada sem verificação — ' + opcoesItem.semValidacao,
            attrs: {
              title:
                'A preferência “Enviar sem verificação prévia” está ativada; por isso, esta nota ' +
                'foi enviada ao site assim mesmo. A decisão cabe ao servidor do Nota Paraná.'
            }
          })
        : null;
      // A repeat that is being sent anyway. Only "Enviar sem verificação prévia"
      // produces this: with the preference off a repeat is refused and the fact
      // is the row's STATUS ("Esta nota já foi lida recentemente.") rather than a marker
      // beside it. The de-dup check is not a verdict on the digits — it is the
      // only thing that can tell a volunteer they are holding two copies of the
      // same receipt — so it keeps speaking even when it has stopped refusing.
      var duplicadaEl = opcoesItem.duplicada
        ? el('span', {
            class: 'nfpr-res-duplicada',
            text: '⚠ repetida — ' + opcoesItem.duplicada,
            attrs: {
              title:
                'Esta nota já havia sido lida. Como a preferência ' +
                '“Enviar sem verificação prévia” está ativada, ela foi enviada assim mesmo.'
            }
          })
        : null;
      var rootEl = el('div', { class: 'nfpr-res nfpr-res-enviando', attrs: { 'data-id': id } }, [
        el('span', { class: 'nfpr-res-dot' }),
        el('div', { class: 'nfpr-res-main' }, [
          el('span', { class: 'nfpr-res-chave nfpr-mono', text: agruparChave(chave) }),
          cnpjEl,
          parteFixaEl,
          forcadaEl,
          semValidacaoEl,
          duplicadaEl,
          statusEl
        ])
      ]);
      if (resultadosVazio.parentNode) resultadosVazio.remove();
      listaResultados.insertBefore(rootEl, listaResultados.firstChild);
      // SNAP BACK TO THE TOP ON EVERY NEW ROW. The list is newest-first and
      // .nfpr-results is the only element in the panel that scrolls, so a
      // volunteer who scrolled down to look at something earlier would have
      // every new row appear off-screen above them — including the row for the
      // note they are holding right now, which is their only confirmation the
      // key was read at all.
      //
      // Unconditional, and not "only if already near the top": the row being
      // created is always the most important thing on this surface, and a
      // half-remembered scroll position is not worth the note in someone's
      // hand. Cheap enough to do per row — it is an assignment, not a
      // measurement, and a drain inserts at most LARGURA_ENVIO at a time.
      listaResultados.scrollTop = 0;
      var registro = { id: id, estado: 'enviando', root: rootEl, statusEl: statusEl };
      itens.unshift(registro);
      porId.set(id, registro);
      while (itens.length > LIMITE_LINHAS) {
        var velho = itens.pop();
        porId.delete(velho.id);
        if (velho.root.parentNode) velho.root.remove();
      }
      return id;
    }

    function atualizarItem(id, dados) {
      // Its row scrolled off the end, so there is nothing to paint. Harmless:
      // a rejected-and-unexplained note was written to nfpr:falhas by the
      // orchestrator before this was ever called, so nothing is lost here.
      var it = porId.get(id);
      if (!it) return;
      it.estado = dados.estado || it.estado;
      it.root.className = 'nfpr-res nfpr-res-' + it.estado;
      // Server/user text is ALWAYS rendered as text. Actionable errors carry a
      // structured { href, rotulo } link that we build as a real element.
      //
      // TWO ELEMENTS, NOT A CONCATENATED STRING. `fonte` says this sentence was
      // the site's (or is about a failure the site decided), and it is rendered
      // as its own muted <span> so it can be styled down — it is provenance,
      // not part of the sentence, and the volunteer should read straight past
      // it. Gluing "[nfprweb] " onto the front of the message would also put
      // server-supplied text and our own label in one node, and the message has
      // to keep going through `text:` on its own (see dom.js).
      it.statusEl.replaceChildren();
      if (dados.fonte === 'nfprweb') {
        it.statusEl.appendChild(
          el('span', { class: 'nfpr-res-fonte nfpr-mono', text: '[nfprweb]' })
        );
        it.statusEl.appendChild(document.createTextNode(' '));
      }
      it.statusEl.appendChild(
        document.createTextNode(dados.mensagem || ESTADO_LABEL[it.estado] || '')
      );
      if (dados.link && dados.link.href) {
        it.statusEl.appendChild(document.createTextNode(' '));
        it.statusEl.appendChild(
          el('a', {
            class: 'nfpr-res-link',
            text: dados.link.rotulo || 'Abrir',
            attrs: { href: dados.link.href }
          })
        );
      }
      if (dados.acao && dados.acao.rotulo) {
        it.statusEl.appendChild(document.createTextNode(' '));
        it.statusEl.appendChild(
          el('button', {
            class: 'nfpr-res-acao',
            type: 'button',
            text: dados.acao.rotulo,
            onClick: dados.acao.aoClicar || function () {}
          })
        );
      }
    }

    /**
     * How many rows are showing as "Enviando…" right now.
     *
     * The queue bar subtracts this, so that work is never announced twice — a
     * blue row already says the note is on its way. Counted from the rows
     * themselves rather than tracked alongside them, because "is there a blue
     * row for it" is exactly the question, and any parallel counter would have
     * to be right about a scanned note waiting for a pool slot, a note on a
     * retry timer, and a row that scrolled off the end. This cannot drift.
     */
    function contarEnviando() {
      var n = 0;
      for (var i = 0; i < itens.length; i += 1) {
        if (itens[i].estado === 'enviando') n += 1;
      }
      return n;
    }

    function setEntidade(inst) {
      entidadeAtual = inst || null;
      if (inst && inst.cnpj) {
        // An entity the registry has not named yet is its CNPJ alone: the
        // name line goes empty (and `:empty` collapses it in registrar.css),
        // and the title names the CNPJ instead.
        chipNome.textContent = inst.nome || '';
        chipCnpj.textContent = Cnpj.formatar(inst.cnpj);
        chipCnpj.classList.add('nfpr-mono');
        chip.setAttribute('title', 'Configurações — doando para ' + (inst.nome || Cnpj.formatar(inst.cnpj)));
        chip.classList.remove('nfpr-chip-alvo-vazio');
      } else {
        // With no target the chip stops describing one and becomes the
        // invitation to pick one — which is also what the blocked card over
        // the entry says. The title follows, rather than promising a target
        // that does not exist.
        chipNome.textContent = 'Nenhuma entidade';
        chipCnpj.textContent = 'clique para escolher';
        chipCnpj.classList.remove('nfpr-mono');
        chip.setAttribute('title', 'Configurações — nenhuma entidade escolhida');
        chip.classList.add('nfpr-chip-alvo-vazio');
      }
    }

    function bloquearEntrada(msg) {
      // The instruction goes with it — see pintarVazio. "Escaneie a nota…"
      // describes something that cannot happen yet, because the entry is
      // blocked precisely for want of anywhere to send a note.
      entradaBloqueada = true;
      pintarVazio();
      bloqueio.innerHTML = '';
      bloqueio.appendChild(
        el('div', { class: 'nfpr-bloqueio-card' }, [
          el('span', { class: 'nfpr-bloqueio-icon', text: '⚙️' }),
          el('p', { text: msg || 'Para começar, cadastre a entidade que receberá as doações.' }),
          el('button', {
            class: 'nfpr-btn nfpr-btn-primary',
            type: 'button',
            text: 'Abrir configurações',
            onClick: function () {
              abrirConfig();
            }
          })
        ])
      );
      bloqueio.removeAttribute('hidden');
    }
    function desbloquearEntrada() {
      esconder(bloqueio);
      entradaBloqueada = false;
      // No guard needed any more, and losing it is the point. The instruction
      // now lives INSIDE the empty-list element, which the first row removes
      // from the document and an empty list puts back — so this can no longer
      // pop a hint back over a screen full of results the moment a preference
      // is toggled, which is what the guard here used to be for.
      pintarVazio();
    }

    /**
     * setTakeover(msg, detalhe) | setTakeover(null)
     *
     * THE PANEL DOING ONE THING. An overlay over the whole body — bars, entry,
     * list and all — for the one moment when there is nothing to read and
     * nothing to decide, only something to wait for.
     *
     * It exists for first run on a duplicate session: the extension closes the
     * other sessions and reloads by itself, and the volunteer should see one
     * sentence rather than a session bar, a blocking card and a settings form
     * competing for a decision they cannot make yet.
     *
     * An OVERLAY rather than emptying the body, deliberately: nothing is
     * unbuilt, no state is lost, and it lifts by hiding one element. The body
     * is already `position: relative`, so this needs no layout of its own.
     */
    function setTakeover(msg, detalhe) {
      if (!msg) {
        takeover.setAttribute('hidden', 'hidden');
        return;
      }
      takeoverMsg.textContent = msg;
      takeoverDetalhe.textContent = detalhe || '';
      takeover.removeAttribute('hidden');
    }

    /**
     * mostrarErro(msg, acao?)
     *   acao = { rotulo, aoClicar }  — rendered as a real button
     *
     * The action exists for exactly one caller: a red verdict with a fixed part
     * active, where a SECOND CAUSE genuinely exists and the button drops the
     * fixed part. It is not a repair control and must not become one — the
     * digits are gone, deliberately, and nothing here offers them back. Same
     * structured shape setSessao and atualizarItem already take, so no HTML
     * string ever travels through the app.
     */
    function mostrarErro(msg, acao) {
      clearTimeout(toastTimer);
      // A new toast replaces the old one's button, which may be holding the
      // keyboard — the same hand-on as esconder, for a control removed rather
      // than hidden.
      var tinhaFoco = focoEm(toastErro);
      toastErro.replaceChildren();
      toastErro.appendChild(document.createTextNode(msg == null ? '' : msg));
      if (acao && acao.rotulo) {
        toastErro.appendChild(
          el('button', {
            class: 'nfpr-toast-erro-acao',
            type: 'button',
            text: acao.rotulo,
            onClick: acao.aoClicar || function () {}
          })
        );
      }
      toastErro.removeAttribute('hidden');
      toastErro.classList.remove('nfpr-toast-saindo');
      if (tinhaFoco) focarEntrada();
      // A toast carrying a button stays long enough to read the sentence AND
      // reach for it; a bare one keeps the timing it has always had.
      toastTimer = setTimeout(limparErro, acao && acao.rotulo ? 9000 : 4000);
    }
    function limparErro() {
      clearTimeout(toastTimer);
      toastErro.classList.add('nfpr-toast-saindo');
      toastTimer = setTimeout(function () {
        esconder(toastErro);
        toastErro.classList.remove('nfpr-toast-saindo');
      }, 300);
    }

    return {
      elemento: registrarPage,
      // Handed out whether or not it was mounted in the panel, so the caller
      // never has to know which arrangement it asked for.
      cabecalho: regHead,
      api: {
        ajustarAltura: ajustarAltura,
        focarEntrada: focarEntrada,
        atualizarDisplay: function (d) {
          if (d && d.templateParteFixa) parteFixaAtual = { template: d.templateParteFixa };
          renderCells(
            (d && d.typed) || '',
            d && d.templateParteFixa ? d.templateParteFixa : null,
            d ? d.caret : null
          );
        },
        limparDisplay: function (caret) {
          renderCells('', parteFixaAtual ? parteFixaAtual.template : null, caret);
        },
        definirParteFixaTemplate: function (template) {
          parteFixaAtual = template ? { template: template } : null;
        },
        setAutoEnviar: function (v) {
          autoEnviarAtual = !!v;
        },
        mostrarErro: mostrarErro,
        limparErro: limparErro,
        adicionarItem: adicionarItem,
        atualizarItem: atualizarItem,
        setEntidade: setEntidade,
        setConexao: setConexao,
        setParteFixaVencida: setParteFixaVencida,
        setParteFixaIgnorada: setParteFixaIgnorada,
        // The strip's own surface, passed straight through: registrador.js
        // drives it with the same "handler arrives with the state" contract as
        // every bar above, and nothing else in the panel needs to know it is a
        // separate module.
        setPartesFixas: strip.api.setPartesFixas,
        setProgressoEntrada: strip.api.setProgresso,
        setStatusVeredito: strip.api.setStatusVeredito,
        setStatusRepouso: strip.api.setStatusRepouso,
        setStatusDica: strip.api.setStatusDica,
        // Fixed parts are a preference, on by default (config.js). This hides
        // the strip; the status line under it stays, because it carries the
        // live verdict and the offer that tells a typist fixed parts exist at
        // all.
        setPartesFixasVisiveis: strip.api.setVisivel,
        abrirEditorDeParteFixa: strip.api.abrirEditor,
        editandoParteFixa: strip.api.editando,
        setFila: setFila,
        contarEnviando: contarEnviando,
        setFalhas: setFalhas,
        listarFalhas: function () {
          return falhasAtuais.slice();
        },
        setSessao: setSessao,
        setEntidadeRecusada: setEntidadeRecusada,
        setServidorConfuso: setServidorConfuso,
        setDebug: setDebug,
        bloquearEntrada: bloquearEntrada,
        desbloquearEntrada: desbloquearEntrada,
        setTakeover: setTakeover
      }
    };
  }

  NFPR.Painel = { criar: criar, LIMITE_LINHAS: LIMITE_LINHAS };
})(typeof globalThis !== 'undefined' ? globalThis : self);
