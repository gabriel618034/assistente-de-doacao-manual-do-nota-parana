/**
 * sec-entidades.js  (settings section)
 * -----------------------------------------------------------------------------
 * The "Entidade beneficiada" card: the saved list with its active-entity
 * radio, and the add form with live CNPJ validation and registry lookup.
 * What may actually be saved is NFPR.Entidade.salvar's business, not this
 * file's.
 *
 * One of three sections composed by settings-ui.js. Each is a factory returning
 * { elemento, render(cfg) }: it builds its static skeleton once and repaints
 * only what comes from storage, so an update from another surface can never
 * wipe what the volunteer is mid-typing.
 *
 * Every write goes through Config.atualizarConfig — never a whole-object
 * overwrite (see config.js).
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  var NFPR = (root.NFPR = root.NFPR || {});
  var Config = NFPR.Config;
  var Cnpj = NFPR.Cnpj;
  var el = NFPR.el; // shared DOM builder (src/shared/dom.js)

  NFPR.secaoEntidades = function secaoEntidades(opcoes) {
    opcoes = opcoes || {};

    // --- Institutions ----------------------------------------------------------
    var listaEntidade = el('div', { class: 'nfpr-list' });
    // THERE IS NO NAME FIELD. The CNPJ is the target, and the name is the
    // registry's to give — see NFPR.Entidade.salvar for why a typed one went.
    // NO inputMode: 'numeric'. A CNPJ registered from 07/2026 on may hold
    // uppercase letters in its first twelve characters, and a numeric touch
    // keyboard cannot type one. There is no "alphanumeric" inputmode, so the
    // default (text) is the only setting that can enter every valid CNPJ.
    var entidadeCnpj = el('input', {
      class: 'nfpr-input nfpr-mono',
      type: 'text',
      placeholder: '00.000.000/0000-00'
    });
    var entidadeErro = el('p', { class: 'nfpr-help', attrs: { hidden: 'hidden' } });

    // The form's one status line, and it is ABSENT while it has nothing to
    // say — before anything is typed, and after an entity is added — rather
    // than an empty paragraph holding its min-height open under the field.
    function ajuda(texto, tipo) {
      entidadeErro.textContent = texto || '';
      entidadeErro.className = 'nfpr-help' + (tipo ? ' ' + tipo : '');
      if (texto) entidadeErro.removeAttribute('hidden');
      else entidadeErro.setAttribute('hidden', 'hidden');
    }
    // The label is a constant, restored from here rather than read back off
    // the button — see adicionarEntidade.
    var ROTULO_ADICIONAR = 'Adicionar entidade';
    var entidadeBtn = el('button', {
      class: 'nfpr-btn nfpr-btn-primary',
      type: 'button',
      text: ROTULO_ADICIONAR
    });

    // Cache of the last official lookup so "Adicionar" can reuse it.
    var ultimaConsulta = { cnpj: null, resultado: null };
    var consultaTimer = null;

    function nomeDaEntidade(ent) {
      return (ent && (ent.nmFantasia || ent.nmEmpresarial)) || '';
    }

    entidadeCnpj.addEventListener('input', function () {
      var pos = entidadeCnpj.selectionStart;
      var antes = entidadeCnpj.value.length;
      entidadeCnpj.value = Cnpj.formatar(entidadeCnpj.value);
      // keep the caret roughly in place after re-formatting
      var diff = entidadeCnpj.value.length - antes;
      try { entidadeCnpj.setSelectionRange(pos + diff, pos + diff); } catch (e) { }
      var valido = validarCnpjCampo();
      // Once a full, checksum-valid CNPJ is present, confirm it against the
      // official endpoint (debounced) and show the name it is registered under.
      clearTimeout(consultaTimer);
      if (valido) {
        var alvo = Cnpj.limpar(entidadeCnpj.value);
        consultaTimer = setTimeout(function () {
          consultarEntidade(alvo);
        }, 450);
      }
    });

    function validarCnpjCampo() {
      var bruto = Cnpj.limpar(entidadeCnpj.value);
      if (!bruto) {
        ajuda('');
        entidadeCnpj.classList.remove('nfpr-invalid', 'nfpr-valid');
        return false;
      }
      if (Cnpj.validar(bruto)) {
        ajuda('CNPJ válido.', 'nfpr-help-ok');
        entidadeCnpj.classList.add('nfpr-valid');
        entidadeCnpj.classList.remove('nfpr-invalid');
        return true;
      }
      // Still typing is not a mistake: muted help, and the field stays neutral.
      // Red is for a complete CNPJ whose check digits fail.
      if (bruto.length < 14) {
        ajuda('O CNPJ tem 14 caracteres.');
        entidadeCnpj.classList.remove('nfpr-invalid', 'nfpr-valid');
        return false;
      }
      ajuda('CNPJ inválido. Confira o número digitado.', 'nfpr-help-err');
      entidadeCnpj.classList.add('nfpr-invalid');
      entidadeCnpj.classList.remove('nfpr-valid');
      return false;
    }

    // Query the official endpoint, reflect the outcome in the UI, and cache it.
    async function consultarEntidade(cnpjLimpo) {
      if (ultimaConsulta.cnpj === cnpjLimpo && ultimaConsulta.resultado) {
        return ultimaConsulta.resultado;
      }
      ajuda('Consultando o cadastro do Nota Paraná…');

      var res = await NFPR.Entidade.consultar(cnpjLimpo);
      // Ignore a stale response if the field changed while we waited.
      if (Cnpj.limpar(entidadeCnpj.value) !== cnpjLimpo) return res;
      // Cache SUCCESSES only. Caching failures meant one transient INDISPONIVEL
      // (page still loading, a momentary drop, a Firefox host permission not
      // yet granted) stuck for the life of the modal: adicionarEntidade got the
      // cached failure back, never retried, and saved the entity unverified
      // even if the network had recovered thirty seconds earlier.
      if (res.ok) ultimaConsulta = { cnpj: cnpjLimpo, resultado: res };

      if (res.ok) {
        var nm = nomeDaEntidade(res.entidade);
        var local = res.entidade.municipio ? ' · ' + res.entidade.municipio : '';
        ajuda('✓ ' + nm + local, 'nfpr-help-ok');
      } else if (res.motivo === 'NAO_ENCONTRADA') {
        ajuda('Este CNPJ não está cadastrado como entidade no Nota Paraná.', 'nfpr-help-err');
      } else if (res.motivo === 'SESSAO') {
        ajuda('Entre no Nota Paraná para confirmar o nome da entidade.');
      } else {
        ajuda('Não foi possível confirmar a entidade agora. Você pode adicioná-la assim mesmo; o nome será exibido quando o Nota Paraná responder.');
      }
      return res;
    }

    function limparFormularioEntidade() {
      // A lookup still waiting on its debounce would otherwise write
      // "Verificando…" back into the line this is about to clear.
      clearTimeout(consultaTimer);
      ajuda('');
      entidadeCnpj.value = '';
      entidadeCnpj.classList.remove('nfpr-valid', 'nfpr-invalid');
      ultimaConsulta = { cnpj: null, resultado: null };
      entidadeCnpj.focus();
    }

    // Presentation only: the rules for what may be saved, and the record that
    // gets written, live in NFPR.Entidade.salvar — shared with the site's own
    // search dialog so the two can't disagree again.
    //
    // ONE SAVE AT A TIME. Disabling the button covers only the button: the
    // field's own Enter reaches here too, and a second Enter during the lookup
    // read the label back as "Verificando…" — so that is what it restored,
    // for the life of the form — and then asked to save the same CNPJ again,
    // which the first save had just added. A successful add ended in red with
    // "Esta entidade já está cadastrada." The flag is released in `finally`,
    // with the label, so a lookup or a write that throws cannot leave the form
    // stuck either.
    var salvando = false;
    async function adicionarEntidade() {
      if (salvando) return;
      var cnpj = Cnpj.limpar(entidadeCnpj.value);
      if (!Cnpj.validar(cnpj)) {
        validarCnpjCampo();
        entidadeCnpj.focus();
        return;
      }

      // Confirm against the official endpoint before saving.
      salvando = true;
      entidadeBtn.disabled = true;
      entidadeBtn.textContent = 'Verificando…';
      var res;
      try {
        var consulta = await consultarEntidade(cnpj);
        res = await NFPR.Entidade.salvar(cnpj, { consulta: consulta });
      } finally {
        salvando = false;
        entidadeBtn.disabled = false;
        entidadeBtn.textContent = ROTULO_ADICIONAR;
      }

      if (res.estado === 'nao_registrada') {
        ajuda('Este CNPJ não está cadastrado como entidade no Nota Paraná e não foi adicionado.', 'nfpr-help-err');
        return;
      }
      if (res.estado === 'duplicada') {
        ajuda('Esta entidade já está cadastrada.', 'nfpr-help-err');
        return;
      }

      // Added: the new row in the list above is the confirmation, so the
      // status line goes entirely. One saved without the registry (offline,
      // cross-origin popup, or session expired) shows as its CNPJ there until
      // NFPR.Entidade.completarNomes gets an answer.
      limparFormularioEntidade();
    }

    entidadeBtn.addEventListener('click', adicionarEntidade);
    entidadeCnpj.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        adicionarEntidade();
      }
    });

    // Button that opens the page's own official entity-search modal. Only the
    // on-page modal can provide this (the popup has no host page), so the
    // button renders only when the host supplies the callback.
    var btnBuscar = opcoes.abrirBuscaSite
      ? el('button', {
          class: 'nfpr-btn nfpr-btn-ghost',
          type: 'button',
          text: 'Buscar entidade no site',
          onClick: function () {
            opcoes.abrirBuscaSite();
          }
        })
      : null;

    var secInst = el('section', { class: 'nfpr-card' }, [
      el('div', { class: 'nfpr-card-head' }, [
        el('h2', { class: 'nfpr-card-title', text: 'Entidade beneficiária' }),
        el('p', {
          class: 'nfpr-card-sub',
          text: 'As notas são doadas à entidade selecionada. Você pode cadastrar mais de uma e alternar entre elas a qualquer momento.'
        })
      ]),
      listaEntidade,
      // Its own tinted box with its own heading: sitting bare under the list,
      // the field read as one more row of it rather than a way to add one.
      el('div', { class: 'nfpr-novo' }, [
        el('h3', { class: 'nfpr-novo-titulo', text: 'Cadastrar nova entidade' }),
        el('div', { class: 'nfpr-form-row' }, [entidadeCnpj]),
        entidadeErro,
        el('div', { class: 'nfpr-form-actions' }, [btnBuscar, entidadeBtn])
      ])
    ]);

    /**
     * Where the keyboard was in the list, before a repaint destroys it: which
     * entity, and whether on its radio or its Remover. Null when it was not in
     * the list at all — then a repaint leaves the keyboard alone.
     *
     * Asked of the list's own root, because a closed shadow root keeps its
     * focused element to itself; in the toolbar popup that root is the
     * document, and the same question works there too.
     */
    function focoNaLista() {
      var r = listaEntidade.getRootNode ? listaEntidade.getRootNode() : null;
      var ativo = r && r.activeElement;
      if (!ativo || typeof listaEntidade.contains !== 'function' || !listaEntidade.contains(ativo)) {
        return null;
      }
      return { id: ativo.nfprId, remover: ativo.tagName === 'BUTTON' };
    }

    /**
     * EVERY CONFIG CHANGE REBUILDS THIS LIST, and that used to throw the
     * keyboard away. Choosing an entity from the keyboard is an arrow key on
     * the radio group, which writes config, which repaints — destroying the
     * radio that had just been chosen, so every choice left the keyboard on
     * nothing and the next Tab started again from the top of the dialog. Put
     * it back on the same entity's same control. A removed entity's Remover
     * has no successor to fall back to, so it goes to the list's entry point —
     * the checked radio, never the next row's Remover, which an Enter pressed
     * twice would then fire — or to the CNPJ field of the add form once the
     * list is empty.
     */
    function devolverFoco(lembrado, controles) {
      if (!lembrado) return;
      var mesmo = controles[lembrado.id];
      if (mesmo) {
        (lembrado.remover ? mesmo.remover : mesmo.radio).focus();
        return;
      }
      var ids = Object.keys(controles);
      var marcado = ids.filter(function (id) { return controles[id].radio.checked; })[0] || ids[0];
      if (marcado) controles[marcado].radio.focus();
      else entidadeCnpj.focus();
    }

    function render(cfg) {
      // institutions
      var lembrado = focoNaLista();
      var controles = {};
      listaEntidade.innerHTML = '';
      if (!cfg.entidades.length) {
        listaEntidade.appendChild(el('p', { class: 'nfpr-empty', text: 'Nenhuma entidade cadastrada.' }));
      }
      cfg.entidades.forEach(function (inst) {
        var ativo = inst.id === cfg.entidadeAtivaId;
        var radio = el('input', {
          type: 'radio',
          name: 'nfpr-inst-ativa',
          class: 'nfpr-radio',
          checked: ativo,
          // Expando, not an attribute: what focoNaLista reads back, and never
          // anything a page or a stylesheet should be matching on.
          nfprId: inst.id,
          onChange: function () {
            Config.atualizarConfig({ entidadeAtivaId: inst.id });
          }
        });
        // The danger colour is carried, not inherited from the size — see the
        // `.nfpr-btn-perigo` block in settings.css.
        var rm = el('button', {
          class: 'nfpr-btn nfpr-btn-ghost nfpr-btn-sm nfpr-btn-perigo',
          type: 'button',
          text: 'Remover',
          nfprId: inst.id,
          onClick: function () {
            Config.atualizarConfig(function (c) {
              var restantes = c.entidades.filter(function (x) {
                return x.id !== inst.id;
              });
              return {
                entidades: restantes,
                // Removing the active one promotes the first survivor.
                entidadeAtivaId:
                  c.entidadeAtivaId === inst.id
                    ? (restantes.length ? restantes[0].id : null)
                    : c.entidadeAtivaId
              };
            });
          }
        });
        listaEntidade.appendChild(
          el('div', { class: 'nfpr-item' + (ativo ? ' nfpr-item-ativo' : '') }, [
            radio,
            // Unnamed until the registry answers, and then the CNPJ IS the
            // row — never a stand-in like "Entidade 11.222…", which only
            // repeated the number with a word in front of it.
            el('div', { class: 'nfpr-item-main' }, inst.nome
              ? [
                  el('span', { class: 'nfpr-item-nome', text: inst.nome }),
                  el('span', {
                    class: 'nfpr-item-sub nfpr-mono',
                    text: Cnpj.formatar(inst.cnpj) + (inst.municipio ? ' · ' + inst.municipio : '')
                  })
                ]
              : [el('span', { class: 'nfpr-item-nome nfpr-mono', text: Cnpj.formatar(inst.cnpj) })]),
            ativo ? el('span', { class: 'nfpr-tag', text: 'Ativa' }) : null,
            rm
          ])
        );
        controles[inst.id] = { radio: radio, remover: rm };
      });
      devolverFoco(lembrado, controles);
    }

    return { elemento: secInst, render: render };
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
