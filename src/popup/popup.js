/**
 * popup.js — toolbar popup bootstrap.
 * Mounts the shared SettingsUI and offers a one-click way to open the donation
 * page. All persistence flows through NFPR.Config, so changes here appear live
 * inside the on-page modal too.
 */
(function () {
  'use strict';
  var NFPR = globalThis.NFPR;
  var api = NFPR.api;
  var PAGINA = NFPR.Site.URL_DOACAO;

  document.addEventListener('DOMContentLoaded', function () {
    var icone = document.getElementById('pop-brand-icon');
    if (icone) icone.replaceWith(NFPR.iconeMarca('pop-brand-icon'));

    var root = document.getElementById('pop-root');
    if (root) NFPR.SettingsUI.montar(root, {});
    // Name any entity saved without the registry's answer. Cross-origin from
    // here, so it often cannot ask — then nothing changes and the live page
    // asks again on its next load.
    NFPR.Entidade.completarNomes().catch(function () {});

    var versao = document.getElementById('pop-versao');
    try {
      if (versao && api.runtime.getManifest) {
        versao.textContent = 'v' + api.runtime.getManifest().version;
      }
    } catch (e) {}

    var botao = document.getElementById('pop-abrir-site');
    if (botao) {
      botao.addEventListener('click', async function () {
        try {
          await api.tabs.create({ url: PAGINA });
          if (window.close) window.close();
        } catch (e) {
          window.open(PAGINA, '_blank');
        }
      });
    }
  });
})();
