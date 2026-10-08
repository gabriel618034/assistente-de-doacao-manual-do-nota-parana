/**
 * chave.js
 * -----------------------------------------------------------------------------
 * Pure logic for the 44-digit access key (chave de acesso) of the two notes
 * this extension registers: an NFC-e (Nota Fiscal de Consumidor Eletrônica,
 * modelo 65) and an NF-e (Nota Fiscal Eletrônica, modelo 55). Both share one
 * key layout, so nothing here forks on the model except the one entry that is
 * ABOUT the model — see MODELOS_ACEITOS.
 *
 * No DOM, no storage, no side effects — trivially testable in isolation.
 *   - calcularCDV          check digit (módulo 11) for positions 0..42
 *   - extrairChave         pull a clean 44-character key out of raw scanner input
 *   - chaveParcial         the key material arriving RIGHT NOW, for the display
 *   - analisarChave        split 44 characters into the spec's named fields
 *   - REGRAS               EVERY check, as one ordered table — start here
 *   - aplicarRegras        the runner: three skip rules and a loop
 *   - avaliar              the whole verdict on a key
 *   - avaliarTemplate      the same, for a fixed part pattern
 *
 * THE COLOUR IS THE POINT, and one question decides it: does this note exist?
 * Red means the digits are wrong and nothing real was read — an error toast,
 * and the volunteer reads the paper again, which is what recovers the donation.
 * Grey means the note is real and simply cannot be donated — a row saying why,
 * and nothing to be done. Getting that backwards is expensive in exactly one
 * direction: telling someone they mistyped a receipt that is perfectly fine
 * ends with a donatable note in the bin.
 *
 * ADDING A CHECK IS ONE ENTRY IN REGRAS, and its colour is the whole decision.
 * It did not use to be. Two functions split these checks, and which one a check
 * lived in decided whether an active fixed part could fabricate a key over it —
 * so every new check meant re-deriving that argument first. Removing that
 * coupling (see parte-fixa.js) is what let this table replace the two-function
 * shape and the four entry points it had grown. Two remain, and they differ by
 * one boolean.
 *
 * The entry is the decision; four small things follow it, and the checklist
 * under "Adding a rule" in CLAUDE.md names them (a fixed-part sentence in
 * registrador.js, which smoke.js enforces; a debug fixture; smoke assertions;
 * the DOCS.md table row). The live verdict while typing, fixed part judgement
 * and the debug bypass flags all pick a new entry up by themselves.
 *
 * THE SÉRIE AND tpEmis ARE READ BY NOTHING. They used to be read by up to four
 * entries, and each one was walked back. See the note above MODELOS_ACEITOS
 * before adding one.
 *
 * THE KEY IS NOT ALL DIGITS ANY MORE. The issuer's CNPJ became alphanumeric
 * (IN RFB 2.229/2024, in production since 07/2026), and the key carries that
 * CNPJ at [6:20] — so twelve of those fourteen characters may be uppercase
 * letters. TWELVE, not fourteen: [18:20] is the CNPJ's own check digits, which
 * stay numeric. Every other span of the key is numeric as it always was, which
 * makes INDICES 6..17 THE ONLY PLACE A LETTER CAN EVER APPEAR — the fact
 * posicaoAlfanumerica publishes, FORMATO and LETRA_FORA_DO_LUGAR refuse on,
 * and capture.js decides with whether a letter belongs to the key at all.
 *
 * The check digit takes each character's ASCII value minus 48 (A = 17 … Z = 42,
 * digits unchanged) and is otherwise the same módulo-11 sum. Assignment is
 * progressive and only for new inscrições, so nearly every key this code meets
 * is still all digits — which is exactly why nothing here forks on it: there is
 * one algorithm, and the numeric key is the special case of it.
 *
 * The clock is always injected, never read here. Everything about fixed parts
 * lives in parte-fixa.js.
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  const NFPR = (root.NFPR = root.NFPR || {});

  const MULTIPLICADORES = [2, 3, 4, 5, 6, 7, 8, 9];

  // Where a letter may stand, and the only definition of it. The CNPJ occupies
  // [6:20]; its first twelve characters are alphanumeric and its last two are
  // its own check digits, so the window closes at 18.
  const INICIO_ALFA = 6;
  const FIM_ALFA = 18;

  /** Can the character at this index of a key be a letter? */
  const posicaoAlfanumerica = (i) => i >= INICIO_ALFA && i < FIM_ALFA;

  /**
   * Could this run of key characters be the BEGINNING of a key? Digits are
   * legal at every index; a letter only inside the issuer's CNPJ. RE_CHAVE says
   * the same thing about a COMPLETE key, and this is the prefix of it.
   *
   * It judges nothing and refuses nothing: FORMATO is what refuses a key. This
   * answers a narrower question — "is it worth painting this as an entry?" —
   * for chaveParcial and for capture.js while a scan is sweeping past.
   */
  function prefixoDeChave(trecho) {
    for (let i = 0; i < trecho.length; i += 1) {
      const c = trecho[i];
      if (c >= '0' && c <= '9') continue;
      if (!posicaoAlfanumerica(i)) return false;
    }
    return true;
  }

  /**
   * Does this text carry anything but a digit where only a digit may stand?
   * A '?' is not a character of the key but an unknown one — the gap of a
   * fixed part template, or a place still to be typed — so it never counts.
   * LETRA_FORA_DO_LUGAR is this and nothing else.
   */
  function letraForaDoLugar(texto) {
    const s = String(texto == null ? '' : texto);
    for (let i = 0; i < s.length; i += 1) {
      const c = s[i];
      if ((c >= '0' && c <= '9') || c === '?') continue;
      if (!posicaoAlfanumerica(i)) return true;
    }
    return false;
  }

  // The whole shape, in one expression: six digits, twelve alphanumeric, then
  // twenty-six digits. FORMATO is this and nothing else.
  const RE_CHAVE = /^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$/;

  /**
   * A character's value in the módulo-11 sum: its ASCII code minus 48.
   *
   * Digits map to themselves — '5' is 53, and 53 - 48 is 5 — which is what makes
   * it safe to apply to every character unconditionally; letters map to 17..42.
   * cnpj.js keeps its own copy for the CNPJ's check digits, deliberately: this
   * file depends on that one already, and the reverse dependency would be a
   * cycle for two lines of arithmetic.
   */
  const valorCaractere = (c) => String(c).charCodeAt(0) - 48;

  /** Módulo-11 check digit over the first 43 characters. Returns a single char. */
  function calcularCDV(chave) {
    let soma = 0;
    for (let i = 0; i < 43; i += 1) {
      soma += valorCaractere(chave[42 - i]) * MULTIPLICADORES[i % 8];
    }
    const resto = soma % 11;
    return String(resto === 0 || resto === 1 ? 0 : 11 - resto);
  }

  // A run of key characters: digits and uppercase letters, nothing else. The
  // separators of a QR-code URL (/ : . ? = |) all fall outside it, which is what
  // keeps the key a run of its own inside one.
  const CORRIDA = /[0-9A-Z]+/g;

  /**
   * Extract a 44-character key from arbitrary input.
   * Handles a plain barcode, an NFC-e QR-code URL (the key is the only run of
   * 44+ consecutive key characters in it), or otherwise-noisy text.
   *
   * UPPERCASED FIRST, because a key pasted or typed in lower case is the same
   * key. The site's own field does the opposite — Util.alfanumerico simply
   * DELETES anything outside [0-9A-Z], so a lower-case letter typed there
   * vanishes — and silently dropping a character out of a key is the one thing
   * this function exists to prevent.
   *
   * THE FALLBACK KEEPS LETTERS TOO, which is what lets a formatted key
   * ("4126 0912 ABC3 …") survive a paste. It cannot be narrowed back to digits
   * without deleting the issuer out of every alphanumeric key.
   */
  function extrairChave(bruto) {
    if (!bruto) return '';
    const texto = String(bruto).toUpperCase();
    const corrida = texto.match(/[0-9A-Z]{44,}/); // prefer a 44+ run
    if (corrida) return corrida[0].slice(0, 44);
    return texto.replace(/[^0-9A-Z]/g, '').slice(0, 44); // fallback: strip & take first 44
  }

  /**
   * The key material arriving RIGHT NOW — the whole key once it is there, and
   * the LAST run of key characters while it is still coming. For the DISPLAY
   * only; nothing is ever judged from it.
   *
   * It exists because the registrar paints a believed scan from the capture's
   * raw buffer, and that buffer holds a whole QR-code URL. Stripping every
   * non-digit used to do this job exactly: a key was all digits, and the URL
   * around it contributed nothing but letters and punctuation. That coincidence
   * is gone. Strip letters now and the cells show a 42-character key with the
   * issuer torn out of the middle; keep them and the cells show
   * "HTTPSWWWFAZENDA…".
   *
   * The LAST run is the one still being appended to, so mid-scan it is the
   * key's own prefix — every token of the URL in front of it has been closed by
   * a separator. Before the key starts it is the URL's final token: a few
   * characters, for a few milliseconds of a ~50 ms read.
   */
  function chaveParcial(bruto) {
    if (!bruto) return '';
    const texto = String(bruto).toUpperCase();
    const corrida = texto.match(/[0-9A-Z]{44,}/);
    if (corrida) return corrida[0].slice(0, 44);
    const partes = texto.match(CORRIDA);
    if (!partes) return '';
    const ultima = partes[partes.length - 1].slice(0, 44);
    // ...AND ONLY IF IT COULD BE THE BEGINNING OF ONE. A URL is a row of runs —
    // HTTPS, WWW, FAZENDA, PR, GOV, BR, NFCE, QRCODE — and each of them became
    // the entry for a few milliseconds as the scan swept past, so a QR read
    // flashed two dozen repaints of words at the volunteer before the key
    // arrived. None of those can start a key: a key opens with its cUF, so the
    // first six characters are digits and letters cannot appear before index 6.
    // A run that fails that test is not key material and is shown as nothing.
    //
    // NOT "everything before the 41", which is the same idea one step too
    // narrow: the registrar shows out-of-state notes too, and says which state
    // they are from, so a key beginning 35 or 43 has to reach the cells.
    return prefixoDeChave(ultima) ? ultima : '';
  }

  /**
   * Split 44 characters into the fields the key spec defines — one layout,
   * shared by the NF-e and the NFC-e. Returns null for anything that is not
   * exactly 44 characters long.
   *
   *   uf                [0:2]    IBGE state code — 41 is Paraná
   *   aa                [2:4]    emission year, last two digits (year = 2000 + aa)
   *   mm                [4:6]    emission month
   *   documentoEmitente [6:20]   the ISSUER's own document (CNPJ or padded CPF).
   *                              A CNPJ's first twelve characters may be
   *                              letters; its check digits and a CPF never are
   *   modelo            [20:22]  the FISCAL DOCUMENT's model — 65 is NFC-e,
   *                              55 is NF-e; those two are the ones accepted
   *   serie             [22:25]  parsed, judged by nothing (see MODELOS_ACEITOS)
   *   numero            [25:34]  invoice number
   *   tipoEmissao       [34:35]  parsed, judged by nothing
   *   codigo            [35:43]  numeric code
   *   cdv               [43:44]  check digit
   *
   * TWO NAMES ARE DELIBERATELY NOT THE OBVIOUS ONES, AND THEY USED TO BE WORSE.
   *
   * These two were `documento` and `tipoDocumento`, which read as a pair — a
   * thing and its type. They are nothing of the sort: [6:20] identifies the
   * SHOP, [20:22] identifies the KIND OF PAPER. Every reader had to learn that
   * twice, and a plausible-looking pair is exactly what a later change gets
   * wrong in silence. The names now say whose document each one is.
   *
   * The spec calls [20:22] `mod`. This codebase does módulo-11 arithmetic in
   * this very file and in cnpj.js, so `mod` would read as that; `modelo` is the
   * same word the spec uses, spelled out far enough to stop colliding.
   *
   * [6:20] is `documentoEmitente`, not `cnpj`, because it is NOT always a CNPJ.
   * An NF-e may be issued by a pessoa física (a produtor rural, typically), and
   * the key has no separate field for that: the CPF goes in this same span,
   * left-padded with zeros to fourteen digits, and [6:20] is accepted as
   * either (see documentoEmitenteInvalido). A field called `cnpj`
   * sitting next to NFPR.Cnpj would promise what the data does not keep. The
   * name matches `documentoEmitenteInvalido` and the `DOCUMENTO_EMITENTE` rule
   * code, which are the validator and the verdict for this exact span.
   *
   * THE '?' RULE: this parser accepts a fixed part template as readily as a
   * key. A span containing '?' is unknowable, so it yields null and every check
   * downstream skips itself. That one rule is the entire difference between
   * checking a note and checking a fixed part — there is no second code path.
   *
   * Callers holding a template must pass ParteFixa.completar(template): a
   * template being typed is shorter than 44 almost the whole time, and this
   * returns null for those.
   */
  function analisarChave(texto) {
    const s = String(texto == null ? '' : texto);
    if (s.length !== 44) return null;
    // A span with a variable digit in it is not a value; it is an unknown.
    const campo = (a, b) => {
      const t = s.slice(a, b);
      return t.includes('?') ? null : t;
    };
    return {
      uf: campo(0, 2),
      // aa and mm are separate spans on purpose: a fixed part may fix the year
      // and leave the month free, and that granularity buys real checks.
      aa: campo(2, 4),
      mm: campo(4, 6),
      documentoEmitente: campo(6, 20),
      modelo: campo(20, 22),
      serie: campo(22, 25),
      numero: campo(25, 34),
      tipoEmissao: campo(34, 35),
      codigo: campo(35, 43),
      cdv: campo(43, 44)
    };
  }

  // Five red codes share one sentence. Not laziness, and not only jargon
  // avoidance: these four are corruption detectors, so WHICH one fired is a
  // fact about our net, never about the note. Naming it would misdirect — "o
  // CNPJ do emitente é inválido" invites the volunteer to decide the receipt
  // itself is bad and bin it, when the receipt is almost certainly fine and
  // only the reading of it was wrong. There is one instruction that recovers
  // the donation in all four cases, so there is one sentence: read it again.
  //
  // COMPRIMENTO keeps its own wording precisely because it is the one the
  // volunteer can verify unaided — the cell display shows the count. There the
  // specifics help instead of misleading.
  //
  // FORMATO used to keep its own for the same reason, and lost it when the
  // CNPJ went alphanumeric: "apenas números" became false, and the true
  // sentence is not one anyone can check against the display. See the entry.
  //
  // The codes stay distinct anyway: they are the testable contract, and only
  // the wording is shared.
  //
  // It states the fault flatly and blames nobody: the check digit either closes
  // or it does not, so "parece ter" hedged a certainty, and "erro de digitação"
  // was false for the half of these that came off a scanner. It carries no
  // "verifique e tente novamente" either: a red toast and the error buzz
  // already say it is an error, and the tail only made it longer to read.
  const MSG_DIGITACAO = 'A chave informada não é válida.';

  // IBGE state codes, and the table is LOAD-BEARING: UF_INEXISTENTE refuses
  // anything absent from it as corrupted input, so an omission here would refuse
  // a real note as a typo. All 26 states plus DF. NAO_PR therefore always finds
  // a sigla and needs no fallback wording; the raw number is never shown.
  const ESTADOS = {
    11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
    21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA',
    31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP',
    41: 'PR', 42: 'SC', 43: 'RS',
    50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF'
  };

  // Read by origemEstado below, which registrador.js uses to say the same
  // "another state" thing about a FIXED PART. The alternative was a second
  // copy of the table above, which is the one thing a load-bearing table must
  // never have — and the copy it had was frozen at 'SP'.
  function siglaEstado(uf) {
    return ESTADOS[Number(uf)];
  }

  // The state's NAME, with the contraction Portuguese puts in front of it —
  // "de São Paulo", "do Pará", "da Bahia" — because a volunteer holding the
  // receipt knows where the shop was, not what AP stands for. Keyed by sigla so
  // ESTADOS stays the one table that decides which codes exist.
  const ORIGEM_ESTADO = {
    RO: 'de Rondônia', AC: 'do Acre', AM: 'do Amazonas', RR: 'de Roraima',
    PA: 'do Pará', AP: 'do Amapá', TO: 'do Tocantins', MA: 'do Maranhão',
    PI: 'do Piauí', CE: 'do Ceará', RN: 'do Rio Grande do Norte', PB: 'da Paraíba',
    PE: 'de Pernambuco', AL: 'de Alagoas', SE: 'de Sergipe', BA: 'da Bahia',
    MG: 'de Minas Gerais', ES: 'do Espírito Santo', RJ: 'do Rio de Janeiro',
    SP: 'de São Paulo', PR: 'do Paraná', SC: 'de Santa Catarina',
    RS: 'do Rio Grande do Sul', MS: 'de Mato Grosso do Sul', MT: 'de Mato Grosso',
    GO: 'de Goiás', DF: 'do Distrito Federal'
  };

  /** "de São Paulo" for 35 — published for registrador.js's fixed part
   * sentence. */
  function origemEstado(uf) {
    return ORIGEM_ESTADO[siglaEstado(uf)];
  }

  // Month names for the deadline sentence. "08/2026" is a code the volunteer
  // has to decode; "agosto de 2026" is read at a glance.
  const MESES = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
  ];
  const mesPorExtenso = (d) => MESES[d.mes - 1] + ' de ' + d.ano;

  // The two document models this page accepts, and the only place that SET is
  // written. Both answer 200 at the POST; anything else comes back `Tipo de
  // documento inválido`, which TIPO_DOCUMENTO pre-empts.
  //
  // AN NF-e CAN BE DONATED LIKE AN NFC-e (settled 2026-10-07). It was an open
  // question for a while, and 55 was greyed for a few hours on 2026-09-28
  // before being accepted again. Do not re-grey it from a summary.
  //
  // THE MODEL IS NOT A SECOND LAYOUT. The NF-e and the NFC-e share every span
  // of the key and the check digit; the model changes exactly one answer in
  // REGRAS — whether the paper can be donated here at all. Anything else
  // growing a `modelo === '65'` test is a mistake until proven otherwise.
  //
  // NOTHING READS THE SÉRIE. EMITENTE_CPF (grey on série 920–979, a CPF issuer,
  // except under the NFF) was removed on 2026-09-28 and stays removed by the
  // maintainer's call: a CPF can only issue an NF-e (MOC rejection 337), and
  // an NF-e is accepted. A produtor rural's NF-e therefore goes out green
  // like any other. Do NOT add a red "impossible
  // série on a 65" either: a single misread already fails the check digit.
  const MODELOS_ACEITOS = ['55', '65'];

  // The models TIPO_DOCUMENTO refuses, carrying their own article so its
  // sentence reads as Portuguese for every one of them. 55 and 65 are absent on
  // purpose: an accepted model can never reach that sentence, and a name here
  // would read as "this one is refused".
  // The plain-language gloss after each acronym is for the volunteer who has
  // never heard of a CT-e and would otherwise read the sentence as "this is
  // some kind of note, so why not?".
  const TIPOS_DOCUMENTO = {
    57: 'um CT-e (conhecimento de transporte)',
    58: 'um MDF-e (manifesto de carga)',
    59: 'um CF-e SAT',
    66: 'uma NF3e (conta de energia)',
    67: 'um CT-e OS (conhecimento de transporte)'
  };

  /**
   * Is the issuer document in [6:20] invalid — neither a CNPJ nor a
   * zero-padded CPF?
   *
   * A CPF issuer is VALID here, and whether such a note can be donated is a
   * separate question (see MODELOS_ACEITOS). The temptation is to shortcut:
   * if it may be ineligible anyway, why not fail it in this function and be
   * done?
   *
   * Because the two answer different questions. THIS check is a corruption
   * detector — a second checksum on top of the key's own CDV, whose failure is
   * evidence that what arrived is not what was printed, which is why it is red
   * and why its message tells the volunteer to check the key. Ineligibility is a fact
   * about a note that was read PERFECTLY, and it is grey. Merging them would
   * tell a volunteer holding a valid produtor-rural receipt that they mistyped
   * it, and they would read it again, get the same answer, and bin it.
   *
   * It does NOT ask the série which document to expect. See the note above
   * MODELOS_ACEITOS for why nothing reads the série any more.
   */
  function documentoEmitenteInvalido(a) {
    if (a.documentoEmitente === null) return false; // a fixed part left the issuer open
    const cpf = /^000\d{11}$/.test(a.documentoEmitente) && NFPR.Cnpj.validarCpf(a.documentoEmitente.slice(3));
    return !cpf && !NFPR.Cnpj.validar(a.documentoEmitente);
  }

  // ---- Month arithmetic -----------------------------------------------------
  // Always in absolute months, never on `mes` directly: emission 12/2025 is
  // valid until 02/2026, not 14/2025, and `mes + 2` is wrong for a sixth of
  // all notes.
  const absoluto = (d) => d.ano * 12 + (d.mes - 1);

  /** { ano, mes } + n months, mes staying in 1..12. */
  function somarMeses(d, n) {
    const t = absoluto(d) + n;
    return { ano: Math.floor(t / 12), mes: (t % 12) + 1 };
  }

  /**
   * The range of emission months this input allows.
   *
   *   aa and mm known  ->  a single month
   *   aa only          ->  that whole year (a fixed part may fix the year and
   *                        leave the month free)
   *   no aa            ->  null; a month without a year means nothing
   *
   * For a complete key min and max are the same month, so the two date checks
   * below are the exact per-note check with no second implementation.
   */
  function faixaEmissao(a) {
    if (a.aa === null) return null;
    const ano = 2000 + Number(a.aa); // '00' is the year 2000, long expired
    if (a.mm === null) return { min: { ano, mes: 1 }, max: { ano, mes: 12 } };
    const mes = Number(a.mm);
    return { min: { ano, mes }, max: { ano, mes } };
  }

  // ---------------------------------------------------------------------------
  // THE CHECKS, AS DATA
  // ---------------------------------------------------------------------------
  /**
   * Every check this module makes, in priority order. The first entry that
   * fires is the verdict, so ORDER IS PRIORITY — and every red comes before
   * every grey, because a grey verdict states a fact about a note, and
   * asserting one while the digits may be corrupt describes a note nobody
   * scanned.
   *
   * Each entry:
   *   codigo     the testable contract; stable, and what callers branch on
   *   gravidade  'entrada'    red — the input is wrong, read the paper again
   *              'inelegivel' grey — a real note the programme will not take
   *              NOT 'erro': the UI uses estado:'erro' for a SEND failure,
   *              which arrives from the network and means something else
   *              entirely. Two categories, two names.
   *   escopo     'chave' for the three that a fixed part TEMPLATE cannot
   *              answer: a template is not all digits by definition, and its
   *              check digit is unknowable unless every span is fixed. Absent
   *              everywhere else, which means "judge a key and a template
   *   alike". campos     the spans that must be KNOWN for the check to mean
   *              anything. The runner skips the entry when any of them is null,
   *              which is analisarChave's '?'-means-unknown rule DECLARED
   *              rather than re-implemented as a guard inside every test. A
   *              fixed part template therefore judges itself through this same
   *              table, with no second code path.
   *   relogio    true when the test reads `agora`. The runner skips such an
   *              entry when no clock was given, so a clock-free caller cannot
   *              accidentally receive a time-dependent verdict.
   *   testar     (ctx) -> truthy when the check FAILS. ctx is
   *              { chave, texto, analise, agora } — `chave` only for a whole
   *              key, `texto` the 44 characters judged either way — and
   *              `campos` guarantees the spans it names are non-null, so tests
   *              carry no null handling.
   *   mensagem   a string, or (ctx) -> string where the sentence quotes the key
   *
   * WHY A TABLE. The old shape was two functions, and which one a check lived
   * in used to decide whether an active fixed part could fabricate a key over
   * it — so adding a check meant re-deriving that argument instead of answering
   * the only question that matters: what does this mean to the volunteer? Phase
   * 1 removed the coupling (see parte-fixa.js); this removes the shape it left
   * behind. Adding a check is now one entry, and its colour is the whole
   * decision.
   *
   * There are exactly two ways in — avaliar and avaliarTemplate — and they
   * differ by one boolean. Nothing selects a subset of these checks by any
   * other means, which is the property the old two-function shape could not
   * offer and the reason a rule change is now a row rather than an argument.
   */
  const REGRAS = [
    {
      codigo: 'COMPRIMENTO',
      gravidade: 'entrada',
      escopo: 'chave',
      testar: (c) => typeof c.chave !== 'string' || c.chave.length !== 44,
      // Short, because it lives in a toast that is gone in seconds. It used to
      // state the count it got ("esta tem 38"), and a sentence long enough to
      // carry that was too long to read before it vanished; the cells above
      // already show how many were entered. "Caracteres", not "números", since
      // a key may carry letters in the issuer span.
      mensagem: 'A chave de acesso precisa ter 44 caracteres.'
    },
    // A LETTER IS ONLY EVER THE ISSUER'S — six digits, twelve alphanumeric,
    // then twenty-six digits (RE_CHAVE, at the top). A letter anywhere else is
    // corrupted input, which is precisely what red is for, so this stayed a
    // POSITIONAL test rather than relaxing to "44 alphanumeric characters":
    // that would wave through a letter in the série or the invoice number, and
    // no note can carry one there. Being stricter than the spec is the danger
    // this codebase watches for, and it does not apply — which twelve
    // characters are alphanumeric is written down, not inferred.
    //
    // ITS OWN SENTENCE WENT WITH THE CHANGE. "A chave deve conter apenas
    // números" was verifiable against the cell display, which is the whole
    // reason it was allowed to name its own check; its true replacement is not,
    // because nothing on screen says where the issuer's fourteen characters
    // begin and nobody should have to learn. So it joins the codes that share
    // one instruction — read the paper again — while staying its own code.
    {
      codigo: 'FORMATO',
      gravidade: 'entrada',
      escopo: 'chave',
      testar: (c) => !RE_CHAVE.test(c.chave),
      mensagem: MSG_DIGITACAO
    },
    {
      codigo: 'DIGITO_VERIFICADOR',
      gravidade: 'entrada',
      escopo: 'chave',
      testar: (c) => calcularCDV(c.chave) !== c.chave[43],
      mensagem: MSG_DIGITACAO
    },
    // A LETTER OUTSIDE 6..17, judged as soon as it is there. FORMATO says the
    // same thing about a whole key and is `escopo: 'chave'`, so a partial key
    // (the live verdict) and a fixed part template never reach it; this is
    // FORMATO's positional half for them. It reads the TEXT rather than a span,
    // so it answers at the character itself — a letter in the série is red at
    // digit 23, not silent until Enter because nothing reads the série — and
    // the '?' of a template or of a key still being typed is not a letter.
    //
    // It replaced three span-by-span checks (a letter in the year, month or
    // model), which spoke only once the span was whole, and only for the three
    // spans a rule happened to read. Without it `Number('2A')` is NaN, every
    // comparison is false, and a letter in the model fell through to
    // TIPO_DOCUMENTO and was GREY — "não pode ser doada" about a typo.
    //
    // Above DOCUMENTO_EMITENTE, so a letter in the CNPJ's own check digits
    // [18:20] reads as out of place rather than as a broken checksum; above
    // UF_INEXISTENTE, so a fixed part gets the sentence that names the letter.
    // A whole key never gets here with one: FORMATO refused it first.
    {
      codigo: 'LETRA_FORA_DO_LUGAR',
      gravidade: 'entrada',
      testar: (c) => letraForaDoLugar(c.texto),
      mensagem: MSG_DIGITACAO
    },
    // A SECOND checksum, immediately after the key's own, and that is exactly
    // why it is red: the embedded CNPJ (or CPF) carries two more check digits,
    // taking a random 44-digit slice from roughly one in eleven past the CDV to
    // roughly one in 1100 past both.
    {
      codigo: 'DOCUMENTO_EMITENTE',
      gravidade: 'entrada',
      campos: ['documentoEmitente'],
      testar: (c) => documentoEmitenteInvalido(c.analise),
      mensagem: MSG_DIGITACAO
    },
    // A cUF outside the IBGE table is a state that does not exist, which makes
    // it corrupted input rather than a note from somewhere else. ESTADOS is
    // therefore load-bearing and must stay complete: an omission here refuses a
    // real note as a typo. It currently lists all 26 states plus DF.
    {
      codigo: 'UF_INEXISTENTE',
      gravidade: 'entrada',
      campos: ['uf'],
      testar: (c) => !ESTADOS[Number(c.analise.uf)],
      mensagem: MSG_DIGITACAO
    },
    // Every span below is all digits by the time it is asked: FORMATO refused
    // a whole key with a letter out of place, and LETRA_FORA_DO_LUGAR a
    // partial key or a template with one.
    {
      codigo: 'MES_INVALIDO',
      gravidade: 'entrada',
      campos: ['mm'],
      testar: (c) => Number(c.analise.mm) < 1 || Number(c.analise.mm) > 12,
      mensagem: MSG_DIGITACAO
    },
    // Red AND clock-dependent — a note dated in the future cannot exist. Under
    // the old split that combination needed a paragraph of apology: the
    // clock-free half of the checks had to stay clock-free, while this verdict
    // had to be red. Here it is two fields and no argument.
    {
      codigo: 'FUTURA',
      gravidade: 'entrada',
      campos: ['aa'],
      relogio: true,
      testar: (c) => absoluto(faixaEmissao(c.analise).min) > absoluto(c.agora),
      mensagem: MSG_DIGITACAO
    },
    {
      codigo: 'NAO_PR',
      gravidade: 'inelegivel',
      campos: ['uf'],
      // UF_INEXISTENTE has already refused anything outside ESTADOS, so the
      // lookup below always finds a sigla and there is no vaguer fallback.
      testar: (c) => c.analise.uf !== '41',
      mensagem: (c) =>
        'Nota ' + origemEstado(c.analise.uf) +
        ' — o Nota Paraná só aceita notas do Paraná.'
    },
    // Grey, because a CT-e is a real document — just not one this page takes.
    // The sentence names BOTH accepted documents, by their acronyms: NF-e and
    // NFC-e are the actual names. NEVER "cupom fiscal" for either — people say
    // it informally about both (and about other papers), officially it is
    // neither, and it names the obsolete document these two replaced, so it
    // cannot tell a 55 from a 65 and must not be used as if it could.
    {
      codigo: 'TIPO_DOCUMENTO',
      gravidade: 'inelegivel',
      campos: ['modelo'],
      testar: (c) => MODELOS_ACEITOS.indexOf(c.analise.modelo) === -1,
      mensagem: (c) => {
        const nome = TIPOS_DOCUMENTO[Number(c.analise.modelo)];
        return nome
          ? 'Esta chave é de ' + nome + '. Só NF-e e NFC-e podem ser doadas.'
          : 'Esta chave não é de uma NF-e nem de uma NFC-e, as únicas que podem ser doadas.';
      }
    },
    // THE +2 IS LAW: Decreto 8.249/2017, art. 12 (wording by Decreto
    // 5.999/2020, in force since 26.10.2020) — "até o último dia do segundo mês
    // subsequente ao da emissão". It was first found by observing the server,
    // while the site's donation FAQ still says "mês subsequente"; the FAQ is out
    // of date, not the engine generous.
    //
    // Facts only: the sentence names the last month and nothing else. No day
    // is shown — the key has none. `max` is the emission month itself for any
    // complete key. TWO callers widen it to a whole year, and the sentence has
    // to hold for both: a fixed part with a free month (registrador.js words
    // that case itself), and the LIVE VERDICT after four digits, before the
    // month is typed. There it used to name December — "Nota de dezembro de
    // 2024" for any 2024 note — so the whole-year case names the year and no
    // month, since every month of it is past its deadline or this would not
    // have fired.
    {
      codigo: 'EXPIRADA',
      gravidade: 'inelegivel',
      campos: ['aa'],
      relogio: true,
      testar: (c) => absoluto(c.agora) > absoluto(faixaEmissao(c.analise).max) + 2,
      mensagem: (c) => {
        const max = faixaEmissao(c.analise).max;
        if (c.analise.mm === null) {
          return 'Nota de ' + max.ano + ' — o prazo para doá-la já passou.';
        }
        // "foi até outubro", not "terminou em outubro": October is the LAST
        // month a note from August can be donated, and "terminou em" reads as
        // though it closed at some point during it.
        return 'Nota de ' + mesPorExtenso(max) +
          ' — o prazo para doá-la foi até ' + mesPorExtenso(somarMeses(max, 2)) + '.';
      }
    }
  ];

  /**
   * Run the table in order and return the first problem as
   * { codigo, gravidade, mensagem } — or null when nothing fired.
   *
   * Three skip rules are the whole runner, and each removes a class of guard
   * that used to be copied into every check:
   *
   *   escopo    a template cannot answer length, format or check digit
   *   relogio   no clock supplied means no time-dependent verdict, ever
   *   campos    a span a '?' made unknowable cannot be judged
   */
  function aplicarRegras(ctx, ehChave) {
    for (const r of REGRAS) {
      if (r.escopo === 'chave' && !ehChave) continue;
      if (r.relogio && !ctx.agora) continue;
      if (r.campos && (!ctx.analise || r.campos.some((campo) => ctx.analise[campo] === null))) {
        continue;
      }
      if (!r.testar(ctx)) continue;
      return {
        codigo: r.codigo,
        gravidade: r.gravidade,
        mensagem: typeof r.mensagem === 'function' ? r.mensagem(ctx) : r.mensagem
      };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // THE API
  // ---------------------------------------------------------------------------

  const veredito = (problema, chave) => {
    if (problema) {
      return {
        ok: false,
        codigo: problema.codigo,
        mensagem: problema.mensagem,
        gravidade: problema.gravidade
      };
    }
    const bom = { ok: true, codigo: 'OK', gravidade: null };
    if (chave !== null) bom.chave = chave;
    return bom;
  };

  /**
   * The whole verdict on one key. Returns:
   *
   *   { ok: true,  codigo: 'OK', chave, gravidade: null }
   *   { ok: false, codigo: 'EXPIRADA', mensagem, gravidade: 'inelegivel' }
   *
   * `gravidade` is null rather than absent on the OK path, so both branches
   * fall through on ===. 'entrada' is red — read the paper again. 'inelegivel' is
   * grey — a real note the programme will not take.
   *
   * `agora` is injected — { ano, mes } from NFPR.Relogio.mesCorrente(). This
   * module never reads a clock itself; that is what keeps it testable against
   * a fixed date.
   */
  function avaliar(chave, agora) {
    return veredito(
      aplicarRegras({ chave, texto: chave, analise: analisarChave(chave), agora }, true),
      chave
    );
  }

  /**
   * The same verdict, for a fixed part TEMPLATE rather than a key. Pass 44
   * characters of digits and '?' — ParteFixa.completar(t) — because a template
   * being typed is shorter than 44 almost the whole time and analisarChave
   * returns null for those, which would hide the verdict until the last
   * character.
   *
   * The 'chave' entries are skipped: a template is not all digits by definition,
   * and its check digit is unknowable unless every span is fixed. Everything
   * else judges itself through the same table, because `campos` already knows
   * how to skip what a '?' makes unknowable.
   *
   * chave.js stays free of fixed part logic on purpose — completar lives in
   * parte-fixa.js, which loads after this file.
   */
  function avaliarTemplate(template, agora) {
    return veredito(
      aplicarRegras({ chave: null, texto: template, analise: analisarChave(template), agora }, false),
      null
    );
  }

  // Exports only what another module actually calls: the registrars call
  // avaliar, the fixed part strip and the stale-fixed-part bar call
  // avaliarTemplate, and parte-fixa.js reads extrairChave alone — it judges
  // nothing, by design. somarMeses is published for the
  // same reason it exists here — it is the ONLY month arithmetic in the
  // codebase, and registrador.js prints the same "+ 2 months" deadline on its
  // rows. A second copy reaching for `mes + 2` would be wrong for a sixth of
  // all notes. `origemEstado` is there for exactly the same reason, one table
  // over: registrador.js names the state a fixed part describes, and the copy
  // it used to keep said 'SP' whatever the digits were. REGRAS itself and the
  // two lookup tables stay internal — publishing them would read as "someone
  // depends on this" and freeze their shape for no reason, and the table is
  // the thing phases 3–4 reshape.
  // `posicaoAlfanumerica` is published for the same reason origemEstado and
  // somarMeses are: it is a fact about the key layout that another file has to
  // act on, and the alternative is a second copy of the window. capture.js asks
  // it whether a letter arriving now can belong to a key at all, and
  // registrador.js asks it about a fixed part's fixed characters. A copy of `6`
  // and `18` in either place is a copy that will be wrong the day the layout
  // moves. `chaveParcial` is the registrar's display path and nothing else's.
  NFPR.Chave = {
    calcularCDV,
    extrairChave,
    chaveParcial,
    analisarChave,
    posicaoAlfanumerica,
    avaliar,
    avaliarTemplate,
    origemEstado,
    somarMeses
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
