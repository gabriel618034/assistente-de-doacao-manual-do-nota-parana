/**
 * conta-corrente.js
 * -----------------------------------------------------------------------------
 * Runs only on /nfprweb/ContaCorrente. When the server renders the
 * "Ops! O usuário autenticado possui mais de uma sessão ativa." error screen,
 * this script simply redirects to the donation page — where the assistant's UI
 * detects the same screen, fires /nfprweb/publico/sair, and carries on. Keeping
 * the /sair logic in one place (sessao.js) avoids two competing requests.
 *
 * Respects the `encerrarSessoesDuplicadas` preference — if off, does nothing.
 * -----------------------------------------------------------------------------
 */
(function () {
  'use strict';

  const { URL_DOACAO, RE_SESSAO_DUPLICADA } = globalThis.NFPR.Site;

  async function run() {
    const corpo = document.body ? document.body.textContent : '';
    if (!RE_SESSAO_DUPLICADA.test(corpo)) return;

    const cfg = await globalThis.NFPR.Config.obterConfig();
    if (cfg.preferencias.encerrarSessoesDuplicadas === false) return;

    window.location.replace(URL_DOACAO);
  }

  run();
})();
