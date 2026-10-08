/**
 * strip-parte-fixa.js  (content + offline page)
 * -----------------------------------------------------------------------------
 * THE STRIP: one permanent line immediately under the 44 cells, on both
 * registrars. It states what will happen to the next thing entered — and it is
 * itself the control that changes it.
 *
 *   [ + Fixar o começo da chave                                             ▾ ]
 *   [ Padaria — só 22 números por nota  8 de 22  [Digitar a chave inteira]  ▾ ]
 *
 * With nothing armed the label is an INVITATION rather than a status, and with
 * a fixed part armed a one-click way out sits beside it: the cells then hold
 * digits the volunteer never typed, and the escape from that cannot be two
 * clicks deep inside a popover they have no reason to open.
 *
 * A FIXED PART IS WORKING STATE, NOT CONFIGURATION, which is the whole reason
 * this exists. An entity is configuration: one per install, rarely changed, and
 * correctly beside the preferences. A fixed part is a piece of text with a
 * lifetime of one sitting, so managing it in a settings modal — the previous
 * home, and before that the toolbar popup, which has no entry to use a fixed
 * part with at all — meant managing it away from the only place its effect is
 * visible. Here the 44 cells above ARE the preview: the editor writes into the
 * same display the volunteer will type a note into.
 *
 * Four parts, one element:
 *   the LABEL     what the next note will be read as, or — with no fixed part —
 *                 the invitation to write one. Click it either way to edit.
 *   the PROGRESS  `8 de 22` while the buffer holds something. Under a fixed
 *                 part the total is the digits the volunteer types, never 44.
 *   the ESCAPE    "Digitar a chave inteira", only while one is armed.
 *   the LIST      "Escolher parte fixa ▾" opens every fixed part there is, most
 *                 recently used first. The words carry it: a bare chevron
 *                 says a menu exists and nothing about what is in it. It said
 *                 "Recentes" while the list was grouped saved-first and the
 *                 recents were the half you had to go looking for; the list is
 *                 one group now, so the honest words are the name of the thing
 *                 in it.
 *
 * The list itself is a FIXED FRAME — header, filter and footer pinned, only the
 * rows scrolling, with "Chave inteira" riding the top of the scroll. The filter
 * appears only past LIMITE_SEM_FILTRO fixed parts and never takes the keyboard
 * on its own. Both of those exist because the tiers were merged into one
 * recency-ordered list: see the block that builds them.
 *
 * ...plus ONE STATUS LINE directly under it, with a fixed priority order:
 *   1. the editor's live help, while the field is open
 *   2. the live verdict, while typing
 *   3. the `enviarSemValidar` notice, as the resting state
 * One element, never ambiguous, and the resting notice reappearing when a
 * verdict clears is correct: it is a state, not an event.
 *
 * THIS FILE RENDERS, exactly like painel.js. It makes no request and reads no
 * storage: every handler arrives WITH the state, through setPartesFixas, and
 * registrador.js owns the config reads and writes.
 *
 * NFPR.StripParteFixa.criar() -> { elemento, status, api }
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  var NFPR = (root.NFPR = root.NFPR || {});
  var el = NFPR.el; // shared DOM builder (src/shared/dom.js)

  // How many fixed parts the list holds before it is worth a filter. Exported
  // so smoke.js asserts against whatever it currently is rather than a number
  // written down twice.
  var LIMITE_SEM_FILTRO = 8;

  var LUPA =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
    'stroke-width="2.4" stroke-linecap="round">' +
    '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 4.5 4.5"/></svg>';

  var SETA_BAIXO =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
    'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6 9.5 12 15.5 18 9.5"/></svg>';

  function criar() {
    // The state last handed in. Kept so the popover and the editor can be
    // rebuilt from it on open without asking anyone anything.
    var estado = {
      rotulo: null, // null = no fixed part
      variaveis: 44,
      template: null,
      lista: [],
      ativaId: null
    };
    var acoes = {};
    var digitados = 0;

    // ---- The resting strip ----------------------------------------------------
    var rotuloTexto = el('span', { class: 'nfpr-strip-nome' });
    var rotuloBtn = el(
      'button',
      {
        class: 'nfpr-strip-rotulo',
        type: 'button',
        attrs: { title: 'Escrever ou mudar a parte fixa' },
        onClick: function () {
          abrirEditor();
        }
      },
      [rotuloTexto]
    );
    // IT COSTS THE ROW NO WIDTH. It comes and goes with the buffer, and an
    // element that leaves the row takes its width with it — so the first digit
    // typed re-laid the whole strip out under the volunteer, the label
    // truncating mid-word and the two controls sliding along. Reserving a slot
    // for it instead fixed the movement and spent the width permanently, which
    // a 400–500px viewport does not have to spare.
    //
    // So it is lifted out of the flow (see registrar.css) and pinned to the
    // right of the label's own box, exactly where the flow put it: the label
    // keeps the full width at every size and the pill draws OVER its tail when
    // there is nothing left to give. It is hidden by VISIBILITY, never by
    // `hidden` — empty at rest rather than absent.
    var progresso = el('span', { class: 'nfpr-strip-progresso' });
    // THE WAY OUT, IN ONE CLICK, and it only exists while there is something to
    // get out of. A fixed part puts digits in the cells that the volunteer did
    // not type, and someone who has not met the feature reads that as the
    // software being broken — so the escape cannot be two clicks deep inside a
    // popover they have no reason to open. It says the same words as the two
    // bars that already offer this exact action (painel.js), because a fourth
    // phrasing for one action is how people stop recognising it.
    //
    // It DEACTIVATES, never deletes: the fixed part stays in the list, and the
    // config change that follows resets the capture buffer, so a half-typed
    // entry made under the old fixed part goes with it.
    var limparParteFixa = el('button', {
      class: 'nfpr-strip-limpar',
      type: 'button',
      text: 'Digitar a chave inteira',
      attrs: {
        hidden: 'hidden',
        title: 'Voltar a digitar a chave inteira, sem parte fixa'
      },
      onClick: function () {
        if (acoes.aoAtivar) acoes.aoAtivar(null);
      }
    });
    // THE CHEVRON IS NAMED. On its own it says only that something opens, which
    // is the one thing a volunteer can already guess; the word says WHAT is
    // behind it. It read "Recentes" while the list was two blocks and the
    // recent one was the half you went looking for — with a single list
    // ordered by last use, that word now describes the top of it rather than
    // its contents, and the contents are simply the fixed parts. It then read
    // "Partes fixas", a bare noun that sat oddly beside the strip's other
    // labels, which all say what the volunteer does; it is a verb now. The label
    // leads and the chevron follows, so the strip reads left to right and the
    // arrow keeps its usual place at the end.
    //
    // On a narrow strip it gives its words up before the invitation beside it
    // does, tail first: "Escolher parte fixa ▾", then "Escolher ▾", then the ▾
    // alone (registrar.css). The `title` carries the whole label at every width,
    // since at the last step nothing on screen names what opens.
    var abrirLista = el(
      'button',
      {
        class: 'nfpr-strip-seta',
        type: 'button',
        title: 'Escolher parte fixa',
        onClick: function () {
          if (popover.hasAttribute('hidden')) abrirPopover();
          else fecharPopover();
        }
      },
      [
        el('span', { class: 'nfpr-strip-seta-texto' }, [
          'Escolher',
          el('span', { class: 'nfpr-strip-seta-resto', text: ' parte fixa' })
        ]),
        el('span', { class: 'nfpr-strip-seta-icone', html: SETA_BAIXO })
      ]
    );
    // The escape sits before the ▾ rather than after the label, so its position
    // never moves: a control that is only there in an emergency has to be in
    // the same place every time someone looks for it, and the label beside it
    // is as long as whatever the fixed part was called.
    // The label and the counter are ONE BOX, because the counter is positioned
    // against it rather than sequenced after it: this is the element it hangs
    // off, and it is the flexible one, so the pill lands where the flow used to
    // put it — hard against `Digitar a chave inteira` — at every width.
    var vagaRotulo = el('div', { class: 'nfpr-strip-vaga' }, [rotuloBtn, progresso]);
    var linhaRepouso = el(
      'div',
      { class: 'nfpr-strip-linha' },
      [vagaRotulo, limparParteFixa, abrirLista]
    );

    // ---- The editor -----------------------------------------------------------
    // The same row, in its other state. Only digits and '?' are accepted, on
    // every input event, exactly as the settings form used to do it.
    //
    // THE FIELD KEEPS ITS TEXT ON REFUSAL, and the key entry does not. That
    // looks inconsistent and is the opposite: a key is a READING OF A PAPER, so
    // when the reading is wrong the recovery is a fresh independent one and
    // keeping the corrupt digits invites a repair of a corrupt reading. A fixed
    // part is TEXT THE VOLUNTEER AUTHORED — there is no second source to
    // re-read, and clearing it would mean retyping 22 correct digits because
    // one was wrong.
    //
    // AND IT SAYS WHICH FIXED PART IT IS. One field does two jobs — writing a
    // new fixed part and rewriting the armed one — and applying an edit
    // overwrites that fixed part in place, so the volunteer has to be able to
    // see whose digits are in the field before changing them. The text alone
    // cannot say it: an existing fixed part opens pre-filled with digits that
    // look exactly like a freshly typed one, and the placeholder, the only
    // other thing that could have named it, is never on screen in precisely
    // that case.
    var legenda = el('span', { class: 'nfpr-strip-legenda' });
    var campo = el('input', {
      class: 'nfpr-strip-campo nfpr-mono',
      type: 'text',
      // NO inputmode: 'numeric'. The head of a key is the issuer's CNPJ, which
      // may hold uppercase letters — so this is the one field in the extension
      // most likely to need them, and a numeric touch keyboard cannot type one.
      placeholder: 'Insira a parte que se repete nas chaves'
    });
    var btnAplicar = el('button', {
      class: 'nfpr-btn nfpr-btn-primary nfpr-btn-sm',
      type: 'button',
      text: 'Aplicar',
      onClick: function () {
        aplicarEditor();
      }
    });
    var btnCancelar = el('button', {
      class: 'nfpr-btn nfpr-btn-ghost nfpr-btn-sm',
      type: 'button',
      text: 'Cancelar',
      onClick: function () {
        fecharEditor();
      }
    });
    var linhaEditor = el('div', { class: 'nfpr-strip-linha nfpr-strip-linha-editor', attrs: { hidden: 'hidden' } }, [
      legenda,
      campo,
      btnAplicar,
      btnCancelar
    ]);

    // The cells above are the preview: the volunteer sees the fixed part's
    // fixed digits land in the display they are about to type a note into. One
    // widget, not two — which is also why the caret goes with it. A normalised
    // fixed part is one character per cell, so the field's own cursor position
    // IS a cell index, and handing it over is what keeps the blink on the
    // character being edited instead of stranding it on the first `?`.
    function prever() {
      // Escape and Enter close the editor on keydown, and the keyup that
      // follows would otherwise repaint the cells of a field nobody is in.
      if (!editando || !acoes.aoPreverTexto) return;
      // selectionEnd, not Start: opening the editor selects the whole fixed
      // part, and the end of that selection is the character about to be
      // replaced.
      var pos = campo.selectionEnd;
      acoes.aoPreverTexto(campo.value, typeof pos === 'number' ? pos : campo.value.length);
    }

    function semCauda(texto) {
      return NFPR.ParteFixa.normalizar(texto).replace(/\?+$/, '');
    }

    // Both halves of the cursor, in that order: assigning only `selectionStart`
    // leaves a selection behind when the old end was further along.
    function porCursor(pos) {
      campo.selectionStart = pos;
      campo.selectionEnd = pos;
    }

    campo.addEventListener('input', function () {
      var pos = campo.selectionStart;
      if (typeof pos !== 'number') pos = campo.value.length;
      var antes = campo.value;
      var normal = NFPR.ParteFixa.normalizar(antes);
      if (normal !== antes) {
        // Normalising can drop characters before the cursor, so put it back
        // where the text it kept ended up rather than at the end of the field.
        var descartados = 0;
        for (var i = 0; i < pos && i < antes.length; i += 1) {
          if (NFPR.ParteFixa.normalizar(antes[i]) === '') descartados += 1;
        }
        campo.value = normal;
        porCursor(Math.max(0, Math.min(normal.length, pos - descartados)));
      }
      prever();
      pintarAjuda();
    });
    // Moving the cursor without changing the text still moves what is being
    // edited, so arrow keys, clicks and selections repaint the caret too.
    campo.addEventListener('keyup', prever);
    campo.addEventListener('click', prever);
    campo.addEventListener('select', prever);
    // SPACE TYPES A '?'. The key has 44 digits and no spaces, so the space bar
    // means nothing in this field and is the largest key on the board; `?` is
    // the one character here that is not on the number pad a volunteer is
    // already using with one hand. Pure convenience — it types the same
    // character the field has always taken, so nothing downstream changes and
    // the `?` on the keyboard keeps working.
    function digitarInterrogacao() {
      var valor = campo.value;
      var ini = typeof campo.selectionStart === 'number' ? campo.selectionStart : valor.length;
      var fim = typeof campo.selectionEnd === 'number' ? campo.selectionEnd : valor.length;
      var esquerda = NFPR.ParteFixa.normalizar(valor.slice(0, ini));
      var texto = NFPR.ParteFixa.normalizar(esquerda + '?' + valor.slice(fim));
      campo.value = texto;
      // `normalizar` caps at 44 from the END, so the '?' itself survives unless
      // there was no room for it at all — in which case there is nowhere for
      // the cursor to advance to either.
      porCursor(Math.min(texto.length, esquerda.length + 1));
      prever();
      pintarAjuda();
    }

    campo.addEventListener('keydown', function (e) {
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        e.stopPropagation();
        digitarInterrogacao();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        aplicarEditor();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        fecharEditor();
      }
    });

    function pintarAjuda() {
      var texto = campo.value;
      var r = acoes.avaliarTexto ? acoes.avaliarTexto(texto) : null;
      if (!r) {
        definirStatus('editor', null);
        return;
      }
      definirStatus('editor', { texto: r.texto, erro: !!r.erro });
    }

    // `novo` is "+ Nova parte fixa": with a fixed part already active, that
    // gesture has to make a SECOND one rather than overwrite the first, and
    // nothing downstream can tell the two apart from the text alone.
    var editandoNovo = false;

    // WHICH FIXED PART. Repainted from `estado` rather than frozen at open, so
    // a fixed part renamed in another surface while the editor is up cannot
    // leave the old name sitting over the field.
    function pintarLegenda() {
      var alvo = !editandoNovo && estado.rotulo ? estado.rotulo : null;
      legenda.textContent = alvo ? 'Editando “' + alvo + '”' : 'Nova parte fixa';
    }

    // Is the keyboard somewhere inside this strip? Asked of the root the strip
    // lives in, because a closed shadow root keeps its focused element to
    // itself — from the document, focus in here looks like focus on the host.
    function focoDentro() {
      return focoEm(elemento);
    }
    function focoEm(no) {
      var raiz = no.getRootNode ? no.getRootNode() : null;
      var ativo = raiz && raiz.activeElement;
      return !!ativo && typeof no.contains === 'function' && no.contains(ativo);
    }

    // A CONTROL THAT HIDES ITSELF HANDS THE KEYBOARD ON — the rule painel.js
    // keeps for its bars, kept here for the strip's own. "Digitar a chave
    // inteira" is hidden by the very config change its click makes, and the
    // status line's "Ativar" / "Não mostrar" by the answer they give; pressed
    // from the keyboard, each left it on nothing, and the next Tab started at
    // the top of the government page. Through the editor's close handler, so
    // it declines in the same one case: while the settings overlay is up.
    function esconder(no) {
      var tinhaFoco = focoEm(no);
      no.setAttribute('hidden', 'hidden');
      if (tinhaFoco && acoes.aoFecharEditor) acoes.aoFecharEditor();
    }

    function abrirEditor(novo) {
      fecharPopover();
      editandoNovo = !!novo;
      // NO TRAILING '?' IN THE FIELD. A stored fixed part is always completed
      // to 44, so opening one to edit put a wall of question marks after the
      // digits — `ParteFixa.completar` says the same thing with silence, and
      // every one of them was a character to arrow past or delete before
      // reaching the end of the actual text. Only the ones BETWEEN digits carry
      // information. Trimmed on the way IN and nowhere else: a '?' typed at the
      // end is a volunteer part-way through writing one in the middle, and
      // taking it away as they type would make a middle '?' impossible to
      // reach.
      campo.value = novo ? '' : semCauda(estado.template || '');
      pintarLegenda();
      linhaRepouso.setAttribute('hidden', 'hidden');
      linhaEditor.removeAttribute('hidden');
      editando = true;
      // The cells become the fixed part preview from here on, so whatever was
      // half-entered has to go with them — see the handler.
      if (acoes.aoAbrirEditor) acoes.aoAbrirEditor();
      pintarAjuda();
      campo.focus();
      campo.select();
      prever();
    }

    function fecharEditor() {
      editando = false;
      linhaEditor.setAttribute('hidden', 'hidden');
      linhaRepouso.removeAttribute('hidden');
      definirStatus('editor', null);
      // Put the cells back the way the ACTIVE fixed part leaves them: the
      // preview was a look at a fixed part that was never applied.
      if (acoes.aoPreverTexto) acoes.aoPreverTexto(null);
      if (acoes.aoFecharEditor) acoes.aoFecharEditor();
    }

    function aplicarEditor() {
      var texto = NFPR.ParteFixa.normalizar(campo.value);
      var r = acoes.avaliarTexto ? acoes.avaliarTexto(texto) : null;
      // WARN WHILE TYPING, REFUSE ON ENTER. A fixed part that can only describe
      // undonatable notes is worthless and every note entered under it would
      // die, so applying it is refused — and the text stays, per the note on
      // the field above.
      if (r && r.erro) {
        pintarAjuda();
        campo.focus();
        return;
      }
      if (acoes.aoAplicarTexto) acoes.aoAplicarTexto(texto, editandoNovo);
      fecharEditor();
    }

    var editando = false;
    // The rename field currently open in the list, or null. It is a text field
    // inside our own shadow root, exactly like the fixed part editor, so it
    // needs the same cover from capture — see the handler that opens it.
    var renomeando = null;

    // ---- The list -------------------------------------------------------------
    // In the REGISTRAR's own shadow root, not in the settings overlay, so
    // capture stays live and switching never feels like leaving the work.
    //
    // ONE LIST, ORDERED BY LAST USE. Saved and recent used to be two blocks in
    // one scrolling box, and two blocks in one box means whichever comes first
    // pushes the other off the bottom: saved fixed parts are never capped and
    // never evicted, so twenty of them hid every recent, and leading with the
    // recents instead only swaps which half disappears. The tier is a
    // LIFECYCLE fact — will this still be here tomorrow? — not the question
    // being asked at the moment the list is open, and it is already on every
    // row: it is what the first button says, `Salvar` or `Renomear`.
    //
    // A FIXED FRAME, and only the rows scroll. The whole popover used to
    // scroll, so on a long list "+ Nova parte fixa" — the one way to make
    // a fixed part at all — sat a thousand pixels below the fold, and so did
    // the one-click answer to a machine full of somebody else's fixed parts.
    var listaCorpo = el('div', { class: 'nfpr-partes-lista' });

    // THE FILTER APPEARS ONLY WHEN THERE IS SOMETHING TO FILTER. Over four rows
    // a search box is furniture that claims the list is longer than it is; over
    // twenty it is the only way to reach the eighteenth.
    //
    // IT IS NEVER FOCUSED AUTOMATICALLY, and that is load-bearing rather than
    // taste. This popover lives in the registrar's own root precisely so
    // capture stays live while it is open — a scan mid-list still registers —
    // and a field that grabbed focus on open would swallow the next barcode
    // into a search box. Focus here is a deliberate click, and while it is held
    // capture stands down through `editando()`, the same cover the fixed part
    // editor and the rename field take.
    var filtro = '';
    var buscando = false;
    var campoBusca = el('input', {
      class: 'nfpr-partes-busca-campo',
      type: 'text',
      onInput: function () {
        filtro = campoBusca.value;
        pintarLista();
      },
      onFocus: function () {
        buscando = true;
      },
      onBlur: function () {
        buscando = false;
      },
      onKeydown: function (e) {
        // Escape backs out ONE STEP AT A TIME: the search first, the list
        // second. Emptying a filter and closing the thing being filtered are
        // two intentions, and a key that does both at once destroys the list
        // position of anyone who only wanted the first.
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          if (filtro) {
            campoBusca.value = '';
            filtro = '';
            pintarLista();
          } else {
            fecharPopover();
          }
        } else if (e.key === 'Enter') {
          // Nothing to submit — the rows are the result. Swallowed so it cannot
          // reach capture and be read as the end of a key.
          e.preventDefault();
          e.stopPropagation();
        }
      }
    });
    var busca = el('div', { class: 'nfpr-partes-busca', attrs: { hidden: 'hidden' } }, [
      el('span', { class: 'nfpr-partes-busca-icone', html: LUPA }),
      campoBusca
    ]);

    // The explainer is for someone who has never met a fixed part. Once there
    // are fixed parts in the list it answers a question the list itself has
    // already answered — and it does so from inside a frame that never scrolls,
    // where two lines are two lines taken off every row below them.
    var subtitulo = el('span', {
      class: 'nfpr-partes-pop-sub',
      text:
        'Quando muitas notas começam com os mesmos números, escreva essa parte uma ' +
        'única vez e digite apenas o que muda.'
    });

    // THE FOOTER'S TWO BROOMS, and each is in the tree only while it has a pile
    // to sweep. A control that clears nothing is not merely idle furniture in a
    // frame this tight — it is a claim that there is something to clear, on the
    // one surface a volunteer consults to find out whether there is.
    //
    // They are NOT two settings of one broom. `Limpar as não salvas` sweeps by
    // TIER and never touches a named fixed part, because that is what naming
    // one promises; `Limpar as vencidas` sweeps by VERDICT and takes both
    // tiers, because a stale fixed part is worthless however carefully it was
    // named, and sparing the saved ones here would leave the exact fixed parts
    // this button exists for. So neither is a wider version of the other, and
    // both can be on screen at once.
    var limparVencidas = el('button', {
      class: 'nfpr-partes-limpar',
      type: 'button',
      text: 'Limpar as vencidas',
      attrs: { hidden: 'hidden' },
      onClick: function () {
        if (acoes.aoLimparVencidas) acoes.aoLimparVencidas();
      }
    });
    var limparNaoSalvas = el('button', {
      class: 'nfpr-partes-limpar',
      type: 'button',
      text: 'Limpar as não salvas',
      attrs: { hidden: 'hidden' },
      onClick: function () {
        if (acoes.aoLimparNaoSalvas) acoes.aoLimparNaoSalvas();
      }
    });

    var popover = el(
      'div',
      {
        class: 'nfpr-partes-pop',
        attrs: { hidden: 'hidden' },
        // ESC CLOSES THE LIST FROM ANYWHERE INSIDE IT, and hands the keyboard
        // back to the ▾ that opened it, so a volunteer without a mouse is not
        // left on a control that has just disappeared. The filter keeps its own
        // two steps (it stops the event before it gets here), and capture still
        // speaks first: a key with digits in the buffer empties the buffer and
        // is consumed there, so the list closes on the next one — one step at a
        // time, as everywhere else.
        onKeydown: function (e) {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          fecharPopover();
          abrirLista.focus();
        }
      },
      [
        el('div', { class: 'nfpr-partes-pop-head' }, [
          el('strong', { class: 'nfpr-partes-pop-titulo', text: 'Parte fixa da chave' }),
          subtitulo
        ]),
        busca,
        listaCorpo,
        el('div', { class: 'nfpr-partes-pop-pe' }, [
          el('button', {
            class: 'nfpr-partes-nova',
            type: 'button',
            text: '+ Nova parte fixa',
            onClick: function () {
              abrirEditor(true);
            }
          }),
          el('div', { class: 'nfpr-partes-limpezas' }, [limparVencidas, limparNaoSalvas])
        ])
      ]
    );

    function fecharPopover() {
      popover.setAttribute('hidden', 'hidden');
      // A rename field inside it stops being open when the list does, exactly
      // as it does on a repaint. It claims `editando()`, which stands capture
      // down, so leaving it set behind a hidden popover would silently stop
      // the entry accepting keys with nothing on screen to explain it. Cleared
      // BEFORE the field goes, so a late blur takes its `renomeando !== entrada`
      // exit instead of committing a name.
      renomeando = null;
      // A filter is a way of LOOKING at the list, not a setting on it, so it
      // goes when the list does. Kept across a close, the next open would show
      // a subset with no visible reason and read as fixed parts having
      // vanished.
      filtro = '';
      campoBusca.value = '';
      buscando = false;
    }

    function abrirPopover() {
      ouvirNaPropriaRaiz();
      pintarLista();
      popover.removeAttribute('hidden');
      ajustarAltura();
    }

    // The popover hangs off the strip, and how far down the page the strip
    // sits depends on how many condition bars are stacked above it — a stale
    // fixed part, a dead connection and a dead session can all be on screen at
    // once. A max-height written in CSS therefore runs off the bottom on
    // exactly the screens that have the most to say, taking the footer's two
    // controls with it. Measured on open instead.
    //
    // MEASURED AGAINST THE PANEL, NOT THE WINDOW, and that is the half that was
    // wrong. `.nfpr-registrar-page` is `overflow: hidden` and ajustarAltura
    // (painel.js) ends it above the government footer, so a popover sized to
    // the viewport is clipped by the panel with no scrollbar anywhere to say
    // so — and what is clipped is the last thing in the column, which is
    // exactly the footer.
    //
    // AND THERE IS NO FLOOR. A minimum taller than the room available is the
    // same clipping by another name: the head and the footer do not shrink, so
    // whatever does not fit is the footer again. The list is the only part that
    // gives (`min-height: 0`), down to a single row if that is all there is.
    // Instead of forcing a height, it OPENS UPWARDS when there is more room
    // above — over the 44 cells, which is where the room is whenever the strip
    // has been pushed down by bars.
    //
    // Guarded rather than assumed: the offline page, the government page and
    // the smoke harness all build this strip, and the last of them has neither
    // a layout nor a window to measure.
    var FOLGA = 14;

    function ajustarAltura() {
      var caixa = elemento.getBoundingClientRect ? elemento.getBoundingClientRect() : null;
      if (!caixa) return;

      var painel = elemento.closest ? elemento.closest('.nfpr-registrar-page') : null;
      var limite = painel && painel.getBoundingClientRect ? painel.getBoundingClientRect() : null;
      var topo = limite ? limite.top : 0;
      var base = limite ? limite.bottom : root.innerHeight || 0;
      if (!base) return;

      var abaixo = base - caixa.bottom - FOLGA;
      var acima = caixa.top - topo - FOLGA;
      var paraCima = acima > abaixo;
      var espaco = paraCima ? acima : abaixo;

      popover.classList.toggle('nfpr-partes-pop-acima', paraCima);
      popover.style.maxHeight = Math.min(520, Math.max(0, espaco)) + 'px';
    }

    // A measurement taken on open is stale the moment the window changes shape,
    // and this list is open for as long as someone is reading it. Re-measured
    // while it is up, and ignored otherwise.
    if (root.addEventListener) {
      root.addEventListener('resize', function () {
        if (!popover.hasAttribute('hidden')) ajustarAltura();
      });
    }

    function linhaOpcao(opcoes) {
      var radio = el('input', {
        type: 'radio',
        name: 'nfpr-strip-partes',
        class: 'nfpr-radio',
        checked: !!opcoes.ativa,
        onChange: opcoes.aoEscolher
      });
      return el(
        'div',
        {
          class:
            'nfpr-partes-item' +
            (opcoes.ativa ? ' nfpr-partes-item-ativo' : '') +
            (opcoes.fixa ? ' nfpr-partes-item-fixa' : ''),
          // The row shows the fixed part truncated to its last four groups;
          // hovering anywhere on it shows the whole thing. `''` rather than
          // undefined, which `el` would assign as the word "undefined".
          title: opcoes.titulo || '',
          // THE WHOLE ROW CHOOSES. The radio is a 14px dot beside a two-line
          // block, and the person aiming at it is the same occasional user the
          // row actions are spelled out in words for. The radio stays exactly
          // what it is — it keeps the keyboard and the group — and this is a
          // mouse target laid over it, which is why the row takes no
          // `tabindex`: a second stop in the tab order for a choice that
          // already has one is worse than none.
          onClick: function (e) {
            // Anything on this row with its own job keeps it. The radio fires
            // its own change (handling it here as well would activate twice),
            // and `Salvar`, `Renomear`, `Remover` and the rename field are on
            // the row precisely to do something other than choose it.
            var alvo = e && e.target && e.target.closest
              ? e.target.closest('button, input, a, label')
              : null;
            if (alvo) return;
            // Re-choosing what is already chosen is not a choice. The radio's
            // own change never fires for it, and going through anyway would
            // restamp `usadaEm` and reorder the list under a click that asked
            // for nothing to happen.
            if (opcoes.ativa) return;
            opcoes.aoEscolher();
          }
        },
        [
          radio,
          el('div', { class: 'nfpr-partes-item-main' }, opcoes.corpo),
          opcoes.acoes ? el('div', { class: 'nfpr-partes-item-acoes' }, opcoes.acoes) : null
        ]
      );
    }

    // CHOOSING A FIXED PART MOVES IT: the list is ordered by last use, so the
    // row just chosen becomes the first one. Scrolling home is what makes that
    // visible — chosen from the eighteenth row, the repaint would otherwise
    // leave the volunteer looking at whatever slid into the place they were,
    // with nothing on screen saying the click landed.
    //
    // Here rather than in `pintarLista`, which also runs for a filter keystroke
    // and for a rename: holding the volunteer's place is the right answer to
    // both of those, and only an activation reorders anything.
    function escolher(id) {
      listaCorpo.scrollTop = 0;
      if (acoes.aoAtivar) acoes.aoAtivar(id);
    }

    // Accent- and case-insensitive: someone typing "jose" has to find "José",
    // and someone typing "PADARIA" has to find "Padaria do Zé". A volunteer
    // hunting a fixed part is not going to spell it the way they saved it.
    function achatar(texto) {
      return String(texto || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    }

    // NAMES AND KEY CHARACTERS, because an unnamed fixed part has nothing but
    // its own characters — and the unnamed ones are exactly the tier that grows
    // on its own. They are matched against the raw template, so typing them
    // with or without the spaces the row prints them in works the same.
    //
    // UPPER-CASED BACK for that half: `achatar` lower-cases for the name match,
    // and a template is stored upper-case, so an issuer CNPJ's letters would
    // never match a search for them otherwise.
    function combina(m, termo) {
      var t = achatar(termo).trim();
      if (!t) return true;
      if (achatar(m.nome).indexOf(t) !== -1) return true;
      var chars = t.toUpperCase().replace(/[^0-9A-Z]/g, '');
      return !!chars && NFPR.ParteFixa.normalizar(m.template || '').indexOf(chars) !== -1;
    }

    function pintarLista() {
      // Any repaint throws away whatever row was being renamed, so the field
      // stops counting as open — otherwise its own blur would commit a name
      // into a row that no longer exists.
      renomeando = null;
      var total = estado.lista.length;

      if (total) subtitulo.setAttribute('hidden', 'hidden');
      else subtitulo.removeAttribute('hidden');

      // Both brooms answer to the WHOLE list, never to what the filter is
      // currently showing: they act on the whole list, and a filter is a way of
      // looking at it rather than a setting on it. Set before the empty-result
      // return below, or a search matching nothing would leave whichever of
      // them the last paint decided on.
      //
      // `Config.parteFixaSalva` is the one definition of the tier and is asked
      // rather than re-derived here; the stale half reads the row's own
      // `vencida`, set beside the sentence it belongs to. NOT `problema`: a
      // fixed part can be marked for a verdict that is not staleness at all,
      // and this button is named for one of the two.
      var mostrar = function (botao, sim) {
        if (sim) botao.removeAttribute('hidden');
        else botao.setAttribute('hidden', 'hidden');
      };
      mostrar(limparNaoSalvas, estado.lista.some(function (m) {
        return !NFPR.Config.parteFixaSalva(m);
      }));
      mostrar(limparVencidas, estado.lista.some(function (m) {
        return !!m.vencida;
      }));

      // The placeholder does double duty: it says what the field is for AND
      // how many fixed parts are behind it, which is the one number that tells
      // a volunteer whether scrolling or typing is the shorter route.
      if (total > LIMITE_SEM_FILTRO) {
        campoBusca.placeholder = 'Procurar entre ' + total + ' partes fixas';
        busca.removeAttribute('hidden');
      } else {
        // The list shrank back under the threshold (a removal, or "Limpar as
        // não salvas"). Hiding a field that still holds a term would leave the
        // rows filtered by something invisible.
        busca.setAttribute('hidden', 'hidden');
        filtro = '';
        campoBusca.value = '';
      }

      listaCorpo.replaceChildren();
      // "Chave inteira" is not a fixed part: it is the radio group's zero state
      // and the destination of the commonest correction there is, so it is
      // pinned to the top of the scroll rather than riding it, and no filter
      // ever takes it away.
      listaCorpo.appendChild(
        linhaOpcao({
          fixa: true,
          ativa: !estado.ativaId,
          corpo: [el('span', { class: 'nfpr-partes-item-nome', text: 'Chave inteira — 44 números' })],
          aoEscolher: function () {
            escolher(null);
          }
        })
      );

      var visiveis = estado.lista.filter(function (m) {
        return combina(m, filtro);
      });
      if (!visiveis.length) {
        // Two different nothings, and they need different sentences: an install
        // with no fixed parts at all, and a search that matched none. The way
        // out of both is the same button, pinned in the footer below.
        listaCorpo.appendChild(
          el('p', {
            class: 'nfpr-partes-vazio',
            text: total
              ? 'Nenhuma parte fixa com “' + filtro.trim() + '”.'
              : 'Nenhuma parte fixa cadastrada.'
          })
        );
        return;
      }

      visiveis.forEach(function (m) {
        var temNome = !!(m.nome || '').trim();
        var nomeEl = el('span', { class: 'nfpr-partes-item-nome', text: m.rotulo });
        var linhaNome = el('div', { class: 'nfpr-partes-item-linha' }, [nomeEl]);
        // NAMING IS SAVING, so one button is the whole two-tier model. It says
        // `Salvar` on a fixed part that is still a recent and `Renomear` on one
        // that is already kept — the same field either way, and clearing the
        // name in it is how a saved fixed part is let go. There is no ★: a
        // glyph that only pinned, next to a name that only labelled, was two
        // gestures for one intention, and it could leave a pinned fixed part
        // with nothing to call it.
        var renomear = el('button', {
          class: 'nfpr-btn nfpr-btn-ghost nfpr-btn-sm',
          type: 'button',
          text: temNome ? 'Renomear' : 'Salvar',
          onClick: function () {
            // Inline, in place, at any time. A blank name is a first-class
            // state, so the placeholder is the fixed part's OWN DIGITS rather
            // than a made-up default.
            var entrada = el('input', {
              class: 'nfpr-input nfpr-input-sm',
              type: 'text',
              value: m.nome || '',
              maxLength: 60,
              placeholder: m.texto
            });
            // Commit once, whichever way the field is left: Enter and the blur
            // that follows it are the same gesture, and a repaint (or Escape)
            // has already dropped `renomeando`, so a late blur cannot write a
            // name the volunteer cancelled.
            function confirmar() {
              if (renomeando !== entrada) return;
              renomeando = null;
              if (acoes.aoRenomear) acoes.aoRenomear(m.id, entrada.value);
            }
            entrada.addEventListener('keydown', function (e) {
              if (e.key === 'Enter') {
                e.preventDefault();
                confirmar();
              } else if (e.key === 'Escape') {
                // Cancels the rename and nothing more: stopped here, or the
                // list's own Escape would close the whole popover behind it.
                e.preventDefault();
                e.stopPropagation();
                pintarLista();
              }
            });
            entrada.addEventListener('blur', confirmar);
            // Capture is a DOCUMENT-level listener and cannot see into a closed
            // shadow root, so it would swallow every digit, Backspace, Enter and
            // Esc typed in here — Enter would submit a key instead of naming a
            // fixed part. `editando()` is the seam that already holds it off
            // for the fixed part editor; this field claims the same cover.
            renomeando = entrada;
            linhaNome.replaceChildren(entrada);
            entrada.focus();
            entrada.select();
          }
        });
        // `nfpr-btn-perigo` is what buys the danger colour, and it is carried
        // by the one button on this row that destroys anything. It used to come
        // free with `nfpr-btn-sm`, which meant `Salvar` and `Renomear` wore it
        // too — red on the gesture that KEEPS a fixed part.
        var remover = el('button', {
          class: 'nfpr-btn nfpr-btn-ghost nfpr-btn-sm nfpr-btn-perigo',
          type: 'button',
          text: 'Remover',
          onClick: function () {
            if (acoes.aoRemover) acoes.aoRemover(m.id);
          }
        });
        listaCorpo.appendChild(
          linhaOpcao({
            ativa: m.id === estado.ativaId,
            titulo: m.textoCompleto,
            corpo: [
              linhaNome,
              // THE DIGITS APPEAR ONCE. An unnamed fixed part already shows
              // them where a name would go — that is what makes a blank name a
              // first-class state rather than a missing value — so repeating
              // them underneath cost the tier that grows on its own a whole
              // extra line each, on the list that had run out of room. A named
              // one shows them on a line of their own, as many groups as fit.
              temNome
                ? el('span', { class: 'nfpr-partes-item-digitos nfpr-mono', text: m.textoLongo })
                : null,
              el('span', {
                class: 'nfpr-partes-item-sub',
                text: 'você digita ' + m.variaveis + (m.valeAte ? ' · ' + m.valeAte : '')
              }),
              // ONE TIME-LINE AT A TIME: the compact "vale até" clause above
              // while the fixed part is good, and this instead once it is not.
              m.problema
                ? el('span', { class: 'nfpr-partes-item-sub nfpr-partes-item-alerta', text: m.problema })
                : null
            ],
            acoes: [renomear, remover],
            aoEscolher: function () {
              escolher(m.id);
            }
          })
        );
      });
    }

    // ---- The one status line --------------------------------------------------
    // Four sources, one element, a fixed priority. Holding them apart in here
    // is what stops a live verdict and the resting bypass notice fighting over
    // the same line: whichever is highest priority right now is what shows, and
    // the notice coming back when a verdict clears is correct.
    //
    // `dica` is last, and it is the one source that speaks while the strip
    // above it is HIDDEN — the offer of fixed parts to somebody who is typing
    // by hand and has never been told they exist. Last because everything else
    // here is about the note being entered right now, and a suggestion may
    // never take that line away from a verdict.
    var fontes = { editor: null, veredito: null, repouso: null, dica: null };
    var statusTexto = el('span', { class: 'nfpr-strip-status-msg' });
    var statusAcao = el('button', {
      class: 'nfpr-strip-status-acao',
      type: 'button',
      attrs: { hidden: 'hidden' },
      onClick: function () {
        if (acaoStatus) acaoStatus();
      }
    });
    var acaoStatus = null;
    // THE QUIET SECOND BUTTON, and only `dica` ever fills it. A verdict is not
    // dismissible — it is repainted from what is in the buffer — but an offer
    // has to be refusable, or it is furniture that fires for the rest of the
    // volunteer's life on a machine they share.
    var statusDispensar = el('button', {
      class: 'nfpr-strip-status-acao nfpr-strip-status-dispensar',
      type: 'button',
      attrs: { hidden: 'hidden' },
      onClick: function () {
        if (dispensarStatus) dispensarStatus();
      }
    });
    var dispensarStatus = null;
    var status = el(
      'p',
      { class: 'nfpr-strip-status', attrs: { hidden: 'hidden' } },
      [statusTexto, statusAcao, statusDispensar]
    );

    function definirStatus(fonte, info) {
      fontes[fonte] = info || null;
      pintarStatus();
    }

    function pintarStatus() {
      var info = fontes.editor || fontes.veredito || fontes.repouso || fontes.dica;
      if (!info) {
        esconder(status);
        return;
      }
      statusTexto.textContent = info.texto || '';
      status.className =
        'nfpr-strip-status' + (info.erro ? ' nfpr-strip-status-err' : info.aviso ? ' nfpr-strip-status-aviso' : '');
      acaoStatus = info.aoClicar || null;
      if (info.rotulo && acaoStatus) {
        statusAcao.textContent = info.rotulo;
        statusAcao.removeAttribute('hidden');
      } else {
        esconder(statusAcao);
      }
      dispensarStatus = info.aoDispensar || null;
      if (info.rotuloDispensar && dispensarStatus) {
        statusDispensar.textContent = info.rotuloDispensar;
        statusDispensar.removeAttribute('hidden');
      } else {
        esconder(statusDispensar);
      }
      status.removeAttribute('hidden');
    }

    // ---- Painting the resting strip -------------------------------------------
    // WITH NO FIXED PART THE LABEL IS AN INVITATION, not a status. It used to
    // read "Chave inteira — 44 números", which is true, correct and answers a
    // question nobody had: with nothing armed there is nothing to be warned
    // about, and the one thing worth saying in that space is that the line can
    // be clicked at all. It carries the `+` the popover's own footer uses, and
    // it says what the volunteer DOES — fix the start of the key — in words
    // about the receipt; see *Words for the fixed part* in CLAUDE.md before
    // rewording anything here.
    //
    // With a fixed part armed it goes back to being a status, because then
    // there IS something to know: which fixed part, and how many digits it
    // leaves.
    function pintarRotulo() {
      var comParteFixa = !!estado.rotulo;
      rotuloTexto.textContent = comParteFixa
        ? estado.rotulo + ' — só ' + estado.variaveis + ' números por nota'
        : '+ Fixar o começo da chave';
      rotuloBtn.className = 'nfpr-strip-rotulo' + (comParteFixa ? '' : ' nfpr-strip-rotulo-convite');
      if (comParteFixa) limparParteFixa.removeAttribute('hidden');
      else esconder(limparParteFixa);
    }

    // ONLY UNDER A FIXED PART. Without one the 44 cells already show how far
    // the entry has got, so "12 de 44" repeated what is on screen beside it;
    // the count is worth its pill only when it counts the digits a fixed part
    // leaves. Same test as pintarRotulo, so the two cannot disagree.
    function pintarProgresso() {
      if (!digitados || !estado.rotulo) {
        progresso.textContent = '';
        progresso.className = 'nfpr-strip-progresso';
        return;
      }
      progresso.textContent = digitados + ' de ' + estado.variaveis;
      progresso.className = 'nfpr-strip-progresso nfpr-strip-progresso-visivel';
    }

    var elemento = el('div', { class: 'nfpr-strip' }, [linhaRepouso, linhaEditor, popover]);

    // Clicking anywhere else closes the list. TWO listeners, and the split is
    // forced by the CLOSED shadow root this lives in: `composedPath()` is
    // trimmed at the HOST for a listener registered on the document, so from out
    // there a click on the popover's own `Renomear` is indistinguishable from a
    // click on the government page. This ran in the capture phase, so the list
    // closed before the button's own handler ever ran — the handler then swapped
    // the name for a field inside a popover that was already hidden, and
    // renaming did nothing at all, silently.
    //
    // A listener registered INSIDE the tree gets the real path, so it is the one
    // that decides about clicks that entered it; the document one only handles
    // the clicks that never did.
    function fecharSeForFora(e) {
      if (popover.hasAttribute('hidden')) return;
      var caminho = e.composedPath ? e.composedPath() : [];
      if (caminho.indexOf(popover) === -1 && caminho.indexOf(abrirLista) === -1) fecharPopover();
    }

    // The strip is built before it is mounted, so the root it will live in is
    // only knowable by the time the list can be opened at all. A root of
    // `document` means no shadow root at all, and there the document listener
    // already sees the whole path — a second one would only duplicate it.
    var raizOuvida = null;
    function ouvirNaPropriaRaiz() {
      var raiz = elemento.getRootNode ? elemento.getRootNode() : document;
      if (!raiz || raiz === document || raiz === raizOuvida || !raiz.addEventListener) return;
      raizOuvida = raiz;
      raiz.addEventListener('click', fecharSeForFora, true);
    }

    document.addEventListener(
      'click',
      function (e) {
        if (raizOuvida && raizOuvida.host) {
          var caminho = e.composedPath ? e.composedPath() : [];
          // Came out of our own tree: the listener inside it is the only one
          // that can see WHERE, and it has already decided.
          if (caminho.indexOf(raizOuvida.host) !== -1) return;
        }
        fecharSeForFora(e);
      },
      true
    );

    pintarRotulo();

    return {
      elemento: elemento,
      status: status,
      api: {
        /**
         * setPartesFixas(estadoNovo, handlers)
         *
         * The whole fixed part world in one handoff, exactly as
         * setParteFixaVencida takes its own action: this file reads no storage,
         * and the module that knows how to write one (registrador.js, shared by
         * both registrars) only ever sees an already-mounted UI.
         */
        setPartesFixas: function (novo, handlers) {
          estado = Object.assign(estado, novo || {});
          if (handlers) acoes = handlers;
          pintarRotulo();
          if (editando) pintarLegenda();
          pintarProgresso();
          if (!popover.hasAttribute('hidden')) pintarLista();
        },
        setProgresso: function (n) {
          digitados = n || 0;
          pintarProgresso();
        },
        setStatusVeredito: function (info) {
          definirStatus('veredito', info);
        },
        setStatusRepouso: function (info) {
          definirStatus('repouso', info);
        },
        /**
         * The offer of fixed parts to someone typing by hand, shown while the
         * strip itself is hidden. Lowest priority of the four, and the only one
         * that takes a second, dismissing button.
         */
        setStatusDica: function (info) {
          definirStatus('dica', info);
        },
        /**
         * Show or hide the whole strip — the preference in config.js, on by
         * default; a volunteer with a scanner never types a digit and may
         * switch it off.
         *
         * Hiding it has to take its two open states with it. The editor and
         * the rename field both claim `editando()`, which stands capture down;
         * hidden while one of them was open, the strip would keep that claim
         * for ever behind an element nobody can see, and the entry would
         * silently stop accepting keys. The status line is NOT hidden with it:
         * it carries the live verdict and the offer above, neither of which is
         * about fixed parts being on.
         *
         * WHERE THE KEYBOARD GOES. Only somewhere if it was IN here — a field
         * or a button that is about to vanish would otherwise leave it on
         * nothing — and then back to the entry, through the same handler the
         * editor's own close uses. That handler declines while the settings
         * overlay is up, which is exactly when this usually runs: the switch
         * lives in Preferências, and the volunteer who just flipped it is still
         * in that form. Asked before anything closes, because closing is what
         * moves the focus.
         */
        setVisivel: function (visivel) {
          if (visivel) {
            elemento.removeAttribute('hidden');
            return;
          }
          var tinhaFoco = focoDentro();
          if (editando) fecharEditor(); // hands the keyboard back itself
          else if (tinhaFoco && acoes.aoFecharEditor) acoes.aoFecharEditor();
          fecharPopover();
          elemento.setAttribute('hidden', 'hidden');
        },
        /**
         * The keyboard back into the editor's field, if the editor is open —
         * and whether it went there. The settings overlay closes by handing
         * focus to the entry, and the editor survives the overlay opening over
         * it: without this the field was still open, still claiming
         * `editando()` so capture stood down, and the keyboard was on the entry
         * box behind it, where nothing typed went anywhere.
         */
        retomarFoco: function () {
          if (!editando) return false;
          campo.focus();
          return true;
        },
        fecharPopover: fecharPopover,
        // The stale-fixed-part bar's primary action: a fixed part whose month
        // has passed usually needs two digits changed, not throwing away.
        abrirEditor: function () {
          abrirEditor(false);
        },
        /**
         * True while a text field of ours is open, so capture can stay out of
         * it. The fixed part editor is one; the list's rename field is the
         * other, and it needs this just as badly — capture would otherwise take
         * its digits and submit its Enter as a key.
         */
        editando: function () {
          // Three text fields of ours can hold the keyboard: the fixed part
          // editor, a row's rename field, and the filter. All three sit inside
          // a closed shadow root that document-level capture cannot see into,
          // so each one has to claim this cover or capture takes its digits and
          // reads its Enter as the end of a key.
          return editando || !!renomeando || buscando;
        }
      }
    };
  }

  NFPR.StripParteFixa = { criar: criar, LIMITE_SEM_FILTRO: LIMITE_SEM_FILTRO };
})(typeof globalThis !== 'undefined' ? globalThis : self);
