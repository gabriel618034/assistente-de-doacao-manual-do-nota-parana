/**
 * connectivity.js  (live page + offline page)
 * -----------------------------------------------------------------------------
 * The single answer to "can we reach notaparana.pr.gov.br right now?", shared by
 * the on-page registrar and the bundled offline page. It used to be written
 * twice — here and in entrada.js — with the same constants, the same "any answer
 * under 500 counts" rule and the same navigator.onLine rule, enforced by nothing
 * but a comment saying the two must agree. They had already drifted.
 *
 * THE navigator.onLine RULE. It is only believed when it says FALSE. It reports
 * the network *interface*, not the internet: with the router unplugged (or on a
 * machine with any virtual adapter — VirtualBox, VMware, Hyper-V, WSL) it stays
 * true while nothing is reachable. So "we are back" must always be PROVEN by a
 * probe that actually reaches the site.
 *
 * WHAT COUNTS AS REACHABLE. Any real HTTP answer below 500, including a login
 * redirect. redirect:'manual' keeps a session-expired redirect to another origin
 * from tripping CORS and masquerading as "server down" — an `opaqueredirect`
 * answer proves the server is alive. A stale session is somebody else's problem;
 * the resend will surface the proper message.
 *
 * TWO MODES, one implementation:
 *
 *   reactive (default) — the live page. Passive while everything works: no
 *   polling, zero requests. Starts probing only after informarQueda() (a send
 *   failed with REDE/SERVIDOR) or a browser `offline` event, and goes quiet the
 *   moment the site answers, so the queue can be resent.
 *
 *   proativo: true — the offline page. Starts probing on load, because there is
 *   no send whose failure could tell us anything, and the page's whole job is to
 *   notice when the way back opens up.
 *
 * NFPR.Connectivity.iniciar({
 *   urlSonda,          // required
 *   proativo,          // probe from the start instead of waiting for a failure
 *   permitirOpaco,     // allow the no-cors fallback (see below)
 *   aoCair(motivo),    // 'REDE' (no interface) | 'SERVIDOR' (interface, no site)
 *   aoVoltar()         // proven reachable again
 * }) -> { informarQueda(codigo), estaForaDoAr(), verificarAgora(), parar() }
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  const NFPR = (root.NFPR = root.NFPR || {});

  const INTERVALO_INICIAL = 4000;
  const INTERVALO_MAXIMO = 30000;
  const FATOR_BACKOFF = 1.6;
  const TIMEOUT_SONDA = 8000; // a probe that hangs this long counts as "still down"

  /**
   * Is there a network interface at all? navigator.onLine, except that debug
   * mode can answer for it (src/shared/debug.js).
   *
   * ONE helper rather than a check bolted onto the probe, because every rule in
   * this file that asks navigator.onLine has to get the same answer: the probe
   * that decides reachability, the shortcut that skips a doomed request, and
   * the one that names an outage REDE or SERVIDOR. Forcing only the first left
   * a simulated outage reporting itself as "site fora do ar" on the second
   * probe, which is not what "sem conexão" means.
   */
  function interfaceViva() {
    const forcado = NFPR.Debug.valor('forcarConexao');
    if (forcado) return forcado === 'online';
    return navigator.onLine;
  }

  /** One request. True if the site answered at all in a way that proves it is up. */
  async function sondaHttp(url, extra) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_SONDA);
    try {
      const resp = await fetch(
        url,
        Object.assign({ credentials: 'include', cache: 'no-store', signal: ctl.signal }, extra)
      );
      // Opaque answers carry no status — resolving at all is the proof.
      if (resp.type === 'opaque' || resp.type === 'opaqueredirect') return true;
      return resp.status < 500;
    } catch {
      return false; // unreachable, DNS failure, blocked, or hung past the timeout
    } finally {
      clearTimeout(timer);
    }
  }

  function iniciar(opcoes) {
    opcoes = opcoes || {};
    let foraDoAr = false;
    let motivo = null; // 'REDE' | 'SERVIDOR'
    let timer = null;
    let intervalo = INTERVALO_INICIAL;
    let sondando = false;

    // Firefox MV3 leaves host permissions opt-in, and without the grant the
    // probe is blocked before it ever leaves the browser — which looks exactly
    // like "network dead" and would strand the caller on "down" forever. An
    // opaque (no-cors) request needs no permission: it cannot report a status,
    // but a response that RESOLVES proves the round trip really happened. Tried
    // only as a fallback, and remembered once it works so the normal Chrome
    // path stays a single request. Off unless the caller asks for it — the live
    // page is same-origin and never needs it.
    let modoOpaco = false;

    async function alcancaSite() {
      // 'online' proves reachability without a request, which is the point: it
      // has to work with the router unplugged.
      if (NFPR.Debug.valor('forcarConexao') === 'online') return true;
      if (!interfaceViva()) return false; // no interface at all — don't waste a request
      if (modoOpaco) return sondaHttp(opcoes.urlSonda, { mode: 'no-cors' });
      if (await sondaHttp(opcoes.urlSonda, { redirect: 'manual' })) return true;
      if (opcoes.permitirOpaco && (await sondaHttp(opcoes.urlSonda, { mode: 'no-cors' }))) {
        modoOpaco = true;
        return true;
      }
      return false;
    }

    function agendar() {
      clearTimeout(timer);
      timer = setTimeout(sondar, intervalo);
      intervalo = Math.min(Math.round(intervalo * FATOR_BACKOFF), INTERVALO_MAXIMO);
    }

    /** Note a failed check and tell the caller, but only when something changed. */
    function registrarQueda(codigo) {
      const anterior = motivo;
      const primeiraVez = !foraDoAr;
      foraDoAr = true;
      motivo = codigo || (interfaceViva() ? 'SERVIDOR' : 'REDE');
      if ((primeiraVez || motivo !== anterior) && opcoes.aoCair) opcoes.aoCair(motivo);
      return primeiraVez;
    }

    function registrarVolta() {
      if (!foraDoAr) return;
      foraDoAr = false;
      motivo = null;
      clearTimeout(timer);
      intervalo = INTERVALO_INICIAL;
      if (opcoes.aoVoltar) opcoes.aoVoltar();
    }

    async function sondar() {
      if (!foraDoAr) return;
      if (sondando) {
        // A probe allows itself TIMEOUT_SONDA, so a request arriving during one
        // is ordinary — and whoever asked has usually just cleared the pending
        // timer. Dropping it silently would stop the loop for good (F3).
        agendar();
        return;
      }

      // The browser already knows there's no internet — don't waste a request.
      if (!interfaceViva()) {
        registrarQueda('REDE');
        agendar();
        return;
      }

      sondando = true;
      let respondeu;
      try {
        respondeu = await alcancaSite();
      } finally {
        sondando = false;
      }

      if (!foraDoAr) return; // state changed while the probe was in flight
      if (respondeu) registrarVolta();
      else {
        registrarQueda(null);
        agendar();
      }
    }

    /**
     * The caller saw a send fail with a REDE/SERVIDOR error.
     * Returns true if this call is what flipped the state to "down"
     * (useful to alert once instead of once per queued note).
     */
    function informarQueda(codigo) {
      const primeiraVez = registrarQueda(codigo === 'REDE' ? 'REDE' : 'SERVIDOR');
      if (primeiraVez) {
        intervalo = INTERVALO_INICIAL;
        agendar();
      }
      return primeiraVez;
    }

    /**
     * Check right now, off the backoff schedule, and report it. The offline
     * page's "Abrir o site" button uses this: on a flaky link the connection
     * may have died again since the probe that turned the strip green, and a
     * failed navigation would just bounce the volunteer back to that page.
     */
    async function verificarAgora() {
      const respondeu = await alcancaSite();
      if (respondeu) registrarVolta();
      else {
        registrarQueda(null);
        intervalo = INTERVALO_INICIAL;
        agendar();
      }
      return respondeu;
    }

    // Browser-level signals: react instantly instead of waiting for a probe.
    // Losing the interface is conclusive; getting it back is only a hint to
    // re-check now (see the navigator.onLine rule in the banner).
    root.addEventListener('offline', function () {
      informarQueda('REDE');
    });
    root.addEventListener('online', function () {
      if (!foraDoAr) return;
      intervalo = INTERVALO_INICIAL;
      clearTimeout(timer);
      sondar();
    });

    // Debug mode's fake network can be switched mid-session, and both
    // directions have to be felt at once (src/shared/debug.js):
    //
    //   -> offline  drop NOW. On the live page the watchdog is passive until a
    //               send fails, so without this the flag did nothing at all
    //               until the volunteer happened to scan something.
    //   -> online   probe NOW, rather than waiting out a backoff that has
    //               already crawled to 30 s — which reads as "it is still broken".
    const largarDebug = NFPR.Debug.aoMudar(function () {
      const forcado = NFPR.Debug.valor('forcarConexao');
      if (forcado === 'offline' && !foraDoAr) {
        registrarQueda('REDE');
        intervalo = INTERVALO_INICIAL;
        agendar();
        return;
      }
      if (!foraDoAr) return;
      intervalo = INTERVALO_INICIAL;
      clearTimeout(timer);
      sondar();
    });

    if (opcoes.proativo) {
      // Treat as unproven from the start, but don't claim a reason we haven't
      // established: only a false navigator.onLine is conclusive on its own.
      foraDoAr = true;
      if (!interfaceViva()) registrarQueda('REDE');
      sondar();
    }

    /**
     * Stop probing and let go of the debug subscription.
     *
     * Nothing in the extension calls this — both surfaces own their watchdog for
     * the life of the page. It exists because the watchdog now HOLDS something
     * (a Debug.aoMudar subscription) as well as scheduling something, and a
     * thing that owns a timer and a listener with no way to release them is a
     * leak waiting for its second caller. tools/smoke.js is that caller today.
     */
    function parar() {
      clearTimeout(timer);
      largarDebug();
    }

    return { informarQueda, estaForaDoAr: () => foraDoAr, verificarAgora, parar };
  }

  NFPR.Connectivity = { iniciar };
})(typeof globalThis !== 'undefined' ? globalThis : self);
