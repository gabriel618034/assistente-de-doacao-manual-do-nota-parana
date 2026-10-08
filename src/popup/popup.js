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

    // SITE ACCESS MAY NOT HAVE BEEN GRANTED. Firefox before 127 installs an MV3
    // extension with its host permissions switched off, and any Firefox lets
    // them be switched off later: the content scripts then never run, and the
    // donation page is simply the government's own, with nothing saying why.
    // This window is the one surface that still works, so the notice is here.
    // Everywhere the permission is in place it never shows.
    //
    // A button of its own, not a step inside "Abrir a página de doação":
    // Firefox may close the popup when its prompt appears, and whatever was
    // to run after the answer would never run. The grant is kept either way.
    var aviso = document.getElementById('pop-permissao');
    var permitir = document.getElementById('pop-permitir');
    if (aviso && permitir && api.permissions) {
      var ORIGENS = { origins: api.runtime.getManifest().host_permissions || [] };
      var conferir = function () {
        api.permissions.contains(ORIGENS).then(function (tem) {
          aviso.hidden = !!tem;
        }).catch(function () {});
      };
      conferir();
      // Nothing may be awaited before the request: the browser only honours it
      // while the click is still the current gesture.
      permitir.addEventListener('click', function () {
        api.permissions.request(ORIGENS).then(conferir).catch(function () {});
      });
      if (api.permissions.onAdded) api.permissions.onAdded.addListener(conferir);
      if (api.permissions.onRemoved) api.permissions.onRemoved.addListener(conferir);
    }

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
