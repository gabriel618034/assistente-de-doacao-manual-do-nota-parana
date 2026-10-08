/**
 * capture.js  (content only)
 * -----------------------------------------------------------------------------
 * Robust keystroke capture for BOTH manual typing and handheld barcode/QR
 * scanners (which act as ultra-fast keyboards that finish with Enter or Tab).
 *
 * Why a document-level, capture-phase listener instead of a plain <input>:
 *   - It never drops/clips characters even if focus drifts mid-scan.
 *   - We fully control rendering, so the page's native field is never touched.
 *   - We can distinguish machine input (a RUN of sub-35ms gaps) from a human,
 *     which lets us also swallow the symbols in a scanned QR-code URL without
 *     hijacking ordinary typing elsewhere.
 *
 * ONE FAST GAP IS NOT A SCANNER. A hand rolling across adjacent keys — `321`,
 * `45` — lands two or three keydowns inside 35 ms of each other, and reading
 * that as a burst threw away every digit typed before it. A scanner sends 44
 * or more characters back to back; fingers cannot sustain the pace past three
 * or four. So a buffer only becomes a scanner's after RAJADA_MINIMA fast gaps
 * in a row (see `marcarRajada`).
 *
 * Two buffers are kept:
 *   typed -> key characters only (drives the manual/fixed-part display)
 *   raw   -> every captured char (lets us recover a key from a QR-code URL)
 *
 * A KEY CHARACTER IS A DIGIT OR AN UPPERCASE LETTER, and every one of them is
 * accepted wherever it is typed. The issuer's CNPJ is alphanumeric, so indices
 * 6..17 of a key may hold letters and nothing else may — but WHERE a letter may
 * stand is a VERDICT (FORMATO, and the live verdict while typing), never a
 * filter on the keystroke. An entry that swallows a letter in silence teaches
 * the volunteer nothing and reads as broken software.
 *
 * TWO QUESTIONS USED TO SHARE ONE ANSWER, and untangling them is most of what
 * this file now does differently. "Is it a digit?" decided both what belongs in
 * the buffer AND what is the URL wrapped around a scanned QR code; the second
 * answer was free only while a key was all digits. The replacement is NOT a
 * cleverer per-keystroke test — the first attempt was one, asking where the
 * character would land, and a scan fired while the volunteer already had eight
 * characters typed put `HTTPS` straight into the gap at index 8 with the key
 * welded on behind it. Instead:
 *
 *   ONCE A BURST IS CONFIRMED, `typed` IS DERIVED FROM `raw`, not accumulated.
 *   It becomes NFPR.Chave.chaveParcial(raw): the 44-run once the key is
 *   complete, the last run of key characters while it is still arriving. The
 *   URL around a scan can then never reach the entry, whatever the buffer held
 *   when the scan started, because separating a key from the text around it is
 *   exactly what that function does.
 *
 *   A LETTER NEVER CONFIRMS A BURST. A key begins with its cUF, so a scanner's
 *   first characters are always digits and a real scan is believed long before
 *   its CNPJ can contribute a letter; a person rattling letters off is not a
 *   scanner. Letters are transparent to the heuristic — they neither open a
 *   run, lengthen one, nor end one — because four quick ones met RAJADA_MINIMA
 *   as easily as four quick digits, and marcarRajada's answer to a burst is to
 *   DISCARD everything typed before it. Holding a letter key down emptied the
 *   entry of digits that were already correct.
 *
 * Only `typed` is ever capped by the active fixed part. `raw` records
 * everything the scanner sent, up to a generous hard ceiling, because a full
 * 44-digit key found in `raw` must always win over the fixed part
 * (NFPR.ParteFixa.resolver).
 *
 * A MACHINE BURST DOES NOT INHERIT A PERSON'S DIGITS. Nothing used to own the
 * buffers: FIM_SCAN_MS clears the `escaneando` flag and never the text, so six
 * digits abandoned half an hour ago were still sitting there when the next
 * barcode arrived, and `[their 6][the barcode's first 38]` is a 44-digit run
 * extrairChave finds and refuses — a red toast on a perfect scan. So the first
 * keystroke of a burst discards whatever a human left behind (see the
 * `bufferDeMaquina` block below).
 *
 * THIS IS NOT THE CAP. It fires before any length question is asked and
 * truncates nothing to a fixed part's variable-digit count; the rule above
 * still holds in full, and the two are independent.
 *
 * ...AND A PERSON TYPING INTO A SCANNED BUFFER TAKES IT OVER. Backspace, or a
 * digit at human speed, ends the buffer's life as a scan — see
 * `devolverAoHumano` for why the digit case is on probation for one keystroke.
 *
 * A READING ENDS ONCE. A scanner may close a read with several terminators —
 * a burst of Tabs, CR and LF. The first submits; the rest are swallowed as
 * the same termination, so they never move focus or press a button. A Tab or
 * Enter pressed by hand is left to the browser — see `terminadorDeCauda`.
 *
 * The controller is inert while `estaAtivo()` is false (settings modal open,
 * no institution configured) AND while `deveIgnorarEvento(e)` is true — the
 * orchestrator uses the latter to leave real form fields (the government
 * site's own inputs) untouched, so a volunteer can still type there.
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  const NFPR = (root.NFPR = root.NFPR || {});

  const LIMIAR_SCAN_MS = 35; // gaps below this ⇒ machine (scanner) input
  const FIM_SCAN_MS = 250; // idle after which a scan is considered finished
  // Consecutive fast gaps before a run is believed to be a scanner. Rollover
  // on adjacent keys reliably produces two (three digits); this leaves one of
  // margin, and a scanner reaches it on its fifth character.
  const RAJADA_MINIMA = 4;

  // Keys that are only ever HELD for another one. A gap measured from one of
  // them says nothing about how fast the keys are arriving.
  const MODIFICADORES = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock']);

  // Hard ceiling on the raw buffer, so a stuck key can't grow it without end.
  // It must stay well above a full NFC-e QR-code URL (~200 chars: a ~43-char
  // `.../nfce/qrcode?p=` prefix, the 44-digit key, then several `|`-separated
  // fields) — clipping that would destroy the very run extrairChave looks for.
  const LIMITE_RAW = 512;

  // A complete key standing on its own inside a larger text: six digits, the
  // issuer's twelve, twenty-six digits, not preceded by another key character.
  // The shape is chave.js's FORMATO; it is restated because what is asked here
  // is "is there one IN this text", which that file does not answer.
  const RE_CHAVE_EM_TEXTO = /(?:^|[^0-9A-Z])[0-9]{6}[0-9A-Z]{12}[0-9]{26}/;

  function iniciar(opcoes) {
    const cfg = Object.assign(
      {
        onMudanca() {},
        onEnviar() {},
        getAutoEnviar: () => false,
        getParteFixaVariaveis: () => 44, // characters the volunteer must type; 44 = no fixed part
        estaAtivo: () => true,
        deveIgnorarEvento: () => false // true ⇒ keystroke belongs to the page, not us
      },
      opcoes || {}
    );

    let typed = '';
    let raw = '';
    let ultimoKeyTime = 0;
    let escaneando = false;
    let scanResetTimer = null;
    // The current buffer was produced by a scanner. Unlike `escaneando`, which
    // is the live timing heuristic and expires FIM_SCAN_MS after the last key,
    // this is a property of the TEXT and lasts until the buffer is emptied.
    let bufferDeMaquina = false;
    // The buffer has held a scanner's text at some point, whoever holds it now.
    // `bufferDeMaquina` answers "is it a scanner's"; this answers "was it ever",
    // and it is the one that decides what the entry IS: once a scan has been
    // in the buffer, `raw` holds the key and `typed` may hold only its head
    // (capped by a fixed part) or sit beside a URL's tail. See the Backspace
    // branch and `escaneado` on the payloads. Lasts until the buffer empties.
    let escaneado = false;
    // Backspace has already cut `raw` down to the key it carries. Once is
    // enough: after that `raw` IS the entry, and cutting again would re-read a
    // key the volunteer is part-way through correcting.
    let aparado = false;
    // The previous keystroke took the buffer away from the scanner, and this
    // one may give it back. Lives for exactly one keystroke — see
    // `devolverAoHumano`.
    let retomavel = false;
    // `raw`'s length as it was before the PREVIOUS keystroke, and before this
    // one. Two frames back is the one that matters: see the discard below.
    // Only `raw` is tracked — the discard slices `raw` and re-reads `typed`
    // out of it (marcarRajada), so `typed`'s old lengths had no reader.
    let antesRaw = 0;
    let atualRaw = 0;
    // The current run of fast gaps: how long it is, `raw`'s length before its
    // first keystroke, and whether that keystroke was a stalled scan's
    // probation key. A run shorter than RAJADA_MINIMA is only SUSPECTED.
    let rapidas = 0;
    let inicioRaw = 0;
    let rajadaRetomada = false;
    // Where in `raw` a resumed burst began, when the buffer it resumed onto
    // already held a whole key; -1 otherwise. See `conferirSegundaLeitura`.
    let inicioRetomada = -1;
    // When the last keystroke that was not a bare modifier arrived, and when
    // the last entry ended (a submission, or a terminator swallowed as part of
    // a reading's tail). Both feed `terminadorDeCauda` and nothing else, and
    // neither belongs to the buffer — reset() leaves them alone, because the
    // tail of a reading arrives AFTER the reset its own terminator caused.
    let ultimaTeclaEm = -Infinity;
    let fimDaEntradaEm = -Infinity;

    function reset() {
      typed = '';
      raw = '';
      escaneando = false;
      bufferDeMaquina = false;
      escaneado = false;
      aparado = false;
      retomavel = false;
      antesRaw = 0;
      atualRaw = 0;
      rapidas = 0;
      inicioRaw = 0;
      rajadaRetomada = false;
      inicioRetomada = -1;
      clearTimeout(scanResetTimer);
    }

    const ehTerminador = (e) => e.key === 'Enter' || e.key === 'Tab';

    const acumularRaw = (texto) => {
      if (raw.length < LIMITE_RAW) raw = (raw + texto).slice(0, LIMITE_RAW);
    };

    // `rajada` says the buffer came from a scanner (a CONFIRMED run). The live typing verdict
    // (registrador.js) is suppressed while it is true: a scan fills 44 cells in
    // ~50 ms, and flashing four partial verdicts on the way past is noise for
    // nobody — the scan gets its real verdict at submit, as always.
    //
    // A SUSPECTED run is reported separately, as `suspeita`, and not folded
    // into `rajada`. It used to be folded in, which hid a verdict ALREADY on
    // screen for the length of the idle timer: two digits rolled quickly after
    // a red one blinked the line away and back, shifting the layout, for a
    // run that was fingers all along. The consumer decides what suspicion
    // means for it (registrador.js: raise nothing new, drop nothing shown). If
    // it was fingers, the idle timer emits again with the suspicion cleared.
    // The submission (below) reports only a CONFIRMED burst.
    function emitirMudanca() {
      cfg.onMudanca({
        typed,
        raw,
        rajada: bufferDeMaquina,
        suspeita: !bufferDeMaquina && rapidas > 0,
        escaneado
      });
    }

    // The submission carries `rajada` for the same reason onMudanca does, and
    // it is the only way anyone downstream can tell a TYPED key from a scanned
    // one: both arrive as 44 digits and ParteFixa.resolver reports 'direto' for
    // either. Read before reset(), which is what clears the flag.
    //
    // `escaneado` goes with it for the one question `rajada` no longer answers
    // once a person has touched the buffer: whether a scan's text is in it.
    // A hand-corrected scan counts as typed (rajada is false) and is still
    // never composed with a fixed part (escaneado is true) — see registrador.js.
    function enviar() {
      const r = raw;
      const ty = typed;
      const deMaquina = bufferDeMaquina;
      const lido = escaneado;
      reset();
      fimDaEntradaEm = performance.now();
      cfg.onEnviar(r, ty, deMaquina, lido);
    }

    /**
     * A READING ENDS ONCE, HOWEVER MANY TERMINATORS THE SCANNER SENDS. Some
     * scanners close a read with a burst of them — several Tabs, CR and LF, a
     * mix. The first submits and empties the buffer, and every one after it
     * used to fall through to the browser: Tabs walked focus across the
     * panel's controls, out into the government page and on to the browser's
     * own chrome. Once focus sat on a field, `deveIgnorarEvento` (or the
     * browser) handed it every later keystroke, the next scan included.
     *
     * So a terminator with nothing to submit is swallowed when it is part of
     * a reading's TAIL, and only then. Two signs, either is enough:
     *  - it arrives at machine speed behind the previous keystroke. That also
     *    covers a tail whose reading submitted nothing — a QR code that holds
     *    no key leaves `typed` empty, so no terminator of its tail submits;
     *  - an entry ended less than FIM_SCAN_MS ago, by a submission or by an
     *    earlier terminator of the same tail. That is the scanner too slow
     *    for LIMIAR_SCAN_MS, which the rest of this file reads as a typist,
     *    and the one whose key went out by auto-send before its terminator.
     *
     * A TERMINATOR PRESSED BY HAND IS NOT TOUCHED. Tab moves focus and Enter
     * presses the focused button, which is what keeps every control reachable
     * without a mouse. Version 1.0.1 swallowed every Tab while capture was
     * live; it stopped the damage and took the keyboard away with it.
     *
     * Three things here look removable and are not:
     *  - `ultimaTeclaEm` skips bare modifiers. Shift+Tab is two keydowns a few
     *    milliseconds apart, and measured from the Shift it is a machine-speed
     *    Tab — walking backwards through the controls would be swallowed.
     *  - `e.repeat` is let through. A held Tab auto-repeats at about 30 ms, and
     *    a scanner cannot produce a repeat: the same key twice is a release in
     *    between. This is NOT the stuck-key case the file's banner rejects
     *    e.repeat for — nothing is dropped from a buffer on its say-so, it
     *    only lets a Tab reach the browser.
     *  - only a submission or a SWALLOWED terminator opens the window, never
     *    one that was let through. A person's Tab onto a button followed by
     *    Enter inside 250 ms would otherwise lose the Enter.
     *
     * THE ACCEPTED COST: a tail with nothing in front of it — a failed read
     * from a scanner that sends its suffix regardless — still lets its FIRST
     * terminator through, because nothing tells that one keystroke from a
     * person's. And a second Enter or Tab pressed by hand inside 250 ms of a
     * submission does nothing.
     */
    function terminadorDeCauda(e, agora, deltaTecla) {
      if (agora - fimDaEntradaEm < FIM_SCAN_MS) return true;
      return deltaTecla < LIMIAR_SCAN_MS && !e.repeat;
    }

    /**
     * This keystroke arrived at machine speed: the buffer is a scanner's from
     * here on, and a burst that started on top of a human's leftovers keeps
     * only its own characters.
     *
     * ONE PLACE, called from the two APPEND paths and from nowhere else. Not
     * from the terminator branch, where it would empty the buffer immediately
     * before submitting and destroy every scan; not from Backspace or a
     * modifier, which are nobody's first character.
     *
     * NOT ON THE FIRST FAST GAP. Rollover on adjacent keys puts two or three
     * human keydowns inside 35 ms, and deciding there discarded every digit the
     * person had typed before them. The run has to reach RAJADA_MINIMA fast
     * gaps first; until then it is only suspected, and the discard, when it
     * comes, reaches back to where the RUN began — recorded in onKeyDown when
     * its first fast gap arrived — not to where the confirming key sits.
     *
     * WHY THE RUN BEGINS ONE KEYSTROKE BEFORE ITS FIRST FAST GAP, and not at
     * it. A QR scan starts with a letter ("https://…"), which arrives at human
     * distance from whatever came before, while `escaneando` is still false,
     * and is therefore never appended at all; the gap AFTER it is the first
     * fast one. Everything before that first keystroke belonged to someone who
     * has stopped typing; the keystroke itself was the burst's first
     * character, whether or not it was kept.
     *
     * THE ACCEPTED COST: a human whose last keystroke and a scanner's first are
     * less than 35 ms apart loses one digit into the scan, and the note is
     * refused red. That needs a person typing at machine speed, and it is the
     * outcome today anyway.
     */
    function marcarRajada(delta) {
      if (delta >= LIMIAR_SCAN_MS || bufferDeMaquina) return;
      // `rajadaRetomada`: the run began on the one slow key of a scan that
      // stalled (see devolverAoHumano), so this is the SAME burst resuming —
      // its head is not a human's leftovers to discard, and it needs no run
      // to be believed: the buffer was a scanner's one keystroke ago.
      if (rajadaRetomada) {
        bufferDeMaquina = true;
        escaneado = true;
        // ...UNLESS IT TURNS OUT TO BE A SECOND READ. See below.
        if (RE_CHAVE_EM_TEXTO.test(raw.slice(0, inicioRaw).toUpperCase())) inicioRetomada = inicioRaw;
        return;
      }
      if (rapidas < RAJADA_MINIMA) return;
      if (typed.length) raw = raw.slice(inicioRaw);
      bufferDeMaquina = true;
      escaneado = true;
      aparado = false;
      // AND `typed` IS RE-READ OUT OF `raw`, not sliced back to where the run
      // began. Slicing was right while only digits could be appended, because
      // then everything in the run WAS key material; a letter accepted before
      // the burst was believed can be the "h" of an https:// instead, and
      // slicing keeps it. chaveParcial answers the same question the rest of
      // the burst is answered with, so the repair and the steady state are one
      // rule rather than two that can disagree.
      typed = NFPR.Chave.chaveParcial(raw).slice(0, cfg.getParteFixaVariaveis());
    }

    /**
     * TYPING INTO A SCANNED BUFFER MAKES IT A PERSON'S. The flag used to last
     * until the buffer was emptied, so a volunteer correcting a bad read by
     * hand was still "a scanner" for the rest of that entry: the live verdict
     * stayed silent while they typed — the one moment it exists for — and the
     * note they then submitted never counted as typed, so nobody offered them
     * fixed parts. Backspace hands it over outright: no scanner ever sends one.
     *
     * A HUMAN-SPEED DIGIT HANDS IT OVER TOO, ON PROBATION FOR ONE KEYSTROKE.
     * A gap of 35 ms or more is usually a person, but it is also what a scan
     * looks like when the page's main thread stalls mid-read: every queued key
     * then arrives in a heap, with one long gap in front of the first of them.
     * Taken at face value that key makes the buffer a person's, and the
     * machine-speed key right behind it would then discard everything before it
     * as a person's leftovers — the scan's own head — and a perfect read would
     * be refused red. So if the very next keystroke comes back at machine
     * speed, the run it starts is the same burst, and when that run is long
     * enough to be believed nothing is discarded. A person who typed
     * one digit and then scanned is not caught by this: a new scan's first
     * character is itself a slow key, and it spends the probation.
     */
    function devolverAoHumano() {
      if (!bufferDeMaquina) return;
      bufferDeMaquina = false;
      retomavel = true;
    }

    /**
     * A SCAN THAT "RESUMES" ONTO A WHOLE KEY MAY BE A SECOND SCAN, and only the
     * text that follows can say which. A scanner that sends no Enter, with
     * autoEnviar off: the volunteer scans A, forgets to submit, and scans B
     * seconds later. B's first digit arrives slow and its second fast — exactly
     * the shape of a stalled scan resuming — so B was taken for the rest of A,
     * nothing was discarded, and the first 44-run in `raw` was still A's. The
     * cells showed A, Enter submitted A, and B vanished while the volunteer
     * believed it was read.
     *
     * IT CANNOT BE DECIDED WHEN THE BURST RESUMES. A scan really can stall after
     * its key is complete — inside a QR code's `|2|1|1|…` tail — and discarding
     * there would throw the only key away. So the resumption is only NOTED
     * (`inicioRetomada`, set in marcarRajada), and the decision waits for the
     * one thing a second read produces and a tail never does: a KEY-SHAPED
     * 44-run of its own. Key-shaped, not merely 44 characters — an off-line
     * NFC-e's QR tail carries a 56-character hex digest, which uppercases to a
     * 44+ run of [0-9A-F], and letters outside indices 6..17 are what keep it
     * from counting. When the second key is complete, everything before it
     * goes, exactly as for a person's leftovers.
     */
    function conferirSegundaLeitura() {
      if (inicioRetomada < 0) return;
      if (!RE_CHAVE_EM_TEXTO.test(raw.slice(inicioRetomada).toUpperCase())) return;
      raw = raw.slice(inicioRetomada);
      inicioRetomada = -1;
    }

    function onKeyDown(e) {
      if (!cfg.estaAtivo() || cfg.deveIgnorarEvento(e)) return;

      antesRaw = atualRaw;
      atualRaw = raw.length;

      // Spent by whatever this keystroke is, so the probation lasts one key.
      const eraRetomavel = retomavel;
      retomavel = false;

      const comModificador = e.ctrlKey || e.altKey || e.metaKey;

      // The rest of a reading's tail — see terminadorDeCauda. BEFORE the
      // timing heuristic and the idle timer, so a tail neither opens a run of
      // fast gaps on an empty buffer nor re-arms a timer over one.
      const agoraTecla = performance.now();
      const ehModificador = MODIFICADORES.has(e.key);
      const deltaTecla = agoraTecla - ultimaTeclaEm;
      if (!ehModificador) ultimaTeclaEm = agoraTecla;
      if (ehTerminador(e) && !comModificador && typed.length === 0 &&
          terminadorDeCauda(e, agoraTecla, deltaTecla)) {
        e.preventDefault();
        e.stopPropagation();
        fimDaEntradaEm = agoraTecla;
        return;
      }

      // The character this keystroke carries, upper-cased, and its class.
      // Computed here rather than at the append below because the SCANNER
      // HEURISTIC has to know whether this was a letter — see the next block.
      //
      // ONE KEYSTROKE, ONE CHARACTER: toUpperCase can LENGTHEN a character
      // (ß becomes SS), and 'SS' sits inside the A..Z range, so without the
      // length guard one key would append two characters to the buffer.
      const car = e.key && e.key.length === 1 ? e.key.toUpperCase() : '';
      const unico = car.length === 1;
      const ehDigito = unico && car >= '0' && car <= '9';
      const ehLetra = unico && car >= 'A' && car <= 'Z';

      // Update the fast-scan timing heuristic.
      const agora = performance.now();
      const delta = agora - ultimoKeyTime;
      ultimoKeyTime = agora;
      // A LETTER IS TRANSPARENT TO THE HEURISTIC — it neither opens a run,
      // lengthens one, nor ends one. A scan is confirmed by DIGITS, and by the
      // punctuation of a QR-code URL; never by letters.
      //
      // WHY: a key begins with its cUF, so a scanner's first characters are
      // always digits, and a real scan reaches RAJADA_MINIMA before its issuer
      // CNPJ can contribute a single letter. A PERSON rattling off letters is
      // not a scanner — and once letters could be typed at all, they were the
      // easiest way to fake a burst: four quick ones met the threshold,
      // marcarRajada declared the buffer a machine's, and it DISCARDED
      // everything typed before the run. The whole entry appeared to clear
      // itself, on a keystroke as ordinary as holding a letter key down.
      //
      // Letters still advance `ultimoKeyTime`, so the gap measured across one
      // is the true gap and a scan's run survives its own CNPJ.
      if (delta < LIMIAR_SCAN_MS) {
        // `escaneando` IS set by a letter, `rapidas` is not, and the split is
        // the whole of it: the first only says "characters are arriving fast",
        // which is true of a scanned URL's letters and is what keeps them out
        // of the entry below. The second is what CONFIRMS a burst, and
        // confirming one discards whatever was typed before it.
        escaneando = true;
        if (!ehLetra) {
          // The first fast gap opens a run whose first keystroke was the
          // PREVIOUS one — see marcarRajada for why that is where it begins.
          if (rapidas === 0) {
            inicioRaw = antesRaw;
            rajadaRetomada = eraRetomavel;
          }
          rapidas += 1;
        }
      } else if (!ehLetra) {
        rapidas = 0;
      }
      clearTimeout(scanResetTimer);
      scanResetTimer = setTimeout(() => {
        escaneando = false;
        // AUTO-SEND FIRES AT THE END OF A BURST, never at its 44th digit — see
        // the gate further down. A safety net rather than the normal path:
        // scanners terminate with Enter or Tab, so the branch above almost
        // always ran first and left an empty buffer here. The blank-input rule
        // is untouched and this is strictly stronger than it — a complete
        // 44-digit key, not merely something.
        if (bufferDeMaquina) {
          // THE SCAN IS OVER, AND SO IS ITS RUN. A slow digit would reset the
          // count on its own, but a letter is transparent to it — and a QR
          // code begins with one — so a second QR read seconds later used to
          // join the first one's run instead of opening its own, discarded
          // nothing, and Enter submitted the FIRST key.
          rapidas = 0;
          if (cfg.getAutoEnviar() && NFPR.Chave.extrairChave(raw).length === 44) enviar();
          return;
        }
        // A SUSPECTED RUN THAT ENDED SHORT WAS FINGERS. Nothing was discarded
        // and the buffer is theirs; what the suspicion held back is released
        // here — the live verdict, and an auto-send the digit path deferred
        // because the run might still have become a scan. Never on the
        // probation key, for the same reason as there.
        if (rapidas === 0) return;
        rapidas = 0;
        if (
          cfg.getAutoEnviar() &&
          !retomavel &&
          typed.length > 0 &&
          typed.length >= cfg.getParteFixaVariaveis()
        ) {
          enviar();
        } else {
          emitirMudanca();
        }
      }, FIM_SCAN_MS);

      // Esc empties the entry, and ONLY when there is something to empty. With
      // the buffer already clear it falls through to the page untouched, which
      // is what lets Esc keep meaning whatever it means there.
      if (e.key === 'Escape' && !comModificador && (typed.length || raw.length)) {
        e.preventDefault();
        e.stopPropagation();
        reset();
        emitirMudanca(); // repaint the cells as empty
        return;
      }

      // Terminator (Enter/Tab) — submit, but only if the volunteer typed something.
      if (ehTerminador(e) && !comModificador && typed.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        enviar();
        return;
      }

      // Let real browser shortcuts (Ctrl/Alt/Meta + key) pass through untouched.
      if (comModificador) return;

      // Backspace removes the last captured character.
      //
      // ...OF THE KEY, WHEN A SCAN IS IN THE BUFFER. Trimming both buffers by
      // one used to be right only while they held the same text, and after a
      // scan they do not: `raw` ends in whatever the scanner sent AFTER the key
      // (a QR code's `|2|1|1|…` tail), and under a fixed part `typed` holds only
      // the key's head. So with a scanner that sends no Enter, a volunteer who
      // Backspaced over the last digit shown and typed a new one saw `…789` in
      // the cells while `raw` still carried the scanned 44-run, and `…784` was
      // what went out. And a plain barcode under a fixed part was worse:
      // Backspace took the key's last digit off `raw`, no 44-run was left, and
      // Enter composed [the fixed part] + [the barcode's head] — the worst bug
      // this file has had, by a fourth door.
      //
      // So the first Backspace into a scanned buffer cuts `raw` down to the key
      // it carries — what the cells were showing — and from then on the two
      // edit together. `typed` is re-read from it under the fixed part's cap,
      // as during the burst. Nothing here decides how the result is judged;
      // registrador.js never composes a buffer that held a scan.
      if (e.key === 'Backspace') {
        e.preventDefault();
        bufferDeMaquina = false; // no scanner sends one — see devolverAoHumano
        rapidas = 0; // ...so no run it lands in is one
        inicioRetomada = -1; // ...and nothing after it is a scanner's second read
        if (escaneado) {
          if (!aparado) {
            raw = NFPR.Chave.chaveParcial(raw);
            aparado = true;
          }
          raw = raw.slice(0, -1);
          typed = raw.slice(0, cfg.getParteFixaVariaveis());
        } else {
          typed = typed.slice(0, -1);
          raw = raw.slice(0, -1);
        }
        emitirMudanca();
        return;
      }

      if (unico) {
        // A CONFIRMED SCAN IS READ OUT OF `raw`, NEVER ACCUMULATED KEY BY KEY.
        // Everything the scanner sends goes to `raw`, and `typed` becomes what
        // Chave.chaveParcial says the key is: the 44-run once it is complete,
        // and the LAST run of key characters while it is still arriving.
        //
        // THIS IS WHAT KEEPS A QR-CODE URL OUT OF THE ENTRY, and it replaced a
        // rule that only worked from an empty buffer. "Is it a digit?" used to
        // separate the key from the URL around it for free, because a key was
        // all digits; when letters became legal, the obvious repair was to ask
        // WHERE the character would land — and the window is 6..17, so a scan
        // fired while the volunteer already had eight characters typed put the
        // URL's own letters straight into the gap: `41260912` + `HTTPS`, then
        // the key welded on behind it. Deriving from `raw` cannot have that
        // bug, because separating a key from the text around it is exactly
        // what chaveParcial does, wherever the buffer happened to be.
        //
        // MACHINE SPEED ONLY. At human speed this falls through, so a person
        // typing into a scanned buffer still takes it over (devolverAoHumano).
        if (bufferDeMaquina && delta < LIMIAR_SCAN_MS) {
          e.preventDefault();
          acumularRaw(car);
          conferirSegundaLeitura();
          typed =NFPR.Chave.chaveParcial(raw).slice(0, cfg.getParteFixaVariaveis());
          emitirMudanca();
          return;
        }
        // EVERY KEY CHARACTER IS ACCEPTED, AND WHERE IT MAY STAND IS A VERDICT
        // RATHER THAN A FILTER. A letter belongs only at indices 6..17, but
        // `FORMATO` is what says so, on the whole key, at submit — and the live
        // verdict says it while typing, since a letter in the cUF makes the
        // state unreadable at digit 2. Refusing the keystroke here instead
        // taught the volunteer nothing: the letter simply vanished, and an
        // entry that swallows keystrokes in silence reads as broken software.
        // ...AND WHILE CHARACTERS ARE ARRIVING FAST, A LETTER MUST KEEP THE
        // ENTRY SHAPED LIKE A KEY. `typed` is a key prefix by induction, so
        // appending a letter is only plausible where a key could carry one —
        // and during a scan the letters that fail that test are the URL:
        // "https", "www", "fazenda", "qrcode". They flashed through the cells a
        // few at a time before the burst was even confirmed.
        //
        // ONLY WHILE FAST. At human speed every letter is accepted wherever it
        // is typed and the verdict refuses it, which is the rule this file
        // settled on after the same test, applied to typing, made stray letters
        // vanish in silence. A person rattling letters off inside 35 ms of each
        // other is the one case where both readings are defensible, and the
        // scanner's is the useful one.
        const cabeNaChave = !escaneando || NFPR.Chave.posicaoAlfanumerica(typed.length);
        if (ehDigito || (ehLetra && cabeNaChave)) {
          e.preventDefault();
          // A LETTER NEVER CONFIRMS A BURST — see the heuristic above.
          if (delta < LIMIAR_SCAN_MS) { if (ehDigito) marcarRajada(delta); }
          else devolverAoHumano();
          // `raw` records EVERYTHING the scanner sent, unconditionally. Only
          // `typed` is capped by the fixed part. Capping raw as well (as this
          // once did) meant a 44-digit barcode stopped at the fixed part's
          // variable-digit count, so extrairChave never found its 44-digit run
          // and the key was composed from the fixed part plus the barcode's
          // FIRST digits — a wrong key, usually caught by the CDV but
          // occasionally not.
          //
          // The 44-digit run in `raw` is now the ONLY thing that tells
          // NFPR.ParteFixa.resolver a scan happened rather than typing, and
          // therefore the only thing stopping that same fabrication. Note what
          // the cap below means: under a fixed part, `typed` holds a scan's
          // FIRST digits — the head of the barcode, never the tail the fixed
          // part wants. That is precisely why resolver must not compose from
          // it.
          acumularRaw(car);
          const limite = cfg.getParteFixaVariaveis();
          if (typed.length >= limite) {
            // `typed` is full, and stays full. A BURST still repaints: the
            // registrar draws a believed scan from `raw` with the fixed part
            // set aside, and a scan outruns a short fixed part's count by
            // 30-odd digits.
            if (bufferDeMaquina) emitirMudanca();
            return;
          }
          typed += car;
          emitirMudanca();
          // NOT DURING A BURST. A QR scan is `…/nfce/qrcode?p=<44 digits>|2|1|1|ABC`,
          // so with no fixed part the run of 44 completes MID-READING: the key
          // went out correctly at digit 44, reset() emptied both buffers, and
          // the trailing `2`, `1`, `1` landed in a fresh `typed` — which the
          // scanner's own Enter then submitted as a key. One correct
          // registration and one spurious red toast, on every QR scan, whenever
          // the preference was on. A machine burst submits at its END instead
          // (the idle timer above); this line is for fingers.
          //
          // AND NEVER ON THE KEY ON PROBATION (`retomavel`, set a few lines up
          // by devolverAoHumano). It may be a stalled scan, and under a fixed
          // part `typed` holds a scan's HEAD: submitting here would compose
          // [the fixed part] + [the barcode's first digits] — a key nobody
          // scanned, which is the worst bug this file has had. The next
          // keystroke settles it; a person whose first digit after a scan
          // completes the entry just presses Enter.
          //
          // AND NOT INSIDE A SUSPECTED RUN (`rapidas`). Its first few keys are
          // not yet a burst, but they may be one: a scan arriving under a fixed
          // part fills a short variable count before RAJADA_MINIMA is reached,
          // and submitting then is the same [fixed part] + [barcode head]
          // composition. If the run ends short it was fingers, and the idle
          // timer sends it.
          if (
            cfg.getAutoEnviar() &&
            !bufferDeMaquina &&
            !retomavel &&
            rapidas === 0 &&
            typed.length >= limite
          ) {
            enviar();
          }
          return;
        }
        // Punctuation arriving inside a fast scan = part of a QR-code URL. It
        // is also what CONFIRMS such a scan, now that letters no longer do: a
        // URL is full of ':', '/', '.' and '?', and a person typing a key is
        // not.
        if (escaneando) {
          e.preventDefault();
          marcarRajada(delta);
          acumularRaw(e.key);
          return;
        }
        // Block "/" so Firefox's quick-find bar never steals focus mid-entry.
        if (e.key === '/') {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    }

    // Support pasting a key or a QR URL (Ctrl+V, or some scanners' paste mode).
    function onPaste(e) {
      if (!cfg.estaAtivo() || cfg.deveIgnorarEvento(e)) return;
      const texto = e.clipboardData && e.clipboardData.getData('text');
      if (!texto) return;
      e.preventDefault();
      const chave = NFPR.Chave.extrairChave(texto);
      if (chave.length === 44) {
        raw = chave;
        typed = chave;
        enviar();
        return;
      }
      const limpo = String(texto).toUpperCase().replace(/[^0-9A-Z]/g, '');
      if (!limpo) return;
      // A PASTE THAT DOES NOT FIT WHAT IS LEFT OF THE ENTRY IS A READING, NOT
      // TYPING. It used to be appended whole, past the fixed part's variable
      // count — which no keystroke can do — and the composition then took only
      // the FIRST N characters: twelve digits pasted where nine fit went out as
      // the fixed part plus the first nine, the other three dropped in silence.
      // Which N were meant is unknowable, and guessing is how a key nobody holds
      // gets filed. So it is judged alone and at once, like a burst
      // (`escaneado`: never composed), and anything short of a key is red —
      // which clears the entry, as every red does.
      const limite = cfg.getParteFixaVariaveis();
      if (typed.length + limpo.length > limite) {
        reset();
        raw = limpo;
        typed = limpo;
        escaneado = true;
        enviar();
        return;
      }
      // One that fits is typing done in one go, and gets what typing gets —
      // including the auto-send when it completes the entry. `raw` takes the
      // same characters, so the two still hold one text.
      typed += limpo;
      acumularRaw(limpo);
      emitirMudanca();
      if (cfg.getAutoEnviar() && !bufferDeMaquina && typed.length >= limite) enviar();
    }

    document.addEventListener('keydown', onKeyDown, true); // capture phase
    document.addEventListener('paste', onPaste, true);

    return {
      reset,
      destruir() {
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('paste', onPaste, true);
        clearTimeout(scanResetTimer);
      }
    };
  }

  NFPR.Capture = { iniciar };
})(typeof globalThis !== 'undefined' ? globalThis : self);
