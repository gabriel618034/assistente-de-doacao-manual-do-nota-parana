/**
 * modal.js  (content + offline page)
 * -----------------------------------------------------------------------------
 * The overlay: a settings dialog with HELP, ERROS DESCONHECIDOS — and, while
 * debug-ui.js is loaded, DEPURAÇÃO — as pushed pages behind a back button, plus
 * the scan flash and the floating toast. It lives in its own Shadow DOM, fixed
 * over the whole viewport and click-through except for the open dialog itself.
 *
 * NFPR.Modal.criar(opcoes) -> { elementos, api }
 *   elementos            [backdrop, modal, flash, toast], for the caller's root
 *   opcoes.modoOffline   hides the "search entity on the site" button, which
 *                        needs a live host page
 *   opcoes.hospedeiro    the shadow host element, which carries `nfpr-open`
 *   opcoes.aoFechar      called after closing, so the caller can hand focus
 *                        back to the registrar
 *   opcoes.mostrarErro   the registrar's inline toast, for the one error this
 *                        file relays (NFPR.BuscaSite's, below)
 *   opcoes.listarFalhas  () -> [{ chave, mensagem }] — the notes whose answer
 *                        this extension could not read. Pulled from the panel
 *                        on every open rather than pushed, because the panel
 *                        owns that list and this file keeps no state it did not
 *                        build
 *
 * This file RENDERS. It makes no request and reads no storage — SettingsUI
 * owns everything behind the config page.
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  var NFPR = (root.NFPR = root.NFPR || {});
  var el = NFPR.el; // shared DOM builder (src/shared/dom.js)

  var agruparChave = NFPR.agruparChave; // 44 digits, spaced in fours (dom.js)

  // The back arrow every pushed page carries. Trusted static markup.
  var SETA_VOLTAR =
    '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M14 6 8 12l6 6 1.4-1.4L10.8 12l4.6-4.6Z"/></svg>';

  function criar(opcoes) {
    opcoes = opcoes || {};
    var aberto = false;
    var flashAtivo = true;

    // One per pushed page, kept by name because arriving on a page puts the
    // keyboard on its way back (see irPara below).
    function botaoVoltar() {
      return el('button', {
        class: 'nfpr-back',
        type: 'button',
        html: SETA_VOLTAR,
        attrs: { title: 'Voltar para configurações' },
        onClick: function () {
          irPara(viewConfig);
        }
      });
    }
    var voltarAjuda = botaoVoltar();
    var voltarFalhas = botaoVoltar();
    var voltarDepuracao = botaoVoltar();


    // Config page (shared SettingsUI). `abrirBuscaSite` opens the page's own
    // entity-search modal — we must close OUR modal first or the site's modal
    // is trapped behind our backdrop. Only the live page can provide this
    // callback; offline (and in the popup) SettingsUI simply never renders the
    // site-search button, which is clearer than a runtime "not available" error.
    //
    // Everything about that dialog — finding it, showing it, and getting out of
    // the lock the site's own search falls into on a dead session — belongs to
    // NFPR.BuscaSite in modal-entidade.js, which owns the government markup.
    // This file renders, so it hands over the click and its toast and knows
    // nothing else about it.
    //
    // SettingsUI.montar puts .nfpr-settings on WHATEVER CONTAINER IT IS HANDED,
    // and .nfpr-settings declares `display: flex`. Hand it the view itself and
    // that collides with `.nfpr-view { display: none }` at equal specificity
    // (both single-class), so load order decides — ui.js fetches settings.css
    // after modal.css, settings.css wins, and the config page is permanently
    // visible. .nfpr-views is a row flexbox, so Ajuda and Depuracao then opened
    // BESIDE the config form instead of over it.
    //
    // So the form gets its own box and the view keeps sole control of `display`,
    // as viewDepuracao does further down. Do not reach for
    // !important here: the bug is two files deciding one element's `display`,
    // and an override leaves that true.
    var viewConfig = el('div', { class: 'nfpr-view nfpr-view-on nfpr-view-config' });
    var caixaConfig = el('div', { class: 'nfpr-view-corpo' });
    viewConfig.appendChild(caixaConfig);
    NFPR.SettingsUI.montar(
      caixaConfig,
      opcoes.modoOffline
        ? {}
        : {
            // THE KEYBOARD GOES TO THE SITE'S DIALOG, NOT BACK TO US. Closing
            // normally hands focus to the registrar's entry, and here that
            // landed a moment after the site's dialog appeared: anything typed
            // into what looked like their search form went into our key
            // buffer instead. BuscaSite puts the focus in their form once it
            // is on screen; if it never gets there, the entry gets it back.
            abrirBuscaSite: function () {
              fechar({ semDevolverFoco: true });
              NFPR.BuscaSite.abrir({
                aoFalhar: function (msg) {
                  opcoes.mostrarErro(msg);
                  if (opcoes.aoFechar) opcoes.aoFechar();
                }
              });
            }
          }
    );

    // Help page (separate pushed page with a Back button).
    // The copy is DATA, not code: editing a sentence should not mean editing
    // control flow. `html` is trusted static markup only (<b> and the coloured
    // dots), per the rule in dom.js.
    var AJUDA = [
      {
        titulo: 'Como registrar',
        paragrafo:
          'Com a página aberta, basta <b>escanear o código de barras</b> ou o <b>QR code</b> da nota. Não é preciso clicar em nada antes: o leitor envia a chave ao concluir a leitura. Para digitar, informe a <b>chave inteira</b> e pressione <b>Enter</b>. Vale para <b>NF-e</b> e <b>NFC-e</b>.'
      },
      {
        titulo: 'O que as cores significam',
        itens: [
          '<span class="nfpr-dot nfpr-dot-fila"></span> Azul: em envio.',
          '<span class="nfpr-dot nfpr-dot-ok"></span> Verde: o Nota Paraná registrou a doação.',
          '<span class="nfpr-dot nfpr-dot-aguardando"></span> Laranja: a nota está guardada e ainda não foi enviada, ou é repetida. A mensagem ao lado indica o motivo.',
          '<span class="nfpr-dot nfpr-dot-cinza"></span> Cinza: a nota é válida, mas não pode ser doada — por exemplo, se for de outro estado, estiver fora do prazo ou não for NF-e nem NFC-e.',
          '<span class="nfpr-dot nfpr-dot-erro"></span> Vermelho: a nota não foi registrada. A mensagem ao lado explica o ocorrido.'
        ]
      },
      {
        titulo: 'Teclas',
        itens: [
          '<b>Enter</b> ou <b>Tab</b>: envia a chave.',
          '<b>Backspace</b>: apaga o último número.',
          '<b>Esc</b>: limpa o quadro da chave.',
          '<b>Esc</b>, com esta janela aberta: fecha a janela.'
        ]
      },
      {
        titulo: 'Parte fixa da chave',
        paragrafo:
          'Para quem digita as chaves. Ative a opção <b>Parte fixa da chave</b> em <b>Preferências</b>: uma linha aparecerá logo abaixo do quadro da chave. Quando muitas notas começam com os mesmos números, clique nessa linha e escreva uma única vez a parte que se repete. A partir daí, em cada nota, você digita o restante. Se houver números repetidos mais adiante, escreva ? no lugar dos que variam (a barra de espaço também insere o ?).'
      }
    ];

    var viewAjuda = el('div', { class: 'nfpr-view nfpr-view-ajuda' }, [
      el('div', { class: 'nfpr-page-head' }, [
        voltarAjuda,
        el('span', { class: 'nfpr-page-title', text: 'Ajuda' })
      ])
    ]);
    AJUDA.forEach(function (secao) {
      viewAjuda.appendChild(
        el('div', { class: 'nfpr-ajuda-card' }, [
          el('h3', { text: secao.titulo }),
          secao.paragrafo ? el('p', { html: secao.paragrafo }) : null,
          secao.itens
            ? el(
                'ul',
                {},
                secao.itens.map(function (i) {
                  return el('li', { html: i });
                })
              )
            : null
        ])
      );
    });

    // Erros desconhecidos — the notes the server rejected without a reason.
    //
    // NAMED FOR WHAT IS ACTUALLY MISSING. It was "Notas sem resposta clara" for
    // a draft, which is wrong: the answer was perfectly clear about the
    // OUTCOME — anything that is not 200 OK + "sucesso" means the donation was
    // not made — and what it withheld was the REASON. Getting that backwards in
    // a title is how a volunteer ends up believing the note might have gone
    // through.
    //
    // NOT every note that went red: only the ones this extension could not
    // explain (see the block in painel.js). A red row that names its reason has
    // already helped; these are the ones where it did not, so the volunteer is
    // the only one left who can act — and they need the digits to find the
    // paper.
    //
    // A pushed page like the two around it, and like Depuração it is NOT
    // reachable from the modal header — but for the opposite reason. Depuração
    // is hidden because a volunteer must not wander into it; this one is hidden
    // because until something slips through there is nothing here, and a
    // permanent door to an empty page teaches people to stop opening it. The
    // registrar's red bar is the only way in, and it exists only while the list
    // does.
    //
    // REBUILT ON EVERY OPEN rather than kept in sync. The panel owns the list —
    // it is the surface that sees a note reach `erro` — and a second copy here
    // would be a second thing to keep right. Opening the page is rare and the
    // list is short, so pulling it is free.
    var listarFalhas = opcoes.listarFalhas || function () {
      return [];
    };
    // Emptying the record deliberately. Entries otherwise leave only when their
    // key registers on a later attempt, or when they fall off the 100 cap — so
    // a note the volunteer is never going to rescan kept the red bar on screen
    // for the rest of the install. A bar that can never be answered stops being
    // read, and then it is not doing the one job it has.
    //
    // IT LIVES IN HERE, NOT ON THE BAR, and that is the whole design. The bar
    // still has no ✕: it is a condition, and a count that can be waved away
    // without looking is a count nobody looks at. Reaching this button means
    // the volunteer opened the page and saw the digits first.
    //
    // TWO STEPS, because it is genuinely destructive — these notes already left
    // nfpr:fila, so this record is the only trace of them and nothing anywhere
    // will mention them again. One misclick would be unrecoverable. No native
    // confirm(): forbidden everywhere in this extension.
    var limparFalhas = opcoes.aoLimparFalhas || function () {
      return Promise.resolve([]);
    };
    //
    // The keyboard follows the two steps: each one hides the button that was
    // just pressed, so it would otherwise be left on nothing. It lands on
    // Cancelar rather than Apagar — the safe answer is the one an Enter pressed
    // twice by habit reaches.
    var btnLimpar = el('button', {
      class: 'nfpr-btn nfpr-btn-ghost nfpr-btn-perigo',
      type: 'button',
      text: 'Limpar a lista',
      onClick: function () {
        confirmarLimpeza.removeAttribute('hidden');
        btnLimpar.setAttribute('hidden', 'hidden');
        btnCancelarLimpeza.focus();
      }
    });
    var textoConfirma = el('span', { class: 'nfpr-falhas-confirma-texto' });
    var btnCancelarLimpeza = el('button', {
      class: 'nfpr-btn nfpr-btn-ghost',
      type: 'button',
      text: 'Cancelar',
      onClick: function () {
        esconderConfirmacao();
        btnLimpar.focus();
      }
    });
    var confirmarLimpeza = el(
      'div',
      { class: 'nfpr-falhas-confirma', attrs: { hidden: 'hidden' } },
      [
        textoConfirma,
        el('div', { class: 'nfpr-falhas-confirma-acoes' }, [
          btnCancelarLimpeza,
          el('button', {
            class: 'nfpr-btn nfpr-btn-perigo',
            type: 'button',
            text: 'Apagar',
            onClick: function () {
              Promise.resolve(limparFalhas()).then(function () {
                // The bar was the only door to this page, and it is gone now, so
                // an emptied page would be a state its own contract says cannot
                // happen. Go back rather than invent an empty state for it.
                esconderConfirmacao();
                irPara(viewConfig);
              });
            }
          })
        ])
      ]
    );
    function esconderConfirmacao() {
      confirmarLimpeza.setAttribute('hidden', 'hidden');
      btnLimpar.removeAttribute('hidden');
    }
    var rodapeFalhas = el('div', { class: 'nfpr-falhas-rodape' }, [btnLimpar, confirmarLimpeza]);

    var caixaFalhas = el('div', { class: 'nfpr-view-corpo' });
    var viewFalhas = el('div', { class: 'nfpr-view nfpr-view-falhas' }, [
      el('div', { class: 'nfpr-page-head' }, [
        voltarFalhas,
        el('span', { class: 'nfpr-page-title', text: 'Erros desconhecidos' })
      ]),
      caixaFalhas
    ]);
    caixaFalhas.appendChild(rodapeFalhas);

    // The moment the volunteer entered the key, to the second. Carried from
    // nfpr:fila rather than stamped when the note failed, so a batch scanned on
    // Friday and drained on Monday still says Friday — the only thing that
    // places it in the volunteer's own day. Null on entries written before the
    // field existed, and then simply omitted.
    function momento(em) {
      if (!em) return '';
      try {
        return new Date(em).toLocaleString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
      } catch (e) {
        return '';
      }
    }

    function pintarFalhas() {
      var lista = listarFalhas();
      // The footer is rebuilt into place after the cards on every open, since
      // replaceChildren clears it with them. Reset to the un-confirmed state
      // too: a half-open confirmation left over from last time would greet the
      // volunteer with "Apagar" already showing.
      caixaFalhas.replaceChildren();
      esconderConfirmacao();
      textoConfirma.textContent =
        lista.length === 1
          ? 'Apagar esta nota da lista? Ela não consta em nenhum outro lugar, e esta ação não pode ser desfeita.'
          : 'Apagar as ' + lista.length + ' notas desta lista? Elas não constam em nenhum ' +
            'outro lugar, e esta ação não pode ser desfeita.';
      // No empty state: the bar is the only door and it is hidden when the list
      // is empty, so an "everything is fine" message here could only ever be
      // shown to someone who did not ask a question.
      caixaFalhas.appendChild(
        el('p', {
          class: 'nfpr-falhas-intro',
          // TWO SENTENCES DO ALL THE WORK HERE.
          //
          // "nenhum erro foi detectado" leads, because every note on this page
          // passed the whole verdict table — it could not have been sent
          // otherwise — so the volunteer did nothing wrong. The reaction that
          // loses the donation is assuming they mistyped it and binning the
          // receipt.
          //
          // "não foram doadas" is flat, not hedged, and it comes BEFORE the
          // uncertainty. Only 200 OK with "sucesso" files a donation, so the
          // outcome here is certain; the missing half is the REASON. An earlier
          // draft said it was impossible to know whether they registered, which
          // is false and wrong in the expensive direction.
          //
          // EVERY SENTENCE HERE IS A REPORT, NEVER AN INSTRUCTION ABOUT PAPER.
          // What happened to each note, what our own checks said, and what this
          // extension will do if a key is scanned again — all ours to state.
          // What the volunteer should do with the printed receipts is the
          // charity's business and not ours; a draft of this paragraph told
          // them to set the papers aside instead of discarding them, which is
          // precisely the line not to cross.
          //
          // "nenhum erro foi detectado" IS A CLAIM WITH A PRECONDITION, and the
          // "enviar sem validar" preference is the one thing that can break it.
          // A bypassed note reached the POST without passing anything, so
          // telling its volunteer the numbers were right could send them back
          // to a receipt they really did mistype — or, worse, stop them
          // checking. The sentence is therefore dropped as soon as ONE entry on
          // the page was bypassed, and the cards below say which. Blanket
          // rewording would have been the easier fix and the wrong one: it
          // would cost every ordinary entry the reassurance that is the entire
          // reason this page leads with it.
          text: lista.some(function (f) { return f.semValidacao; })
            ? 'Estas notas não foram doadas: o site do Nota Paraná recusou o registro.'
            : 'Estas notas não foram doadas. Elas passaram por todas as verificações do ' +
              'assistente e nenhum erro foi detectado, mas o site do Nota Paraná recusou ' +
              'o registro.'
        })
      );
      lista.forEach(function (f) {
        var quando = momento(f.em);
        caixaFalhas.appendChild(
          el('div', { class: 'nfpr-falha-card' }, [
            // The digits identify the note, so they lead; the time says when it
            // was entered. Everything here goes through `text:` — the key came
            // off a scanner and the message is usually the site's own sentence.
            el('span', { class: 'nfpr-falha-chave nfpr-mono', text: agruparChave(f.chave) }),
            quando ? el('span', { class: 'nfpr-falha-em', text: 'Lida em ' + quando }) : null,
            // The one card that cannot borrow the intro's reassurance, carrying
            // the reading it was sent past. Its own line rather than a prefix on
            // the server's sentence, because the two came from opposite sides.
            f.semValidacao
              ? el('span', {
                  class: 'nfpr-falha-sem-validacao',
                  text: 'Enviada sem verificação — ' + f.semValidacao
                })
              : null,
            el('span', { class: 'nfpr-falha-msg', text: f.mensagem || '' })
          ])
        );
      });
      caixaFalhas.appendChild(rodapeFalhas);
    }

    // Debug page — a third pushed page. Deliberately NOT reachable from the
    // header: the only way in is the "Cuidado!" link in the red banner, which exists only while the mode is already armed. So a
    // volunteer cannot stumble into it, and someone who armed it by accident
    // has the way out one click from the warning.
    var caixaDepuracao = el('div', { class: 'nfpr-view-corpo' });
    var viewDepuracao = el('div', { class: 'nfpr-view nfpr-view-depuracao' }, [
      el('div', { class: 'nfpr-page-head' }, [
        voltarDepuracao,
        el('span', { class: 'nfpr-page-title', text: 'Depuração' })
      ]),
      caixaDepuracao
    ]);
    var depuracao = NFPR.DebugUI.montar(caixaDepuracao);

    var views = el('div', { class: 'nfpr-views' }, [viewConfig, viewAjuda, viewFalhas, viewDepuracao]);

    // Header (brand + Help button + Close). No tab bar anymore.
    var btnAjuda = el('button', {
      class: 'nfpr-help-btn',
      type: 'button',
      text: 'Ajuda',
      onClick: function () {
        irPara(viewAjuda);
      }
    });
    var btnFechar = el('button', {
      class: 'nfpr-close',
      type: 'button',
      attrs: { title: 'Fechar' },
      html:
        '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6Z"/></svg>',
      onClick: function () {
        fechar();
      }
    });
    var header = el('div', { class: 'nfpr-modal-head' }, [
      el('div', { class: 'nfpr-brand' }, [
        NFPR.iconeMarca('nfpr-brand-icon'),
        el('span', { class: 'nfpr-brand-title', text: 'Assistente de Doação Manual' })
      ]),
      el('span', { class: 'nfpr-spacer' }),
      btnAjuda,
      btnFechar
    ]);

    // `tabindex="-1"`: focusable by script and never by Tab. Opening puts the
    // keyboard HERE, on the dialog itself, so the first Tab lands on the first
    // control and nothing is pressed by an Enter that was meant for something
    // else.
    var modal = el('div', { class: 'nfpr-modal', attrs: { tabindex: '-1' } }, [header, views]);
    var backdrop = el('div', {
      class: 'nfpr-backdrop',
      onClick: function () {
        fechar();
      }
    });
    var flashEl = el('div', { class: 'nfpr-flash' });

    // Floating toast. Lives in the OVERLAY shadow, not the registrar's, because
    // its job is to confirm a save made from the SITE's own entity dialog —
    // which is a light-DOM modal covering the page. The overlay host is fixed
    // at z-index 2147483000 (base.css, !important because the host's inline
    // `all: initial` beats a normal :host rule), so this clears it; the
    // registrar's own toast is positioned inside the registrar panel and would
    // be hidden behind it.
    // (It replaces a hand-rolled copy in modal-entidade.js that built the same
    // widget in the light DOM with a 20-line inline style string.)
    var toastFlutuante = el('div', {
      class: 'nfpr-toast-flutuante',
      attrs: { hidden: 'hidden' }
    });
    var toastFlutTimer = null;
    function mostrarToast(mensagem, tipo) {
      clearTimeout(toastFlutTimer);
      toastFlutuante.textContent = mensagem;
      toastFlutuante.className =
        'nfpr-toast-flutuante nfpr-toast-flutuante-' + (tipo === 'err' ? 'err' : 'ok');
      toastFlutuante.removeAttribute('hidden');
      toastFlutTimer = setTimeout(function () {
        toastFlutuante.setAttribute('hidden', 'hidden');
      }, 3000);
    }


    // ---- The keyboard ----------------------------------------------------------
    // EVERYTHING HERE HAS TO BE REACHABLE WITHOUT A MOUSE. This is not a
    // keyboard-first design and does not pretend to be one — but a mouse that
    // breaks in the middle of a sitting must not end the sitting, so every
    // control can be reached and worked with enough keystrokes, and the
    // keyboard is never left somewhere the volunteer cannot see.
    //
    // THE KEYBOARD STAYS INSIDE WHILE THIS IS OPEN. Without it Tab walked off
    // the last control into the government page behind the backdrop, where
    // Enter and Space still work on things nobody can see.
    function raiz() {
      return modal.getRootNode ? modal.getRootNode() : null;
    }
    // A closed shadow root keeps its focused element to itself: from the
    // document, focus anywhere in here looks like focus on the host.
    function focado() {
      var r = raiz();
      return (r && r.activeElement) || null;
    }
    function naTela(e) {
      return !e.getClientRects || e.getClientRects().length > 0;
    }
    /**
     * The Tab stops inside the dialog, in order. Native tabbing decides every
     * step except the two at the ends, and a radio group is ONE stop — its
     * checked member, or its first when none is — which is what Tab itself
     * does, so the ends computed here are the ends Tab would reach.
     */
    function paradas() {
      var visiveis = Array.prototype.slice
        .call(modal.querySelectorAll('button, input, select, textarea, a[href], [tabindex]'))
        .filter(function (e) {
          return !e.disabled && !(e.tabIndex < 0) && naTela(e);
        });
      return visiveis.filter(function (e) {
        if (e.type !== 'radio' || !e.name) return true;
        var grupo = visiveis.filter(function (o) {
          return o.type === 'radio' && o.name === e.name;
        });
        var parada = grupo.filter(function (o) { return o.checked; })[0] || grupo[0];
        return e === parada;
      });
    }
    function prenderTab(e) {
      var lista = paradas();
      var atual = focado();
      var dentro = !!atual && atual !== modal && typeof modal.contains === 'function' && modal.contains(atual);
      var alvo = null;
      if (!lista.length) alvo = modal;
      else if (e.shiftKey && (!dentro || atual === lista[0])) alvo = lista[lista.length - 1];
      else if (!e.shiftKey && (!dentro || atual === lista[lista.length - 1])) alvo = lista[0];
      if (!alvo) return; // somewhere in the middle: Tab knows the way
      e.preventDefault();
      alvo.focus();
    }

    // Esc closes the modal wherever focus happens to be (the page, the
    // registrar's proxy, or inside the modal) and never reaches the page.
    document.addEventListener(
      'keydown',
      function (e) {
        if (!aberto) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          fechar();
        } else if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
          prenderTab(e);
        }
      },
      true
    );

    // ---- Modal navigation -----------------------------------------------------
    // Exactly one view carries nfpr-view-on. Each function names the one it
    // wants rather than toggling pairs, so each page added since — Ajuda,
    // Depuração, Erros desconhecidos — cost one array entry instead of
    // turning this into a matrix of removes.
    function mostrarView(alvo) {
      if (alvo === viewFalhas) pintarFalhas(); // pulled fresh: the panel owns that list
      [viewConfig, viewAjuda, viewFalhas, viewDepuracao].forEach(function (v) {
        v.classList.toggle('nfpr-view-on', v === alvo);
      });
      btnAjuda.style.display = alvo === viewConfig ? '' : 'none';
    }
    /**
     * Go to a page AND put the keyboard somewhere on it. The control that was
     * pressed to get here usually vanishes with the page it was on — the Ajuda
     * button hides on every pushed page — so without this the keyboard was
     * left on nothing. A pushed page gets its way back; the config page gets
     * the Ajuda button, the first thing in its tab order.
     */
    function irPara(alvo) {
      mostrarView(alvo);
      var destino =
        alvo === viewAjuda ? voltarAjuda
          : alvo === viewFalhas ? voltarFalhas
            : alvo === viewDepuracao ? voltarDepuracao
              : btnAjuda;
      destino.focus();
    }

    // `nfpr-open` goes on the shadow HOST, which the caller owns: the host is
    // pointer-events:none until something in it is interactive.
    function abrir(pagina) {
      aberto = true;
      opcoes.hospedeiro.classList.add('nfpr-open');
      backdrop.classList.add('nfpr-on');
      modal.classList.add('nfpr-on');
      // THE KEYBOARD COMES IN WITH IT. It used to stay on whatever opened the
      // dialog — the entity chip, behind the backdrop, still wearing its focus
      // ring — so the first Tab went on through the government page. The
      // config page takes it on the dialog itself (see `modal` above); a page
      // opened directly, from a bar, takes it on its way back.
      var alvo =
        pagina === 'ajuda' ? viewAjuda
          : pagina === 'falhas' ? viewFalhas
            : pagina === 'depuracao' ? viewDepuracao
              : viewConfig;
      if (alvo === viewConfig) {
        mostrarView(viewConfig);
        modal.focus();
      } else {
        irPara(alvo);
      }
    }

    // `semDevolverFoco`: the one caller that hands the keyboard to someone
    // else's dialog instead (abrirBuscaSite, above).
    function fechar(opcoesFechar) {
      aberto = false;
      opcoes.hospedeiro.classList.remove('nfpr-open');
      backdrop.classList.remove('nfpr-on');
      modal.classList.remove('nfpr-on');
      mostrarView(viewConfig); // reset for next open
      depuracao.aoFechar(); // ...and clear its one-shot status line
      // Hand focus back to the registrar's entry box, so the volunteer can
      // carry straight on scanning without clicking anything.
      if (!(opcoesFechar && opcoesFechar.semDevolverFoco)) setTimeout(opcoes.aoFechar, 30);
    }

    var flashTimer = null;
    function flash() {
      if (!flashAtivo) return;
      clearTimeout(flashTimer);
      flashEl.classList.remove('nfpr-flash-on');
      void flashEl.offsetWidth; // force reflow so the animation retriggers
      flashEl.classList.add('nfpr-flash-on');
      flashTimer = setTimeout(function () {
        flashEl.classList.remove('nfpr-flash-on');
      }, 360);
    }

    return {
      elementos: [backdrop, modal, flashEl, toastFlutuante],
      api: {
        abrir: abrir,
        fechar: fechar,
        estaAberto: function () {
          return aberto;
        },
        setFlash: function (v) {
          flashAtivo = v !== false;
        },
        flash: flash,
        mostrarToast: mostrarToast
      }
    };
  }

  NFPR.Modal = { criar: criar };
})(typeof globalThis !== 'undefined' ? globalThis : self);
