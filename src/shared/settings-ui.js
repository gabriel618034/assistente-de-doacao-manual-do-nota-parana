/**
 * settings-ui.js  (shared by the in-modal config page AND the toolbar popup)
 * -----------------------------------------------------------------------------
 * Composes the configuration sections into any container and keeps them
 * in step with storage. Writing it once and reusing it means the popup, the
 * on-page modal and the offline page can never disagree — they all read and
 * write the same chrome.storage.
 *
 *   NFPR.SettingsUI.montar(container, { abrirBuscaSite? })
 *
 * `abrirBuscaSite` opens the government page's own entity-search dialog. Only
 * the live page can provide it; the popup and the offline page pass nothing and
 * the button simply is not rendered, which is clearer than a runtime
 * "not available" error.
 *
 * Nothing is returned: the form owns its storage subscription for its whole
 * life, and every host mounts it once into a container it never tears down.
 *
 * This file used to be 536 lines holding all three forms — the entity section
 * alone was 211 — plus the render and persist plumbing. The sections share
 * nothing but this container, so they became files of their own. The fixed part
 * one is gone entirely: fixed parts are not configuration.
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  var NFPR = (root.NFPR = root.NFPR || {});
  var Config = NFPR.Config;

  function montar(container, opcoes) {
    opcoes = opcoes || {};
    container.classList.add('nfpr-settings');
    container.innerHTML = '';

    // TWO SECTIONS, NOT THREE. Fixed parts left configuration: they are working
    // state with a lifetime of one sitting, and they live on the registrar's
    // own strip now (src/content/strip-parte-fixa.js), beside the 44 cells that
    // show what they do.
    var secoes = [NFPR.secaoEntidades(opcoes), NFPR.secaoPreferencias(opcoes)];
    secoes.forEach(function (s) {
      container.appendChild(s.elemento);
    });

    function render(cfg) {
      secoes.forEach(function (s) {
        s.render(cfg);
      });
    }

    // Every write goes through Config.atualizarConfig, which fires a storage
    // change — so this one subscription repaints whoever wrote it, us or
    // another surface. The add-forms are built once and never re-rendered, so a
    // repaint cannot wipe what the volunteer is mid-typing.
    Config.aoMudar(async function (tipo) {
      if (tipo !== 'config') return;
      render(await Config.obterConfig());
    });

    Config.obterConfig().then(render); // initial paint
  }

  NFPR.SettingsUI = { montar: montar };
})(typeof globalThis !== 'undefined' ? globalThis : self);
