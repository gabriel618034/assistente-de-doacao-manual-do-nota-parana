/**
 * service-worker.js  (background)
 * -----------------------------------------------------------------------------
 * Intentionally standalone (no imports / importScripts) so the exact same file
 * runs as an MV3 service worker (Chrome/Edge) AND as an event page (Firefox,
 * which does not run MV3 service workers). Both keys live side by side in the
 * single manifest.json — `background.service_worker` plus `background.scripts`:
 * Chrome ≥121 uses the worker and ignores `scripts`; Firefox does the reverse.
 * That is for Load unpacked / Load Temporary Add-on only: neither store accepts
 * the other browser's key, so `tools/empacotar.js` writes one package per store
 * with the foreign key removed. Same file inside both.
 *
 * Two independent jobs, kept deliberately separate below:
 *
 *   1. BADGE — mirror the number of keys pending in the durable queue onto the
 *      toolbar icon, so a volunteer can tell at a glance that something is
 *      still waiting to be sent — even with the modal closed. A red "DEV"
 *      replaces the count while debug mode is armed (src/shared/debug.js).
 *
 *   2. OFFLINE FALLBACK — when the donation page cannot load (no connection,
 *      or the site itself is down), land the volunteer on the bundled offline
 *      registrar (src/offline/entrada.html) instead of the browser's dead-end
 *      native error page. Two layers, covering different failure modes.
 *
 * All real work (capture, validation, donation) happens in the content script
 * or on the offline page.
 * -----------------------------------------------------------------------------
 */
'use strict';

var api = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;
var FILA_KEY = 'nfpr:fila';
var DEBUG_KEY = 'nfpr:debug';

// =============================================================================
// 1. BADGE
// =============================================================================

// Last known values for both inputs, because each arrives from its own storage
// event and the badge is drawn from the pair.
var pendentes = 0;
var emDepuracao = false;

/**
 * DEBUG OUTRANKS THE QUEUE. While the mode is armed, the toolbar icon says
 * "DEV" in red instead of the pending count: it is the only signal visible with
 * the registrar closed and every other window in front of it, and a machine
 * left armed is the failure that actually costs something. The count is one
 * click away in the popup; the warning is not.
 *
 * This file deliberately reads the raw key rather than importing debug.js — it
 * stays standalone so the one file runs as a Chrome service worker AND a
 * Firefox event page (see the banner above). Same reasoning as the duplicated
 * donation URL below.
 */
function pintarBadge() {
  try {
    if (emDepuracao) {
      api.action.setBadgeText({ text: 'DEV' });
      api.action.setBadgeBackgroundColor({ color: '#df4338' });
      api.action.setBadgeTextColor({ color: '#ffffff' });
      return;
    }
    api.action.setBadgeText({ text: pendentes > 0 ? String(pendentes) : '' });
    api.action.setBadgeBackgroundColor({ color: '#c5810b' });
    api.action.setBadgeTextColor({ color: '#ffffff' });
  } catch (e) {
    /* badge is best-effort — setBadgeTextColor in particular is not on every
       engine, and losing the badge must never take the worker down with it */
  }
}

async function sincronizarBadge() {
  try {
    var r = await api.storage.local.get([FILA_KEY, DEBUG_KEY]);
    var fila = r && Array.isArray(r[FILA_KEY]) ? r[FILA_KEY] : [];
    pendentes = fila.length;
    emDepuracao = !!(r && r[DEBUG_KEY] && r[DEBUG_KEY].ativo);
  } catch (e) {
    pendentes = 0;
    emDepuracao = false;
  }
  pintarBadge();
}

api.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  if (!changes[FILA_KEY] && !changes[DEBUG_KEY]) return;
  if (changes[FILA_KEY]) {
    var novo = changes[FILA_KEY].newValue;
    pendentes = Array.isArray(novo) ? novo.length : 0;
  }
  if (changes[DEBUG_KEY]) {
    var dbg = changes[DEBUG_KEY].newValue;
    emDepuracao = !!(dbg && dbg.ativo);
  }
  pintarBadge();
});

// =============================================================================
// 2. OFFLINE FALLBACK
// =============================================================================

var PAGINA_OFFLINE = 'src/offline/entrada.html';
var REGRA_OFFLINE_ID = 1;

// Same navigation, expressed twice: declarativeNetRequest wants a urlFilter
// string, webNavigation wants a URL-parts event filter.
//
// These are DELIBERATE copies of NFPR.Site.URL_DOACAO (src/shared/site.js).
// This file stays import-free so the one file can run as a Chrome service
// worker and a Firefox event page — so if the donation URL ever changes, it has
// to change here too.
var DNR_URL_FILTER = '||notaparana.pr.gov.br/nfprweb/DoacaoDocumentoFiscalCadastrar';
var NAV_FILTRO_DOACAO = {
  url: [{ hostEquals: 'notaparana.pr.gov.br', pathPrefix: '/nfprweb/DoacaoDocumentoFiscalCadastrar' }]
};

// User pressed Stop / navigated away mid-load — hijacking that would be hostile.
//
// Firefox does not report the name. WebNavigation.sys.mjs builds the field as
// `Error code ${status}` from the raw nsresult, which reaches JS as an unsigned
// number, so a stopped load arrives as "Error code 2152398850" — decimal.
// Spelled from the hex so the constant can be looked up; a literal
// '0x804B0002' would never match either. 'NS_BINDING_ABORTED' stays for any
// build that ever reports the name.
var ERROS_CANCELAMENTO = [
  'net::ERR_ABORTED',
  'NS_BINDING_ABORTED',
  'Error code ' + 0x804B0002
];

/**
 * Layer A — no network interface at all (airplane mode / no signal).
 *
 * Keep exactly one dynamic DNR rule that redirects main-frame navigations to
 * the donation page over to the offline page, active only while
 * `navigator.onLine` is false. With the rule in place the redirect happens
 * before the request ever leaves the browser: no error page, not even a flash.
 *
 * The global online/offline events are NOT the mechanism here — they are
 * unreliable in MV3 workers and a suspended worker/event page misses them
 * entirely. Instead this function re-reads navigator.onLine and reconciles the
 * rule at every reliable wake point: worker top level, onInstalled/onStartup,
 * and onBeforeNavigate for the donation URL (which wakes the worker on exactly
 * the navigations we care about). Honest caveat: a rule toggled from
 * onBeforeNavigate usually lands too late for that same navigation, so the
 * FIRST offline navigation after connectivity drops tends to fall through to
 * Layer B; the ones after it are flash-free.
 *
 * Idempotent: compares desired vs. current rule state before writing.
 */
async function reconciliarRegraOffline() {
  try {
    var dnr = api.declarativeNetRequest;
    if (!dnr) return;
    var deveEstarAtiva = self.navigator && self.navigator.onLine === false;
    var regras = await dnr.getDynamicRules();
    var estaAtiva = regras.some(function (r) {
      return r.id === REGRA_OFFLINE_ID;
    });
    if (deveEstarAtiva === estaAtiva) return; // already in the desired state

    if (deveEstarAtiva) {
      await dnr.updateDynamicRules({
        removeRuleIds: [REGRA_OFFLINE_ID],
        addRules: [
          {
            id: REGRA_OFFLINE_ID,
            priority: 1,
            action: { type: 'redirect', redirect: { extensionPath: '/' + PAGINA_OFFLINE } },
            condition: { urlFilter: DNR_URL_FILTER, resourceTypes: ['main_frame'] }
          }
        ]
      });
    } else {
      await dnr.updateDynamicRules({ removeRuleIds: [REGRA_OFFLINE_ID] });
    }
  } catch (e) {
    /* Layer B still catches the navigation if the rule couldn't be written */
  }
}

if (api.webNavigation && api.webNavigation.onBeforeNavigate) {
  api.webNavigation.onBeforeNavigate.addListener(function (details) {
    if (details.frameId !== 0) return;
    reconciliarRegraOffline();
  }, NAV_FILTRO_DOACAO);
}

// Opportunistic extra while the worker happens to be awake — never the
// mechanism (see reconciliarRegraOffline).
self.addEventListener('online', reconciliarRegraOffline);
self.addEventListener('offline', reconciliarRegraOffline);

/**
 * Layer B — network up, but the site is unreachable or timing out
 * (navigator.onLine stays true there, so Layer A never fires). Also the
 * backstop for Layer A's first-navigation race, since extension events DO wake
 * a sleeping worker. Reacting to a navigation that already failed means the
 * browser's native error page may flash briefly before the swap — an inherent
 * limit of this path; Layer A exists precisely to avoid it when it can.
 */
if (api.webNavigation && api.webNavigation.onErrorOccurred) {
  api.webNavigation.onErrorOccurred.addListener(async function (details) {
    if (details.frameId !== 0) return; // main frame only
    if (ERROS_CANCELAMENTO.indexOf(details.error) !== -1) return;
    try {
      // No "already there" guard: this listener is filtered to the donation URL,
      // so details.url is never our offline page, and tab.url (the old guard)
      // is only populated with the "tabs" permission or a host permission
      // matching that tab — neither of which this manifest declares, so it read
      // undefined and fell through anyway. The one case it was reaching for is
      // the offline page's own "Abrir o site" button failing, and landing back
      // on a freshly-loaded offline page is the right outcome there: the strip
      // re-probes on load.
      await api.tabs.update(details.tabId, { url: api.runtime.getURL(PAGINA_OFFLINE) });
    } catch (e) {
      /* tab may already be gone */
    }
  }, NAV_FILTRO_DOACAO);
}

// =============================================================================
// Wake-up work (badge + rule reconcile run on every worker start)
// =============================================================================

// onStartup is the one registration that earns its keep: it forces a worker
// wake at browser launch, so the badge is already correct before any page is
// opened. onInstalled needs no listener — installing starts the worker, which
// runs the two top-level calls below.
if (api.runtime.onStartup) {
  api.runtime.onStartup.addListener(function () {
    sincronizarBadge();
    reconciliarRegraOffline();
  });
}

sincronizarBadge();
reconciliarRegraOffline();
