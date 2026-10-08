/**
 * audio.js  (content only)
 * -----------------------------------------------------------------------------
 * Short Web Audio cues so a volunteer hears the outcome without looking up:
 *   - erro()    harsh buzz   (invalid / rejected)
 *   - aviso()   gentle ping  (warning, e.g. duplicate or lost focus)
 *   - leitura() one note    (the key was READ and queued — nothing sent yet)
 *   - sucesso() rising pair (the site accepted the donation)
 *
 * THE LAST TWO ARE DIFFERENT PROMISES AND MUST NOT BE CONFUSED. "I read you"
 * and "the government has it" arrive within the same second on a fast
 * connection, and the volunteer hearing them is looking at a receipt, not at
 * the screen.
 *
 * ONE INSTRUMENT, TWO GESTURES: identical triangle voice and envelope, so they
 * belong together, distinguished by NOTE COUNT and PITCH — leitura is a single
 * F#5, sucesso is E5 rising to B5. The single lower stroke reads as the lesser
 * event, which is the ranking we want: registered beats read.
 *
 * ORDER OF PRIORITY, learned the hard way. leitura was first built to differ on
 * every axis at once — a short flat sine blip — and was simply INAUDIBLE in a
 * room with people in it. A cue nobody hears is worse than one resembling its
 * neighbour, so: AUDIBLE FIRST, DISTINGUISHED SECOND. Never make either quieter
 * or shorter to separate them; change the note count or the interval instead.
 *
 * Each cue is gated by its own preference, so a volunteer who wants the read
 * blip and nothing else gets exactly that.
 *
 * THE AUDIOCONTEXT IS UNLOCKED BY A GESTURE, AND NOT EVERY GESTURE IS ONE.
 * Browsers start a context only inside user ACTIVATION, and a keydown for Ctrl,
 * Shift or Esc, or a touchstart, is not activation. The first build created
 * the context on the first keydown/pointerdown/touchstart of any kind and then
 * stopped listening: a volunteer who pressed Shift right after load got a
 * suspended context, a refused resume() — Chrome logs "The AudioContext was
 * not allowed to start" — and no cue for the rest of the page. So the
 * listeners stay armed until the context is actually RUNNING, a gesture the
 * browser says carries no activation is skipped (creating the context there
 * changes nothing and only logs the warning), every later one retries
 * resume(), and a context the system suspends afterwards re-arms them.
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  var NFPR = (root.NFPR = root.NFPR || {});

  var ctx = null;
  var habilitadoAlerta = true;
  var habilitadoLeitura = false;
  var habilitadoSucesso = false;

  // Every event the HTML spec lets carry user activation: keydown (except Esc
  // and browser shortcuts), mousedown, pointerdown for a mouse, and pointerup
  // and touchend for a finger — a touch activates when it LIFTS, which is why
  // touchstart is not here.
  var GESTOS = ['keydown', 'mousedown', 'pointerdown', 'pointerup', 'touchend'];
  var armado = false;

  // Returns the context only if already running. Never creates or resumes it —
  // that only happens inside the gesture handler below.
  function contextoReady() {
    if (!ctx || ctx.state !== 'running') return null;
    return ctx;
  }

  function armar() {
    if (armado) return;
    armado = true;
    GESTOS.forEach(function (evento) {
      document.addEventListener(evento, aoGesto, true);
    });
  }

  function desarmar() {
    if (!armado) return;
    armado = false;
    GESTOS.forEach(function (evento) {
      document.removeEventListener(evento, aoGesto, true);
    });
  }

  // Stop listening once, and only once, the context really runs.
  function conferir() {
    if (ctx && ctx.state === 'running') desarmar();
  }

  // Called from within a gesture — the only place a context is created or
  // resumed.
  function aoGesto() {
    // Where the browser can say whether this gesture activates the page, a
    // gesture that does not is skipped rather than spent. Firefox 120+ and
    // Chrome both expose it; where it is absent, try anyway.
    var ativacao = root.navigator && root.navigator.userActivation;
    if (ativacao && !ativacao.isActive) return;
    try {
      if (!ctx || ctx.state === 'closed') {
        ctx = new AudioContext();
        // Suspended later by the system (a device change, a sleeping laptop):
        // listen for the next gesture again rather than stay silent.
        ctx.onstatechange = function () {
          if (ctx.state === 'running') desarmar();
          else armar();
        };
      }
      if (ctx.state !== 'running') {
        var p = ctx.resume();
        if (p && p.then) p.then(conferir, function () {});
      }
    } catch (e) {}
    conferir();
  }

  armar();

  function setHabilitadoAlerta(v) { habilitadoAlerta = !!v; }
  function setHabilitadoLeitura(v) { habilitadoLeitura = !!v; }
  function setHabilitadoSucesso(v) { habilitadoSucesso = !!v; }

  /** Attention-grabbing double buzz — cuts through background noise. */
  function erro() {
    if (!habilitadoAlerta) return;
    var ac = contextoReady();
    if (!ac) return;
    var t = ac.currentTime;

    // Two short pulses of a detuned dual-oscillator buzz. The slight
    // frequency offset between the two oscillators creates a beating effect
    // that's hard to miss even over music.
    for (var i = 0; i < 2; i++) {
      var start = t + i * 0.13;
      var dur = 0.09;

      [180, 187].forEach(function (freq) {
        var osc = ac.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, start);

        var g = ac.createGain();
        g.gain.setValueAtTime(0.0001, start);
        g.gain.linearRampToValueAtTime(0.3, start + 0.008);
        g.gain.setValueAtTime(0.3, start + dur - 0.015);
        g.gain.linearRampToValueAtTime(0.0001, start + dur);

        osc.connect(g);
        g.connect(ac.destination);
        osc.start(start);
        osc.stop(start + dur);
        osc.onended = function () { osc.disconnect(); g.disconnect(); };
      });
    }
  }

  /** Soft three-note ping — heads up. */
  function aviso() {
    if (!habilitadoAlerta) return;
    var ac = contextoReady();
    if (!ac) return;
    var t = ac.currentTime;

    var osc = ac.createOscillator();
    var g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(261.63, t); // C4
    osc.frequency.setValueAtTime(311.13, t + 0.11); // Eb4
    osc.frequency.setValueAtTime(523.25, t + 0.22); // C5
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.01);
    g.gain.linearRampToValueAtTime(0.4, t + 0.22);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.85);

    osc.connect(g);
    g.connect(ac.destination);
    osc.onended = function () {
      osc.disconnect();
      g.disconnect();
    };
    osc.start(t);
    osc.stop(t + 0.85);
  }

  /**
   * The key was read and queued: a single F#5, in sucesso()'s voice and
   * envelope — same triangle, same 0.32 peak, same 0.42 s decay.
   *
   * TWO AXES SEPARATE IT FROM sucesso(), and it is worth knowing they were
   * arrived at by subtraction rather than design. It began as a short flat sine
   * blip, separated from the chime on every axis at once (timbre, length, note
   * count, pitch) — and was INAUDIBLE in a room with people in it at 0.22 gain
   * over 0.11 s. Borrowing the chime wholesale and transposing it down a fourth
   * fixed the volume and cost every axis but pitch. Dropping the lower note
   * gives one of them back:
   *
   *   leitura  ONE note,  F#5              — a single stroke, no movement
   *   sucesso  TWO notes, E5 -> B5         — a rise, and it ends higher
   *
   * So the read cue is heard as a plainer, lower event than the confirmation,
   * which is the ranking we want: registered beats read. F#5 is sucesso's own
   * top note dropped a perfect fourth, which is why the two sit together
   * without sounding like an accident.
   *
   * KEEP THE ENVELOPE IN STEP with sucesso: it is the same instrument, and an
   * edit to one wants the same edit to the other. The frequency and the note
   * count are the parts that must NOT converge.
   */
  function leitura() {
    if (!habilitadoLeitura) return;
    var ac = contextoReady();
    if (!ac) return;
    var t = ac.currentTime;

    var g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    g.connect(ac.destination);

    var o = ac.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(739.99, t); // F#5 — sucesso's B5, a fourth down
    o.connect(g);
    o.onended = function () {
      o.disconnect();
      g.disconnect();
    };
    o.start(t);
    o.stop(t + 0.42);
  }

  /** Bright rising two-note chime — success. */
  function sucesso() {
    if (!habilitadoSucesso) return;
    var ac = contextoReady();
    if (!ac) return;
    var t = ac.currentTime;

    var g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    g.connect(ac.destination);

    [[659.25, 0], [987.77, 0.09]].forEach(function (par) {
      var o = ac.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(par[0], t + par[1]);
      o.connect(g);
      o.start(t + par[1]);
      o.stop(t + 0.42);
      o.onended = function () {
        o.disconnect();
      };
    });
    setTimeout(function () {
      g.disconnect();
    }, 600);
  }

  NFPR.Audio = {
    erro: erro,
    aviso: aviso,
    leitura: leitura,
    sucesso: sucesso,
    setHabilitadoAlerta: setHabilitadoAlerta,
    setHabilitadoLeitura: setHabilitadoLeitura,
    setHabilitadoSucesso: setHabilitadoSucesso
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
