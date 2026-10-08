/**
 * site.js  (shared)
 * -----------------------------------------------------------------------------
 * Everything this extension knows about the shape of the Nota Paraná site, in
 * one place: the URLs it talks to, the one sentence it recognises, and how
 * long it waits for an answer.
 *
 * These literals used to be spread across five JS files (the donation URL) and
 * defined twice with identical source (the duplicate-session regex), so a
 * change on the government side meant editing six places and missing one.
 *
 * MUST be loaded immediately after browser.js — conta-corrente.js, donation.js,
 * entidade.js, ui.js, entrada.js and popup.js all read from it.
 *
 * DELIBERATE EXCEPTION: src/background/service-worker.js keeps its own copies of
 * the donation URL. It is import-free on purpose, so the one file can run as a
 * Chrome service worker AND as a Firefox event page. If you change URL_DOACAO,
 * change DNR_URL_FILTER and NAV_FILTRO_DOACAO there too.
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  const NFPR = (root.NFPR = root.NFPR || {});

  const BASE = 'https://notaparana.pr.gov.br/nfprweb/';

  NFPR.Site = {
    /** The site's own entry point — where its "Início" link goes. */
    URL_INICIO: BASE,

    /** The manual-donation registrar — our host page, and the login target. */
    URL_DOACAO: BASE + 'DoacaoDocumentoFiscalCadastrar',

    /** JSON endpoint a single donation is POSTed to. */
    URL_API_DOACAO: BASE + 'app/v1/documentoFiscalDoadoWeb',

    /** The URL the site's own "encerrar sessões" button uses. */
    URL_SAIR: BASE + 'publico/sair',

    /** Entity lookup by CNPJ; append the 14 bare digits. */
    URL_ENTIDADE_POR_CNPJ: BASE + 'app/v1/documentoFiscalDoado/entidadePorCnpj/',

    /**
     * The exact sentence on the server's duplicate-session error screen. Match
     * on this and never on the word "encerrar" alone, which legitimate page
     * chrome could also contain.
     */
    RE_SESSAO_DUPLICADA: /mais de uma sess[aã]o ativa/i,

    /**
     * How long the site gets to answer a request of ours, BODY INCLUDED — past
     * this it counts as not answering. Here because three files ask it things
     * (donation.js, entidade.js, sessao.js) and each used to have its own idea,
     * two of them "for ever". The connectivity probe keeps its own, shorter
     * one; /sair has none at all, on purpose (see DOCS.md).
     *
     * BODY INCLUDED is the half that was missing: a timer cleared when the
     * headers arrive leaves `text()` and `json()` unbounded, and a body that
     * stalls then holds its caller for ever — six of them, the whole send pool.
     */
    PRAZO_RESPOSTA_MS: 20000
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
