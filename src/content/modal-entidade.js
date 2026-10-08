/**
 * modal-entidade.js
 * -----------------------------------------------------------------------------
 * Hooks into the official "Consulta de Entidade" modal that the Nota Paraná
 * page already provides.  When the volunteer clicks a result row inside that
 * modal, we intercept (capture phase, before jQuery) and save the institution's
 * CNPJ straight into the extension's stored list — no duplicate UI needed.
 *
 * Strategy
 * --------
 * The page builds result rows with jQuery and appends them to a <tbody> inside
 * the modal.  We cannot wrap the jQuery handler directly, but we can:
 *   1. Use a MutationObserver to detect when rows are added to that tbody.
 *   2. Read the CNPJ from the row's cells (the page renders cnpjFormatado as
 *      visible text in one of them).
 *   3. Attach our own capture-phase listener so it fires before the page's
 *      bubbling jQuery handler — giving us the CNPJ before the modal closes.
 *
 * CNPJ cell detection
 * -------------------
 * We scan every <td> in the row and test its text against the CNPJ pattern
 * (XX.XXX.XXX/XXXX-XX).  This is resilient to column-order changes.
 *
 * Feedback
 * --------
 * The registrar's floating toast (overlay Shadow DOM, above the site's modal)
 * confirms the save without any native alert.
 *
 * Scope
 * -----
 * This file owns our whole relationship with that dialog: NFPR.BuscaSite opens
 * and closes it, and the observer below scrapes the rows it shows. What may be
 * saved, and the record that gets written, belong to NFPR.Entidade.salvar,
 * shared with the settings form.
 *
 * Opening it used to live inside modal.js, which is the wrong file twice over:
 * its own banner says it renders and makes no request, and getting out of the
 * lock below needs both a host-document query and a probe. modal.js now hands
 * the click over and knows nothing about the government markup.
 *
 * Survives our own mount
 * ----------------------
 * ui.js replaces the contents of the page's #main, but the site renders this
 * dialog OUTSIDE #main, so it (and these rows) are still there afterwards.
 * Verified on the live page; it is a standing dependency on the government
 * site's markup, so it is worth re-checking whenever that screen changes.
 * -----------------------------------------------------------------------------
 */
(function () {
  'use strict';

  var NFPR = globalThis.NFPR;
  if (!NFPR || !NFPR.Entidade || !NFPR.Cnpj) return;

  var Cnpj = NFPR.Cnpj;

  // Matches XX.XXX.XXX/XXXX-XX (formatted) or 14 consecutive characters (raw).
  // Alphanumeric in the first twelve, numeric in the check digits — the shape
  // the site's own field is formatted with ("AA.AAA.AAA/AAAA-00").
  //
  // THE RAW FORM DEMANDS A DIGIT SOMEWHERE, which the numeric version got for
  // free. A company name of exactly fourteen upper-case letters with no spaces
  // would otherwise be read as a CNPJ — and the cell it is in would then be
  // skipped by nomeDaLinha, which is what looks for the name.
  var RE_CNPJ_FORMATADO = /[0-9A-Z]{2}\.[0-9A-Z]{3}\.[0-9A-Z]{3}\/[0-9A-Z]{4}-\d{2}/;
  var RE_CNPJ_RAW        = /^(?=.*\d)[0-9A-Z]{12}\d{2}$/;

  /** Extract the first CNPJ-like string from a <tr>'s cells. */
  function cnpjDaLinha(tr) {
    var tds = tr.querySelectorAll('td');
    for (var i = 0; i < tds.length; i++) {
      var texto = (tds[i].textContent || '').trim();
      if (RE_CNPJ_FORMATADO.test(texto) || RE_CNPJ_RAW.test(texto)) {
        return Cnpj.limpar(texto);
      }
    }
    return null;
  }

  /** Also try to grab the company name from the row for a better display name. */
  function nomeDaLinha(tr) {
    var tds = tr.querySelectorAll('td');
    for (var i = 0; i < tds.length; i++) {
      var texto = (tds[i].textContent || '').trim();
      // Company name: not a CNPJ pattern, not a digits-only cell, min 3 chars.
      if (
        texto.length >= 3 &&
        !RE_CNPJ_FORMATADO.test(texto) &&
        !RE_CNPJ_RAW.test(texto) &&
        !/^\d+$/.test(texto)
      ) {
        return texto;
      }
    }
    return '';
  }

  // ---- Toast feedback -------------------------------------------------------
  // The registrar's floating toast, in the overlay Shadow DOM. This file used
  // to rebuild the same widget in the LIGHT DOM with a 20-line inline style
  // string and hardcoded #df4338/#15a05a duplicating --nf-err/--nf-ok, against
  // two rules this project holds to: on-page UI lives in the Shadow DOM, and
  // styling comes from the CSS files.
  //
  // The instance is guarded because this observer is wired up at load, before
  // NFPR.UI.montar has resolved; a row click can only happen long after, but
  // there is no reason for a missing registrar to throw here.
  function mostrarToast(mensagem, tipo) {
    var ui = NFPR.UI && NFPR.UI.instancia;
    if (ui) ui.mostrarToast(mensagem, tipo);
  }

  // ---- Row interception -----------------------------------------------------

  var processadas = new WeakSet();

  function instrumentarLinha(tr) {
    if (processadas.has(tr)) return;
    processadas.add(tr);

    // Capture phase: fires before jQuery's delegated bubbling handlers.
    tr.addEventListener('click', function () {
      var cnpj = cnpjDaLinha(tr);
      if (!cnpj || !Cnpj.validar(cnpj)) return; // nothing useful found

      // Run async without blocking the page's own handler.
      salvarCnpj(cnpj, nomeDaLinha(tr));
    }, true /* capture */);
  }

  // Presentation only. Which CNPJs may be saved, and the record that gets
  // written, are NFPR.Entidade.salvar's business — shared with the settings
  // form, which used to implement all of it separately and disagreed about
  // unregistered CNPJs (this path saved them anyway).
  async function salvarCnpj(cnpj, nomeHint) {
    try {
      var res = await NFPR.Entidade.salvar(cnpj, { nomeHint: nomeHint });

      if (res.estado === 'nao_registrada') {
        mostrarToast(
          'Este CNPJ não está cadastrado como entidade no Nota Paraná e não foi adicionado.',
          'err'
        );
        return;
      }
      if (res.estado === 'duplicada') {
        mostrarToast('Esta entidade já está cadastrada (' + Cnpj.formatar(cnpj) + ').', 'ok');
        return;
      }
      mostrarToast('✓ ' + (res.entidade.nome || NFPR.Cnpj.formatar(res.entidade.cnpj)) + ' adicionada ao assistente.', 'ok');
    } catch (err) {
      mostrarToast('Não foi possível adicionar a entidade. Tente novamente.', 'err');
    }
  }

  // ---- NFPR.BuscaSite: opening the site's own search dialog -----------------
  //
  // Verified on the live site: #conteudoPesquisaAvancada is NOT rendered inside
  // #main, so ui.js's replaceChildren() does not destroy it and this feature
  // (plus the row scraping below) keeps working after we mount. It is a
  // standing dependency on the government page's markup, so re-check it with
  //   document.querySelector('#conteudoPesquisaAvancada')
  // if the site ever redesigns this screen.
  //
  // THE LOCK THIS GUARDS AGAINST, because it is the site's bug and not ours,
  // and nothing in our own code would ever hint at it. Pressing the dialog's
  // "Pesquisar" runs the site's pesquisaAvancadaEntidade(), which blocks the
  // dialog with blockUI and POSTs. With the session gone that POST is 302'd
  // cross-origin to authz-sefa.identidadedigital.pr.gov.br, CORS kills it, and
  // the site's own failure handler runs
  //     JSON.parse(jqXHR.responseText)     // responseText is ''
  // which THROWS. jQuery 2.1.4 fires deferred callbacks in a bare loop with no
  // try/catch (3.x added one), so the exception escapes and every callback
  // after it is skipped — including the .always() holding desbloquearTela().
  // The overlay never comes down and the deferred is left mid-firing for good:
  // the dialog is dead until the page is reloaded. See
  // reference/doacao_files/consultaEntidadeDoacaoDocFiscal.js.download.
  //
  // We cannot patch their handler from the isolated world, and we are not going
  // to reach into blockUI's own elements to undo it. What we CAN do is not be
  // there when it happens: the overlay is a child of #conteudoPesquisaAvancada,
  // which is the element WE unhide, so hiding it again takes the overlay with
  // it and costs nothing but the display toggle we set ourselves.
  //
  // So: ask before opening, and ask again the moment they press Pesquisar. Only
  // 'MORTA' acts — a probe that could not reach the server proves nothing, and
  // closing the dialog on a wifi hiccup would be a worse bug than the one being
  // fixed. See Sessao.conferir.
  //
  // WE ONLY CLOSE THE DIALOG AND SAY WHY. The session itself is not this file's
  // to narrate: conferir() announces a proved-dead session, content.js latches
  // it exactly as it does for a note that came back SESSAO, and the volunteer
  // gets the usual bar with the usual "Entrar novamente" — the only control on
  // screen that ends this. A toast of our own saying the same thing would be a
  // second narrator, and this one answers a different question anyway: why
  // nothing opened.
  //
  // The sentence names no diagnosis. This branch is reached on the expired
  // session above AND on the duplicate-session screen, where the login is not
  // expired at all but the site renders its error page instead of the donation
  // form, so #conteudoPesquisaAvancada is simply absent. "Entre novamente" is
  // true of both; "a sessão expirou" would be a guess, and "não está disponível
  // nesta página" — what this said for months — diagnosed the PAGE at the one
  // moment the volunteer is already unsure whether the extension is broken.

  var SEL_DIALOGO = '#conteudoPesquisaAvancada';
  var MSG_SEM_SESSAO = 'Entre novamente no Nota Paraná para buscar entidades no site.';

  var vigia = null; // MutationObserver over the open dialog, or null

  function dialogo() {
    return document.querySelector(SEL_DIALOGO);
  }

  function aberto(d) {
    return !!d && d.style.display !== 'none';
  }

  function pararVigia() {
    if (vigia) {
      vigia.disconnect();
      vigia = null;
    }
  }

  function fecharDialogo(d) {
    pararVigia();
    if (d) {
      d.style.display = 'none';
      d.style.opacity = '';
    }
  }

  /**
   * Ask whether the session survived, and get out of the way if it did not.
   * Re-reads the dialog rather than closing over it: by the time an answer
   * arrives the volunteer may have closed it themselves.
   */
  async function conferirEFechar(aoFalhar) {
    if (!NFPR.Sessao) return;
    if ((await NFPR.Sessao.conferir()) !== 'MORTA') return;

    var d = dialogo();
    if (!aberto(d)) return;
    fecharDialogo(d);
    aoFalhar(MSG_SEM_SESSAO);
  }

  /**
   * abrir({ aoFalhar }) — show the site's search dialog, or say why not.
   *
   * The probe is awaited HERE and only here. Opening first and closing on the
   * answer would flash a dialog open and shut in the common case (the session
   * was already gone when they clicked), which reads as a glitch; the wait is
   * one same-origin GET and invisible. Once it IS open the observer takes over,
   * where awaiting nothing is right — the dialog is already on screen.
   */
  async function abrir(opcoes) {
    var d = dialogo();
    if (!d) {
      opcoes.aoFalhar(MSG_SEM_SESSAO);
      return;
    }
    if (NFPR.Sessao && (await NFPR.Sessao.conferir()) === 'MORTA') {
      opcoes.aoFalhar(MSG_SEM_SESSAO);
      return;
    }

    d.style.display = 'block';
    d.style.opacity = '1';

    // THE KEYBOARD GOES IN WITH IT. Our overlay closed without handing focus
    // back to the registrar precisely so it could land here: left on our entry
    // box, anything typed into what looks like their search form went into the
    // key buffer instead, and a volunteer without a mouse had no way in at all.
    // Focusing their first field is what clicking it does — operating a control
    // they already have, not changing it.
    var primeiro = d.querySelector('select, input:not([type="hidden"]), textarea');
    if (primeiro && typeof primeiro.focus === 'function') primeiro.focus();

    // blockUI appends its overlay INTO the blocked element, so a .blockUI child
    // appearing is "they pressed Pesquisar" — the exact moment the lock is
    // decided. It shows up on a healthy search too; conferir() is single-flight
    // and the answer is then 'VIVA', which does nothing.
    pararVigia();
    vigia = new MutationObserver(function () {
      if (d.querySelector('.blockUI')) conferirEFechar(opcoes.aoFalhar);
    });
    vigia.observe(d, { childList: true, subtree: true });
  }

  NFPR.BuscaSite = { abrir: abrir };

  // ---- MutationObserver on the results tbody --------------------------------
  //
  // The official modal has a table whose tbody receives <tr> elements when
  // results are returned.  We watch document.body with subtree:true and filter
  // for <tr> additions inside that tbody.
  //
  // The tbody is identified by its closest ancestor matching the modal's known
  // container selector.  Known selectors (best-effort; adjust if the page ever
  // changes its markup):
  //   - div#modalConsultaEntidade  (Bootstrap modal id used by the page)
  //   - Any element containing ConsultaEntidade in its id/class
  //
  // Fallback: any <tr> appended to a <tbody> that lives inside an element
  // whose id or class contains "Entidade" or "entidade".

  var RE_MODAL_ID = /[Ee]ntidade/;

  function dentroDoModalEntidade(el) {
    var node = el.parentElement;
    while (node && node !== document.body) {
      var id  = node.id  || '';
      var cls = node.className || '';
      if (RE_MODAL_ID.test(id) || RE_MODAL_ID.test(cls)) return true;
      node = node.parentElement;
    }
    return false;
  }

  var observer = new MutationObserver(function (mutations) {
    for (var m = 0; m < mutations.length; m++) {
      var added = mutations[m].addedNodes;
      for (var n = 0; n < added.length; n++) {
        var node = added[n];
        if (node.nodeType !== 1) continue; // elements only

        // Direct <tr> added to a results tbody inside the entity modal.
        if (node.tagName === 'TR' && dentroDoModalEntidade(node)) {
          instrumentarLinha(node);
          continue;
        }

        // A container node was added that itself contains <tr>s (e.g. a <tbody>
        // or the modal itself was injected into the DOM dynamically).
        if (node.querySelectorAll) {
          var trs = node.querySelectorAll('tr');
          for (var t = 0; t < trs.length; t++) {
            if (dentroDoModalEntidade(trs[t])) {
              instrumentarLinha(trs[t]);
            }
          }
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

})();
