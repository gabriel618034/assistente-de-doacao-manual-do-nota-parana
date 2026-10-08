/**
 * ui.js  (content + offline page)
 * -----------------------------------------------------------------------------
 * Composes the two on-page surfaces and mounts them in three closed Shadow
 * DOMs, so the government site's CSS can neither bleed in nor be disturbed:
 *
 *   NFPR.Painel  the REGISTRAR, mounted inside the page's <div id="main">
 *                (or opcoes.montarEm). The everyday surface.
 *   NFPR.Modal   the settings/help overlay, fixed over the viewport.
 *
 * ...and the registrar's HEADER STRIP, which is part of NFPR.Painel but gets a
 * root of its own on the live page, because it is mounted into the government
 * page's #header rather than onto the panel. Two headers stacked to 191-212px
 * of chrome above the first result row; they are one 54px bar now. host-page.js
 * restyles the bar, this file puts our half of it in place.
 *
 * They know nothing about each other; this file is where they meet. The panel
 * asks for settings, the modal hands focus back to the panel on close and
 * borrows its inline toast for the one error it can raise.
 *
 * NFPR.UI.montar(opcoes) -> Promise<api>
 *
 * `opcoes.modoOffline` (default falsy) adapts both to the bundled offline page
 * (src/offline/entrada.html), which loads everything EXCEPT NFPR.Donation: it
 * mounts into `opcoes.montarEm` instead of #main, omits the "search entity on
 * the site" settings button (no host page to open the site's dialog in — same
 * situation as the toolbar popup), and keeps the
 * connection bar permanently visible.
 *
 * This file used to BE both surfaces: one 736-line function holding ~25 free
 * variables, DOM construction, layout measurement, a network request and three
 * widget state machines.
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  var NFPR = (root.NFPR = root.NFPR || {});
  var el = NFPR.el; // shared DOM builder (src/shared/dom.js)

  async function montar(opcoes) {
    opcoes = opcoes || {};

    // ---- Stylesheet text (injected into BOTH shadow roots) -------------------
    // Both roots get the same set. Narrowing it per root (the registrar does
    // not need modal.css, and vice versa) is deliberately NOT done: the
    // registrar renders .nfpr-btn/.nfpr-mono from settings.css, so the split
    // would not fall along file lines and one missed rule stays invisible until
    // a volunteer hits it on the live site.
    //
    // Each fetch resolves to a string (worst case an empty one), so Promise.all
    // cannot reject and needs no outer guard.
    var fontes = [
      NFPR.url('src/shared/tokens.css'), // first: everything below reads these
      NFPR.url('src/content/base.css'),
      NFPR.url('src/content/registrar.css'),
      NFPR.url('src/content/modal.css'),
      NFPR.url('src/shared/settings.css')
    ];
    var textos = await Promise.all(
      fontes.map(function (u) {
        return fetch(u)
          .then(function (r) {
            return r.text();
          })
          .catch(function () {
            return '';
          });
      })
    );
    var estilosTexto = textos.join('\n');

    function novoShadow(host, classe) {
      host.className = classe;
      host.style.cssText = 'all: initial;';
      // Closed, as CLAUDE.md and DOCS.md have always claimed: the host page
      // cannot reach in via .shadowRoot. Nothing in this codebase reads it.
      var sh = host.attachShadow({ mode: 'closed' });
      if (estilosTexto) sh.appendChild(el('style', { text: estilosTexto }));
      return sh;
    }

    // ---- Is there a bar to merge into? ---------------------------------------
    // The government page's own #header, restyled into a single 54px row by
    // host-page.js at document_start. When it is there, the registrar's header
    // strip goes INTO it rather than on top of the panel, and the two stacked
    // headers become one — which is the whole of Phase Lantern.
    //
    // Asked BEFORE the panel is built, because the panel composes its header
    // differently for the two homes. Absent on the offline page (no host page)
    // and absent if the site ever ships this screen without a header: the strip
    // then simply stays where it has always been, which is why this is a
    // question rather than an assumption.
    var barra = opcoes.modoOffline ? null : document.getElementById('header');

    // ---- The two surfaces ----------------------------------------------------
    // `modal` is assigned below but referenced in the panel's callback, which
    // only ever runs on a click — long after both exist.
    var modal;
    var painel = NFPR.Painel.criar({
      cabecalhoSeparado: !!barra,
      modoOffline: opcoes.modoOffline,
      conexaoPermanente: opcoes.conexaoPermanente,
      acaoConexao: opcoes.acaoConexao,
      // `pagina` lets the panel ask for a specific page — the debug banner's
      // "Cuidado!" link asks for 'depuracao', the failures bar for 'falhas'.
      // Everything else passes nothing and lands on the config page as before.
      aoPedirConfig: function (pagina) {
        modal.api.abrir(pagina || 'config');
      }
    });

    var mainHost = el('div', { id: 'nfpr-host' });
    modal = NFPR.Modal.criar({
      modoOffline: opcoes.modoOffline,
      hospedeiro: mainHost,
      aoFechar: painel.api.focarEntrada,
      mostrarErro: painel.api.mostrarErro,
      // The panel is the surface that watches notes settle, so it owns the list
      // of ones that failed; the modal only draws it, and pulls it on open.
      listarFalhas: painel.api.listarFalhas,
      // Clearing goes the other way: the caller owns storage (modal.js and
      // painel.js both read none), and the panel's bar is repainted from
      // whatever comes back. BOTH registrars pass it: the offline page never
      // adds a failure, but the shared bootstrap lists them there too. The
      // fallback exists for harnesses only — it empties the bar, not storage.
      aoLimparFalhas: function () {
        return Promise.resolve(
          opcoes.aoLimparFalhas ? opcoes.aoLimparFalhas() : []
        ).then(function (restam) {
          painel.api.setFalhas(restam || []);
          return restam || [];
        });
      }
    });

    // ---- Mount ---------------------------------------------------------------
    // The registrar goes into the caller's container when given (the offline
    // page), otherwise into the live page's #main (assumed present on load).
    var regHost = el('div', { id: 'nfpr-registrar-host' });
    novoShadow(regHost, 'nfpr-registrar-host').appendChild(painel.elemento);
    var alvo = opcoes.montarEm || document.getElementById('main');
    if (alvo) alvo.replaceChildren(regHost);
    else (document.body || document.documentElement).appendChild(regHost);

    // The header strip, into the government header. A THIRD shadow root rather
    // than markup in their document: the bar is theirs, the chip in it is ours,
    // and their stylesheet must not reach it any more than it reaches the panel.
    //
    // We INSERT and never move: their own controls stay their own nodes, so
    // their jQuery handlers, their account dropdown and their /sair keep
    // working with no help from us. (Moving #user-info in here instead would
    // have been tidier to style and quietly fatal — their toggle looks the
    // dropdown up with $('.user-config-options'), a document query, which
    // cannot see into a shadow tree.)
    //
    // Before #system-info so the row reads logo · ours · theirs; appended if
    // that element is missing, which still lands it after the logo.
    if (barra) {
      var cabHost = el('div', { id: 'nfpr-cabecalho-host' });
      novoShadow(cabHost, 'nfpr-cabecalho-host').appendChild(painel.cabecalho);
      var antesDe = document.getElementById('system-info');
      if (antesDe && antesDe.parentNode === barra) barra.insertBefore(cabHost, antesDe);
      else barra.appendChild(cabHost);
      // #header is hidden by host-page.js's anti-flash sheet until revelar()
      // below, so the bar and the chip in it appear together and neither can
      // flash alone.
    }

    var overlayShadow = novoShadow(mainHost, 'nfpr-overlay-host');
    modal.elementos.forEach(function (e) {
      overlayShadow.appendChild(e);
    });
    (document.documentElement || document.body).appendChild(mainHost);

    // #main was hidden at document_start (see host-page.js) to avoid a flash
    // of the raw server-rendered form; now that it holds our content, reveal it.
    if (root.__nfprHostPage) root.__nfprHostPage.revelar();

    // The one RESTYLING of the government page this file does, and it is
    // deliberate: the registrar is sized to the viewport, so the host page's
    // scrollbar would sit next to a panel that never scrolls. Recorded as an
    // exception in CLAUDE.md, which otherwise promises we never mutate the host
    // document. (The mounts above — #main's children and the header host — are
    // the other half of that exception, and are mounts rather than restyling.)
    document.documentElement.style.setProperty('scrollbar-width', 'none');
    // The same exception in its older spelling. Chromium only learned
    // `scrollbar-width` in 121, and the floor here is 109: there the line above
    // does nothing and the page's scrollbar sits beside the panel. Only on an
    // engine that lacks the property, so everywhere else the host document
    // carries exactly what it always did.
    if (!(root.CSS && root.CSS.supports && root.CSS.supports('scrollbar-width', 'none'))) {
      var semBarra = document.createElement('style');
      semBarra.textContent = 'html::-webkit-scrollbar{display:none !important}';
      document.documentElement.appendChild(semBarra);
    }

    // Now that the panel is in the document it can measure where it starts.
    requestAnimationFrame(painel.api.ajustarAltura);
    root.addEventListener('resize', painel.api.ajustarAltura);

    // ---- One public API ------------------------------------------------------
    return Object.assign({}, painel.api, modal.api);
  }

  // `instancia` is the mounted registrar, published so modal-entidade.js can
  // reach the floating toast. Exactly one registrar exists per page.
  NFPR.UI = {
    instancia: null,
    montar: async function (opcoes) {
      NFPR.UI.instancia = await montar(opcoes);
      return NFPR.UI.instancia;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
