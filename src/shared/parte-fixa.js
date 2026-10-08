/**
 * parte-fixa.js  (shared)
 * -----------------------------------------------------------------------------
 * Everything about fixed parts: the patterns a volunteer defines to fix the
 * part of a key that repeats across a batch of notes, so only the digits that
 * change have to be typed. A pattern is 44 characters of digits and '?', where
 * each '?' is one digit the volunteer still enters.
 *
 * No DOM, no storage, no side effects.
 *
 * The feature used to be spread over three files — pattern normalisation in
 * settings-ui.js, composition and resolution in chave.js, and the '?' count
 * written out by hand in five places. chave.js's own banner had to explain that
 * resolverChave lived there "so fixed part resolution can never diverge between
 * the two entry points", which was a hint that it wanted to be its own module.
 * chave.js is now purely key maths again (CDV, extraction, validation).
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  const NFPR = (root.NFPR = root.NFPR || {});

  const COMPRIMENTO = 44;

  /**
   * Keep only key characters and '?', uppercased, and never exceed a full key.
   * For live input.
   *
   * LETTERS PASS, BECAUSE THE ISSUER'S CNPJ IS ALPHANUMERIC — and a fixed part
   * exists precisely to fix the head of the key, which is where that CNPJ sits,
   * so a fixed part that could not hold a letter would be useless to exactly
   * the shops this change is about.
   *
   * POSITION-BLIND ON PURPOSE, even though a letter is only legal at indices
   * 6..17. This is called on FRAGMENTS as well as whole patterns — one
   * character at a time while the field is re-normalised, and on a slice around
   * the caret — and a fragment has no index to test. So every letter is
   * accepted here and avaliarTextoDeParteFixa (registrador.js) refuses the ones
   * standing in the wrong place, where the whole template is in hand.
   */
  function normalizar(valor) {
    return String(valor || '')
      .toUpperCase()
      .replace(/[^0-9A-Z?]/g, '')
      .slice(0, COMPRIMENTO);
  }

  /** Pad a normalised pattern out to 44: anything unstated is variable. */
  function completar(template) {
    return normalizar(template).padEnd(COMPRIMENTO, '?');
  }

  /**
   * How many characters the volunteer still types per note under this pattern.
   * No fixed part (null/empty) means the whole key: 44.
   *
   * A pattern shorter than 44 counts the remainder as variable, which is what
   * the settings form previews while the pattern is still being typed; stored
   * fixed parts are always completed to 44, so that term is 0 for them.
   */
  function contarVariaveis(template) {
    if (!template) return COMPRIMENTO;
    return (template.match(/\?/g) || []).length + Math.max(0, COMPRIMENTO - template.length);
  }

  /** A usable fixed part needs at least one '?' — otherwise it is a constant
   * key. */
  function temVariaveis(template) {
    return contarVariaveis(template) > 0;
  }

  /**
   * ...and at least one digit — otherwise it fixes nothing. The mirror of the
   * rule above, and it was missing for a while: a fixed part of nothing but '?'
   * is the whole key typed by hand, so it saves nobody a digit, and it has no
   * digits to be named by either. Everything downstream that says "a fixed part
   * is armed" read the empty label as "no fixed part", while the
   * scan-under-a-fixed-part warning still fired on every good scan.
   */
  function temFixos(template) {
    return contarVariaveis(template) < COMPRIMENTO;
  }

  /**
   * Pour the typed digits into the pattern's variable positions, in order.
   * Stops when the typed digits run out, so a partial entry yields a partial
   * key and Chave.avaliar reports the length.
   */
  function aplicar(template, typed) {
    let r = '';
    let i = 0;
    for (const ch of template) {
      if (ch !== '?') {
        r += ch;
      } else if (i < typed.length) {
        r += typed[i];
        i += 1;
      } else {
        break;
      }
    }
    return r;
  }

  /**
   * The 44-character TEMPLATE describing what is known so far: the fixed part's
   * fixed digits, the volunteer's typed digits in the variable slots, and '?'
   * for everything still unknown. Always 44 characters, so Chave.analisarChave
   * can read it and Chave.avaliarTemplate can judge it.
   *
   * UNLIKE `aplicar`, THIS DOES NOT STOP AT THE FIRST UNFILLED SLOT. aplicar
   * breaks out of the loop when the typed digits run out, which drops every
   * fixed digit that comes AFTER the last filled '?' — right for composing a
   * key (the result is short and COMPRIMENTO reports it), wrong here, because a
   * fixed part fixes digits after the ones being typed and those are known from
   * the start.
   *
   * With no fixed part, compor(null, t) is completar(t).
   */
  function compor(template, typed) {
    const t = template ? completar(template) : '?'.repeat(COMPRIMENTO);
    const digitados = String(typed || '');
    let r = '';
    let i = 0;
    for (const ch of t) {
      if (ch !== '?') {
        r += ch;
      } else {
        r += i < digitados.length ? digitados[i] : '?';
        i += 1;
      }
    }
    return r;
  }

  /**
   * Resolve the capture buffers into a candidate 44-digit key.
   *
   * FIXED PARTS ARE FOR TYPING, AND ONLY FOR TYPING. A scanner must not be used
   * while one is active. This is where that rule lives, and the decision it
   * makes is about WHAT KIND OF INPUT ARRIVED — never about whether a
   * validation happened to pass:
   *
   *   a 44-digit run in `raw`  ->  a scan, a paste or a QR-code URL. THAT is
   *                                the input, and it is judged as it came.
   *   anything shorter         ->  someone typed, so the fixed part composes.
   *
   * WHY IT CANNOT BE THE OTHER WAY ROUND. capture.js caps `typed` at the fixed
   * part's variable-digit count, so under a fixed part `typed` holds a scan's
   * FIRST digits — the head of a barcode, never the tail the fixed part is
   * waiting for. Composing from those yields a key nobody scanned, and that is
   * exactly what used to happen whenever a scan failed validation: [fixed part]
   * + [barcode head], clearing the check digit about one time in ten (10.05%
   * over 200k trials, because the fixed part supplies the leading digits
   * itself) and donated silently while the note actually in the volunteer's
   * hand was never donated at all.
   *
   * Deciding by input kind REMOVES that case instead of narrowing it. A scan
   * that fails validation now gets the ordinary red "confira a chave", which
   * is the one outcome that recovers the donation — see the red/grey rule in
   * chave.js. Composition is reachable only from genuine typing, which is what
   * a fixed part is for.
   *
   * THE ACCEPTED COST is a stuck key: correct digits typed, then a key repeats
   * until the buffer passes 44 digits. That is no longer distinguishable from a
   * scan, so it is refused red rather than quietly rebuilt from the fixed part.
   * It costs one re-entry of one note, and it is the safe side of the trade.
   *
   * A SCANNER BURST IS A SCAN WHATEVER ITS LENGTH. The 44-run was once the
   * only sign of a scan, and a burst SHORTER than 44 — a shop's own barcode, a
   * loyalty card, a partial read — carries none, so it fell through to
   * composition: [fixed part] + [the barcode's first digits], the very key the
   * paragraph above exists to prevent, arriving by the one door it left open.
   * About one in ten of those passed every local check. `rajada` is capture's
   * CONFIRMED burst (never a suspected one), and with it set nothing composes:
   * the burst is judged as it came, and a short one is simply red.
   *
   * THE CALLER ALSO SETS IT FOR A SCAN A PERSON HAS TAKEN OVER. Correcting a
   * scanned buffer by hand makes it the person's (capture's `rajada` goes
   * false), but its `typed` is still the barcode's head under a fixed part;
   * a Backspace there used to leave no 44-run in `raw`, and this composed.
   * registrador.js passes `rajada || escaneado`, so a buffer that ever held a
   * scan is never composed.
   *
   * NOTHING HERE VALIDATES. That is deliberate: chave.js used to be consulted
   * from this line, which made a judge of keys into a fixed part arbiter and
   * meant a check's LOCATION decided whether a fixed part could fabricate over
   * it. Every awkward thing in chave.js descended from that one call.
   *
   * Returns { chave, origem }, origem being 'scan' | 'rajada' | 'parteFixa' |
   * 'direto'. 'scan' means a whole key arrived while a fixed part was active:
   * the fixed part did not apply, and the volunteer has to hear about it,
   * because registering it anyway is damage control for a misuse rather than a
   * feature. 'rajada' is a burst with no key in it under a fixed part: nothing
   * was scanned that the fixed part could have been ignored for, so it raises
   * none of that.
   */
  function resolver(raw, typed, template, rajada) {
    const deRaw = NFPR.Chave.extrairChave(raw);
    const escaneou = deRaw.length === COMPRIMENTO;
    if (!template) return { chave: escaneou ? deRaw : typed, origem: 'direto' };
    if (escaneou) return { chave: deRaw, origem: 'scan' };
    if (rajada) return { chave: deRaw, origem: 'rajada' };
    return { chave: aplicar(template, typed), origem: 'parteFixa' };
  }

  NFPR.ParteFixa = {
    COMPRIMENTO,
    normalizar,
    completar,
    contarVariaveis,
    temVariaveis,
    temFixos,
    aplicar,
    compor,
    resolver
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
