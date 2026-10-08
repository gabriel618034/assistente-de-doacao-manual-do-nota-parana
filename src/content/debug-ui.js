/**
 * debug-ui.js  (content + offline page — the debug mode's face)
 * -----------------------------------------------------------------------------
 * Two things, both useless without src/shared/debug.js, and both shipped with it:
 *
 *   NFPR.DebugUI.observarGesto(o)  the way IN — seven consecutive clicks on a
 *                                  host-page element, Android's build-number tap
 *   NFPR.DebugUI.montar(container) the flags form behind "Cuidado!" in the red
 *                                  banner, rendered into a modal view
 *
 * WHY A SEPARATE FILE FROM debug.js. That one owns the state and is deliberately
 * DOM-free — it loads in the popup too, where none of this exists. This one is
 * all DOM and lives with the other content-script surfaces. Same split as
 * config.js / settings-ui.js, for the same reason.
 *
 * WHY A GESTURE AT ALL, when the console already arms it. The console is the
 * honest gate and stays the documented one; this is for the case the console is
 * awkward to reach — a volunteer's machine you are standing at, a laptop with no
 * devtools open. Seven CONSECUTIVE clicks with a 2.5 s timeout is not something
 * anyone does by accident, and arming alone changes nothing: every flag starts
 * off, so all seven clicks buy you is the red banner and the form below it.
 *
 * THE TARGET IS ON THE GOVERNMENT PAGE, not in our shadow roots — so this is a
 * document-level capture-phase listener, exactly like capture.js. It READS the
 * host page and never mutates it (the scrollbar rule in ui.js remains the only
 * host mutation in the extension).
 *
 * Events that came out of our own closed shadow roots are retargeted to the
 * shadow HOST by the time they reach the document, so `e.target.closest` cannot
 * see inside them and our own clicks can never match the selector. That is why
 * this reads e.target and NOT composedPath()[0], which would defeat it.
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  var NFPR = (root.NFPR = root.NFPR || {});
  var el = NFPR.el; // shared DOM builder (src/shared/dom.js)

  var CLIQUES = 7;
  var JANELA_MS = 2500; // gap after which the run is no longer "consecutive"
  var MOSTRAR_A_PARTIR_DE = 4; // start counting down out loud with 4 left

  // ---------------------------------------------------------------------------
  // The way in
  // ---------------------------------------------------------------------------

  /**
   * observarGesto({ seletor, aoContar(faltam), aoAtivar(jaEstava) })
   *
   * Returns a function that removes the listener.
   *
   * "Consecutive" is enforced two ways: a click on anything else resets the run,
   * and so does a gap longer than JANELA_MS. Both matter — without the first,
   * seven clicks spread across a work session would eventually arm it by
   * accident on a page where the target sits next to something people click.
   *
   * NOTE: if the target ever ends up inside #main, ui.js's replaceChildren
   * destroys it on mount and this gesture becomes unreachable. That is a
   * property of the host page, not something this file can detect — the console
   * (NFPR.Debug.ligar) is always the reliable way in.
   */
  function observarGesto(opcoes) {
    opcoes = opcoes || {};
    var seletor = opcoes.seletor || 'span.fn.org';
    var contagem = 0;
    var ultimo = 0;

    function aoClicar(e) {
      var alvo = e.target;
      var acertou = alvo && typeof alvo.closest === 'function' && alvo.closest(seletor);
      if (!acertou) {
        contagem = 0; // a click anywhere else breaks the run
        return;
      }

      var agora = Date.now();
      contagem = agora - ultimo > JANELA_MS ? 1 : contagem + 1;
      ultimo = agora;

      if (contagem < CLIQUES) {
        var faltam = CLIQUES - contagem;
        if (faltam <= MOSTRAR_A_PARTIR_DE && opcoes.aoContar) opcoes.aoContar(faltam);
        return;
      }

      contagem = 0;
      // Already armed: nothing to do. The caller is told so it can say as much,
      // but the gesture itself opens nothing and changes nothing — the flags
      // form is reachable only through "Cuidado!" on the red banner.
      var jaEstava = NFPR.Debug.estaAtivo();
      // ARMED WITH EVERY FLAG OFF, spelled out rather than assumed. `ligar`
      // MERGES over what is stored, and "Voltar à segurança" keeps the flags on
      // purpose — so `ligar({})` re-armed whatever the last session left: a
      // live red-key bypass, or simularEnvio, which drains the real queue as
      // "Simulação". The gesture is the one door that must never change how a
      // note is judged.
      if (!jaEstava) NFPR.Debug.ligar(Object.assign({}, NFPR.Debug.FLAGS_PADRAO));
      if (opcoes.aoAtivar) opcoes.aoAtivar(jaEstava);
    }

    document.addEventListener('click', aoClicar, true);

    // SAY SO WHEN THERE IS NOTHING TO CLICK. The listener attaches happily
    // whether or not the target exists, so a wrong selector — or a target that
    // sat inside #main and was destroyed by ui.js's replaceChildren on mount —
    // is otherwise a gesture that simply never fires, with nothing anywhere to
    // explain it. This is a development-only file; a console line is the right
    // cost. Deferred one turn so it runs after the caller has finished mounting.
    setTimeout(function () {
      if (document.querySelector(seletor)) return;
      console.debug(
        '[NFPR] gesto de depuração: nenhum elemento "' + seletor + '" nesta página. ' +
          'Se ele existia antes da montagem, estava dentro de #main e foi substituído ' +
          'pelo registrador — use NFPR.Debug.ligar() no console.'
      );
    }, 0);

    return function () {
      document.removeEventListener('click', aoClicar, true);
    };
  }

  // ---------------------------------------------------------------------------
  // The form
  // ---------------------------------------------------------------------------

  // Every control below writes through NFPR.Debug.ligar, which is also what
  // repaints this form (via Debug.aoMudar) and the banner — so the console, the
  // banner's button and this form can never disagree about the state.
  var TOGGLES = [
    {
      titulo: 'Ignorar verificações',
      sub: 'As notas que passarem por aqui podem não existir. Cada uma fica marcada na lista.',
      itens: [
        ['aceitarChavesInvalidas', 'Aceitar chaves inválidas',
          'Passa por cima do dígito verificador, do formato, do mês, do emitente e da data futura.'],
        ['ignorarInelegibilidade', 'Aceitar notas não doáveis',
          'Passa por cima de fora do prazo, outro estado e documento que não é NF-e nem NFC-e.'],
        ['ignorarDuplicadas', 'Permitir repetir a mesma chave',
          'A mesma nota pode ser escaneada quantas vezes quiser.'],
        ['partesFixasSemValidacao', 'Aceitar qualquer parte fixa',
          'Permite salvar partes fixas que só descrevem notas que não podem ser doadas.']
      ]
    }
  ];

  function montar(container) {
    container.classList.add('nfpr-settings');
    container.innerHTML = '';

    var Debug = NFPR.Debug;

    // Applied by every control: one patch, through the one write path.
    var mudar = function (patch) {
      Debug.ligar(patch);
    };

    function linhaToggle(nome, rotulo, descricao) {
      var input = el('input', {
        type: 'checkbox',
        class: 'nfpr-switch-input',
        id: 'nfpr-dbg-' + nome
      });
      input.addEventListener('change', function () {
        var patch = {};
        patch[nome] = input.checked;
        mudar(patch);
      });
      var linha = el('div', { class: 'nfpr-pref' }, [
        el('div', { class: 'nfpr-pref-text' }, [
          el('span', { class: 'nfpr-pref-label', text: rotulo }),
          el('span', { class: 'nfpr-pref-desc', text: descricao })
        ]),
        el('label', { class: 'nfpr-switch', attrs: { for: 'nfpr-dbg-' + nome } }, [
          input,
          el('span', { class: 'nfpr-switch-track' }, [el('span', { class: 'nfpr-switch-thumb' })])
        ])
      ]);
      return { linha: linha, input: input, nome: nome };
    }

    var controles = []; // everything render() has to repaint

    // --- status + the way out --------------------------------------------------
    var estadoTexto = el('p', { class: 'nfpr-help' });
    var secStatus = el('section', { class: 'nfpr-card nfpr-card-perigo' }, [
      el('div', { class: 'nfpr-card-head' }, [
        el('h2', { class: 'nfpr-card-title', text: 'Modo de depuração' }),
        el('p', {
          class: 'nfpr-card-sub',
          text:
            'Ferramenta de desenvolvimento. Com isto ligado, o assistente pode registrar ' +
            'notas que normalmente recusaria. Não use em um mutirão de verdade.'
        })
      ]),
      estadoTexto,
      el('div', { class: 'nfpr-form-actions' }, [
        el('button', {
          class: 'nfpr-btn nfpr-btn-primary',
          type: 'button',
          text: 'Voltar à segurança',
          onClick: function () {
            Debug.desligar();
          }
        }),
        // "Apagar tudo" would be a lie now that the card below deletes the
        // volunteer's own data: this one only forgets nfpr:debug.
        el('button', {
          class: 'nfpr-btn nfpr-btn-ghost',
          type: 'button',
          text: 'Apagar depuração',
          attrs: { title: 'Apaga nfpr:debug — não mexe nas configurações nem na fila' },
          onClick: function () {
            Debug.limpar();
          }
        })
      ])
    ]);
    container.appendChild(secStatus);

    // --- start over ------------------------------------------------------------
    // Second card on purpose: emptying the queue is the thing you reach for
    // between one test and the next, so it sits where the thumb already is.
    //
    // NO RELOAD, and no bespoke plumbing either — these just delete storage
    // keys. Removing one fires storage.onChanged, and every subscriber
    // (registrador.js, settings-ui.js, the badge) re-reads through Config, so
    // the panel, this form and the toolbar all repaint themselves. See the note
    // on Debug.apagar.
    //
    // NEITHER TOUCHES nfpr:debug. Wiping the flags mid-session would be its own
    // small disaster — you would lose the fake clock you were testing against —
    // and the status card above already has the button for that.
    // nfpr-help-status: takes no room until it has something to say (see
    // registrar.css). Without it the reserved line sits as a hole between the
    // buttons and the note below them.
    var limpezaEstado = el('p', { class: 'nfpr-help nfpr-help-status' });
    function dizer(texto, tipo) {
      limpezaEstado.textContent = texto;
      limpezaEstado.className = 'nfpr-help nfpr-help-status' + (tipo ? ' nfpr-help-' + tipo : '');
    }
    function limpar(chaves, feito) {
      Debug.apagar(chaves).then(
        function () {
          dizer(feito, 'ok');
        },
        function (e) {
          dizer('Não foi possível apagar: ' + (e && e.message), 'err');
        }
      );
    }

    container.appendChild(
      el('section', { class: 'nfpr-card' }, [
        el('div', { class: 'nfpr-card-head' }, [
          el('h2', { class: 'nfpr-card-title', text: 'Recomeçar' }),
          el('p', {
            class: 'nfpr-card-sub',
            text:
              'Apaga o que está guardado neste computador, sem recarregar a página. ' +
              'As opções de depuração ficam.'
          })
        ]),
        el('div', { class: 'nfpr-form-actions' }, [
          el('button', {
            class: 'nfpr-btn nfpr-btn-ghost',
            type: 'button',
            text: 'Esvaziar a fila',
            attrs: { title: 'Apaga nfpr:fila' },
            onClick: function () {
              limpar(['nfpr:fila'], 'Fila esvaziada.');
            }
          }),
          // CONFIG ONLY. This used to delete nfpr:fila as well, which made the
          // common thing to want (reset my settings) cost the expensive one
          // (throw away donations that have not been sent). "Esvaziar a fila"
          // right beside it already covers the queue, and wanting both is two
          // clicks. Do not merge them back.
          el('button', {
            class: 'nfpr-btn nfpr-btn-ghost nfpr-btn-perigo',
            type: 'button',
            text: 'Apagar configurações do usuário',
            attrs: { title: 'Apaga nfpr:config — a fila fica' },
            onClick: function () {
              limpar(['nfpr:config'], 'Entidades, partes fixas e preferências apagadas. A fila ficou.');
            }
          })
        ]),
        limpezaEstado,
        // The honest limit. Both buttons delete the DURABLE record; the rows
        // already on screen and the "you already scanned this" set live in
        // memory and are not storage-derived, so only a reload clears those.
        el('p', {
          class: 'nfpr-help',
          text:
            'As notas já listadas na tela continuam lá, e as chaves já escaneadas seguem ' +
            'bloqueadas até recarregar. Para desfazer: NFPR.Debug.snapshot() antes, ' +
            'NFPR.Debug.restaurar(c) depois.'
        })
      ])
    );

    // --- the bypasses ----------------------------------------------------------
    TOGGLES.forEach(function (grupo) {
      var sec = el('section', { class: 'nfpr-card' }, [
        el('div', { class: 'nfpr-card-head' }, [
          el('h2', { class: 'nfpr-card-title', text: grupo.titulo }),
          el('p', { class: 'nfpr-card-sub', text: grupo.sub })
        ])
      ]);
      grupo.itens.forEach(function (i) {
        var c = linhaToggle(i[0], i[1], i[2]);
        controles.push(c);
        sec.appendChild(c.linha);
      });
      container.appendChild(sec);
    });

    // --- the network -----------------------------------------------------------
    var simular = linhaToggle(
      'simularEnvio',
      'Simular envio',
      'Nada vai para o servidor: toda nota responde "registrada com sucesso".'
    );
    controles.push(simular);

    var resposta = el('input', {
      class: 'nfpr-input',
      type: 'text',
      placeholder: 'ex.: Fora do prazo para doar.  ou  {"erro":"..."}',
      maxLength: 200
    });

    /**
     * The field takes TWO shapes, because the answers worth forging do not all
     * arrive in the same field.
     *
     *   a bare sentence   shorthand for `chaveAcesso`, where most per-note
     *                     verdicts arrive. Unchanged, and still the common case.
     *   a JSON object     reaches every other field — above all
     *                     `{"erro":"..."}`, THE SHRUG, which is the entire
     *                     reason the health probe exists and which no sentence
     *                     can express. Without this the confused-server latch
     *                     could not be exercised from the UI at all.
     *
     * donation.js already accepts either (`typeof forcada === 'string' ? {
     * chaveAcesso: forcada } : forcada`) and debug.js's `resumo` already
     * JSON.stringifies non-strings for the banner, so this is the only place
     * that needed to learn anything.
     *
     * JSON.parse ONLY — never eval, never new Function. Accepting a JavaScript
     * object literal (unquoted keys, single quotes) would require one of those,
     * and running a string as code is the surest way to fail a Web Store
     * review, for a convenience worth nothing. Type real JSON.
     *
     * Anything that fails to parse is kept verbatim as the sentence shorthand:
     * a half-finished object is then simply a strange-looking chaveAcesso,
     * which is harmless and fixes itself on the next edit. Nothing is dropped.
     */
    function lerResposta(bruto) {
      var texto = String(bruto || '').trim();
      if (!texto) return null;
      if (texto.charAt(0) !== '{') return texto;
      try {
        var corpo = JSON.parse(texto);
        if (corpo && typeof corpo === 'object' && !Array.isArray(corpo)) return corpo;
      } catch (e) {
        // not valid JSON (yet) — fall through and keep what was typed
      }
      return texto;
    }

    resposta.addEventListener('change', function () {
      mudar({ respostaForcada: lerResposta(resposta.value) });
    });

    var erro = el('select', { class: 'nfpr-input' }, [
      el('option', { value: '', text: 'Nenhum — deixar a rede responder' }),
      el('option', { value: 'REDE', text: 'REDE — sem internet' }),
      el('option', { value: 'SERVIDOR', text: 'SERVIDOR — site fora do ar' }),
      el('option', { value: 'SESSAO', text: 'SESSAO — sessão expirada' }),
      el('option', { value: 'SESSAO_DUPLICADA', text: 'SESSAO_DUPLICADA' }),
      el('option', { value: 'ENCERRANDO_SESSAO', text: 'ENCERRANDO_SESSAO' })
    ]);
    erro.addEventListener('change', function () {
      mudar({ erroForcado: erro.value || null });
    });

    var secRede = el('section', { class: 'nfpr-card' }, [
      el('div', { class: 'nfpr-card-head' }, [
        el('h2', { class: 'nfpr-card-title', text: 'Respostas do site' }),
        el('p', {
          class: 'nfpr-card-sub',
          text:
            'O que o assistente ouve de volta, sem precisar do servidor. ' +
            'Nada aqui mexe no estado da conexão — isso é o cartão abaixo.'
        })
      ]),
      simular.linha,
      el('p', {
        class: 'nfpr-help',
        text:
          'Resposta forçada do servidor — passa pela mesma leitura de sempre. ' +
          'Uma frase vira a recusa da chave; um objeto JSON vira o corpo inteiro, ' +
          'que é como se testa {"erro":"..."} — a resposta que não diagnostica nada.'
      }),
      el('div', { class: 'nfpr-form-row' }, [resposta]),
      // THIS IS NOT "pretend the internet is down" — that is `forcarConexao`,
      // in the Relogio e conexao card. The two used to be called things that
      // both read that way (`Erro de rede forçado` / `Conexão`), so which one
      // to reach for was a guess. They lie to different layers: this one
      // replaces the ANSWER TO ONE ATTEMPT, that one replaces the WORLD.
      el('p', {
        class: 'nfpr-help',
        text:
          'Falha forçada de UMA tentativa — a camada da resposta. Cada envio ' +
          'estoura este erro em vez de falar com o site, e daí em diante tudo ' +
          'segue o caminho normal, inclusive travar a condição que o código ' +
          'implica: REDE e SERVIDOR derrubam a barra de conexão, os três de ' +
          'sessão derrubam a sessão. A sondagem continua real, então uma queda ' +
          'forçada por aqui ainda se recupera sozinha.'
      }),
      el('div', { class: 'nfpr-form-row' }, [erro])
    ]);
    container.appendChild(secRede);

    // --- injected reality ------------------------------------------------------
    var mesFixo = el('input', {
      class: 'nfpr-input nfpr-mono',
      type: 'number',
      placeholder: 'mês',
      min: 1,
      max: 12
    });
    // TWO DIGITS, exactly as the key writes them: `aa` at [2:4] is two digits
    // and the year is 2000 + aa, so 00–99 is the whole range a note can express
    // — a clock outside it would only make every key ever built come back
    // FUTURA or EXPIRADA, which is not a place worth travelling to. Typing the
    // same two digits you are reading off the key is also one less translation
    // to get wrong at the moment you are testing a deadline.
    //
    // Only the FIELD is two digits. The stored value stays { ano: 2026 }, so
    // relogioFixo, Relogio.mesCorrente and every verdict downstream are
    // untouched — see aoAno/deAno, which are the only two places that convert.
    var ANO_BASE = 2000;
    var aoAno = function (aa) { return ANO_BASE + aa; };
    var deAno = function (ano) { return ano - ANO_BASE; };
    var anoFixo = el('input', {
      class: 'nfpr-input nfpr-mono',
      type: 'number',
      placeholder: 'aa',
      min: 0,
      max: 99
    });
    var relogioAviso = el('p', { class: 'nfpr-help nfpr-help-status' });

    /**
     * The two fields are ONE value, so they have three states, not two.
     *
     *   vazio       both blank — use the real clock
     *   ok          both filled and in range — a month to travel to
     *   incompleto  anything in between
     *
     * `incompleto` is the whole point. It used to fall in with `vazio` and write
     * relogioFixo: null, which repainted both fields from state and wiped the
     * digits that had just been typed — filling one box and leaving it was
     * enough to lose it.
     */
    function parRelogio() {
      var mTxt = String(mesFixo.value == null ? '' : mesFixo.value).trim();
      var aTxt = String(anoFixo.value == null ? '' : anoFixo.value).trim();
      if (!mTxt && !aTxt) return { estado: 'vazio' };
      var m = Number(mTxt);
      var a = Number(aTxt);
      if (mTxt && aTxt && m >= 1 && m <= 12 && a >= 0 && a <= 99) {
        return { estado: 'ok', valor: { ano: aoAno(a), mes: m } };
      }
      return { estado: 'incompleto' };
    }

    function aplicarRelogio() {
      var par = parRelogio();
      // Half an answer changes nothing — but say so, or the form and the state
      // disagree in silence.
      if (par.estado === 'incompleto') {
        // Names the format rather than the bounds, because "2000–2099" is what
        // someone who just typed 2026 into a two-digit box already believed.
        dizerRelogio('Preencha mês (1–12) e ano com dois dígitos — 26 é 2026.', 'err');
        return;
      }
      dizerRelogio('');
      mudar({ relogioFixo: par.estado === 'ok' ? par.valor : null });
    }
    function dizerRelogio(texto, tipo) {
      relogioAviso.textContent = texto;
      relogioAviso.className = 'nfpr-help nfpr-help-status' + (tipo ? ' nfpr-help-' + tipo : '');
    }

    // `input`, not `change`: change fires on blur, which is exactly when the
    // repaint could reach a field the volunteer had only half filled. On input
    // the write lands the moment the pair becomes complete, and nothing depends
    // on where focus goes next.
    mesFixo.addEventListener('input', aplicarRelogio);
    anoFixo.addEventListener('input', aplicarRelogio);

    var conexao = el('select', { class: 'nfpr-input' }, [
      el('option', { value: '', text: 'Real — sondar o site de verdade' }),
      el('option', { value: 'online', text: 'Sempre conectado — nunca sonda' }),
      el('option', { value: 'offline', text: 'Sempre sem conexão — nada é enviado' })
    ]);
    conexao.addEventListener('change', function () {
      mudar({ forcarConexao: conexao.value || null });
    });

    var secRealidade = el('section', { class: 'nfpr-card' }, [
      el('div', { class: 'nfpr-card-head' }, [
        el('h2', { class: 'nfpr-card-title', text: 'Relógio e conexão' }),
        el('p', {
          class: 'nfpr-card-sub',
          text: 'Move o mês inteiro do assistente — é assim que se testa prazo e nota futura.'
        })
      ]),
      el('p', {
        class: 'nfpr-help',
        text:
          'Mês fixo, do jeito que vem na chave: mês e ano com dois dígitos — 08 e 26 ' +
          'é agosto de 2026. Deixe os dois em branco para usar o relógio real.'
      }),
      el('div', { class: 'nfpr-form-row' }, [mesFixo, anoFixo]),
      relogioAviso,
      // The OTHER half of the pair above. This one substitutes the probe
      // itself: no test request leaves the machine either way. "Sempre
      // conectado" is the thing a forced failure can never express — the
      // watchdog believing without asking — which is why both flags exist.
      el('p', {
        class: 'nfpr-help',
        text:
          'Estado da conexão — a camada do vigia, não o resultado de uma nota. ' +
          'Substitui a sondagem: nenhuma requisição de teste sai. "Sempre ' +
          'conectado" faz o vigia acreditar sem sondar, mesmo com o cabo na ' +
          'mão. "Sempre sem conexão" derruba a barra na hora E faz todo envio ' +
          'falhar, então as notas ficam guardadas sem nem tentar; voltar para ' +
          '"Real" ou "Sempre conectado" reenvia o que ficou esperando.'
      }),
      el('div', { class: 'nfpr-form-row' }, [conexao])
    ]);
    container.appendChild(secRealidade);

    // --- logging ---------------------------------------------------------------
    // Its own card, and named for WHAT it is rather than where it goes: this is
    // the one group here that changes nothing about how a note is judged or
    // sent — it only makes the assistant talk — and it is the group most likely
    // to grow. A card called "Console" would have to be renamed the day a
    // second kind of record arrives; "Registros" just gains a row.
    var verboso = linhaToggle(
      'registroVerboso',
      'Registro detalhado',
      'Escreve no console o que a captura, a parte fixa e os vereditos estão fazendo.'
    );
    controles.push(verboso);

    container.appendChild(
      el('section', { class: 'nfpr-card' }, [
        el('div', { class: 'nfpr-card-head' }, [
          el('h2', { class: 'nfpr-card-title', text: 'Registros' }),
          el('p', {
            class: 'nfpr-card-sub',
            text: 'O que o assistente anota enquanto trabalha. Não muda nada no que ele registra ou envia.'
          })
        ]),
        verboso.linha
      ])
    );

    // --- fixtures --------------------------------------------------------------
    // The one thing here that is genuinely useful and cannot hurt anything: a
    // key for any scenario, with the check digit already right. Select it and
    // paste it into the registrar.
    var caixaChave = el('input', {
      class: 'nfpr-input nfpr-mono',
      type: 'text',
      readOnly: true,
      placeholder: 'escolha um caso abaixo'
    });
    var CASOS = [
      ['Dígito errado', function () {
        var c = Debug.chaveFalsa();
        return c.slice(0, 43) + (c[43] === '9' ? '8' : '9');
      }],
      ['Fora do prazo', function () { return Debug.chaveFalsa({ aa: '20', mm: '01' }); }],
      ['Outro estado', function () { return Debug.chaveFalsa({ uf: '35' }); }],
      ['Outro documento (CT-e)', function () { return Debug.chaveFalsa({ modelo: '57' }); }],
      ['Mês impossível', function () { return Debug.chaveFalsa({ mm: '13' }); }]
    ];
    var botoesCaso = el(
      'div',
      { class: 'nfpr-form-actions nfpr-dbg-casos' },
      CASOS.map(function (caso) {
        return el('button', {
          class: 'nfpr-btn nfpr-btn-ghost nfpr-btn-sm',
          type: 'button',
          text: caso[0],
          onClick: function () {
            caixaChave.value = caso[1]();
            caixaChave.focus();
            caixaChave.select();
          }
        });
      })
    );
    // The same fixtures, all at once, judged instead of copied — NFPR.Debug.smoke().
    //
    // THE ANSWER HAS TO LAND ON THE PAGE. The full table goes to the console,
    // which is the right place for seventeen rows, but this form exists for the
    // machine where devtools is awkward to open — that is the whole reason the
    // gesture exists next to it. A button whose only output is invisible there
    // would be decoration, so the line below says how many passed, which month
    // it judged against, and names every failure.
    //
    // The month is stated because it is the thing that changes the answer and
    // the thing a fixed clock silently changes: "17/17 no mês 06/2030" is how
    // you notice you are still time-travelling.
    var smokeEstado = el('p', { class: 'nfpr-help nfpr-help-status' });
    function dizerSmoke(texto, tipo) {
      smokeEstado.textContent = texto;
      smokeEstado.className = 'nfpr-help nfpr-help-status' + (tipo ? ' nfpr-help-' + tipo : '');
    }

    var botaoSmoke = el('button', {
      class: 'nfpr-btn nfpr-btn-ghost nfpr-btn-sm',
      type: 'button',
      text: 'Conferir os vereditos',
      attrs: {
        title: 'NFPR.Debug.smoke() — julga todas as chaves de teste no mês atual, com relógio'
      },
      onClick: function () {
        var r = Debug.smoke();
        if (!r) {
          dizerSmoke('Não foi possível conferir: chave.js ou relogio.js não estão carregados.', 'err');
          return;
        }
        var mes = String(r.agora.mes).padStart(2, '0') + '/' + r.agora.ano;
        if (r.ok) {
          dizerSmoke(
            'Tudo certo: ' + r.total + ' de ' + r.total + ' casos, no mês ' + mes +
              '. A tabela completa está no console.',
            'ok'
          );
          return;
        }
        dizerSmoke(
          r.falhas.length + ' de ' + r.total + ' erraram no mês ' + mes + ': ' +
            r.falhas
              .map(function (l) {
                return l.nome + ' (esperava ' + l.esperado + ', veio ' + l.obtido + ')';
              })
              .join(' · ') +
            '. Detalhes no console.',
          'err'
        );
      }
    });

    var secChaves = el('section', { class: 'nfpr-card' }, [
      el('div', { class: 'nfpr-card-head' }, [
        el('h2', { class: 'nfpr-card-title', text: 'Chaves de teste' }),
        el('p', {
          class: 'nfpr-card-sub',
          text: 'Chaves de 44 dígitos com o dígito verificador certo. Copie e cole no quadro.'
        })
      ]),
      botoesCaso,
      el('div', { class: 'nfpr-form-row' }, [caixaChave]),
      el('p', {
        class: 'nfpr-help',
        text:
          'Checagem: julga dezesseis chaves — uma por vereditos, mais os dois meses ' +
          'em volta do prazo — no mês em que o assistente acha que está.'
      }),
      el('div', { class: 'nfpr-form-actions' }, [botaoSmoke]),
      smokeEstado,
      el('p', {
        class: 'nfpr-help',
        text:
          'Cópia e restauração do armazenamento ficam no console: NFPR.Debug.snapshot(), ' +
          'NFPR.Debug.restaurar(c), NFPR.Debug.ajuda().'
      })
    ]);
    container.appendChild(secChaves);

    // --- paint -----------------------------------------------------------------
    // Reads the state rather than remembering what it wrote, so a change made
    // from the console or the banner lands here too. The two free-text controls
    // are only repainted when they are NOT focused, so a repaint triggered by
    // another field cannot eat what is being typed.
    function render() {
      var f = Debug.flags();
      var ativo = Debug.estaAtivo();
      var resumo = Debug.resumo();
      estadoTexto.textContent = ativo
        ? 'Ligado. ' + (resumo.length ? resumo.join(' · ') : 'Nenhuma verificação ignorada ainda.')
        : 'Desligado — as opções abaixo ficam guardadas, mas nada as lê.';
      estadoTexto.className = 'nfpr-help ' + (ativo ? 'nfpr-help-err' : 'nfpr-help-ok');

      controles.forEach(function (c) {
        c.input.checked = !!f[c.nome];
      });
      // Round-trips the object shape: assigning one straight to .value would
      // paint "[object Object]" over what the developer typed, on any repaint
      // triggered by some other control.
      if (document.activeElement !== resposta) {
        var rf = f.respostaForcada;
        resposta.value = rf == null ? '' : typeof rf === 'string' ? rf : JSON.stringify(rf);
      }
      erro.value = f.erroForcado || '';
      conexao.value = f.forcarConexao || '';
      // The focus guard alone was not enough here: render() also runs when some
      // OTHER control changes, and at that moment neither date field is focused
      // — so a pair left half filled would be overwritten by a toggle
      // elsewhere. A half-filled pair is never repainted, at all.
      if (parRelogio().estado !== 'incompleto') {
        if (document.activeElement !== mesFixo) {
          mesFixo.value = f.relogioFixo ? f.relogioFixo.mes : '';
        }
        if (document.activeElement !== anoFixo) {
          // Back to two digits — the field's format, not the record's.
          anoFixo.value = f.relogioFixo ? deAno(f.relogioFixo.ano) : '';
        }
      }
    }

    Debug.aoMudar(render);
    Debug.pronto().then(render);
    render();

    return {
      /**
       * Called by modal.js when the overlay closes, next to the irConfig()
       * that already resets which page opens next.
       *
       * "Fila esvaziada." answers a click; it is not a state. Left in place it
       * would still be sitting there the next time the page is opened, claiming
       * something happened that happened ten minutes ago. Emptying it also
       * HIDES it again — see nfpr-help-status in registrar.css.
       *
       * The flags are deliberately untouched: those ARE state.
       */
      aoFechar: function () {
        dizer('');
        dizerRelogio('');
        // Same reasoning: "17 de 17 casos" answered a click ten minutes ago.
        dizerSmoke('');
      }
    };
  }

  NFPR.DebugUI = { montar: montar, observarGesto: observarGesto, CLIQUES: CLIQUES };
})(typeof globalThis !== 'undefined' ? globalThis : self);
