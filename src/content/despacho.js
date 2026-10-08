/**
 * despacho.js  (content only)
 * -----------------------------------------------------------------------------
 * A bounded work pool: at most `largura` donations in flight at once, dispatched
 * strictly in the order they were enqueued.
 *
 * WHY A CAP OF OUR OWN, AND NOT "LET CHROME SORT IT OUT". Chrome keeps at most
 * six connections per host and queues the rest, so firing a thousand fetches at
 * once looks harmless. It is not: donation.js arms its 20 s AbortController the
 * moment WE call fetch, not when Chrome dispatches it. Requests 7..1000 would
 * spend their entire timeout sitting in Chrome's queue, abort untried, and come
 * back as SERVIDOR / "o site está demorando demais" — a fabricated outage that
 * then trips the connectivity watchdog and parks the whole queue. The semaphore
 * is what keeps every timeout measuring a real request.
 *
 * TWO LANES, FIFO WITHIN EACH. Anything marked urgent goes out before anything
 * ordinary; among equals, the order they were entered.
 *
 * The one urgent thing is A NOTE THE VOLUNTEER JUST SCANNED. Someone is standing
 * there holding the paper, waiting to see it turn green — and behind a
 * thousand-note backlog they would wait minutes for it. The backlog is
 * unattended and has two months to live (emission+2, see chave.js), so letting a
 * handful of live scans past it costs the backlog nothing measurable and buys
 * the person at the scanner their answer immediately.
 *
 * A scan never preempts work already in flight; nothing is ever cancelled. Worst
 * case it waits for one slot to free, which is one send.
 *
 * PAUSING IS FOR CONDITIONS, NOT FAILURES. A dead session or a dead connection
 * is one fact about the whole queue, not a verdict on each note; discovering it
 * a thousand times costs a thousand doomed round trips and a thousand error
 * buzzes. The caller latches it once and pauses. In-flight work is never
 * cancelled — it is already spent, and its answer is still worth reading.
 *
 * Pure scheduling: no DOM, no storage, no network, no NFPR dependencies. The
 * whole point is that tools/smoke.js can drive it, which it cannot do with
 * content.js (that file starts working the moment it loads).
 *
 * NFPR.Despacho.criar({
 *   largura,             // max concurrent; 1 is strictly sequential
 *   executar(tarefa)     // -> Promise. Rejections are swallowed: a slot must be
 *                        //    freed even when the work throws, and the caller
 *                        //    already reports its own failures.
 * }) -> { enfileirar, pausar, retomar, estaPausado, pendentes, emVoo }
 *   enfileirar(tarefa, urgente)   urgente jumps ahead of ordinary work
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  const NFPR = (root.NFPR = root.NFPR || {});

  function criar(opcoes) {
    opcoes = opcoes || {};
    // A largura below 1 would dispatch nothing at all and look exactly like a
    // hung queue, which is a miserable thing to debug on a volunteer's machine.
    const largura = Math.max(1, opcoes.largura || 1);
    const executar = opcoes.executar;

    const urgentes = [];
    const pendentes = [];
    let emVoo = 0;
    let pausado = false;

    const proxima = () => (urgentes.length ? urgentes.shift() : pendentes.shift());
    const aguardando = () => urgentes.length + pendentes.length;

    function preencherVagas() {
      while (!pausado && emVoo < largura && aguardando()) {
        const tarefa = proxima();
        emVoo += 1;
        // Not awaited: the loop keeps filling slots. `then` on both branches
        // rather than `finally` — the sandbox smoke.js runs in is plain ES, and
        // a slot that leaks on rejection would shrink the pool to nothing over
        // a long drain.
        Promise.resolve()
          .then(() => executar(tarefa))
          .then(liberar, liberar);
      }
    }

    function liberar() {
      emVoo -= 1;
      preencherVagas();
    }

    return {
      /**
       * Append. `urgente` puts it in the lane that drains first — for a note
       * someone is standing there waiting on. Order is preserved within a lane,
       * so two scans still go out in the order they were read.
       */
      enfileirar(tarefa, urgente) {
        (urgente ? urgentes : pendentes).push(tarefa);
        preencherVagas();
      },
      /** Stop dispatching. Whatever is already in flight runs to completion. */
      pausar() {
        pausado = true;
      },
      /**
       * Take everything still waiting, leaving the queue empty. For the caller
       * that has just learnt one fact refusing every note at once (a dead
       * session): it can settle them all without dispatching a single doomed
       * request. Never touches work already in flight — that cost is spent, and
       * its answer is still worth reading.
       */
      esvaziar() {
        return urgentes.splice(0).concat(pendentes.splice(0));
      },
      retomar() {
        if (!pausado) return;
        pausado = false;
        preencherVagas();
      },
      estaPausado: () => pausado,
      pendentes: aguardando,
      emVoo: () => emVoo
    };
  }

  NFPR.Despacho = { criar };
})(typeof globalThis !== 'undefined' ? globalThis : self);
