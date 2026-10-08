/**
 * content.js  (orchestrator — live donation page)
 * -----------------------------------------------------------------------------
 * Everything up to and including the durable queue lives in NFPR.Registrador,
 * shared with the offline page. This file owns the half the offline page does
 * not have: SENDING.
 *
 *   (shared) capture -> judge -> de-dup -> freeze CNPJ -> queue
 *   (here)   -> judge again -> sequential send -> classify the answer
 *            -> update UI/queue
 *
 * The second judgement is not paranoia about the first. Keys restored from the
 * durable queue never went through the shared half on this load, and the one
 * verdict time can switch ON is the donation deadline: a note queued offline in
 * August and drained in October is now ineligible, and asking the server about
 * it costs a round trip to be told what its own digits already said.
 *
 * Submissions go through a BOUNDED POOL (NFPR.Despacho): at most LARGURA_ENVIO
 * in flight, dispatched strictly in the order they were entered, each with its
 * own freshly fetched form token — tokens are never batched or shared. The cap
 * is ours rather than the browser's on purpose; despacho.js says why. Keys that
 * fail for network/session reasons stay in the durable queue and are retried
 * automatically on the next page load.
 *
 * The two global failures — the connection dying, the session dying — are
 * latched conditions, not per-note verdicts. Each is discovered once, stops or
 * parks the queue, and sounds once. Rediscovering either one per note is what
 * turned a thousand-note drain into a thousand doomed requests and a thousand
 * error buzzes.
 *
 * De-dup rule: a key is blocked while it is in flight or after it succeeded;
 * a key whose attempt FAILED is forgotten (esquecerChave), so re-scanning it
 * retries at once. That is the one de-dup difference from the offline page,
 * which has no failure path and keeps every saved key blocked. A key refused
 * as INELIGIBLE stays blocked on both pages, carrying its verdict, because
 * rescanning it could only produce the same answer.
 * -----------------------------------------------------------------------------
 */
(function () {
  'use strict';
  const NFPR = globalThis.NFPR;
  if (!NFPR || !NFPR.UI) return; // dependencies must have loaded first
  const { Config, Audio } = NFPR;

  // A session problem never means the NOTE failed. Same promise as scanning
  // while the internet is down, because it is the same situation.
  //
  // It names the volunteer's own step: a session never "comes back" by itself —
  // someone has to log in again, and the bar beside it carries that link.
  const MSG_GUARDADA_SESSAO = 'Guardada — será enviada quando você entrar novamente no Nota Paraná.';
  const MSG_GUARDADA_SERVIDOR = 'Guardada — será enviada automaticamente quando o site voltar a funcionar.';

  (async function start() {
    const cfg = await Config.obterConfig();

    // Deal with the server's duplicate-session screen before anything else:
    // detection is a document read and the /sair request is fire-and-forget, so
    // the sooner it starts the sooner the page is usable. Reacting to it is a
    // subscription, which is why none of the state below has to be hoisted
    // above the mount any more (see the WHY in sessao.js).
    const encerraAuto = cfg.preferencias.encerrarSessoesDuplicadas !== false;
    const sessao = NFPR.Sessao.tratarDuplicada(encerraAuto);

    const ui = await NFPR.UI.montar({
      // The one control that empties nfpr:falhas without a note registering.
      // Reachable only from inside the page that lists the notes — see the
      // comment on Config.limparFalhas for why that placement is the point.
      aoLimparFalhas: () => Config.limparFalhas()
    });

    const aguardandoSessao = []; // [tarefa] stuck behind the session
    const aguardandoConexao = []; // [tarefa] stuck behind an outage
    const duplicadas = []; // [tarefa] refused because of a second session
    // The latched session failure, if one has happened. Declared up here with
    // the rest of the state rather than beside the functions that use it, so
    // nothing can reach it before it exists. See "A dead session is ONE
    // condition" below.
    let sessaoMorta = null;
    // Targets the server has refused outright, cnpj -> its own sentence, and the
    // notes stranded on them. Same reasoning as sessaoMorta for living up here.
    const entidadesRecusadas = new Map();
    const aguardandoEntidade = []; // [tarefa] stranded on a refused target
    // The latched "the server cannot judge donations right now" condition, and
    // the notes parked behind it. Same reason as sessaoMorta for living up here.
    let servidorConfuso = false;
    const aguardandoServidor = []; // [tarefa] parked behind a confused server
    const emEspera = new Set(); // [tarefa] on a retry timer: in no list, not in the pool

    // THE DUPLICATE SESSION IS ON SCREEN AND NOTHING HAS BEEN SENT YET, so no
    // note has discovered it and nothing else would say a word until one fails.
    // Say it now, on the SAME bar that carries every later state of this story.
    //
    // There used to be a separate banner for this one moment. Everything after
    // it belonged to this bar already, so the two ran side by side saying
    // overlapping things — which is how they ended up disagreeing about what to
    // do next. The banner is gone; this line is the whole of what it did.
    //
    // Deliberately the SAME sentence as the per-note path, "As notas continuam
    // guardadas" included. That clause is not a claim about notes already
    // queued — it is the promise that makes it safe to start scanning right
    // now, which is exactly what someone reading this at load needs to know.
    //
    // Only when the preference is off. With it on, a termination is already
    // running and the subscription below has the floor.
    if (sessao.detectada && !encerraAuto) {
      pintarBarraSessao({ codigo: 'SESSAO_DUPLICADA' });
    }

    // ---- First run on a duplicate session: finish it for them -----------------
    // The worst screen this extension can show. Nothing is configured, so the
    // entry is blocked and a card asks for a CNPJ; the site has also just
    // reported a duplicate session, so a bar asks them to log in again. Two
    // calls to action, and the louder one is the wrong one — configuring now
    // cannot verify the CNPJ, so it saves an UNVERIFIED entity, which is the
    // one starting state the refused-entity machinery exists to survive.
    //
    // There is nothing here for the volunteer to decide. The termination is
    // already running; when it settles, reloading is the only next step. So the
    // panel takes the screen, says the one sentence, and does it.
    //
    // ONLY WITH NOTHING TO LOSE, which on first run is free: with no entity the
    // entry is blocked, so no note can be queued and none can be in flight. A
    // reload with work in flight would throw away answers and re-send whatever
    // sat inside removerDaFila's coalescing window.
    const primeiroUso = !Config.entidadeAtiva(cfg);
    // ONE AUTOMATIC ATTEMPT PER TAB. `/sair` can fail to take — sessao.js says
    // so, and the only sign of it is the server still reporting two sessions.
    // Without this the sequence is: take screen, /sair, reload, same screen,
    // /sair, reload… for ever, wearing a reassuring message the whole time,
    // which is the worst way for this to break because it looks like it works.
    // The marker lives in the host page's sessionStorage: per tab, survives the
    // reload, dies with the tab. Cleared on any load that is NOT the duplicate
    // screen, so it guards a loop rather than the rest of the session.
    const CHAVE_TENTATIVA = 'nfpr:auto-encerrou';
    const jaTentou = () => {
      try {
        return sessionStorage.getItem(CHAVE_TENTATIVA) === '1';
      } catch (e) {
        return true; // cannot remember: treat as spent, never risk the loop
      }
    };
    if (!sessao.detectada) {
      try {
        sessionStorage.removeItem(CHAVE_TENTATIVA);
      } catch (e) {
        /* nothing to clear, nothing to do */
      }
    }
    // A floor on how briefly the sentence can be on screen, and it is there for
    // the FAILURE path, not the ordinary one. A healthy `/sair` takes about ten
    // seconds (see the constant below) and needs no help being readable — but
    // with no network the fetch rejects at once, sessao.js swallows that in its
    // `.catch`, and the promise settles in the same frame it was created. The
    // page would then appear to reload on its own, which is the confusion this
    // screen exists to remove.
    const PISO_TAKEOVER_MS = 900;
    // TEN, BECAUSE /sair TAKES TEN. Measured on the live site (2026-09-05):
    // `/nfprweb/publico/sair` answers at ~10.4 s, reliably enough that the
    // number is almost certainly a fixed delay on their side, not load. So the
    // counter is not decoration filling an unknown wait — it very nearly IS the
    // wait, and it runs out just before the reload it is announcing. See the
    // session-termination entry in DOCS.md's protocol section.
    //
    // PURELY ILLUSTRATIVE — it counts, it does not decide. The reload happens
    // when `/sair` resolves and at no other time. A counter that also expired
    // into a reload would cut the request off four tenths of a second before it
    // answers, and a `/sair` that never lands leaves the duplicate session
    // exactly where it was: worse than waiting, and invisible.
    const SEGUNDOS_TAKEOVER = 10;

    // A termination started — by the preference, by the bar, or by the button
    // on one of these very items. Everything refused for a duplicate session is
    // now being fixed, so it moves to "Encerrando as sessões abertas…".
    sessao.aoEncerrar((concluida) => {
      if (primeiroUso && sessao.detectada && !jaTentou()) {
        let restam = SEGUNDOS_TAKEOVER;
        let tique = null;
        let recarregou = false;
        const pintarTakeover = () =>
          ui.setTakeover(
            'Encerrando as sessões abertas…',
            restam > 0
              ? 'Recarregando em ' + restam + ' s…'
              : 'A página será recarregada em instantes…'
          );
        // ONE CALLER AND ONE RELOAD. Only the request settling gets here — the
        // countdown below never does, deliberately (see SEGUNDOS_TAKEOVER).
        // The guard is for the settle firing twice, not for a second source.
        const recarregar = () => {
          if (recarregou) return;
          recarregou = true;
          clearInterval(tique);
          try {
            sessionStorage.setItem(CHAVE_TENTATIVA, '1');
          } catch (e) {
            /* jaTentou already fails closed when storage is unavailable */
          }
          location.reload();
        };
        pintarTakeover();
        tique = setInterval(() => {
          restam -= 1;
          pintarTakeover();
          // Zero is the end of the COUNTER, not of the wait: the request lands
          // a moment later and the reload comes with it. Stop ticking and let
          // the last sentence stand.
          if (restam <= 0) clearInterval(tique);
        }, 1000);
        const desde = Date.now();
        concluida.then(() =>
          setTimeout(recarregar, Math.max(0, PISO_TAKEOVER_MS - (Date.now() - desde)))
        );
      }
      // The label this bar is ABOUT to offer, drawn in place and inert, so the
      // bar does not grow when the wait ends and the link goes live.
      ui.setSessao({
        mensagem: 'Encerrando as sessões abertas…',
        rotulo: NFPR.Donation.LINK_LOGIN.rotulo,
        pendente: true
      });
      for (const tarefa of duplicadas.splice(0)) {
        noticiar(tarefa, { estado: 'aguardando', mensagem: MSG_GUARDADA_SESSAO });
        aguardandoSessao.push(tarefa);
      }
      // /sair settled — every session (including ours) is now closed, so a
      // resend would fail by definition. No auto-retry: the notes stay in the
      // durable queue and go out on the next load, after logging in. The BAR
      // carries that news and the way to act on it; the notes themselves are
      // simply still queued, which is the truth and is not an error.
      concluida.then(() => {
        aguardandoSessao.splice(0);
        // AND IT IS LATCHED, because this is a dead session like any other —
        // one we closed ourselves. Left unlatched, the next scan spent a
        // request finding out, buzzed, and repainted this bar with "Sua sessão
        // expirou", replacing the sentence that says why. Latched, the pool
        // stops and anything entered from here on goes amber without a request.
        // Replaces an ENCERRANDO_SESSAO latch too: nothing is being closed any
        // more, it is closed. The bar is painted right after, so the sentence
        // pararPorSessao paints for an expiry never reaches the screen.
        const encerrada = { codigo: 'SESSAO' };
        if (!pararPorSessao(encerrada)) sessaoMorta = encerrada;
        // Not MSG_SESSAO: nothing EXPIRED. /sair closed every session, this
        // one included, and saying so is what makes "Entrar novamente" the
        // obvious next step rather than a surprise.
        ui.setSessao({
          mensagem: 'As sessões foram encerradas, inclusive esta. As notas continuam guardadas.',
          rotulo: NFPR.Donation.LINK_LOGIN.rotulo,
          href: NFPR.Donation.LINK_LOGIN.href
        });
      });
    });

    // ---- Connectivity watchdog ------------------------------------------------
    // Kicks in when a send fails because the internet or the server went down.
    // It probes until the site answers again, then resends everything waiting.
    const conexao = NFPR.Connectivity.iniciar({
      urlSonda: NFPR.Site.URL_DOACAO,
      aoCair(motivo) {
        ui.setConexao(motivo === 'REDE' ? 'rede' : 'servidor');
      },
      aoVoltar() {
        ui.setConexao('online');
        for (const tarefa of aguardandoConexao.splice(0)) reenfileirar(tarefa);
      }
    });

    // ---- The send pool ---------------------------------------------------------
    // HOW MANY DONATIONS MAY BE IN FLIGHT AT ONCE. This is the only place the
    // number lives; edit it here to test other values. `1` restores the strictly
    // sequential behaviour this file had before the pool existed, byte for byte,
    // and remains the right lever if the site ever rate-limits or a volunteer's
    // connection cannot carry six.
    //
    // It is NOT the answer to a question about the form token. The token is one
    // slot per REQUEST, not per session: `doar` fetches a FRESH token per
    // donation and a second GET does not invalidate one already held, so
    // concurrent sends are safe. That used to be recorded as unmeasured, which
    // is exactly why this comment now says so — the open question invited
    // dropping the width to 1 to protect a resource that was never shared.
    //
    // Why a cap of ours and not Chrome's six-connection pool: see despacho.js.
    // In short, our 20 s request timeout starts when we call fetch, so anything
    // Chrome queues behind its own limit would time out untried.
    const LARGURA_ENVIO = 6;

    const despacho = NFPR.Despacho.criar({
      largura: LARGURA_ENVIO,
      executar: (tarefa) => processar(tarefa)
    });

    // ---- The queue is a quantity ----------------------------------------------
    // How much is left to do, and how much of it is in the air. The panel draws
    // this; the item list below draws only what HAPPENED. Restored notes get no
    // row while they wait — there can be thousands, and a row per note is what
    // made a fresh scan invisible behind them.
    //
    // `restantes` counts everything not yet settled, parked included: they are
    // all equally still-to-do, and the volunteer cannot act on the difference.
    let restantes = 0;

    // The BAR shows what is still waiting AND UNSEEN: `restantes` minus every
    // row currently showing "Enviando…". Not minus what is in the pool —
    // a scanned note has a blue row from the instant it is read, whether or not
    // a slot was free, and so does one sitting on a retry timer. Announcing
    // those on the bar as well shows the same work twice, which is how scanning
    // three notes produced "3 notas na fila" beside three rows visibly going.
    //
    // Internally `restantes` stays whole: it tracks the durable queue, which
    // none of those notes have left.
    function pintarFila() {
      ui.setFila({ restantes: Math.max(0, restantes - ui.contarEnviando()) });
    }

    /** A note entered the system (scanned, or restored from the durable queue). */
    function entrouNaFila(n) {
      restantes += n;
      pintarFila();
    }

    /** A note reached a final answer and is out of the queue for good. */
    function saiuDaFila() {
      restantes = Math.max(0, restantes - 1);
      pintarFila();
    }

    /**
     * A row, creating one if this note does not have it yet.
     *
     * Scanned notes arrive with a row already (registrador.js makes it the
     * instant the key is read — that immediate confirmation is not negotiable).
     * Restored notes arrive with none, and get one at the moment they have
     * something worth saying.
     */
    function linhaDe(tarefa) {
      if (tarefa.itemId == null) {
        tarefa.itemId = ui.adicionarItem(tarefa.chave, tarefa.cnpj, tarefa.marcas);
      }
      return tarefa.itemId;
    }

    /** A final answer: always worth a row, so make one if needed. */
    function relatar(tarefa, dados) {
      ui.atualizarItem(linhaDe(tarefa), dados);
    }

    /**
     * The server rejected this note and we cannot say why: record it durably.
     *
     * WRITTEN BEFORE THE ROW IS TOUCHED, and durably rather than in the panel,
     * because at this point the note is about to leave nfpr:fila for good and
     * this becomes its only trace. A row cannot be that trace — it is evicted
     * after LIMITE_LINHAS newer ones — and neither can a variable in the panel,
     * which any navigation destroys.
     *
     * Only for answers `classificarResposta` could NOT read. One it can read
     * has a policy behind it that either finished the matter or kept the note,
     * and its row already names the reason; listing those too would bury the
     * few nobody can account for.
     */
    async function anotarFalha(tarefa, mensagem) {
      try {
        ui.setFalhas(
          await Config.registrarFalha(tarefa.chave, mensagem, tarefa.em, tarefa.semValidacao)
        );
      } catch (e) {
        // A storage failure here costs the record, not the note — which is
        // already gone either way. Never let it break the send loop.
      }
    }

    /** That key registered after all, so it is no longer unregistered. */
    async function limparFalha(chave) {
      try {
        ui.setFalhas(await Config.resolverFalha(chave));
      } catch (e) {
        /* same */
      }
    }

    /**
     * A state that is not news on its own — retrying, or parked behind an outage
     * or a dead session. NEVER creates a row: on a big queue that is a thousand
     * rows saying "aguardando", which is exactly the list-shaped view of pending
     * work this design exists to stop. A note that already has one — a scan, or
     * anything that has reached the pool — still gets told.
     */
    function noticiar(tarefa, dados) {
      if (tarefa.itemId != null) ui.atualizarItem(tarefa.itemId, dados);
    }

    // The one way in. Once the session has died the pool is paused for good, so
    // anything queued after that would wait for a dispatch that never comes —
    // including a key scanned while the drain is stopped, and anything the
    // connectivity watchdog releases when the network returns during an outage
    // that outlived the session. Say so instead of leaving a silent row.
    function enfileirar(tarefa) {
      if (sessaoMorta) return marcarSessao(sessaoMorta, tarefa);
      // Same argument for the other paused-pool condition: a note queued into a
      // stopped pool would sit waiting for a dispatch that is not coming. Park
      // it instead, and the probe releases it with everything else.
      if (servidorConfuso) {
        marcarServidor(tarefa);
        return pintarBarraServidor(); // the count on the bar just changed
      }
      // A scanned note goes out ahead of the backlog. Someone is standing there
      // waiting for it to turn green; the backlog is unattended and has two
      // months of deadline left, so it loses nothing it can feel.
      despacho.enfileirar(tarefa, tarefa.origem === 'scan');
    }

    /** Back to the end of the queue, starting its attempt count over. */
    function reenfileirar(tarefa) {
      enfileirar(Object.assign({}, tarefa, { tentativa: 0 }));
    }

    // ---- Shared bootstrap ------------------------------------------------------
    // `deveIgnorarEvento` used to be passed from here — the rule that a
    // keystroke aimed at a real form field (the government site's own inputs,
    // e.g. inside its entity-search modal) belongs to the page and never to us.
    // It was never site-specific: it tests tag names, so it is
    // registrador.js's default and neither caller can forget it. (It does not
    // cover the strip's own fields, which a closed root hides from it; see
    // eventoDeCampoExterno.)
    const reg = await NFPR.Registrador.iniciar({
      ui,
      // Not "já foi registrada": a key is blocked from the moment it is read,
      // so a rescan while the first copy is still in flight would be told it
      // registered before the server had said anything.
      msgDuplicada: 'Esta nota já foi lida recentemente.',
      aoAceitarChave({ chave, cnpj, itemId, gravacao, semValidacao }) {
        // Start sending immediately; the queue write only decides whether the
        // note survives a reload. If it fails, say so rather than leaving an
        // unhandled rejection in a console nobody opens while the UI claims
        // the note is safely queued.
        gravacao.catch(() => {
          ui.mostrarErro(
            'Não foi possível guardar esta nota neste computador. Ela está sendo enviada assim mesmo, ' +
              'mas será perdida se a página for recarregada antes do fim do envio.'
          );
        });
        entrouNaFila(1);
        // `em` is the moment of INPUT, which for a scan is now. It travels with
        // the task so a rejection can report when the note was read rather than
        // when it happened to be sent.
        // `semValidacao` travels even on this path: processar re-judges every
        // task, freshly scanned ones included, so without it a bypassed note
        // would be destroyed by the gate one step short of the send it was
        // switched on to make.
        enfileirar({
          chave,
          cnpj,
          itemId,
          tentativa: 0,
          origem: 'scan',
          em: Date.now(),
          semValidacao: semValidacao || null
        });
      }
    });

    // ---- Processing pipeline --------------------------------------------------
    // ANYTHING THE SITE ANSWERS THAT IS NOT A RECOGNISED OUTCOME IS RETRIED.
    // donation.js sets `recuperavel` on everything except the six replies it
    // can actually read (success, past the deadline, a document type that is
    // neither an NF-e nor an NFC-e, a key the site itself rejects, entity not registered to
    // receive); an unfamiliar sentence or an incomprehensible body is not a
    // verdict on the note, and a good note must not be discarded because of it.
    //
    // The retries are COUNTED, because the same answer can equally mean the key
    // really is wrong: without a limit a mistyped key would retry for ever.
    // The counter is per attempt-chain and lives only in memory. A reload
    // restarts it, which is harmless: the note is in the durable queue, so the
    // next load simply starts its five attempts over.
    //
    // Resending an attempt that may have landed can donate the same note twice.
    // Accepted deliberately — losing a donation is the worse failure here.
    const MAX_TENTATIVAS = 5; // the first send plus four retries
    const ESPERA_TENTATIVA_MS = [1200, 4000, 10000, 20000]; // before retry 1..4

    /**
     * Wait, then put this note back at the END of the queue. Deliberately not a
     * sleep inside the worker: a slot held for ten seconds is a sixth of the
     * pool doing nothing, and with LARGURA_ENVIO of 1 it would stall the queue
     * outright. It stays blocked in the de-dup set and in the durable queue
     * throughout.
     */
    function tentarDeNovo(tarefa) {
      const proxima = Object.assign({}, tarefa, { tentativa: tarefa.tentativa + 1 });
      noticiar(tarefa, {
        estado: 'enviando',
        // "não confirmou", not "não registrou": on an unreadable answer the
        // note may in fact have gone through, and the row must not claim more
        // than we know.
        //
        // CARRIES THE COUNTER, because this message owns the row for almost the
        // whole ladder — the waits are 1.2s, 4s, 10s, 20s, so the "Enviando de
        // novo (N de 5)…" painted by processar is overwritten within a
        // microtask whenever the send itself is fast. Without the number here a
        // volunteer watching a 20-second wait cannot tell a note that is still
        // working from one that is stuck. It counts the attempt ABOUT to be
        // made: tentativa is a 0-based index, so +1 makes it 1-based and +1
        // again makes it the next one.
        mensagem:
          'O site não confirmou o registro. Nova tentativa (' +
          (tarefa.tentativa + 2) +
          ' de ' +
          MAX_TENTATIVAS +
          ') em instantes…'
      });
      const espera =
        ESPERA_TENTATIVA_MS[tarefa.tentativa] ||
        ESPERA_TENTATIVA_MS[ESPERA_TENTATIVA_MS.length - 1];
      // BACK IN THROUGH THE ONE WAY IN. Either latch can close while this timer
      // runs, and re-queueing into a paused pool leaves the row promising a
      // retry that will never be made. This used to check `sessaoMorta` here
      // and call the pool directly, which is a second copy of half the
      // wrapper's rule — and the half it left out was `servidorConfuso`.
      //
      // Reachable without anything exotic: an unrecognised sentence arms a
      // timer WITHOUT consulting the probe (only the two SEM_VEREDITO codes do
      // that), so a note beside it in the pool can shrug, come back confused
      // and pause everything while this timer is still running.
      //
      // The note was never at risk — it stays in nfpr:fila and goes out when
      // the probe releases the pool — but it became the one note on screen that
      // NOTHING accounted for: a blue row still promising a retry "em
      // instantes", subtracted from the queue indicator as work in flight by
      // contarEnviando, and absent from aguardandoServidor, which is what the
      // server bar counts. Now a latch added to the wrapper later covers this
      // caller too instead of quietly not covering it.
      //
      // It also puts a retried SCAN back in the urgent lane, which is the
      // wrapper's own rule and the right one: the volunteer is still standing
      // at that row, and the backlog it goes ahead of has two months of
      // deadline left. Writing `false` here to preserve the old behaviour would
      // be a second copy of the urgency policy in the very place a second copy
      // of the latch policy is being deleted.
      //
      // Held in `emEspera` meanwhile, so the refused-entity redirect can reach a
      // note that is on a timer rather than in any list (see redirecionarPara).
      emEspera.add(proxima);
      setTimeout(() => {
        emEspera.delete(proxima);
        enfileirar(proxima);
      }, espera);
    }

    // A final answer. Always worth a row — this is the note's whole record —
    // and it leaves the queue, so the indicator drops by one.
    // A settled verdict this extension can account for — every caller is either
    // our own REGRAS table or a server sentence classificarResposta matched — so
    // nothing here is ever written to nfpr:falhas. That record is for the notes
    // nobody could explain, and a row that already names its reason is not one.
    async function concluir(tarefa, estado, mensagem, link, fonte) {
      // `fonte` is provenance: 'nfprweb' when the sentence in `mensagem` came
      // from (or is about a failure decided by) the site, absent when it is our
      // own verdict. Two of the four call sites are each — the drain-time
      // re-judge speaks for us, the response table speaks for them — which is
      // precisely the distinction the muted prefix exists to show.
      relatar(tarefa, { estado, mensagem, link, fonte });
      saiuDaFila();
      await tirarDaFila(tarefa.chave);
    }

    /**
     * Out of nfpr:fila for good — the LAST step of settling a note, after its
     * row and its count, so it must not be able to undo them.
     *
     * A storage write can reject (the extension context invalidated by an
     * update is the realistic case), and the terminal path used to await it
     * inside processar's `try`: the rejection landed in the catch-all, which
     * settled the same note a second time — a second saiuDaFila (the count one
     * low), a second buzz, and its nfpr:falhas entry rewritten with the storage
     * error in place of the site's sentence. The note is already settled on
     * screen; a failed removal only means it is still in nfpr:fila, so it goes
     * out again on the next load, which is the duplicate-donation trade DOCS.md
     * already accepts for removerDaFila's coalescing window.
     */
    async function tirarDaFila(chave) {
      try {
        await Config.removerDaFila(chave);
      } catch (e) {
        /* still queued; sent again on the next load */
      }
    }

    // Park an item until the connection/server comes back. It stays blocked in
    // the de-dup set (a rescan would only duplicate the auto-retry) and stays
    // in the durable queue in case the page is reloaded mid-outage.
    function aguardarConexao(tarefa) {
      noticiar(tarefa, {
        estado: 'aguardando',
        mensagem: 'Guardada — será enviada automaticamente quando a conexão voltar.'
      });
      aguardandoConexao.push(tarefa);
      pintarFila(); // it left the pool but not the queue
    }

    // ---- A dead session is ONE condition, not a thousand verdicts ------------
    // Every session failure refuses every note identically, so discovering it
    // per note costs a round trip and an error buzz per note — a thousand of
    // each on the queue this pool exists for. The first one latches: the pool
    // stops dispatching, everything still waiting is marked with the same
    // verdict without being sent, and exactly one sound plays. That is the
    // shape the outage watchdog has always had (informarQueda reports whether
    // the caller is the one who flipped the state), applied to the other global
    // failure.
    //
    // No auto-resume, deliberately: logging in means navigating, which reloads
    // the page and restarts the drain from the durable queue. Notes stay queued
    // for all three codes, so nothing is lost by stopping here.

    /**
     * What a session failure does to ONE note: nothing, really. It is still
     * queued, it will still be sent, and it is not the note's fault — so it goes
     * amber and says so, exactly like a note scanned while the internet is down.
     * It never turns red, and it never creates a row it did not already have.
     *
     * Red is reserved for "this note is wrong, read the paper again". Painting a
     * session problem red on a thousand perfectly good notes said the opposite
     * of what was true, and buried the one thing the volunteer could act on.
     * That lives on the bar instead — see pararPorSessao.
     */
    function marcarSessao(e, tarefa) {
      noticiar(tarefa, { estado: 'aguardando', mensagem: MSG_GUARDADA_SESSAO });
      if (e.codigo === 'ENCERRANDO_SESSAO') aguardandoSessao.push(tarefa);
      if (e.codigo === 'SESSAO_DUPLICADA') duplicadas.push(tarefa);
      pintarFila();
    }

    /** The condition itself, and the one click that fixes it. */
    function pintarBarraSessao(e) {
      if (e.codigo === 'ENCERRANDO_SESSAO') {
        // Same bar, same wait, same reserved label — see the subscription above.
        return ui.setSessao({
          mensagem: 'Encerrando as sessões abertas…',
          rotulo: NFPR.Donation.LINK_LOGIN.rotulo,
          pendente: true
        });
      }
      if (e.codigo === 'SESSAO_DUPLICADA') {
        return ui.setSessao({
          mensagem: NFPR.Donation.MSG_SESSAO_DUPLICADA + ' As notas continuam guardadas.',
          rotulo: NFPR.Donation.LINK_SAIR.rotulo,
          // A request, not a page: navigating away would throw away its answer,
          // and opening a second tab is how you get a second session.
          aoClicar: () => NFPR.Sessao.encerrar()
        });
      }
      ui.setSessao({
        mensagem: NFPR.Donation.MSG_SESSAO + ' As notas continuam guardadas.',
        rotulo: NFPR.Donation.LINK_LOGIN.rotulo,
        href: NFPR.Donation.LINK_LOGIN.href
      });
    }

    /** Returns true if this call is the one that stopped the queue. */
    function pararPorSessao(e) {
      if (sessaoMorta) return false;
      sessaoMorta = e;
      despacho.pausar();
      // Everything still waiting gets the verdict now, without being sent, and
      // lands in the same bookkeeping list the in-flight ones do — so
      // sessao.aoEncerrar still moves ALL of them, not just the six that
      // happened to be in the air.
      for (const parada of despacho.esvaziar()) marcarSessao(e, parada);
      // A DEAD SESSION OUTRANKS A CONFUSED SERVER. Both pause the same pool,
      // but only the server's latch lifts by itself — and it cannot lift into
      // a session that is gone, since nothing would be sent. Its bar promising
      // an automatic resumption would then be false beside a session bar
      // saying what actually fixes things, and its probe would go on asking
      // for nothing. So its notes move behind this latch and it stands down.
      // Reached from the probe itself (avaliarSaude), which is the one thing
      // still talking to the site while the server latch holds.
      if (servidorConfuso) {
        servidorConfuso = false;
        clearTimeout(timerSonda);
        for (const parada of aguardandoServidor.splice(0)) marcarSessao(e, parada);
        pintarBarraServidor();
      }
      pintarBarraSessao(e);
      return true;
    }

    /** A session failure, however it was found: latch, and sound once. */
    function descobrirSessaoMorta(e) {
      // No alarm for our own /sair still running: nothing is wrong, it is
      // being fixed, and the bar already says so.
      if (pararPorSessao(e) && e.codigo !== 'ENCERRANDO_SESSAO') Audio.erro();
    }

    // ---- The same dead session, discovered by another door --------------------
    // Sessao.conferir() proves the login is gone when the volunteer opens the
    // site's entity dialog (see NFPR.BuscaSite). That is the SAME condition a
    // note comes back with, so it gets the same treatment and not a private
    // one: the pool stops, everything waiting goes amber, the bar carries the
    // sentence and the one link that fixes it, and the alarm sounds once.
    //
    // Without this the volunteer got a toast about the entity search while the
    // queue behind them kept walking into a wall — and the bar is where the
    // "Entrar novamente" button lives, which is the only thing on screen that
    // ends this. The toast still speaks, because it answers a different
    // question: why the dialog did not open. One narrator each.
    //
    // pararPorSessao is idempotent, so a second proof is free.
    NFPR.Sessao.aoDescobrirMorta(function () {
      descobrirSessaoMorta({ codigo: 'SESSAO' });
    });

    // ---- A refused entity is ONE condition too --------------------------------
    // `cnpjEntidade` says the configured entity cannot receive donations. That
    // is true of EVERY note aimed at it, so discovering it per note is the same
    // waste a dead session was — except this one also used to be terminal, so
    // each discovery DELETED its note from nfpr:fila. A batch scanned offline
    // against an unverified CNPJ was erased on first contact with the server.
    //
    // Latched per CNPJ rather than by pausing the pool, because unlike a dead
    // session this says nothing about notes aimed somewhere else: those keep
    // flowing. Checked at the top of processar, so a stranded note costs no
    // request at all.

    /**
     * What it does to ONE note: nothing. It stays in nfpr:fila, it keeps its
     * row if it had one, and it goes amber — the note is fine, the address is
     * not. Never red: red means "read the paper again", and re-reading it would
     * produce the same perfectly good key.
     */
    function marcarEntidade(tarefa) {
      noticiar(tarefa, {
        estado: 'aguardando',
        mensagem: 'Guardada — a entidade desta nota não pode receber doações.'
      });
      aguardandoEntidade.push(tarefa);
      pintarFila(); // it left the pool but not the queue
    }

    /** Returns true if this call is the one that discovered this target. */
    function pararPorEntidade(cnpj, mensagem) {
      if (entidadesRecusadas.has(cnpj)) return false;
      entidadesRecusadas.set(cnpj, mensagem);
      return true;
    }

    /**
     * The condition and the one click that fixes it, repainted from the state.
     *
     * TWO STATES, because the refused CNPJ is normally also the ACTIVE one — it
     * is what was used to scan. While that is true there is nowhere to move the
     * notes to, so the button can only open settings. Offering "send them to X"
     * when X is the entity that just failed would be a button that does nothing,
     * which is the defect the duplicate-session screen is already filed under.
     */
    let pinturaEntidade = 0; // generation: only the latest paint's storage read may land
    function pintarBarraEntidade(ativaAgora) {
      const vez = ++pinturaEntidade;
      if (!entidadesRecusadas.size) return ui.setEntidadeRecusada(null);
      const nomes = [...entidadesRecusadas.keys()].map((c) => NFPR.Cnpj.formatar(c)).join(', ');
      const paradas = aguardandoEntidade.length;
      // ZERO IS REACHABLE AND IT IS NOT TRANSIENT. conferirEntidadeNaoVerificada
      // latches this straight off the registry, before the drain has parked
      // anything — and with an empty queue there is nothing to park, so the bar
      // would read "0 notas estão guardadas para ele" until the config
      // changed. The refusal is a fact about the CNPJ, not about any note, so
      // the count sentence is simply dropped rather than reworded: it is the
      // only half that is about notes.
      //
      // The BUTTON can stay with nothing parked, and that is deliberate.
      // Config.redirecionarFila rewrites nfpr:fila, which can hold notes aimed
      // at this CNPJ that have not been refused yet, so "move them" is real
      // work even while nothing has parked. Only when the queue holds none
      // either does the bar go — see the end of this function.
      const varios = entidadesRecusadas.size > 1;
      const destino = varios ? 'para eles' : 'para ele';
      const quantas =
        paradas === 0
          ? ''
          : paradas === 1
            ? ' 1 nota está guardada ' + destino + '.'
            : ' ' + paradas + ' notas estão guardadas ' + destino + '.';
      const base =
        'O Nota Paraná não aceita doações para ' + (varios ? 'os CNPJs ' : 'o CNPJ ') +
        nomes + '.' + quantas;
      // `ativaAgora` is passed by the config subscription below, which has read
      // the new config itself. Registrador owns reg.entidadeAtual() and updates
      // it from an ASYNC listener on the same event — it yields at its first
      // await, so a synchronous repaint fired from the same notification sees
      // the entity that was active BEFORE the change. That is why the button
      // used to correct itself only on reload.
      const ativa = ativaAgora !== undefined ? ativaAgora : reg.entidadeAtual();
      const podeMover = ativa && ativa.cnpj && !entidadesRecusadas.has(ativa.cnpj);
      if (!podeMover) {
        return ui.setEntidadeRecusada({
          mensagem: base + ' Escolha outra entidade nas configurações.',
          rotulo: 'Abrir configurações',
          aoClicar: () => ui.abrir('config')
        });
      }
      const oferecer = () => ui.setEntidadeRecusada({
        mensagem: base,
        rotulo: 'Enviar para ' + (ativa.nome || NFPR.Cnpj.formatar(ativa.cnpj)),
        aoClicar: () => redirecionarPara(ativa)
      });
      if (paradas > 0) return oferecer();

      // WITH A WORKING ENTITY ACTIVE, THE BAR'S ONLY JOB IS THE MOVE — so with
      // nothing to move, it goes. Nothing parked is not the same as nothing
      // aimed there: nfpr:fila can hold notes for a refused CNPJ that the pool
      // has not reached yet (see the note on the button above), so the durable
      // queue is asked. Before this, switching to a good entity with an empty
      // queue left the refusal on screen with a button to move zero notes,
      // which read as the NEW entity being refused.
      //
      // The latch itself stays: a note aimed at that CNPJ that turns up later
      // still parks, repaints, and brings the bar back with its count — and so
      // does switching back to the refused entity.
      Config.obterFila().then(
        (fila) => {
          if (vez !== pinturaEntidade) return;
          if (fila.some((e) => e.cnpj && entidadesRecusadas.has(e.cnpj))) oferecer();
          else ui.setEntidadeRecusada(null);
        },
        () => {
          if (vez === pinturaEntidade) oferecer(); // could not look: keep the way out
        }
      );
    }

    /**
     * Move the stranded notes to the active entity. The ONE place the frozen
     * target is ever rewritten, and only ever from here: an explicit click, on
     * notes the server has already refused outright.
     *
     * IT HAS TO REACH THE POOL, NOT JUST THE BAR. Notes park one at a time, as
     * the pool feeds each to processar and it hits the refused-target check —
     * so on a restored batch the click usually lands while most of them are
     * still WAITING, never parked, holding the refused CNPJ in memory. Clearing
     * the latch below re-opens that check for exactly those, and they went
     * straight back out to the CNPJ the volunteer had just moved them off: a
     * handful of doomed requests, and the bar reappearing seconds after it was
     * fixed. `esvaziar` takes everything still waiting and never touches work
     * in flight, so the two sources settle into one loop.
     *
     * Only notes whose frozen target is a refused CNPJ move, and that is the
     * safety property rather than a detail — the same rule Config
     * .redirecionarFila applies to storage. A pool task aimed at a working
     * entity, or carrying a null target (resolved to the active entity at send
     * time), is re-enqueued untouched: filing a good note under the wrong
     * entity is the same size of harm as losing it, and it is the harm nobody
     * would ever notice.
     *
     * Order survives. Parked notes are by definition older than still-pending
     * ones, so they lead; and going back through `enfileirar` rebuilds the
     * urgent lane from `origem` — and parks everything, correctly, if a latch
     * closed while this was running.
     *
     * THE FIRST TWO LINES MUST STAY IN ONE SYNCHRONOUS STEP, and that is the
     * whole reason they are written before the await rather than beside the
     * loop they feed. Clearing the latch re-opens processar's refused-target
     * check, and the pool goes on dispatching across every await below — so
     * emptying it afterwards would leave a window with the gate open and the
     * old targets still in the queue, which is the bug this function had.
     *
     * What cannot be recovered is work already IN FLIGHT: those requests are
     * spent, they come back refused, and they re-latch. Their notes park with
     * the old target and a second click moves them. Bounded by LARGURA_ENVIO,
     * and the alternative is cancelling a request whose answer is still worth
     * reading.
     */
    async function redirecionarPara(ativa) {
      const alvos = [...entidadesRecusadas.keys()];
      const parados = aguardandoEntidade.splice(0).concat(despacho.esvaziar());
      entidadesRecusadas.clear();
      // AND EVERYTHING HELD SOMEWHERE ELSE, in the same synchronous step and
      // for the same reason. A note parked behind an outage, behind a confused
      // server, or sitting on a retry timer holds its target in memory just as
      // a pool task does, and each is released later by something that is not
      // this function — the watchdog, the probe, the timer. They used to keep
      // the refused CNPJ while nfpr:fila was rewritten under them, went out to
      // it once released, were refused again and brought the bar back after
      // the volunteer had fixed it. Unlike the in-flight residue, nothing
      // bounded how many.
      //
      // Rewritten IN PLACE and left where they are: the move is this
      // function's business, the release is still the other condition's. Same
      // exact-match rule as the pool below. The session lists are left alone —
      // nothing leaves them on this load, and the next one reads nfpr:fila.
      for (const t of aguardandoConexao.concat(aguardandoServidor, [...emEspera])) {
        if (t.cnpj && alvos.indexOf(t.cnpj) !== -1) {
          t.cnpj = ativa.cnpj;
          t.tentativa = 0;
        }
      }
      for (const de of alvos) await Config.redirecionarFila(de, ativa.cnpj);
      for (const parada of parados) {
        const mover = parada.cnpj && alvos.indexOf(parada.cnpj) !== -1;
        enfileirar(
          mover ? Object.assign({}, parada, { cnpj: ativa.cnpj, tentativa: 0 }) : parada
        );
      }
      pintarBarraEntidade();
      pintarFila();
    }

    // ---- A confused server is ONE condition too --------------------------------
    // The shrug — HTTP 500 with the site's catch-all sentence, or any answer we
    // could not read — says nothing about the note AND nothing about the
    // server. Both readings are live at once, and they want opposite treatment:
    //
    //   the note is impossible   -> deleting it is right. That deletion is the
    //                               ZOMBIE REAPER, and it is load-bearing:
    //                               without it a note that can never succeed is
    //                               retried on every reload for ever, and our
    //                               local checks are known to be incomplete.
    //   the server is having an  -> deleting is a catastrophe. A bad hour costs
    //   hour                        a 1000-note queue five attempts each and
    //                               every one of them is erased, with nothing
    //                               wrong with any of them.
    //
    // Guessing between them from the sentence is impossible — it is byte
    // identical for three unrelated causes. So we do not guess: sondarSaude()
    // asks the server a question whose answer we already know (see donation.js)
    // and the answer decides. Probed on the FIRST shrug, not at the end of the
    // budget, so a real outage stops the queue before a thousand notes burn
    // five doomed attempts apiece.
    //
    // Latched exactly like a dead session, and for the same reason: the
    // condition is global, so rediscovering it per note is a round trip and an
    // error buzz per note. Unlike the session it DOES auto-resume — the probe
    // is both the diagnosis and the recovery signal, which is the whole reason
    // stopping is affordable here. Nothing is ever deleted while it is latched.
    // THE ANSWERS THAT SAY NOTHING ABOUT THE NOTE, and therefore the ones a
    // probe has to arbitrate. Both are refusals the engine made without ever
    // judging our 44 digits: the shrug gave up outside the validators, and
    // `Procedimento inválido` was thrown out above them. Neither is evidence
    // for or against the note, so neither may decide its fate on its own.
    //
    // These two are ONE SET on purpose. They were briefly treated differently —
    // one probed, the other had a hand-written branch — and the seam between
    // them was immediately a bug: a note parked in a waiting room that only
    // empties when a latch is released, by a path that never set the latch, so
    // it waited for ever while the queue indicator counted it.
    const SEM_VEREDITO = new Set(['SEM_DIAGNOSTICO', 'PROCEDIMENTO_INVALIDO']);

    const SONDA_VALIDA_MS = 30000; // how long one answer speaks for the whole queue
    const SONDA_INTERVALO_INICIAL = 4000;
    const SONDA_INTERVALO_MAXIMO = 30000;
    const SONDA_FATOR = 1.6;

    let sondaEmVoo = null;
    let sondaResultado = null;
    let sondaAte = 0;
    let timerSonda = null;
    let intervaloSonda = SONDA_INTERVALO_INICIAL;

    /**
     * Is the server able to judge a donation? Cached and single-flight: a
     * shrug arriving on six notes at once must cost ONE probe, not six, and a
     * burst of them must not cost one per note. The cache is what makes
     * probing on the first failure affordable.
     */
    //
    // -> 'saudavel' | 'confuso' | 'sessao'. The third is the probe's own token
    // fetch finding the login dead (sondarSaude rejects with it). It is latched
    // HERE, once, where every note waiting on this probe shares the one answer
    // — and by the time any of them reads 'sessao', sessaoMorta is set.
    function avaliarSaude() {
      if (sondaResultado && Date.now() < sondaAte) return Promise.resolve(sondaResultado);
      if (sondaEmVoo) return sondaEmVoo;
      sondaEmVoo = NFPR.Donation.sondarSaude().then(
        function (r) {
          sondaResultado = r;
          sondaAte = Date.now() + SONDA_VALIDA_MS;
          sondaEmVoo = null;
          return r;
        },
        function (e) {
          sondaEmVoo = null;
          descobrirSessaoMorta(e);
          return 'sessao';
        }
      );
      return sondaEmVoo;
    }

    /**
     * What it does to ONE note: nothing at all. It stays in nfpr:fila, keeps
     * its row, and goes amber. Never red — the note is fine, the server is not,
     * and red means "read the paper again".
     */
    function marcarServidor(tarefa) {
      noticiar(tarefa, { estado: 'aguardando', mensagem: MSG_GUARDADA_SERVIDOR });
      aguardandoServidor.push(tarefa);
      pintarFila(); // it left the pool but not the queue
    }

    /** The condition itself. No button: the probe resumes this on its own. */
    function pintarBarraServidor() {
      if (!servidorConfuso) return ui.setServidorConfuso(null);
      const paradas = aguardandoServidor.length;
      const quantas =
        paradas === 1 ? '1 nota está guardada' : paradas + ' notas estão guardadas';
      ui.setServidorConfuso({
        mensagem:
          'O site do Nota Paraná não está conseguindo registrar doações no momento. ' +
          quantas +
          '. O envio será retomado automaticamente quando o site se normalizar.'
      });
    }

    /** Returns true if this call is the one that stopped the queue. */
    function pararPorServidor() {
      if (servidorConfuso) return false;
      servidorConfuso = true;
      despacho.pausar();
      for (const parada of despacho.esvaziar()) marcarServidor(parada);
      pintarBarraServidor();
      agendarSonda();
      return true;
    }

    /**
     * Keep asking, on the connectivity watchdog's backoff. The cached answer is
     * cleared first — it is the one that parked us, and re-reading it would
     * make this loop agree with itself for ever.
     */
    function agendarSonda() {
      clearTimeout(timerSonda);
      timerSonda = setTimeout(async function () {
        if (!servidorConfuso) return;
        sondaResultado = null;
        sondaAte = 0;
        const saude = await avaliarSaude();
        if (!servidorConfuso) return; // resumed by a success while we asked
        if (saude === 'saudavel') return retomarServidor();
        agendarSonda();
      }, intervaloSonda);
      intervaloSonda = Math.min(Math.round(intervaloSonda * SONDA_FATOR), SONDA_INTERVALO_MAXIMO);
    }

    /** Proven able to judge again: let everything go. */
    function retomarServidor() {
      if (!servidorConfuso) return;
      servidorConfuso = false;
      clearTimeout(timerSonda);
      intervaloSonda = SONDA_INTERVALO_INICIAL;
      sondaResultado = null;
      sondaAte = 0;
      // Both latches pause the same pool, and the session's has no auto-resume
      // on purpose. A note in flight when this latch closed can still come back
      // SESSAO, so the server recovering must not un-pause a pool the session
      // is holding shut. Harmless today — enfileirar and processar both check
      // sessaoMorta first, so nothing would be sent either way — but that makes
      // "a dead session stops the pool" true by luck rather than by rule.
      if (!sessaoMorta) despacho.retomar();
      for (const parada of aguardandoServidor.splice(0)) reenfileirar(parada);
      pintarBarraServidor();
      pintarFila();
    }

    async function processar(tarefa) {
      const { chave, cnpj, itemId, tentativa } = tarefa;
      // A latch that closed while this task sat in the queue.
      if (sessaoMorta) return marcarSessao(sessaoMorta, tarefa);
      // Judge the note before spending anything on it — a request, an entity,
      // or a place in the queue. Freshly accepted keys already passed this
      // check in aceitar(); the second call is redundant, cheap, and not worth
      // branching around. What it is for is the DURABLE QUEUE: those keys never
      // went through aceitar() on this load.
      //
      // WITHOUT THE CLOCK. `avaliar(chave, null)` skips every `relogio: true`
      // entry — FUTURA and EXPIRADA — because the only clock here is the
      // volunteer's machine, and a restored note is exactly what a wrong one
      // destroys. A donated PC whose CMOS battery resets the date, or a clock
      // set by hand: every queued note came back FUTURA, red, and was removed
      // from nfpr:fila with nothing in nfpr:falhas; a clock set forwards did
      // the same through EXPIRADA. The deadline is the SERVER's to judge, on the
      // server's clock, which is the right one — a note that really did expire
      // comes back grey from it and is dropped with nothing owed. The cost is
      // one request per note that went stale in the queue, and it used to be
      // spent to save exactly that request. The scan-time verdict in aceitar()
      // keeps its clock: a person is standing there, and the paper in their
      // hand is what they check it against.
      //
      // Either way the key is already in `registradas` by the time this runs —
      // from aceitar() or from the restore loop at the bottom of this file —
      // so bloquearChave here updates a value rather than inserting a key.
      //
      // Silent, both branches: nobody is standing at the scanner during a
      // drain, so a sound would be unattributable.
      // Through the same debug hook aceitar() uses, and for the same reason
      // stated there: without it a key that debug mode deliberately let into
      // the queue would be refused HERE instead, one step short of the send —
      // which is the whole thing a bypass exists to exercise. Identity while
      // the mode is disarmed.
      //
      // SKIPPED WHOLE for a note the volunteer's "enviar sem validar"
      // preference carried past a verdict, and this is the half of that feature
      // that decides whether it works at all. The flag is frozen ON THE NOTE
      // (nfpr:fila, set in aceitar) rather than read live from the preference:
      // read live, a toggle switched off after a batch was scanned would meet
      // that batch here on the next load and destroy every note in it —
      // silently, because the row is indistinguishable from an ordinary
      // refusal. Frozen, the note is judged by the rule that was in force when
      // the volunteer chose to submit it, exactly like its target CNPJ.
      //
      // A skip and not a downgrade: this gate exists to avoid burning a request
      // on a note whose own digits already condemn it, and the whole point of
      // the preference is that the volunteer wants that request made anyway.
      // The de-dup side effects go with it — bloquearChave and esquecerChave
      // below both belong to a refusal that is no longer happening.
      if (!tarefa.semValidacao) {
        const bruto = NFPR.Chave.avaliar(chave, null);
        const av = NFPR.Debug.ajustarVeredito(bruto);
        if (av.gravidade === 'inelegivel') {
          // Stays blocked: rescanning it would only produce the same verdict.
          reg.bloquearChave(chave, av.mensagem);
          return concluir(tarefa, 'inelegivel', av.mensagem);
        }
        if (av.gravidade === 'entrada') {
          // Defensive only. A red key reaches the queue by exactly one route —
          // the bypass above, which returns before this — and with no clock in
          // this judgement nothing here depends on when it runs. (It used to
          // say no verdict turns red with the passage of time, which assumed
          // time only moves forward: a clock set backwards made every restored
          // note FUTURA, and this branch deleted them.)
          reg.esquecerChave(chave);
          return concluir(tarefa, 'erro', av.mensagem);
        }
      }

      // The item's own frozen target wins; legacy queue entries (null) fall
      // back to whatever entity is active now.
      const ativa = reg.entidadeAtual();
      const cnpjAlvo = cnpj || (ativa && ativa.cnpj) || null;
      if (!cnpjAlvo) {
        reg.esquecerChave(chave); // allow a rescan once configured
        // Our own message, and the note KEEPS its place in nfpr:fila — nothing
        // was rejected and nothing was lost, so this is not a failure to record.
        // Amber, not red: the digits are fine and the note is still queued —
        // what is missing is an address, which is a condition, not a verdict.
        relatar(tarefa, {
          estado: 'aguardando',
          mensagem: 'Guardada — nenhuma entidade foi selecionada para receber as doações.'
        });
        saiuDaFila();
        return; // stays in the durable queue for the next load
      }

      // Known-refused target: park immediately. Checked HERE, after cnpjAlvo is
      // resolved and before anything is spent, so the second note onwards costs
      // no round trip — the whole point of latching it.
      if (entidadesRecusadas.has(cnpjAlvo)) {
        marcarEntidade(tarefa);
        pintarBarraEntidade(); // the count on the bar just changed
        return;
      }

      // Known outage: park immediately instead of hammering a dead connection.
      if (conexao.estaForaDoAr()) {
        aguardarConexao(tarefa);
        return;
      }

      // IN FLIGHT EARNS A ROW. Waiting does not — that is the queue indicator's
      // job, and a row per waiting note is what buried a fresh scan behind a
      // thousand of them. But once a note is actually being sent it is a thing
      // happening now, and the list is where things that happen go: the rows
      // appear LARGURA_ENVIO at a time and turn green in place, so the pool is
      // visibly working instead of silently churning behind a bar.
      relatar(tarefa, {
        estado: 'enviando',
        mensagem:
          tentativa > 0
            ? 'Reenviando (' + (tentativa + 1) + ' de ' + MAX_TENTATIVAS + ')…'
            : 'Enviando…'
      });
      pintarFila(); // only now is the row blue, and the bar subtracts blue rows
      try {
        const res = await NFPR.Donation.doar(chave, cnpjAlvo);

        // A SIMULATED SUCCESS PROVES NOTHING AND MAY DESTROY NOTHING. Debug
        // mode's simularEnvio answers "sucesso" without a request, and routed
        // down the real success path below it removed the note from nfpr:fila
        // and cleared its failure record — so a restored batch drained on an
        // armed page was deleted, every note labelled "Simulação", none of them
        // ever sent. Arming either bypass arms this flag by itself, so one test
        // key could cost a whole offline batch.
        //
        // A RESTORED note therefore stays in nfpr:fila, untouched, and goes out
        // for real on the first load without the flag. A SCANNED one is
        // concluded as before: the scan put it in the queue a moment ago, so
        // taking it out puts the queue back as it was — and a fabricated test
        // key left there would be POSTed for real once debug mode is off, which
        // is exactly what simularEnvio exists to prevent. Neither retomar the
        // server latch nor clear a failure: nothing was proven.
        if (res.simulado) {
          if (tarefa.origem === 'scan') {
            Audio.sucesso();
            return concluir(tarefa, 'sucesso', res.mensagem);
          }
          relatar(tarefa, {
            estado: 'aguardando',
            mensagem: 'Simulação: nada foi enviado. A nota continua guardada na fila.'
          });
          saiuDaFila();
          return;
        }

        if (res.estado === 'sucesso') {
          // A success is proof the engine is judging donations right now —
          // exactly what the probe goes and asks for, arriving free. Only the
          // notes still in flight when the latch closed can get here, but that
          // is up to LARGURA_ENVIO of them, and taking the evidence is strictly
          // better than waiting out a backoff to learn the same thing.
          if (servidorConfuso) retomarServidor();
          if (tarefa.origem === 'scan') Audio.sucesso();
          limparFalha(chave); // it registered after all — not awaited, nothing waits on it
          return concluir(tarefa, 'sucesso', res.mensagem, null, res.fonte);
        }
        // An answer that diagnoses nothing. Ask which of the two things it
        // meant BEFORE spending any more of this note's budget on it — and,
        // more to the point, before the end of that budget deletes it.
        //
        // ASK, DO NOT ASSUME. Latching on the answer alone would stop the whole
        // queue for every freak token hiccup, and those clear on one retry. The
        // probe is what tells "this one note/token" apart from "the server is
        // refusing everything", and that is the only question it has to answer:
        // healthy means carry on and let the budget decide, confused means stop.
        if (SEM_VEREDITO.has(res.codigo)) {
          const saude = await avaliarSaude();
          // The probe found the login gone and latched it: this note waits for
          // the login like every other one, exactly as if it had come back
          // SESSAO itself (see the catch below).
          if (saude === 'sessao') {
            reg.esquecerChave(chave);
            return marcarSessao(sessaoMorta, tarefa);
          }
          if (saude === 'confuso') {
            if (pararPorServidor()) Audio.erro();
            marcarServidor(tarefa);
            pintarBarraServidor(); // the count on the bar just changed
            return;
          }
        }
        // Not a recognised outcome: try again, up to the budget. Once it runs
        // out this falls through to the handling below, which shows the site's
        // own words and drops the note from the queue — and for a red `erro`
        // forgets the key too, so rescanning it is a real retry. A grey
        // `inelegivel` stays blocked instead: the note is real and rescanning
        // it would only produce the same verdict, so "you already scanned this
        // one" is the more useful thing to say.
        if (res.recuperavel && tentativa + 1 < MAX_TENTATIVAS) {
          return tentarDeNovo(tarefa);
        }
        if (res.estado === 'inelegivel') {
          // Blocked WITH ITS REASON, like the local grey in processar and in
          // aceitar(): a rescan then says why the note was refused, not just
          // that it was read before.
          reg.bloquearChave(chave, res.mensagem);
          return concluir(tarefa, 'inelegivel', res.mensagem, null, res.fonte);
        }
        // The entity cannot receive. NOT a verdict on this note, so it keeps its
        // place in nfpr:fila and the key stays blocked — deliberately unlike the
        // session latch, which forgets keys because logging in reloads the page
        // and restarts the drain. Nothing reloads here, so forgetting the key
        // would let a rescan queue the same note twice while the first copy sits
        // parked waiting to be redirected.
        if (res.codigo === 'ENTIDADE_RECUSADA') {
          if (pararPorEntidade(cnpjAlvo, res.mensagem)) Audio.erro();
          marcarEntidade(tarefa);
          pintarBarraEntidade();
          return;
        }
        // The whole budget spent on an answer that never judged this note, and
        // a probe that says the server is otherwise fine. Contradictory and
        // very rare — but the one thing it must not do is DELETE, because
        // nothing here was ever evidence about the note.
        //
        // So it is held for the next page load instead: no request left to
        // spend, kept in nfpr:fila, key still blocked so a rescan cannot queue
        // a second copy. It leaves THIS load's queue, which is what saiuDaFila
        // records — the count has to stay honest, and the note genuinely is not
        // going anywhere until the page reloads.
        //
        // Deliberately NOT parked in aguardandoServidor: that list is emptied
        // by releasing the latch, and no latch was set here — which is exactly
        // how this branch used to strand a note for ever behind a counter that
        // never moved.
        // THE ONE PLACE THE TWO SEM_VEREDITO CODES PART COMPANY, and the
        // asymmetry is the whole reaper. Both reached here having spent the
        // budget with the probe still reporting a healthy server — but that
        // fact means opposite things about them:
        //
        //   SEM_DIAGNOSTICO      the server is fine and it still cannot file
        //                        THIS note. That is the impossible-note case —
        //                        a zeroed issuer, a 99th month, whatever our
        //                        local checks still miss — and it can never
        //                        succeed. It falls through to the terminal path
        //                        below and is DELETED. That deletion is the
        //                        zombie reaper; without it the note is retried
        //                        on every reload for ever.
        //   PROCEDIMENTO_INVALIDO the refusal happened ABOVE the note, so it
        //                        was never evidence about the note at all. No
        //                        number of retries makes it one. Kept.
        //
        // Folding these together is the tidy-looking mistake: it reads as one
        // rule, and it silently disables the reaper. Live testing caught it.
        if (res.codigo === 'PROCEDIMENTO_INVALIDO') {
          relatar(tarefa, {
            estado: 'aguardando',
            mensagem: 'Guardada — o site não aceitou o envio neste momento. Ela será reenviada quando a página for recarregada.'
          });
          saiuDaFila();
          return;
        }
        // Terminal rejection / unknown response: report it, drop it from the
        // durable queue, but FORGET it so the volunteer can rescan to retry.
        if (tarefa.origem === 'scan') Audio.erro();
        reg.esquecerChave(chave);
        // `reconhecida` comes from classificarResposta, the only place that
        // knows whether the sentence in `mensagem` was READ or merely relayed.
        // Recorded before the row, because the note is about to leave the queue.
        if (!res.reconhecida) await anotarFalha(tarefa, res.mensagem);
        relatar(tarefa, { estado: res.estado, mensagem: res.mensagem, fonte: res.fonte });
        saiuDaFila();
        await tirarDaFila(chave);
      } catch (e) {
        // Connectivity outage: alert once (not once per note), start probing
        // for recovery, and park the item for the automatic resend.
        if (e.codigo === 'REDE' || e.codigo === 'SERVIDOR') {
          if (conexao.informarQueda(e.codigo)) Audio.erro();
          aguardarConexao(tarefa);
          return;
        }

        // A session failure. Stop the whole queue on the first one rather than
        // rediscovering it note by note, and sound the alarm exactly once — the
        // sound is unconditional here, unlike the per-note ones above, because
        // this is a condition the volunteer has to act on whether they are
        // standing at the scanner or watching a drain.
        if (NFPR.Donation.CODIGOS_SESSAO.includes(e.codigo)) {
          reg.esquecerChave(chave); // a failed key may always be rescanned
          descobrirSessaoMorta(e);
          marcarSessao(e, tarefa);
          // Session failures stay in the durable queue and retry on the next
          // reload — including SESSAO_DUPLICADA, where the note is perfectly
          // good and only the extra session is in the way.
          return;
        }

        if (tarefa.origem === 'scan') Audio.erro();
        reg.esquecerChave(chave);
        // ALWAYS RECORDED. Everything this code knows how to read was handled
        // above — REDE, SERVIDOR and the three session codes — so anything
        // reaching here is a failure nobody classified, which is exactly what
        // the record is for.
        const msgFalha = e.message || 'Erro inesperado.';
        await anotarFalha(tarefa, msgFalha);
        relatar(tarefa, { estado: 'erro', mensagem: msgFalha, link: e.link });
        saiuDaFila();
        await tirarDaFila(chave);
      }
    }

    // ---- The way into debug mode, on a machine with no console handy ---------
    // Seven consecutive clicks on the government page's own span.fn.org, in the
    // style of Android's build-number tap. Live page only: the offline page has
    // no host page to click on, and the console is always the documented route.
    //
    // Arming buys the red banner and nothing else — every flag starts off — so
    // the gesture cannot change how a single note is judged on its own.
    //
    // Once the mode is on there is nothing left to count down to, so EVERY
    // toast the gesture raises says the same one thing — Android's behaviour
    // as well as its wording. Tapping is then inert: it opens nothing and
    // changes nothing, which is what keeps the flags form reachable only
    // through "Cuidado!" on the red banner.
    const MSG_JA_DEV = 'Não é necessário, você já é um desenvolvedor.';
    const jaEhDesenvolvedor = () => NFPR.Debug.estaAtivo();

    NFPR.DebugUI.observarGesto({
      seletor: 'span.fn.org',
      // Android's own wording, kept verbatim — including the plural: the
      // countdown reaches 1, and "faltam 1 etapas" is exactly the sort of
      // thing this gesture is quoting that gets right.
      aoContar(faltam) {
        if (jaEhDesenvolvedor()) return ui.mostrarToast(MSG_JA_DEV, 'ok');
        ui.mostrarToast(
          faltam === 1
            ? 'Agora falta 1 etapa para você se tornar um desenvolvedor.'
            : 'Agora faltam ' + faltam + ' etapas para você se tornar um desenvolvedor.',
          'ok'
        );
      },
      aoAtivar(jaEstava) {
        if (jaEstava) return ui.mostrarToast(MSG_JA_DEV, 'ok');
        Audio.aviso();
        ui.mostrarToast('Você agora é um desenvolvedor!', 'err');
      }
    });

    // ---- Re-process whatever was left pending from a previous load ------------
    // Each entry carries its own frozen target CNPJ, so donations queued for an
    // earlier entity are still sent to THAT entity, not the current config.
    //
    // ORDER. Enqueued front-to-back, so the oldest queued note is sent first —
    // the order the volunteer entered them, and the safest, since the oldest is
    // nearest its emission+2 deadline. Keys scanned WHILE this drains jump the
    // whole backlog (despacho.js's urgent lane): someone is standing there
    // waiting on those, and the backlog cannot feel the delay.
    //
    // ROWS GO IN THE SAME ORDER, front-to-back, which puts the oldest note at
    // the BOTTOM of the list and the newest on top — the panel's one ordering
    // rule, the one its empty-list hint states out loud ("as mais recentes no
    // topo") and the one live scanning follows. A drain must not invert it.
    //
    // This was briefly written backwards, to put the note about to be sent on
    // top, and it broke three things at once: the list read backwards against
    // every other surface; the row budget went to the notes queued LAST, which
    // are sent last, so the first notes to go out had no row and nothing
    // visibly happened; and `+ N notas guardadas` could never count down,
    // because a record only materialises a row when it STARTS SENDING and those
    // records had already finished. Sending oldest-first and rendering
    // newest-first are not in conflict — the work simply travels up the list.
    //
    // `origem: 'fila'` marks these as unattended: nobody is standing at the
    // scanner during a drain, so a per-note sound would be unattributable — the
    // same reasoning the verdict check above already applies. Only conditions
    // (an outage, a dead session) still sound, once each.
    // ---- Catch a bad target BEFORE spending the queue on it -------------------
    // An entity saved while offline was never checked against the registry —
    // `Entidade.salvar` records `verificada: false` and, until now, nothing ever
    // read it back. So the first thing that discovered a plausible-but-wrong
    // CNPJ was the server, one note at a time.
    //
    // Prevention can never be complete: this is a network call, so there is
    // always a window between checking and draining, and an entity can be
    // deregistered after being verified. The latch above is the invariant; this
    // only makes the common case quiet.
    //
    // NOT AWAITED, deliberately. Blocking the drain on a request means a machine
    // with a hanging connection registers nothing at all until it times out, and
    // the latch already covers every note this misses. Started before the drain
    // so that in practice a quick answer parks the queue before most of it moves.
    //
    // ONLY a definite NAO_ENCONTRADA acts. `INDISPONIVEL` and `SESSAO` mean we
    // could not ask — treating "no answer" as "not registered" would park a
    // perfectly good queue behind a bar the volunteer cannot clear.
    //
    // The same lookups are what NAME an unverified entity: the settings form
    // takes no typed name, so one saved without the registry is shown by its
    // CNPJ until an answer like this one fills the name in. Every unverified
    // entity is asked, not only the active one, so switching to another later
    // finds it named already.
    //
    // AND EVERY ANSWER IS LATCHED, not only the active one's — the requests
    // were already made, and throwing the other answers away left an
    // unregistered entity in the list to be discovered by its first refused
    // note. Latching an inactive CNPJ is safe: with a working entity active,
    // pintarBarraEntidade shows the bar only for notes aimed at a refused one,
    // so a latch nothing points at stays invisible until that entity is chosen
    // — and then the bar is already up before a single note goes out. Only the
    // ACTIVE one sounds: nobody is about to scan into the others.
    (async function conferirEntidadeNaoVerificada() {
      const ativa = reg.entidadeAtual();
      const resultados = await NFPR.Entidade.completarNomes();
      let alguma = false;
      for (const cnpj of Object.keys(resultados)) {
        const res = resultados[cnpj];
        if (!res || res.ok || res.motivo !== 'NAO_ENCONTRADA') continue;
        alguma = true;
        const nova = pararPorEntidade(cnpj, 'Entidade não cadastrada para receber doações.');
        if (nova && ativa && ativa.cnpj === cnpj) Audio.erro();
      }
      if (alguma) pintarBarraEntidade();
    })();

    // The refused-entity bar's button depends on which entity is ACTIVE, and
    // that changes while the bar is showing — fixing it is the whole point of
    // the bar. Reads the config ITSELF rather than trusting reg.entidadeAtual():
    // see the note in pintarBarraEntidade about why that value is stale here.
    //
    // Repainting live is not cosmetic. Without it the volunteer has to reload to
    // get the working button, and a reload starts with an empty latch — so the
    // first note goes back out to the refused CNPJ and burns a request to
    // rediscover what was already on screen.
    Config.aoMudar(async (tipo) => {
      if (tipo !== 'config') return;
      const atual = await Config.obterConfig();
      pintarBarraEntidade(Config.entidadeAtiva(atual) || null);
    });

    const fila = await Config.obterFila();
    entrouNaFila(fila.length);
    for (const pendente of fila) {
      reg.bloquearChave(pendente.chave);
      enfileirar({
        chave: pendente.chave,
        cnpj: pendente.cnpj,
        itemId: null, // no row until it has something to say — see linhaDe
        tentativa: 0,
        origem: 'fila',
        // Stamped when the volunteer entered it, days ago if this batch was
        // scanned offline.
        em: pendente.em || null,
        // Frozen at scan time: what our own table said about a note the
        // volunteer sent anyway, or null for an ordinary one. It does two jobs
        // here — it tells processar to skip its re-judge, and it rebuilds the
        // row marker, which is the ONLY thing keeping a forced send from
        // reading as an ordinary one once its scan-time row is long gone.
        //
        // The debug path settles for less: `forcado` is set in aceitar() alone,
        // so a debug-forced note comes back from the queue unmarked, and
        // CLAUDE.md accepts that because debug mode is allowed to be imperfect.
        // A shipped preference gets no such allowance.
        semValidacao: pendente.semValidacao || null,
        marcas: pendente.semValidacao ? { semValidacao: pendente.semValidacao } : null
      });
    }
  })();
})();
