/**
 * relogio.js  (shared)
 * -----------------------------------------------------------------------------
 * The one place that reads a clock.
 *
 *   NFPR.Relogio.mesCorrente()  ->  { ano, mes }   ano is four digits, mes 1..12
 *
 * WHY A TIMEZONE AND NOT `new Date().getMonth()`: the donation deadline is a
 * Paraná civil-calendar boundary — a note stops being donatable when the month
 * turns THERE, not on whatever clock the volunteer's machine happens to be set
 * to. On the last night of a month the two differ, and a machine left on UTC (or
 * carried across a border) would refuse a still-valid note, or accept one that
 * has just expired. America/Sao_Paulo is the same offset as Paraná.
 *
 * Parts are picked by `type`, never by position: a locale is free to order them
 * however it likes, and 'en-CA' is only chosen because it asks for plain numbers.
 *
 * WHY ITS OWN FILE: three modules need the current month (registrador.js,
 * content.js, registrador.js), and chave.js must stay pure — injecting `agora`
 * is what keeps its verdicts testable with a fixed date. Writing this three
 * times is precisely the failure connectivity.js was created to fix; see its
 * banner.
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  const NFPR = (root.NFPR = root.NFPR || {});

  const FORMATADOR = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: 'numeric'
  });

  /** The current month in Paraná. Returns { ano, mes } — mes is 1..12. */
  function mesCorrente() {
    // Time travel, for the debug mode alone (src/shared/debug.js). Because this
    // really is the one place that reads a clock, overriding it here moves the
    // whole extension at once — every deadline verdict, the stale-fixed-part
    // bar, the "Vale até" line — which is what makes EXPIRADA and FUTURA
    // testable without touching the machine's own clock. Inert unless armed.
    const fixo = NFPR.Debug.valor('relogioFixo');
    if (fixo && fixo.ano) return { ano: Number(fixo.ano), mes: Number(fixo.mes) };

    const partes = FORMATADOR.formatToParts(new Date());
    const parte = (tipo) => {
      const p = partes.find((x) => x.type === tipo);
      return p ? Number(p.value) : NaN;
    };
    return { ano: parte('year'), mes: parte('month') };
  }

  NFPR.Relogio = { mesCorrente };
})(typeof globalThis !== 'undefined' ? globalThis : self);
