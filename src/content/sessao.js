/**
 * sessao.js  (content only)
 * -----------------------------------------------------------------------------
 * The server refuses to serve the donation page when the same login has more
 * than one session open, and renders an error screen saying so. This module
 * detects that screen and closes the other sessions — the same
 * GET /nfprweb/publico/sair the server's own button uses — either by itself
 * (the `encerrarSessoesDuplicadas` preference) or when the volunteer asks for
 * it from the session bar or from a failed note.
 *
 * It also answers the other session question, for whoever needs it: conferir()
 * asks the server whether this login is still good, without changing anything.
 *
 * Protocol only. It reads document text and makes requests; it never touches
 * the DOM. Reacting to the outcome is content.js's job, and drawing it is the
 * session condition bar's — there is no duplicate-session banner any more, and
 * that is the point: one event, one narrator (see painel.js).
 *
 * ONE TERMINATION AT A TIME, however many places ask for it. The session bar
 * has a button, every note that failed on a duplicate session has one, and the
 * preference fires it unprompted; all of them land on the same in-flight
 * promise, and everyone who needs to react subscribes with aoEncerrar(). That
 * is why this is a tiny notifier instead of each caller doing its own fetch:
 * two competing /sair requests, and two halves of the UI disagreeing about
 * whether one is running, is exactly what this shape prevents.
 *
 * WHY THIS IS NOT IN ui.js, where it used to live: montar() performed this
 * network call and latched Donation's session state before it had finished
 * building the DOM, so its completion callback could fire while montar was
 * still awaiting its stylesheets. content.js had to hoist three variables above
 * `await NFPR.UI.montar(...)` with a five-line comment explaining the
 * temporal-dead-zone crash it was avoiding. Subscribing instead deletes the
 * hazard rather than commenting it: aoEncerrar replays for a request that is
 * already running, so a caller can subscribe whenever it is ready.
 *
 * The fetch always ends in a CORS / opaque-redirect error. That is expected and
 * harmless — redirect:'manual' stops fetch following the 302, which avoids the
 * preflight failure, and the server still processes the termination.
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  const NFPR = (root.NFPR = root.NFPR || {});

  let _ultima = null; // the most recent /sair promise, settled or not
  let _ativa = false; // ...and whether it is still in flight
  const _ouvintes = [];
  let _conferindo = null; // the in-flight conferir(), so a burst asks once
  const _ouvintesMortas = []; // told when conferir() finds the session gone

  /**
   * encerrar() -> Promise, settles when the server has been told to close every
   * session. Safe to call from anywhere, any number of times: while a request
   * is in flight every caller gets that same one back, so the four places that
   * offer this action can never race each other.
   *
   * Asking again AFTER one finished does start a second request, deliberately.
   * The only way to see the action offered at that point is for the server to
   * still be reporting two sessions, which means the first attempt did not take
   * — and a button that silently does nothing is worse than a repeated GET the
   * server treats as idempotent anyway.
   */
  function encerrar() {
    if (_ativa) return _ultima;

    // Latch Donation so that, while /sair is in flight, a login redirect or a
    // missing form token is reported as "encerrando sessão" rather than
    // "sessão expirou" — the session is being restored, not lost. The
    // duplicate-session latch goes the other way: from here on the answer is
    // no longer "there are two sessions", it is "they are being closed".
    NFPR.Donation.setSessaoEncerrando(true);
    NFPR.Donation.setSessaoDuplicada(false);
    _ativa = true;

    _ultima = fetch(NFPR.Site.URL_SAIR, {
      method: 'GET',
      credentials: 'include',
      redirect: 'manual'
    })
      .catch(function () {
        /* opaque redirect / CORS — expected, the server still acted */
      })
      .finally(function () {
        _ativa = false;
        NFPR.Donation.setSessaoEncerrando(false);
      });

    for (const fn of _ouvintes.slice()) fn(_ultima);
    return _ultima;
  }

  /**
   * aoEncerrar(fn) — fn(promessa) runs when a termination starts, and right
   * away if one is already running OR has already finished. That last part
   * matters: the preference fires this before the panel has finished building
   * itself, and a bar that missed the news would sit there offering to close
   * sessions that are already closed.
   */
  function aoEncerrar(fn) {
    _ouvintes.push(fn);
    if (_ultima) fn(_ultima);
  }

  /**
   * tratarDuplicada(deveEncerrar) -> { detectada, encerrar, aoEncerrar }
   *
   *   detectada   the duplicate-session screen is on this page
   *   encerrar / aoEncerrar   the two functions above, handed over so the panel
   *               can offer the way out and follow it without knowing this
   *               module exists
   *
   * Whether a termination is already running is deliberately NOT a field here:
   * it would be a snapshot taken before the panel is built, and the answer can
   * change afterwards from three different places. aoEncerrar is the only
   * honest form of that question.
   */
  function tratarDuplicada(deveEncerrar) {
    const main = document.getElementById('main');
    const detectada = !!main && NFPR.Site.RE_SESSAO_DUPLICADA.test(main.textContent || '');

    if (detectada) {
      if (deveEncerrar) encerrar();
      // Nothing is going to fix this by itself, and the server will not
      // necessarily repeat the reason to fetch — it can answer the token
      // request with a plain login redirect. Tell Donation what this page
      // actually is, so failing notes say "mais de uma sessão ativa" with the
      // way out instead of sending the volunteer to log in again.
      else NFPR.Donation.setSessaoDuplicada(true);
    }

    return { detectada, encerrar, aoEncerrar };
  }

  /**
   * conferir() -> Promise<'VIVA' | 'MORTA' | 'INDEFINIDA'>
   *
   * Is this login still good? One GET of the donation page itself, which is
   * the login TARGET and therefore the least ambiguous thing on the site to
   * ask: a live session answers it, a dead one is bounced to
   * authz-sefa.identidadedigital.pr.gov.br. Nothing else is probed, so nothing
   * has to be assumed about which of the site's JSON endpoints are gated.
   *
   * redirect:'manual' is what makes the answer readable at all. Followed, the
   * 302 lands cross-origin on the identity provider, CORS blocks it and fetch
   * throws — indistinguishable from the cable being unplugged. Stopped at the
   * redirect, the same page answers `type: 'opaqueredirect'`, which is the
   * proof. (This is the trap the SITE falls into; see BuscaSite in
   * modal-entidade.js.)
   *
   * THREE states, and only one of them is allowed to make anything happen.
   * 'INDEFINIDA' is a network failure — no session was disproved, and treating
   * "I could not ask" as "you are logged out" would close the volunteer's
   * dialog every time the wifi hiccups. Callers act on 'MORTA' alone.
   *
   * Single-flight: the watcher fires on every search, and one answer serves
   * however many asked while it was in the air. Deliberately not cached after
   * it settles — the answer's whole value is that it can change.
   *
   * A 'MORTA' is ANNOUNCED (aoDescobrirMorta), and that is not a courtesy. This
   * is the same dead session the send pool has to stop for, discovered by a
   * different door; leaving the caller to draw its own conclusion means the
   * volunteer is told the entity search is unavailable while the queue behind
   * them carries on into a wall. content.js latches it exactly as it does for a
   * note that came back SESSAO — one bar, one sound, the pool paused — and any
   * future caller of conferir() gets that for free instead of remembering to.
   */
  function conferir() {
    if (_conferindo) return _conferindo;

    _conferindo = (async function () {
      // A DEADLINE, because single-flight turns a hang into a permanent one:
      // every later ask got the same unsettled promise back, so one request
      // that never answered left the entity dialog waiting for the rest of the
      // page. Past it the answer is INDEFINIDA — not being able to ask proves
      // nothing, exactly like a request that fails outright.
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), NFPR.Site.PRAZO_RESPOSTA_MS);
      try {
        const resp = await fetch(NFPR.Site.URL_DOACAO, {
          method: 'GET',
          credentials: 'include',
          redirect: 'manual',
          cache: 'no-store',
          signal: ctl.signal
        });
        // Read in donation.js, which asks this same question when a send
        // fails. Two copies of it had already disagreed.
        return NFPR.Donation.sessaoPelaResposta(resp);
      } catch {
        return 'INDEFINIDA';
      } finally {
        clearTimeout(timer);
      }
    })().then(function (estado) {
      if (estado === 'MORTA') for (const fn of _ouvintesMortas.slice()) fn();
      return estado;
    }).finally(function () {
      _conferindo = null;
    });

    return _conferindo;
  }

  /**
   * aoDescobrirMorta(fn) — fn() runs each time conferir() proves the session is
   * gone. No replay and no argument: unlike aoEncerrar, which reports a request
   * that is under way and whose answer a late subscriber would miss, this is a
   * fact about right now that the subscriber can re-establish by asking again.
   * Fired on every proof rather than once, because the latch on the other end
   * is what decides whether anything happens — and it already knows.
   */
  function aoDescobrirMorta(fn) {
    _ouvintesMortas.push(fn);
  }

  NFPR.Sessao = { tratarDuplicada, encerrar, aoEncerrar, conferir, aoDescobrirMorta };
})(typeof globalThis !== 'undefined' ? globalThis : self);
