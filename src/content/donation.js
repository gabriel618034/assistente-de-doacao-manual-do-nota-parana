/**
 * donation.js  (content only)
 * -----------------------------------------------------------------------------
 * The network layer for a single donation. Runs in the content script so the
 * requests are same-origin to notaparana.pr.gov.br — they carry the volunteer's
 * existing login cookies and the right Origin/Referer automatically, exactly as
 * the page's own code would.
 *
 * Flow (mirrors the site's real behaviour):
 *   1. GET the cadastro page and read a FRESH per-request form token
 *      (<input name="value">). Tokens are short-lived / single-use.
 *   2. POST the donation as JSON with the dynamically-configured institution
 *      CNPJ injected as `cnpjEntidade`.
 *
 * Errors are normalised into plain-language, jargon-free messages. Messages are
 * ALWAYS plain text; when an action helps (e.g. log in again), the error carries
 * a structured `link: { href, rotulo }` the UI renders as a real anchor — no
 * HTML strings travel through the app. A `recuperavel` flag tells the
 * orchestrator a failure was likely a stale token (worth one automatic retry)
 * rather than a genuinely bad note.
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  const NFPR = (root.NFPR = root.NFPR || {});

  const { URL_DOACAO, URL_API_DOACAO, URL_SAIR, RE_SESSAO_DUPLICADA, PRAZO_RESPOSTA_MS } = NFPR.Site;

  const MSG_REDE = 'Sem conexão com a internet.';
  const MSG_SERVIDOR = 'O site do Nota Paraná não está respondendo agora.';
  const MSG_LENTIDAO = 'O site do Nota Paraná não respondeu a tempo.';
  const MSG_SESSAO = 'Sua sessão no Nota Paraná expirou.';
  // Ours, in plain words. The server's own sentence ("O usuário autenticado
  // possui mais de uma sessão ativa") is matched by RE_SESSAO_DUPLICADA in
  // site.js; this is only what the bar says about it.
  const MSG_SESSAO_DUPLICADA =
    'Sua conta do Nota Paraná está aberta em mais de um lugar, e o site bloqueou o envio.';
  // THE SHRUG. The site's own sentence for this is "A aplicação retornou que
  // não foi possível concluir a ação solicitada", and it is not relayed the way
  // every other server sentence here is — deliberately. Relaying exists so we
  // never invent detail the site did not give us; this sentence HAS no detail,
  // and dressing "we have no idea" in official language reads as though it did.
  // It is byte-identical for three unrelated causes, so it diagnoses nothing
  // at all. See SEM_DIAGNOSTICO below.
  const MSG_SEM_DIAGNOSTICO = 'O site não concluiu o registro e não informou o motivo.';

  // What doar()'s reader hands back for a body that is not JSON.
  const ILEGIVEL = {};
  const LINK_LOGIN = { href: URL_DOACAO, rotulo: 'Entrar novamente' };
  const LINK_SAIR = { href: URL_SAIR, rotulo: 'Encerrar todas as sessões' };
  const MSG_ENCERRANDO_SESSAO = 'Encerrando as sessões abertas…';

  function erroCod(codigo, mensagem, link) {
    const e = new Error(mensagem);
    e.codigo = codigo;
    if (link) e.link = link;
    return e;
  }

  /**
   * The server answered with its "more than one active session" screen. While
   * WE are the ones closing the other sessions this is transient news; when the
   * preference is off (or the duplicate appeared after our one /sair) nothing
   * is being closed, so the volunteer gets the server's own sentence plus the
   * action that fixes it — the same GET the site's own button uses.
   */
  const erroDuplicada = (encerrando) =>
    encerrando
      ? erroCod('ENCERRANDO_SESSAO', MSG_ENCERRANDO_SESSAO)
      : erroCod('SESSAO_DUPLICADA', MSG_SESSAO_DUPLICADA, LINK_SAIR);

  // Latched to true by sessao.js when the duplicate-session screen is detected
  // and the /sair fetch begins. Stays true until that request settles — meaning
  // the session is being restored. While latched, any login redirect or missing
  // token is reported as ENCERRANDO_SESSAO rather than SESSAO, so items show
  // "Encerrando as sessões abertas…" instead of "Sessão expirou".
  let _encerrando = false;
  const setSessaoEncerrando = (v) => {
    _encerrando = v;
  };

  // Latched to true by sessao.js when the page we are running on IS the
  // server's duplicate-session screen and nobody is going to close the other
  // sessions (the preference is off). Stays true for the rest of the load.
  //
  // WHY A LATCH AND NOT JUST SNIFFING THE RESPONSE: in that state the server
  // does not necessarily hand the sentence back to fetch — it answers our token
  // request with a login redirect, whose body says nothing about duplicate
  // sessions. Sniffing alone therefore reported "sua sessão expirou / entrar
  // novamente", which is both wrong and the exact advice that made the problem.
  // The page already knows the real reason; this carries it into the network
  // layer so EVERY session verdict below tells the same truth.
  let _duplicada = false;
  const setSessaoDuplicada = (v) => {
    _duplicada = v;
  };

  const erroSessao = (encerrando) => {
    if (encerrando) return erroCod('ENCERRANDO_SESSAO', MSG_ENCERRANDO_SESSAO);
    if (_duplicada) return erroCod('SESSAO_DUPLICADA', MSG_SESSAO_DUPLICADA, LINK_SAIR);
    return erroCod('SESSAO', MSG_SESSAO, LINK_LOGIN);
  };

  // Every code that means "the login is the problem". content.js latches on
  // exactly these, and the health probe is the one caller here that has to
  // tell them apart from everything else.
  const CODIGOS_SESSAO = ['SESSAO', 'SESSAO_DUPLICADA', 'ENCERRANDO_SESSAO'];

  /**
   * fetch with a hang guard over the WHOLE ANSWER: a server that accepts the
   * connection and never finishes answering would otherwise leave notes stuck
   * on "Enviando…" for ever. On timeout we throw a SERVIDOR-coded error so the
   * outage watchdog takes over.
   *
   * pedir(url, opts, ler?) -> { resp, corpo }
   *   ler(resp) reads the body, and runs INSIDE the deadline. That is the whole
   *   reason it is a parameter: the timer used to be cleared the moment the
   *   headers arrived, so `text()` and `json()` had no deadline at all — six
   *   stalled bodies held every pool slot for ever with nothing on screen, and a
   *   stalled probe body kept the confused-server latch shut while its bar
   *   promised it would lift. Aborting the request rejects a pending body read
   *   with the same AbortError, so one catch covers both halves.
   *
   * A reader decides what its own failures mean and must let an AbortError
   * through untouched; anything else it throws reaches the caller as-is.
   */
  async function pedir(url, opts, ler) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), PRAZO_RESPOSTA_MS);
    try {
      const resp = await fetch(url, Object.assign({}, opts, { signal: ctl.signal }));
      return { resp, corpo: ler ? await ler(resp) : undefined };
    } catch (e) {
      if (e && e.name === 'AbortError') throw erroCod('SERVIDOR', MSG_LENTIDAO);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * What an answer to GET URL_DOACAO with `redirect: 'manual'` says about the
   * login: 'MORTA' | 'VIVA' | 'INDEFINIDA'.
   *
   * ONE READING OF ONE QUESTION. Sessao.conferir() asks exactly this request
   * too, and the two used to disagree: it called a 2xx alive, while the copy
   * here called ANY answer below 500 a dead session — so a POST that merely
   * dropped its connection, followed by a perfectly healthy 200, stopped the
   * whole queue behind "Sua sessão expirou". Here because sessao.js already
   * depends on this file and loads after it.
   *
   *   MORTA       bounced to the identity provider (opaqueredirect, any 3xx),
   *               or refused outright (401, 403) — proof
   *   VIVA        the page answered; the login is fine
   *   INDEFINIDA  anything else (a 404, a 5xx) — nothing about the session
   *               was proved either way
   */
  function sessaoPelaResposta(resp) {
    if (resp.type === 'opaqueredirect') return 'MORTA';
    if (resp.status === 401 || resp.status === 403) return 'MORTA';
    if (resp.status >= 300 && resp.status < 400) return 'MORTA';
    if (resp.status >= 200 && resp.status < 300) return 'VIVA';
    return 'INDEFINIDA';
  }

  /**
   * A same-origin fetch threw while the browser says it's online. Two very
   * different causes look identical here:
   *   a) the server is unreachable, or the request simply failed on the way;
   *   b) the session expired and the server redirected to a login page on
   *      ANOTHER origin — following that redirect trips CORS and fetch throws.
   * Disambiguate with a probe that does NOT follow redirects, read by
   * sessaoPelaResposta above. Only proof of a dead login is a session problem;
   * a page that answers proves the login is FINE and the failure was
   * transient, and no answer / 5xx / timeout means the server is in trouble.
   * Both of those are SERVIDOR: the note is parked, the watchdog probes, and it
   * goes out again the moment the site answers — which for a transient failure
   * is the first probe.
   */
  async function classificarFalha() {
    try {
      const { resp } = await pedir(URL_DOACAO, {
        credentials: 'include',
        redirect: 'manual',
        cache: 'no-store'
      });
      if (sessaoPelaResposta(resp) === 'MORTA') return erroSessao(_encerrando);
      return erroCod('SERVIDOR', MSG_SERVIDOR);
    } catch {
      return erroCod('SERVIDOR', MSG_SERVIDOR);
    }
  }

  /**
   * The text of a page, decoded the way the SERVER wrote it.
   *
   * Not `resp.text()`, which always decodes UTF-8 whatever the page declares.
   * The donation page is windows-1252 (see reference/), so "sessão" arrived as
   * "sess�o", RE_SESSAO_DUPLICADA never matched, and a duplicate session
   * met mid-sitting was reported as an EXPIRED one — "Entrar novamente", the
   * advice that makes duplicates, with the preference that would have closed
   * them never firing.
   *
   * Sniffed rather than read off the headers: UTF-8 is tried strictly first,
   * and windows-1252 text with any accented letter in it is not valid UTF-8, so
   * the fallback catches exactly that page — whether the charset is declared in
   * a header, a <meta>, or nowhere. Pure ASCII reads the same either way.
   *
   * The page only. The JSON answers are UTF-8 (declared, and observed intact
   * 2026-09-29), so the POST and the probe read them with json().
   */
  function decodificar(bytes) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return new TextDecoder('windows-1252').decode(bytes);
    }
  }

  async function lerPagina(resp) {
    let bytes;
    try {
      bytes = await resp.arrayBuffer();
    } catch (e) {
      if (e && e.name === 'AbortError') throw e; // pedir names it: too slow
      // The answer started and never finished. That is a fact about the
      // connection and never about the login: this used to be read as an
      // empty page, which has no token, which said "Sua sessão expirou".
      throw navigator.onLine ? erroCod('SERVIDOR', MSG_SERVIDOR) : erroCod('REDE', MSG_REDE);
    }
    return decodificar(bytes);
  }

  /** Fetch a fresh form token from a clean copy of the cadastro page. */
  async function obterToken() {
    let resp, html;
    try {
      // Plain GET, exactly like the page itself — no special headers, so the
      // server returns the full HTML that contains the form token.
      ({ resp, corpo: html } = await pedir(URL_DOACAO, { credentials: 'include' }, lerPagina));
    } catch (e) {
      if (e && e.codigo) throw e; // timeout or a broken body, already classified
      if (!navigator.onLine) throw erroCod('REDE', MSG_REDE);
      throw await classificarFalha(); // server down OR cross-origin login redirect
    }
    if (resp.status >= 500) throw erroCod('SERVIDOR', MSG_SERVIDOR);

    // Read the page BEFORE judging the session. The duplicate-session screen
    // comes back as a perfectly ordinary 200 OK, and the server may render it
    // from a URL containing "login" — which the two checks below would then
    // report as "sua sessão expirou", telling the volunteer to log in again
    // when logging in again is exactly what caused the problem.
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (RE_SESSAO_DUPLICADA.test((doc.body && doc.body.textContent) || '')) {
      throw erroDuplicada(_encerrando);
    }

    if ((resp.redirected && /login/i.test(resp.url)) || !resp.ok) {
      throw erroSessao(_encerrando);
    }

    const campo = doc.querySelector('input[name="value"]');
    if (!campo || !campo.value) throw erroSessao(_encerrando);
    return campo.value;
  }

  /**
   * Turn a parsed server body into { estado, mensagem, reconhecida?, recuperavel?, codigo? }.
   *
   * Split out of doar() for ONE reason: debug mode's `respostaForcada` feeds a
   * body straight in here (see below). Routing a forged answer through the real
   * table is the entire point — a bypass that skipped it would test nothing.
   *
   * The rules it applies are documented on doar().
   *
   * `reconhecida: true` means THIS CODE READ THE ANSWER — it matched a sentence
   * or a field it knows. Every branch that matched something says so; the three
   * fall-through branches at the bottom deliberately do not.
   *
   * WHAT READING IT BUYS is the point, not the reading itself: an answer this
   * table can name is an answer the orchestrator has a POLICY for, and every
   * policy it has either finishes the matter (a success; the three grey refusals,
   * where the note is real and undonatable so no paper helps; `chave de acesso
   * inválida`, which is deterministic) or KEEPS the note in nfpr:fila behind a
   * bar (a refused entity, a dead connection, a dead session, a confused
   * server, a refused request). Unread answers get neither, because neither
   * could be chosen — the note is destroyed at the end of its budget with
   * nobody holding it, so the volunteer becomes the only actor left.
   *
   * That is what the panel's "erros desconhecidos" list collects, and this
   * flag is what tells it apart. It is set HERE, at the one place that knows:
   * by the time a row renders a message, READ and RELAYED look identical.
   *
   * Adding a branch? The flag is a proxy. The rule it stands for is that a note
   * may only be destroyed when nothing is owed or something outliving a row is
   * holding it — so mark a new branch recognised only once content.js actually
   * does one of those with it.
   */
  function classificarResposta(conteudo) {
    // PROVENANCE IS STAMPED HERE, ON THE WAY OUT, AND NOWHERE ELSE.
    //
    // A row's status line can carry a sentence this extension decided or one
    // the government site decided, and until now they were indistinguishable —
    // "Fora do prazo para doar" from our own REGRAS and the same sentence from
    // the site mean very different things to whoever is reading a volunteer's
    // report, because only one of them is ours to fix. `fonte` is what the
    // panel renders as a muted [nfprweb] prefix.
    //
    // A WRAPPER RATHER THAN A FIELD ON TEN OBJECT LITERALS, deliberately: every
    // return inside lerResposta is server-side BY CONSTRUCTION, so tagging the
    // way out means a branch added later cannot forget to. The alternative —
    // pattern-matching sentences at the panel — is the thing this design exists
    // to avoid: by the time a row renders a message, READ and RELAYED look
    // identical.
    //
    // WHAT COUNTS AS SERVER-SIDE IS "WHERE THE FAILURE WAS DECIDED", not who
    // wrote the words. The two "O site respondeu…" fallback sentences below are our
    // wording about their failure and they take the prefix: they stand in the
    // slot a server sentence would have occupied, and the maintainer still
    // needs to know which side broke.
    //
    // Nothing outside this function is tagged, and that line is the useful one.
    // The "Guardada — …" messages content.js writes for a parked note are not
    // reports of what the site said; they describe what THIS extension is doing
    // next, and they are entirely ours to reword. `simularEnvio` is untagged
    // too — its sentence says "Simulação:" and nothing was sent, so [nfprweb]
    // there would be a plain lie. `respostaForcada` IS tagged, because it is
    // routed through this table precisely to look like the server.
    const veredito = lerResposta(conteudo);
    veredito.fonte = 'nfprweb';
    return veredito;
  }

  function lerResposta(conteudo) {
    // ONE ANSWER FILES A DONATION: 200 OK with a `mensagem` containing
    // "sucesso". Every other answer in this table — every 400 refusal, the 500
    // shrug, a body we cannot read — means the claim was NOT filed. There is no
    // third state here, and saying "pode não ter sido registrada" understates
    // it in the one direction that loses donations: a volunteer who thinks a
    // note might have gone through puts the receipt on the done pile.
    //
    // The only genuinely unknown case is an answer that never arrived — a
    // timeout or a dropped connection — and it does not reach this function.
    // Those throw REDE/SERVIDOR, keep the note in nfpr:fila and resend it,
    // which is where DOCS.md's accepted duplicate-donation risk actually lives.

    // VALID JSON IS NOT NECESSARILY AN OBJECT. A body of `null` parses, and
    // reading a field off it threw a TypeError straight past every branch
    // below into content.js's catch-all — no retry, no probe, the note deleted
    // on its first attempt and recorded as "Cannot read properties of null".
    // A bare string or number is no better. None of them says anything, so they
    // are the no-field case at the bottom, arriving early.
    if (!conteudo || typeof conteudo !== 'object') return semResultado();

    // Successful (or otherwise informative) server message.
    if (conteudo.mensagem) {
      if (/sucesso/i.test(conteudo.mensagem)) {
        return { estado: 'sucesso', mensagem: conteudo.mensagem, reconhecida: true };
      }
      // Unrecognised, so retried either way; the site's own sentence is
      // relayed as-is rather than replaced with something we made up. NO
      // `reconhecida` — relaying is not reading, and this note ends up on the
      // failures list precisely because we could not tell the volunteer what
      // happened to it.
      return { estado: 'erro', mensagem: conteudo.mensagem, recuperavel: true };
    }

    // Per-key rejection from the donation engine.
    if (conteudo.chaveAcesso) {
      const msg = conteudo.chaveAcesso;
      if (/prazo para doar/i.test(msg)) {
        return { estado: 'inelegivel', mensagem: msg, reconhecida: true };
      }
      // The 44 digits decode to a document type the engine will not take —
      // anything but an NF-e (55) or an NFC-e (65). That is a property of the
      // key itself — retrying will read
      // the same digits and get the same verdict every time. GREY, not red:
      // a CT-e is a real document, so nothing was mistyped; the note simply
      // cannot be donated here.
      if (/tipo de documento inv[aá]lido/i.test(msg)) {
        return { estado: 'inelegivel', mensagem: msg, reconhecida: true };
      }
      // The issuer is not in Paraná — cUF, the first two digits, is not 41.
      // An HTTP 400, and decided BEFORE the date and the document type: a key
      // wrong on all three is answered with this and nothing else. Only the
      // check digit is examined ahead of it.
      //
      // Pre-empted locally by NAO_PR, so a note only reaches here if it slipped
      // past our own table. GREY and TERMINAL, like the two above: the digits
      // are a genuine key from a genuine state, nothing was mistyped, and no
      // number of retries moves the shop to Paraná. Recognised, so the note is
      // dropped from nfpr:fila on the first answer and never reaches the
      // failures list — there is nothing unexplained about it.
      if (/n[ãa]o est[áa] localizado no Estado do Paran[áa]/i.test(msg)) {
        return { estado: 'inelegivel', mensagem: msg, reconhecida: true };
      }
      // The key fails the site's own validation (bad CDV/format) — not to be
      // confused with "inexistente", which is a real-looking key the engine
      // could not find and IS worth retrying (see below).
      // The one RED branch here that is recognised, so the only red row from
      // this table that is destroyed AND stays off the failures list. It looks
      // like the exception and is not: A CORRUPTED READ CANNOT PRODUCE THIS
      // ANSWER. The key layout and its módulo-11 check digit are fixed by
      // federal law rather than by Nota Paraná, so our CDV test and theirs
      // cannot disagree — and ours is otherwise the stricter. A mis-scan
      // therefore either fails our net first (red toast, never sent) or passes
      // both and comes back SUCESSO — the silent lost donation, not this. The
      // digits here are self-consistent and deterministically refused:
      // re-reading the paper yields the same digits and the same refusal, and
      // there is genuinely nothing to send anyone back to.
      //
      // Letters change none of this. The server validates alphanumeric keys
      // (maintainer's observation, 2026-09-28: a mistyped cDV on one gets this
      // same sentence), so the answer is as final on them as on a numeric key.
      if (/chave de acesso inv[aá]lida/i.test(msg)) {
        return { estado: 'erro', mensagem: msg, reconhecida: true };
      }
      // THE REQUEST WAS REFUSED ABOVE THE NOTE. It arrives on chaveAcesso like
      // a verdict on the key, which is exactly why it needs its own code:
      // every other sentence in this field proves the engine read our 44
      // digits and formed an opinion, and the orchestrator is entitled to act
      // on that. This one proves nothing of the sort.
      //
      // NAMED AFTER THE ANSWER, NOT A CAUSE, deliberately. A stale form token
      // produces it, and so does a malformed `documentoComChaveAcesso` — and
      // there is no reason to believe that list is complete.
      // It was called TOKEN_RECUSADO for exactly as long as it took to find the
      // second trigger. What is actually known is the shape: the server
      // rejected the REQUEST before judging the note.
      //
      // Retried like any other recoverable answer — each attempt fetches a
      // FRESH token, which is the mitigation for the one cause we can do
      // anything about, and is observed to work. The code exists for the case
      // where it does not: on exhaustion the note must be KEPT, never deleted,
      // because nothing here was ever about the note. That holds whatever the
      // trigger turns out to be, which is why the uncertainty above is safe.
      // Matching the sentence at the deletion site instead would tie a
      // data-loss guard to the wording of a government error string.
      if (/procedimento inv[aá]lido/i.test(msg)) {
        return {
          estado: 'erro',
          codigo: 'PROCEDIMENTO_INVALIDO',
          mensagem: msg,
          reconhecida: true,
          recuperavel: true
        };
      }
      // Every other rejection sentence is one we have not learnt to read. It
      // may be a permanent verdict on the note or a passing state; retry and
      // let the budget decide — and, when the budget runs out, hand the paper
      // back to the volunteer on the failures list. No `reconhecida`.
      return { estado: 'erro', mensagem: msg, recuperavel: true };
    }

    // CNPJ not registered as a donation recipient (HTTP 400 cnpjEntidade field).
    // Terminal on purpose: this is about the configured entity, not the note,
    // and it will answer the same way for ever until the volunteer changes it.
    // CARRIES A CODE, unlike every other branch here, because the orchestrator
    // has to LATCH on this one rather than treat it as a verdict on the note.
    // Matching the sentence instead would tie a data-loss guard to the exact
    // wording of a government error message.
    if (conteudo.cnpjEntidade) {
      return {
        estado: 'erro',
        codigo: 'ENTIDADE_RECUSADA',
        mensagem: conteudo.cnpjEntidade,
        reconhecida: true
      };
    }

    // THE SHRUG — an answer that diagnoses nothing.
    //
    // Detected on the FIELD, never on the sentence. The same words answer an
    // impossible note, an empty target CNPJ and a missing cnpjEntidade field:
    // three unrelated causes, one reply, byte for byte. It is what their stack
    // says when it gives up, so it may equally cover other causes — a real
    // outage included. Treat it as "no
    // information", never as a diagnosis, and never infer a cause from it.
    //
    // Note what this branch does NOT do: it does not decide anything about the
    // note. That decision needs a second fact — whether the server is healthy —
    // and sondarSaude() below is how the orchestrator goes and gets it.
    //
    // RELAYED VERBATIM, and this reverses an earlier decision on purpose. The
    // sentence used to be replaced with one of ours ("O site não conseguiu
    // concluir o registro e não disse por quê"), because repeating theirs would
    // officially claim a diagnosis that does not exist — it is the same words
    // for three unrelated causes.
    //
    // What changed is that provenance is now VISIBLE: `fonte` puts a muted
    // [nfprweb] in front of it on the row, so the sentence is plainly the
    // site's own words rather than this extension's reading of anything. That
    // was the whole objection, and it no longer applies. Relaying is also
    // strictly more useful to whoever is handed a screenshot — our paraphrase
    // was a paraphrase OF the same non-diagnosis, and it threw away the exact
    // string a maintainer would search for.
    //
    // Everything else about the shrug is unchanged: still detected on the
    // FIELD and never on the sentence, still `SEM_DIAGNOSTICO`, still no
    // diagnosis inferred from it, still arbitrated by the probe.
    if (conteudo.erro) {
      return {
        estado: 'erro',
        codigo: 'SEM_DIAGNOSTICO',
        // The field is matched on truthiness, so it need not be a string. Our
        // own wording stays as the fallback for that case: relaying a bare
        // `true` to a volunteer would be worse than saying nothing was said.
        mensagem:
          typeof conteudo.erro === 'string' && conteudo.erro.trim()
            ? conteudo.erro
            : MSG_SEM_DIAGNOSTICO,
        recuperavel: true
      };
    }

    // A body with no field we recognise is equally information-free, so it is
    // the same condition arriving by a different door — same code, our own
    // wording, because there is nothing to relay.
    return semResultado();
  }

  function semResultado() {
    return {
      estado: 'erro',
      codigo: 'SEM_DIAGNOSTICO',
      mensagem: 'O site respondeu sem informar o resultado. A nota não foi registrada.',
      recuperavel: true
    };
  }

  // ---- The health probe -------------------------------------------------------
  // A POST GUARANTEED TO BE REFUSED IS NOT A DONATION CLAIM. That is the whole
  // idea, and it is what makes the server directly checkable: the shrug above
  // is silent about its own cause, but the engine's specific refusals are not,
  // so we ask it a question whose answer we already know and see whether it
  // still knows it.
  //
  // THE KEY. Long expired (January 2001) and structurally sound — cUF 41,
  // modelo 65, série 000, correct check digit. It is deliberately the SAME
  // SHAPE the server accepts when in date (see "the
  // server's rejections are authoritative" in CLAUDE.md), with the clock wound
  // back twenty-five years. That is the point: the server has no structural
  // objection to this shape, so the only thing refusing it is the deadline
  // validator — which means a refusal proves the engine decoded the date,
  // compared it to a clock and formed a judgement. Nothing shallower would.
  //
  // THE `41` IS LOAD-BEARING, and that is not a style point. The cUF is the
  // FIRST thing the engine decides (a key wrong in every field is answered by
  // naming only the state, ahead of the date and the document model), so a
  // probe key from any other state would be refused at gate one. It would still
  // be a "specific refusal" and still read as healthy — while proving only that
  // the endpoint parsed two digits. That is the shallow probe this comment
  // warns about, wearing a different disguise: the cheaper the refusal, the
  // less of the validator stack it exercises.
  //
  // Our own Chave.avaliar() calls this key RED (the zeroed issuer fails the
  // CNPJ checksum), so it can never be mistaken for a scanned note: if it ever
  // reached the scan path it would be refused before leaving the machine.
  //
  // THE CNPJ. Belt and braces, and the two refusals are in SEQUENCE, not in a
  // race: the key is judged first, so an expired key means the CNPJ is never
  // even looked at. It is the net underneath — it only matters on the day the
  // deadline check stops applying, and on that day nothing may be filed.
  // A key the engine refuses comes back as the key refusal, not the entity
  // one, whatever this field holds. The sequence is the engine's, not a guess.
  //
  // IT MUST NEVER BE EMPTY OR MISSING. Both of those produce the shrug, and a probe that shrugs at itself reports "not healthy" for
  // ever: the reaper would silently die and nothing would say so. It is not
  // '0' either, in case anything in that stack treats a zero as absent.
  //
  // HAMMERING THIS IS SAFE, and that is a measured property of the deadline
  // refusal rather than an assumption: the rejection is instant, the note is
  // counted as a donation nowhere, the answer is always the same sentence, and
  // repeating the SAME expired key changes nothing. So the probe needs no
  // rationing for safety's sake. The single-flight guard and the 30 s cache in
  // content.js exist to avoid pointless load on someone else's server and to
  // keep one answer speaking for a whole burst of failures — not to protect
  // anything, and not to be tightened as though they did.
  //
  // The one answer worth NOT provoking is "Procedimento inválido", because a
  // few of those in a row can end the volunteer's session. The probe never
  // provokes it: `documentoComChaveAcesso` is the string the site's own script
  // sends, and the token is freshly minted by obterToken(). It can only be
  // RECEIVED, when token supply is already broken — and then it is read as
  // 'confuso', never as proof of health. See sondarSaude below.
  const CHAVE_SONDA = '41010100000000000000650000000000000000000003';
  const CNPJ_SONDA = '1';

  /**
   * Ask the server whether it is still able to judge a donation.
   *
   * -> 'saudavel'  it answered with a specific refusal, so validation ran
   * -> 'confuso'   the shrug, an unreadable answer, or no answer at all
   * REJECTS with the session error when the probe's own token fetch finds the
   * login dead (a code in CODIGOS_SESSAO)
   *
   * ONE QUESTION, AND EVERY FAILURE MODE ANSWERS 'confuso'. The only thing
   * this licenses is deleting a note that has run out of retries, so the
   * fail-safe answer is always "don't".
   *
   * THE ONE FAILURE IT DOES NOT SWALLOW IS A DEAD SESSION, and that is not an
   * exception to the rule above — a rejection licenses deleting nothing either.
   * It is there because the probe is the ONLY thing still talking to the site
   * while the confused-server latch holds: the pool is paused, so no real send
   * can discover the login going, and an incident longer than a login used to
   * leave the bar promising an automatic resumption that could never come,
   * with the one action that fixes it — logging in — nowhere on screen.
   * content.js hands it to the same latch every other session failure reaches.
   *
   * Matched on the FIELD, not the sentence, for the reason given above and
   * because which of the two refusals wins is the engine's business, not ours.
   */
  async function sondarSaude() {
    try {
      const token = await obterToken();
      const { corpo } = await pedir(
        URL_API_DOACAO,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            chaveAcesso: CHAVE_SONDA,
            cnpjEntidade: CNPJ_SONDA,
            documentoComChaveAcesso: 'true',
            value: token
          })
        },
        (r) => r.json()
      );
      if (!corpo) return 'confuso';
      // Judged by the REAL table, not by re-reading the body here. A second
      // matcher would drift from the first, and the one answer that must never
      // count as healthy is already recognised over there.
      const veredito = classificarResposta(corpo);
      // REFUSED ABOVE THE NOTE, so the engine never got as far as judging our
      // key and this proves nothing about whether it can.
      //
      // THE PROBE FETCHES ITS OWN TOKEN, which is why this matters here rather
      // than being a curiosity: a refused token is the one trigger we both see
      // in normal operation and cannot prevent, and when token supply breaks
      // the probe breaks with it. Its refusal arrives on `chaveAcesso`, so a
      // naive "is there a chaveAcesso field?" reads the probe's OWN failure as
      // a validator answering, reports healthy, and licenses deleting notes at
      // the exact moment nothing is getting through. Fail safe: 'confuso'.
      //
      // (A malformed `documentoComChaveAcesso` triggers it too — not
      // something this code can emit: we send the same
      // four fields the site's own doacaoDocumentoFiscal.js sends, so the shape
      // is pinned to theirs. Recorded because the trigger list is evidently
      // longer than it first looked, not because our request might drift.)
      if (veredito.codigo === 'PROCEDIMENTO_INVALIDO') return 'confuso';
      if (veredito.codigo === 'SEM_DIAGNOSTICO') return 'confuso';
      // A specific refusal on either field: the validators ran and answered.
      if (corpo.chaveAcesso || corpo.cnpjEntidade) return 'saudavel';
      // NOTHING ELSE IS HEALTHY — a `mensagem` included, whatever it says. The
      // probe is built to be refused: a key that expired in 2001, aimed at a
      // CNPJ that cannot exist. It never files, so an acceptance is the probe
      // broken or the server filing nonsense, and neither proves the engine can
      // judge a note. Any other sentence proves nothing at all. This line used
      // to read every `mensagem` as healthy, so a probe answered "Erro ao
      // processar" during an incident licensed the reaper to delete the
      // shrugging notes it exists to keep.
      return 'confuso';
    } catch (e) {
      if (e && CODIGOS_SESSAO.includes(e.codigo)) throw e;
      return 'confuso';
    }
  }

  /**
   * Debug mode standing in for the network (src/shared/debug.js). Returns a
   * result to hand back, or null to let the real request happen.
   *
   *   erroForcado       throws the coded error the orchestrator's catch reads,
   *                     which is otherwise only reachable by breaking your own
   *                     session or unplugging the router
   *   respostaForcada   a body — or a bare sentence, shorthand for the
   *                     chaveAcesso field the engine rejects notes with — run
   *                     through classificarResposta above
   *   simularEnvio      answer "sucesso" without touching the site at all
   *
   * Checked BEFORE the token fetch, so an armed page makes no request whatsoever.
   */
  function respostaDeDepuracao(chave) {
    const D = NFPR.Debug;
    if (!D.estaAtivo()) return null;

    const cod = D.valor('erroForcado');
    if (cod) {
      D.log('falha de envio forçada', cod);
      if (cod === 'REDE') throw erroCod('REDE', MSG_REDE);
      if (cod === 'SERVIDOR') throw erroCod('SERVIDOR', MSG_SERVIDOR);
      if (cod === 'SESSAO_DUPLICADA') throw erroDuplicada(false);
      if (cod === 'ENCERRANDO_SESSAO') throw erroDuplicada(true);
      throw erroCod('SESSAO', MSG_SESSAO, LINK_LOGIN);
    }

    // A forced outage has to stop the SEND, not just the recovery probe.
    // connectivity.js alone could never do this: on the live page its watchdog
    // sits idle until something fails, so "sempre sem conexão" changed nothing
    // until a note was scanned — and then the note went out for real. Failing
    // here is what parks it and turns the bar, exactly like a true outage.
    if (D.valor('forcarConexao') === 'offline') {
      D.log('sem conexão forçada — nada foi enviado');
      throw erroCod('REDE', MSG_REDE);
    }

    const forcada = D.valor('respostaForcada');
    if (forcada) {
      const corpo = typeof forcada === 'string' ? { chaveAcesso: forcada } : forcada;
      D.log('resposta forçada', corpo);
      return classificarResposta(corpo);
    }

    if (D.on('simularEnvio')) {
      D.log('envio simulado — nada foi para o servidor');
      // `simulado` is what content.js reads to keep this away from the real
      // success path, which deletes the note from the durable queue.
      return { estado: 'sucesso', mensagem: 'Simulação: nota registrada com sucesso.', simulado: true };
    }
    return null;
  }

  /**
   * Donate one key for a given institution CNPJ.
   * Resolves to { estado, mensagem, recuperavel? } and only throws on
   * network/session problems (which the caller may keep in the retry queue).
   *
   *   estado: 'sucesso' | 'inelegivel' | 'erro'
   *
   * RETRYING IS THE DEFAULT. `recuperavel` is set on everything except the
   * answers this code can positively recognise:
   *
   *   sucesso           the site said so
   *   inelegivel        a real note that cannot be donated. Three answers land
   *                     here: past the donation deadline (waiting cannot
   *                     un-expire it), a document type that is neither an NF-e
   *                     nor an NFC-e (a CT-e key, say), and an issuer outside Paraná (cUF is
   *                     not 41). All three describe a genuine document, so they
   *                     are grey rather than red — nothing was mistyped
   *   cnpjEntidade      that entity is not registered to receive; the volunteer
   *                     has to change the configuration, no number of retries will
   *   chave de acesso   the key fails the site's own validation (bad CDV or
   *   inválida          format); the key itself is wrong, not the attempt
   *
   * Anything else — an unfamiliar sentence, a JSON body with no field we know,
   * a reply that is not JSON at all — is something we do not understand, and a
   * good note must not be thrown away because of it: it comes back `erro` with
   * `recuperavel: true`, carrying the site's own sentence when it sent one, or
   * a message this code wrote itself when it did not. The orchestrator gives it
   * the full retry budget (MAX_TENTATIVAS in content.js), and once that runs out
   * reports it and forgets the key, so rescanning the receipt is a real retry.
   *
   * TWO OF THOSE CARRY A CODE, because "we do not understand it" is not one
   * situation but two, and they want opposite treatment:
   *
   *   SEM_DIAGNOSTICO  the shrug, or an answer we could not read. It says
   *                    nothing about the note AND nothing about the server, so
   *                    the orchestrator asks sondarSaude() which of the two it
   *                    was before it decides whether to delete anything
   *   PROCEDIMENTO_INVALIDO
   *                    "Procedimento inválido" — the REQUEST was refused above
   *                    the note (a stale token and a malformed
   *                    documentoComChaveAcesso both produce it, and that list
   *                    is not known to be complete). Retried like anything
   *                    else; the code exists so that running out of retries
   *                    KEEPS the note rather than deleting it
   *
   * This knowingly risks donating the same note twice, but only in one case:
   * A POST WHOSE ANSWER NEVER ARRIVED — a timeout, a dropped connection — may
   * have been processed before we stopped listening, and it is resent anyway.
   * An answer that DID arrive and was not 200 OK + "sucesso" filed nothing, so
   * resending those costs no duplicate at all. That trade is deliberate — see
   * "Known gaps" in DOCS.md.
   */
  async function doar(chave, cnpj) {
    const fingida = respostaDeDepuracao(chave);
    if (fingida) return fingida;

    const token = await obterToken();

    let resp, conteudo;
    try {
      ({ resp, corpo: conteudo } = await pedir(
        URL_API_DOACAO,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            chaveAcesso: chave,
            cnpjEntidade: cnpj,
            documentoComChaveAcesso: 'true',
            value: token
          })
        },
        // A body that is not JSON is an ANSWER we cannot read, not a failed
        // request, so it is marked and judged below. Only the deadline gets
        // through, and pedir names that.
        (r) => r.json().catch((e) => {
          if (e && e.name === 'AbortError') throw e;
          return ILEGIVEL;
        })
      ));
    } catch (e) {
      if (e && e.codigo) throw e; // timeout, already classified as SERVIDOR
      if (!navigator.onLine) throw erroCod('REDE', MSG_REDE);
      throw await classificarFalha();
    }

    if (conteudo === ILEGIVEL) {
      // THE ONLY STATUS CHECK ON THE POST PATH, and it lives in the branch where
      // there was nothing to read. Hoisted above the body it would let one
      // impossible note's HTTP 500 shrug fake a site-wide outage.
      // A 5xx without a JSON body means the server itself is struggling.
      if (resp.status >= 500) throw erroCod('SERVIDOR', MSG_SERVIDOR);
      // Anything else: the POST went through and the answer was not 200 OK +
      // "sucesso", so THE NOTE WAS NOT REGISTERED. What is missing is the
      // REASON — we could not even read the body. Those are different axes and
      // conflating them is how this code once claimed the outcome was unknown
      // when only the diagnosis was.
      //
      // Treated as possibly recoverable — retried, then reported with a message
      // this code wrote itself, since the site gave us nothing to relay. Same
      // code as the shrug, so the orchestrator asks the same question about it.
      // Tagged like everything lerResposta returns, and for the same reason:
      // the request landed and the site is what refused it. This return skips
      // the table only because there was no body to read.
      return {
        estado: 'erro',
        codigo: 'SEM_DIAGNOSTICO',
        mensagem: 'O site deu uma resposta inesperada. A nota não foi registrada.',
        recuperavel: true,
        fonte: 'nfprweb'
      };
    }

    return classificarResposta(conteudo);
  }

  NFPR.Donation = {
    doar,
    sondarSaude,
    sessaoPelaResposta,
    CODIGOS_SESSAO,
    CHAVE_SONDA,
    CNPJ_SONDA,
    MSG_SEM_DIAGNOSTICO,
    URL_DOACAO,
    RE_SESSAO_DUPLICADA,
    setSessaoEncerrando,
    setSessaoDuplicada,
    MSG_SESSAO,
    LINK_LOGIN,
    MSG_SESSAO_DUPLICADA,
    LINK_SAIR
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
