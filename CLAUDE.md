# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A Manifest V3 browser extension (Chrome/Edge/Brave 109+ and Firefox 115+) that turns the
Nota Paraná **manual donation** page into a fast, layman-friendly workspace for
registering the 44-digit access keys (*chaves de acesso*) of NFC-e (modelo 65)
and NF-e (modelo 55) — typed or read with a handheld barcode/QR scanner.

Target pages:

- `https://notaparana.pr.gov.br/nfprweb/DoacaoDocumentoFiscalCadastrar*` — the registrar
- `https://notaparana.pr.gov.br/nfprweb/ContaCorrente*` — duplicate-session bounce-back

The users are **non-technical volunteers**. Every user-visible string is
Brazilian Portuguese, plain language, no jargon.

`DOCS.md` is the single product document: what runs, the observed Nota Paraná
protocol, the manual test checklist (the only test suite), edge cases and known
gaps. Consult it before changing behaviour. `TODO.md` lists things that were
specified once and never built — do not treat them as existing.

`README.md` is none of that. It is the short **Portuguese** front page for
people arriving at the repository — what the extension is, how to install it,
where everything else lives — and `PRIVACIDADE.md` is the privacy statement
the store listings link to. Keep engineering detail out of both. When a change
alters what is stored, what is requested or which permissions are asked for,
`PRIVACIDADE.md` changes with it.

The load-bearing decisions below are the authoritative copy; `DOCS.md` points
here rather than repeating them. Two copies of a rule is how this repository
ended up with two large documents that disagreed with each other and the code.

## Build & run

**There is no build step, no bundler, no package.json, no test runner.** Plain
classic scripts loaded in the order declared in `manifest.json`.

- Chrome/Edge/Brave: `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
- Firefox: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → `manifest.json`.

Verification is manual: reload the unpacked extension, open the donation page,
and exercise the flow — the checklist in `DOCS.md` is the test suite.

One optional, dependency-free check exists: `node tools/smoke.js` loads every
module in manifest order against stubbed browser globals, builds the UI and the
settings form, and asserts the pure logic (CDV, key extraction, the field
parser, every verdict against a fixed date, the two accepted models and that no
série or tpEmis is judged, fixed part arithmetic,
CNPJ/CPF, and that debug mode ships inert). It also drives real keystrokes
through `Registrador` and checks each verdict reaches the right branch — red
toast and nothing queued, grey row and nothing queued, or queued with the target
CNPJ frozen. It also drives `Despacho` directly — width, FIFO order, pause/`esvaziar`, and
that a rejected send still frees its slot — and puts a thousand notes through the
panel to check that every scan gets its row, that the list stays bounded, that
the queue indicator never creates one, and — the one that pins a bug this
codebase shipped for months — that a note whose ROW was evicted while it was
still in flight still records its failure, with its digits, once — driven through
`content.js` itself, for both of the paths that write `nfpr:falhas`. It checks where the registrar's HEADER STRIP ends up — inside the government
`#header`, ahead of the site's own user block, in its bar form and no longer a
child of the panel, or still on the panel when there is no `#header` to merge
into — because both halves of that are silent when wrong: a strip that never
reached the bar is simply absent, and one that reached it while also staying on
the panel draws the entity chip twice. It checks one piece of modal
STRUCTURE too: that Config and Depuração each mount their form in an inner box
— the form's sections inside that box, nothing of it on the page itself —
rather than onto the `.nfpr-view` element, because `.nfpr-settings` and
`.nfpr-view` both declare `display` at equal specificity and whichever
stylesheet loads last would otherwise decide whether a page can be closed.
It checks the UI's public API against **what its callers actually call** — the
list is read out of `registrador.js`, `content.js`, `entrada.js` and
`modal-entidade.js` rather than written by hand, because the hand-written one
was short two methods registrador.js calls on every config change.
It follows THE KEYBOARD: the stub's `focus()` records and the stub document
reports it as `activeElement`, so it can assert that opening settings takes
the keyboard off the chip, that Tab wraps inside the overlay at both ends (with
a radio group as one stop), that every page switch and the two-step clear put
the keyboard somewhere, that the entity list keeps it through its own repaint,
that the strip hidden or closed under the keyboard hands it to the entry — and
never while the overlay is up — and that the strip's two outside-click
listeners split a closed shadow root's clicks correctly. A final check fails if
`aria-` or a `role` appears anywhere in `src/`, in any spelling —
`setAttribute('role', …)` and a quoted `'role':` key included — and the
pattern is itself tested against each spelling.
It reads the load-bearing DECLARATIONS as declarations, parsed by selector
subject rather than grepped: it runs `host-page.js` and checks the CSS it hands
the page has no `overflow` on `#header` and no `display` on
`.user-config-options` (a descendant's overflow, or `text-overflow`, is not a
hit, and the parser is tested against the breakages it exists to catch); finds
every element the code writes a pixel height to and checks its own rule declares
`box-sizing: border-box`; checks the closed overlay is `visibility: hidden`;
that `painel.js` reads the published footer height and never writes the number;
and that `entrada.html` never loads `donation.js`.
It drives the STRIP too — the fixed part editor's strictness where a volunteer
meets it (no variable digits and no fixed digits are both refused), that
Cancelar and Escape put the armed fixed part's cells back and write nothing, the
two-tier store (a saved fixed part surviving ten newer unsaved ones, an edit
pushing the old text into the recents, *Limpar as não salvas* leaving the saved
ones alone), the LIST — that last use is the whole order, so a saved fixed part
does not outrank a recent one; that the filter is absent at
`StripParteFixa.LIMITE_SEM_FILTRO` and present past it, naming the count; that
it matches an accented name without its accents and matches digits spaced or
not; that a search matching nothing still leaves "Chave inteira" pinned; and
that focusing it stands capture down and releasing it does not, without which
every Backspace typed there is eaten by the key buffer — and the LIVE VERDICT at
digits 2 / 4 / 6 / 20 / 22 / 35 with the right colour (a letter at any index
outside 6–17 red at the letter itself, a whole expired year named without a month), never on a prefix of a good
key, silent during a burst, and speaking again the moment a person types into a
scanned buffer. That last one needs the `performance.now()` stub to be MOVABLE:
it used to return 0, so every synthetic keystroke gap was 0 ms and capture read
the whole file as one machine burst — which also hid the rule that a burst
discards a human's leftovers. Left at 0 it behaves exactly as it always did;
tests that care advance it themselves.
It drives `Donation.doar` and `Donation.sondarSaude` against stubbed responses
too: which answers are retryable, that the health probe reads every failure mode
as "confused" except a dead login, which it reports, that the probe key is structurally sound and our own checks call
it red, and — invisible in the source, so easy to break by tidying — that a 500
carrying a readable body is judged by the BODY, and that one donation is one
fresh token followed by one POST, in that order. It pins the send pipeline's
false conditions and hangs: a request that merely failed is never a dead
session, the duplicate-session page is read in the windows-1252 it is written
in, a JSON `null` body is the shrug rather than a crash, the registry's real
"no such entity" (a 204, empty) is "not registered" while a 200 that holds no
entity is unavailable, and a body that
never finishes is given up on — with timers compressed a thousandfold and each
wait raced, so a hang fails instead of hanging the script. A last checkpoint
drains four orchestrator worlds for the same bugs as sequences: a login lost
under the server latch, the redirect reaching notes held by the watchdog and a
retry timer, the latch after `/sair`, and a failed storage write settling a
note once.
It puts a READING'S TAIL behind a scan — six Tabs, CR and LF with a Tab, a
scanner too slow for the heuristic, a key that left by auto-send, a QR code
holding no key — and asserts one key out and no terminator reaching the
browser; then the half 1.0.1 broke: that a Tab pressed by hand, Enter on the
button it lands on, Shift+Tab and a held Tab are all left alone, and that a
bare tail lets exactly its first terminator through.
It leaves the keyboard on the bare page and asserts a click, and the window
coming back, each hand it to the entry — and that a click onto a control, one
ending a text selection, and one made with the settings overlay open do not.
It gives one registrar a storage that fires `onChanged` and checks that a
write which leaves the entry's meaning alone (the registry's name, a
preference) keeps a half-typed key, while an entity or fixed part change
empties it; that every bar and strip control hiding under the keyboard hands
it to the entry, and a bar hiding while it is elsewhere takes nothing; that
Enter twice on the entity form asks and saves once; that a scan corrected by
hand is the key sent — cells and live verdict included, and never composed
with a fixed part; and that a paste overflowing a fixed part is judged alone.
It pins WHICH CUE PLAYS at capture time — read-cue for a clean read, `aviso`
for a fixed part override — because a wrong branch there is silent in every
other assertion. And it drives a second registrar with `enviarSemValidar` on,
which is the half that had no coverage at all: that red and grey both reach the
queue instead of being refused, that `aviso` fires rather than `erro`, that a
clean key under the same preference stays unmarked, and that `nfpr:fila` freezes
the reading on exactly the notes that bypassed a gate — the field `processar`
needs to skip its re-judge, without which the whole batch is destroyed on the
next load. It checks that every classified answer carries `fonte: 'nfprweb'`
whichever door it came in by, and that a simulated one does not. It pins that
`chave de acesso inválida` is recognised and terminal on a numeric key and on
one carrying letters alike.
It puts a SHORT BURST under a fixed part — a 20-digit store barcode — and
asserts it is red and never composed, sampling 2000 of them against the old
rule to show that rule really fabricated valid keys. It scans twice with no
Enter between, both as plain barcodes and as QR codes (the latter in the async
block, because only the idle timer firing between them makes the case real),
and asserts the SECOND key is what goes out — and, as the guard on that guard,
that a QR scan stalling inside its own tail, an off-line one's hex digest
included, still keeps its key. Registrar keystrokes meant as TYPING carry a
human gap (`DIGITANDO`): at 0 ms they are a confirmed burst, which is a scan.
It drives the ALPHANUMERIC CNPJ from the keyboard to the check digit: Receita's
own published vector (`12.ABC.345/01DE-35` — if that line fails the ASCII-48
mapping is wrong and nothing else matters), that letters actually reach the
key's own check digit rather than being skipped, both ends of the `[6:18]`
window from one valid issuer and a letter one character outside it either way,
that a CPF-band issuer still refuses one, that upper-casing a whole QR URL
manufactures no false 44-run, and the two the live reports produced: that
letters rattled off at 25 ms do NOT turn the buffer into a scan — four fast
gaps is the threshold, and a burst discards everything typed before it, so this
used to empty an entry of correct digits — while a run of digits at the same
speed still is one; and that a scan fired ON TOP of a partly typed entry
submits the scanned key alone, which is the case a positional gate could not
survive, the caret being inside the very window it was testing.
It pins the CHECK-DIGIT HINT as the deliberate exception it is: the entry box
goes red with every variable digit in and the check digit wrong, never with
`autoEnviar` on, and the next change takes it off (the stub's `classList` is
inert, so the entry box gets a recording one). It runs the BACKGROUND SCRIPT in
a context of its own and checks that a stopped load stays put in both browsers
— Firefox's arrives as `"Error code 2152398850"`, the nsresult in decimal —
while a real failure still goes to the offline page; and that the panel's
height is scheduled and bound by `ui.js` alone.

**It drives `content.js` itself**, in a second `vm` context of its own — the
orchestrator is excluded from the shared one because it starts doing real work
the moment it loads, and that real work IS the drain. Seed `nfpr:config` and
`nfpr:fila` into a fresh world, load the full graph including `content.js`, and
the restore loop drives `processar` over every seeded note. A bypassed red note
must be POSTed, an ineligible one must not, an ordinary one must go out as
always, and one only the CLOCK calls expired must go out for the server to
judge. Further worlds of the same kind drain under a machine clock set a month
back and four months forward, and under `simularEnvio`, and assert that nothing
is destroyed without being sent — which needs the 200 ms window waited out, and
the row messages read at `UI.montar`'s door, since the stub's text nodes keep
no text. Two things about it are easy to get wrong and both make the checkpoint
pass while testing nothing: the fixture entity needs **`verificada: true`**, or
the pre-drain re-verification latches it as refused and nothing sends at all;
and `Config.removerDaFila` coalesces over 200 ms, so the assertions read the
REQUESTS made rather than what is left in `nfpr:fila`.
One more world per rule pins what the orchestrator was said to do and was never
seen doing: a dead session PAUSES the pool (read off the pool itself, since
`enfileirar`'s latch check alone would stop the sends); a retry timer firing
under the server latch is parked and counted on the bar, never left in the
paused pool; `Procedimento inválido` asks the probe before spending its budget;
a drain plays no success chime while a scan beside it does; and an unexplained
answer and an unclassified exception each reach `nfpr:falhas` exactly once,
and a note with no input time is recorded with none. A server grey blocks the
key with its reason, so a rescan repeats it. The queue itself holds a key once,
first entry winning, and its write says whether it added one. A world that leaves a
latch closed probes for ever, so `orquestrar` keeps every timer it arms and its
`desligar` ends them — without it the script passes and never exits.
Run it after touching load order, `chave.js`, `parte-fixa.js`,
`cnpj.js`, `relogio.js`, `debug.js`, `despacho.js`, `donation.js`, `modal.js`,
`audio.js`, `capture.js`, `host-page.js`, `strip-parte-fixa.js`, `ui.js`,
`content.js`, `config.js`, `painel.js`, `entrada.html`, `service-worker.js`,
any stylesheet, or anything either registrar builds.
`--verbose` names every assertion as it passes; use it to check whether a case
is already covered before adding one. It covers no network and no real DOM. It
covers TIMING only through a movable `performance.now()` stub — enough for the
35 ms scanner heuristic and the 250 ms idle, nothing else — and is not part of
the extension.

There is also `tools/preview.html`, which is not a test: it stubs
`chrome.storage.local` and `chrome.runtime.getURL` and then loads the offline
page's own module graph, unchanged, so the registrar can be LOOKED AT in a plain
browser with no extension installed. Use it for the things smoke.js cannot see —
where the 44 cells wrap at a narrow width, the strip, the fixed part popover, a
condition bar's wording. It has to be served over http (`python -m
http.server 8000` from the root): under `file://` the stylesheet fetches in
`ui.js` are refused as CORS, so it mounts nothing there and says so. Like smoke.js it ships with nothing.

**Debug mode ships.** `debug.js` and `debug-ui.js` are part of the extension
like every other module, hidden behind the 7-click gesture. There is no
release build without them. `smoke.js` expects both and asserts that debug
mode is inert until armed.

> There is deliberately **one** manifest for both browsers: `background`
> declares `service_worker` (Chrome ≥121, which ignores `scripts`) **and**
> `scripts` (Firefox event page — Firefox does not run MV3 service workers).
> Do not split into a `manifest.firefox.json`; see the header comment in
> `src/background/service-worker.js` for the rationale.
>
> **The dual key is for loading this folder, not for the stores** — the Chrome
> Web Store refuses `scripts`, and Firefox refuses an MV3 manifest with only
> `service_worker`. `node tools/empacotar.js` writes one zip per store into
> `dist/` (git-ignored), dropping the foreign key (and, for Chrome,
> `browser_specific_settings`) and copying everything else unchanged. It is a
> packaging step, **not a build step**: development and testing must keep
> working from the unpacked folder as if it did not exist. The list of
> per-browser differences lives in that script and nowhere else.

## Architecture

Everything hangs off one namespace, `NFPR`, assembled by load order:

```
src/shared/    used by content scripts, the popup, AND the offline page
  browser.js       cross-browser api shim + creates NFPR  (MUST load first)
  debug.js         MODO DE DEPURAÇÃO — every deliberate bypass, in one file
  site.js          every Nota Paraná URL and matched sentence, in one place
  dom.js           NFPR.el — the only DOM builder — brand mark, key grouping
  cnpj.js          CNPJ (and CPF) check-digit validation / format / TWO strips
  chave.js         pure key logic: CDV, extraction, parsing, validation
  relogio.js       the current month in America/Sao_Paulo — the only clock
  parte-fixa.js    pure fixed-part logic: normalise, pad, count, compose, resolve
  config.js        storage schema, defaults, both durable records, change events
  entidade.js      registry lookup + THE one entity-save path
  connectivity.js  reachability probe + outage watchdog (both surfaces)
  registrador.js   the bootstrap both registrars share — AND every fixed part:
                   judgement, naming, and the live verdict while typing
  sec-entidades.js / sec-preferencias.js   settings sections
  settings-ui.js   composes the two, owns the storage subscription
  tokens.css       design tokens, declared once
  settings.css
src/content/   injected only on Nota Paraná pages
  host-page.js     the only file that touches the government document (no deps):
                   anti-flash, the merged 54px header bar, the 35px footer
  audio.js         Web Audio cues
  capture.js       document-level capture-phase keystroke engine
  donation.js      token fetch + POST, friendly error normalisation
  despacho.js      the bounded send pool: FIFO, `largura` in flight, pausable
  sessao.js        duplicate-session detection + /sair (protocol, not view)
  strip-parte-fixa.js the strip under the 44 cells: what the next note will be
                   read as, the fixed part editor, the saved/recent list
  painel.js        the registrar panel: queue indicator + outcome list
  debug-ui.js      the 7-click gesture + the debug flags form
  modal.js         the settings / ajuda / notas-não-registradas / depuração overlay
  ui.js            composes painel + modal, owns the shadow roots and mounting
  modal-entidade.js  scrape CNPJs from the site's own search dialog
  conta-corrente.js  duplicate-session screen → back to donating
  content.js       orchestrator: the send pipeline
  base.css / registrar.css / modal.css
src/offline/   bundled offline registrar page (entrada.html/.js/.css)
src/popup/     toolbar popup (configuration only)
src/background/service-worker.js   toolbar badge + offline redirect
tools/smoke.js   optional load + logic check; NOT part of the extension
```

`browser.js` attaches `NFPR` to `globalThis`. In a content script that is the
**isolated world**, so nothing leaks to the government page; in the popup it is
the popup window. Same files, both contexts.

### Load-bearing decisions — do not undo these casually

- **Donations are sent from the content script**, same-origin to
  notaparana.pr.gov.br. That is deliberate: requests carry the volunteer's login
  cookies and correct Origin/Referer automatically, exactly like the site's own
  code. Do not move them into the background script.
- **The background script stays tiny and standalone** (badge + offline
  redirect only, no imports) so one file runs as a Chrome service worker and a
  Firefox event page.
- **The offline page (`src/offline/entrada.html`) never sends.** It loads
  everything except `donation.js` and only queues keys into
  `nfpr:fila`; sending stays exclusively the live page's job (its drain loop
  picks the queue up on the next connected load). It does make two *read-only*
  requests: the reachability probe behind the connection strip in `entrada.js`,
  and — because it loads `entidade.js`/`settings-ui.js` — the entity lookup when
  a CNPJ is added from its settings modal. Both are deliberate. The rule is
  "never sends", not "never touches the network".
- **`navigator.onLine` is only believed when it says `false`.** It reports the
  network *interface*, not the internet: with the router unplugged (or on a
  machine with virtual adapters) it stays `true` while nothing is reachable.
  Anywhere the UI claims the connection is *back*, that has to be proven by a
  probe that actually reaches notaparana.pr.gov.br — any HTTP answer under 500,
  `opaqueredirect` included. This lives in ONE place, `connectivity.js`, used by
  both surfaces; it used to be written twice and the two had already drifted.
- **On-page UI lives in a closed Shadow DOM.** `tokens.css`, `overlay.css` and
  `settings.css` are fetched at runtime via `web_accessible_resources` — the
  site's CSS cannot bleed in and ours cannot bleed out.
  **Three deliberate exceptions**, and they are the only host-page mutations in
  the extension; if you find a fourth, it is a bug. The rule is about
  *restyling the government document*. **Operating a control the site already
  has is not a mutation under it** — `NFPR.BuscaSite` shows and hides
  `#conteudoPesquisaAvancada`, which is exactly what the site's own
  `#busca-entidade` handler does, and it puts it back the way it found it.
  **Nor is a MOUNT** — replacing `#main`'s children with the registrar host, and
  inserting the header host into `#header`, are both `ui.js` putting our own
  empty element in a place the volunteer is about to look at. Nothing of theirs
  is moved, restyled by that act, or reachable from inside it.
  - `ui.js` sets `scrollbar-width: none` on the government page's `<html>` for
    the rest of the session, because the registrar is sized to the viewport and
    the host scrollbar would sit beside a panel that never scrolls. On an
    engine without the property (Chrome before 121) it appends one `<style>`
    with `html::-webkit-scrollbar{display:none}` instead — the same exception
    in its older spelling, not a fourth.
  - `host-page.js` hides `#main` and `#header` until we mount, restyles the
    site's own `#header` into the merged bar (see the next bullet), and restyles
    its `#footer` to 35px on one row. `#main` gets replaced by our registrar; the
    footer below it does not, and as the government page ships it a `<br>` drops
    the Celepar logo onto its own line for a ~90px slab. The registrar is sized
    to the viewport, so every pixel of that slab is scrolling to reach nothing.
    It lives at `document_start`, not next to the mount in `ui.js`, because
    applied at `document_idle` the volunteer sees the tall footer render and
    then jump.

    **Every host-document mutation goes in this file**, which is what its name
    is for — it was `anti-flash.js` while hiding `#main` was all it did, and
    that name described one sheet rather than the job. Anything belonging to our
    own subtree belongs in the Shadow DOM instead.

    It publishes the height it styles with as `__nfprHostPage.alturaRodape`,
    and `ajustarAltura` in `painel.js` reserves exactly that much. Do not
    restate the number: the panel used to land its bottom on the bottom of the
    viewport, which pushed the footer off-screen by its own height, and with the
    scrollbar hidden nothing said the page scrolled at all. A second copy of the
    number brings that back as either a clipped footer or a gap under the panel.
    It is absent on the offline page, which reserves nothing.

    Below 500px the Celepar mark halves (`zoom: .5` — half of whatever the site
    renders it at, which we do not know). At every other width it is left alone:
    rescaling another organisation's brand mark is not ours to do.
  - **Corollary — anything given a written pixel height needs
    `box-sizing: border-box` spelled out.** `all: initial` on `:host` resets it
    to `content-box`, and `border-box` is declared only under `.nfpr-settings`.
    `.nfpr-registrar-page` is the one element `ajustarAltura` writes a height to,
    and its 1px border rendered *outside* that height — two pixels of permanent,
    invisible scrolling on the government page. Fix the box model, never
    subtract a literal `2`: the border width is the thing being ignored, and
    `ALTURA_MINIMA` would still be wrong by the same amount.
- **The header is MERGED, not rebuilt, and every control in it stays theirs.**
  Two stacked headers cost 191–212px of chrome above the first result row on a
  panel that is sized to the viewport and never scrolls; they are one 54px bar
  now, and `#main` starts at 64px at every width. `host-page.js` restyles the
  site's `#header`; `ui.js` inserts one empty shadow host into it holding our
  Início link and the entity chip. `painel.js` builds that strip either way and only
  stops appending it to the panel (`opcoes.cabecalhoSeparado`) — one markup, two
  homes, and the offline page keeps the panel one because it has no bar.
  - **Do not move their nodes into our shadow root.** It is the obvious
    simplification and it is fatal: their own toggle reads
    `$('.user-config-options')`, a *document* query, so the account dropdown
    would stop being found and would silently never open again. Restyling in
    place is what keeps their handlers, their dropdown and their `/sair`
    working with no help from us.
  - **Every rule is `!important`, and that IS the mechanism.** Their header
    changes shape at 767/768/991/992/1200px across four media queries, all of
    them normal weight, so one important declaration of the same property wins
    at every width without our reading their table. What follows: **declare
    enough PROPERTIES.** One left undeclared is one they still control, and it
    will move under us at a breakpoint nobody tested.
  - **Two properties must never be declared**: `overflow` on `#header` (their
    dropdown hangs below the bar and would be clipped) and `display` on
    `.user-config-options` (jQuery's `fadeIn` writes it inline, so an important
    rule would pin the dropdown open or shut for the life of the page).
  - **Our half is sized by CONTAINER queries, theirs by media queries.** Their
    `#container` is *fixed*-width per breakpoint (758 → 982 → 1200), so 991px of
    viewport gives our strip a 758px bar and 992px gives it 982px — a 224px jump
    no viewport query can see. The strip is the container and asks how wide *it*
    is, which also means their breakpoints can move without moving ours.
    **1200 is a ceiling, not a midpoint** — it comes from a `min-width:1200px`
    query with nothing above it, so a 2560px monitor gives this bar the same
    1200px a 1200px one does. **Nothing may therefore be gated on being wider
    than the widest bar.** The volunteer's `#user-name` was: hidden by default
    and shown only under `@media (min-width:1200px)`, it never appeared in
    practice. It is stacked ABOVE `#user-log` now (a grid on `#user-info`, the
    same two-line block as the entity chip), so it costs only what it exceeds
    the CPF by, and it hides at 767px as an ordinary step of the ladder — the
    first step, because the CPF identifies the volunteer in half the width.
    Theirs cannot use the container trick: the nearest container would have to
    be `#header` itself, and we do not put `contain` on a box we do not own.
  - **Their name and CPF ARE their Configurações button**, the way the entity
    chip is ours: one pill, an icon at the left edge, two lines after it. It is done by
    OVERLAP, never by moving the spans into `#user-config` —
    `.user-info-options` is `display: contents`, the anchor is grid-placed in
    the same cell as the two spans, and the spans sit above it with
    `pointer-events: none`. That last part is load-bearing beyond the no-move
    rule: their outside-click closer in `layout.js` fades the dropdown out on
    any click whose `e.target.id` is not `user-config` or `user-config-icone`,
    so a click landing on a span INSIDE the anchor would open the dropdown and
    shut it in the same event. The word "Configurações" is gone from the bar
    (`font-size: 0` on the anchor's bare text node). "Sair" stays a pill of its
    own. The pill is typeset EXACTLY like the chip — same font stack, sizes,
    colours, padding, press — in the chip's icon style: their FontAwesome glyph
    is emptied and `#user-config-icone` is painted through a mask of a profile
    icon (a person in a circle) drawn like our gear. **Not the gear itself**:
    a gear on both made two look-alike buttons side by side; the gear is this
    extension's settings, the person is the volunteer's account.
    `host-page.js` depends on nothing, so the font stacks and the SVG live
    there as hand-kept copies, like the gradient.
  - **The duplicate-session screen has no pill and no Sair** — their template
    omits both, leaving only the name and CPF. Each half of the layout is keyed
    to its own control being PRESENT (`:not(:has(#user-config))`,
    `:not(:has(#user-logout))`), so the two lines fall back to plain text flush
    after the hairline. Never style that text as a pill: nothing there is
    clickable.
  - **Neither settings door in the bar says "Configurações" any more.** Ours
    is the entity chip with its gear, theirs is the name/CPF pill with a
    profile icon, and the two are told apart by their icon and what they show
    rather than by a word. Two identical labels a few
    centimetres apart opening different things (ours: entities, fixed parts,
    preferences; theirs: password, e-mail, cadastro) was the original problem,
    and our chip dropped the word first because relabelling someone else's
    control is a bigger liberty than not labelling our own. It carries no *"Doando para"* caption
    either — the phrase said what the CNPJ IS, but it said it in every state of
    a bar with finite room. **What it said survives in the chip's hover
    `title`** (*"Configurações — doando para AMARAS"*): an unlabelled CNPJ in a
    header can be read as the volunteer's own, and on a narrow bar the CNPJ is
    not even on screen. `smoke.js` asserts both states of it, because a
    tooltip is invisible when it is wrong. (It lived in an `aria-label` until
    the project dropped ARIA — see *Conventions*.)
  - Below ~540px the chip is the gear alone and the target entity is one click
    away rather than on screen. (It was ~430px until both document numbers went
    monospace, and the old 170px container threshold left the Início link out
    of its sum, so the CNPJ was shown CLIPPED from there to ~500px. The
    threshold in `registrar.css` is now measured by sweeping the head.) Deliberate: the guaranteed set is the logo, their
    account pill and their Sair (the CPF on the pill down to 360px; below it
    the pill is the profile icon alone), the previous build hid the chip
    entirely below 570px, and a second row would spend vertical space on exactly
    the screens with the least of it.
- **Capture is a document-level, capture-phase listener**, not an `<input>`.
  A RUN of gaps under 35 ms means machine (scanner) input — `RAJADA_MINIMA`
  (4) in a row, never one — and 250 ms idle ends a scan. **One fast gap is
  fingers**: rolling across adjacent keys (`321`, `45`) lands two or three
  keydowns inside 35 ms, and deciding on the first of them threw away every
  digit typed before it. Until the run is long enough it is only *suspected*
  (`suspeita` on the `onMudanca` payload, apart from `rajada`): the live verdict
  raises nothing new — but keeps one already on screen, since no verdict
  un-fires on later digits and hiding it was a blink and a layout shift until
  the idle timer — and `autoEnviar` waits (a scan under a short fixed part
  fills the variable count before it is believed — [fixed part] + [barcode
  head]), and if the run ends short the idle timer releases both. A stalled scan
  resuming after its probation key needs no run; it was a scan one keystroke
  ago. It
  must never drop a character from a burst, and must never steal keystrokes
  aimed at the page's own form fields (`eventoDeCampoExterno`, in
  `registrador.js` — the DEFAULT for both registrars, not a parameter the live
  page passes). **It cannot see our own fields:** from a document listener,
  `composedPath()` stops at a closed shadow root's host, so a keystroke in the
  strip's fixed part field, filter or rename field looks like one on a `div`.
  Those are kept out by `estaAtivo` (`ui.editandoParteFixa()`, the strip's
  `editando()`), and that is load-bearing, not a second guard. Only the `typed` buffer is capped by the
  active fixed part — `raw` records everything, because a full 44-digit key
  found in `raw` must always beat the fixed part. Capping both silently rebuilt
  scanned keys from fixed part + first digits; it is the worst bug this codebase
  has had.
  - **A MACHINE BURST DOES NOT INHERIT A PERSON'S DIGITS**, and that is a
    different rule from the one above rather than a relaxation of it. Nothing
    used to own the buffers: `FIM_SCAN_MS` clears the `escaneando` flag and
    never the text, so six digits abandoned half an hour ago were still there
    when the next barcode arrived — and `[their 6][the barcode's first 38]` is a
    44-digit run `extrairChave` finds, so a perfect scan was refused red. The
    first keystroke of a burst therefore discards what a human left behind.

    **It fires before any length question and truncates nothing to a fixed
    part's variable-digit count.** If you find yourself slicing `raw` to
    `contarVariaveis`, stop: that is the worst bug above, wearing this rule's
    clothes.

    It reads TWO FRAMES BACK, not one, and `slice(-1)` is wrong. A QR scan's
    first character is a letter, which arrives while `escaneando` is still false
    and is therefore never appended at all — so when the burst is detected on
    character two, the last entry in `typed` is still one of the human's digits.
    The accepted cost is a person typing at machine speed losing one digit into
    the scan, which is today's outcome anyway.

    **`e.repeat` is not the answer to the stuck-key case.** It was designed and
    rejected: worst-case scanner behaviour is unknown, and a scanner that ever
    set it would have its digits silently dropped and would simply appear broken
    with nothing on screen saying why. A stuck key costs one re-entry.
  - **...AND A PERSON TYPING INTO A SCANNED BUFFER TAKES IT OVER.** The flag
    (`bufferDeMaquina`, reported as `rajada`) used to last until the buffer
    emptied, so a volunteer correcting a bad read by hand was still "a scan":
    the live verdict stayed silent while they typed, and the note never counted
    as typed, so nobody offered them fixed parts. **Backspace** hands the buffer
    over outright — no scanner sends one. **A digit at human speed** hands it
    over too, but **on probation for exactly one keystroke** (`retomavel`), and
    the probation is the load-bearing half:
    - A main-thread stall mid-scan delivers one key after a long gap and the rest
      at machine speed behind it. Taken at face value, that key makes the buffer
      a person's, and the machine-speed key right behind it then discards
      everything before it as a person's leftovers — the scan's own head — and a
      perfect read is refused red. If the very next key is machine-speed it is
      the same burst, and nothing is discarded.
    - **The probation key never auto-submits.** Under a fixed part `typed` holds
      a scan's HEAD, so a stall landing on the key that fills the variable count
      would let `autoEnviar` compose [fixed part] + [barcode head] — the worst
      bug above, arriving by a third door. Someone whose first digit after a
      scan completes the entry presses Enter.
    - Probation is spent by ANY keystroke, not only a digit. A person who typed
      one digit into a stale read and then scanned is therefore not caught by
      it: the new scan's first character spends it, and the burst behind it
      discards the old buffer as usual.

    `smoke.js` pins both directions and the two probation guards — the latter
    pass on the code before this rule existed, and fail if the probation is
    removed, which is what they are for.
  - **...BUT A BUFFER THAT HELD A SCAN IS NEVER COMPOSED.** Taking a scan over
    makes it count as typed (`rajada` goes false) and does NOT make it a fixed
    part entry: under a fixed part its `typed` is still the barcode's head.
    Capture reports `escaneado` (set with `bufferDeMaquina`, cleared only when
    the buffer empties) on `onMudanca` and to `onEnviar`, and `registrador.js`
    passes `rajada || escaneado` to `ParteFixa.resolver`, paints the cells and
    judges the live verdict from `raw` with the fixed part set aside. Without
    it, a plain barcode under a fixed part, one Backspace and Enter left no
    44-run in `raw`, and the resolver composed [fixed part] + [barcode head] —
    the worst bug above, by a fourth door.

    **Backspace removes the last character OF THE KEY.** The first one into a
    scanned buffer cuts `raw` down to `Chave.chaveParcial(raw)` — what the
    cells show — and the two buffers edit together from then on. Trimming both
    by one trimmed a QR url's tail from `raw` instead, so the cells showed the
    corrected key and the scanned one still in `raw` was what went out.

    **A paste that overflows the entry is a reading, not typing.** One with no
    whole key that would push `typed` past the variable count is judged alone
    and at once, flagged `escaneado`, so it is never composed and is red unless
    it is a key. It used to be appended whole, and the composition took the
    FIRST N characters and dropped the rest in silence. A paste that fits is
    typing, and gets typing's auto-send.
  - **A BURST THAT "RESUMES" ONTO A WHOLE KEY MAY BE A SECOND SCAN.** With a
    scanner that sends no Enter and `autoEnviar` off, a volunteer who scans A,
    forgets to submit, and scans B seconds later produced exactly the shape
    above — B's first digit slow, its second fast — so B was kept as A's tail,
    Enter submitted A, and B vanished without a sound. It **cannot be decided
    when the burst resumes**: a scan really can stall *after* its key, inside a
    QR code's `|2|1|1|…` tail, and discarding there throws the only key away.
    So the resumption is only noted (`inicioRetomada`), and the decision waits
    for the one thing a second read produces and a tail never does: a
    **key-shaped** 44-run of its own (`RE_CHAVE_EM_TEXTO`, the FORMATO shape) —
    not merely 44 key characters, because an off-line NFC-e's QR tail carries a
    56-character hex digest that uppercases into one. When the second key is
    complete, everything before it goes, as for a person's leftovers.

    **The idle timer ends the run as well as the scan** (`rapidas = 0`). A slow
    digit resets the run on its own, but a letter is transparent to it and a QR
    code begins with one, so a second QR read used to join the first one's run,
    discard nothing, and submit the FIRST key.
  - **A CONFIRMED BURST IS A SCAN WHATEVER ITS LENGTH.** `ParteFixa.resolver`
    takes capture's `rajada` flag. The 44-run in `raw` was once the only sign
    of a scan, so a burst *shorter* than 44 under a fixed part — a shop's own
    barcode, a loyalty card — composed [fixed part] + [barcode head], about one
    in ten of which passed every local check: the worst bug above, by the one
    door it left open. With the flag, nothing composes; the burst is judged as
    it came (`origem: 'rajada'`) and a short one is red. It raises none of the
    scanned-under-a-fixed-part machinery, since no note was scanned.
  - **A READING ENDS ONCE, HOWEVER MANY TERMINATORS THE SCANNER SENDS.** Some
    scanners close a read with a burst of them — six Tabs, CR and LF, a mix.
    The first submits and empties the buffer, and every one after it used to
    reach the browser: Tabs walked focus across the panel's controls, into the
    government page and out to the browser's own chrome, and the next scan was
    typed wherever it had landed (reported from the field, 2026-10-07). So a
    terminator with nothing to submit is swallowed when it belongs to a
    reading's TAIL (`terminadorDeCauda` in `capture.js`), on either of two
    signs: it arrives under 35 ms behind the previous keystroke, or an entry
    ended less than `FIM_SCAN_MS` ago — by a submission, or by an earlier
    terminator of the same tail. The second sign is the scanner too slow for
    the burst heuristic, and the key that left by `autoEnviar` before its
    terminator arrived.

    **A terminator pressed by hand is never touched**: Tab moves focus and
    Enter presses the focused button, which is the keyboard rule under
    *Conventions*. Version 1.0.1 was the emergency form of this — every Tab
    swallowed while capture was live — and it stopped the damage by breaking
    that rule. **Do not go back to it**, and do not widen the window "to be
    safe": each widening takes the keyboard from a person.

    Three details look removable and are not. The gap is measured from the
    last key that is **not a bare modifier**, or Shift+Tab — two keydowns a few
    milliseconds apart — reads as a machine-speed Tab and walking backwards
    stops working. **`e.repeat` is let through**, because a held Tab repeats at
    about 30 ms and a scanner cannot produce a repeat; this is not the
    stuck-key case below, since nothing leaves a buffer on its say-so. And
    **only a submission or a swallowed terminator opens the window**, never one
    that was let through, or a person's Tab onto a button followed by a quick
    Enter loses the Enter.

    The accepted cost: a tail with nothing in front of it — a failed read from
    a scanner that sends its suffix regardless — still lets its **first**
    terminator through, since nothing tells that one keystroke from a
    person's. It runs before the timing heuristic, so a tail neither opens a
    run of fast gaps nor re-arms the idle timer. And it does nothing while
    capture is inert (settings open, a strip editor focused, no entity): the
    rule lives inside `estaAtivo`, like everything else in that listener.
  - **THE KEYBOARD NEVER RESTS ON NOTHING, because an on-screen keyboard needs
    a field.** Capture hears a physical keyboard and a scanner wherever focus
    is, the bare page included. An on-screen keyboard does not work that way:
    with focus on the page the Windows one delivered **no events at all**, and
    with focus on a field — a read-only one included — it delivered ordinary
    `keydown`s (recorded with `tools/teclas.html`, 2026-10-07). The entry's
    hidden input is read-only and takes the keyboard at load and after every
    submission, so the gap was a click: pressing on anything that is not a
    control drops focus to the page, and that keyboard was dead until the
    volunteer clicked the 44 cells. `devolverTeclado` in `registrador.js`
    closes it — a click, or the window coming back, that leaves the keyboard
    on nothing hands it to the entry.

    **Only on nothing.** A control, a field of ours or the page's own keeps
    what it was given; the settings overlay keeps the keyboard inside itself;
    and a click that ends a **text selection** takes nothing, because focusing
    an input collapses it and dragging across a key on a row is how one is
    copied. The input stays **read-only**: that is what keeps a touch screen
    from raising its keyboard uninvited, and the recording says it is enough.

    This is about on-screen keyboards. A scanner's own *"teclado virtual"*
    mode is a different thing with the same name and **has not been recorded
    yet** — do not assume this covers it.
  - **`Esc` empties the entry, and only when there is something to empty.** With
    the buffer already clear it falls through to the page untouched, which is
    what lets `Esc` go on meaning whatever it means there and in the settings
    overlay (`modal.js` registers its own document listener first and acts only
    while the modal is open; capture is inert then anyway).
  - **`autoEnviar` fires at the END of a burst, never at its 44th digit.** A QR
    scan is `…/nfce/qrcode?p=<44 digits>|2|1|1|ABC`, so with no fixed part the
    run of 44 completed MID-READING: the key went out correctly, `reset()`
    emptied both buffers, the trailing `2`, `1`, `1` landed in a fresh `typed`,
    and the scanner's own Enter submitted `211` as a key. A correct registration
    and a spurious red toast, on every QR scan, whenever the preference was on.
    The length gate is now for fingers only; a burst submits from the idle
    timer. That branch is a safety net rather than the normal path — scanners
    terminate with Enter or Tab — and it is strictly stronger than the
    blank-input rule, since it requires a complete 44-digit key rather than
    merely something.
- **Every check lives in ONE ordered table**, `REGRAS` in `chave.js`, and adding
  one is a single entry whose `gravidade` is the whole decision. There are two
  ways in — `Chave.avaliar(chave, agora)` and
  `Chave.avaliarTemplate(template44, agora)` — and they differ by one boolean.
  Nothing else selects a subset of the checks.

  **Adding a rule** — the table was kept this way so rules can be added as the
  maintainer confirms them with professionals. The steps:
  1. **One entry in `REGRAS`** (`chave.js`): `codigo`, `gravidade`, `campos`
     (every span it reads — `uf`, `aa`, `mm`, `documentoEmitente`, `modelo`,
     `serie`, `numero`, `tipoEmissao`, `codigo`; all still parsed by
     `analisarChave` even where nothing judges them today), `relogio: true` if
     it reads `agora`, `testar` (truthy = the check FAILS), `mensagem`.
     **Position is priority**: every red before every grey, and within grey,
     permanent before clock-dependent (`EXPIRADA` stays last). A rule that
     changes whether a *model* is donatable is not a new entry: it is
     `MODELOS_ACEITOS` and `TIPOS_DOCUMENTO`.
  2. **A fixed-part sentence** in `MSG_PARTE_FIXA` (`registrador.js`) unless
     the entry is `escopo: 'chave'`. `smoke.js` fails without it.
  3. **A fixture** in `montarCasos` (`debug.js`), so `NFPR.Debug.smoke()` and
     the smoke run cover it.
  4. **Assertions** in `smoke.js`: the verdict and its colour, both bounds of
     any range, and that neighbouring values do not fire.
  5. **A row** in DOCS.md's verdict table, and the **source** in the entry's
     comment — the article, rejection number or observation it rests on.
  Everything else follows by itself: the live verdict fires the moment the
  entry's `campos` are typed (a rule reading `tipoEmissao` speaks at digit 35),
  a fixed part is judged by it, and `aceitarChavesInvalidas` /
  `ignorarInelegibilidade` bypass it by colour. Before choosing the colour,
  read the two yardsticks below and the removed série rules further down.
  - `'entrada'` is **red**: the input is wrong, nothing real was read. An error
    toast, no row, and the volunteer reads the paper again — which is the only
    thing that recovers the donation. **Not `'erro'`**: the UI already uses
    `estado: 'erro'` for a *send* failure, which is a different category
    arriving from the network.
  - `'inelegivel'` is **grey**: the digits are right, the note is real, and the
    programme will not take it. A row saying why, and nothing to do.

  **Both of those describe the default, and exactly one thing changes them:**
  the `enviarSemValidar` preference below. With it on there is no local refusal
  at all — the verdicts still run and still speak, but they choose a sound and a
  row marker instead of a gate, and **a red key entering the durable queue is
  then the deliberate outcome rather than the bug this rule guards against**.
  Everything above is exactly right with the preference off, which is the
  default and the case worth optimising the wording for.

  **A refusal clears the entry, and the clearing is the point.** Red means the
  digits are wrong and nothing real was read, so the buffer holds a corrupt
  reading. Handing it back for repair invites the volunteer to *correct* it —
  eye along the row, change the digit that looks wrong, resubmit — and a patched
  key that happens to satisfy the check digit is a donation filed for a note
  nobody ever read. That is the fixed part fabrication `ParteFixa.resolver` was
  rebuilt to remove, arriving by a different door. Retyping from the paper is an
  **independent second reading**, and the independence is the whole value; a
  repaired one is not independent of the reading that was already wrong.

  **One signal deliberately comes BEFORE the refusal: the check-digit hint.**
  With `autoEnviar` off (the default), once every variable digit is in and the
  check digit fails, `renderCells` in `painel.js` turns the entry box red
  (`nfpr-entry-cdv-err`) before Enter is pressed, and the next change takes it
  off. A code audit (2026-09-29) read it as this repair loop one step early — after one
  typo, a single wrong-digit "fix" clears it and passes every check about 12%
  of the time — and the maintainer kept it on purpose (2026-09-29): it gives
  the volunteer a chance to re-check the last few digits against the paper
  *before* submitting, instead of retyping all 44 after a refusal. What
  reconciles the two: the hint is the volunteer re-checking **their own
  reading before it is ever submitted**; once Enter is pressed, a red verdict
  still clears the entry, and nothing here changes that. It is not the live
  verdict (silent, text only, never after digit 22) and not a toast; it names
  no span and says no sentence. With `autoEnviar` on it never shows, since the
  key is already on its way. `smoke.js` pins all of that.

  Two things follow, and both look like missed opportunities until this is read.
  **No span is highlighted**, even though `REGRAS` declares `campos` and could
  say which digits a verdict read: pointing at a span invites
  diagnosis-by-position, and a volunteer who concludes the *receipt* is bad bins
  a good one. **And the sentence gains nothing** — no "confira os números
  marcados", no "não precisa digitar tudo de novo", because both promise a
  repair that must not happen.

  The one exception is a second *cause*, not a repair: on a key the fixed part
  COMPOSED (`origem === 'parteFixa'`, a typed entry), a red verdict also says
  the fixed part may not fit this note, and its button
  drops the fixed part and clears the entry like everything else. A fixed part
  that fixes too much composes a key that is not the note in the volunteer's
  hand, so the check digit they typed off the paper fails and they are told they
  mistyped it — a sentence about them, for a mistake the software made. It is
  composed in `registrador.js` in front of the verdict's own wording, never
  inside `REGRAS`: `chave.js` judges keys and knows nothing about fixed parts,
  and COMPRIMENTO and FORMATO keep their own sentences for the reason stated
  there.

  Getting the colour backwards is expensive in exactly one direction: telling
  someone they mistyped a receipt that is perfectly fine ends with a donatable
  note in the bin. That, not "which function does it go in", is the question.
  `escopo: 'chave'` marks the three a fixed part template cannot answer (length,
  format, check digit); `relogio: true` marks the ones needing `agora`, so
  `FUTURA` being red *and* clock-dependent is two fields rather than an
  exception. `campos` declares the spans a check reads, and the runner skips it
  when a `'?'` made any of them unknowable — which is how one table judges both
  notes and fixed part templates with no second code path.

  > This used to be a rule about *location*, because `ParteFixa.resolver` asked
  > `validarChave` whether a scan beat the active fixed part, so where a check
  > sat decided whether a fixed part could fabricate a key over it. That
  > coupling was removed, and with it the two-function shape it had forced onto
  > `chave.js`. Do not reintroduce a caller that asks `chave.js` to arbitrate
  > anything about fixed parts.
- **The same table speaks WHILE TYPING, and that costs one function.**
  `Chave.avaliarTemplate` already judges 44 characters of digits and `'?'` by
  skipping any rule whose `campos` are unknowable, and a partially typed key is
  exactly such a string — `ParteFixa.compor(template, typed)` builds it. So the
  first check whose spans are complete fires as the digits arrive: the state at
  2, the year at 4, the month at 6, the issuer's own check digits at 20, the
  document type at 22. Nothing reads the série or tpEmis, so the verdict says
  nothing after 22 (the red box at the last digit is the check-digit hint, a
  separate and deliberate signal — see *A refusal clears the entry* above).
  Nothing used to say a word until
  all 44 were in, which is 38 wasted digits for a mistyped cUF, hundreds of
  times a day.

  **At digit 4 the date checks judge the whole year**, because the month is
  still `'?'`: `FUTURA` and `EXPIRADA` fire only when every month of it would,
  so they stay true, but a sentence built from one end of the range names a
  month nobody typed. `EXPIRADA` therefore names the year alone when `mm` is
  unknown (*"Nota de 2024 — o prazo para doá-la já passou."*). It said
  *"dezembro de 2024"* for any 2024 note until 2026-09-29.

  **A letter outside 6–17 is red at the letter itself** (`LETRA_FORA_DO_LUGAR`),
  whichever span it lands in. `FORMATO` is `escopo: 'chave'`, so it never sees
  a partial key, and `Number('2A')` is `NaN`: every comparison with it is
  false, so a letter in the year or month judged clean, one in the model fell
  through to `TIPO_DOCUMENTO` and was GREY — *"não pode ser doada"* about a
  typo, the expensive direction — and one in the série or the invoice number
  said nothing until Enter, since no rule reads those. The rule has no
  `campos`: it reads the characters (`texto` on the rule context), skips `'?'`,
  and so cannot be un-fired by later digits either. It replaced three span
  checks (`ANO_`, `MES_`, `MODELO_INVALIDO`) that covered three spans and only
  once each was whole. It never answers a whole key, which meets `FORMATO`
  first; its debug fixtures therefore expect `FORMATO`. Every rule below it
  sees only digits outside the issuer span.

  **There are no false positives, structurally.** `campos` guarantees every span
  a rule reads is complete before the rule is asked, so a verdict that fires on
  a prefix cannot be un-fired by later digits. Under a fixed part the digits it
  fixes are known from the start, so a fixed part fixing the issuer prefix
  settles `DOCUMENTO_EMITENTE` and `TIPO_DOCUMENTO` before anything is typed and
  they simply never fire — correct, since the fixed part was judged when it was
  applied.

  **It is a fourth thing, and `gravidade` still decides the colour and nothing
  else.** Red is still a toast with no row and an emptied buffer; grey is still
  a row saying why. This is neither a toast, a row, a bar nor a count: a
  transient state on the entry, cleared by the next keystroke and superseded by
  the real verdict at Enter. It **blocks nothing** — typing all 44 and pressing
  Enter produces exactly what it produced before — and it speaks under
  `enviarSemValidar` and refuses nothing there either.

  Three constraints, and each removes a way of making it worse. **No span is
  highlighted** (the caret is already sitting there, and pointing invites
  diagnosis-by-position; see the rule above). **It is silent** — no fifth cue
  and none of the existing four, because it fires several times per note and a
  sound per span is intolerable in a shared room. **And it is suppressed during
  a machine burst**: capture reports `rajada` on the `onMudanca` payload, a scan
  fills 44 cells in ~50 ms, and flashing four verdicts on the way past is noise
  for nobody. `chave.js` is not touched by any of this.

  Red says `Confira a chave de acesso.` and names no check, for the reason the
  red codes share one sentence. Not *"os números"*: a key may carry letters,
  and the red is often for one. Grey carries the verdict's own sentence and adds
  *"Esta nota não pode ser doada."*, which is half the value: an out-of-state
  receipt or a CT-e is knowable at digit 2 or 22 instead of after 44.
- **THE KEY IS NOT ALL DIGITS. A LETTER MAY STAND AT INDICES 6–17, AND NOWHERE
  ELSE.** The issuer's CNPJ went alphanumeric (IN RFB 2.229/2024; homologation
  06/2026, production 07/2026), and the key carries that CNPJ at `[6:20]` — so
  twelve of those fourteen characters may be uppercase letters. **Twelve, not
  fourteen:** `[18:20]` is the CNPJ's own check digits, which stay numeric, as
  does every other span. `Chave.posicaoAlfanumerica(i)` is the only definition
  of that window; a second copy of `6` and `18` anywhere is a copy that will be
  wrong the day the layout moves.

  **The arithmetic is one mapping: each character's ASCII value minus 48.** A =
  17 … Z = 42, and a digit maps to itself — `'5'` is 53, and 53 − 48 is 5 — so
  applying it unconditionally leaves every numeric key and every numeric CNPJ
  exactly as they were. That is why this change is not a fork: **there is one
  algorithm and the all-numeric document is the special case of it**, and why
  five hundred numeric assertions in `smoke.js` still pass untouched. Verified
  against Receita's own published example, `12.ABC.345/01DE-35`; if that
  assertion ever fails, nothing else about this feature is worth reading.

  It is written **twice on purpose** — `valorCaractere` in `chave.js` for the
  key's check digit, and again in `cnpj.js` for the CNPJ's. `chave.js` already
  depends on `cnpj.js`, so sharing it would mean a cycle for two lines of
  arithmetic.

  Assignment is progressive and only for **new inscrições**, so the overwhelming
  majority of notes will stay all digits for years. Nothing may be optimised for
  the letters being common, and nothing may assume they never arrive.

  - **`FORMATO` is POSITIONAL, and that is a corruption detector rather than
    pedantry.** `/^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$/` — a letter in the série or
    the invoice number is input that got mangled, which is exactly what red is
    for. Relaxing it to "44 alphanumeric characters" would wave that through.
    The usual objection to being stricter than the spec — that it loses real
    notes — does not apply here: which twelve characters are alphanumeric is
    *written down*, not inferred, unlike a série band.

    **It lost its own sentence to MSG_DIGITACAO, and COMPRIMENTO kept its own.**
    The two were allowed to name their own checks because the volunteer can
    verify them unaided against the cell display; *"A chave deve conter apenas
    números"* was such a sentence and is now simply false, and its true
    replacement is not checkable that way — nothing on screen says where the
    issuer's fourteen characters begin, and nobody should have to learn. The
    code stays distinct; only the wording is shared.
  - **Capture accepts every key character wherever it is typed, and a burst is
    read out of `raw`.** Two rules, and they replaced one that looked obviously
    right and was not — the history is worth keeping because the wrong version
    is the one a reader will reinvent.

    `e.key >= '0' && e.key <= '9'` had been answering two questions at once:
    what belongs in the buffer, AND what is the URL wrapped around a scanned QR
    code. The second answer was free only while a key was all digits. The first
    replacement was a cleverer per-keystroke test — accept a letter only at an
    index where the layout allows one — and it failed in both directions within
    a day of real use:
    - **A letter typed anywhere else vanished in silence.** Nothing appeared,
      nothing was said. An entry that swallows keystrokes reads as broken
      software, and it was reported as exactly that.
    - **A scan fired on a partly typed entry let the URL in.** The window is
      6..17, so a volunteer with eight characters already typed had the caret
      sitting inside it: `41260912` + `HTTPS` + the key welded on behind.
      Positional rules only work from an empty buffer, and a scanner does not
      wait for one.

    So:

    **WHERE A LETTER MAY STAND IS A VERDICT, NEVER A FILTER.** `FORMATO` judges
    the whole key at submit and the live verdict speaks while typing — a letter
    in the cUF makes the state unreadable at digit 2. Both teach; a swallowed
    keystroke teaches nothing. This is the same division the rest of the file
    keeps: capture records, `chave.js` judges.

    **ONCE A BURST IS CONFIRMED, `typed` IS DERIVED FROM `raw`** — it becomes
    `Chave.chaveParcial(raw)`, capped by the fixed part, on every keystroke and
    again in `marcarRajada` when the burst is first believed. Separating a key
    from the text around it is exactly what that function does, so the URL
    cannot reach the entry whatever the buffer held when the scan started.
    Accumulating key by key is what made the buffer's prior contents matter at
    all.

    **A LETTER NEVER CONFIRMS A BURST, and is transparent to the heuristic** —
    it neither opens a run, lengthens one, nor ends one. A key begins with its
    cUF, so a scanner's first characters are always digits and a real scan
    reaches `RAJADA_MINIMA` long before its CNPJ can contribute a letter; a
    person rattling letters off is not a scanner. Without this, four quick
    letters met the threshold as easily as four quick digits — and
    `marcarRajada`'s answer to a burst is to DISCARD everything typed before the
    run, so holding a letter key down emptied an entry of digits that were
    already correct. A QR URL is still confirmed early by its own punctuation
    (`:`, `/`, `.`, `?`), which a person typing a key does not produce.

    Letters still advance `ultimoKeyTime`, so the gap measured across one is the
    true gap and a scan's run survives its own CNPJ.
  - **Keystrokes are UPPERCASED, never dropped.** The site's own field does the
    opposite — `Util.alfanumerico` is `replace(/[^0-9A-Z]+/g, '')`, so a
    lower-case letter typed there vanishes out of the middle of a key in
    silence. `extrairChave` uppercases a whole pasted string for the same
    reason. Upper-casing a QR URL cannot manufacture a false 44-run: every token
    of it is closed by a separator that is not a key character.
  - **`cnpj.js` has TWO strips and confusing them is a data-loss bug.** `limpar`
    keeps letters, because that is what a CNPJ may hold; `soDigitos` does not,
    because a **CPF never went alphanumeric**. `validar` takes the first and
    `validarCpf` the second. Pointed at the wrong one, an alphanumeric issuer
    span arrives twelve characters long, fails the length test, and **every note
    from such a shop is refused red** — the single most destructive way to get
    this wrong, and the reason the two are named apart rather than
    parameterised.

    The repunit guard stays **numeric-only** (`/^(\d)\1{13}$/`). It exists
    because zeros are what a half-filled fixed part template puts in the issuer
    span; letters are never padding, so widening it to `(.)\1{13}` would only
    invent a refusal. Which letter strings Receita declines to *issue* — I, O,
    U, Q and F are reported as reserved against vexatious words — is an
    **assignment policy**, and a validator may not enforce one against a
    document that already exists. The accepted set is `A-Z`.
  - **A fixed part is where the letters will actually be typed**, since the head
    of a key is the issuer's CNPJ. `ParteFixa.normalizar` therefore keeps them
    and is deliberately **position-blind**: it is called on fragments (one
    character at a time while re-normalising the field, and on a slice around
    the caret) which have no index to test. The positional refusal is
    `LETRA_FORA_DO_LUGAR` in `REGRAS`, which judges the whole completed
    template — `FORMATO` is `escopo: 'chave'` and never sees one. Without it a
    fixed part fixing `A1B` as the série passes everything, since no other
    entry reads the série at all.
  - **`chaveParcial` exists because `raw.replace(/\D/g, '')` was the same
    coincidence one surface over.** The registrar paints a believed scan from
    the raw buffer, which holds a whole QR URL; stripping non-digits used to
    leave exactly the key. Strip letters now and the cells show a 42-character
    key with the issuer torn out of the middle; keep them and they show
    `HTTPSWWWFAZENDA…`. It takes the 44-run when there is one and the **last**
    run otherwise — the one still being appended to, which mid-scan is the key's
    own prefix.

    **AND ONLY IF THAT RUN COULD BEGIN A KEY** (`prefixoDeChave`: digits
    anywhere, letters only at 6..17). Without that test the last run is a word
    for most of a QR read, so the cells flashed `HTTPS`, `WWW`, `FAZENDA`, `PR`,
    `GOV`, `BR`, `NFCE`, `QRCODE` on the way past — two dozen repaints of text
    at the one person who is watching that box. A run that fails it is painted
    as nothing.

    **It is NOT "ignore everything before the 41"**, which is the same idea one
    step too narrow and was the first thing tried: the registrar shows
    out-of-state notes and names the state they came from (`NAO_PR` is grey,
    not a refusal), so a key opening `35` or `43` has to reach the cells like
    any other. The shape of a key is the general fact; Paraná is a verdict.

    **The same test guards the frames BEFORE a burst is confirmed**, where
    `typed` is still being appended to: while characters are arriving fast
    (`escaneando`), a letter is only appended where a key could carry one. That
    is `posicaoAlfanumerica(typed.length)` — the positional test that was wrong
    as a rule for TYPING, sound here because a scanner is what is producing the
    characters. At human speed it does not apply at all, and the verdict judges
    instead.

    **`escaneando` is set by a letter; `rapidas` is not.** One says characters
    are arriving fast, which is what keeps a scanned URL out of the entry; the
    other CONFIRMS a burst, and confirming one discards whatever was typed
    before it. Letting a letter do the second is the bug that emptied an entry
    of correct digits.
  - **The site is already plumbed for this, which is why we send letters at
    all.** Observed in the 2026-08-17 snapshot under `reference/`: the key field
    filters to `[0-9A-Z]`, `Util.somenteNumeros`, despite its name, strips
    only punctuation (`[^\w]`), so letters reach their POST, and the entity CNPJ
    field is formatted `"AA.AAA.AAA/AAAA-00"` — twelve alphanumeric, two
    numeric. The payload shape we send is the one their own page sends.

    And the validator behind it judges them: a mistyped cDV on an alphanumeric
    key is refused like any other (observed 2026-09-28), so `chave de acesso
    inválida` is final whatever the key carries.
- **Two models are accepted — `65` (NFC-e) and `55` (NF-e) — and both
  count.** `MODELOS_ACEITOS` in `chave.js` is
  the only place the set is written, and the model decides exactly one answer
  there: `TIPO_DOCUMENTO`. **A new `modelo === '65'` anywhere else is a bug
  until proven otherwise**; `smoke.js` asserts that an NF-e meets every other
  check exactly as an NFC-e does. Both models answer 200 at the POST; anything
  else answers `Tipo de documento inválido`, which the grey pre-empts.

  **An NF-e can be donated like an NFC-e** (settled 2026-10-07). It was an
  open question for a while, and the 55 was greyed for a few hours on
  2026-09-28 before being accepted again. **Do not re-grey it from a
  summary**, however confident; that loop has been run. The key layout never
  had to change for any of this — every model shares every span and the check
  digit. The health probe's key is a 65.
- **NOTHING READS THE SÉRIE OR tpEmis.** Both are still parsed by
  `analisarChave` (debug fixtures and `smoke.js` build keys from the spans), and
  no entry in `REGRAS` judges either. That is the whole série system, and it
  got there by removal — every reading it ever had was walked back:
  - **Picking the issuer checksum by série** (CPF in `920`–`979`, CNPJ
    elsewhere, either in three doubtful bands and under the NFF). `[6:20]`
    accepts **either document on every série**: a damaged document rarely
    satisfies either checksum, so choosing between them bought almost nothing.
  - **Red for an avulsa série (`890`–`909`) on a 65**, **red for tpEmis outside
    `{1, 6, 7}`** and **grey for `990`–`999`** (`TIPO_EMISSAO`,
    `SERIE_EXCEPCIONAL`) — removed 2026-09-23. No source supported any of
    them; the `{1, 6, 7}` set is the MOC's rule for notes the *fisco* issues
    (rejection 370), misapplied to everyone, and it called NFF and
    contingência notes typos.
  - **Grey `EMITENTE_CPF` on `920`–`979`, except under the NFF** — removed
    2026-09-28 while the NF-e was briefly grey, and **kept removed by the
    maintainer's call** when the 55 was accepted again. The MOC makes a CPF
    issuer impossible on a 65 (rejection 337, mandatory), limits a CNPJ issuer
    to `000`–`909` (rejection 503), and the avulsa bands (`890`–`919`) are
    NF-e, so everything the série ever caught was a 55 — and a 55 is accepted.
    A produtor rural's NF-e therefore goes out green. The NFF exception and the "unknown tpEmis counts
    as maybe 3" rule went with it.

  **Before adding a série or tpEmis rule, re-read that list.** In particular,
  do not add a red for "an impossible série on a 65": a single misread already
  fails the check digit, so it would be a rule that catches nothing. The band
  table is field B07 of the MOC's Anexo I (NT 2018.001; `970`–`979` from
  NT 2026.001). **No tpEmis value is refused** — `9` (contingência off-line da
  NFC-e) is common on exactly the paper that ends up in a donation box.
- **A CPF-issued note is a valid key**, whatever its eligibility.
  `DOCUMENTO_EMITENTE` accepts a padded CPF in `[6:20]` as **valid**, and must
  keep doing so. Refusing it there is the tidy-looking mistake: that check is a
  corruption detector, never an eligibility rule, and turning it into one tells
  a volunteer holding a valid produtor-rural receipt that they mistyped it. A
  produtor rural issues an NF-e (it cannot issue an NFC-e), so no local verdict
  greys it today — see the NF-e bullet above. A non-participating CNPJ issuer
  is undetectable from the key either way.
- **The server's rejections are authoritative; its acceptances are not.** The
  POST validates the cUF, the date, the document type and the check digit —
  nothing else. A key such as
  `41260700000000000000650000000000000000000000` passes all four: a zeroed
  issuer, invoice number and código, for a note which cannot exist. Donation is *claiming an
  untargeted note*, and the programme reconciles claims **monthly**, discarding
  duplicates and ineligible notes then, reporting nothing. So `sucesso` (in full,
  "Documento fiscal doado com sucesso!") means "filed", never "credited" — and
  the two colours answer to two different yardsticks:
  - **Red answers to the scanner and the keyboard, not to the server.** Its job
    is to notice that the input was corrupted — a typo, a dropped or doubled
    character — and say so *while the receipt is still in the volunteer's hand*,
    so they can read it again. `DOCUMENTO_EMITENTE` refuses precisely what the
    key above proves the POST accepts, and that is the point, not a discrepancy:
    a mis-scan the server files is a **lost donation**, because the volunteer
    believes it registered and puts the paper down. Strictness here is about
    transmission integrity and has nothing to do with eligibility.
  - **Grey answers to the monthly reconciliation, never to the POST.** Being
    stricter than the POST is routine and correct; being stricter than the
    reconciliation is what silently destroys donations.

  DOCS.md has the detail — read it before adding or removing any local verdict.
- **The shrug means nothing, so we ask instead of guessing.** The government's
  catch-all failure — HTTP 500 with `{"erro":"A aplicação retornou que não foi
  possível concluir a ação solicitada."}` — is byte-identical for three
  unrelated causes, so it may equally cover others, a real outage included. It is `SEM_DIAGNOSTICO`, matched on the **field**
  and never on the sentence.

  **It IS relayed verbatim, and that reverses an earlier decision.** The sentence
  used to be replaced with one of ours, because repeating theirs would officially
  claim a diagnosis that does not exist. What changed is that provenance is now
  visible: `fonte` puts a muted `[nfprweb]` in front of it, so the words are
  plainly the site's rather than this extension's reading of anything — which
  was the entire objection. Relaying is also strictly more useful to whoever is
  handed a screenshot, since our paraphrase was a paraphrase OF the same
  non-diagnosis and threw away the exact string a maintainer would search for.
  `MSG_SEM_DIAGNOSTICO` survives only as the fallback for an `erro` field that
  is truthy but not a readable string. **Nothing else about the shrug changed:**
  still no cause inferred from it, still arbitrated by the probe.
  - **The status must never decide before the body.** `SERVIDOR` latches the
    connectivity watchdog and parks the whole queue, so a status-first reading
    would let one impossible note fake a site-wide outage. The only
    `status >= 500` check on the POST path sits in the branch where
    `resp.json()` failed (`ILEGIVEL`) — it fires only when there is nothing to
    read. `smoke.js`
    asserts this, because the property is invisible in the source: it rests on
    where a check sits, and any tidy-up that hoists it reintroduces the bug.
  - **A POST guaranteed to be refused is not a donation claim.** That is what
    makes the server directly checkable, and it replaced a pile of statistical
    machinery (3-drains-and-3-days, a deferred-deletion list, failure counters
    in `nfpr:fila`) that only existed to approximate an answer we can simply go
    and get. On the first shrug, `Donation.sondarSaude()` sends a long-expired
    synthetic key with a bogus CNPJ: a specific refusal on either field proves
    validation ran (a `mensagem` NEVER counts — the probe is built to be
    refused, so even "sucesso" on it means something is broken), so the failing note really is the note's problem and
    **deletion is right**; the shrug, an unreadable answer or nothing at all
    means the server cannot judge, so the queue parks and **nothing is deleted**.
    Every failure mode answers "confused", because the only thing a probe
    licenses is destroying a note.

    **The one thing it does not swallow is a dead login**, and that is not an
    exception to the rule, since a rejection licenses destroying nothing
    either. While the server latch holds the pool is paused, so the probe is
    the only request this page makes. If its own token fetch finds the login
    gone, `sondarSaude` rejects with that session error, and `avaliarSaude` in
    `content.js` hands it to `pararPorSessao` like any other dead session. That
    latch then takes over from the server's. It moves the parked notes behind
    the login, takes the server bar down and stops the probe, because the
    server bar's promise of an automatic resumption cannot come true for a
    session that is gone.
  - **A dead session is PROVED, never inferred from a failed request.** Proof is
    `opaqueredirect`, a 3xx, a 401 or a 403 on the donation page asked with
    `redirect: 'manual'`. `Donation.sessaoPelaResposta` is the one reading of
    that answer, and `Sessao.conferir` uses the same function. A 2xx proves the
    login is fine, so a POST that threw beside one is a transient failure
    (`SERVIDOR`: parked, sent again when the watchdog's first probe answers).
    A token page whose body broke mid-read is also `SERVIDOR`, never an empty
    page with no token. The two copies of this reading used to disagree, and
    the send path's copy latched a whole queue behind "Sua sessão expirou" over
    one dropped connection.
  - **Every request has a deadline, BODY INCLUDED** — `Site.PRAZO_RESPOSTA_MS`,
    shared by `donation.js`, `entidade.js` and `Sessao.conferir`. In
    `donation.js` the body is read INSIDE `pedir`, because a timer cleared at
    the headers leaves `json()` unbounded: six stalled bodies held the whole
    pool. `/sair` keeps having none, on purpose (DOCS.md).
  - **The probe key is the accepted shape with the clock wound back.**
    The server has no structural objection to that shape (see the acceptance
    rule below), so the *only* thing refusing it is the deadline validator —
    which is what makes a refusal proof that the engine decoded a date and
    judged it. Do not "clean up" the key: a tidier one would be refused earlier
    and shallower, and would prove less. **Its cUF of `41` is part of that**:
    the cUF is the first field the engine decides, so a probe key from another
    state is refused at gate one — a *specific* refusal, so still read as
    healthy, proving only that two digits were parsed. Guaranteed-refused is not
    the bar; the bar is how much of the validator stack the refusal exercises. Our own `avaliar` calls it red, so it
    can never be mistaken for a scan.
  - **The probe CNPJ is belt and braces, and the two refusals are in SEQUENCE.**
    The key is validated before the entity, so the CNPJ is only reached on the
    day the deadline check stops applying. **It must never be empty, missing or
    `'0'`** — the first two produce the shrug, and a probe that
    shrugs at itself reports "not healthy" for ever, silently killing the reaper
    with nothing to say so.
  - **The deadline refusal is free, so the probe needs no rationing.** Known,
    not assumed: the rejection is instant, the note is counted as a donation
    nowhere, the sentence is always the same, and re-sending the same expired
    key changes nothing. The single-flight guard and the 30 s cache in
    `content.js` are there to spare someone else's server and to let one answer
    speak for a burst of failures — they are not a safety mechanism, and
    tightening them as though they were buys nothing. The one answer worth not
    provoking is `Procedimento inválido`, and the probe cannot provoke it: it
    sends the site's own `documentoComChaveAcesso` string and a freshly minted
    token, so it can only ever RECEIVE that answer.
  - **`Procedimento inválido` is the request being refused ABOVE the note**, and
    it is `PROCEDIMENTO_INVALIDO` — named for the answer, never for a cause. It
    was called `TOKEN_RECUSADO` for exactly as long as it took to find a second
    trigger: a stale form token produces it, and so does a malformed
    `documentoComChaveAcesso`, and nothing says that list is finished. A stale
    token is the only one we meet in practice, because the four fields we send
    are the four the site's own `doacaoDocumentoFiscal.js` sends.

    It arrives on `chaveAcesso`, where every other sentence is a verdict on the
    key, so it needs its own code to stop the deletion rule reading it as one.
    Retried normally — each attempt fetches a fresh token, the mitigation for
    the one cause we can act on, and observed to work. Do **not** route it into
    the session latch: `obterToken` already detects a dead session directly and
    earlier, so a token reaching the POST proves the session was alive, and "log
    in again" is the advice that causes the duplicate-session problem.

    **It shares `SEM_VEREDITO` with the shrug, and that set is one thing on
    purpose.** Both are refusals made without ever judging our 44 digits, so
    both are arbitrated by the probe rather than deciding anything themselves.
    They were briefly treated differently — one probed, the other had a
    hand-written branch — and the seam was immediately a bug: the branch parked
    its note in `aguardandoServidor`, a list emptied only by releasing the
    latch, without ever setting the latch. The note waited for ever while the
    queue indicator counted it. Keep them in one set.

    **Probe first, latch second.** Latching on the answer alone would stop the
    whole queue on every freak token hiccup, and those clear on one retry. The
    probe is what separates "this one token" from "the server refuses
    everything": healthy means carry on and let the budget decide; confused
    means stop. Exhausting the budget while the probe says healthy is
    contradictory and very rare, and it must still never DELETE — the note is
    held for the next page load instead.

    **`sondarSaude` must never read it as healthy**, and this is the sharp edge.
    The probe fetches its own token, so when token supply breaks the probe
    breaks with it — and its refusal arrives on `chaveAcesso`, exactly where the
    probe looks for proof that the validators ran. Reading the field alone made
    the probe report "healthy" off its own failure and licensed deleting notes
    at the moment nothing was getting through. The probe therefore judges
    through `classificarResposta` and refuses this code explicitly; `smoke.js`
    asserts it.
- **The donation deadline is `emission + 2` months, in absolute months — and it
  is the LAW.** Decreto 8.249/2017, art. 12 (wording by Decreto 5.999/2020, in
  force since 26.10.2020): *"até o último dia do segundo mês subsequente ao da
  emissão"*. SEFA's entity page says the same. It was first found by
  observation (2026-08-08), and the sources that say one month — the donation
  FAQ page, and the server's own refusal text ("mês seguinte") — carry the
  pre-2020 wording and are out of date. Do not tighten it to match them: being
  stricter than the rule silently loses real donations. `Chave.somarMeses` is the only month
  arithmetic; anything reaching for `mes + 2` is wrong for a sixth of all notes.

  **It is judged on the volunteer's clock at scan time, and on the SERVER's at
  drain time.** `processar` re-judges a restored note with `Chave.avaliar(chave,
  null)`, which skips every `relogio: true` entry. The volunteer's machine is
  the one clock that can be wrong — a donated PC's CMOS battery, a date set by
  hand — and a restored batch is exactly what a wrong one destroyed: set back a
  month, every queued note came back `FUTURA`, red, removed with no record; set
  forward, the same through `EXPIRADA`. A note that really expired in the queue
  now costs one request and comes back grey from the server, nothing owed.
- **A config write empties a half-typed entry ONLY when the entity or the
  fixed part changed.** `assinaturaDaEntrada` in `registrador.js` is those
  two — the target the entry will be frozen to and the gaps its digits fill —
  and `aplicarConfig(limparEntrada)` touches the cells, the pill, the live
  verdict and the scan-under-a-fixed-part bar only when it moved. Every write
  used to reset capture, and some arrive with nobody asking: the registry's
  official name for an entity saved unverified lands a moment after load, so a
  volunteer who started typing at once watched the digits vanish. A
  preference decides what happens at submit, never what digits already typed
  mean; do not add one to the signature to "be safe".
- **A synchronous `Config.aoMudar` listener sees STALE registrador state.**
  Listeners fire synchronously in registration order, but `registrador.js`
  subscribes with an `async` handler that yields at its first `await` before
  updating `inst`. So anything else listening to the same event and calling
  `reg.entidadeAtual()` right away gets the entity that was active BEFORE the
  change. Read the config in your own handler instead. This cost the
  refused-entity bar its live update once already — its button corrected itself
  only on reload, and a reload starts with an empty latch, so the first note
  burned a request rediscovering a refusal that was already on screen.
- **The donation target CNPJ is frozen at scan time.** Changing the active
  entity must never retarget an already-queued key.

  **One deliberate exception, and it is not a loophole:** `Config.redirecionarFila`
  moves queued notes off a CNPJ the server has **refused outright**
  (`cnpjEntidade`), and only ever from an explicit click on the refused-entity
  bar. The rule above exists to stop retargeting happening as a *silent side
  effect* of switching entity; this is neither silent nor a side effect, and for
  those notes the alternative to moving them is not "the original target" but
  nothing at all — the build used to delete each one from `nfpr:fila` as it was
  refused, erasing a whole offline batch on first contact with the server.

  It matches the refused CNPJ **exactly**, and that is the safety property, not
  an implementation detail. Entries with a null target resolve to the active
  entity at send time and are left alone; so is every note aimed anywhere else.
  Sweeping up a note that still had a working target files it under the wrong
  entity and nobody ever finds out, which is the same size of harm as losing it.

  **The rewrite has to reach the SEND POOL, not just the bar, and the order is
  load-bearing.** Notes park one at a time, as the pool feeds each to
  `processar` and it hits the refused-target check — so the click almost always
  lands while most of a restored batch is still *waiting*, never parked, holding
  the refused CNPJ in memory. `redirecionarPara` therefore takes
  `aguardandoEntidade` **and** `despacho.esvaziar()`, and it takes them in the
  same synchronous step as `entidadesRecusadas.clear()`: clearing the latch
  re-opens that check, and the pool keeps dispatching across every `await` that
  follows. Emptying it after the storage write leaves a window with the gate
  open and the old targets still queued, which is exactly the bug — a handful of
  doomed requests and the bar returning seconds after being fixed. Work already
  **in flight** cannot be recalled: it comes back refused, re-latches, and waits
  for a second click. That residue is bounded by `LARGURA_ENVIO`.

  **The same step also rewrites every note held somewhere else**: parked behind
  an outage (`aguardandoConexao`), behind a confused server
  (`aguardandoServidor`), or on a retry timer (`emEspera`). Each is released
  later by something other than this function (the watchdog, the probe, the
  timer), so its target is rewritten in place and it is left where it is. These
  notes used to keep the refused CNPJ, went out to it when released and
  brought the bar back, and unlike the in-flight residue nothing bounded how
  many there were. The session lists are left alone, because nothing leaves
  them on this load.

  A refused target is also a **latched condition**, per CNPJ — not a verdict on
  any note. Notes aimed at it park amber and stay queued; notes aimed elsewhere
  keep flowing, which is why this latches per CNPJ instead of pausing the pool
  the way a dead session does. Unlike the session latch it does **not** forget
  the key: nothing reloads here, so forgetting would let a rescan queue a second
  copy while the first sits parked waiting to be redirected.
- **All three stored records are serialized**, each through its own chain in
  `config.js` (`serializarConfig`, `serializarFila`, `serializarFalhas`, all
  made by `criarSerializador`): a scanner fires several keys per second, and
  interleaved read-modify-write cycles silently drop one. `Config.atualizarConfig` is the
  ONLY exported way to write config — it takes a patch, or a function for
  mutations that must read inside the lock. There is deliberately no exported
  whole-object write to reintroduce the lost-update bug.
- **One fresh form token per donation, never batched, never reused.** Tokens are
  short-lived and single-use. This has not changed and must not.
- **Sends go through a bounded pool, and the bound is ours.** `LARGURA_ENVIO` in
  `content.js` is the single knob (6 today); `despacho.js` is the scheduler, and
  dispatch order is strictly the order the notes were entered. Setting it to `1`
  restores the strictly sequential behaviour this codebase had before. Keep the
  knob — it is still the right lever if the site ever rate-limits, or a
  volunteer's connection cannot carry six in flight.

  **The form token is one slot per REQUEST — this is known, not an open
  question.** Concurrent donations each fetching their own token are safe; a
  second token fetch does not invalidate the first. This used to be written down
  as unmeasured, which invited exactly one wrong repair: dropping `LARGURA_ENVIO`
  to 1 to protect a resource that was never shared, throwing away the send pool
  for nothing. Do not reintroduce that reading.

  The cap cannot be delegated to Chrome's six-connection pool. `donation.js`
  arms its 20 s `AbortController` when *we* call `fetch`, not when Chrome
  dispatches it, so anything queued behind the browser's own limit burns its
  whole timeout untried and comes back as `SERVIDOR` — a fabricated outage that
  then trips the connectivity watchdog and parks the entire queue.

  **Two lanes, FIFO within each.** A note the volunteer just scanned goes out
  ahead of the backlog (`enfileirar(tarefa, urgente)`): someone is standing there
  holding the paper waiting for green, while the backlog is unattended and has
  two months of `emission + 2` left, so it cannot feel the delay. Among queued
  notes the order is still oldest-first, which is also nearest-deadline-first. A
  scan never preempts work already in flight — nothing is cancelled, so it waits
  at most one send.
- **The site's own entity dialog locks itself on a dead session, and the only
  cure available to us is not being there.** Its "Pesquisar" blocks the dialog
  with blockUI, POSTs, and on failure runs `JSON.parse(jqXHR.responseText)` — an
  empty string once the session is gone and the POST is 302'd cross-origin to
  the identity provider. The throw escapes jQuery 2.1.4's callback loop, which
  has no `try`/`catch`, so the `.always()` holding `desbloquearTela()` never
  runs and the overlay stays for the life of the page.

  We are in the isolated world, so their handler cannot be patched, and we do
  **not** reach into blockUI's own elements to undo it. The overlay is a child
  of the element we unhide, so hiding it again takes the stuck overlay with it —
  which is why opening that dialog belongs to `modal-entidade.js` beside the row
  scraping, and not to `modal.js`, whose banner says it renders and makes no
  request. `Sessao.conferir()` is asked before opening and again when a
  `.blockUI` child appears.

  **`conferir()` has three answers and exactly one of them acts.** `MORTA` is
  proof (`opaqueredirect`, 3xx, 401, 403); `INDEFINIDA` is a network failure and
  must never close anything, because a probe that could not ask has disproved
  nothing and shutting the dialog on a wifi hiccup fires when nothing is wrong.
  Its `redirect: 'manual'` is the load-bearing part and `smoke.js` asserts it:
  followed, the 302 lands cross-origin, CORS throws, and a dead session becomes
  indistinguishable from an unplugged cable — which is what trips the site's
  own dialog.

  **A proved-dead session is ANNOUNCED, not kept.** `aoDescobrirMorta` exists so
  the discovery reaches `pararPorSessao` in `content.js` and gets the treatment
  every other dead session gets: pool paused, waiting notes amber, the bar with
  the one "Entrar novamente" link, the alarm once. Discovered by a different
  door, it is the same condition — and a version that only closed the dialog
  left the volunteer reading about entity search while the queue behind them
  walked into a wall, with the only control that ends it nowhere on screen. Any
  future caller of `conferir()` inherits that instead of having to remember it.
  `modal-entidade.js` therefore narrates only the DIALOG (why nothing opened);
  the session is the bar's, as always.

  **The sentence it shows names no diagnosis.** *"Entre novamente no Nota Paraná
  para buscar entidades no site."* is reached both here and when the dialog is
  absent entirely, which is the duplicate-session screen — where the login has
  not expired at all. It replaced *"A busca de entidades do site não está
  disponível nesta página"*, which diagnosed the PAGE at the one moment the
  volunteer is already unsure whether the extension is broken.
- **The two global failures are latched conditions, not per-note verdicts.** A
  dead connection already worked this way (`informarQueda` reports whether the
  caller is the one who flipped the state); a dead session now does too. The
  first `SESSAO`/`SESSAO_DUPLICADA`/`ENCERRANDO_SESSAO` pauses the pool, empties
  the pending queue through `marcarSessao` without sending any of it, and sounds
  once. Rediscovering either per note is what turned a thousand-note drain into
  a thousand doomed round trips and a thousand error buzzes. No auto-resume for
  a dead session: logging in means navigating, which reloads the page and
  restarts the drain from the durable queue. **`/sair` settling latches it
  too.** It closes every session, ours included, and the bar already says so.
  Unlatched, the next note spent a request rediscovering it and repainted the
  bar with "expirou" over the sentence that said why.

  **A confused server is the third one** (`SEM_DIAGNOSTICO`, above), and the only
  one that resumes by itself: the probe is both the diagnosis and the recovery
  signal, which is the whole reason stopping is affordable there. Its bar is
  also the only one carrying no action — nothing on this machine can fix someone
  else's server, and a button could only lie about who is in control. A real
  success clears it too, since a success proves exactly what the probe asks for
  and arrives free.

  **Every enqueue goes through `enfileirar` in `content.js` — it is the one way
  in, and the latch checks live there and nowhere else.** Nothing may call
  `despacho.enfileirar` directly. The retry timer in `tentarDeNovo` did, with
  its own copy of the `sessaoMorta` check, and the half it left out was
  `servidorConfuso`: a retry firing after that latch closed landed in a paused
  pool. Nothing was lost — the note stays in `nfpr:fila` and goes out when the
  probe releases the pool — but it became the one note on screen that no
  surface accounted for, blue and still promising a retry, subtracted from the
  queue indicator by `contarEnviando` as work in flight, and missing from
  `aguardandoServidor`, which is what the bar counts. A second copy of a latch
  check is a copy that will be short one latch.
- **The volunteer can turn every local gate off, and that decision is FROZEN ON
  THE NOTE.** `enviarSemValidar` (default off) removes local refusal entirely:
  anything entered is sent, red and grey alike, and the kind of error becomes
  the server's business. It exists for accountability — "the extension decided
  not to send it" is not a defence anyone wants to give — and it deliberately
  reproduces the official page exactly. Blank input is the one
  exception and is not negotiable: the terminators are Tab and Enter and a
  scanner emits Enter on every read *including a failed one*, so the
  `typed.length > 0` guard in `capture.js` stays whatever the preference says.

  **The de-dup check is the one local refusal that survives as a WARNING rather
  than being dropped**, and the asymmetry is the point. Red and grey are
  verdicts on the note's digits, and the preference exists precisely to hand
  those to the server. A repeat is not a verdict on anything: it is the only
  thing in this extension that can tell a volunteer they are holding two copies
  of the same receipt, and nobody else will ever tell them — the POST does not
  detect a repeat, and the monthly reconciliation discards duplicates silently.
  So under the preference the check still runs, the note still goes out, and the
  repeat becomes a `duplicada` marker on the row plus the `aviso` ping. Dropping
  the refusal is cheap in a way dropping grey is not: a repeat costs a wasted
  request, never a lost donation.

  The marker is **scan-time only**, like `parteFixaIgnorada` and `forcado` and
  unlike `semValidacao` — "you already scanned this" is a fact about the moment
  of the scan, a restored queue makes no rows, and nothing downstream re-judges
  it. Keep it out of `nfpr:fila`. It is also a **separate** marker from
  `semValidacao` and must stay separate: that one says *we would have refused
  these digits*, which is false about a repeat of a perfectly good key, and it
  is the field that drops *"nenhum erro foi detectado"* from the failures page.

  **It is not a debug flag and must never be routed through
  `Debug.ajustarVeredito`**, tempting as that is — that hook sits at these exact
  gates doing this exact downgrade. Every debug hook is inert until the hidden
  mode is armed, and *Voltar à segurança* disarms all of them at once. A
  volunteer's preference has to work without either of those. Two independent
  mechanisms at one decision site, and a note can carry both markers.

  **The freezing is the load-bearing half.** `aceitar()` writes the local
  reading into the note's `nfpr:fila` entry (`semValidacao`), and `processar`
  skips its drain-time re-judge on that field — **never on a live read of the
  preference**. Read live, a toggle switched off after a batch was scanned would
  meet that batch on the next load and destroy every note in it, silently,
  because the row is indistinguishable from an ordinary refusal. Same rule and
  same harm as retargeting a queued note when the active entity changes.

  It is a **skip, not a downgrade**: that gate exists to avoid burning a request
  on a note whose digits already condemn it, and this preference is the
  volunteer asking for the request anyway. The de-dup side effects go with it —
  `bloquearChave` and `esquecerChave` both belong to a refusal that is no longer
  happening.

  The flag is truthy only for a note that **would have been refused**. A key
  that passes on its own merits carries nothing, whatever the toggle says: it
  means "this bypassed a gate", never "the preference was on". And the row it
  produces is **blue in flight like any other**, with the reading as a marker —
  a private colour would break the one thing the panel's colours are for, and
  red would be a lie, since nothing has refused it yet.

  **The marker survives the drain, unlike `forcado`.** The restore loop rebuilds
  `marcas` from the queue entry. Debug mode is allowed to be imperfect here (see
  above); a shipped preference is not, because the marker is the only thing
  keeping a forced send from reading as an ordinary one.

  It also breaks one thing downstream, and the fix is per-note rather than a
  reword: the failures page leads with *"nenhum erro foi detectado"*, true **by
  construction** for every other entry because nothing else reaches the POST. A
  bypassed note is the exception, so `nfpr:falhas` carries the flag too, the
  sentence is dropped as soon as one listed entry has it, and that card says so
  itself. Rewording it for everyone would cost every ordinary entry the
  reassurance that is the whole reason the page opens with it.
- **Four cues, and the verdict picks which one plays.** `erro` (harsh buzz),
  `aviso` (soft ping), `leitura` (low chime) and `sucesso` (high chime), each
  behind its own preference — a third gate was added with the third cue, or the
  toggles stop matching what plays.

  **The AudioContext stays armed until it RUNS.** Browsers start one only
  inside user activation, and Shift, Ctrl, Esc or a touchstart is not
  activation. `audio.js` used to create the context on the first
  keydown/pointerdown of any kind and stop listening, so a modifier pressed
  right after load left it suspended with `resume()` refused, and every cue was
  silent for the rest of the page. Its listeners now stay on until the context
  is `running`, skip a gesture `navigator.userActivation` says is not
  activation, retry `resume()` on each later one, and come back if the system
  suspends the context. **Do not "simplify" it back to a one-shot
  listener.** `smoke.js` drives a stub context that starts suspended.

  **`leitura` and `sucesso` are ONE INSTRUMENT IN TWO GESTURES** — identical
  triangle voice and envelope so they belong together, told apart by **note
  count and pitch**: leitura is a single F#5, sucesso is E5 rising to B5. The
  single lower stroke reads as the lesser event, which is the ranking wanted:
  registered beats read. Keep the envelope in step; the note count and the
  frequency are the parts that must not converge.

  **Audible first, distinguished second**, and that order was learned the hard
  way. `leitura` was first built to differ on every axis at once — a short flat
  sine blip — and was **inaudible in a room with people in it**. A cue nobody
  hears is worse than one resembling its neighbour, so never make either quieter
  or shorter in order to separate them; change note count or interval instead.

  At capture time the lineup is: **`leitura`** = read you and it looks right;
  **`aviso`** = read you, something is off, sending it regardless (a fixed part
  override, or a note the bypass is carrying past a verdict); **`erro`** = a
  refusal, and it belongs on an answer from the *server*. With `enviarSemValidar`
  off a red verdict still buzzes, because red still means *stop, read the paper
  again*.

  **FOUR IS THE WHOLE SET, and the live typing verdict adds no fifth.** It
  fires several times per note — at digit 2, 6, 20, 22, 35 — and a sound per
  span would be intolerable in a room of volunteers. It is text on the status
  line under the strip and nothing else. Do not give it one of the existing
  four either: `erro` belongs on a refusal, and nothing has refused anything
  while someone is still typing.

  **The offline page plays `leitura`, never `sucesso`.** It used to sound the
  success chime the moment a key was queued, so one sound meant "registered" on
  the live page and merely "written down" there — a registration that page can
  never make. It now gets the cue from the shared bootstrap, which also means
  the cue no longer waits for the durable write; that is right and costs
  nothing, since a failed write buzzes and says the note was **not** saved.
- **A drain is silent.** Tasks carry `origem`: `'scan'` sounds, `'fila'` does
  not. Nobody is standing at the scanner while a restored queue drains, so a
  per-note sound is unattributable — the same reasoning the verdict check in
  `processar` already applied, extended to send outcomes. Conditions still sound,
  once each, whatever the origem. Do **not** solve this with a rate limiter in
  `audio.js`: it would swallow the second buzz of two genuinely mistyped notes
  scanned back to back, which is the one case the sound exists for.
- **Pending work is a QUANTITY; the item list is a LOG OF OUTCOMES; the failures
  bar is a DURABLE RECORD OF NOTES THE SERVER REJECTED AND WE COULD NOT
  EXPLAIN.** Three surfaces with three jobs, and they must not be merged again.

  The **queue indicator** (`setFila`) says how much is still WAITING: a
  depleting bar, at every size. It subtracts **every row showing "Enviando…"**
  (`contarEnviando`), not the pool's in-flight count: a scanned note is blue from
  the instant it is read whether or not a slot was free, and so is one on a retry
  timer. Counting those on the bar too shows the same work twice ("3 notas na
  fila" beside three rows visibly going). Counted from the rows themselves so it
  cannot drift from what is on screen. Internally the queue count stays whole;
  only the display subtracts.

  **Any increase restarts the bar** rather than rewinding the fill. The panel
  owns the baseline — it is not a total handed in — because a bar is a promise
  about a batch of work, and notes scanned mid-drain are new work, not lost
  ground. Without the restart the fill lurches backwards on every scan, which
  reads as the extension undoing itself. The **item list** says what happened —
  its ROWS bounded at `LIMITE_LINHAS`, newest first, plain oldest-off-the-end
  eviction. Its RECORDS are not bounded by that; see the next bullet but one.

  **A note earns its row when it is in flight, not when it is waiting.** Waiting
  is the indicator's job — a row per waiting note is exactly what buried a fresh
  scan behind a thousand of them. But a note actually being sent is a thing
  happening now, so rows appear `LARGURA_ENVIO` at a time and turn green in
  place, and the pool is visibly working. `relatar` (in flight, and every final
  answer) makes a row; `noticiar` (retrying, parked behind an outage or a dead
  session) only paints one that already exists.

  A restored queue creates **no rows** on load.

  This replaced a design where every queued note got a row and rows were then
  rationed by a priority table. The two rules fight: a fresh scan is `enviando`
  and so are the rows it would have to outrank, so **scanning right after a
  reload showed nothing at all**, while the same scan worked once a few greens
  existed to evict. There is no priority table any more and there should not be
  one — it only existed to ration a resource that pending work should never have
  been competing for. A scanned note gets its row unconditionally, because that
  row is the volunteer's only confirmation the key was read.
- **Conditions are bars; only the note's own digits make it red.** A dead
  connection and a dead session say nothing about any individual note, so the
  note goes **amber** — "Guardada — será enviada quando você entrar novamente no
  Nota Paraná." —
  exactly like one scanned while the internet is down, and the remedy lives on a
  bar (`setSessao`) with the one click that fixes it, plus the error sound. Red
  is reserved for *this note is wrong, read the paper again*. Painting a session
  failure red on a thousand perfectly good queued notes claimed the opposite of
  what was true and buried the only actionable thing on screen.

  **One event, one narrator.** Two surfaces reporting the same thing is not
  merely redundant — it is how one of them ends up wrong. A duplicate-session
  banner used to narrate the `/sair` in three states while the session
  condition bar narrated it too: the same sentence twice, and then two
  different next steps, the banner's *"Atualize a página"* against the bar's
  *"Entrar novamente"*. The bar was right — `/sair` closes **our** session as
  well, which is why parked notes are relabelled session-expired rather than
  resent — so the banner was sending the volunteer to a logged-out page.

  **The banner is gone; `setSessao` carries the whole story.** What survived it
  is one line in `content.js`: paint the bar at load when `sessao.detectada` and
  the preference is off, because at that moment nothing has been sent and no
  note has failed to reveal the problem. It uses the **same sentence** as the
  per-note path, *"As notas continuam guardadas"* included — that clause is not
  a claim about notes already queued, it is the promise that makes it safe to
  start scanning, which is precisely what someone reading it at load needs. So
  `painel.js` no longer takes `opcoes.sessao` at all: it renders, and whose
  session is duplicated is not its business.

  A per-note ROW message is a different surface and does not count as a second
  narrator; a second BAR does.
- **Nothing opens itself, and first run on a duplicate session is finished FOR
  the volunteer.** The shared bootstrap used to end with
  `if (!temCnpj()) ui.abrir('config')`, so both registrars threw the settings
  form at a page nobody had looked at yet. The blocked card over the entry
  already says what is missing and offers one button; that is the same journey
  with the volunteer steering, which is the whole difference.

  The case that forced this is the extension's worst screen: **nothing
  configured AND a duplicate session**. Two calls to action at once, and the
  louder one is wrong — configuring then cannot verify the CNPJ, so it saves an
  **unverified** entity, which is precisely the starting state the
  refused-entity machinery exists to survive. So `content.js` takes the whole
  panel (`setTakeover`), says one sentence, and reloads when `/sair` settles.

  Three conditions, each load-bearing:
  - **Only with nothing configured.** With no entity the entry is blocked, so
    no note can be queued or in flight. A reload with work in flight throws
    away answers and re-sends whatever sat inside `removerDaFila`'s coalescing
    window.
  - **One automatic attempt per tab**, marked in the host page's
    `sessionStorage` and cleared on any load that is not the duplicate screen.
    `/sair` can fail to take, and the only sign is the server still reporting
    two sessions — so without this the sequence is take-screen, `/sair`,
    reload, forever, wearing a reassuring message. That is the worst way for it
    to break, because it looks like it is working.
  - **A counter, and it decides nothing.** `/sair` answers at **~10.4 s**
    (observed 2026-09-05, reliably enough to look like a fixed delay on their
    side), so the takeover counts ten seconds down and the counter very nearly
    IS the wait. The reload happens when the request RESOLVES and at no other
    time: expiring into a reload would cut `/sair` off just before it lands and
    leave the duplicate session exactly where it was. Do not add a timeout here
    — and nowhere else may treat this request as quick, either.

  This is **not** a licence to disable things during a bad session. The rule is
  narrower and goes the other way: *offer the degraded path only when the good
  path is unreachable.* On the offline page no session is ever coming, so
  saving an unverified entity is right and is the only path. Here the good path
  is one reload away, so taking it is not withholding a capability.
- **There is never a success counter. There IS a failure list.** These are not
  symmetrical, and the asymmetry is the point.

  **A success number is forbidden permanently**, and for a much stronger reason
  than "a number nobody needed to read", which is what this bullet used to say.
  `sucesso` means FILED, never CREDITED — the programme reconciles monthly and
  drops duplicates and ineligible notes then, reporting nothing. Any success
  total we display can disagree with what the volunteer is actually credited,
  and we would be the ones who said the wrong number. Green rows are the success
  feedback and they promise exactly what they can: *the site accepted this one.*

  **The failures surface is NOT the counterpart, and this is the sharp edge.**

  **The case it was built for**, before the rule that generalises it: every
  client-side check passed, the probe went and proved the server *healthy*, and
  the server still answered the shrug five times running. The reaper then
  deletes the note — correctly in general, since a healthy server that cannot
  file a note means an impossible note, and without that deletion it is retried
  on every reload for ever. But that inference is destroying **a note that looks
  perfectly fine**.

  **Be precise about which half is unknown**, because getting it backwards is
  what produced two wrong drafts of the interface text. The **outcome is
  certain**: the answer was not 200 OK + `sucesso`, so the donation was not
  made. What is missing is the **reason** — the digits are sound and every check
  passed, so nothing here can say why the server would not take it. Nobody
  anywhere will mention that note again; the paper is the only remaining copy of
  that donation, and the row saying so is about to scroll away.

  Three other outcomes reach the same end by a weaker route — an unread
  `chaveAcesso` sentence, an unread `mensagem`, an exception nobody classified,
  all destroyed on a guess once the budget runs out. Same standard, same list.

  It is not a log of everything that went red. Generalised, it is the residue of
  one invariant, which is the thing to keep:

  > **A note may only be destroyed if either nothing is owed, or something that
  > outlives a row is holding it.**

  Recognising an answer is precisely what buys a POLICY, and every policy here
  satisfies one half or the other. *Nothing owed:* a success; the three grey
  refusals, where the note is real and undonatable so no paper anyone finds
  changes it; `chave de acesso inválida`, which is deterministic. *Held:* a
  refused entity, a dead connection, a dead session, a confused server, a
  refused request — every one of those **keeps the note in `nfpr:fila`** and
  puts the remedy on a bar that cannot scroll away.

  What is left is the list: notes **destroyed with nobody holding them and
  something still to do**. No policy applied because none could be chosen, so
  the volunteer is the only actor left, and they cannot act on a paper they
  cannot find. **Listing every red row instead** would bury that handful under
  the many that are fully handled, which is the same mistake as giving pending
  work rows, one surface further out.

  **Every note on it passed every check we have**, by construction — nothing
  reaches the POST otherwise. That is why the page leads with *"os números estão
  certos"*: the volunteer did nothing wrong, and the reaction that loses the
  donation is concluding they mistyped it and binning the receipt.

  **The wording states the loss flatly and must not hedge it.** Exactly one
  answer files a donation — **200 OK with a `mensagem` containing `sucesso`** —
  so a note that reaches this list demonstrably was not filed, and the bar says
  *"N notas não foram registradas"*. An earlier draft said *"podem não ter
  sido"*, and the page was briefly titled *"sem resposta clara"*; both put the
  uncertainty on the wrong axis. **The answer was clear about the outcome and
  silent about the reason** — hence `SEM_DIAGNOSTICO`, which is named correctly,
  and the page title *"Erros desconhecidos"*. Hedging the outcome is wrong in
  the expensive direction: a volunteer who thinks a note probably went through
  puts the receipt on the done pile. The
  genuinely unknown case is an answer that never ARRIVED — a timeout, a dropped
  connection, where the server may have processed the request before we stopped
  listening — and it never reaches this list: those throw `REDE`/`SERVIDOR`,
  stay in `nfpr:fila` and are resent. That is where DOCS.md's accepted
  duplicate-donation risk lives, and the only place it lives.

  **And it says nothing about the printed receipts** — see the rule under
  *Conventions*. A draft of this bar read *"Separe esses papéis"* and the page
  told the volunteer not to discard them; both are out of scope, however
  well-meant. The bar states the count and nothing else, and the page reports
  what happened plus one fact about the software: scanning a key again is a real
  retry. What to do with the paper is the charity's process, not ours to
  direct.

  **The gate is `reconhecida`, not the colour**, and it is set at the SOURCE:
  `classificarResposta` in `donation.js` marks every branch that matched a
  sentence or a field, `concluir` in `content.js` marks unconditionally (each of
  its callers is our own table or a matched sentence), and the two sites writing
  their own message mark themselves. The catch-all in `content.js` deliberately
  does not — everything readable was handled above it. Do not pattern-match
  sentences at the panel: by the time a row renders a message, *read* and
  *relayed* look identical.

  **The flag is a proxy and can drift from the invariant.** A new branch that
  marks itself recognised and then deletes the note without parking it satisfies
  the flag and breaks the rule. When adding one, check what `content.js` does
  with it, not what `classificarResposta` called it.

  **`chave de acesso inválida` looks like the exception and is not**, which is
  worth writing down because the argument is not obvious. **A corrupted read
  cannot produce that answer.** The key's layout and its módulo-11 check digit
  are fixed by federal legislation, not by Nota Paraná — the site cannot change
  either — so our CDV test and theirs cannot disagree, and ours is otherwise
  the stricter. A mis-scan therefore either fails our net first (red toast,
  never sent) or passes both and comes back **`sucesso`**, which is the silent
  lost donation DOCS.md describes and not this. Reaching the branch means the
  digits are self-consistent and deterministically refused, so re-reading the
  paper yields the same digits and the same refusal.

  **Letters change none of this.** The server validates alphanumeric keys — a
  mistyped cDV on one gets the same sentence (observed 2026-09-28) — so the
  answer is as final there as on a numeric key. A retry-and-list exception for
  keys carrying letters existed until then, on the premise that their ASCII − 48
  mapping was unverified; it was removed on that observation.

  That the validation is legally fixed is also what keeps this rule stable. The
  *sentences* are the site's own and can be reworded at any time — but that
  direction is safe: a reworded refusal stops matching, becomes unrecognised,
  and lands on the bar rather than being quietly destroyed. It is a signal
  worth reading, too. A bar counting a large share of an ordinary batch means
  the contract moved, not that the batch was bad.

  **`Config.limparFalhas` is the one deliberate empty, and WHERE it lives is
  the whole design.** Entries otherwise leave only when their key registers
  later or when they fall off the cap, so a note the volunteer is never going to
  rescan kept the bar on screen for the rest of the install — and a red bar that
  can never be answered stops being read, which costs it the one job it has.
  The control is on the **page**, never on the bar: the bar still has no ✕,
  because a count that can be waved away without looking is a count nobody
  looks at, and reaching this button at all means the page was opened and the
  digits were seen. It is a **two-step** (the notes have already left
  `nfpr:fila`, so this record is their only trace and a misclick would be
  unrecoverable), and clearing returns to Configurações rather than leaving an
  emptied page open — the bar was its only door. If this ever moves, the thing
  to preserve is *looked at it first*, not the button itself.

  It is a list of notes still unregistered, not a tally of things that once went
  wrong, so **a key that later registers comes off it** (`Config.resolverFalha`,
  matched on the key). That is not a success counter by the back door: nothing
  claims a note was credited, only that this key is no longer among the
  unregistered — exactly as strong a claim as the green row already on screen.

  **One entry per KEY, not per note record.** A rejected key is unblocked, so a
  rescan produces a second note record for the same 44 digits;
  `Config.registrarFalha` updates the existing entry in place rather than
  pushing a second, which would report "2 notas" about one note. The entry keeps
  its position, so the list stays oldest-first.

  **It is durable, capped at `Config.LIMITE_FALHAS` (100), and carries the
  moment of INPUT.** Durable because these notes are gone from `nfpr:fila` and
  this is their only trace. Capped because it still cannot grow for ever, and a
  volunteer a hundred notes behind has a problem no list solves; oldest fall off
  the front. The timestamp is stamped in `adicionarNaFila` and travels through
  `nfpr:fila`, **not** stamped when the note failed — a batch scanned offline on
  Friday and drained on Monday has to be able to say Friday, because that is
  what places it in the volunteer's own day. Legacy entries have none and the
  line is omitted rather than back-dated.

  **Its wording states the loss flatly.** Anything other than 200 OK with a
  `mensagem` containing `sucesso` is the server actively rejecting the note, so
  it demonstrably was not filed and the bar says so without hedging.

  **And it says nothing about the printed receipts** — see the rule under
  *Conventions*. A draft of this bar read *"Separe esses papéis"* and the page
  told the volunteer not to discard them; both are out of scope, however
  well-meant. The bar states the count, the page reports what happened plus one
  fact about the software (scanning a key again is a real retry), and what to do
  next is the charity's process.

  The bar is **red**, alone among the bars, and the four amber ones are amber for
  a reason that does not apply to it: their notes are safe and still queued.
  These are out of the queue and the donation demonstrably did not happen.
- **The panel caps rows AND records, and an outcome that must survive goes to
  STORAGE.** `itens` and `porId` are both bounded by `LIMITE_LINHAS` (20 today —
  a knob at the top of `painel.js`, exported so `smoke.js` asserts against
  whatever it currently is rather than a hardcoded number); eviction is plain
  oldest-off-the-end and `atualizarItem` no-ops once a row is gone.

  That is only safe because **`content.js` writes a rejected-and-unexplained
  note to `nfpr:falhas` before it tells the panel anything.** It was not always
  so: with a pool six wide, a note that had `LIMITE_LINHAS` newer scans land
  before it answered had its terminal answer recorded **nowhere at all** —
  `atualizarItem` had nothing to update and returned. `smoke.js`'s assertion
  there once read *"updating a row that scrolled off the end is harmless"*,
  certifying the bug in writing.

  The fix was tried first as a longer-lived record inside `painel.js`, and that
  is the version to argue against: **a variable in the panel is not durable**,
  and an ordinary mid-batch navigation destroys it — the session bar's own
  "Entrar novamente" is a link that navigates the tab. If an outcome has to
  outlive a row, put it in storage, not in a longer-lived field in here. The
  panel's own contract says as much: *this file renders; it makes no request and
  reads no storage.* It is handed the list through `setFalhas`, exactly like
  every other bar.

  **Do not solve visibility by rationing rows.** Reserving the window's tail for
  `erro`, or evicting by priority instead of by age, is the priority table this
  panel already removed: a fresh scan is `enviando` and so is everything it
  would have to outrank, so scanning right after a reload showed nothing at all.
  Rejections leave the row budget entirely and get their own surface instead.

  **Newest-first is the panel's one ordering rule** — its own empty-list hint
  says so — and a drain does not get to invert it. The restore loop adds rows
  front-to-back like everything else, so the oldest note sits at the bottom and
  the work travels up the list. Rendering the queue backwards to put the
  next-to-send note on top makes the list read against every other surface and
  spends the row budget on the notes sent LAST, so the first ones out have no
  row at all.
- **A FIXED PART IS WORKING STATE, NOT CONFIGURATION**, and that decides where
  all of it lives. An entity is configuration: one per install, rarely changed,
  correctly beside the preferences. A fixed part is a piece of text with a
  lifetime of one sitting, so a settings modal was the wrong home and the
  toolbar popup was a worse one — that window has no key entry to use a fixed
  part with, so managing one there was managing it away from the only place its
  effect is visible.

  It lives on **the strip** now (`src/content/strip-parte-fixa.js`): one
  permanent line immediately under the 44 cells, on both registrars, which
  states what the next thing entered will be read as and IS the control that
  changes it. The judgement, the naming and every write are in `registrador.js`,
  which both registrars load and the popup does not — that reach is the
  constraint, not the filename. Its old settings section is gone;
  `settings-ui.js` composes two sections. `parte-fixa.js` stays in `popup.html`, unused: removing
  a loader line is a bigger change than 160 lines that cost nothing, and
  `chave.js` and `relogio.js` have to stay there regardless because `debug.js`
  uses both.
  - **The 44 cells ARE the preview.** The editor writes into the same display
    the volunteer will type a note into — one widget, not two — and opening it
    empties the entry, because otherwise a half-typed key sits in the buffer
    while the cells show a fixed part, and Enter would submit digits nobody can
    see.
  - **THE STRIP HAS TWO RESTING STATES, and only one of them is a status.**
    With nothing armed the label is an **invitation** — `+ Fixar o começo da
    chave`, carrying the `+` the popover's own footer uses and painted in the
    accent colour, because the hover state was the only thing saying the line
    could be clicked and that is nothing at all to someone who never hovers it.
    It used to read *"Chave inteira — 44 números"*: true, correct, and the
    answer to a question nobody had. It says what the volunteer DOES, in words
    about the receipt — see *Words for the fixed part* under *Conventions*. With a fixed part armed it goes back
    to being a status, because then there is something to know: which fixed
    part, and how many digits it leaves.
  - **THE WAY OUT IS ONE CLICK, ON THE STRIP, and it exists only while a fixed
    part does.** A fixed part puts digits in the cells that the volunteer never
    typed, and someone who has not met the feature reads that as the software
    being broken — so the escape cannot be two clicks deep inside a popover they
    have no reason to open. `Digitar a chave inteira` sits between the progress
    pill and the ▾, a fixed position because the pill comes and goes with the
    buffer and a control that is only wanted in an emergency has to be where it
    was last time.

    **It says what the two bars in `painel.js` already say**, verbatim. A fourth
    phrasing for one action is how people stop recognising it.

    It **deactivates, never deletes** — the fixed part stays in the list to be
    picked again — and the config change that follows runs `captura.reset()`, so
    a half-typed entry made under the old fixed part goes with it. That is the
    whole of "back to safety": cells empty, 44 of them, nothing armed.
  - **The popover's explainer shows only while there are no fixed parts.** It is
    for someone who has never met one, and once the list has fixed parts in it,
    it answers a question the list has already answered — from inside a frame
    that never scrolls, where two lines are two lines taken off every row below
    them. The concept is also stated by the strip's own invitation label and by
    the editor's live help.
  - **The fixed part's digits appear once per row.** An unnamed fixed part
    already shows them where a name would go, which is what makes a blank name a
    first-class state; repeating them in the sub-line cost the tier that grows
    on its own a second line each, on the list that had run out of room.
  - **A fixed part can be written as nothing but its prefix.**
    `ParteFixa.completar` pads to 44, so `'?'` is never needed in the common
    case; it exists for "and maybe some numbers further along" and is mentioned
    only in Ajuda. The old placeholder led with the escape hatch (`41…? (use ?
    para variar)`), which is what made the field read as a grammar rather than a
    piece of text. **Nothing about the key's field structure appears anywhere in
    the interface**: the volunteer compares two receipts, sees where they stop
    matching, and types up to there.
  - **Two tiers, and THE NAME IS THE TIER.** A fixed part that is merely *used*
    lands at the top of a ten-item recent list and is evicted once ten newer
    ones exist; a fixed part that has been **given a name** is saved — pinned,
    never evicted and never counted against the cap. `Config.parteFixaSalva` is
    the one definition (`!!nome.trim()`) and nothing else may ask the question.
    `Config.podarPartesFixas` is the eviction, it never drops the fixed part in
    use, and *"Limpar as não salvas"* — the one-click answer to a shared machine
    full of other people's fixed parts — skips the saved tier entirely. Which is
    also why **the stale marking on a row matters**: it is what tells a
    volunteer a saved fixed part has stopped being worth keeping, and the broom
    below is what acts on it. Do not drop it as redundant.
  - **THE FOOTER'S TWO BROOMS ARE CONDITIONAL, and neither is a wider version of
    the other.** Each is absent whenever its pile is empty: a control that clears
    nothing is not idle furniture in a frame this tight, it is a claim that
    there is something to clear — on the one surface a volunteer consults to
    find out whether there is. Both halves are silent when wrong, a button that
    never appears looking like a feature nobody built and one that always
    appears like a list that never gets clean.
    - *"Limpar as não salvas"* sweeps by **tier** and never touches a named
      fixed part, because that is what naming one promises.
    - *"Limpar as vencidas"* sweeps by **verdict** and takes **both tiers**,
      because a stale fixed part is worthless however carefully it was named —
      every note entered under it would die — and sparing the saved ones here
      would spare exactly the fixed parts it exists for. It is the bulk form of
      the *"Recomenda-se removê-la"* already on those rows.

    **It takes `EXPIRADA` and nothing else, and that is not the same as "every
    marked row".** A fixed part can be marked for a verdict that is not
    staleness at all — an out-of-state prefix, a CPF issuer — meaning it could
    never describe a donatable note; the editor refuses to save one, and the row
    that somehow holds one has its own `Remover`. Sweeping those under this word
    would destroy them under a sentence that never applied to them. The two read
    alike on the row (one amber line each), so the difference travels from
    `listaDePartesFixas` as **`vencida`**, beside the sentence rather than
    recoverable from it — nothing may match the sentence to decide what a button
    sweeps, for the reason the panel never pattern-matches messages either.

    Both answer to the **whole list**, never to what the filter is showing: they
    act on the whole list, and a filter is a way of looking at it rather than a
    setting on it.

    **There is no `salva` field and no ★.** Both existed, and together they made
    two gestures out of one intention: the glyph pinned without labelling and
    the name labelled without pinning, so the list could hold a pinned fixed
    part with nothing to call it and an unpinned one carefully named. Naming a
    thing is what keeping it means, so it is now the single gesture — and
    **clearing a name back to blank is the only way out of the saved tier**,
    which is the ★'s other half and must stay reachable.

    The row's first text button carries all of it: **`Salvar` while the fixed
    part is a recent, `Renomear` once it is kept**, opening the same field
    either way. `smoke.js` asserts both labels and both directions, because the
    label is picked at paint time and a wrong branch there is silent everywhere
    else.

    **THE TIER DECIDES EVICTION AND NOTHING ELSE. IT DOES NOT ORDER THE LIST.**
    Saved and recent used to be two blocks, saved first, and two blocks in one
    scrolling box means whichever comes first pushes the other off the bottom:
    the saved tier is uncapped, so twenty named fixed parts hid every recent,
    and leading with the recents only swaps which half disappears.
    Saved-vs-recent is a LIFECYCLE fact — *will this still be here tomorrow?* —
    and nobody is choosing along it at the moment the list is open.
    `listaDePartesFixas` in `registrador.js` therefore sorts by `usadaEm` and by
    nothing else: the fixed part just activated is first whatever tier it is in,
    and the two or three used this sitting stay at the top. The tier is still
    visible on every row, because it is what that first button says.
  - **Names are optional and a blank one is a first-class state.** An unnamed
    fixed part shows its own digits where a name would go, truncated to the last
    four groups with a leading ellipsis — every key starts `41`, so the tail is
    what tells two fixed parts apart. It is also the rename field's
    **placeholder**, for the same reason. **Do not default a blank name to
    `'Parte fixa'`**, which named nothing and made every unnamed fixed part look
    alike.

    Optional is not a contradiction of the rule above: unnamed simply *is* the
    recent tier. What the volunteer declines by not naming a fixed part is
    keeping it, which is exactly what a fixed part with a one-sitting lifetime
    should default to.
  - **Editing updates in place, with no guard, saved or not** — "small
    adjustments" is the use, and forking on every keystroke would be a mode.
    What makes that safe is that applying an edit pushes the OLD text to the top
    of the recents: free undo, one line, exactly how a clipboard behaves, and
    the reason it needs no confirmation.
  - **Warn while typing, refuse on Enter** — a fixed part that can only describe
    undonatable notes is worthless, and every note entered under it would die.
    **The fixed part field keeps its text on refusal and the key entry does
    not**, which looks inconsistent and is the opposite: a key is a *reading of
    a paper*, so the recovery is a fresh independent one; a fixed part is *text
    the volunteer authored*, there is no second source to re-read, and clearing
    it would mean retyping 22 correct digits because one was wrong.
  - **A fixed part fixes at least one digit AND leaves at least one to type**,
    and the two refusals are mirrors (`ParteFixa.temFixos` / `temVariaveis`).
    The first was missing for a while: a fixed part of nothing but `?` — one
    press of the space bar — saves nobody a digit, and it gave `rotuloParteFixa`
    no digits to name it by, so the strip read the empty label as *no fixed
    part*, hid `Digitar a chave inteira`, and still flagged every good scan as
    having ignored a fixed part. Everything that paints a fixed part assumes a
    non-empty label, which is true by construction only while this refusal
    stands.
  - **An empty "Nova parte fixa" applied is nothing at all.** Emptying the ARMED
    fixed part's field means *chave inteira*; emptying the field opened by
    `+ Nova parte fixa` means the volunteer changed their mind about a
    second fixed part, and must not disarm the first.
  - **The list popover lives in the REGISTRAR's shadow root**, not the settings
    overlay, so capture stays live and switching never feels like leaving the
    work. Row actions are text buttons and **always visible, never hover-only**:
    volunteers move between machines and use this occasionally, which is exactly
    the person a hidden affordance punishes.
  - **THE WHOLE ROW CHOOSES, and the radio is still the control.** The dot is
    14px beside a two-line block, and the person aiming at it is the same
    occasional user those actions are spelled out in words for — so the row
    carries the click and says so with the cursor. It takes **no `tabindex`**:
    the radio keeps the keyboard and the group, and a second tab stop for a
    choice that already has one is worse than none. Anything on the row with its own job keeps it — the radio fires its
    own change, and `Salvar`/`Renomear`/`Remover` and the rename field are there
    to do something other than choose. The already-chosen row is **inert**:
    re-choosing would restamp `usadaEm` and reorder the list under a click that
    asked for nothing. **Hover is neutral, never `--nf-blue-50`** — a row that
    turns the selected colour under the pointer reads as already chosen, on the
    one list whose whole job is saying which one is.
  - **Choosing scrolls the list home.** The order is last-use, so the row just
    chosen becomes the first one; left where it was, someone who picked from the
    eighteenth row is looking at whatever slid into the place they were, with
    nothing on screen saying the click landed. It belongs to the activation and
    **not to `pintarLista`**, which also runs for a filter keystroke and for a
    rename — holding the volunteer's place is the right answer to both, and only
    an activation reorders anything.
  - **The popover is a FIXED FRAME and only the rows scroll.** The whole box
    used to scroll, so on a long list *"+ Nova parte fixa"* — the one way
    to make a fixed part at all — sat a thousand pixels below the fold, and so
    did *"Limpar as não salvas"*. The header, the filter and the footer are
    pinned; the scrolling child needs `min-height: 0` or it pushes the footer
    out of the flex column instead of shrinking. **"Chave inteira" is pinned
    too**, at the top of the scroll (`position: sticky`): it is not a fixed part
    but the radio group's zero state and the destination of the commonest
    correction there is, so no filter removes it and no amount of scrolling
    loses it. Its `z-index` has to beat 1 — `.nfpr-btn-sm` is itself `position:
    relative; z-index: 1`, so at equal weight the row actions passing underneath
    win on DOM order and two buttons appear straddling it.

    The **maximum height is measured on open**, not written in CSS: the popover
    hangs off the strip and how far down the page the strip sits depends on how
    many condition bars are stacked above it, so a fixed height runs off the
    bottom of the viewport on exactly the screens with the most to say — taking
    the footer's two controls with it. Re-measured on `resize` while it is up,
    and guarded, because the smoke harness has neither a layout nor a window.
  - **The filter appears only once there is something to filter** (more than
    `StripParteFixa.LIMITE_SEM_FILTRO` fixed parts, 8 today). A search box over
    four rows is furniture that claims the list is longer than it is; over
    twenty it is the only way to reach the eighteenth. It matches **names and
    digits** — accent- and case-insensitively, because nobody hunting a fixed
    part spells it the way they saved it, and on digits because an unnamed fixed
    part has nothing else. Its placeholder does double duty and names the count.

    **It is NEVER focused automatically, and that is load-bearing.** This
    popover is in the registrar's own root precisely so capture stays live while
    it is open — a scan mid-list still registers — and a field that grabbed the
    keyboard on open would swallow the next barcode into a search box. Focus is
    a deliberate click, and while it is held the field claims the same cover the
    fixed part editor and the rename field take (`editando()`, read by
    `estaAtivo` in `registrador.js`); without that, every `Backspace` typed into
    it is eaten by the key buffer and the field simply refuses to be corrected.
    `Esc` backs out one step at a time — the search first, the list second.
    From anywhere else inside the list it closes the list and puts the keyboard
    back on the ▾; a rename field's `Esc` cancels the rename and stops there.
    Capture still speaks first: with digits in the buffer, `Esc` empties the
    entry and is consumed, and the list closes on the next one.

    The filter is **a way of looking at the list, not a setting on it**: closing
    the popover clears it, or the next open shows a subset for no visible reason
    and reads as fixed parts having vanished.
  - **A scan under an armed fixed part raises a CONDITION, not a per-note
    alarm.** The note that registered is the one that was actually scanned, so
    nothing is wrong with it; a large warning per note would fire two hundred
    times for someone who picked the scanner up mid-batch, and a warning that
    fires on success is one people learn to ignore. What is wrong is that the
    fixed part is still armed and no longer applies. The two existing per-note
    signals are unchanged — the `aviso` ping and the `⚠ parte fixa não usada`
    row marker — and the bar clears when the fixed part is dropped **or** when a
    note is typed under it, so it cannot get stuck on and a deliberate
    alternator is not nagged. **While the scan arrives the cells set the fixed
    part aside** — once the burst is confirmed they show the scan's own digits
    (from `raw`, since `typed` is capped), and submitting repaints them with the
    fixed part. Drawn with it, they showed the fixed part's fixed digits around
    the barcode's head: a key nobody scanned. Display only; the buffers and
    `ParteFixa.resolver` are untouched.
  - **The stale-fixed-part bar gains `Editar a parte fixa` as its primary
    action.** A fixed part whose month has passed usually needs two digits
    changed; until the editor existed, throwing it away was the only thing on
    offer.
- **De-dup rule:** a key is blocked while in flight or after success; a key whose
  attempt *failed* is forgotten, so rescanning it retries immediately. The
  offline page has no failure path, so its keys stay blocked for the session —
  the one intended difference between the two registrars, kept on the caller
  side of `registrador.js` rather than inside it. The record is maintained and
  consulted whatever `enviarSemValidar` says; that preference decides only
  whether a repeat is refused or announced on its row (see above).
- **The two registrars share `registrador.js` up to the durable queue.** What
  happens after is the whole difference: `content.js` sends, `entrada.js` stops.
  Do not fork the shared half again.
- **Every deliberate bypass lives in `debug.js`, and nothing else reads
  `nfpr:debug`.** The only reads anywhere are `NFPR.Debug.on(nome)` and
  `NFPR.Debug.valor(nome)`. Both files ship; what keeps a volunteer safe is that
  the mode is inert until armed, not that it is absent. `debug.js` holds the state and
  is DOM-free because it loads in the popup too; `debug-ui.js` holds the gesture
  and the form, and loads only where there is a registrar. The rules they keep:
  - **`chave.js`, `parte-fixa.js` and `cnpj.js` never see it.** They stay pure;
    each bypass belongs at the decision site that calls them. The verdict
    downgrade therefore sits in `registrador.js` (one call to
    `Debug.ajustarVeredito`), not inside `Chave.avaliar`.
  - **The banner is a condition, not a notification** — same contract as the
    stale-fixed-part bar: no dismiss control, repainted from the state on every
    change, so it can neither get stuck showing nor stuck hidden while armed.
  - **A forced row is never indistinguishable from an ordinary one.** The
    downgraded verdict carries `forcado`, which `painel.js` renders on the row.
    Scanned rows only: `marcas` is set in `aceitar()`, so a note restored from
    `nfpr:fila` on a later load comes back without the marker. Known, observed,
    and deliberately **not** fixed — debug mode is allowed to be imperfect where
    the alternative is carrying dev-only state through the durable queue. The
    guarantee is about the moment of the scan, which is when a person is there
    to read it.
  - **`simularEnvio` arms itself** whenever a bypass flag is switched on. Putting
    a fabricated key on the real server takes a second, deliberate call.
  - **A simulated success destroys nothing it did not create.** It answers
    "sucesso" with `simulado: true`, and `content.js` keeps it off the real
    success path, which removes the note from `nfpr:fila` and clears its
    failure record. A RESTORED note stays queued (amber row) and goes out for
    real on the first load without the flag; a SCANNED one is concluded as
    before, because the scan put it in the queue a moment earlier and a
    fabricated key left there would be POSTed once the mode is off. Neither
    releases the server latch nor clears a failure: nothing was proven.
  - **The form is unreachable unless the mode is already armed.** No header
    button leads to the `depuracao` modal page; the only way in is the
    `Cuidado!` link in the red banner, which only exists while it is on. The
    7-click gesture on the host page's `span.fn.org` arms it with *every flag
    off*, so the gesture alone cannot change how a note is judged. **Spelled
    out** (`FLAGS_PADRAO`), never `ligar({})`: `ligar` merges over what is
    stored and *Voltar à segurança* keeps the flags on purpose, so an empty
    patch re-armed whatever the last session left — a live red-key bypass.
  - Its own storage key, deliberately not a corner of `nfpr:config`.

### Persisted state (`chrome.storage.local`)

- `nfpr:config` → `{ versaoConfig, entidades[], entidadeAtivaId, partesFixas[],
  parteFixaAtivaId, preferencias{} }` — `partesFixas[]` entries are `{ id, nome,
  template, usadaEm }`. `nome` may be `''` and a blank name is a first-class
  state, never defaulted to `'Parte fixa'`; **it is also the tier** — a named
  fixed part is saved, and a saved fixed part is exempt from the recent-tier cap
  (`Config.LIMITE_PARTES_FIXAS_RECENTES`, 10) and from eviction
  (`Config.parteFixaSalva` is the one place that asks). There is deliberately no
  `salva` flag: a second field saying what `nome` already says is a second field
  that can disagree with it. `usadaEm` is stamped at activation and at edit and
  is the whole of the list's order — the tier decides eviction, never position.
- `nfpr:fila` → `[{ chave, cnpj, em, semValidacao }]` — donations awaiting/needing
  a resend across reloads. `semValidacao` holds the local reading of a note the
  volunteer's bypass carried past a verdict (a string), or null; it is frozen
  here for the same reason `cnpj` is, and `processar` reads it to skip its
  re-judge. `em` is stamped in `adicionarNaFila`, at the moment of INPUT,
  and travels with the note so a batch scanned offline on Friday and drained on
  Monday can still say Friday. Removals are **coalesced** over a 200 ms window
  into one read-modify-write: a settled note used to cost a full rewrite of the
  array, so a thousand of them cost a thousand serialized storage round trips
  behind the notes still being sent. A reload inside that window re-sends a note
  that already landed — the duplicate-donation trade DOCS.md already accepts.
- `nfpr:falhas` → `[{ chave, mensagem, em, semValidacao }]` — notes the server
  rejected with an answer `classificarResposta` could not read. Emptied by
  `Config.limparFalhas`, reachable only from inside the page that lists them. `semValidacao`
  travels from `nfpr:fila` so the page can stop claiming *"os números estão
  certos"* about a note that never passed a check. Written only by `content.js`, from
  the two paths that destroy a note, and **before** the panel is told anything.
  Capped at `LIMITE_FALHAS` (100, oldest off the front), one entry per key, and
  an entry leaves when that key registers later. Its own key, like `nfpr:fila`,
  so *Apagar configurações* cannot throw it away.
- `nfpr:debug` → `{ ativo, flags{} }` — debug mode only; written by nothing but `debug.js`

Defaults are merged on every read, so there is no install-time seeding and older
stored objects keep working as the schema grows. Legacy plain-string queue
entries are normalised on read — keep that migration path.

## Conventions

- **The floors are Chrome 109 and Firefox 115, and a newer feature ships with
  its fallback beside it.** No polyfills and no second code path: a fallback
  sits next to the line it backs up, behind `@supports` or `CSS.supports`, so a
  current browser never runs it. The list is the *Older browsers* table in
  `DOCS.md`. Two things follow. **`:has()` is not free** (Firefox 121): a rule
  naming it is dropped whole there, so never put it in a selector list with a
  selector that must survive, and anything that has to hold without it goes
  through `regrasPorControle` in `host-page.js` or an `@supports not
  selector(:has(a))` block. **And host access is not guaranteed** (Firefox
  grants it at install only from 127, and lets it be switched off in any
  version): the popup's notice is the one surface that can say so, because
  without the permission nothing else of ours runs.
- **Manifest V3 only.** No MV2 syntax. Use the `NFPR.api` shim with
  `async`/`await`, never callbacks.
- **Identifiers and user-facing strings in Portuguese; comments and docs in
  English.** Follow the existing mix (`obterConfig`, `adicionarNaFila`,
  `chave`, `entidade`, `parteFixa`). `README.md` and `PRIVACIDADE.md` are the
  two documents in Portuguese, because their readers are the public rather
  than whoever is changing the code.
- Every file is an IIFE with `'use strict'` that attaches to `NFPR`, wrapped as
  `})(typeof globalThis !== 'undefined' ? globalThis : self);`.
- Every file opens with a banner comment explaining *why* it exists and the
  non-obvious constraints it satisfies. Keep this up when adding files.
- **Never use `alert`, `confirm`, or `prompt`.** All feedback goes through the
  styled Shadow-DOM overlay, the registrar panel, or the popup.
- **No ARIA. None — no `aria-*` attribute, no `role`.** Not an oversight and not
  a to-do. The job this extension serves begins with *reading a printed
  receipt*: 44 small digits or a barcode on a creased strip of thermal paper,
  which has to be seen before the keyboard is touched at all. A volunteer who
  cannot see cannot do that job, with this extension or without it, and nothing
  a screen reader could be told on our side changes that. Screen-reader
  semantics therefore served nobody while costing upkeep — labels that drifted
  from the visible text, live regions that re-announced on every keystroke, and
  a `smoke.js` assertion whose only job was to pin an accessible name. They were
  stripped in one pass, and `smoke.js` fails if one comes back anywhere in
  `src/`. Adding one "to be safe" is adding cost with no reader at the end of
  it. Things that look similar and are NOT ARIA stay: `title` (a hover tooltip,
  for sighted mouse users — the chip's *"doando para"* lives there) and
  `inputmode` (which keyboard a touch screen shows).

  **Keyboard operation is a different question, and it is kept.** Not a
  keyboard-first design — a mouse that breaks in the middle of a sitting must
  simply not end the sitting. So: every control can be reached and worked with
  enough keystrokes; **the keyboard is never left on something invisible** (a
  control that hides itself hands focus to where the work continues — every
  bar and strip control hides through `esconder` in `painel.js` /
  `strip-parte-fixa.js`, which moves the keyboard to the entry only if it was
  inside what is hiding, so a bar clearing while the keyboard is in the
  overlay takes nothing from it — and the
  closed settings overlay is `visibility: hidden`, not just transparent, so its
  controls leave the Tab order); **while the overlay is open the keyboard stays
  inside it** (Tab wraps at both ends, `modal.js`); and **a repaint puts the
  keyboard back where it was** (the entity list rebuilds on every config change,
  and used to drop the keyboard on every choice made with it). `smoke.js` has a
  checkpoint for this, because every one of these failures is silent until
  someone presses a key.
- **The two documents are NF-e and NFC-e, and never "cupom fiscal".** NF-e is
  *Nota Fiscal Eletrônica* (modelo 55); NFC-e is *Nota Fiscal de Consumidor
  Eletrônica* (modelo 65). The acronyms alone are fine everywhere, on screen
  included. "Cupom fiscal" is informal for both (and for other papers),
  officially neither, and names the obsolete document these two replaced — so
  it must not be used as though it meant the 65, or at all.
- **Words for the fixed part.** The feature where a typist writes the repeated
  start of their keys once is the **parte fixa** (plural *partes fixas*) —
  on screen, in identifiers (`parteFixa`, `ParteFixa`, `partesFixas`), in
  storage, in class names, in file names, and as *fixed part* in English
  prose. One name everywhere; it is never a *modelo*, which already means
  55/65.

  **The wording says what the volunteer does, in terms of the receipt in
  their hand**: they write the repeated start once and type the rest of every
  note. The volunteer is the subject of these sentences, and they are about
  the key rather than about how much of it there is to type.

  The words in use are: **Parte fixa da chave** (the feature's name: the
  preference, Ajuda, the list's title), **+ Fixar o começo da chave** (the
  strip's invitation), **Escolher parte fixa ▾**, **+ Nova parte fixa**, and **Digitar
  a chave inteira** (the one-click way out, identical on the strip and both
  bars).
- **"Números" stays where it is a COUNT and goes where it is a CLAIM.** A key
  may carry letters now, so a sentence asserting that one contains only numbers
  is false. But letters reach a key only from CNPJs registered after 07/2026,
  and only for new inscrições, so very nearly every note a volunteer will ever
  hold is all digits — and *caracteres* is a colder word than *números* for
  someone comparing a screen against a creased receipt. The line is drawn by
  what the sentence is DOING, not by whether the word appears:
  - A **count** stays. *"Chave inteira — 44 números"*, *"só 22 números por
    nota"*, the progress pill. None of them describes what a key contains; they
    say how much there is of it, and *"44 caracteres"* would be jargon bought
    with nothing.
  - An **instruction** or a **validity claim** changed. *"digite os 44
    números"* → *"digite a chave de acesso"* (the panel's empty hint and Ajuda);
    *"A chave deve conter apenas números"* → gone, since `FORMATO` no longer
    has its own sentence; `COMPRIMENTO`'s toast → *"A chave de acesso precisa
    ter 44 caracteres."*; *"o CNPJ tem 14 números"* → *"14 caracteres"*;
    *"CNPJ inválido. Confira os números."* → *"Confira o número digitado."*; the
    live verdict's red *"Confira os números."* → *"Confira a chave de
    acesso."*; the fixed part's four verdict sentences (month, future date,
    state, issuer CNPJ) → *"Confira o que foi digitado."*; the fixed part
    field's *"Escreva os números que se repetem"* → *"Escreva a parte que se
    repete nas chaves"*; the editor's *"N números fixos"* → *"A parte fixa tem
    N"*.

  Chasing the rest would spend jargon on every volunteer, every day, to be
  precise about a case almost none of them will meet.
- **Error messages are plain text, jargon-free, and actionable.** When an action
  helps, attach a structured `link: { href, rotulo }` that the UI renders as a
  real anchor — no HTML strings travel through the app.
- **A message says whose verdict it is.** A row's status line can carry a
  sentence this extension decided or one the site decided, and they used to be
  indistinguishable — "Fora do prazo para doar" from our own `REGRAS` and the
  same sentence from the server mean different things to whoever is reading a
  volunteer's report, because only one of them is ours to fix. Server-side ones
  carry `fonte: 'nfprweb'` and the panel renders a muted `[nfprweb]` prefix as
  **its own `<span>`** — provenance, not part of the sentence, and the message
  keeps going through `text:` on its own.

  **Stamped on the way OUT of `classificarResposta`, in one place**, rather than
  written into ten object literals — so a branch added later cannot forget it,
  and nothing ever pattern-matches sentences at the panel, where *read* and
  *relayed* look identical.

  Provenance is **where the failure was decided, not who wrote the words**: the
  two fallback sentences (*"O site respondeu sem informar o resultado"*, *"O site deu uma resposta inesperada"*) are ours, written because the site gave us
  nothing to relay, and they take the prefix — they stand in the slot a server
  sentence would have occupied. Nothing outside that function is tagged, and
  that line is the useful one. The `Guardada — …` messages describe what *this
  extension* is doing next and are entirely ours to reword; `simularEnvio` is
  untagged because nothing was sent and its sentence already says "Simulação:";
  `respostaForcada` *is* tagged, since it is routed through the real table
  precisely to look like the server.
- **NEVER instruct the volunteer about the printed receipts.** This extension
  reports what was registered and what was not. Sorting, keeping, setting aside
  or discarding the paper in front of them is the charity's own process and none
  of our business, and a message that directs it is out of scope however
  well-meant. "Separe esses papéis", "não jogue fora", "procure o papel" — all
  forbidden, and all were written once and removed.

  What *is* ours to say: what happened to a note, what our own checks found, and
  what this extension will do next (a key is unblocked, so scanning it again is
  a real retry; a note is queued and will be resent). Those are statements about
  the software. Everything about the physical paper is a statement about someone
  else's workflow.

  The distinction is easy to lose because the *reasoning* behind several verdicts
  is legitimately about paper — red exists because re-reading a receipt recovers
  a donation, and `DOCS.md` says so at length. That is rationale, in a
  document for maintainers. It must not turn into an instruction on screen.
- `NFPR.el`'s `html:` prop is for **trusted static markup only** (inline SVG
  icons). Anything derived from the server, storage, or the volunteer goes
  through `text:`.
- Keep modules single-purpose. `chave.js` and `cnpj.js` stay pure — no DOM, no
  storage, no side effects.
- If you add a file, register it in the right `content_scripts` array in
  `manifest.json` **after** its dependencies.

## Reference material

`reference/` holds a saved copy of the government's own donation page —
`doacao.htm` plus its asset folder, including the site's own
`doacaoDocumentoFiscal.js.download` and
`consultaEntidadeDoacaoDocFiscal.js.download` — and one of the
duplicate-session screen, `doacao_sessao_duplicada.html`. It is
**git-ignored**: it is Nota Paraná's code, not ours, kept locally so the
observed protocol described throughout this file (and in `DOCS.md`) can be
checked against the actual government markup/script instead of memory. Treat
it as read-only ground truth for "what does the site actually do", never as
something to copy from — our own code stays independent and
Shadow-DOM-isolated per the rules above.

**A fresh clone does not have it, and you make your own with your own login.**
Log in to Nota Paraná, open the donation page
(`/nfprweb/DoacaoDocumentoFiscalCadastrar`) and use the browser's *Save page
as… → Webpage, Complete* into `reference/` as `doacao.htm`; Chrome writes the
scripts beside it as `doacao_files/*.js.download`, which is where those file
names come from. Do the same on the duplicate-session screen (the one the site
shows when the account is already open somewhere else) as
`doacao_sessao_duplicada.html`. Nothing here needs the folder to run — the
extension, `tools/smoke.js` and `tools/empacotar.js` never read it.

**It is worth the two minutes when working with a coding agent.** With the
folder in place the agent can read the site's real markup and scripts and check
a claim about them, instead of reasoning from what this file remembers; without
it, every question about what the site does is answered from memory.

**A page saved while logged in carries your name and CPF.** That is the other
reason the folder is ignored: keep it out of commits, issues and anything
pasted elsewhere, and do not copy a value from it into the docs as an example.

## Working style in this repo

State the filenames you are modifying and briefly explain the logic change
before outputting code.
