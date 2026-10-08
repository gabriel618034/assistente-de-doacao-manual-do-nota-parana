/**
 * entrada.js  (offline page bootstrap)
 * -----------------------------------------------------------------------------
 * Orchestrator for src/offline/entrada.html — the bundled page a volunteer
 * lands on when the donation page can't load (redirected by the background
 * script) or opens deliberately from the toolbar popup.
 *
 * The pipeline up to the durable queue is NFPR.Registrador, shared verbatim
 * with the live page. This file adds only what is specific to being offline:
 * the "saved, not sent" wording, the queue restore, and the connection strip.
 *
 * Nothing is ever sent from here — donation.js is intentionally NOT loaded, and
 * the next time the real donation page opens with a connection, its existing
 * drain loop picks the queue up and sends through the normal path (with each
 * key's target CNPJ frozen at scan time, exactly like the live page).
 *
 * What this page never does is SEND. It does make two kinds of read-only
 * request, and it is worth being exact about them:
 *
 *   1. The reachability probe behind the connection strip at the bottom of this
 *      file. `navigator.onLine` cannot tell a live internet from a dead router,
 *      and claiming the connection is back when it isn't sends the volunteer on
 *      a round trip that lands right back on this page.
 *   2. The entity lookup in the settings modal — this page loads entidade.js
 *      and settings-ui.js, so adding an entity here GETs
 *      app/v1/documentoFiscalDoado/entidadePorCnpj/<cnpj>, cross-origin, via
 *      the app/v1 host permission. That is deliberate: the strip can turn green
 *      on this page, so the lookup can genuinely succeed, and losing it would
 *      make the offline settings form worse than the popup's.
 *
 * The banner used to claim the probe was "the one and only network request —
 * never add another", which was never true. Do not "enforce" that by deleting
 * entity verification.
 *
 * De-dup here is stricter than on the live page: a saved key has no failure
 * path, so it stays blocked for the whole session (and keys already sitting in
 * the durable queue are pre-blocked and shown on load).
 * -----------------------------------------------------------------------------
 */
(function () {
  'use strict';
  var NFPR = globalThis.NFPR;
  if (!NFPR || !NFPR.UI) return; // dependencies must have loaded first
  const { Config, Audio } = NFPR;

  const PAGINA_DOACAO = NFPR.Site.URL_DOACAO;
  const MSG_GUARDADA = 'Guardada — será enviada quando a página de doação for aberta com conexão à internet.';

  // Same three states as the live page, said differently: here an outage is
  // the normal condition, not an interruption.
  const RODAPE_GUARDA = 'você pode continuar escaneando: as notas ficam guardadas neste computador.';
  const MSG_CONEXAO = {
    verificando: 'Verificando a conexão…',
    rede: 'Sem conexão com a internet — ' + RODAPE_GUARDA,
    servidor: 'O site do Nota Paraná não respondeu — ' + RODAPE_GUARDA,
    online: 'Conexão restabelecida. Ao terminar de escanear, abra a página de doação para enviar as notas guardadas.'
  };

  document.addEventListener('DOMContentLoaded', function () {
    start();
  });

  async function start() {
    const ui = await NFPR.UI.montar({
      modoOffline: true,
      montarEm: document.getElementById('entrada-root'),
      // The offline page never ADDS to nfpr:falhas, but the shared bootstrap
      // shows the list here too, so its "Limpar a lista" has to really empty
      // it. Left out, ui.js's fallback hid the bar and wrote nothing, and the
      // list came back on the next load.
      aoLimparFalhas: () => Config.limparFalhas(),
      conexaoPermanente: true,
      acaoConexao: {
        rotulo: 'Abrir a página de doação',
        // Re-verify at click time: on a flaky link the connection may have died
        // again since the probe that turned the bar green, and a failed
        // navigation would just bounce the volunteer back to this page.
        //
        // `conexao` is declared further down, after this mount resolves. That is
        // safe because this only ever runs on a click, long after — but it is
        // the reason the watchdog cannot be started before the UI it paints.
        async aoClicar(botao) {
          const rotulo = botao.textContent;
          botao.disabled = true;
          botao.textContent = 'Verificando…';
          const alcancou = await conexao.verificarAgora(); // repaints the bar itself
          botao.disabled = false;
          botao.textContent = rotulo;
          if (alcancou) location.href = PAGINA_DOACAO;
        }
      }
    });

    // Painted before the first probe resolves, so the bar never claims a
    // verdict it has not reached yet.
    ui.setConexao('verificando', MSG_CONEXAO.verificando);

    // Declared BEFORE the registrar starts: capture goes live inside iniciar(),
    // and the queue read below is an await a scan can land in the middle of.
    let guardadas = 0;

    const reg = await NFPR.Registrador.iniciar({
      ui,
      msgDuplicada: 'Esta chave já está guardada para envio.',
      async aoAceitarChave({ chave, itemId, gravacao }) {
        ui.atualizarItem(itemId, { estado: 'aguardando', mensagem: MSG_GUARDADA });
        // The durable queue is the ONLY record this page ever makes of the
        // note, so unlike the live page it waits for the write. If it fails
        // the note is simply gone — say so plainly and forget the key, so
        // scanning it again is a real retry and not rejected as a duplicate.
        try {
          // Only a key the write actually ADDED counts. Under "enviar sem
          // validar" a repeat is let through with a marker instead of refused,
          // and the queue keeps its first entry, so counting every successful
          // write reported one note more than was saved.
          if (await gravacao) {
            guardadas += 1;
            ui.setFila({ restantes: guardadas });
          }
        } catch (e) {
          reg.esquecerChave(chave);
          Audio.erro();
          ui.atualizarItem(itemId, {
            estado: 'erro',
            mensagem:
              'Não foi possível guardar esta nota neste computador, e ela não foi salva. ' +
              'Escaneie novamente; se o problema persistir, o armazenamento do navegador pode estar cheio.'
            // Nothing is written to nfpr:falhas: that record is for notes the
            // SERVER rejected without an answer we could read, and this page
            // never sends. Our own diagnosis, on the row, is the whole story.
          });
          return;
        }
        // NO SOUND HERE ANY MORE, and the deletion is the point rather than an
        // oversight. This used to play Audio.sucesso() — the "the government
        // has it" chime — on a page that never sends anything, so the one sound
        // meant "registered" on the live page and merely "written down" here.
        // The read cue now fires from the shared bootstrap, before this handler
        // runs, and says exactly what this page can honestly claim.
        //
        // What is lost is that the cue no longer waits for the durable write to
        // land. That is the right trade and it costs nothing: a failed write
        // takes the branch above, which buzzes and says the note was NOT saved.
        // Blip-then-buzz is the same shape the live page has always had for a
        // note that is read and then refused.
      }
    });

    // ---- Restore the durable queue --------------------------------------------
    // Same rule as the live page: PENDING WORK IS A QUANTITY, not a list. Saved
    // notes go to the indicator, never to rows — a thousand of them is the view
    // that made a fresh scan invisible behind the backlog, and here it would be
    // worse, because nothing on this page ever settles and those rows could
    // never become anything.
    //
    // Keys are still pre-blocked, so rescanning one says "já guardada" instead
    // of silently doing nothing. Nothing here is ever unblocked afterwards:
    // this page has no send, so a saved key has no failure path.
    const salvas = await Config.obterFila();
    guardadas = salvas.length;
    for (const pendente of salvas) reg.bloquearChave(pendente.chave);
    ui.setFila({ restantes: guardadas });

    // ---- Connection strip -----------------------------------------------------
    // The strip is the registrar's own connection bar (ui.js), configured to
    // stay visible and to carry the way back. All the hard parts — the
    // navigator.onLine rule, what counts as reachable, the backoff — are in
    // NFPR.Connectivity, shared with the live page so the two cannot disagree.
    //
    // `proativo` because there is no send here whose failure could tell us
    // anything: noticing when the way back opens is this page's whole job.
    // `permitirOpaco` because on Firefox the host permission is opt-in, and
    // without it a normal probe is blocked before it leaves the browser, which
    // looks exactly like a dead network.
    //
    // We only ever OFFER the way back — navigating is the volunteer's click,
    // never automatic (it would interrupt a scan session).
    const conexao = NFPR.Connectivity.iniciar({
      urlSonda: PAGINA_DOACAO,
      proativo: true,
      permitirOpaco: true,
      aoCair(motivo) {
        const estado = motivo === 'REDE' ? 'rede' : 'servidor';
        ui.setConexao(estado, MSG_CONEXAO[estado]);
      },
      aoVoltar() {
        ui.setConexao('online', MSG_CONEXAO.online);
      }
    });

  }
})();
