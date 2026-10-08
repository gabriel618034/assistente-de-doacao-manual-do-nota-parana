# Assistente de Doação Manual do Nota Paraná — engineering documentation

A Manifest V3 browser extension (Chrome/Edge/Brave 109+ and Firefox 115+) that turns the
Nota Paraná **manual donation** page into a fast workspace for registering
44-digit access keys (*chaves de acesso*) of NFC-e (Nota Fiscal de Consumidor
Eletrônica, modelo 65) and NF-e (Nota Fiscal Eletrônica, modelo 55) — typed,
pasted, or read with a handheld barcode/QR scanner.

The users are **non-technical volunteers**. Every user-visible
string is Brazilian Portuguese, plain language, no jargon. Identifiers and
comments in the source are a deliberate mix: Portuguese for domain nouns
(`chave`, `entidade`, `parteFixa`), English for prose.

**Why it exists.** The donation page files what it is given and settles what
counted later: the endpoint checks only part of a key, `sucesso` means the
claim was filed rather than credited, and the monthly reconciliation that
decides reports nothing back. None of that is changed by a browser extension.

What *is* fixable is **when the volunteer finds out**. A digit misread off a
creased receipt is accepted by the site as readily as a good one — so the panel
goes green, the paper goes on the done pile, and a real donatable note is quietly
lost. Catching that in the second it happens, while the receipt is still in
someone's hand and reading it again still fixes everything, is what most of the
validation in here is for. The eligibility verdicts are the same instinct
applied further out: say so now, rather than let a batch process discard it in
silence months later. Much of the design only makes sense read that way — see
[the contract](#the-nota-paraná-contract).

> **This is the engineering document, and the only one.** It describes the
> extension **as built**, in English, for whoever is changing the code — a
> person or a coding agent. `README.md` is the short Portuguese front page for
> people arriving at the repository, and `PRIVACIDADE.md` is the privacy
> statement; neither carries engineering detail. `CLAUDE.md` holds the
> load-bearing engineering decisions and is the one other file worth reading
> before changing anything; `TODO.md` lists ideas that were specified once and
> never built. There is no separate specification — the two large documents
> that used to live here disagreed with the code and with each other, which is
> worse than having none.

---

## Contents

- [What it does](#what-it-does) · [Install](#install-developer--unpacked) ·
  [First use](#first-use) · [Permissions](#permissions)
- [How it works](#how-it-works) — architecture, load order, persisted state
- [Sending everything anyway](#sending-everything-anyway) — the no-local-checks preference
- [The Nota Paraná contract](#the-nota-paraná-contract) — the observed protocol
- [Modo de depuração](#modo-de-depuração) — the development-only bypasses
- [Manual test checklist](#manual-test-checklist) — **this is the test suite**
- [Edge cases](#edge-cases) · [Out of scope](#out-of-scope) ·
  [Known gaps](#known-gaps)

---

## What it does

**Registrar on the page.** The extension replaces the contents of the donation
page's `#main` with its own panel, so scanning needs nothing opened first: a live
44-cell key display, the results list (newest first), counters, and a status bar.

**Capture.** A document-level, capture-phase keystroke listener — not an
`<input>` — so it never drops a character from a scanner burst and never steals
keystrokes aimed at the site's own form fields. A run of four gaps under 35 ms
in a row means machine input — one or two is a hand rolling across adjacent
keys; 250 ms idle ends a scan. Enter or Tab submits, and a scanner's extra
terminators behind a read are swallowed as that same submission. Ctrl+V pastes. A QR-code
URL is accepted whole and the key extracted from it.

**Validation before any request.** 44 digits, numeric, módulo-11 check digit, and
a `41` (Paraná) prefix. A failure is a plain-language toast, never a request.

**...and while you type, not only at the end.** The same table judges a
half-typed key by skipping the checks whose spans are still unknown, so a wrong
state code is reported at digit 2 and an out-of-state receipt at digit 2 rather
than after 44. It is one line of text under the entry: silent, blocking nothing,
and superseded by the real verdict when you press Enter.

**Fixed parts.** For a batch of similar notes, fix the repeating part of the key
and type only what changes. It is a strip immediately under the 44 cells — what
the next note will be read as, and the control that changes it — with those same
44 cells as the editor's preview. **Fixed parts are for typing, and only for
typing** — a scanner must not be used while one is active, and the extension
warns when it detects that happening. A full 44-digit key arriving by scan or
paste does override the fixed part rather than being mangled by it, but that is
damage control for a mistake, not a feature to rely on: see
[Fixed parts are for typing](#fixed-parts-are-for-typing).

**Entities.** One or more beneficiary CNPJs, verified against the site's own
registry, with one active at a time. They can also be captured by clicking a row
in the site's own entity-search dialog. **The target CNPJ is frozen when a key is
scanned** — changing the active entity never retargets a key already queued.

**Sending.** A bounded pool — at most six donations in flight, dispatched in the
order the notes were entered, each with its own fresh single-use form token. Nine
server response shapes are classified into six outcomes the volunteer can act on.
A dead connection or a dead session stops the queue once instead of being
rediscovered note by note.

**Durable queue.** Keys survive a reload, a crash, and an outage. A network or
server failure parks the note and resends it automatically once a probe proves
the site is reachable again — no reload, no volunteer action.

**Offline.** When the donation page cannot load, the browser lands on a bundled
offline registrar that captures and queues keys but never sends. The next time
the live page opens with a connection, its drain loop picks them up.

**Feedback.** Four distinct sounds — error, warning, *key read*, and *registered
by the site* — each with its own switch, plus a
screen flash per submission, and a toolbar badge showing how many keys are still
pending — visible even with every page closed. Four is the whole set: the live
typing verdict is deliberately silent, because it fires several times per note.

**A note that looks fine and vanishes anyway is still reported.** Sometimes every
check passes, the site is provably up, and it still answers in a way nothing here
can read. The note is eventually given up on and dropped — its digits are
perfect, so nobody would ever guess, and it was definitely never donated. Those
are counted on a red bar, with the key of each one a click away. Refusals the
extension *can* account for do not go there; their row already says what
happened. The results list is a bounded scrollback, so at the end of a long batch
it holds none of this — which is exactly when it matters most.

---

## Install (developer / unpacked)

There is **nothing to build** — no bundler, no `package.json`, no test runner.
Load the folder as-is.

### Chrome / Edge / Brave

1. Go to `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this project folder (the one containing
   `manifest.json`).
4. Pin the extension and open the donation page.

Chrome shows a yellow warning on the extension card:
**"'background.scripts' requires manifest version of 2 or lower."** This is
expected and harmless — Chrome ignores the key and runs the service worker
normally; the card's **service worker** link under *Inspect views* confirms it is
alive.

**Chrome before 121 refuses this folder**: there the same message is an error,
not a warning. Load the unzipped `chromium` package from
[Store packages](#store-packages) instead.

### Firefox (115+)

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose the `manifest.json` file.
   (Temporary add-ons are removed when Firefox closes. For a permanent install,
   the package must be signed via AMO.)
3. **Before Firefox 127 only:** open the toolbar popup and click *Permitir no
   site do Nota Paraná*. Those versions install an MV3 extension with its host
   permissions switched off, so until then no content script runs. See
   [Older browsers](#older-browsers).

> One manifest serves both browsers: `background` declares `service_worker`
> (used by Chrome ≥121, which ignores `scripts`) **and** `scripts` (used by
> Firefox, which runs the background as an event page). Same file either way.
> Do not split it into a `manifest.firefox.json`.

### Store packages

Neither store accepts the other browser's background key — the Chrome Web Store
refuses `background.scripts`, and Firefox will not load an MV3 manifest with only
`service_worker`. So the upload is not this folder but a package derived from it:

```
node tools/empacotar.js
```

writes `dist/assistente-nfpr-chromium-<versão>.zip` (only `service_worker`, no
`browser_specific_settings`) and `dist/assistente-nfpr-firefox-<versão>.zip` (only
`scripts`). Everything else is copied byte for byte; only `manifest.json`,
`icons/` and `src/` go in. It is not a build step — development and testing load
this folder directly, exactly as above, and never need it.

AMO also requires every new extension to declare its data collection
(`browser_specific_settings.gecko.data_collection_permissions`, since
2025-11-03), and the script refuses to write a Firefox package without it. The
declaration is `"required": ["none"]` — the claim made under
[Permissions](#permissions): nothing leaves the browser except the requests Nota
Paraná's own page makes. `PRIVACIDADE.md` says the same to the public. If that
ever stops being true, all three change together.
Firefox reads the key from 140; 115–139 load the manifest regardless, and AMO's
validator warns that `strict_min_version` is below 140. The warning does not
block submission, and with nothing collected there is no consent screen for
the older versions to lack.

### Checking a change

Verification is manual — see the [checklist](#manual-test-checklist). One thing
can be checked without a browser:

```bash
node tools/smoke.js
```

Each checkpoint reports how many assertions it ran; `--verbose` names every one
as it passes, which is how to answer "is this covered?" without reading the
file.

It loads every module in manifest order against stubbed browser globals (so a
load-order mistake fails there rather than on a volunteer's machine), builds the
real UI and settings form, and asserts the pure logic — CDV, key extraction from
a QR URL, the field parser, every verdict against a **fixed** date, the two
accepted models and that no série or tpEmis is judged, fixed part arithmetic, CNPJ/CPF validation,
that a scanned key beats an active fixed part, and that
[debug mode](#modo-de-depuração) ships inert. It covers none of the network
layer and nothing needing the live site.

It covers timing only through a movable `performance.now()` stub — enough for
the 35 ms scanner heuristic and the 250 ms idle, nothing more. That stub used to
return 0, which made every synthetic keystroke gap 0 ms and hid two rules
outright: that a machine burst discards a human's leftovers, and that the live
typing verdict stays silent during a scan.

And there is `tools/preview.html`, which is not a test. It stubs
`chrome.storage.local` and `chrome.runtime.getURL` and then loads the offline
page's own module graph, unchanged, so the registrar can be **looked at** in a
plain browser with no extension installed — where the 44 cells wrap at a narrow
width, the strip, the fixed part list, a bar's wording. Serve it over http
(`python -m http.server 8000` from the repository root); opened as `file://`
its stylesheet fetches are refused as CORS. Neither file ships.

Its regression guard for all of the above is one scanned key per grey reason —
expired, another state, a CT-e, a pessoa-física issuer — each asserted to
survive an active fixed part and come back `inelegivel`. If someone ever makes
one of those red, that is what fails: a volunteer would be sent back to a
receipt with nothing wrong with it.

It also drives real keystrokes through the shared bootstrap and checks that each
verdict reaches the right branch, which is what pins the fixed part/scanner rule
end to end — a corrupted scan under an active fixed part must produce a toast
and no row, never a key composed from the fixed part.

It pins which SOUND plays at capture time, and drives a second registrar with
*Enviar sem verificação prévia* on — the half that had no coverage of any kind:
that red and grey both reach the queue rather than being refused, that a repeat
is sent but still announced as a repeat, that a clean key under the same
preference stays unmarked, and that `nfpr:fila` freezes the reading on exactly
the notes that bypassed a gate. That last one is what makes
the feature survive a reload, and getting it wrong destroys a whole offline
batch silently. It also checks that every classified server answer carries its
provenance and that a simulated one does not.

It drives `content.js` too, in a `vm` context of its own: seed a queue, load the
orchestrator, and its own restore loop replays the notes through the real send
pipeline against a stubbed server. That is the drain — the largest thing here
that had no coverage at all — and the case it pins is a note the bypass carried
past a verdict still being sent after a reload, while an ineligible one beside it
is still refused without a request.

A thousand notes go through the panel too, which is where the rows-versus-records
split is pinned: every scan gets its row, the list stays bounded, the queue
indicator never creates one, and a note whose row was **evicted while it was
still in flight** still records its failure with its digits, exactly once. That
last assertion used to say the opposite — "updating a row that scrolled off the
end is harmless" — and was certifying a lost outcome in writing. It is driven
through `content.js` now, for both paths that write `nfpr:falhas` (an answer
nobody could read, and an exception nobody classified), because checking the
record through `Config` alone passed with the orchestrator never writing it.

The declarations CLAUDE.md calls load-bearing are checked as declarations: the
CSS `host-page.js` hands the page, `box-sizing: border-box` on every element
given a written height, the closed overlay's `visibility: hidden`, and
`entrada.html` never loading `donation.js`. Each of these, and each orchestrator
rule the script claims, was broken one at a time in a copy of the tree to see
the script fail; the audit found half of them passing.

Debug mode ships with the extension, hidden behind its gesture, so `smoke.js`
expects `NFPR.Debug` and `NFPR.DebugUI` like any other module and checks that
debug mode is inert until it is armed.

---

## First use

1. Click the extension's toolbar icon, or **Configurações** in the registrar's
   header.
2. Add your institution by its **CNPJ** (it validates as you type and shows the
   official name the site has for it). There is no name to type: the name comes
   from the site, and an entity saved while the site could not be asked is shown
   by its CNPJ until the next time it can. Whichever you add last becomes the
   active beneficiary.
3. Start **scanning or typing**. Press **Enter** (or **Tab**) to send — scanners
   do this for you. **Esc** empties the entry.
4. *(Optional, and only for typing)* If a batch of notes all start with the same
   numbers, click the line just under the 44 boxes and write that part once —
   then you type only what changes. The 44 boxes above show you what it will
   do while you write it.

Colours in the results list: **green** = registered, **red** = rejected (see the
message), **grey** = a real note that cannot be donated (past the deadline,
another state, a document type the programme does not take), **blue** = sending,
**amber** = saved, waiting for a connection.

A message that came from the site — rather than from this extension's own
checks — carries a muted `[nfprweb]` in front of it. It is provenance, not part
of the sentence; read straight past it.

A note whose answer the extension could not read also joins the red **"N notas
não foram registradas."** bar above the list. Its **Ver detalhes** button lists
every one with its key and whatever the site did say, and states plainly that the
numbers on them were correct and the donation did not happen. Scanning one again
is a real retry. A rejection the extension *can* account for — "chave de acesso
inválida", a note past its deadline, no entity configured — does not go there;
its row already says what happened. A key that registers on a later attempt
leaves the list by itself, and **Limpar a lista** at the foot of that page
empties it deliberately — the bar itself has no dismiss, so clearing means
having looked.

The extension stops there, deliberately: it says what registered and what did
not, and never tells anyone what to do with the printed receipts. That is the
charity's own process.

---

## Permissions

- `storage` — saves your CNPJs, fixed parts, preferences, and the pending queue.
- `declarativeNetRequest` — redirects the donation page to the bundled offline
  registrar while there is no connection (main frame, that one URL only).
- `webNavigation` — watches navigations to the donation page so a failed load
  can be swapped for the offline registrar instead of an error page.
- host access to `https://notaparana.pr.gov.br/nfprweb/app/v1/*` — lets the
  toolbar popup and the offline page confirm an entity's name by CNPJ.
  Donations themselves need no host permission: they are sent by the content
  script, same-origin, on the page you are already logged into.

No data leaves your browser except the requests sent to Nota Paraná itself — the
same requests the website makes.

### Older browsers

The floors are **Chrome 109** (the last version for Windows 7 and 8.1) and
**Firefox 115** (the ESR those systems stay on). Nothing is polyfilled; each
newer feature has a fallback beside the line that uses it, and a current
browser runs none of them.

| Feature | Missing in | What happens there |
|---|---|---|
| Host permissions granted at install | Firefox < 127 | The popup shows an amber notice with *Permitir no site do Nota Paraná*, which calls `permissions.request`. Until it is granted no content script runs, the offline redirect does not fire and the popup cannot look an entity up. The same notice appears in any Firefox where the access was switched off by hand. |
| `:has()` | Firefox < 121 | `host-page.js` appends the three presence-keyed header rules without it at `DOMContentLoaded`, for whichever of the site's controls exist. The account pill presses without its two lines moving. The entity row's focus ring follows `:focus-within`, so it also shows after a click. |
| `zoom` | Firefox < 126 | Below 500px the Celepar mark is halved with `transform`, from its right edge. |
| `scrollbar-width` | Chrome < 121 | `ui.js` appends one `<style>` with `html::-webkit-scrollbar{display:none}`. |
| `action.setBadgeTextColor` | Chrome < 110 | The badge keeps the browser's default text colour. |
| `background.scripts` beside `service_worker` | Chrome < 121 | The repository folder does not load; the `chromium` package does. |

Firefox 115 and Chrome 109 were both run by hand (2026-10-08). `smoke.js` covers
the `:has()` fallback's choice of rules and nothing else here.

---

## How it works

Everything hangs off one namespace, `NFPR`, assembled by load order. There are no
modules and no imports: plain classic scripts, each an IIFE that attaches to
`NFPR`, in the order declared by `manifest.json` (and mirrored by `popup.html`
and `entrada.html`).

```
src/shared/     used by content scripts, the popup, and the offline page
  browser.js        cross-browser api shim + creates NFPR   (MUST load first)
  debug.js          modo de depuração: the flags and their state (no DOM)
  site.js           every URL and sentence of the Nota Paraná contract
  dom.js            NFPR.el — the only DOM builder — brand mark, key grouping
  cnpj.js           CNPJ (and CPF) check digits / format / strip
  chave.js          pure key logic: CDV, extraction, parsing, the verdicts
  relogio.js        the current month in America/Sao_Paulo — the only clock
  parte-fixa.js     pure fixed-part logic: normalise, pad, count, compose, resolve
  config.js         storage schema, defaults, durable queue, change events
  entidade.js       entity lookup and THE one entity-save path
  connectivity.js   reachability probe + outage watchdog (both surfaces)
  registrador.js    the bootstrap both registrars share — and every fixed part:
                    judgement, naming, and the live verdict while typing
  sec-entidades.js  \
  sec-preferencias.js >  the two settings sections
  settings-ui.js    composes them and owns the storage subscription
  tokens.css        the design tokens, declared once
  settings.css

src/content/    injected only on Nota Paraná pages
  host-page.js      the only file that touches the government document (no NFPR dependency)
  audio.js          Web Audio cues
  capture.js        document-level capture-phase keystroke engine
  donation.js       token fetch + POST, friendly error normalisation
  despacho.js       the bounded send pool: FIFO, N in flight, pausable
  sessao.js         duplicate-session detection + /sair
  strip-parte-fixa.js  the strip under the 44 cells: what the next note will be
                    read as, the fixed part editor, the saved/recent list
  painel.js         the REGISTRAR panel
  debug-ui.js       the 7-click gesture + the debug form
  modal.js          the settings / ajuda / notas-não-registradas / depuração overlay
  ui.js             composes painel + modal, owns the shadow roots and mounting
  modal-entidade.js scrapes CNPJs from the site's own search dialog
  conta-corrente.js duplicate-session screen → back to donating
  content.js        orchestrator: the send pipeline
  base.css  registrar.css  modal.css

src/offline/    bundled offline registrar page (entrada.html/.js/.css)
src/popup/      toolbar popup (configuration only)
src/background/service-worker.js   toolbar badge + offline redirect
tools/smoke.js  optional; not part of the extension
tools/preview.html  the registrar in a plain browser, no extension needed;
                    also not part of the extension
tools/cnpj.js   alphanumeric CNPJ validator / check-digit calculator, written
                independently of src/shared/cnpj.js and cross-checked against it
```

`browser.js` attaches `NFPR` to `globalThis`. In a content script that is the
**isolated world**, so nothing leaks to the government page; in the popup and the
offline page it is that page's window. Same files, all three contexts.

### The two registrars

The live page and the offline page run the *same* pipeline up to the durable
queue — `config → capture → judge → de-dup → freeze CNPJ → queue` — in
`registrador.js`. What happens next is the entire difference:

- **`content.js`** sends: the bounded pool (`despacho.js`), response
  classification, retry of stale tokens, parking behind an outage, latching a
  dead session, and the drain loop that replays the queue on load.
- **`entrada.js`** stops. It never sends; the live page's drain loop does that
  later.

The one de-dup difference falls out of that: a live-page key whose send *failed*
is forgotten, so rescanning it is a real retry; an offline-page key has no
failure path and stays blocked for the session. A key refused as **ineligible**
stays blocked on both, carrying its verdict, because rescanning it could only
produce the same answer. The record is kept and consulted whatever
[*Enviar sem verificação prévia*](#sending-everything-anyway) says — that
preference decides only whether a repeat is refused or announced on its row.

### Sending everything anyway

**Preferências → *Enviar sem verificação prévia***, default off. With it on there
is **no local refusal at all**: whatever the volunteer entered goes to the
server — a red verdict, a grey verdict, a half-typed key, ten digits and a
shrug. Not "refusals can be overridden"; there is nothing left to override. The
kind of error becomes the server's business, knowable only when the answer comes
back. It reproduces the official page exactly, and that is the feature rather
than a side effect.

**Why anyone would want it: accountability.** A volunteer handed a receipt
should be able to show that it was submitted, rather than defend a refusal the
extension made on its own — "the extension decided not to send it" is not a
defence anyone wants to give, and having the two behave alike means a
volunteer's experience can be compared against the official page directly.

It is the opposite of [modo de depuração](#modo-de-depuração), which exists to
exercise code paths and arms `simularEnvio` so nothing forged reaches the real
server. This one exists precisely to reach it.

What it does *not* do:

- **A blank entry is still never sent**, and that is not negotiable. Tab and
  Enter are the terminators, and a scanner emits Enter at the end of every read
  including a failed one — so an empty buffer reaching the server would mean
  every stray Tab firing a blank donation.
- **The checks still run and still speak.** The verdict stops being a gate and
  becomes advice: it picks the *sound* (a warning ping, not the harsh error
  buzz — nothing has refused the note yet) and puts the reading on the row as a
  permanent marker, *"⚠ enviada sem verificação — …"*. The row is **blue while it
  flies**, like every other in-flight row, and red stays the server's to give.
- **It marks only the notes it actually carried.** A key that passes on its own
  merits is queued and shown exactly as always, whatever the toggle says.
- **A repeat is still announced — it is just no longer refused.** De-dup is the
  one local check the preference keeps, because it is the only one that is not a
  verdict on the digits: it is the only thing that can tell a volunteer they are
  holding two copies of the same receipt, and nothing else ever will (the POST
  does not detect a repeat, and the monthly reconciliation discards duplicates
  without reporting it). So the note goes out, the warning ping sounds, and the
  row carries *"⚠ repetida — …"* beside the key. Dropping this refusal is cheap
  in a way dropping a grey verdict is not: a repeat costs a wasted request,
  never a lost donation. The marker is its own, separate from *"enviada sem
  checagem"* — a repeat of a perfectly good key has nothing wrong with its
  digits, and saying otherwise would drop *"nenhum erro foi detectado"* from the
  failures page for the whole list.
- **It does not survive being switched off — for notes scanned afterwards.**
  The decision is frozen on each note when it is read, so a batch scanned with
  the preference on still goes out as intended even if the toggle is turned off
  and the browser restarted before they drain. Turning it off changes what
  happens to the *next* scan, never to work already accepted.

One thing it changes further out: the
["erros desconhecidos"](#7b-a-good-note-that-vanishes-must-not-vanish-quietly)
page normally opens by telling the volunteer *"nenhum erro foi detectado"*, which
is true by construction because nothing else reaches the POST. A bypassed note
breaks that, so it carries the fact with it: the reassurance is dropped from the
page as soon as one listed note was sent without checking, and that note's own
card says so.

### Fixed parts are for typing

A fixed part exists so a volunteer **typing** a batch of similar notes enters
only the digits that change. It is not a scanner feature, and **a scanner must
not be used while a fixed part is active.**

**The whole feature is a preference, on by default** — *Preferências →
Parte fixa da chave*. It is a typist's tool, and the volunteer holding a scanner
never types a digit, so for them the strip, its popover and its editor are
clutter they can switch off. **Off means inert, not merely invisible:** the
strip is not drawn AND no fixed part applies. Hiding the strip alone would be the dangerous half, since a fixed part
fills cells with digits nobody typed and the one-click way out lives on the
strip that would no longer be there. Nothing is deleted by switching it off:
`parteFixaAtivaId` stays in storage, so switching it back on restores the
sitting exactly as it was left. One line in `registrador.js`
(`partesFixasLigadas`) decides all of it, which is why every fixed part surface
downstream — the composition, the live verdict's template, the stale-fixed-part
bar, the scanned-under-a-fixed-part bar — goes quiet on its own.

**So a typist is told the option exists, and only a typist.** With fixed parts
off there is nothing on screen about them at all, which leaves the one person
they were built for no way to discover them. Once a note has been entered **by
hand** — capture's own burst flag is what says so, since a typed key and a
scanned one are both 44 digits by the time anyone sees them — the status line
under the cells carries one quiet sentence: *"As chaves das suas notas começam iguais? Você pode
fixar esse começo e digitar apenas o restante de cada uma."*, with **Ativar** and
**Não mostrar**. A scan never raises it, whatever else is going on. It is text
on the same line as the live verdict and the lowest of that line's four
priorities, so it can never take the line away from a verdict about the note
being entered; it has no sound, for the reason the live verdict has none.
**Ativar** arms the preference and nothing else — no editor opens by itself, the
strip simply appears carrying its own invitation, and an editor opening there
would take the keyboard just as the next note is about to be entered. Unlike
every condition bar in `painel.js` it **is dismissible**, because it is an offer
rather than a state that is still true, and an offer that cannot be refused is
furniture for the rest of a volunteer's life on a shared machine. Either button
ends it for good, and so does the switch in Preferências — in either direction,
since somebody who has just worked the switch has plainly been told.

**A fixed part is working state, not configuration**, and that is why it lives
on the registrar rather than in settings. An entity is configuration: one per
install, rarely changed. A fixed part is a piece of text with a lifetime of one
sitting, and the toolbar popup — which used to manage them — has no key entry to
use one with at all. It is **the strip** now: one permanent line immediately
under the 44 cells, on both registrars, which says what the next thing entered
will be read as and is itself the control that changes it. The 44 cells above
are the preview, so the editor writes into the same display a note is typed
into.

**With no fixed part the strip invites; with one it reports, and offers the way
out.** Idle it reads `+ Fixar o começo da chave` in the accent colour — an
invitation, not a status, saying what the volunteer does (the wording rule is
in CLAUDE.md, *Words for the fixed part*). (It used to read "Chave inteira — 44 números", which was true and
answered a question nobody had.) Once a fixed part is armed the label becomes
the status it should be — which fixed part, how many digits it leaves — and a
**`Digitar a chave inteira`** button appears beside the ▾. That escape is one
click on purpose: a fixed part fills cells with digits the volunteer never
typed, which reads as the software being broken to anyone who does not know the
feature exists, and the way out of that cannot be two clicks deep inside a
popover they have no reason to open. It deactivates rather than deletes — the
fixed part stays in the list — and clears the entry with it.

**The editor says which fixed part it is.** The same field writes a new fixed
part and rewrites the armed one, and applying an edit overwrites that fixed part
in place — so it opens behind a legend reading `Nova parte fixa` or `Editando
“AMARAS”` (the fixed part's name, or its last digit groups when it has none).
The text alone cannot say it: an existing fixed part opens pre-filled with
digits indistinguishable from freshly typed ones, and the placeholder — the only
other thing that could have named it — is never on screen in exactly that case.
The legend never shrinks; on a narrow strip the row wraps and the field drops to
a line of its own, since truncating the name would take away the one thing it is
there for.

**A fixed part is the part of the key that is the same on every note in front of
you.** You type it once; anything you do not type varies. `ParteFixa.completar`
pads a short pattern out to 44, so a fixed part can be written as nothing but
its prefix and the `?` character is never needed in the common case — it exists
for the rarer "and maybe some numbers further along". Nothing about the key's
field structure appears anywhere in the interface: the volunteer compares two
receipts, sees where they stop matching, and types up to there.

**Two tiers, and the name is the tier.** A fixed part that is merely used lands
at the top of a ten-item recent list; a fixed part that has been **given a
name** is saved — pinned, never evicted and never counted against the cap.
Naming is the whole gesture: there is no separate star to toggle, and clearing a
name back to blank is how a saved fixed part is let go. The row's first button
says so — **Salvar** while the fixed part is a recent, **Renomear** once it is
kept, opening the same field either way.

**The tier decides eviction and nothing else — it does not order the list.** The
two tiers used to be two blocks, saved first, and two blocks in one scrolling
box means whichever comes first pushes the other off the bottom: the saved tier
is uncapped, so twenty named fixed parts hid every recent, and leading with the
recents only swaps which half disappears. Saved-vs-recent is a question about
*tomorrow*, and nobody is choosing along it while the list is open. It is one
list now, ordered by last use: the fixed part just activated is at the top
whatever tier it is in, and the tier is still on every row because it is what
that first button says.

**The list is a fixed frame, and only the rows scroll.** The header, the search
box and the footer are pinned, and “Chave inteira — 44 números” rides the top of
the scroll so it can never be lost — the whole popover used to scroll, which put
*+ Nova parte fixa*, the only way to make a fixed part at all, a thousand pixels
below the fold. Its height is measured when it opens, because how far down the
page the strip sits depends on how many condition bars are above it.

**The search box appears only once the list is long enough to need one** (more
than eight fixed parts). It matches names and digits, ignores accents and case,
and says how many fixed parts it is searching. It is never focused
automatically: this list lives in the registrar's own shadow root precisely so a
scan still registers while it is open, and a field that grabbed the keyboard
would swallow the next barcode. Clicking into it stands the key capture down for
as long as it holds the focus; `Esc` clears the search first and closes the list
second. From anywhere else inside the list, `Esc` closes it and the keyboard
goes back to the **Escolher parte fixa ▾** button.

Names stay optional, and a blank one is a first-class state: an unnamed fixed
part shows its own digits where a name would go, and that is also the
placeholder in the naming field. What the volunteer declines by not naming a
fixed part is *keeping* it, which is the right default for a piece of text with
a lifetime of one sitting. Editing updates in place with no guard, saved or not,
and applying an edit pushes the *old* text to the top of the recents, which is
free undo and the reason it needs no confirmation.

The raw-buffer analysis that lets a scanned key override a fixed part is there
primarily to *detect that misuse and warn about it*. Registering the scanned
note anyway is a free nicety — the alternative would be silently rebuilding a
key from the fixed part plus the barcode's first digits — but it is damage
control, not a supported way to work. Nothing in the interface should advertise
it.

The reason is that with a fixed part active the extension cannot tell a *faulty*
scan from deliberate typing: the capture buffer caps typed digits at the fixed
part's variable count, so a bad read arrives looking like a short manual entry.
The validation stack catches nearly all of it, which is luck worth having and
not a design to lean on. The situation should not arise in the first place.

`ParteFixa.resolver` decides by **what kind of input arrived**, never by whether
a validation passed: a 44-digit run in the raw buffer is a scan, and a scan is
judged as it came. **So is a confirmed scanner burst with no 44-run in it** — a
shop's own barcode, a loyalty card, a partial read — which is judged as read and
is simply red. Composition is reachable only from genuine typing.

> It used to work the other way, and that was the one behaviour here that
> contradicted the rule above. A scan that failed validation was replaced by
> `[fixed part] + [the barcode's first digits]` — because `capture.js` caps
> `typed` at the fixed part's variable count, so it holds a scan's *head*, never
> the tail the fixed part expects. That composition cleared the check digit
> about **one time in ten** and was donated silently, while the note actually
> scanned was lost. That composition path is gone: resolution now decides by
> input kind, never by whether a validation happened to pass.
>
> **The 44-run alone left one door open.** A burst *shorter* than 44 carries no
> run, so it still fell through to composition — `[fixed part] + [the first
> digits of a 20-digit store barcode]`, about one in ten of which passed every
> local check and was POSTed for a note nobody held. `resolver` now also takes
> capture's confirmed-burst flag, and with it set nothing composes.

### Red and grey: the one question everything hangs off

Every local check answers the same question — **does this note exist?** — and
that single axis decides the colour and what the volunteer is asked to do next.

| | Meaning | Shown as | What it asks of the volunteer |
|---|---|---|---|
| **Red** | the digits are wrong; nothing real was read | error toast, no row | read the paper again — that recovers the donation |
| **Grey** | digits are right; the note is real, just not donatable | `inelegivel` row | nothing; there is nothing to fix |

**One preference suspends that table entirely.** With
[*Enviar sem verificação prévia*](#sending-everything-anyway) on, neither verdict
refuses anything: both become a warning marker on a row that is already on its
way to the server. Everything in this section describes the default, which is
off.

Getting that backwards is expensive in one direction specifically. Telling
someone they mistyped a receipt that is *perfectly fine* sends them back to it,
gets the same answer, and ends with a donatable note in the bin.

Which local verdicts exist:

| # | Verdict | Colour | Notes |
|---|---|---|---|
| 1–2 | `COMPRIMENTO` `FORMATO` | red (`entrada`) | `escopo: 'chave'` — a fixed part template cannot answer these |
| 3 | `DIGITO_VERIFICADOR` | red | same |
| 4 | `LETRA_FORA_DO_LUGAR` | red | a letter anywhere outside indices 6–17 |
| 5 | `DOCUMENTO_EMITENTE` | red | the *second* checksum: `[6:20]` must be a CNPJ or a padded CPF, either one, on any série |
| 6 | `UF_INEXISTENTE` | red | a cUF outside the IBGE table |
| 7 | `MES_INVALIDO` | red | a month outside 1–12 |
| 8 | `FUTURA` | red | `relogio: true` |
| 9 | `NAO_PR` | grey (`inelegivel`) | another state |
| 10 | `TIPO_DOCUMENTO` | grey | neither an NF-e (`55`) nor an NFC-e (`65`) |
| 11 | `EXPIRADA` | grey | the only one time switches on, so it is last |

Row 4 never answers a whole key: `FORMATO` refuses a letter outside the issuer
span first. It is `FORMATO`'s positional half for the live verdict and for
fixed part templates, where `FORMATO` cannot look, and it reads the characters
rather than a span, so it speaks at the letter itself — in the série or the
invoice number too, which nothing else reads. Before it, three span checks
(`ANO_`, `MES_`, `MODELO_INVALIDO`) covered only the year, month and model, and
only once each span was whole; without them `Number('2A')` was `NaN`, every
date comparison false, and `41A6` judged clean while typing. Everything below
row 4 therefore only ever sees digits outside the issuer span.

**Nothing reads the série or tpEmis.** Until 2026-09-23 the série also chose the
issuer checksum, refused an avulsa série on an NFC-e
(`SERIE_TIPO_INCOMPATIVEL`), refused some tpEmis values (`TIPO_EMISSAO`) and
greyed `990`–`999` (`SERIE_EXCEPCIONAL`); each either had no source or could
refuse a real note while catching next to nothing. The last reading,
`EMITENTE_CPF` (grey on `920`–`979`, a CPF issuer), was removed on 2026-09-28:
a CPF can only issue an NF-e, and an NF-e is accepted
(see [Two models are accepted](#two-models-are-accepted)). See
[`CLAUDE.md`](CLAUDE.md) before adding a série rule back.

Two rules generate that order. **Every red before every grey**, because a grey
verdict states a fact *about a note*, and asserting one while the digits may be
corrupt describes a note nobody scanned. **Within grey, permanent before
temporal** — "another state" will never change, "expired" was once false, and
when both apply the permanent reason is the more useful one.

The five red field codes deliberately share one sentence ("A chave informada
não é válida…"), and the reason is sharper than jargon-avoidance. Those
four are [corruption detectors](#the-red-checks-answer-to-the-scanner-not-to-the-server):
which one fired is a fact about *our net*, never about the note. Naming it would
misdirect — "o CNPJ do emitente é inválido" invites the volunteer to conclude
the **receipt** is bad and bin it, when the receipt is almost certainly fine and
only the reading of it was wrong. One instruction recovers the donation in all
four cases, so there is one sentence: read it again.

`COMPRIMENTO` keeps its own wording for the mirror-image reason — it is the one
the volunteer can confirm unaided, since the cell display shows the count. There
the specifics help rather than mislead.

`FORMATO` kept its own for the same reason and lost it to the alphanumeric
CNPJ. *"A chave deve conter apenas números"* became simply false, and what
replaced the test — a letter is valid at indices 6–17 and nowhere else — is not
something anyone can check against the display: nothing on screen says where the
issuer's fourteen characters begin, and no volunteer should have to learn. So it
joined the shared sentence, keeping its own code.

**Never collapse this into "tell the user which check failed".** The codes stay
distinct because they are the testable contract; the wording is shared on
purpose, and making it specific would trade a recoverable re-scan for a
discarded receipt.

**One signal comes before Enter: the check-digit hint.** With auto-send off (the
default), the entry box turns red the moment its last digit is in if the check
digit does not match, and goes back to normal on the next keystroke. It names no
digit and says no sentence. It is there so the volunteer can re-check the last
few digits against the paper *before* submitting, instead of retyping all 44
after a refusal — and it is a re-check of their own reading, not a repair of a
refused one: once Enter is pressed, a red verdict still clears the entry. It
never shows with auto-send on, when the key has already gone. `CLAUDE.md` has
the reasoning (it was kept against the audit's advice, on purpose); checklist
step 23 exercises it.

Every one of them is a single entry in `REGRAS`, the one ordered table in
`chave.js`. `gravidade` decides the colour and nothing else does; `escopo`,
`relogio` and `campos` decide only *whether the entry is asked at all* on a
given input, which is what lets one table judge a key and a fixed part template
with no second code path.

**`CLAUDE.md` holds the authoritative statement of this rule** — the table, the
two ways into it (`avaliar` and `avaliarTemplate`), and why the colour is the
whole decision. It is the thing to read before touching any of it.

### Persisted state (`chrome.storage.local`)

- `nfpr:config` → `{ versaoConfig, entidades[], entidadeAtivaId, partesFixas[],
  parteFixaAtivaId, preferencias{} }` — a fixed part is `{ id, nome, template,
  usadaEm }`. `nome` may be `''`, which is a real state and never defaulted to
  "Parte fixa": the interface shows the fixed part's own digits instead. The
  name is also the tier — a named fixed part is saved, so it is exempt from the
  ten-item recent cap and from eviction, and *Limpar as não salvas* skips it.
  There is no separate `salva` flag; `Config.parteFixaSalva` is the one place
  that asks. `usadaEm` is stamped at activation and at edit, and it is the whole
  of the list's order — the tier decides eviction, never position. Two
  preferences govern the feature itself: `partesFixas` (default **true**;
  false means the strip is not drawn and no fixed part applies) and
  `dicaPartesFixasEm` (default `null`) — **when** the offer of fixed parts was
  last answered, not whether it was. It is stamped by any deliberate touch of
  `partesFixas`, and the answer expires after `Config.PRAZO_DICA_PARTES_FIXAS`
  (7 days), because these machines are shared and one volunteer's *Não mostrar*
  must not speak for everybody who sits down after them.
- `nfpr:fila` → `[{ chave, cnpj, em, semValidacao }]` — donations awaiting or
  needing a resend across reloads. `cnpj` is the target frozen at scan time; `em`
  is when the volunteer entered the key, carried so a note drained days later can
  still say when it was read; `semValidacao` is what our own table said about a
  note the *enviar tudo* preference sent anyway, frozen at scan time for exactly
  the reason `cnpj` is. Legacy plain-string entries are normalised on read (with
  a null `em`), and that migration path must stay.
- `nfpr:falhas` → `[{ chave, mensagem, em, semValidacao }]` — notes the server
  rejected with an answer this code could not read. They have already left `nfpr:fila`, so this is
  their only record; capped at 100, oldest off the front, one entry per key, and
  an entry leaves when that key registers on a later attempt.
- `nfpr:debug` → `{ ativo, flags{} }` — [debug mode](#modo-de-depuração) alone.
  Its own key on purpose: no debug field can ride along into an entity or fixed
  part write, and the panic switch is one key removal.

`nfpr:falhas` has its own key for the same reason `nfpr:fila` does: **"Apagar
configurações do usuário" must not throw it away.**

Defaults are merged on every read, so there is no install-time seeding and older
stored objects keep working as the schema grows. The first three records are
each written through their own serialized promise chain, and `Config.atualizarConfig`
is the only exported way to change config — there is no whole-object overwrite
to reintroduce. `nfpr:debug` is written by a plain set: a scanner fires several
keys a second, but that record is only ever changed by one person at a console.

### Why it is built this way

The decisions that are load-bearing — why donations are sent from the content
script, why the background script has no imports, why `navigator.onLine` is only
believed when false, why capture is a document listener, why the target CNPJ is
frozen — are in **`CLAUDE.md`**, under *Load-bearing decisions*. They are not
repeated here, because two copies of a rule is how this repository ended up with
two documents that disagreed.

---

## The Nota Paraná contract

The only external system is the Nota Paraná website. There are no other APIs, no
payment, no analytics, no auth providers. Every request carries the volunteer's
session cookies and is indistinguishable from the site's own traffic. **All
values below are the contract as observed in 2026-06** and are the most expensive
knowledge in this repository — they were learned by watching a live government
site with no documentation. `src/shared/site.js` holds every URL and sentence.

### The access key itself

The 44 characters are fixed-width fields. These offsets are load-bearing now —
`chave.js` reads five of them to decide whether a note is worth a request.
Positions are 1-based, indices 0-based.

They are not all digits any more: the issuer's CNPJ went alphanumeric, which
makes indices 6–17 the one span that may hold letters. That is the subsection
straight after this table, and it is worth reading before the rest.

| Field | Len | Pos | Index | Meaning |
|---|---|---|---|---|
| `cUF` | 2 | 1–2 | `[0:2]` | IBGE state code — `41` is Paraná |
| `AA` | 2 | 3–4 | `[2:4]` | emission year, last two digits (year = `2000 + AA`) |
| `MM` | 2 | 5–6 | `[4:6]` | emission month |
| `CNPJ` | 14 | 7–20 | `[6:20]` | issuer document — **CNPJ *or* a left-padded CPF**, see below. Called `documentoEmitente` in the code, never `cnpj`, because it is not always one. **Its first twelve characters may be letters**; its check digits at `[18:20]`, and a CPF, never are |
| `mod` | 2 | 21–22 | `[20:22]` | document model — `65` is NFC-e, `55` is NF-e, and those two are accepted. Called `modelo` in the code: the spec’s own word, spelled out because bare `mod` would read as the módulo-11 arithmetic this codebase is full of |
| `série` | 3 | 23–25 | `[22:25]` | not judged — see [Two models are accepted](#two-models-are-accepted) |
| `nNF` | 9 | 26–34 | `[25:34]` | invoice number |
| `tpEmis` | 1 | 35 | `[34]` | emission type — not judged; no value is refused |
| `cNF` | 8 | 36–43 | `[35:43]` | numeric code |
| `cDV` | 1 | 44 | `[43]` | check digit, módulo 11 |

#### The key is not all digits — `[6:18]` may hold letters

The CNPJ became **alphanumeric** (IN RFB nº 2.229/2024; homologation 06/2026,
production 07/2026). Fourteen characters still, but the first **twelve** may be
uppercase letters: eight of *raiz* plus four of *ordem*. The last two are its
own check digits and stay numeric.

The key carries that CNPJ at `[6:20]`, so **indices 6–17 are the only place in
all 44 where a letter can ever appear**. Everything else — `cUF`, `AA`, `MM`,
the CNPJ's check digits, `mod`, `série`, `nNF`, `tpEmis`, `cNF`, `cDV` — was
numeric before and still is. A letter anywhere else is corrupted input, and
`FORMATO` refuses it red on exactly that reading:
`/^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$/`.

**The arithmetic is one substitution: each character's ASCII value minus 48.**
That gives `A` = 17 … `Z` = 42, and leaves digits alone — `'5'` is ASCII 53, and
53 − 48 is 5. So the módulo-11 sums for both the CNPJ's check digits and the
key's own `cDV` are otherwise unchanged, and **every numeric key and every
numeric CNPJ validates exactly as it did**. There is one algorithm here, not two;
the all-numeric document is the special case of it. The published example
`12.ABC.345/01DE-35` is the test vector `tools/smoke.js` pins it against.

Assignment is **progressive and only for new inscrições**, so nearly every note
a volunteer meets will stay all digits for years.

**What changed on screen.** Nothing, in the common case. The cells are
monospace, so a letter occupies exactly the width a digit does; entry accepts
`A`–`Z` anywhere and upper-cases whatever is typed, so a lower-case letter is
corrected rather than dropped; a fixed part may hold letters, since the head of
a key is the issuer's CNPJ and that is precisely what fixed parts fix. The
site's own barcode moves from CODE-128C to **CODE-128A** to carry them, which a
handheld scanner reads as ordinary keyboard input.

**Entry accepts a letter anywhere and lets the verdict refuse it** — `FORMATO`
at submit, and `LETRA_FORA_DO_LUGAR` in the live verdict while typing, which is
red at the letter itself wherever outside 6–17 it lands. It was briefly the other way round, with the
keystroke itself refused outside indices 6–17, and that was wrong twice over: a
letter typed elsewhere disappeared without a word, and a scan fired while the
volunteer already had eight characters typed put the QR URL's own letters into
the gap at index 8. Where a letter may stand is a judgement about a key, not a
filter on a keystroke — see [`CLAUDE.md`](CLAUDE.md).

**The server validates them.** A mistyped check digit on an alphanumeric key
is refused with `chave de acesso inválida`, exactly as on a numeric one
(observed 2026-09-28), so that answer is final for both: the note is dropped,
not retried.

#### `[6:20]` is not always a CNPJ — this is the least guessable thing here

A note may be issued by a *pessoa física*, typically a produtor rural — always
on an NF-e, since a CPF cannot issue an NFC-e (MOC rejection 337). The key
has no separate field for that: the CPF goes in the **same** span `[6:20]`,
left-padded with zeros to fourteen digits (`000` + eleven CPF digits). A CPF
does not satisfy CNPJ módulo-11 and a CNPJ does not satisfy CPF módulo-11, so a
validator that assumes the wrong one **rejects a perfectly real note**.

**So `[6:20]` is accepted as either document, on any série.** The série does
say which one it should be (`910`–`979` means a CPF, per field B07 of the MOC),
and this code used to enforce that. It was dropped because it bought almost
nothing — a damaged document rarely satisfies *either* checksum — while its
band table kept needing exceptions that each, when missed, refused a real note
as a typo. A document satisfying neither checksum is still red.

**Such a note is real.** `DOCUMENTO_EMITENTE` accepts a padded CPF in `[6:20]`
as **valid**, and must: it is a corruption detector, never an eligibility rule,
and turning it into one tells a volunteer holding a real produtor-rural receipt
that they mistyped it. It is an NF-e, so no local verdict greys it and it goes
out like any other note. A *non-participating CNPJ* issuer exists and is undetectable from
here either way.

#### The donation deadline is three calendar months, not one

**It is the law.** Decreto 8.249/2017, art. 12 — in the wording given by Decreto
5.999/2020, in force since 26.10.2020 — says donations are made *"até o último
dia do segundo mês subsequente ao da emissão"*. SEFA's own entity page says the
same. The rule implemented is therefore `now > emission + 2 months` ⟹ expired,
in absolute months so it wraps the year (`12/2025` is valid until `02/2026`).

It was found by observation first (**2026-08-08**: in month 8, notes from months
6, 7 and 8 were all accepted; in February, a note from the previous December
was still accepted), and only later traced to the decree. Two official sources
still carry the pre-2020 wording of *one* month: the server's own rejection
sentence (*"a doação deve ocorrer no máximo até o mês seguinte"*) and the
*Doação de notas fiscais* FAQ page. Both are out of date. Do not "correct" the
`+ 2` to match them: being stricter than the rule refuses notes locally that
could have been donated — silently losing real donations.

#### Two models are accepted

The NFC-e (`65`) and the NF-e (`55`) are both taken by the endpoint — a 55 was
observed answering **200** exactly like a 65 (recorded 2026-09-10). Anything
else is refused with `400 {"chaveAcesso":"Tipo de documento inválido."}`.
A CT-e (`57`), an MDF-e (`58`) or any other
model is therefore a real document that cannot be donated here, and it is
pre-empted locally as a grey verdict naming both papers the page takes.

**An NF-e can be donated like an NFC-e** (settled 2026-10-07). It was an open
question for a while, and the 55 was greyed for a few hours on 2026-09-28 before
being accepted again. Do not re-grey it from a summary.

Nothing about the key changes with the model: both share every span and the
check digit, and the model decides exactly **one** answer in `REGRAS`,
`TIPO_DOCUMENTO`. Every other check judges a 55 exactly as it judges a 65, and
`smoke.js` asserts that list whole.

#### Exactly one answer files a donation

**200 OK with a `mensagem` containing `sucesso`.** Nothing else does — not a 400
refusal, not the 500 shrug, not a body this code cannot parse. So whenever an
answer *arrived* and it was not that one, the note was not registered, and that
is a fact the interface is entitled to state flatly rather than hedge.

**Two different things can be unknown, and they must not be confused.** When the
site answers the shrug after every local check has passed, *what happened* is
perfectly clear — the donation was not made. It is *why* that is missing: the 44
digits are sound, so nothing here can explain the refusal. That is what
`SEM_DIAGNOSTICO` is named for, and what the volunteer-facing
["erros desconhecidos"](#7b-a-good-note-that-vanishes-must-not-vanish-quietly)
page is named for. An interface that reports the uncertainty on the wrong axis —
"we cannot tell whether it registered" — invites the receipt onto the done pile.

The one place the *outcome* is genuinely unknown is an answer that never arrived
at all — a timeout, a dropped connection — because the server may have processed
the request before we stopped listening. Those are exactly the notes the
extension keeps and resends, which is where the accepted duplicate-donation risk
lives and the only place it lives.

#### Two more server answers this now pre-empts

Both were recorded on 2026-08-08 and both cost five requests each, because the
server reports them with a sentence the retry logic treats as recoverable:

| Cause | Response |
|---|---|
| `AAMM` in the future | `500 {"erro":"A aplicação retornou que não foi possível concluir a ação solicitada."}` |
| `MM` outside 1–12 | `500 {"erro":"A aplicação retornou que não foi possível concluir a ação solicitada."}` |

That generic sentence stays classified as recoverable — it genuinely is a stale
token sometimes. This work removes its two `AAMM` causes; it does not
reinterpret the sentence.

### Donation (two steps per attempt)

**1. Fresh form token.** `GET /nfprweb/DoacaoDocumentoFiscalCadastrar`, no
special headers. Parse the HTML for `<input name="value">`.

A token is **one slot per request, not one per session**: every donation fetches
its own, and a second GET does not invalidate a token already held. That is what
makes the bounded pool safe to run wider than 1 — see `LARGURA_ENVIO` in
`src/content/content.js`. It was once written down here as an open question; it
is not one.

- Body text matching `mais de uma sess[aã]o ativa` → **duplicate session** —
  or **terminating**, if our own `/sair` is in flight. **This is checked first**,
  before the two verdicts below: the duplicate-session screen arrives as an
  ordinary 200 OK and the server may render it from a URL containing `login`, so
  reading the body last used to report it as "sua sessão expirou" and tell the
  volunteer to log in again — which is what caused the problem.
- Redirected to a URL containing `login`, non-OK status, or token absent →
  **session expired** — unless duplicate-session termination is in flight, in
  which case **terminating**.
- **If the page this content script loaded on IS the duplicate-session screen
  and auto-close is off, every session verdict for that page load reports
  duplicate session**, whatever the token request came back with. The server
  does not necessarily repeat the reason to `fetch` — it can answer with a bare
  login redirect — and the page already knows the truth, so it hands it to the
  network layer (`Donation.setSessaoDuplicada`, latched by `sessao.js`).
  Sniffing the response alone left the notes advising "entrar novamente", which
  is the one instruction that makes a duplicate session worse.
- Network failure: device reports offline → **network failure**; otherwise
  disambiguate with a probe (see below).
- Tokens are single-use and short-lived: fetch a fresh one immediately before
  every POST, including the automatic re-attempt.

**2. Donation POST.** `POST /nfprweb/app/v1/documentoFiscalDoadoWeb`, JSON:

```json
{
  "chaveAcesso": "<44-digit key>",
  "cnpjEntidade": "<14-digit entity CNPJ>",
  "documentoComChaveAcesso": "true",
  "value": "<token from step 1>"
}
```

Response, evaluated in this order:

**Retrying is the default.** Only six answers are recognised well enough to be
terminal; everything else is something this code cannot read, which is not a
verdict on the note, so it is retried and only then given up on.

Four of the six are now **pre-empted locally** — the 44 digits already say so,
and the round trip buys nothing. They are still handled here, because on those
four the server is the authority and its answer may not match ours.

| Body field | Meaning | Outcome |
|---|---|---|
| `mensagem` containing `sucesso` | accepted — observed in full as **"Documento fiscal doado com sucesso!"**; matched on the one word so a reworded sentence still reads as success | **`sucesso`, terminal** |
| `chaveAcesso` containing `prazo para doar` | past the deadline; waiting cannot un-expire it | **`inelegivel`, terminal** · *pre-empted* |
| `chaveAcesso` containing `tipo de documento inválido` | the 44 digits decode to a model that is neither an NF-e (`55`) nor an NFC-e (`65`) — a CT-e key is the real-world case: a real document, so not a typo | **`inelegivel`, terminal** · *pre-empted* |
| `chaveAcesso` containing `não está localizado no Estado do Paraná` | the cUF at `[0:2]` is not `41` — observed in full as **"Esta nota não pode ser doada. Motivo: Estabelecimento emitente não está localizado no Estado do Paraná."** A note from another state is a real note, so not a typo, and no retry moves the shop | **`inelegivel`, terminal** · *pre-empted* |
| `chaveAcesso` containing `chave de acesso inválida` | fails the site's own validation (bad CDV/format) — the key itself, not the attempt | **`erro`, terminal** · *pre-empted* |
| `cnpjEntidade` | that entity is not registered to receive — the configuration, not the note | **latched condition, per CNPJ.** Notes aimed at it park amber and **stay in `nfpr:fila`**; notes aimed elsewhere keep flowing. Carries `codigo: 'ENTIDADE_RECUSADA'` so nothing has to match the sentence |
| `chaveAcesso` containing `procedimento inválido` | the **request** was refused above the note — it merely arrives in the field verdicts about the key arrive in. A stale form token does this; so does a malformed `documentoComChaveAcesso`. The list of triggers is **not** known to be complete | `codigo: 'PROCEDIMENTO_INVALIDO'`. Triggers the [health probe](#the-shrug-and-the-health-probe) exactly like the shrug; retried meanwhile (each attempt fetches a fresh token, the mitigation for the one cause we can act on), and **never deleted** |
| `mensagem` otherwise | the site is telling us something about this note we do not recognise | retried, then `erro` |
| `chaveAcesso` otherwise | a rejection sentence we have not learnt to read | retried, then `erro` |
| `erro` | **the shrug** — an answer that diagnoses nothing | `codigo: 'SEM_DIAGNOSTICO'`. Triggers the [health probe](#the-shrug-and-the-health-probe); retried and eventually deleted only if the server proves healthy |
| none of the above | a body with no field we know | same, `SEM_DIAGNOSTICO` |
| non-JSON body (and not 5xx) | request landed, not a success, reason unreadable | same, `SEM_DIAGNOSTICO` |

**The last four rows are the ones this code cannot read**, and that is not just a
retry policy — it decides who is left holding the problem.

Reading an answer is what buys a *policy*, and every policy above either finishes
the matter or keeps the note. Nothing is owed for a success, for the three grey
refusals (the note is real and undonatable — no paper anyone finds changes that),
or for `chave de acesso inválida` (see [below](#why-chave-de-acesso-inválida-is-not-worth-a-second-look)).
The note is *kept in `nfpr:fila` behind a bar* for a refused entity, a dead
connection, a dead session, a confused server, and `PROCEDIMENTO_INVALIDO`.

The unread answers get neither, because neither could be chosen: at the end of
the budget the note is destroyed with nothing holding it. Those are the ones that
go to the **"erros desconhecidos"** list with their digits — the volunteer is
the only actor left, and they cannot act on a paper they cannot find.

#### Why `chave de acesso inválida` is not worth a second look

It is the one recognised answer that both **destroys** the note and stays off
that list, so it looks like the exception. It is not, and the reason is worth
stating because it is not obvious: **a corrupted read cannot produce it.**

The key's field layout and its módulo-11 check digit are fixed by federal
legislation — they are not Nota Paraná's to change — so our check-digit test and
the site's cannot disagree, and ours is otherwise the stricter. A mis-scan
therefore either fails our net first (red toast, never sent) or passes both and
comes back **`sucesso`**, which is the silent lost donation described
[above](#the-red-checks-answer-to-the-scanner-not-to-the-server), not this.
Reaching this answer means the 44 digits are self-consistent and
deterministically refused: re-reading the paper produces the same digits and the
same refusal, so there is nowhere to send anyone.

The server's own text is always shown, always as plain text, when it sent one.
The two rows above with no server sentence to relay ("none of the above" and
"non-JSON body") get a message this code writes itself, starting with "Erro
desconhecido" — there was genuinely nothing to read, so the code says so rather
than inventing detail the site never gave it. **The shrug is relayed too**, in
the site's own words. It was once replaced with a sentence of ours, because
repeating a reply that is byte-identical for three unrelated causes would claim
a diagnosis that does not exist — but the row now carries a muted `[nfprweb]` in
front of it, so it reads as the site's words rather than as our verdict, which
was the whole of that objection. Every `erro`, whichever row
produced it, unblocks the key once the retry budget runs out, so rescanning the
receipt is a real retry — not something the volunteer must take on faith.

**Retried** means **5 attempts in total** — the first send plus four
more, spaced 1.2 s / 4 s / 10 s / 20 s. Each retry goes to the *back* of the queue, so
the notes behind it keep sending rather than waiting out the delay. The counter
is in memory only: a reload restarts it, which is harmless, because the note is
still in the durable queue and simply begins its five attempts again. The limit
is the point — the same refusal can mean a transient server state *or* a key
that really is wrong, and those are indistinguishable from here. Without a limit
a mistyped key would retry for ever; with no retries at all a good note would be
discarded on a hiccup. When the budget runs out the note is reported — with the
site's own words, or this code's own fallback wording when the site
gave it nothing — and dropped from the queue; the key is also unblocked, so
rescanning it is a real retry rather than something the volunteer must take on
faith. There is no history and no timer: nothing about that survives a reload,
by design.

**That final deletion is the zombie reaper.** Two answers refuse to let it fire
on their own: `SEM_DIAGNOSTICO` and `PROCEDIMENTO_INVALIDO` are refusals the
engine made *without ever judging the 44 digits* — the first gave up outside the
validators, the second was thrown out above them — so neither is evidence about
the note, and both go to the health probe below before anything is decided. If
the probe says the server cannot judge, the queue parks and **nothing is
deleted**.

If the probe says the server is **fine**, the two part company, and the
asymmetry is the whole reaper:

- **`SEM_DIAGNOSTICO`** — the server is working and still cannot file *this*
  note. That is the impossible-note case, it can never succeed, and at the end
  of the budget it is **deleted**. Without that, it is retried on every reload
  for ever.
- **`PROCEDIMENTO_INVALIDO`** — the refusal happened above the note, so no
  number of retries turns it into evidence about the note. It is **held for the
  next page load**, never deleted.

Folding those two together reads as one tidy rule and silently disables the
reaper. It was written that way once and live testing caught it.

This **can donate the same note twice**, and does so knowingly — but the window
is narrower than it looks. **Exactly one answer files a donation: 200 OK with a
`mensagem` containing `sucesso`.** Every other answer above — every 400 refusal,
the 500 shrug, a body this code cannot read — means nothing was filed, and
resending costs no duplicate at all.

The duplicate risk lives entirely in the case where **no answer arrived**: a POST
that timed out or died with the connection may have been processed by the server
before we stopped listening. Those throw `REDE`/`SERVIDOR`, stay in `nfpr:fila`
and are resent. Losing a donation is the worse failure of the two — see
[Known gaps](#known-gaps).

That distinction is load-bearing for what the UI is allowed to say. A note the
extension gives up on **was not registered**, flatly, and the
["erros desconhecidos" surface](#7b-a-good-note-that-vanishes-must-not-vanish-quietly)
says so without hedging. Softening it to "may not have been registered"
understates in the one direction that loses donations: a volunteer who thinks a
note probably went through puts the receipt on the done pile.

#### The shrug, and the health probe

What the endpoint's answers distinguish:

| request | HTTP | body |
|---|---|---|
| impossible note (99th month) | **500** | `{"erro":"A aplicação retornou que não foi possível concluir a ação solicitada."}` |
| note past its deadline | 400 | `{"chaveAcesso":"O prazo para doar esta nota expirou. …"}` |
| invalid token (`value`) | 400 | `{"chaveAcesso":"Esta nota não pode ser doada. Motivo: Procedimento inválido."}` |
| empty target CNPJ | **500** | identical to the first |
| unregistered target CNPJ | 400 | `{"cnpjEntidade":"Não existem dados para o CNPJ informado."}` |
| no `cnpjEntidade` field at all | **500** | identical to the first |

Two things fall out of that table.

**The 400s are the donation engine's validators speaking; the 500 is the stack
giving up outside them.** Three unrelated causes produce the 500 sentence byte
for byte, so it diagnoses nothing — and it may equally cover others, a genuine
outage included. It is called **the shrug**
and treated as *no information*, never as a cause. It is detected on the
presence of the `erro` **field**, never on its wording.

**The key is validated before the entity.** An expired key gets the `prazo`
refusal and the CNPJ is never looked at, which is why a nonsense CNPJ is ignored
in that case. (The `cnpjEntidade` row above is for an in-date key.)

> **The HTTP status must not decide.** The shrug arrives as a 500, and `SERVIDOR`
> is an outage code that latches the connectivity watchdog and parks the whole
> queue — so if the status were judged before the body, one impossible note
> could fake a site-wide outage. It is not: the only `status >= 500` check on
> the POST path sits in the branch where `resp.json()` failed, so it fires only
> when there is nothing to read. That ordering is asserted in `tools/smoke.js`,
> because it is invisible in the source — it rests on where a check sits.

**A POST guaranteed to be refused is not a donation claim**, and that is what
makes the server directly checkable. On the first shrug, the extension asks it a
question whose answer is already known:

```
chaveAcesso  41010100000000000000650000000000000000000003
cnpjEntidade 1
```

- a **specific refusal** on either field ⇒ validation ran ⇒ the server is fine,
  so a note that failed really is the note's problem, and the reaper is right.
  (A `mensagem` never counts, whatever it says. The probe is built to be
  refused, so even "sucesso" on it means the probe or the server is broken.)
- **the shrug, an unreadable answer, or nothing at all** ⇒ the server cannot
  judge donations ⇒ the queue is parked and **nothing is deleted**

The probe key is long expired (January 2001) and structurally sound — cUF 41,
modelo 65, correct check digit. It is deliberately the *same shape the server
accepts* when in date (see below), with the clock wound back
twenty-five years: the server has no structural objection to it, so the only
thing refusing it is the deadline validator, and a refusal therefore proves the
engine decoded a date, compared it to a clock, and formed a judgement. Nothing
shallower would prove that. Our own checks call that key **red** (the zeroed
issuer fails the CNPJ checksum), so it can never be mistaken for a scanned note.

**The `41` in it is load-bearing.** The cUF is the [first field the engine
decides](#what-the-post-actually-validates), ahead of the date and the document
model, so a probe key from another state would be refused at gate one. That
refusal is still *specific*, so the probe would still read it as healthy — while
proving only that the endpoint parsed two digits and looked them up in a table.
It is a tempting swap, because a non-PR key is refused by a rule that can never
loosen the way a deadline might. It is the wrong swap: the probe's entire value
is the **depth** of the refusal it provokes, and cUF is the shallowest answer
the engine has.

The CNPJ is belt and braces. The two refusals are in **sequence**, not in a
race: the key is judged first, so the CNPJ only matters on the day the deadline
check stops applying — and on that day nothing may be filed. A key the engine
refuses comes back as the *key* refusal, never the entity one, whatever the
CNPJ field holds. It must **never** be empty or missing, both of which produce the shrug; a probe
that shrugs at itself would report "not healthy" for ever and silently kill the
reaper.

**The deadline refusal costs nothing and may be repeated freely.** It is
rejected instantly, counted as a donation nowhere, answers with the same
sentence every time, and re-sending the same expired key changes nothing. The
probe is therefore not rationed for safety — the single-flight guard and the
30 s cache exist to spare the government's server and to let one answer settle a
whole burst of failures. The one answer worth *not* provoking is `Procedimento
inválido`, since a few in a row can end the volunteer's session; the probe
cannot provoke it, because it sends the site's own `documentoComChaveAcesso`
value and a freshly minted token. It can only receive it — and then it reads as
"not healthy", never as proof.

The parked state is a **latched condition** with no action on it — the only bar
in the panel that offers none, because nothing on this machine can fix someone
else's server. It re-probes on a backoff (4 s → 30 s) and resumes on its own; a
real donation succeeding also clears it, since a success proves the same thing
the probe asks for, free.

#### What the POST actually validates

Very little. A key of this shape passes every check the endpoint makes:

```
41260700000000000000650000000000000000000000
41 | 2607 | 00000000000000 | 65 | 000 | 000000000 | 0 | 00000000 | 0
PR   Jul/26   issuer: zeros   NFC-e  série 0   note nº 0    código 0   CDV valid
```

**There is no such note.** The issuer document is fourteen zeros, the invoice
number is zero, the numeric code is zero. The only field in it that survives any
scrutiny is the check digit, which is arithmetic on the other forty-three. The
endpoint has no objection to it.

So the POST examines the **cUF**, the **date** (plausibility *and* age), the
**document type**, and the **módulo-11 check digit**. That is the whole list. It
does not look at the issuer document, the série, the invoice number, the numeric
code, or whether the note it describes has ever existed. An impossible date is
not even a rejection — it comes back as a **500**.

> A description, not an invitation. Donating fabricated keys pollutes a real
> charity's ledger until the monthly pass sweeps them out; `simularEnvio` in
> [debug mode](#modo-de-depuração) exists so testing never needs a real request.

**Those four are checked in an order, and the cUF goes first.** Forty-four
zeros — an impossible date, an impossible document model (`00`, not `65`), a
zeroed issuer, and a check digit that happens to be valid — is answered with a
**400** naming only the state:

```json
{"chaveAcesso": "Esta nota não pode ser doada. Motivo: Estabelecimento emitente não está localizado no Estado do Paraná."}
```

Not the 500 the impossible date produces on its own, and not `tipo de documento
inválido`. Only the check digit is decided ahead of it, which stands to reason:
the cUF is one of the forty-three digits the CDV is computed over, so there is
nothing to read until the arithmetic holds. The practical consequence is that a
non-PR key never reveals anything else wrong with it — one refusal, first field,
and the engine stops. It outranks `cnpjEntidade` too: whatever the target
CNPJ, such a key is answered by naming the state.

That refusal is `inelegivel` and **terminal**: recognised, so the note leaves
`nfpr:fila` on the first answer, is never retried, and never reaches the
[failures list](#7b-a-good-note-that-vanishes-must-not-vanish-quietly). It is
pre-empted locally by `NAO_PR`, which is the only reason it is rare — a note
reaching it slipped past our own table (a forced verdict in debug mode, say).

#### Acceptance is provisional — the real adjudication happens monthly

A successful POST is **not a donation**. It is a *claim* on a note, and some
ineligibility is only applied later: the balance is computed monthly, and
duplicates and notes that already had a buyer are discarded at that point. None
of that is reported back over HTTP. By the time a note is thrown out, the
volunteer is far past the receipt and will never learn which one it was.

**Two separate passes, not one.** Do not read "it is all sorted out monthly" —
some rules *are* enforced at send time, and the deadline is the clearest case:
an expired note is refused immediately with an **HTTP 400**:

```json
{"chaveAcesso": "O prazo para doar esta nota expirou. A doação deve ocorrer no máximo até o mês seguinte a data de emissão da nota."}
```

That sentence states the interval **incorrectly** — it repeats the pre-2020
"mês seguinte" wording, while the decree (and the engine that produced the
sentence) allows a further month. The refusal is authoritative; its explanation
is not.

That reverses the naive reading of the response table above:

> **The server's rejections are authoritative. Its acceptances are not.**

A rejection is a real verdict — `prazo para doar` means expired, and no local
rule should second-guess it. An acceptance means only that the request was
well-formed enough to be filed, as the key above shows.

So for the **grey** verdicts — the eligibility half — the line that matters is
not "stricter than the POST". The POST accepts notes that cannot exist, and
being stricter than it is routine and correct. The line is **stricter than the
monthly reconciliation**, and *that* is what silently destroys real donations.
The `+ 2` deadline is drawn against the reconciliation, and so is the decision
to accept the NF-e.

This also caps what the UI is entitled to promise. "Registrada com sucesso"
means *the site accepted it*, not *it was credited* — nothing reachable from a
browser can tell the volunteer the second thing.

#### The red checks answer to the scanner, not to the server

Eligibility is only half of what local validation is for, and the smaller half.
The other half — the reason the red verdicts are far stricter than anything the
site does — is catching **input that arrived wrong**: a mistyped digit, a
scanner that dropped or doubled one, a barcode read off a creased receipt.

That has nothing to do with whether the note is donatable. The question is
whether the 44 digits in the buffer are the 44 digits printed on the paper, and
there is exactly one moment when the answer is still actionable: **while the
volunteer is holding it.**

Picture the accepted key above arriving by accident, from a bad read of a real
receipt. The server files it. The panel turns green. The volunteer puts that
receipt on the done pile and moves on. At month end the phantom is discarded —
and the real note, still perfectly donatable, was never donated by anyone.
**A mis-scan the server accepts is a lost donation**, and it is invisible from
both ends. That, not eligibility, is what the red checks are for.

They are therefore stacked as *corruption detectors*, each one narrowing how
much damaged input can still look plausible:

| Check | Corrupted input that still gets through |
|---|---|
| length + numeric | anything that happens to land on exactly 44 digits |
| módulo-11 check digit | about 1 in 11 |
| `DOCUMENTO_EMITENTE` — two more check digits, inside the key | about 1 in 1100 |
| `MES_INVALIDO`, `FUTURA` | a date the paper could never have carried |

`DOCUMENTO_EMITENTE` is the sharpest illustration of the whole principle: the
server accepts a zeroed issuer, and refusing it locally is *still*
right, because a zeroed issuer is evidence that what arrived is not what was
printed. Its message says that and nothing else — *"A chave informada não
é válida."* Nothing more is needed: a red toast with the error buzz
already says to read the paper again, which is what actually saves the donation.

#### Which local verdicts the server would have caught, and which it would not

The grey verdicts do not all have the same standing, and the difference
decides which of them are merely saving a round trip and which are the *only*
thing standing between a volunteer and a donation that never happens.

| Grey verdict | What the POST does with it |
|---|---|
| `NAO_PR` | **rejects** — cUF is one of the four fields it checks, and the first one it decides |
| `TIPO_DOCUMENTO` | **rejects** — `tipo de documento inválido` |
| `EXPIRADA` | **rejects** — HTTP 400, with the wrong interval in the sentence |

All three are pre-emptions: the server agrees, and checking locally saves a
request and answers instantly. Remove one and the note still gets refused, just
slower and with the site's own wording.

**No local grey today catches something the server would file.** The one that
did, `EMITENTE_CPF` (a CPF issuer), was removed on 2026-09-28 — see
[Two models are accepted](#two-models-are-accepted). A note
that is filed and then dropped in the monthly reconciliation is the failure this
project ranks worst, because nothing anywhere ever reports it. If a future grey
rule targets that case, it needs a primary source, and it should be written as a
single row that can be deleted intact.

`SERIE_EXCEPCIONAL` (série `990`–`999`) was deleted that way on 2026-09-23, when
an audit found no line of the MOC's série table and no Nota Paraná rule behind
it. A grey with no rule behind it is stricter than the reconciliation — the one
thing grey must never be.

#### Donating is choosing a target — and the check that matters most cannot be made

A note carries **at most one target**. At the register the consumer may give
their CPF, which targets the note to them then and there. Donating is not
"giving away" a note in any richer sense: it is **choosing the target of a note
that does not have one yet**.

Everything follows from that. The only donatable notes are the ones nobody
claimed at the till — precisely what a donation box collects. A note that
already carries a CPF is **silently ineligible**: the POST accepts it like any
other, and the monthly pass discards it.

**Nothing in the 44 digits says whether a note is already targeted.** The key
describes the *note*; the target is state held elsewhere, and the donation
endpoint never mentions it. So the single most valuable check in this whole
problem — *has this note already been claimed?* — is the one check the extension
cannot perform, and the volunteer scanning a shoebox of receipts cannot perform
either. If a status-lookup endpoint exists anywhere in the site, finding it would
be worth more than everything in `chave.js` combined.

### Telling "server down" from "session expired"

A same-origin fetch that throws while the browser claims to be online has two
very different causes. Either the request failed on the way (the server is
unreachable or struggling, or the connection simply dropped), or the session
expired and the server redirected to a login page on another origin, tripping
CORS. They are told apart by asking for the donation page **without following
redirects**, and reading the answer the same way `Sessao.conferir` does
(`Donation.sessaoPelaResposta`):

| The follow-up answers | Meaning | Code |
|---|---|---|
| `opaqueredirect`, any 3xx, 401, 403 | the login is gone — proof | `SESSAO` (or the duplicate / encerrando variants) |
| 2xx | the login is **fine**; the failure was transient | `SERVIDOR` |
| anything else, or nothing | the server is in trouble | `SERVIDOR` |

A dead session is a latch that stops the whole queue, so it is only ever
**proved**. It used to be inferred from any answer below 500, so one dropped
connection followed by a healthy 200 parked every note behind "Sua sessão
expirou". `SERVIDOR` parks the note behind the connectivity watchdog, which
sends it again as soon as its probe gets an answer. After a transient failure
that is the first probe. A token page whose body breaks off mid-read is
`SERVIDOR` too, and never read as an empty page with no token.

**Reachable** is a different and looser question. Any answer under 500,
`opaqueredirect` included, proves the server is there, and the watchdog asks
nothing more (`connectivity.js`).

**Every request has a deadline** of 20 s (`Site.PRAZO_RESPOSTA_MS`), and it
covers the **body** as well as the headers. A body that stalls after its
headers arrive is given up on as `SERVIDOR`, and the probe reads it as
confused. The entity lookup reads it as unavailable, and `Sessao.conferir` as
undecided. `/sair` alone has no deadline (below).

**The token page is windows-1252**, and `Response.text()` always decodes UTF-8,
so its bytes are decoded by `donation.js` itself. UTF-8 is tried strictly first
and windows-1252 is the fallback. Read as UTF-8, "sessão" came back with a
replacement character where the "ã" was, and a duplicate session met
mid-sitting was reported as an expired one.

**The JSON answers are UTF-8**, so the POST and the probe read them with
`json()`. They declare `application/json;charset=UTF-8`, and their accented
sentences arrive intact (observed 2026-09-29). Only the HTML page needs the
fallback.

### Other endpoints

- **Entity registry.** `GET /nfprweb/app/v1/documentoFiscalDoado/entidadePorCnpj/<cnpj>`.
  Redirect to `login` → not logged in; **204 No Content, with an empty body →
  not registered** (observed 2026-09-29 for `00000000000191`; a 404 is read
  the same way, though it has never been seen); OK with
  `idEntidade`/`nmEmpresarial`/`cnpj` → found, exposing `nmFantasia`,
  `nmMunicipio`, `cnpjFormatado`. **Everything else is unavailable**: another
  non-OK status, a network failure or the 20 s deadline, and also **a 200 whose
  body is not JSON or carries no entity**. That last one used to count as not
  registered. The 204 is matched by its status, before any parse. This page
  used to say 404, and the code only got the 204 right by accident: `ok` is
  true for a 204, `json()` then failed on the empty body, and a failed parse
  meant "not found". A parse failure alone cannot tell the 204 apart from a
  broken 200. "Not registered" has consequences: the
  entity is latched as refused, the queue parks behind "não aceita doações"
  and saving is refused. An HTML page served as 200 during maintenance or a
  duplicate session is the registry failing to answer, not a verdict. An
  unavailable entity is saved unverified and asked about again on the next
  load.
- **Session termination.** `GET /nfprweb/publico/sair`, redirects not followed.
  The response is expected to be opaque or error-like — that is normal and counts
  as settled; the server still terminates the other sessions.
  **It takes ~10.4 s** (observed 2026-09-05), and reliably enough that the
  number looks like a fixed delay on their side rather than load. Two things
  depend on knowing that. Nothing may treat this request as quick: a spinner
  with no sense of duration reads as a frozen page for ten seconds. And nothing
  may set a timeout at all — cutting `/sair` off just before it answers leaves
  the duplicate session exactly where it was, which is worse than waiting. The
  first-run takeover in `content.js` counts ten seconds down for this reason
  (the counter very nearly *is* the wait), and it is **purely illustrative**:
  the reload happens when the request resolves and at no other time. **One at a time**,
  whoever asks: the preference, the session bar's button, and the button on any
  note refused for a duplicate session all reach the same in-flight promise in
  `sessao.js`, and everything that has to react subscribes to it. None of them
  navigates — the page that reports the outcome is the page you are on. Asking
  again after one has finished does fire a second request, on purpose: the
  action is only still on screen if the server is still reporting two sessions,
  so the first attempt did not take.

### DOM-level integration

The site provides a hidden advanced-search dialog, container id
`conteudoPesquisaAvancada`, whose results table receives rows inside an ancestor
whose id/class contains `entidade`/`Entidade`. It is rendered **outside** `#main`,
so replacing `#main` with the registrar does not destroy it. The CNPJ cell is
identified by content pattern, never by column position. `NFPR.BuscaSite` in
`modal-entidade.js` owns all of it — showing the dialog, hiding it, and the row
scraping.

#### That dialog locks itself on a dead session

Observed, and it is the site's own bug, not ours. Its "Pesquisar" button runs
`ConsultaEntidadeDoacaoDocFiscal.pesquisaAvancadaEntidade()`
(`reference/doacao_files/consultaEntidadeDoacaoDocFiscal.js.download`), which
covers the dialog with a blockUI overlay and POSTs to
`app/v1/documentoFiscalDoado/pesquisaAvancada/entidade`. With the session gone
that POST is 302'd cross-origin to `authz-sefa.identidadedigital.pr.gov.br`,
CORS kills it, and the failure handler runs `JSON.parse(jqXHR.responseText)` on
an empty string. It **throws** — and jQuery 2.1.4 fires deferred callbacks in a
bare loop with no `try`/`catch` (3.x added one), so the exception skips every
callback registered after it, including the `.always()` holding
`desbloquearTela()`. The overlay stays and the deferred is left mid-firing for
good: the dialog is dead until the page is reloaded.

We cannot patch their handler from the isolated world, and we do not touch
blockUI's elements. Instead we are not there when it happens. The overlay is a
child of `#conteudoPesquisaAvancada`, the element we ourselves unhide, so
`Sessao.conferir()` is asked before opening the dialog and again the moment a
`.blockUI` child appears (i.e. Pesquisar was pressed); on `MORTA` we hide the
dialog again and toast *"Entre novamente no Nota Paraná para buscar entidades no
site."*

A `MORTA` is also **announced** (`Sessao.aoDescobrirMorta`), and `content.js`
latches it through the same `pararPorSessao` a note that came back `SESSAO`
goes through: the send pool pauses, everything waiting goes amber, the session
bar appears with *"Sua sessão no Nota Paraná expirou. As notas continuam
guardadas."* and its **Entrar novamente** link, and the error sound plays once.
The toast answers a different question — why the dialog did not open — so the
two are not two narrators for one event.

`Sessao.conferir()` is one GET of `DoacaoDocumentoFiscalCadastrar` — the login
target, so the least ambiguous thing on the site to ask — with
`redirect: 'manual'`, which is what makes the answer readable: followed, the
302 lands cross-origin and `fetch` throws, indistinguishable from an unplugged
cable. It answers `VIVA` / `MORTA` / `INDEFINIDA`, and **only `MORTA` acts** —
closing the dialog because a probe could not reach the server would be a worse
bug than the lock, since it would fire when nothing is wrong. Single-flight, and
not cached after it settles.

#### The header is merged, not replaced

The site's own header and the registrar's own header used to stack, and between
them they took **127px at 1280px, 148px at 800px** (below 992px their
`#user-info` un-floats onto a second line, so it gets *worse* as the window
narrows) **and 101px at 400px** — plus 64px of ours on top of every one of those.
That is 191–212px of chrome above the first result row, on a panel that is sized
to the viewport and never scrolls, so every pixel of it came straight out of the
list.

They are now one **54px** bar, and `#main` starts at 64px at every width.

The bar is still the site's `#header`, restyled in place by `host-page.js`:

```html
<div id="header" class="col-md-12">
  <a class="logo"><img …></a>
  <!-- our closed shadow host is inserted here, by ui.js -->
  <div id="system-info">
    <div id="page-info"><h1><span></span></h1></div>   <!-- hidden: empty here -->
    <div id="user-info">
      <span id="user-name">…</span>                    <!-- stacked over the CPF; hidden <768px -->
      <span id="user-log">000.000.000-00</span>
      <div class="user-info-options">                  <!-- display:contents -->
        <a id="user-config">Configurações</a>           <!-- laid UNDER name + CPF: one pill -->
        <div class="user-config-options">…</div>        <!-- their dropdown -->
        <a id="user-logout">Sair</a>
      </div>
    </div>
  </div>
</div>
```

**Every control in that bar is still theirs**, in their DOM, with their handlers
bound to it. We move nothing: their `#user-config` toggle finds its dropdown
with `$('.user-config-options')`, a *document* query, so a node moved into a
shadow root would stop being found and the dropdown would silently never open
again. Restyling is the whole mechanism, and the only thing we add is one empty
`<div id="nfpr-cabecalho-host">` carrying a third closed shadow root, which
holds our *Início* link and the entity chip.

**Every rule is `!important`, and that is not defensiveness.** Their header
changes shape at 767/768/991/992/1200px across four media queries; every one of
those declarations is normal weight, so an `!important` declaration of the same
property beats it at every width without our reading their table at all. The
rule that follows from it: **declare enough properties.** One left undeclared is
one they still control, and it will move under us at a breakpoint nobody tested.

Two things are deliberately **not** declared, and both are load-bearing:
`overflow` on `#header` (their account dropdown hangs below the bar and would be
clipped) and `display` on `.user-config-options` (jQuery's `fadeIn` writes it
inline, so an `!important` rule would pin the dropdown open or shut for the life
of the page).

Their name and CPF **are** their Configurações button now, the way the entity
chip is ours: `#user-config` is placed in the same grid cell as the two spans,
which sit above it with `pointer-events: none`, so a click anywhere on the pill
reaches their anchor and its handler. Nothing is moved into the anchor: their
outside-click closer ignores only clicks whose target id is `user-config` or
`user-config-icone`, so a span inside it would open the dropdown and shut it in
the same click. The word "Configurações" no longer appears in the bar: a profile
icon (a person in a circle) sits at the pill's left edge, where our chip keeps
its gear — drawn in the same style, but deliberately not the same glyph, so the
two settings doors are told apart at a glance.

**The duplicate-session screen renders the same header with no controls in
it.** Same URL, same `#header`, but their template comments out `#user-config`
and its dropdown and omits `#user-logout`, so `.user-info-options` arrives empty
and only the name and the CPF remain (observed in the 2026-09-28 snapshot,
`reference/doacao_sessao_duplicada.html`). Each half of the layout above is
keyed to its own control being present (`:not(:has(…))`), so with the pill
missing the two lines lose the room reserved for its icon and padding and sit
flush after the hairline as plain text, and with *Sair* missing its grid column
and gap go too. Not dressed as a pill: in this bar a pill means "click me", and
there is nothing to click.

What gives way as the window narrows, in order — the volunteer's **name** first,
at 767px, leaving the icon and the CPF on the pill; then the "Sair" label at 440px,
keeping its `fa` icon and its hit area; on our side the "Início" word, then the
entity name, then the CNPJ, leaving the gear alone; and last, below 360px, the
CPF, leaving the pill as the profile icon alone. That last step is measured:
below it our half of the bar no longer holds the icon-only Início link and the
gear. The duplicate-session screen, which has no pill, keeps its CPF.

The name goes first because the CPF identifies the volunteer in less than half
the width, and the name is the one thing in the row nothing is ever done with.
It used to be the site's own `@media (min-width:1200px)`, which in practice
never showed it at all: 1200px is the *ceiling* of their fixed `#container`, so
the rule asked for a viewport as wide as the widest bar that can ever exist
while the bar itself gains not one pixel above it. Stacked over the CPF it costs
only what it exceeds the CPF by, so it is an ordinary step of the ladder instead
— the first step. It is capped at 200px and ellipsized, because `#system-info`
is `flex:0 0 auto` against our `flex:1 1 0%`: every pixel their block takes
comes out of our strip, and an unusually long name would otherwise collapse the
chip on the widest screen there is. **Our half is driven by container queries, not
media queries**, because their `#container` is *fixed*-width per breakpoint
(758 → 982 → 1200): 991px of viewport gives our strip a 758px bar and 992px
gives it 982px, a 224px jump no viewport query can see. The strip asks how wide
*it* is instead, which also means their breakpoints can move without moving ours.

Neither settings door in the merged bar carries the word "Configurações".
Ours became the entity chip first — a button reading *"⚙ AMARAS… /
04.200.654/0001-10"* — because two identical labels a few centimetres apart opening completely
different things (ours: entities, fixed parts, preferences; theirs: password,
e-mail, cadastro) is worse than one of them carrying only a gear, and
relabelling someone else's control is a bigger liberty than not labelling our
own. It carries no visible caption of its own; *"doando para"* lives in its
hover title instead, because an unlabelled CNPJ in a header can be read as the
volunteer's own.

If the site rewrites this header, our rules stop matching and it renders at
whatever height the site gives it, with the registrar below — taller, not
broken. If `#header` is missing entirely, `ui.js` asks before mounting and the
strip simply stays on the panel where it has always been.

The page's own footer is the other piece of site markup we depend on, and
`host-page.js` restyles it in place:

```html
<div class="vcard" id="footer">
  <div id="footer-info">
    <p>© <span class="fn org">Secretaria da Fazenda - v1.5.5 - …</span></p>
    <br>
    <div class="logos"><a href="…celepar…"><img class="photo" …></a></div>
  </div>
</div>
```

Four things are load-bearing: the ids `#footer` and `#footer-info`, the `<br>`
between the version string and `.logos` (removing it is what puts them on one
row), the class `.logos`, and the fact that **the site positions `.logos`
itself** — `right: 0; top: auto` only bite because something in the site's own
CSS already took it out of flow. `span.fn.org` is in this markup too, and is
separately the target of the 7-click debug gesture.

If the site rewrites this footer, nothing breaks: our rules stop matching, the
footer renders at whatever height the site gives it, and the panel goes back to
reserving 35px for it — a gap or a small scroll, not a failure. It is worth
noticing, which is why it is in the checklist.

### Scanners

Not a software integration but a contract: handheld barcode/QR scanners in
keyboard-wedge mode, emitting printable characters 1–30 ms apart, terminated by
Enter and/or Tab (some emit both, some only Tab — both must submit). QR payloads
are URLs containing the key as the only run of 44+ digits.

Some scanners end a read with **several** terminators — a burst of Tabs, or CR
followed by LF. The first one submits; the rest are swallowed as part of the
same reading, so they never move focus off the entry. Version 1.0.0 let them
through and the Tabs walked focus into the page and the browser's address bar;
1.0.1 swallowed every Tab, which also stopped Tab reaching the panel's
controls; 1.0.2 swallows only a reading's tail (CLAUDE.md, *A reading ends
once*). An **on-screen keyboard** (the Windows one was recorded) sends keys
only while a field has focus, so the registrar keeps its hidden entry input
focused whenever the keyboard would otherwise be on nothing. A scanner's own
"teclado virtual" mode has not been recorded and may be something else;
`tools/teclas.html` records what any device sends. Known gaps: a scanner that sends its suffix after a **failed** read
still gets its first terminator through, and nothing is swallowed while the
settings window or a fixed-part field has the keyboard.

---

## Modo de depuração

A development-only mode that deliberately opens the gates the rest of this
extension exists to keep shut. Two files: `src/shared/debug.js` (the state and
the flags, DOM-free because it loads in the popup too) and
`src/content/debug-ui.js` (the way in and the form).

**It exists because of the gap between the two things above.** `smoke.js` covers
the pure logic and the checklist below covers the live site, but a whole class of
behaviour is reachable by neither without changing the machine's clock, owning a
note in exactly the right state, or unplugging the router: every time-dependent
verdict, every branch of the [server answer table](#donation-two-steps-per-attempt),
and every outage path.

### Getting in

**From the console.** The documented route, and the only one that always works.
Content scripts run in the isolated world, so `NFPR` is unreachable from the
page's own console — switch the devtools context dropdown to the extension's
world first.

```js
NFPR.Debug.ajuda()          // the flag table, printed
NFPR.Debug.ligar({ relogioFixo: { ano: 2026, mes: 12 } })
NFPR.Debug.desligar()       // what the red banner's button does
NFPR.Debug.limpar()         // forget the record entirely
```

**Seven clicks on `span.fn.org`,** Android's build-number tap, for a machine
where opening devtools is awkward. The element belongs to the government page,
not to us, so this is a document-level capture-phase listener like `capture.js`
— it reads the host page and never touches it. A click anywhere else, or a gap
over 2.5 s, restarts the run; the last four taps count down in the toast, in
Android's own words ("Agora faltam 3 etapas para você se tornar um
desenvolvedor." → "Você agora é um desenvolvedor!").

Arming this way switches **every flag off**, so the gesture on its own cannot
change how a single note is judged — all it buys is the red banner. Once armed
the gesture is inert: every toast it raises reads "Não é necessário, você já é
um desenvolvedor." and it opens nothing.

> If the page ever moves `span.fn.org` inside `#main`, `ui.js` replaces that
> subtree on mount and the gesture becomes unreachable. Nothing can detect
> that from here; the console is the fallback.

### The form

The red banner's **Cuidado!** is a link to a `Depuração` page in the same modal
as Configurações — same chrome, same styling, same Esc-to-close. Nothing in the
modal header leads to it: the banner is the only door, and the banner only
exists while the mode is armed, so a volunteer cannot wander in.

Every control writes through `NFPR.Debug.ligar` and the form repaints from
`Debug.aoMudar` — so the console, the banner's button and the form can never
disagree. It also carries five one-click **test keys** (bad check digit,
expired, another state, another document — a CT-e, impossible month), built by `chaveFalsa` with
the check digit already right: select and paste into the registrar.

Beside them, **Conferir os vereditos** runs `NFPR.Debug.smoke()` — the whole
verdict table, seventeen keys judged against the month the assistant currently
believes in. The table goes to the console, but the answer is printed **on the
page**: how many passed, which month they were judged against, and the name of
every failure. That is deliberate — this form exists for the machine where
opening devtools is awkward, so a button whose only output is a `console.table`
would be decoration. The month is stated because a fixed clock changes the answer
silently; "17 de 17 casos, no mês 06/2030" is how you notice you are still time
travelling.

| flag | what it opens |
|---|---|
| `aceitarChavesInvalidas` | red verdicts (CDV, format, month, issuer document, future) become sendable |
| `ignorarInelegibilidade` | grey verdicts (another state, neither an NF-e nor an NFC-e, past the deadline) become sendable |
| `ignorarDuplicadas` | the same key can be scanned over and over |
| `partesFixasSemValidacao` | save a fixed part whose fixed digits can only describe dead notes |
| `simularEnvio` | never POST; answer *sucesso* |
| `respostaForcada` | a server body — or a bare sentence — run through the **real** classifier |
| `erroForcado` | **one attempt's answer.** Throw `REDE`/`SERVIDOR`/`SESSAO`/`SESSAO_DUPLICADA`/`ENCERRANDO_SESSAO` instead of talking to the site; the note follows the normal path from there, latching whatever condition that code implies. The probe stays real, so a forced outage still recovers on its own |
| `relogioFixo: {ano, mes}` | move the clock, for the whole extension at once (the form's boxes take the key's own two digits — `12` and `26` is December 2026 — while the flag itself stores a full year) |
| `forcarConexao` | **the watchdog's view of the world**, not one note's answer. `'online'` / `'offline'`, replacing the probe so no test request is issued at all — `'online'` makes the watchdog believe without asking, which no forced failure can express, and `'offline'` also fails every send so notes park without trying |
| `registroVerboso` | console tracing |

Three helpers need no flag and are safe while disarmed.
`NFPR.Debug.chaveFalsa({ ... })` builds a 44-digit key with any field replaced
and the check digit recomputed (`smoke.js` builds every one of its fixtures with
it). `NFPR.Debug.smoke()` runs seventeen of those keys — one per verdict, plus both
sides of the `emission + 2` boundary and both models — through `Chave.avaliar` **with the clock**
and prints a table; it is the manual checklist's fixture generator and its own
regression test at once, and `tools/smoke.js` asserts it stays green so its
expectations cannot rot unnoticed. `snapshot()` / `restaurar()` / `gravar()` are
raw storage access — breaking `nfpr:config` on purpose was always possible from
any console; what was missing was cheap undo.

### What keeps it honest

1. **A red banner across the registrar** for as long as it is armed, listing the
   live flags, with *Voltar à segurança* on it. A **condition, not a
   notification** — no dismiss control, repainted from the state on every change,
   so it can neither get stuck showing nor stuck hidden while armed. Both
   registrars get it from the shared bootstrap, so the offline page cannot miss
   it. The toolbar badge reads a red **DEV** instead of the pending count.
2. **Every forced row is marked** — *⚠ forçada em depuração* — so the result
   list can never pass a bypassed note off as an ordinary one.
3. **`simularEnvio` arms itself** whenever `aceitarChavesInvalidas` or
   `ignorarInelegibilidade` is switched on. Actually putting a fabricated key on
   the government's server takes a second, deliberate `ligar({ simularEnvio:
   false })`. **A simulated success never empties the real queue**: a restored
   note answered by the simulation stays in `nfpr:fila` (its row says so, in
   amber) and goes out for real on the first load without the flag. A *scanned*
   one is removed as usual — the scan put it there a moment earlier, and a
   fabricated test key left behind would be POSTed once debug mode is off.
4. **It ships, and it ships inert.** `debug.js` and `debug-ui.js` are part of
   the extension like every other module. Nothing is armed until the 7-click
   gesture, the gesture arms it with every flag off — explicitly, whatever
   *Voltar à segurança* kept from the last session — and `smoke.js` asserts that
   with nothing stored every flag reads off and every hook is the identity
   function.

> **The one real danger.** `aceitarChavesInvalidas` with `simularEnvio: false`
> sends digits that failed validation to the live Nota Paraná, under whatever
> entity is active. Nothing in this document needs that; leave `simularEnvio`
> on.

`chave.js`, `parte-fixa.js` and `cnpj.js` never see this module — they stay
pure, and each bypass happens at the decision site that calls them. In
particular the verdict downgrade is one call in `registrador.js`, not a branch
inside `Chave.avaliar`.

---

## Manual test checklist

**This is the test suite.** There is no automated coverage of the network layer,
the DOM, or anything needing the live site. Run top-to-bottom in one sitting,
with a fresh unpacked load and a logged-in session.

**The fixtures have to be built for the month you run them in.** `AAMM` is
judged locally now, so a key hard-coded here would start failing as expired the
moment the deadline passed. Open the bundled offline page (toolbar popup → the
offline entry), press F12, and run one line — it has `NFPR` loaded:

```js
NFPR.Debug.smoke()
```

Sixteen fixtures, every one built relative to `NFPR.Relogio.mesCorrente()` and
judged against it, printed as a table of *name · the 44 digits · expected code ·
obtained code · colour · ok*. **Copy the `chave` column** — those are the keys
the steps below ask you to submit. It returns
`{ ok, total, falhas, agora, linhas }`, and `linhas[n].mensagem` is the sentence
the volunteer would have seen.

> **The fixture keys are made up, and none of them goes to the live site.** A
> step that sends one runs with `simularEnvio` or `respostaForcada` set in
> [debug mode](#modo-de-depuração); both answer without making a request. The
> steps that need a real request — the Network-tab ones in §7 and §8 — use a
> **real note**: the key of a receipt of your own, still inside its deadline.

Because the fixtures move with that clock rather than being written down, the
pass is also green under `relogioFixo` — which is how you check that time travel
reaches every verdict at once, and it covers the two months no hand-built set
ever includes: `emission + 2` (still donatable) and the month right after it.

> **Judging a key by hand? Pass the clock.** `FUTURA` and `EXPIRADA` are marked
> `relogio: true`, and `chave.js` *skips* a clock-dependent check when no `agora`
> is given — on purpose, so a clock-free caller can never receive a
> time-dependent verdict. So a one-argument `NFPR.Chave.avaliar(k)` answers `OK`
> for both `K_VELHA` and `K_FUTURA`: their digits really are valid, and only the
> date is wrong. Use
> `NFPR.Chave.avaliar(k, NFPR.Relogio.mesCorrente())`.

`smoke()` is the quick path. To build a key by hand instead:

```js
const chave = (b43) => b43 + NFPR.Chave.calcularCDV(b43 + '0');
const key = (uf, aamm, doc, tipo, serie, tpEmis = '1') =>
  chave(uf + aamm + doc + tipo + serie + '000012345' + tpEmis + '87654321');
const AAMM = '2608';              // ← the CURRENT year+month in Paraná
const CNPJ = '61803398874911';    // valid CNPJ
const ALFA = '12ABC34501DE35';    // valid ALPHANUMERIC CNPJ (Receita's example)
const CPF  = '00052998224725';    // '000' + a valid CPF

key('41', AAMM,   CNPJ, '65', '001');                 // K_OK
key('35', AAMM,   CNPJ, '65', '001');                 // K_SP
key('41', AAMM,   CNPJ, '55', '001');                 // K_NFE — an NF-e, accepted like K_OK
key('41', AAMM,   CNPJ, '57', '001');                 // K_CTE — a CT-e, neither model
key('41', '2604', CNPJ, '65', '001');                 // K_VELHA  (AAMM − 4 months)
key('41', '2609', CNPJ, '65', '001');                 // K_FUTURA (AAMM + 1 month)
key('41', '2613', CNPJ, '65', '001');                 // K_MES13
key('41', AAMM,   '61803398874910', '65', '001');     // K_EMITENTE
key('41', AAMM,   CPF,  '55', '930');                 // K_CPF — a produtor rural's NF-e
key('41', AAMM,   CNPJ, '65', '905');                 // K_AVULSA — no verdict any more
key('41', AAMM,   CNPJ, '65', '990');                 // K_990 — no verdict any more
key('99', AAMM,   CNPJ, '65', '001');                 // K_UF99 — no such state
key('41', AAMM,   ALFA, '65', '001');                 // K_ALFA — alphanumeric issuer
key('41', AAMM,   CNPJ, '65', '00A');                 // K_LETRAFORA — a letter in the série
```

`ALFA = '12ABC34501DE35'` is Receita's own published alphanumeric CNPJ, and the
two keys above are the pair for the `[6:18]` window: the letters `ABC` and `DE`
sit inside the issuer, so `K_ALFA` is an ordinary donatable note, while one
letter in the série makes `K_LETRAFORA` red `FORMATO` — a character standing
where no key can carry one, which is corrupted input.

`K_CPF` through `K_UF99` exercise the issuer span, the série and the cUF table.
`K_AVULSA` and `K_990` used to be verdicts and are now ordinary notes: no série
is judged.

Worked example for **August 2026** (`AAMM = 2608`); regenerate for any other
month:

```
K_OK       = 41260861803398874911650010000123451876543214   valid Paraná NFC-e
K_BADCDV   = 41260861803398874911650010000123451876543215   K_OK, last digit changed
K_SP       = 35260861803398874911650010000123451876543217   valid CDV, another state
K_NFE      = 41260861803398874911550010000123451876543211   a Paraná NF-e: accepted
K_CTE      = 41260861803398874911570010000123451876543219   a CT-e: neither NF-e nor NFC-e
K_AVULSA   = 41260861803398874911659050000123451876543210   avulsa série on a 65: no verdict
K_990      = 41260861803398874911659900000123451876543218   série 990: no verdict
K_VELHA    = 41260461803398874911650010000123451876543210   past the deadline
K_FUTURA   = 41260961803398874911650010000123451876543218   emitted next month
K_MES13    = 41261361803398874911650010000123451876543219   month 13
K_EMITENTE = 41260861803398874910650010000123451876543212   issuer CNPJ fails mod-11
K_CPF      = 41260800052998224725559300000123451876543214   NF-e, série 930 + padded CPF
K_ALFA     = 41260812ABC34501DE35650010000123451876543215   alphanumeric issuer: donatable
K_LETRAFORA= 412608618033988749116500A0000123451876543216   a letter in the série: FORMATO
FIXA30     = 412608618033988749116500100001??????????????   first 30 of K_OK + 14 ?
  → variable digits for K_OK: 23451876543214
CNPJ_OK   = 11444777000161   (valid)
CNPJ_BAD  = 11444777000160   (invalid checksum)
CNPJ_ALFA = 12ABC34501DE35   (valid, alphanumeric — 12.ABC.345/01DE-35)
FIXA_ALFA = 41260812ABC34501DE356500100001??????????????   first 30 of K_ALFA + 14 ?
QR_URL    = http://www.fazenda.pr.gov.br/nfce/qrcode?p=<K_OK>|2|1|1|ABC
```

`K_CPF` looks wrong at a glance: its issuer span holds a padded **CPF**, which
the issuer check accepts on any série. It is an NF-e, as every CPF-issued note
is, and it is accepted like one. A red typo toast on it means the issuer check
is reading a CPF as corruption, which is the thing to look at.

**Setup.** Load unpacked, pin the icon, log into `notaparana.pr.gov.br` in the
same profile (real credentials — there is no staging mode).

### 1. First install / onboarding

1. With no prior config (fresh profile, or `chrome.storage.local.clear()` from
   the extension's *Inspect views* console), open the donation page.
2. ✅ **Nothing opens itself.** The key-entry area shows the blocked card
   "Para começar, cadastre a entidade que receberá as doações." with one
   button, and the settings modal opens only when that button is clicked.
   ✅ Where the results list will be, only one line: "O resultado de cada
   nota aparece aqui, as mais recentes no topo." The instruction half —
   "Escaneie a nota ou digite a chave de acesso e pressione Enter." — is
   **not** there, because there is nowhere to send a note yet and it would be
   instructing something that cannot happen. It appears with the entry. It
   used to open on its own, on both this page and the offline one, so first run
   began with a three-card form over a page nobody had looked at yet.
2b. ✅ **The instruction has the right lifetime.** Register one note, then look
   again: the whole empty-list block is gone, replaced by the row. It used to be
   a hint above the entry that the first row retired **for good** — so on a
   machine volunteers move between, the one sentence explaining how to work
   vanished after note one and never came back.
2a. **First run on a duplicate session finishes itself.** Same fresh profile,
   but arrange for the site to report a duplicate session (log the same account
   in from another browser first). ✅ The panel is **taken over** by a single
   centred message, "Encerrando as sessões abertas…", under it a counter ticking
   ten seconds down — no bars, no blocked card, no form, nothing to decide.
   `/sair` goes out; it takes ~10.4 s, so the counter runs out just before the
   answer lands and the line becomes "A página será recarregada em instantes…".
   The page then reloads on its own onto the login screen. Log in. ✅ Ordinary
   first run from step 2, now with a working session, so the CNPJ verifies and
   "Buscar entidade no site" works.
   ✅ The takeover happens **only with nothing configured** — with an entity
   saved the queue may hold notes, and reloading would throw away answers.
2b. **It must never loop.** Same as 2a, but arrange for `/sair` to fail (block
   the request in devtools, or log the second session back in immediately). ✅
   After the reload the duplicate screen is back and the extension does **not**
   take the screen or reload again: it falls back to the session bar with its
   own button, and the volunteer decides. One automatic attempt per tab.
3. Type digits anywhere. ✅ Nothing appears in the cell display.
4. Add a name and `CNPJ_OK`, click "Adicionar entidade". ✅ Saves (verified if
   logged in), becomes active, inputs clear.
4a. Add a SECOND entity. ✅ **It becomes the active one**, the header chip
   changes to it, and the radio moves — same rule as adding a fixed part. It
   used to activate only the very first entity ever saved, so adding another
   looked like nothing had happened and the next note went to the old one.
   Queued notes are untouched: they keep the CNPJ they were scanned with.
5. Close the modal (✕). ✅ Blocked card gone, entry focused.
6. Reopen settings, remove that entity. ✅ Blocked card reappears, no reload.
7. Re-add it (needed below).

### 2. Capture engine

8. Type `123`, Backspace, `4`. ✅ Display shows `124`, caret on position 4.
9. Type the remaining 40 digits of `K_OK`, Enter. ✅ Submits; display clears.
10. With a real scanner (or a <35 ms simulated burst) send `K_OK` ending in
    Enter, then again ending in Tab. ✅ Both submit once each, no dropped or
    duplicated digits.
10a. **A scanner that ends a read with several terminators.** Send `K_OK` as
    a fast burst ending in six Tabs, then again ending in Enter, Enter, Tab.
    ✅ One row each. Focus never leaves the entry: no focus ring appears on any
    control, and a third scan sent straight after registers normally.
10b. **Tab by hand still moves.** With the entry empty, press Tab slowly a few
    times, then Shift+Tab, then hold Tab down. ✅ Focus walks the panel's
    controls forwards, backwards, and keeps moving while held. Press Enter on
    **Escolher parte fixa ▾**. ✅ The list opens.
10c. **On-screen keyboard.** Open the Windows on-screen keyboard, click an
    empty part of the page (not the 44 cells), and press digits on it. ✅ They
    appear in the cells. Then drag across the key on a result row. ✅ The text
    stays selected and can be copied.
11. Send `QR_URL` as a fast burst ending in Enter. ✅ `K_OK` extracted and
    submitted; none of the URL's letters or `|` appear anywhere on the page.
12. Click into the site's own search box (open it first — §6) and type digits +
    Enter. ✅ Only that field is affected; no entry created.
13. With the settings modal open, attempt a full scan burst. ✅ Nothing captured;
    closing the modal shows an empty buffer.
14. Ctrl+V paste `  K_OK  `. ✅ Submits immediately, no Enter needed.
15. Ctrl+V paste `1234-5678`. ✅ `12345678` appended; no submission.
15a. **A paste that does not fit is not composed.** Arm a fixed part leaving 9
    characters to type and paste `123456789012`. ✅ Refused red at once, the
    entry emptied, no row — and the toast says nothing about the fixed part.
    Before, all twelve were appended past the fixed part's gaps and Enter
    composed the fixed part with the FIRST nine, dropping the rest in silence.
    Now paste exactly the last 9 of `K_OK`. ✅ They fill the gaps like typed
    digits and wait for Enter (or go at once with auto-send on).
16. With 44 digits buffered (auto-send off), type another. ✅ Discarded; Enter
    submits the original 44.
17. Type `/` outside a scan. ✅ Swallowed (Firefox quick-find does NOT open).
18. Ctrl+R and Ctrl+T while capture is active. ✅ Browser shortcuts fire normally.
19. Enter with an empty buffer. ✅ Nothing happens; the page's own behaviour is
    unaffected.
19a. **A burst does not inherit your digits.** Type six digits, wait a second,
    then scan `K_OK`. ✅ `K_OK` registers, alone and correctly — not
    `[your 6][the barcode's first 38]`, which is a 44-digit run and would be
    refused red. This has nothing to do with fixed parts: before it, six digits
    left in the entry half an hour earlier were still there when the next
    barcode arrived.
19b. **Esc empties the entry.** Type six digits and press Esc. ✅ The cells go
    empty, nothing is submitted, and nothing appears in the page's own fields.
    Press Esc again on the empty entry. ✅ Not consumed — the page receives it.
19b'. **Typing into a scan makes it yours.** With fixed parts OFF, scan `K_OK`
    with a scanner set to send NO terminator (or cover half the barcode so the
    read stops short), then press Backspace and type a `9`. ✅ The line under the
    cells speaks while you type — before, a buffer that started as a scan kept
    every live verdict silent until it was emptied. Press Enter. ✅ The key is
    refused as usual, and the line then offers fixed parts (*"As chaves das suas notas começam iguais?…"*), because this note was typed by hand. A scan nobody touches still
    never raises the offer (§4).
19b''. **A scan corrected by hand sends what the cells show.** With a scanner
    set to send NO terminator and fixed parts off, scan a QR code, press
    Backspace, and type a different last digit. ✅ The last cell changes, and
    Enter judges THAT key — before, Backspace trimmed the url's tail instead,
    and the scanned key still in the buffer went out while the cells showed
    another. Now arm a fixed part and scan a plain barcode, Backspace, Enter.
    ✅ While you correct it the cells show the scan minus one digit and no
    fixed part; Enter refuses it red WITHOUT mentioning the fixed part — before,
    it composed [the fixed part] + [the barcode's first digits] and judged
    that. Retype the digit you removed instead of pressing Enter. ✅ The
    scanned key registers, marked as scanned under a fixed part.
19c. **A QR scan under auto-send submits once.** Turn on "Enviar automaticamente
    ao completar a chave" and scan `QR_URL`. ✅ Exactly ONE row, with `K_OK`, and no red
    toast after it. Before this, the run of 44 completed mid-reading: the key
    went out correctly, the buffers were emptied, the trailing `|2|1|1|ABC`
    dropped `2`, `1`, `1` into a fresh entry, and the scanner's own Enter
    submitted `211` as a key — a correct registration followed by a spurious
    refusal, on every QR scan.

### 3. Local validation

**Keep DevTools' Network tab open for all of this: the point of every step below
is that NO request is made.** All of §3 assumes *Enviar sem verificação prévia* is
**off**, which is the default — with it on every step here sends instead, which
is what §3a checks.

20. Submit `123`. ✅ "A chave de acesso precisa ter 44 caracteres." No entry, and **no
    network request**.
21. Submit `K_BADCDV`. ✅ Red toast, "A chave informada não é
    válida…", no row in the list.
22a. Submit `K_MES13`. ✅ The same red toast — the code differs internally
    (`MES_INVALIDO`), the wording deliberately does not: the volunteer's next
    action is identical, and explaining our reasoning would be jargon.
22b. Submit `K_FUTURA`. ✅ Same red toast. A note dated next month cannot exist.
22c. Submit `K_EMITENTE`. ✅ Same red toast. The key's own check digit is fine;
    the CNPJ *inside* it is not.
22d. Submit `K_SP`. ✅ **Grey row**, not a toast — "Esta nota é de outro estado
    (SP). O Nota Paraná só aceita notas do Paraná." Warning ping if "Sons de
    alerta" is on. This note is real; only its usefulness is in question.
22e. Submit `K_CTE`. ✅ Grey row, "Esta chave é de um CT-e (conhecimento de
    transporte). Só NF-e e NFC-e podem ser doadas." No request. Then
    **type** `K_NFE` — slowly, and **without** Enter. ✅ The status line stays
    empty the whole way: an NF-e is accepted like `K_OK`. Pressing Enter would
    *send* it, so do that only with `simularEnvio` armed, where ✅ it comes back
    green like any other note.
22f. Submit `K_VELHA`. ✅ Grey row naming both months, e.g. "Nota de abril de 2026
    — o prazo para doá-la foi até junho de 2026."
22g. Rescan `K_VELHA`. ✅ Grey row again, now reading "Esta nota já passou por
    aqui." followed by the same reason — **not** "já foi registrada nesta
    sessão", which would be a lie about a note that was never registered.
22h. Rescan `K_BADCDV`. ✅ Just the toast again, every time: a red key is
    deliberately never remembered, so rescanning it is a real retry.
22i. **Type** `K_CPF`, without Enter. ✅ No red at any digit, and nothing at
    all: it is an NF-e with a padded CPF issuer, accepted like `K_NFE`. A **red**
    toast here means a CPF issuer is being read as a typo somewhere, and while a
    fixed part is armed that would send a fabricated key instead.
22j. **Type** `K_AVULSA` and `K_990`, without Enter. ✅ The status line stays
    empty for both: no série carries a verdict. Send them only with
    `simularEnvio` armed; ✅ green.
22k. *(Retired: `K_AVULSA` was a red toast until 2026-09-23. See 22j.)*
22l. Submit `K_UF99`. ✅ Red toast, not the grey "outro estado" row — cUF `99`
    is not a state, so nothing real was read.
22m. **Type `K_ALFA`** — the letters are `ABC` at positions 9–11 and `DE` at
    18–19, and on a keyboard they are just letters. ✅ They appear in the cells
    as they are typed, the same width as a digit, and the status line stays
    empty the whole way. Press Enter with `simularEnvio` armed. ✅ It goes out
    like any other note.
22n. Type `k_alfa` **in lower case**. ✅ The cells show upper case: a key is
    written that way, and dropping a character because Caps Lock was off is how
    the site's own field loses one out of the middle of a key.
22o. Type the first two digits of `K_OK`, then `A`. ✅ The `A` **appears in the
    third cell**, and the status line says "Confira a chave de acesso." — a
    letter outside the issuer's CNPJ is refused at that character, whichever
    span it lands in. The keystroke is never swallowed: where a letter may stand is a
    verdict, not a filter, and an entry that eats letters in silence is what
    this looked like when it was the other way round.
22p. Submit `K_LETRAFORA`. ✅ Red toast. The check digit is correct for those 44
    characters — the letter is refused because of **where** it stands, not
    because the arithmetic failed.
22r. **Rattle off five letters quickly** (hold one down, or type `ABCDE` as fast
    as you can) after a few digits. ✅ They all land and the digits before them
    are still there. Four fast gaps is the scanner threshold, and a burst
    DISCARDS whatever was typed before it — so before letters were made
    transparent to that heuristic, this emptied the entry of correct digits.
    Then scan a note. ✅ Still recognised as a scan: a run of digits is what
    confirms a burst, and it always was.
22s. Type eight characters, then **scan a note without clearing them**. ✅ One
    row, with the scanned key alone, and the entry shows that key and nothing
    else. Indices 6–17 are exactly where the caret was sitting, which is how a
    positional rule let `HTTPS` into the gap with the key welded on behind it.
    A confirmed burst is read out of the raw buffer now, so where the caret was
    cannot matter.
22t. **Scan a QR code into an empty entry and watch the cells, not the row.** ✅
    They stay empty until the key itself starts arriving. The url a QR code
    carries is a row of words — `https`, `www`, `fazenda`, `pr`, `gov`, `br`,
    `nfce`, `qrcode` — and each of them used to become the entry for a few
    milliseconds on the way past. Nothing that cannot BEGIN a key is painted,
    which is a stronger statement than "nothing before the 41": ✅ scan a note
    from another state (`K_SP` as a barcode) and its `35…` fills the cells
    normally, because the grey "esta nota é de outro estado" row still has to
    be reachable.
23. Auto-send OFF, type all 44 digits of `K_BADCDV` without Enter. ✅ Entry box
    gets a red outline before you press anything else. Backspace once. ✅ Clears.
    Type the right last digit. ✅ No outline. Now press Enter on a bad one. ✅ The
    usual red toast, and the entry is emptied — the hint changes nothing about
    what a refusal does.
24. Let a toast sit ~4 s. ✅ Disappears on its own. Trigger another and type a
    digit. ✅ Old one dismissed.
25. Turn on "Enviar automaticamente ao completar a chave", **type** all 44 of `K_OK`. ✅
    Submits the instant the 44th lands. Now **scan** `K_OK`. ✅ One submission,
    at the end of the reading rather than at its 44th digit — see step 19c for
    why that distinction is the whole point.

22q. Scan a QR code (or paste `QR_URL` with `K_ALFA` in place of `K_OK`). ✅ One
    submission, the right key. The URL's own letters — `https`, `fazenda`,
    `qrcode` — all arrive while the buffer is short of index 6 and are refused
    exactly as before; only the key's own land in the entry. This is the step
    worth doing after any change to `capture.js`: the old code kept them out by
    asking "is it a digit?", and that answer stopped being free.

**The live verdict while typing.** Every verdict above also arrives *as you
type*, at the first digit that makes it answerable, on the status line under the
strip. Nothing is blocked: typing all 44 and pressing Enter still produces
exactly the toast or the row this section already describes.

25a. Type `99`. ✅ "Confira a chave de acesso." in red, after the second digit.
    It names no check — which red code fired is a fact about our net, never
    about the note. Not "os números": a key may carry letters now, and the red
    is often for one.
25b. Erase (Esc) and type `35`. ✅ Amber, and the verdict's own sentence: "Nota
    de São Paulo — o Nota Paraná… Esta nota não pode ser doada." This is half the
    value: an out-of-state receipt is knowable at digit 2 instead of after 44.
25c. Type the first 6 digits of `K_FUTURA`, then of `K_VELHA`. ✅ Red, then
    amber, at digit 6.
25c′. Type `41` and a year two years back (in 2026, `4124`). ✅ Amber at digit
    4, and it names the YEAR: "Nota de 2024 — o prazo para doá-la já passou."
    No month appears — none has been typed. It used to say "dezembro".
25c″. Type `41A`, then `41260A`, then the first 20 digits of `K_OK` and `6A`,
    then the first 23 of `K_OK` and `A`, one key at a time. ✅ Red "Confira a
    chave de acesso." on each, **at the letter** (3, 6, 22 and 24). A letter in
    the year or month used to pass silently, one in the model came back amber
    — "não pode ser doada", about a typo — and one in the série said nothing
    until Enter.
25d. Type the first 19 digits of `K_OK` and one wrong digit. ✅ Red at digit 20 —
    the issuer's own check digits.
25e. Type the first 20 digits of `K_OK` then `57`. ✅ Amber at digit 22. Erase
    and type the first 20 then `55`. ✅ Nothing — an NF-e is accepted.
25f. Type the first 35 digits of `K_AVULSA`, then of `K_990`. ✅ Nothing: no
    série carries a verdict, so nothing speaks after digit 22.
25g. **Type all 44 digits of `K_OK`, slowly.** ✅ The line stays empty the whole
    way. There are no false positives by construction: a rule is only asked once
    every span it reads is complete.
25h. **Scan `K_SP`.** ✅ The line says nothing during the reading; the grey row
    arrives at the end as always. A scan fills 44 cells in ~50 ms and flashing
    four verdicts past is noise.
25i. Any of the above with a fixed part that fixes the offending span. ✅ Silence
    — the fixed part was judged when it was applied.
25j. Listen. ✅ Nothing, ever. It adds no fifth cue and borrows none of the four.

### 3a. Sending everything anyway

Turn **Preferências → "Enviar sem verificação prévia"** ON for this section, and
back off at the end. Here the point is the opposite — these steps DO hand the
note to the send pipeline — so arm `simularEnvio` in
[debug mode](#modo-de-depuração) first: the fixture keys must not reach the
live site, and the simulation shows the hand-off as well as a request would.

22m. Submit `K_BADCDV`. ✅ **No red toast.** A row appears, blue, marked
    *"⚠ enviada sem verificação — A chave informada não é válida…"*,
    and the note is sent (simulated). The warning ping sounds, **not** the
    error buzz — the note has not been refused by anyone yet. The answer decides
    the final colour; to see a refusal arrive with `[nfprweb]` in front of it,
    set `respostaForcada` to a rejection sentence and submit it again.
22n. Submit `K_SP` (grey by our own table). ✅ Same shape — a marked blue row and
    a send, rather than the grey row of step 22d.
22o. Submit `K_OK`. ✅ An ordinary row with **no marker at all** — the preference
    is on, but this key passed on its own merits, and marking it would make
    every note look forced.
22o'. Immediately rescan `K_OK` again. ✅ **Not** the amber `duplicado` row of
    step 47: another blue row and another send, with *"⚠ repetida — Esta nota
    já foi lida recentemente."* beside the key and the warning ping. The
    check still runs — it is the only thing that can tell you you are holding
    two copies of one receipt — it has just stopped refusing. The row must
    **not** also say "enviada sem verificação": this key passed every check.
22p. Type six digits and press Enter. ✅ Sent as six digits. Then press Enter and
    Tab on an **empty** entry. ✅ Nothing happens, ever — the one exception, and
    the reason is that a scanner emits Enter at the end of a failed read.
22q. **The one that decides whether the feature works at all.** Set
    `forcarConexao` to `'offline'`, submit `K_BADCDV`, and confirm it is parked
    amber and present in `nfpr:fila` in devtools storage — with a `semValidacao`
    field on that entry. Now **turn the preference OFF**, clear `forcarConexao`,
    set `respostaForcada` to `{"mensagem":"Documento fiscal doado com
    sucesso!"}` and reload. ✅ The note is still sent, still marked on its row. If it instead vanishes with a red row, the
    drain-time re-judge is reading the live preference rather than the note's
    own frozen field, and every note of an offline batch dies the same way.
22r. With the preference still off, scan `K_BADCDV` again. ✅ Red toast, no row,
    no request — exactly step 21. The preference governs the next scan, never
    work already accepted.

### 4. Fixed parts

Everything here happens on **the strip**, the line immediately under the 44
cells. Nothing about fixed parts is in Configurações any more, and the toolbar
popup has none at all.

25a. **The feature is on out of the box.** On a fresh install, look under the
    44 cells. ✅ The strip is there, reading "+ Fixar o começo da chave". Type
    `K_OK2` by hand and press Enter. ✅ No offer under the cells — the feature is
    already on, so there is nothing to offer. Now turn *Preferências → Parte
    fixa da chave* OFF. ✅ The strip goes. Type another note by hand. ✅ Still no
    offer: working the switch answered it. Scan `K_OK` with the scanner. ✅ It
    registers as always, and *nothing* is said about fixed parts — a scan never
    raises the offer.
25b. **The typist is told, once.** With the preference still OFF, set
    `dicaPartesFixasEm` to `null` in devtools storage, reload, type `K_OK2` by
    hand and press Enter. ✅ Under
    the cells: "As chaves das suas notas começam iguais? Você pode fixar esse começo e digitar
    apenas o restante de cada uma.", with **Ativar** and **Não mostrar**. ✅ No
    sound, no bar, no toast. Click **Não mostrar**, then reload and type another
    note by hand. ✅ It does not come back. Now set `dicaPartesFixasEm` to `1` in
    devtools storage (an answer given in 1970, so long expired), reload and type
    by hand again. ✅ It is offered again — an answer ages out, because the next
    volunteer at a shared machine never gave it. Click **Ativar** this time. ✅
    The strip appears reading "+ Fixar o começo da chave", the offer is gone,
    and **no editor opened by itself**.
25b-bis. **Ativar arms no fixed part.** Before doing that, make sure a fixed
    part is stored and was the last one active (arm one, then turn *Parte fixa
    da chave* OFF in Preferências — the id survives). Clear `dicaPartesFixasEm`,
    type by hand, and click **Ativar**. ✅ The strip reads "+ Fixar o começo da
    chave", **not** the stored fixed part's name, and the 44 cells are empty. ✅
    The fixed part is still in the list on the strip — nothing was deleted.
25c. **Off is inert, not merely hidden.** With a fixed part armed and working,
    turn *Preferências → Parte fixa da chave* OFF. ✅ The strip goes; the cells
    go back to 44 empty ones; typing the fixed part's few digits is now refused
    for length, not composed into a key. Turn it back ON. ✅ The same fixed part
    is armed again — nothing was deleted. Leave it ON for the rest of this
    section.

26. Click the strip's label with no fixed part active. ✅ It becomes a field led
    by **Nova parte fixa**, with **Aplicar** / **Cancelar**, and the help line
    reads "Insira a parte que se repete nas chaves." Type `41ab01..9?`.
    ✅ Shows only `41019?` — letters and punctuation are dropped as you type.
26a. **The 44 cells are the preview.** Keep typing the first 22 digits of
    `K_OK`. ✅ Those cells fill in with the fixed part's grey fixed digits as you
    go, in the same display you type a note into, and the help line reads
    "22 números fixos · você vai digitar 22 por nota."
26b. Press Esc, or click Cancelar. ✅ The strip goes back to its label and the
    cells go back to what the ACTIVE fixed part leaves them — the preview was a
    look at a fixed part that was never applied.
27. Open the editor with something half-typed in the key entry. ✅ The entry is
    emptied. It has to be: the cells become the preview, so a half-typed key
    would sit in the buffer with nothing on screen saying so, and Enter
    afterwards would submit digits nobody can see.
28. Type 44 digits with no `?` and press Enter. ✅ "Essa parte fixa não deixa
    nada para você digitar. Apague alguns números do fim." **The text stays in
    the field** — that is the deliberate asymmetry with a refused key, which
    clears. A key is a reading of a paper and the recovery is a fresh
    independent one; a fixed part is text you wrote, and there is no second
    source to re-read.
28a. Clear the field, press the space bar once (it writes `?`) and press Enter.
    ✅ "A parte fixa precisa ter ao menos um número. Insira a parte que
    se repete nas chaves." — refused, text kept. A fixed part of nothing but `?` fixes
    nothing, and it used to be saved: the strip then showed its invitation as if
    no fixed part were armed, with no **Digitar a chave inteira**, while every
    good scan was flagged as having ignored a fixed part.
29. Type the first 30 digits of `K_OK` and press Enter. ✅ Applied instantly. The
    strip reads "…<last four groups> — só 14 números por nota" — an unnamed
    fixed part shows its own digits, truncated from the FRONT, because every key
    starts `41` and the tail is what tells two fixed parts apart. 30 fixed cells
    are pre-filled.
29a. **A fixed part can be nothing but its prefix.** Nowhere in any of this did
    you need to type a `?`. It exists only for "and maybe some numbers further
    along", and Ajuda is the only place it is mentioned.
30. Type the 14 variable digits + Enter. ✅ `K_OK` is submitted — confirm in the
    Network tab that the POST's `chaveAcesso` equals `K_OK` exactly. The strip's
    right-hand counter read `1 de 14` … `14 de 14` on the way.
31. **With the fixed part still active, scan or paste a different full 44-digit
    valid key.** ✅ The scanned key is submitted verbatim, NOT a fixed part
    composition — **and the override is announced three ways**: the warning ping
    (if the alert sound is on), an amber "⚠ parte fixa não usada — chave lida
    inteira" on that row, which stays there, and an amber BAR: "A chave foi
    escaneada por inteiro, por isso a parte fixa "…" não foi aplicada — ela vale
    apenas para chaves digitadas." *(This is the check that catches the worst bug this
    codebase has had: the capture buffer used to stop at the fixed part's
    variable-digit count, so a perfectly scanned receipt was silently rebuilt
    from the fixed part plus its first few digits. `tools/smoke.js` now pins it
    too.)*
31a. Scan a second and a third full key. ✅ Still one bar, not three — it is a
    condition, not a per-note alarm, and a warning that fires on every success
    is one people learn to ignore.
31b. Now type the variable digits of a note normally. ✅ No marker, no ping, and
    **the bar goes**: the fixed part is being used for what it is for, so it has
    nothing left to say. Click "Digitar a chave inteira" on it instead and it
    goes the other way.
32. Open the strip's ▾ and pick "Chave inteira — 44 números". ✅ Registrar
    reverts to 44-digit entry, no reload.
32a. **The one-click way out.** Arm a fixed part, then click **Digitar a chave
    inteira** on the strip itself. ✅ Same result in one click, and whatever was
    half-typed in the cells goes with it. The fixed part is still in the ▾ list
    — this deactivates, it does not delete.
32b. Now look at the strip with nothing armed. ✅ It reads "+ Fixar o começo da
    chave" in the accent colour, and there is no "Digitar a chave inteira"
    button: with no fixed part there is nothing to escape from. Click the label.
    ✅ The editor opens, exactly as clicking a fixed part's name does.

**Fixed parts that can only make dead notes are refused when applied.** A fixed
part cannot guarantee a *valid* note — the variable digits still have to produce
a good check digit — but it must not guarantee an invalid one, and both red and
grey verdicts block. The help line warns while you type; Aplicar is what
refuses.

33a. Type `35` then some `?` into the fixed part field. ✅ The help line turns
    red *while typing*, not on the click: "Esta parte fixa é de notas de São
    Paulo…". Aplicar does nothing and the text stays.
33b. First 22 digits of `K_CTE` + `?`s. ✅ "Esta parte fixa não é de NF-e nem de
    NFC-e…" The first 22 of `K_NFE` is accepted. Now the first 25 digits of
    `K_AVULSA` + `?`s. ✅ No warning, and
    Aplicar applies it: that fixed part describes real, donatable notes.
33c. `4126` + `13` + `?`s. ✅ "O mês desta parte fixa não existe…"
33d. First 20 digits of `K_EMITENTE` + `?`s. ✅ "O CNPJ de quem emitiu a nota
    não confere nesta parte fixa…"
33e. First 6 digits of `K_VELHA` + `?`s. ✅ "As notas desta parte fixa já
    passaram do prazo para doar."
33f. First 6 digits of `K_FUTURA` + `?`s. ✅ "Esta parte fixa é de notas com
    data no futuro…" *(and note this is temporary by design: the same fixed part
    becomes legitimate when that month arrives — you cannot pre-configure
    December's fixed part in August.)*
33g. `41` + 42 `?`s. ✅ Accepted. Nothing about it is decidable yet, which is the
    point of the null-guard: a fixed part is only judged on the spans it fixes.
33h. Type `FIXA_ALFA` — the first 30 characters of `K_ALFA`, letters and all,
    in **lower case**. ✅ The field upper-cases them as you type, the help line
    stays neutral, and Aplicar applies it. A fixed part fixing the issuer's CNPJ
    is the ordinary case now: that is exactly the span fixed parts exist to fix,
    and it is the span that may hold letters. Then type the remaining 14 digits
    of `K_ALFA` into the cells. ✅ Green (or a simulated green), same as `K_OK`
    under `FIXA30`.
33i. `41` + 20 `?`s + `A1B` + `?`s — a letter in the **série**. ✅ "Esta
    parte fixa tem uma letra em posição inválida…", and Aplicar refuses. This
    one is worth doing after any change to `chave.js` or `registrador.js`:
    `FORMATO` is key-only, so `LETRA_FORA_DO_LUGAR` is the only thing that sees
    it, and without it the fixed part is accepted and every note entered under
    it dies — silently, because no entry reads the série at all.
33h. `4126` + `??` + `?`s (year fixed, month free). ✅ Accepted while `2026` is
    within range — a fixed part with a variable `AAMM` never expires, and that
    is the escape hatch.

**The list, and its two tiers.**

34a. Open the ▾ — it is labelled **Escolher parte fixa**. ✅ "Parte fixa da chave",
    "Chave inteira — 44 números" pinned at the top, then the fixed parts, **most
    recently used first whatever their tier**. Every row shows its digits, "N
    por nota", **Salvar** (or **Renomear**, if it already has a name) and
    Remover — **always visible, never on hover**. There is no star. An unnamed
    row shows its digits **once**, in the name slot, not twice.
34a-0. Narrow the window with nothing armed (`tools/preview.html` → 360).
    ✅ The ▾ reads **Escolher** and "+ Fixar o começo da chave" is whole;
    narrower still it is the ▾ alone, and hovering it says "Escolher parte
    fixa". The invitation never loses a word while the button still has one.
34a-i. With no fixed parts at all. ✅ The explanation paragraph is there, and
    "Nenhuma parte fixa cadastrada." With fixed parts in the list the paragraph is
    gone: it answers a question the list itself has already answered, from
    inside a frame that never scrolls.
34a-ii. Make more than eight fixed parts. ✅ A search box appears above the list,
    its placeholder naming the count ("Procurar entre 12 partes fixas"). Type
    part of a name **without its accents** — `acou` finds "Açougue". Type
    digits, with or without spaces — both find the fixed part. Type something
    that matches nothing ✅ "Nenhuma parte fixa com …", with "Chave inteira"
    still there and "+ Nova parte fixa" still in the footer.
34a-iii. **The search must not steal the scanner.** With the list open and the
    box NOT clicked, scan a note. ✅ It registers normally. Now click into the
    box, type a few letters and press **Backspace**. ✅ The letters delete — if
    they do not, the key capture is eating them and the field is unusable.
    Press **Esc** ✅ the search clears; press it again ✅ the list closes.
34a-iv. Scroll a long list. ✅ "Chave inteira" stays pinned at the top with the
    rows passing cleanly *under* it — no stray Renomear/Remover buttons
    straddling it — and the footer's two controls never scroll away.
34b. Click a row's radio. ✅ It becomes active immediately, the strip's label
    changes and the cells repaint. The popover stays open.
34c. Click Salvar on an unnamed fixed part. ✅ The name becomes a field in place,
    with the fixed part's own digits as its placeholder. Type a name and press
    Enter. ✅ Named — and by that fact saved: it is exempt from the cap from now
    on and its button reads Renomear. It does **not** jump up the list: naming
    does not reorder anything.
34d. Click Renomear, clear the field and press Enter. ✅ Blank again, showing its
    digits, and back in the recent tier (so it can be evicted again). A blank name is a real state, not a
    missing value, nothing is ever defaulted to "Parte fixa", and this is the
    only way out of the saved tier.
34e. Click the strip's label with a fixed part active. ✅ The same text is back
    in the field, editable in place, **led by "Editando “<the fixed part's
    name>”"** — the one thing that says this gesture rewrites an existing fixed
    part rather than making another. (Unnamed, it names the fixed part by its
    last digit groups.) Change two digits and Aplicar. ✅ The fixed part is
    updated **in place** — same row, same name — and the previous text is sitting
    unnamed **directly below it**: both were just used, and the edited one was
    touched a moment later. That is the undo, and it is why
    editing needs no confirmation.
34f. Name one fixed part, then create eleven more without naming any. ✅ The
    named one is still there; the oldest unnamed ones have fallen off. The fixed
    part in use is never evicted whatever its age.
34g. Click "Limpar as não salvas". ✅ Every unnamed fixed part goes; every named
    one stays; if the active fixed part was unnamed the strip goes back to its
    invitation. This is the one-click answer to a shared machine full of other
    people's fixed parts.
34h. Click "+ Nova parte fixa" with a fixed part already active. ✅ An empty
    field led by **Nova parte fixa** — not by the armed fixed part's name — and
    applying makes a SECOND fixed part rather than overwriting the first. Open
    it again and press Enter on the EMPTY field. ✅ The editor closes and the
    armed fixed part is still armed — an empty new fixed part is nothing, not
    "chave inteira".
34h'. **Without the mouse.** Tab to **Escolher parte fixa ▾**, press Enter, Tab into
    the list, choose with the arrow keys, then press Esc. ✅ The list closes and
    the keyboard is back on **Escolher parte fixa ▾**. Open it again, Tab to a
    **Renomear**, press Enter, then Esc. ✅ Only the rename is cancelled; the list stays open.
34i. Click anywhere inside the popover — a row's Salvar, Renomear or Remover.
    ✅ The list stays open and the action happens. (It lives in a *closed*
    shadow root, where `composedPath()` is trimmed at the host for a listener
    on the document, so the outside-click check has to run from inside the tree
    as well; when it did not, Renomear silently did nothing.)
34j. Click anywhere outside the popover. ✅ It closes.

**Stale fixed parts.** Most fixed parts fix the issuer prefix, which spans
digits 0–21 and therefore includes `AAMM`, so this is routine rather than an
edge case.

35a. Apply a fixed part fixed to a month still in range, then move the machine
    clock forward past its deadline (or build one from `K_VELHA`'s first 30
    digits directly, which the guard refuses — so use the clock). ✅ In the list,
    that row's "· vale até MM/YYYY" clause is **replaced** by an amber line:
    "Fora do prazo — as notas desta parte fixa não podem mais ser doadas. É
    sugerido removê-la." One time-line at a time, and since starred fixed parts
    are never evicted and "Limpar as não salvas" skips them, this marking is the
    only thing that ever prompts a stale saved fixed part off the list.
35b. Every fixed part that fixes both year and month shows "· vale até MM/YYYY".
    ✅ A fixed part fixed to `11/25` reads `vale até 01/2026` and one fixed to
    `12/25` reads `vale até 02/2026` — the year wraps.
35c. With that stale fixed part **active**, look at the registrar. ✅ An amber
    bar: "Esta parte fixa é de notas que já passaram do prazo… O leitor de
    código de barras continua funcionando normalmente.", with **Editar a parte
    fixa** as the primary action and "Digitar a chave inteira" beside it.
35d. Click **Editar a parte fixa**. ✅ The strip opens on that fixed part's own
    text, two digits from being usable again. That is the whole answer to a
    stale fixed part, and until the editor existed the only thing on offer was
    throwing it away.
35e. **The bar must not block anything.** Scan a full valid `K_OK` with the
    stale fixed part still active. ✅ It registers normally — a whole key beats
    the fixed part, so only *typed* entry under it is dead. Then click "Digitar
    a chave inteira". ✅ The fixed part deactivates, the bar disappears, and the
    registrar is back to 44-digit entry without opening settings.

**A red verdict on a TYPED entry under a fixed part names the fixed part.**

36a. With a fixed part active, type the variable digits with one wrong. ✅ The
    toast says "A chave informada não é válida. Se os números digitados
    estiverem corretos, a parte fixa "…" talvez não corresponda a esta nota.", and carries one button,
    **Digitar a chave inteira**. Now **scan** `K_BADCDV` with the same fixed part
    active. ✅ The plain red toast, **no fixed-part sentence and no button**: a
    scan was judged as it arrived, so the fixed part cannot be the cause. Scan a
    short store barcode too. ✅ Red, nothing queued, no fixed-part sentence.
36b. Click it. ✅ The fixed part deactivates and the entry is empty. The button
    is a second *cause*, never a repair: the digits are gone, deliberately, and
    no span is ever highlighted. Retyping from the paper is an independent
    second reading, and that independence is the whole value.

### 5. Entities

33. Type `CNPJ_OK` digit by digit. ✅ Progressive fixed part
    `11.444.777/0001-61`; mid-typing "O CNPJ tem 14
    caracteres." in muted grey, with the field's border neutral (no red, no ✕);
    then "CNPJ válido."
34. Type `CNPJ_BAD` fully. ✅ "CNPJ inválido. Confira o número digitado." in red,
    red border and ✕.
34a. Type `CNPJ_ALFA` in lower case. ✅ The field upper-cases as you type and
    fixed parts it `12.ABC.345/01DE-35` — twelve alphanumeric, two numeric, the
    same shape the site's own field uses (`AA.AAA.AAA/AAAA-00`). ✅ "CNPJ
    válido." An entity registered from 07/2026 on can have one of these, and the
    lookup that follows is the site's own endpoint, so it will answer for it or
    not on its own terms.
35. Logged in, add `CNPJ_OK`. ✅ After the ~450 ms debounce: "✓ <official name>"
    (+ municipality); there is no name field; saved verified, and the list and
    the chip show the official name. ✅ The status line under the field is
    gone after the add — not left showing the "✓" line, and not an empty gap.
36. Add the same CNPJ again. ✅ "Esta entidade já está cadastrada." No duplicate.
36a. **Enter twice while it verifies.** Type a new valid CNPJ and press Enter
    twice quickly. ✅ One entity is added, the button comes back reading
    "Adicionar entidade", and nothing says it is a duplicate — before, the
    second Enter left the button stuck on "Verificando…" and ended a
    successful add with "Esta entidade já está cadastrada." in red.
37. Add a second valid, registered entity. ✅ It becomes active immediately —
    every entity just added does, not only the first — and the chip names it
    straight away. Select the first one again. ✅ Chip updates immediately.
38. Remove the active entity while a second exists. ✅ The remaining one becomes
    active, everywhere open.
39. Add a checksum-valid CNPJ with the registry unreachable. ✅ Saves anyway,
    unverified, and the status line under the field disappears as it does after
    every add. The list row and the chip show the CNPJ alone — no blank line,
    no "Entidade …" stand-in — and the chip's hover title reads
    "Configurações — doando para <CNPJ>". Load the donation page logged in. ✅
    The official name appears in the chip and the list without touching
    anything, and the entity is verified from then on (no further lookups).
40. Add a checksum-valid CNPJ that the registry says is **not** an entity. ✅
    Refused: "Este CNPJ não está cadastrado como entidade no Nota Paraná, por
    isso não foi adicionado." Nothing saved.
40a. **Choosing without the mouse.** With two entities saved, open the modal
    and press Tab until the list is reached. ✅ The ACTIVE entity's row gets a
    blue focus ring (the radio itself is invisible by design — before, Tab
    landed on it with nothing on screen moving, which read as "only Remover can
    be reached"). Press the arrow keys. ✅ Each press makes that entity active,
    the chip follows, and the ring stays on the row just chosen — the list
    rebuilds on every change and used to drop the keyboard on nothing. Tab to a
    **Remover** and press Enter. ✅ The ring moves to the active entity's row,
    never onto the next row's Remover. Same in the toolbar popup.

### 6. Entity capture from the site's own dialog

41. Settings → "Buscar entidade no site". ✅ Our modal closes, the site's dialog
    becomes visible, and **the keyboard is in its first field** (*Área de
    atuação*): type or arrow there and it is their form that answers, not our
    key entry. Before, our modal handed focus back to the registrar a moment
    after their dialog appeared, so keys pressed in what looked like their form
    went into our buffer.
42. Search a charity, click a result row. ✅ A floating toast above the dialog:
    "✓ <name> adicionada ao assistente."; the site's own row-click behaviour still
    happens; the entity is in our list.
43. Click a row already saved. ✅ "Esta entidade já está cadastrada (<CNPJ>)." No duplicate.
44. Click a row whose CNPJ is not a registered entity. ✅ Refused with the same
    wording as step 40 — **the two paths must agree.**
45. On a page where `#conteudoPesquisaAvancada` is absent (rename it in DevTools),
    click "Buscar entidade no site". ✅ "Entre novamente no Nota Paraná para
    buscar entidades no site."; modal still closes. The sentence names no
    diagnosis on purpose: this branch is also what the duplicate-session screen
    reaches, where the login has not expired at all.
45a. Log out in a second tab, then click "Buscar entidade no site". ✅ The dialog
    does **not** open and the same sentence appears — `Sessao.conferir()` asked
    before opening. Network tab shows one GET of
    `DoacaoDocumentoFiscalCadastrar`. ✅ **And the session bar appears**: "Sua
    sessão no Nota Paraná expirou. As notas continuam guardadas." with
    **Entrar novamente**, plus one error sound. Queue anything first and it goes
    amber and stays in `nfpr:fila` — the pool is paused, not emptied.
45b. Open the dialog on a live session, log out in a second tab, then press the
    dialog's own "Pesquisar". ✅ Our watcher sees blockUI's overlay appear,
    probes, and hides the dialog with the same sentence — instead of the site's
    permanent white overlay, and the session bar appears behind it. Without the
    extension, that click locks the dialog until reload; confirm that first if
    you want to see what is being avoided.
45c. Same as 45b with the network off (DevTools → Offline) instead of logged
    out. ✅ The dialog stays open and nothing is said: `INDEFINIDA` never acts.

### 7. Submission pipeline and outcomes

46. Submit a **real note**. ✅ Network tab shows GET
    `DoacaoDocumentoFiscalCadastrar` then POST `app/v1/documentoFiscalDoadoWeb`,
    in that order, with the fields listed above. Entry ends green; the success
    sound plays only if "Som ao registrar a doação" is on.
47. Immediately rescan the same key. ✅ An amber `duplicado` entry — "Esta
    nota já foi lida recentemente." — with the warning ping, and **no
    request** in the Network tab.
48. Reload, rescan the same key. ✅ NOT blocked — a fresh GET+POST fires. The
    in-tab record is deliberately not persisted.
49. Set `respostaForcada` to a sentence the code does not recognise, with a
    `<b>` in it, and submit `K_OK`. ✅ Five attempts (see 52a), then red with
    that text rendered as plain text (no HTML interpreted). A rejection sentence this code does not recognise is
    not treated as a verdict on the note — only the six terminal answers in
    52c end on the first try.
50. Rescan that rejected key, with `respostaForcada` still set. ✅ A brand-new
    attempt starts — a failed key is always retryable. Clear `respostaForcada`.
51. Scan 3 real notes in rapid succession. ✅ Three entries, in the order they
    were scanned, all going out at once — six requests total, each POST preceded
    by **its own** GET for a fresh token. Never a shared or reused token.
51b. Same three notes. ✅ Three rows, no queue bar at all:
    with room in the pool nothing is ever left waiting, and the bar must not
    announce work the rows are already showing.
51a. Scan more than six real notes in rapid succession. ✅ At most `LARGURA_ENVIO` (6) are
    "Enviando…" at any moment; the rest wait and start as slots free up, always
    in scan order. In the Network tab the GET/POST pairs overlap but never
    exceed six in flight.
52. Log out in another tab, then submit. ✅ "Sua sessão no Nota Paraná expirou."
    with a working "Entrar novamente" link; the key stays counted in the badge.
52a. Provoke "não foi possível concluir a ação solicitada" by setting
    `respostaForcada` to that body (see 55a) and submitting `K_OK`. ✅ The row reads "O site não concluiu o
    registro e não informou o motivo.", then "Reenviando (2 de
    5)…", (3 de 5), (4 de 5), (5 de 5) — five attempts, spaced roughly
    1.2 s / 4 s / 10 s / 20 s, **not** in a burst (a forced answer makes no
    POST, so read the spacing off the row). Scan another key while it waits:
    ✅ that one starts immediately, ahead of the retry — the
    delay must never hold up the queue. After the fifth failure: ✅ one error
    sound (not five), the row turns red with the site's own words, and the badge
    drops — the note is out of the queue. Rescanning it starts a fresh attempt.
52b. Reload during the waiting period. ✅ The note is still queued and resumes,
    its counter starting over from "Enviando…". This is intended; the counter is
    deliberately not persisted.
52c. The six terminal answers must NOT retry — one attempt each, decided on
    the first try (force each with `respostaForcada`): a success, a note past `prazo para doar`, a key whose document
    type the site rejects (`tipo de documento inválido`), a key whose issuer is
    outside Paraná (`não está localizado no Estado do Paraná`), a key that fails
    the site's own validation (`chave de acesso inválida`), and a donation to an
    entity the site does not have registered to receive. ✅ The first three land
    grey (`inelegivel`), the last three red. ✅ Anything else,
    including an outcome nobody here has seen before, takes the full five.
52d. The out-of-state refusal must also stay OFF the failures list. Set
    `respostaForcada` to `Esta nota não pode ser doada. Motivo: Estabelecimento
    emitente não está localizado no Estado do Paraná.` and submit `K_OK`. ✅
    **One** attempt, not five; a grey row with that sentence;
    the badge drops; and no "N notas não foram registradas" bar appears. The
    answer explains itself completely, so there is nothing unexplained to file.

### 7b. A good note that vanishes must not vanish quietly

**The case this exists for.** Every client-side check passes, the health probe
proves the site is up, and the POST still answers the shrug — five times over.
The reaper then deletes the note, which is right in general (a healthy server
that cannot file a note means an impossible note) and is, in this instance,
destroying a receipt whose digits are perfect. Nobody will ever mention it
again, and the row saying so is one long batch away from scrolling off the end.

Three other outcomes land the same way — an unfamiliar rejection sentence, an
unfamiliar `mensagem`, an exception nobody classified — all given up on and
dropped once the retry budget runs out. A refusal the extension *can* account
for has already done its job on the row and does not go on this list.

Use `respostaForcada` in [modo de depuração](#modo-de-depuração) for all of it.

52j. **The motivating case, end to end.** `respostaForcada` =
    `{"erro": "A aplicação retornou que não foi possível concluir a ação
    solicitada."}` and scan a good key. ✅ One probe goes out (an extra GET+POST
    carrying the expired probe key), comes back healthy, so **no bar appears
    yet** and the note retries visibly. After the fifth attempt it turns red and
    leaves `nfpr:fila` — the reaper doing its job on a note whose digits are
    perfect. ✅ **Now** a red bar appears: "1 nota não foi registrada.", with a
    **Ver detalhes** button. It has no ✕ — it is a condition, not a notification.
    (Clearing it is possible, but only from *inside* the page it opens: see
    52q.)
    ✅ It says *não foi*, never *pode não ter sido*: only 200 OK with `sucesso`
    files a donation, so this one demonstrably was not filed. ✅ And it says
    **nothing about the paper** — no "separe", no "guarde", no "procure o
    papel". Reporting what registered is ours; the receipts are the charity's
    own process.
52ja. Same with `respostaForcada` = `{"chaveAcesso": "Alguma recusa que nunca
    vimos."}`. ✅ Same ending by the weaker route — five attempts, red, dropped,
    counted on the bar.
52k. **The gate is what we understood, not the colour.** Now set
    `respostaForcada` = `'Chave de acesso inválida.'` and scan another good key.
    ✅ It goes red immediately (terminal, no retries) — and **the bar still reads
    1.** That refusal is one we recognise, the row already names it, and the
    remedy is on the row. Same for `'Fora do prazo para doar.'` (grey) and for a
    locally-refused key (red toast, no row): neither touches the bar. If the
    count goes to 2, the list has gone back to logging every red row and the
    unexplained ones are being buried again.
52l. Scan more than `LIMITE_LINHAS` (20) good keys so the red row from 52j is
    evicted. ✅ That row is gone from the list; **the bar still reads 1.** The
    list is a scrollback and the bar is the record — if the bar drops to zero
    with it, the fix has been undone.
52m. Click **Ver detalhes**. ✅ The modal opens on an "Erros desconhecidos" page
    with a back arrow to Configurações, one card per note carrying the 44 digits
    spaced in fours and whatever the site did say. The page is named for what is
    actually missing: the answer was clear that the note was **not** registered
    and silent about why.
    ✅ The intro **opens** with "Estas notas não foram doadas" — the outcome
    first and unhedged — then "nenhum erro foi detectado", then that the site did
    not explain the reason, and finally that scanning a key again is a real
    retry. Every sentence is a report about a note or about this software. ✅
    None of it directs what to do with the printed receipts, and none of it puts
    the blame on the reading: every note here passed every check. Esc closes it.
    ✅ Nothing in the modal header offers that page — the bar is the only
    door.
52n. **The one that was silently lost twice over.** Seed ~1000 queued notes
    (§7a) and reload, so a note goes in flight and then has 20 newer scans land
    before it answers — scanning steadily during the drain does it. With
    `respostaForcada` = `{"erro": …}` (the shrug), let it run out. ✅ The bar
    counts it. Before this was built that note lost its row to eviction *and*
    its record with it: `atualizarItem` had nothing to update and returned, so a
    good note was deleted from the queue and no surface anywhere ever mentioned
    it.
52o. Scan one of the listed keys again with `respostaForcada` cleared. ✅ It
    registers normally (a rejected key is always unblocked), and **the bar drops
    by one** — the record is notes still unregistered, not notes that once
    failed. Have the same key rejected twice instead: ✅ still one entry,
    carrying the newer sentence. Clear the last one: ✅ the bar disappears.
52q. **Clearing the record, and the rule it must not break.** With entries on
    the bar, look at the bar itself: ✅ still no ✕ on it. Open **Ver detalhes** →
    ✅ a **Limpar a lista** button at the foot of the page, below the cards,
    so the digits are what you meet first. Click it: ✅ it does NOT clear —
    it asks, naming how many notes go and that they appear nowhere else, so
    there is no undo. Click **Cancelar**: ✅ back to the button, nothing cleared.
    Click it again and then **Apagar**: ✅ the record empties, the modal returns
    to Configurações (the bar was the page's only door), the bar is gone, and
    `nfpr:falhas` is empty in devtools storage. Reload: ✅ still gone.
    *(The two steps are not ceremony: these notes already left `nfpr:fila`, so
    this record is the only trace of them and a misclick is unrecoverable.)*
52oa. **It has to survive a reload — this is the whole reason it is durable.**
    With entries on the bar, reload the page. ✅ The bar is still there with the
    same count, and `nfpr:falhas` holds them in devtools storage. Then click
    **Entrar novamente** on a session bar, or navigate away and back: ✅ still
    there. An in-memory list died on exactly that, and it is an ordinary
    mid-batch action, not a corner case.
52ob. **Each entry says when the note was ENTERED, to the second.** ✅ Every card
    carries "Lida em dd/mm/aaaa hh:mm:ss". Queue a note from the offline page,
    wait a minute, then open the live page and let it be rejected: ✅ the time
    shown is when it was **scanned**, not when it was sent.
52oc. **It survives a settings wipe.** Click *Apagar configurações do usuário*:
    ✅ entities, fixed parts and preferences go; the bar and `nfpr:falhas` stay.
    The cap is 100 (`Config.LIMITE_FALHAS`), oldest off the front — `smoke.js`
    covers that, there is nothing to check by hand.
52p. **No success number, anywhere.** ✅ Nothing on any surface totals the
    registrations. `sucesso` means *filed*, never *credited*, so a total we
    showed could disagree with what the entity is actually credited — see
    [acceptance is provisional](#acceptance-is-provisional--the-real-adjudication-happens-monthly).

### 7a. A large restored queue

The scenario this section exists for: a volunteer scanned a thousand notes with
no internet yesterday, and opens the donation page today with a working one.
Seed it from the page console — `chrome.storage.local.set({'nfpr:fila': [...]})`
with a thousand `{chave, cnpj}` entries — then reload. The seeded keys are made
up, so set `respostaForcada` to `{"mensagem":"Documento fiscal doado com
sucesso!"}` first: the drain then answers itself and nothing is sent.

52d. Reload with ~1000 queued. ✅ A queue bar appears reading "1000 notas na
    fila" and starts depleting. The item list is **empty** — pending work is a
    quantity, not rows. Sending starts at once, six at a time, oldest first.
52e. Watch it drain. ✅ Rows appear six at a time as notes go in flight, then
    turn green in place; newest on top, never more than `LIMITE_LINHAS` of them.
    The bar shrinks. Notes still WAITING have no rows — only the bar counts them.
52f. With ~5 queued (the realistic case after a relogin), reload. ✅ The bar
    reads "5 notas na fila", drops as each one goes in flight, and disappears
    once all five are sending — the rows carry it from there.
52g. **Scan a key immediately after reloading with ~1000 queued.** ✅ Its row
    appears at the top of the list AT ONCE, before anything has settled. This is
    the regression to watch for: a scan's row is the volunteer's only
    confirmation the key was read, and it must never wait behind the backlog.
    It also **sends ahead** of the backlog: a scan is attended, the backlog is
    not. It turns green as soon as a slot frees, not after the other 999.
52h. Clear `respostaForcada`, log out in another tab, then reload with ~1000
    queued. ✅ **One** error sound, not a thousand. Nothing is sent: the first
    token fetches find the login gone. A **session bar**
    appears with "Entrar novamente"; the notes stay **amber** ("Guardada — será
    enviada quando você entrar novamente no Nota Paraná."), never red, and stay in the queue. Set
    `respostaForcada` again before logging back in, so the seeded keys are not
    sent.
52i. Set `forcarConexao` to `'offline'` mid-drain. ✅ Same shape — connection bar, notes stay in
    the queue indicator, nothing turns red, no per-note sound.

### 8. Connectivity outage

53. Disconnect the network, submit a real note. ✅ Entry parks as `aguardando`
    (amber) rather than a terminal red error; the connection bar appears
    ("Sem conexão com a internet…").
54. Reconnect **without reloading**. ✅ Within the backoff window (up to ~30 s)
    the bar turns green and the parked item resends by itself — confirm a new
    GET+POST with no volunteer action.
55. Badge count during the outage. ✅ Still reflects the durable queue length.

### 8a. A server that cannot judge donations

Uses `respostaForcada` in [modo de depuração](#modo-de-depuração) to produce the
shrug without waiting for a real bad hour. **The probe itself is a real
request**, so the site must be reachable for these.

55a. Set `respostaForcada` to `{"erro":"A aplicação retornou que não foi
    possível concluir a ação solicitada."}` and submit a valid key. ✅ The
    extension probes once (one extra GET+POST, carrying the long-expired probe
    key), the probe comes back healthy, and the note takes the ordinary retry
    path — five attempts, then a red row, then it leaves `nfpr:fila`. The
    reaper is intact.
55b. Queue several notes, then arrange for the probe to fail too — the simplest
    way is to point the extension at a host that answers nothing. ✅ The queue
    **parks amber**, one error sound, and an amber bar appears saying the site
    cannot register donations and how many notes are held. **No red rows, and
    `nfpr:fila` does not shrink** — check it in devtools storage.
55c. The bar has **no button**. ✅ Correct and deliberate: nothing on this
    machine can fix someone else's server.
55d. Restore the server. ✅ Within the backoff window (4 s → 30 s) the bar
    clears by itself and every parked note resends, oldest first, with no
    volunteer action.
55e. Scan a fresh note while the queue is parked. ✅ It parks amber immediately
    rather than sitting on "Enviando…" forever behind a stopped pool, **and the
    bar's count goes up by one on the same scan** — the bar is the only thing
    on screen saying how much is held, so a note it does not count is a note
    the volunteer has no way to see is safe.
55f. Set `respostaForcada` to `Esta nota não pode ser doada. Motivo:
    Procedimento inválido.` ✅ Probes once, exactly like the shrug. The probe
    comes back healthy (the site is fine — only the forced answer is not), so
    **no bar appears** and the note retries visibly, "Reenviando (2 de
    5)…", asking nothing of the volunteer. A freak token failure must never
    stop the queue.
55g. Leave 55f running to the end of the budget. ✅ The note parks amber saying
    it will be resent on reload, the queue indicator **drops to zero** rather
    than counting a note that is going nowhere, and the key is **still in
    `nfpr:fila`** — check devtools storage. A refused request must never cost a
    good note, and must never strand the counter either.
55h. **A retry timer that outlives the latch.** Set `respostaForcada` to a
    sentence the extension cannot read (anything not in the table above — e.g.
    `Esta nota não pode ser doada. Motivo: xyz.`) and submit a note: it retries
    without probing, so it is sitting on a 10–20 s timer. **While that timer is
    running**, make the server confused (55b) so the queue parks. ✅ When the
    timer fires the note **parks amber with everything else** — it must not stay
    blue saying "Nova tentativa (N de 5) em instantes…", which is a retry that
    is not coming. Check all three: the row is amber, the server bar's count
    **includes** it, and the queue indicator is not hiding it as work in flight.
    Then restore the server. ✅ It drains with the rest. The old build enqueued
    this note into the paused pool, where it was the one note on screen that
    nothing accounted for.

### 9. Duplicate-session handling

56. Force a duplicate session (log the same account in from another browser),
    reload the donation page. ✅ With the preference ON (default): the registrar
    is usable immediately, and the **session condition bar** — the only surface
    in this whole story — reads "Encerrando as sessões abertas…" and then "As
    sessões foram encerradas, inclusive esta. As notas continuam guardadas." with
    "Entrar novamente". There is no separate banner, in any state.
57. Turn the preference OFF, repeat. ✅ **No** `/sair` request at load, and the
    same bar is already there at load reading "O usuário autenticado possui mais
    de uma sessão ativa. As notas continuam guardadas." with "Encerrar todas as
    sessões ativas". Nothing has been sent yet, so nothing else would have said
    a word — and the sentence has to be the reassuring one, because its job is
    to let the volunteer start scanning knowing the notes are kept.
    Then scan a valid key without leaving the page. ✅ The entry reads "Sua conta do
    Nota Paraná está aberta em mais de um lugar…" with a clickable "Encerrar
    todas as sessões" — **never** "Sua sessão no Nota Paraná expirou." —
    and the key stays in the durable queue (badge count unchanged) so it resends
    on the next load.
57a. Click either "Encerrar todas as sessões" — the bar's or the
    note's, they are the same action. ✅ The page does **not** navigate: one
    background GET `/nfprweb/publico/sair` fires (exactly one, however many
    times and places you click), the bar moves to "Encerrando as sessões
    abertas…" → "As sessões foram encerradas, inclusive esta. As notas continuam
    guardadas." with "Entrar novamente", and **every** note refused for the
    duplicate session moves to "Encerrando as sessões abertas…" and then to the
    same expired-session error, which is the truth once every session, including
    this one, is closed, and the link opens in **this** tab, never a new one.
57b. **One event, one voice.** Through the whole sequence, at no point may two
    surfaces be narrating the termination at once. ✅ One bar, start to finish.
    There used to be a separate duplicate-session banner alongside it, narrating
    the same `/sair` in its own words — and the two then disagreed about what to
    do next, the banner saying "Atualize a página" while the bar said "Entrar
    novamente". The bar is right: `/sair` closes our session too, so reloading
    lands on a logged-out page. If a second surface ever reappears here, that
    disagreement is what it costs.
57c. **Nothing may move between the states.** Watch the same sequence with an
    eye on the bar's edges, not its words. ✅ Identical height, padding and
    amber throughout, and the action button stays the same size in the same
    place. During "Encerrando…" the "Entrar novamente" label is drawn muted and
    **inert** — it must not be clickable, because following it while `/sair` is
    in flight kills the request; when the bar goes live it is the *same*
    element, so nothing shifts.
57d. **One amber for every bar.** Trigger each condition bar in turn (this one,
    the refused entity in 93c, the confused server in 55b, the stale fixed part
    in 32k). ✅ Same background, border, ink, height and button size on all of
    them. The confused-server bar is the one deliberate exception to the
    height: it carries no action, because nothing on this machine can fix
    someone else's server. ✅ The failures bar keeps the same geometry and is
    **red**, still the only one.
58. Trigger the same state on a `ContaCorrente*` URL with the preference ON. ✅
    You land on the donation page, and Back does not return to the error screen
    (`location.replace`). With it OFF, the site's own screen stays untouched.

### 10. Feedback preferences

59. "Sons de aviso e de erro" ON (default), after one click anywhere on the page: submit
    an invalid key. ✅ Error buzz.
60. "Som ao registrar a doação" OFF (default): succeed a donation. ✅ Silent. Turn it
    ON, succeed another. ✅ Chime.
61. Toggle "Piscar a tela" OFF, submit. ✅ No flash. Back ON. ✅ Flash returns.
    ✅ Its description reads "A tela pisca a cada chave recebida, digitada ou
    escaneada." — not "ao escanear" alone, which was never the whole truth: it fires at the top of
    `aceitar()` before any branch, so it flashes on a typed key and on a refusal
    exactly as it does on a good read. That is the point — it confirms something
    reached the end of submission, whatever the verdict, and it is the only
    feedback that works with the sound off.
61b. **Parte fixa da chave**, in the **Comportamento** block, default ON.
    ✅ Its description says it is for whoever types the notes and that the
    scanner does not need it. Toggling it either way also silences the offer of
    §4 step 25b, permanently — working the switch is proof of having been told.
61a. ✅ The card is four named blocks — **Comportamento**, **Sons**,
    **Tela**, **Envio** — and the
    three sound switches are still three. Shape only: nothing was deleted,
    merged or defaulted differently. Turn one sound off and confirm the other
    two still fire (step 60 already covers which is which).
62. Trigger an `inelegivel` outcome **from the server** (a note past the
    deadline). ✅ No sound at all, regardless of preference — by the time the
    answer arrives it is unattributable. A grey verdict raised locally at scan
    time does sound the warning ping; the volunteer is standing there.
62b. **The four cues, and the two that must not be confused.** Turn "Som ao ler
    a chave" and "Som ao registrar a doação" both ON and submit `K_OK`. ✅ Two
    sounds within a second or so, in the same voice: a single note when the key
    is read, then a rising two-note figure when the site confirms. **Both must
    be plainly audible from across the room** — that is the test that matters,
    because the read cue was once a quiet flat blip that simply vanished in a
    room with people in it. Then stand back and have someone else submit one. ✅
    You can tell which played without looking: one note versus two, and the
    single one is lower.
62b′. **A key that cannot unlock the sound does not use up the chance to.**
    Desktop Chrome, not the Claude browser pane (whose autoplay policy is
    looser and never showed the bug). Reload the donation page, press **Shift**
    (or Ctrl, or Esc) before anything else, then submit `K_BADCDV`. ✅ The
    error buzz plays, and the console has no *"The AudioContext was not allowed
    to start"*. Before the fix the modifier key spent the one attempt, and every
    cue was silent until the page was reloaded.
62c. Turn "Som ao ler a chave" OFF, leave the other two on, submit `K_OK`. ✅
    Only the confirmation chime. Each cue has its own switch; turning one off
    must not silence another.
62d. **The offline page must never claim a registration.** Open the offline page
    with "Som ao ler a chave" ON and scan `K_OK`. ✅ The read blip — never the
    confirmation chime, which is what it used to play here for a note it merely
    wrote down.
62e. **Provenance on the row.** Submit a note the site refuses (`K_VELHA` with
    the local grey verdict bypassed via §3a, or `respostaForcada`). ✅ The row's
    message is prefixed with a muted `[nfprweb]`, visibly quieter than the
    sentence itself. Now trigger a local refusal that still produces a row — a
    scanned note that is out of date, say. ✅ **No prefix**: that verdict is
    ours. Also check a parked note ("Guardada — …"): ✅ no prefix, because that
    sentence describes what this extension is doing, not what the site said.

62f. **The shrug arrives in the site's own words.** With `respostaForcada` =
    `{"erro": "A aplicação retornou que não foi possível concluir a ação
    solicitada."}`, let a note run out its budget. ✅ The row shows **that exact
    sentence**, prefixed with a muted `[nfprweb]` — not a rewording of ours.
    The prefix is what makes relaying it safe: the sentence answers three
    unrelated causes byte for byte, so it must never read as a diagnosis this
    extension made.

### 11. Modal, popup, and cross-surface sync

62a. **Ajuda takes the whole modal over.** Open the modal, click **Ajuda**. ✅ The
    configuration form is GONE, not shrunk into a column beside the help text;
    Ajuda fills the modal and carries a back arrow to Configurações. Click back.
    ✅ The form returns, Ajuda is gone. Same for Depuração via **Cuidado!** (83d).
    Both pages mount their content in an inner box precisely so `.nfpr-settings`
    never lands on the page element and fights `.nfpr-view` for `display`; the
    smoke test asserts the structure, but only this step sees the result.
63. Open the modal, press Esc. ✅ Closes; the page itself does not react; the
    entry is refocused. ✅ The modal has two cards now, Entidades and
    Preferências — fixed parts moved to the registrar's own strip (§4).
64. Press Esc with the modal closed **and the entry empty**. ✅ Nothing
    extension-related happens. With digits in the entry it empties them, and
    only that (§2, step 19b).
64'. **The modal without a mouse.** Tab from the page to the entity chip and
    press Enter. ✅ The modal opens and the chip behind it has NO focus ring —
    the keyboard went in with the dialog. Press Tab repeatedly. ✅ Focus walks
    Ajuda → Fechar → the entity list → the form → the switches, and from the
    last switch wraps back to Ajuda; Shift+Tab wraps the other way. It never
    reaches the government page behind the backdrop. Press Enter on **Ajuda**.
    ✅ The keyboard is on the back arrow; Enter there returns it to **Ajuda**.
64''. **A closed modal is not in the Tab order.** Close it and press Tab
    through the whole page. ✅ No invisible stop anywhere — before, every
    control of the closed modal was still reachable (it was only transparent),
    and Space on an invisible switch changed a preference.
64'''. **Fixed parts switched off from inside the modal.** Fixed parts on, open
    the strip's editor, then open the modal and turn **Parte fixa da chave**
    off. ✅ The keyboard stays on the switch you just used — it is not pulled out
    to the entry behind the backdrop. Close the modal. ✅ The entry has the
    keyboard and takes digits. Now turn fixed parts on, open the editor, open
    the modal and close it without changing anything. ✅ The keyboard is back IN
    the editor's field, not on the entry box behind it.
64''''. **A button that goes away hands the keyboard on.** Arm a fixed part,
    Tab to **Digitar a chave inteira** on the strip and press Enter. ✅ The
    button disappears and the keyboard is on the entry: type digits and they
    land; press Tab and focus moves on from the entry, not from the top of the
    government page. Same for the stale-fixed-part bar's **Digitar a chave
    inteira**, the scan-under-a-fixed-part bar's, the offer's **Ativar** /
    **Não mostrar**, the refused-entity bar's button and **Voltar à segurança**.
    A bar that goes away while the keyboard is in the settings overlay leaves
    it there.
64a. **The popup has no fixed parts.** Open it. ✅ Two cards, Entidades and
    Preferências, and nothing about fixed parts anywhere. Deliberate: a fixed
    part is working state whose effect is only visible beside the 44 cells, and
    this window has no key entry to use one with — managing one here was
    managing it away from the only place it means anything.
65. Open the popup and the donation page side by side. Change the active entity
    in the popup. ✅ The registrar chip updates within ~1 s, no reload.
66. Start typing a CNPJ in the page's modal, then flip a preference in the popup.
    ✅ The half-typed text is untouched.
66a. **A half-typed key survives a write that does not change it.** Type ten
    digits into the entry, then flip a sound preference in the popup. ✅ The ten
    digits stay; finish the key and it registers. Same on loading the page with
    an entity saved unverified: start typing at once, and the registry's name
    arriving in the chip does not empty the entry. Now type ten digits and
    switch the active entity (or arm a fixed part) in the popup. ✅ The entry
    empties — those are the two things a partial key depends on.
67. **Two surfaces, two different writes.** With the popup open, add an entity on
    the page while toggling a preference in the popup. ✅ Both survive — neither
    write reverts the other.
68. "Abrir a página de doação" in the popup. ✅ New tab at the donation URL, popup
    closes.
69. Popup footer. ✅ `v<version>` matching `manifest.json`.

### 12. Toolbar badge

70. With 3 keys queued (force via §8), check every open window. ✅ All show `3`.
71. Let all 3 resolve. ✅ Badge goes empty, not `0`.
72. Fully restart the browser with keys queued, before opening any page. ✅
    Badge correct immediately.
72a. With keys queued, arm debug mode (§15). ✅ Badge switches to a red `DEV`;
    disarming restores the count. Debug outranks the queue deliberately — it is
    the only warning visible with every window in front of the registrar.

### 13. Offline fallback + offline page

73. Disconnect entirely, then navigate to the donation URL fresh (new tab, not a
    reload). ✅ Lands on `chrome-extension://<id>/src/offline/entrada.html`. The
    first navigation after the drop may still flash a browser error page — a
    documented race, not a bug.
74. Offline page with no entity. ✅ Same onboarding as §1 — including that
    nothing opens itself: the blocked card, and settings only on a click.
75. With an entity, scan `K_OK`. ✅ Entry shows a saved/parked state, never
    "Enviando…"; the Network tab shows **zero** requests to `app/v1/...` other
    than the reachability probe.
76. Rescan it. ✅ "Esta chave já está guardada para envio." — unlike the live
    page this block never clears, because there is no failure path.
76a. **The strip is here too.** Write a fixed part, apply it, type a note under
    it. ✅ Everything in §4 works identically — fixed parts live in the shared
    bootstrap, so this page gets them free. Then click into the fixed part field
    and type digits. ✅ They go into the FIELD and not into the key buffer.
    What stops them is capture standing down while a strip field has the
    keyboard (`editando()`); the form-field test cannot see inside our closed
    shadow root.
76b. ✅ The live typing verdict works here too (§3, steps 25a–25j) — it is local
    validation and needs no connection.
77. Reconnect. ✅ The connection bar turns green and offers "Abrir o site de
    doação". **Do this while a probe is in flight** (reconnect during the ~8 s a
    hung probe allows) — the bar must still recover; it must never stay amber
    for the rest of the session with a working connection.
78. Click the button. ✅ It re-verifies before navigating; cut the network right
    before clicking and it must NOT navigate you into a dead page.
79. Open the real donation page afterwards. ✅ The keys saved offline appear as
    live entries and get sent.
79a. **The drain leaves the deadline to the server.** Save a key offline, then
    move the machine clock forward past its deadline before opening the live
    page. ✅ On load that note **is sent**, and the server judges its date on its
    own clock: a genuinely expired note comes back as a grey `[nfprweb]` row and
    leaves the queue; one the wrong clock merely *called* expired registers.
    Then set the clock a month **back** and repeat. ✅ Same: sent, not destroyed
    as "future". The drain judges only what does not depend on the date — the
    volunteer's machine is the one clock that can be wrong, and a restored
    batch is exactly what a wrong one used to delete.
80. Simulate "network up, site down" (block the host in `/etc/hosts` or a proxy)
    and navigate to the donation page. ✅ The backstop swaps the tab to the
    offline page after the failed navigation (a brief native-error flash is
    expected here).
80a. **Firefox:** open the donation page and press Esc (or the ✕ in the address
    bar) while it is still loading. ✅ The tab stays where it is and does not
    go to the offline page. Firefox reports a stopped load as `"Error code
    2152398850"`, in decimal, and the list in `service-worker.js` has to spell
    it that way. The fix was worked out from Firefox's source code and has not
    been run in Firefox yet.

### 14. Isolation

81. Browse to any other site, or another `notaparana.pr.gov.br` page not matched
    by the manifest. ✅ No panel, no console errors from `NFPR.*`, no DOM
    changes; `window.NFPR` is undefined there.
82. On the donation page, in the page's own console (not the content script's),
    check `document.getElementById('nfpr-host').shadowRoot`. ✅ `null` — the
    shadow roots are closed.

### 15. Modo de depuração

Everything here needs the devtools context dropdown switched to the extension's
isolated world. See [Modo de depuração](#modo-de-depuração).

83. Fresh profile, nothing stored. ✅ No red banner; `K_BAD_CDV` is refused with
    a red toast and no row. Debug ships inert.
83a. Click `span.fn.org` on the donation page 7 times in a row. ✅ Toasts count
    down over the last four; on the seventh the red banner appears and
    `NFPR.Debug.resumo()` is `[]` — armed, every flag off.
83b. Click it 3 times, click somewhere else, then 6 more. ✅ Nothing happens:
    the run restarted. Same for a >2.5 s pause mid-run.
83c. With it already armed, click it repeatedly. ✅ Every toast reads "Não é
    necessário, você já é um desenvolvedor." — no countdown, no page opens,
    nothing re-arms. The gesture is inert once the mode is on.
83d. Click **Cuidado!** in the banner. ✅ The modal opens straight to Depuração,
    with a back arrow to Configurações. Nothing in the modal header offers that
    page. Esc closes it.
83e. Toggle a flag in the form. ✅ The banner's flag list updates immediately,
    and `NFPR.Debug.flags()` in the console agrees. Change one from the console
    instead. ✅ The form repaints.
83f. Click a test-key preset. ✅ A 44-digit key appears selected in the box;
    pasting it into the registrar produces the outcome the preset names.
83g. Click **Conferir os vereditos**. ✅ Green line on the page: *Tudo certo: 16
    de 16 casos, no mês MM/AAAA* — the current month — and a sixteen-row table in
    the console. Now set a fixed clock (step 84) and click it again. ✅ Still
    16/16, and the line names the month you travelled to: the fixtures move with
    the clock, which is what proves the fake clock reaches every verdict.
83h. Close the modal and reopen Depuração. ✅ That line is gone. It answered a
    click; it is not state.
83i. In **Relógio e conexão** type `12` and `30`. ✅ The banner reads
    `relogioFixo=12/2030` — two digits in the box, a full year in the flag. Now
    toggle any other control. ✅ The box still says `30`; a repaint that forgot
    to convert back would show `2030` and lose a century on the next keystroke.
    Type `2026` there instead. ✅ Refused as incomplete, the stored clock
    unchanged, and the digits left in the box — same treatment as month `13`.
83j. Disarm from the form's **Voltar à segurança**, then reload. ✅ Banner gone,
    flags still listed in the form, nothing reading them.
84. `NFPR.Debug.ligar({ relogioFixo: { ano: 2026, mes: 12 } })`. ✅ The red
    banner appears **without a reload**, naming `relogioFixo=12/2026`.
85. With the clock forward, scan a key emitted this month. ✅ Grey
    `EXPIRADA` row. A fixed part fixed to the same year/month shows *Fora do
    prazo* in settings and raises the stale-fixed-part bar in the registrar.
86. Set `{ ano: 2020, mes: 1 }` and rescan. ✅ The same key is now red `FUTURA`.
87. `ligar({ partesFixasSemValidacao: true })`, then save a fixed part fixed to
    `35`. ✅ Accepted. The registrar's own stale-fixed-part bar still reports
    honestly.
88. `ligar({ respostaForcada: 'Prazo para doar expirado.' })` and scan a good
    key. ✅ Grey row, dropped from `nfpr:fila`. Repeat with `'Chave de acesso
    inválida.'` (red, terminal, rescannable), `'Estabelecimento emitente não está
    localizado no Estado do Paraná.'` (grey, terminal, no failures bar),
    `{ cnpjEntidade: '…' }` (terminal), `{ erro: '…' }` (five attempts, then
    reported).
89. `ligar({ respostaForcada: null, erroForcado: 'SERVIDOR' })` and scan. ✅
    Connection bar turns; the note parks as *Guardada — será enviada automaticamente quando a conexão voltar*. Then
    `ligar({ erroForcado: null, forcarConexao: 'online' })`. ✅ The watchdog
    fires and the parked note resends.
90. `ligar({ aceitarChavesInvalidas: true })`. ✅ `NFPR.Debug.flags()
    .simularEnvio` is `true` **without having been asked for**. Scan
    `'4'.repeat(44)`: it gets a row, the row is marked *⚠ forçada em depuração —
    chave inválida*, and the network tab shows **no POST at all**.
91. Click *Voltar à segurança* on the banner. ✅ Bar disappears, the same bad key
    is refused red again, and after a reload the mode is still disarmed with the
    flags kept on record.
92. `const s = await NFPR.Debug.snapshot()`, then
    `NFPR.Debug.gravar('nfpr:config', 'lixo')` and reload. ✅ The registrar falls
    back to defaults rather than breaking. `NFPR.Debug.restaurar(s)` + reload
    restores everything.
93. Open the offline page with debug armed. ✅ Same red banner and the same
    Depuração page behind **Cuidado!**; `forcarConexao: 'offline'` pins the
    connection strip with no probe traffic. The 7-click gesture is **not** there
    — there is no host page to click on.
93a. **The two "pretend the network is broken" levers are not the same lever.**
    With notes queued, `ligar({ erroForcado: 'REDE' })` and scan. ✅ The bar
    turns and the note parks — but the recovery probe is still real, so
    clearing the flag lets it resend on its own. Now `forcarConexao: 'offline'`
    instead. ✅ Same parked note, and the Network tab shows **no probe traffic
    at all**. Then `forcarConexao: 'online'` with the router unplugged. ✅ The
    watchdog reports connected without issuing a request — the one state
    `erroForcado` cannot produce, and the reason both flags exist. The form's
    two help texts should have told you which to reach for before you read
    this step.
93b. **Deleting settings must not delete donations.** Queue several notes
    (offline page, or `forcarConexao: 'offline'`), then click **Apagar
    configurações do usuário** in *Recomeçar*. ✅ Entities, fixed parts and
    preferences are gone; the confirmation says the queue stayed, and
    `nfpr:fila` still holds every note. Reload. ✅ They drain. **Esvaziar a
    fila** is the only control that throws donations away.
93c. **A refused entity must not eat the queue.** Add a CNPJ with valid check
    digits that is not a registered receiver (the offline page will accept one —
    it cannot reach the registry), queue several notes against it, then open the
    donation page connected. ✅ **One** error sound, an amber bar naming the CNPJ
    and the number of notes held, every note amber and still listed in
    `nfpr:fila`, and in the Network tab **one** POST, not one per note. The old
    build deleted every one of them. Now activate a good entity. ✅ The bar's
    button changes from *Abrir configurações* to *Enviar para ⟨name⟩*; click it
    and they drain to the new target. Queue one note against a WORKING entity
    first and check it is still aimed there afterwards — the redirect must move
    only what was refused. Change the active entity **without reloading** ✅ the
    button switches from *Abrir configurações* to *Enviar para ⟨name⟩* straight
    away. It must not need a reload: a reload starts with an empty latch, so the
    first note goes back out to the refused CNPJ and burns a request to
    rediscover what the bar was already saying.
93d. **The same bar with nothing held.** Same unregistered CNPJ, active, but
    **empty the queue first**, then load the donation page connected. The
    pre-drain re-check latches straight off the registry with no note parked.
    ✅ The bar names the CNPJ and **says nothing about a count** — never "0
    notas estão guardadas para ele", which is what it said until the
    count sentence learned to disappear. Now activate a good entity. ✅ The bar
    **goes away** — with nothing parked and nothing in `nfpr:fila` aimed at the
    refused CNPJ there is nothing to move, and a leftover *Enviar para ⟨name⟩*
    reads as the new entity being the refused one. Activate the refused one
    again. ✅ The bar returns (the refusal stays latched for the page). With
    notes still queued against the refused CNPJ the bar stays and offers the
    move, as in 93c. **Then the inactive case:** keep the unregistered CNPJ in
    the list but make a good entity active, empty queue, and reload. ✅ No bar
    and no sound — the lookup still ran and latched it, but nothing is aimed
    there. Activate the unregistered one without reloading. ✅ The bar appears
    at once, before any note is scanned; the old build said nothing until the
    server refused the first note.
93e. **Click "Enviar para X" while the drain is still running.** Queue a big
    batch (30+) against the unregistered CNPJ, activate a good entity, then load
    the page connected and click the button **the moment the bar appears** —
    not after the queue has settled. ✅ The bar goes and **stays** gone, and the
    Network tab shows **no further POST carrying the refused CNPJ**: at most the
    handful that were already in flight when the latch closed, never one per
    note. The old build re-aimed only the notes already parked, so everything
    still waiting in the pool kept the refused target in memory and went
    straight back out to it — the bar reappearing seconds after being fixed.
    ✅ Every note ends up filed against the good entity, except the few whose
    request was already in flight: those come back refused, re-latch the bar
    and wait for a second click. That residue is expected — a request already
    sent cannot be recalled — and it is bounded by the pool width.
94. `node tools/smoke.js`. ✅ Passes, debug-mode checkpoint included. Debug mode
    ships, so its lines in all three loaders are expected.

### 16. The government page's own chrome

Everything `host-page.js` does. All of it is visual, and all of it is one CSS
selector away from silently not applying. `smoke.js` checks only what must NOT
be there — no `overflow` on `#header`, no `display` on `.user-config-options`
— and that the footer height is published rather than restated; whether the
rest looks right is these steps.

95. Load the donation page. ✅ No flash of the raw server-rendered form before
    the registrar appears, no flash of a tall government header collapsing to a
    short one, and no flash of a tall footer collapsing to a short one — the bar
    and the footer are their final height from the first paint, never resized
    after it. The bar appears complete, with the entity chip already in it,
    rather than drawing first and gaining a chip a moment later.
96. With the page settled, in the console:
    `document.body.getBoundingClientRect().height` vs `window.innerHeight`.
    ✅ **Equal.** The page does not scroll by even a pixel, and the footer is
    fully visible with the panel's bottom edge just above it. A 2px difference
    means `.nfpr-registrar-page` lost its `box-sizing: border-box` and its
    border is again rendering outside the height `ajustarAltura` wrote.
97. Look at the footer itself. ✅ One row: the version string at the left, the
    Celepar logo at its natural size pinned to the right edge, both vertically
    centred, nothing clipped horizontally.
98. Narrow the window below 500px. ✅ The logo halves; it does not disappear and
    does not collide with the version string. Widen back. ✅ Full size again.
99. Shrink the window vertically until the panel stops shrinking with it
    (`ALTURA_MINIMA`, 320px). ✅ Below that point the page scrolls again and the
    footer goes back under the fold. **Expected** — see Known gaps.
100. In the page's own console (not the isolated world), confirm the host
     document carries exactly our mutations and no more: `<html>` has
     `scrollbar-width: none`, there are three `<style>` elements appended to
     `<html>` that are not the site's (four on Chrome before 121, the fourth
     hiding the scrollbar), `#main` holds only
     `#nfpr-registrar-host`, and `#header` holds only its own `.logo`,
     `#system-info` and our `#nfpr-cabecalho-host`. ✅ Nothing else in the
     government DOM is ours, and nothing of theirs was moved.

#### 16a. The merged header

101. Look at the bar at ≥1200px. ✅ One row, ~54px: Nota Paraná logo,
     *Início*, the entity chip, a hairline, the volunteer's name, the CPF, the
     site's *Configurações*, the site's *Sair*. ✅ Widen to 2560px: the bar
     stops growing at 1200px and nothing else appears. Click *Início*. ✅ The site's own
     entry page (`/nfprweb/`) loads. Narrow the window below ~500px. ✅ The
     word goes and the house stays. The site's blue JPEG band is gone, and
     the panel below starts immediately under it.
102. `document.getElementById('main').getBoundingClientRect().top`. ✅ **64** —
     at every width. Before this it was 127 / 148 / 101 depending on the window,
     plus 64 more for the registrar's own header.
103. Click the site's **Configurações**. ✅ Its dropdown (*Alterar senha*,
     *Alterar e-mail*, …) opens under the right-hand end of the bar, fully
     inside the window, painted over the panel. Click anywhere else. ✅ It
     closes — including when the click lands on our chip, which is in a shadow
     root and still bubbles to their handler.
104. Click the entity chip. ✅ The settings modal opens on the config page.
105. With no entity configured. ✅ The chip is ringed, reads *Nenhuma entidade /
     clique para escolher*, and the CNPJ line is **not** in the monospace face.
     Configure one. ✅ It becomes *name / CNPJ*, monospace CNPJ, and hovering
     it shows *Configurações — doando para {name}*.
105a. Look at the site's user block at any width ≥768px. ✅ The volunteer's
     name sits **on top of** their CPF, two lines, left-aligned, the way our
     entity chip stacks name over CNPJ — not side by side, and not missing.
     A very long name ellipsizes at 200px rather than squeezing our strip.
     Narrow below 768px, where the name is dropped. ✅ The CPF is back on the
     bar's centre line, level with *Configurações* and *Sair* — not sitting
     low in the row where its second line used to be. Same on any page whose
     template renders no name at all.
105b. Open the page while the site reports a duplicate session. ✅ The site's
     *Configurações* and *Sair* are absent (their template, not us), and the
     name and CPF sit flush after the hairline as plain text — no pill, no
     blank gap where the profile icon would be, the text ending on the bar's
     right padding. Below 768px the CPF alone, on the bar's centre line.
106. Narrow the window slowly from 1280px to 400px, watching the bar. ✅ Nothing
     ever wraps, overlaps or overflows; things disappear in this order and no
     other: the volunteer's name (768px) and our *Início* word (~500px of
     strip, house kept) — both around the point their fixed container gives way
     to the viewport — then the entity name, the CNPJ (~540px, gear kept;
     never shown clipped), the site's *Sair* label (440px, icon kept). The
     site's account pill keeps its icon and the CPF down to 360px. ✅ At 400px the row
     still holds the logo, the gear, the profile icon, the CPF and the Sair
     icon, and
     `document.getElementById('header').scrollWidth ===
     document.getElementById('header').clientWidth`.
106a. Go on to 320px. ✅ At 360px the CPF is still there; below it the account
     pill is a 38px circle holding only the profile icon, still opens the
     site's dropdown, and the header still does not overflow. On the
     duplicate-session screen at 320px the CPF stays.
107. Open the offline page (`entrada.html`). ✅ Its panel still has its own blue
     header, with the brand mark, the title and the chip pushed to the right —
     the same strip, in its other home. The chip opens settings there too.

---

## Edge cases

All of these must behave correctly:

1. Scan arrives while the modal is open → ignored entirely; no partial buffer
   survives to when it closes.
2. Scan or typing with no entity configured → ignored; blocked card visible.
3. Volunteer types into the site's own dialog inputs → capture never interferes,
   even mid-batch.
4. QR scan (URL with `|` separators and letters) → key extracted; the page is
   unaffected by the symbols.
5. Barcode with more than 44 digits in one run → the first 44 of the run are used.
6. Paste of a formatted key with spaces or punctuation → digits extracted; if 44,
   submitted immediately.
7. Paste of fewer than 44 digits → appended to the buffer; display updates.
8. Backspace on an empty buffer → no effect.
9. Enter on an empty buffer → not consumed; the page's default behaviour stands.
10. `/` outside a scan → swallowed (Firefox quick-find); inside a scan → raw
    buffer only.
11. Ctrl/Alt/Meta shortcuts including Ctrl+R and Ctrl+T → never intercepted;
    Ctrl+V handled as paste.
12. Digits beyond the required count → discarded from the display, but **still
    recorded in the raw buffer**, so a full scanned key can override a fixed
    part.
12b. **A polluted buffer is judged as a reading, and refused.** `resolver`
    decides by INPUT KIND: any 44-digit run in `raw` is a scan and is judged as
    it came. So a stuck key that pushes the buffer past 44 characters is no
    longer distinguishable from a scan — the volunteer's correct typed digits
    are destroyed and the note is refused red. That is deliberate and it is the
    safe side of the trade: the alternative is composing a key from the fixed
    part plus a corrupted head, which is the ~10% fabrication this rule exists
    to remove. It costs one re-entry of one note.

    Two things narrow it. Digits typed just before a scan arrives are no longer
    part of that buffer at all — a machine burst discards what a human left
    behind (see §2 and `capture.js`) — so the case is now a stuck key and
    nothing else. And `e.repeat` is deliberately NOT used to catch it: worst-
    case scanner behaviour is unknown, and a scanner that ever set it would have
    its digits silently dropped with nothing on screen saying why.
12c. **An override is never silent.** When a scan does beat an active fixed
    part, `resolver` reports it (`{ chave, ignorouParteFixa }`), the note is
    registered from the reading — the right outcome, and the whole point of the
    rule — and the volunteer gets the warning ping plus a permanent amber marker
    on the row: "⚠ parte fixa não usada — chave lida inteira". A batch typed
    under a fixed part is exactly where an accidental scan is easy to miss, so
    the row has to still say it days later.
12d. **Two scans with no Enter between them submit the second.** Needs a scanner
    configured to send no terminator, and auto-send off. Scan note A, do not
    press Enter, wait three seconds, scan note B, press Enter. ✅ The cells show
    B, and B is what registers. Do it with two QR codes, and with two plain
    barcodes. (It used to be A — the second read looked exactly like a stalled
    scan resuming, so it was kept as A's tail and B vanished without a sound.)
    A scan that genuinely stalls inside a QR code's `|2|1|1|…` tail still keeps
    its key; `smoke.js` pins both, the off-line NFC-e's hex digest included.
13. Auto-send on with a 1-variable-digit fixed part → each digit submits a key;
    rapid sequences each resolve correctly.
14. Fixed part with zero `?` after padding → rejected at creation.
15. Fixed part removed, or entity changed, mid-entry → buffer resets, display
    clears.
16. Active entity removed while keys are queued → they wait; capture is blocked
    meanwhile; they resume when an entity is set.
17. Same key scanned twice in a second → the second is `duplicado`, one request
    total.
18. Key rejected as `erro` — whether the site's own sentence or this code's own
    "O site respondeu…" wording — then rescanned → a fresh attempt is allowed
    once its retries run out. Every unresolved outcome unblocks the key; none
    of them stay blocked for the rest of the session.
18a. Key rejected with a sentence this code does not know, then `LIMITE_LINHAS`
    newer notes scanned → the row is evicted but the note is still counted on
    the bar and still listed with its digits behind it. Rows are capped; records
    are not.
18b. A note still IN FLIGHT when its row is evicted → its terminal answer is
    recorded anyway. This is the one the surface exists for: at a pool width of
    6, twenty newer scans landing before a slow note answers is ordinary.
18c. Key rejected with a sentence this code DOES know (`chave de acesso
    inválida`), or by a local verdict, or for want of an active entity → red row
    as always, and **nothing on the bar**. The row already names the reason and
    the remedy; the bar is for the notes nobody could account for.
18d. A listed key rescanned and registered → it leaves the list, matched on the
    key. A green row and an entry saying "find this paper" cannot both be true
    of the same receipt.
18e. A listed key rescanned and unexplained AGAIN → still one entry, carrying
    the newest sentence. One entry per paper, not per attempt: the second note
    is a second reading of the same receipt, and listing it twice would send
    someone hunting for a paper that does not exist.
18f. Reload with notes listed → the list is gone. Deliberate: it is session
    state like the retry counter and the duplicate check, and the notes
    themselves already left `nfpr:fila` with their keys unblocked.
19. Key that succeeded before a reload → the in-tab record is gone, so a rescan
    **is sent again**. Nothing anywhere prevents a double donation; see
    [Known gaps](#known-gaps).
20. Reload mid-flight → the key re-attempts on resume, and if the first send had
    landed, the donation is simply made twice.
21. Browser crash with keys queued → intact on restart; the badge is correct
    before any page opens.
22. Two tabs plus the popup, settings changed in each → last write wins **per
    field**; no surface reverts another's change or wipes its half-typed text.
23. Duplicate-session screen already present at load → handled; queued keys
    resume after termination settles.
24. Token page returns the duplicate-session sentence mid-batch → entries show
    "Encerrando as sessões abertas…" while our own `/sair` is in flight, and otherwise the
    server's sentence plus the `/sair` link; either way the keys stay queued.
25. Offline at page load with keys queued → listed as waiting; they resume on
    reconnect without a reload.
26. Registry lookup outlives its input (CNPJ edited while pending) → the stale
    result is discarded.
27. The same CNPJ added from both paths (manual and the site dialog) → the second
    is refused on both.
28. Entity with a blank name everywhere → falls back to `Entidade <formatted CNPJ>`.
29. The site's `#main` missing → the registrar still mounts (fallback) and works.
30. Sound preferences toggled mid-batch → take effect on the very next event.
31. Esc with the modal closed **and the entry empty** → not consumed; the page
    receives it. With something in the entry it IS consumed, and empties it —
    that is the only thing it does, and it never submits.
32. A durable-queue write fails (quota, storage unavailable) → the volunteer is
    told, in different words on each surface: the live page is sending anyway but
    the note will not survive a reload; the offline page says the note was **not**
    saved and unblocks the key so rescanning it is a real retry.
33. Private/incognito window where the extension is allowed but storage is fresh
    → behaves like a first run, without touching the normal profile's data.

---

## Out of scope

Do **not** build:

- Any server, backend, account system, or cloud sync; any telemetry or analytics.
- Logging into Nota Paraná on the user's behalf, CAPTCHA solving, or credential
  storage.
- Camera-based barcode/QR scanning — keyboard-wedge scanners only.
- Bulk import (a CSV of keys), bulk export, printing, or reporting.
- Recovering damaged keys by brute-forcing unknown digits against the check
  digit. A tempting utility; explicitly excluded, and the implementation was
  deleted because nothing consumed it.
- Editing a saved entity in place (remove and re-add is the model), or
  reordering the lists. *(Fixed parts are not in this line any more: once a
  fixed part is a piece of text rather than a record, editing one is not a new
  primitive at all. An entity is different — it is a CNPJ plus a **verified**
  official name, and editing the CNPJ in place would make `verificada` lie about
  which number was checked.)*
- Per-key entity targeting — the active entity applies to everything sent while
  it is active.
- Any donation flow other than the site's manual key entry (no XML upload).
- Localization beyond pt-BR; theming; user-configurable timing thresholds.
- Mobile browsers or Safari. Desktop Chrome/Edge/Brave ≥109, Firefox ≥115.
- Native `alert`, `confirm`, or `prompt` anywhere, under any circumstance.

---

## Known gaps

Honest limits, not bugs to be surprised by:

- **The most important check of all is impossible from here, and deliberately
  so: whether the note has already been claimed.** Donating is *choosing the
  target of an untargeted note* (see [the protocol section](#donating-is-choosing-a-target--and-the-check-that-matters-most-cannot-be-made)),
  so a receipt whose buyer gave a **CPF *or* CNPJ** at the till is already spoken
  for. Nothing in the 44 digits says so; the POST accepts it like any other and
  it is dropped silently in the monthly pass.

  The check cannot be added, because **every route to that information is behind
  a government CAPTCHA or hash** — evidently to stop exactly the thing an
  automated lookup would be: scraping for real, unclaimed keys to claim. That
  reasoning is sound and this project has no business defeating it, so the gap
  is permanent by design rather than pending work. A volunteer working through a
  box of receipts cannot tell these apart from good ones, and neither can this
  extension.
- **Nothing prevents a double donation at send time, and the retry policy
  accepts causing one.** The POST does not detect a repeat: send the same key
  twice and the second goes through like any other, with no complaint to react
  to. The **monthly reconciliation does** discard duplicates, so the cost of a
  repeat is a wasted request rather than a corrupted balance — which is what
  makes the retry policy defensible. It is also a narrower risk than it first
  looks: an answer that *arrived* and was not 200 OK + `sucesso` filed nothing,
  so resending after one costs no duplicate. The exposure is the attempt whose
  answer **never arrived** — a timeout or a dropped connection, where the server
  may have processed the request before we stopped listening — and that one is
  resent regardless.
  The in-tab `duplicado` check is therefore not a safety net and does not need
  to be one; its real job is smaller and more human — a volunteer can be holding
  several copies of the same receipt without realising, and this is what tells
  them. It does not survive a reload and does not cross tabs, and that is fine.
  It is also why the check keeps speaking under
  [*Enviar sem verificação prévia*](#sending-everything-anyway) while the other
  local refusals go silent: that job is not a verdict on the digits, and the
  refusal it drops costs a request rather than a donation.
- **The série no longer catches corrupted reads, by choice.** The issuer
  checksum accepts a CNPJ or a padded CPF on any série, and nothing reads the
  série or tpEmis at all. The MOC makes some combinations impossible on an
  NFC-e (a CPF issuer, a série above 909), but a single misread already fails
  the check digit, so a rule for them would catch nothing. A corrupted read now
  has to pass the key's check digit and one of the two issuer checksums to slip
  through, which is rare. If a série rule is ever brought back, it must be one
  that can only grey or pass, never refuse.
- **The record of rejected notes keeps the last 100 and no more.** It is the
  only trace of notes that have already left `nfpr:fila`, so it is durable — but
  it cannot grow without limit, and the oldest fall off the front. A volunteer a
  hundred rejections behind has a problem no list solves. Entries also leave
  when the same key registers on a later attempt, and nothing else clears them:
  the record persists across reloads and across days, by design, with the time
  each note was entered shown beside it so old ones are recognisable as old.
- **That list can only ever be as good as the set of sentences this code knows —
  but it fails in the safe direction.** It holds what `classificarResposta` could
  not read. The *validation* behind those sentences is fixed by federal law and
  cannot drift, but the sentences themselves are the site's own prose and can be
  reworded at any time. When one is, it stops matching, becomes unrecognised,
  and lands on the bar instead of being handled on its row: the volunteer is
  told to check the paper rather than told nothing. It is also the signal that a
  sentence needs relearning — a bar counting a large share of an ordinary batch
  means the contract moved, not that the batch was bad.
- **A fixed part blocked today as future becomes legitimate when that month
  arrives.** Pre-configuring December's fixed part in August will not work.
- **One donation-page tab at a time, one profile.** The pending queue is shared
  and sending is not coordinated across tabs. The storage lock is per page.
- **`encerrando_sessao` is not auto-retried.** When `/sair` settles, parked items
  are relabelled to a terminal session-expired error with a login link rather
  than resubmitted; recovery happens on the next page load. This is deliberate —
  once every session is closed, an immediate resend would fail by definition.
- **The offline page makes two kinds of read-only request**: the reachability
  probe, and the entity lookup if a CNPJ is added from its settings. It never
  *sends*. That is the rule — not "no network".
- **The extension touches the government page in exactly three places** outside
  its own subtree. `ui.js` sets `scrollbar-width: none` on `<html>`, because the
  registrar is sized to the viewport and the host scrollbar would sit beside a
  panel that never scrolls (on Chrome before 121, which lacks the property, it
  appends `html::-webkit-scrollbar{display:none}` instead: the same mutation). `host-page.js` restyles the site's own `#footer` to
  35px on one row, because `#main` is replaced by our registrar but the footer
  below it is not, and the page ships it as a ~90px slab whose only content is a
  version string and a logo. The panel reserves that 35px when it sizes itself,
  so the footer sits on the fold rather than one scroll past it. And
  `host-page.js` restyles `#header` into the merged 54px bar, into which `ui.js`
  inserts one empty shadow host — the mount is the same category of act as
  replacing `#main`'s children, not a fourth restyling. If you find a fourth,
  it is a bug.
- **At about 540px and below, the bar cannot show the target entity** — the chip
  collapses to its gear, and which entity a note is going to is one click away
  rather than on screen. Accepted: the site's two controls and the logo are the
  guaranteed set, and so is the CPF down to 360px (the volunteer's NAME is not — it is the first step of
  the ladder, gone at 767px), the previous build hid the chip entirely below 570px,
  and the alternative (a second row) spends vertical space on exactly the
  screens with the least of it.
- **The footer only fits on the fold while the panel is free to shrink.** Below
  `ALTURA_MINIMA` (320px, `painel.js`) the panel stops giving ground, the page
  starts scrolling again, and the footer goes back under the fold. That is the
  correct trade — a usable registrar beats a visible copyright line — and it was
  true before the footer was ever restyled; the change only bought 55px more
  window before it happens.
- **The narrow-window logo needs `zoom`.** Below 500px the Celepar mark is
  halved with `zoom: .5`, which means "half of whatever the site renders it at"
  without our having to know that number. Chrome has always supported it and
  Firefox has since 126. Firefox 115–125 gets `transform: scale(.5)` from the
  right edge under `@supports not (zoom:.5)`: the mark is drawn at half size
  where `.logos` is pinned, and its layout box stays full size.
- **Anything in the shadow root given a written pixel height needs
  `box-sizing: border-box` spelled out.** `all: initial` on `:host` resets it to
  `content-box`, and `border-box` is declared only under `.nfpr-settings`. This
  cost two pixels of permanent scrolling on `.nfpr-registrar-page`, whose 1px
  border rendered outside the height `ajustarAltura` computed. That element is
  the only one on a written height today; the trap is still armed for the next.
- **The site contract is the fragile part.** URLs, field names, and the Portuguese
  sentences matched (`sucesso`, `prazo para doar`, `tipo de documento inválido`,
  `não está localizado no Estado do Paraná`, `chave de acesso inválida`,
  `mais de uma sessão ativa`), plus the `#main`
  mount point, the `#footer` markup and the `#header` markup `host-page.js`
  restyles, and the `#conteudoPesquisaAvancada` dialog, are all observed
  behaviour of a government site that can change without notice. The footer and
  the header are the mildest of these: if their markup moves, our rules simply
  stop matching and they render as the site intended — a gap, a taller page or a
  small scroll, not a failure. **The full set of rejection sentences is
  not known**, and deliberately does not need to be: one that changes, or one
  nobody has seen, is not a crash — it falls through to the retried-then-
  reported path with the site's own words. The cost is five POSTs and ~35 s
  spent on a rejection that was never going to succeed. If one turns out to be
  both common and permanently fatal, match it as terminal, using its observed
  wording rather than a guessed one.
- **Timing values are product defaults**, not contracts: 35 ms scanner gap,
  250 ms scan end, 450 ms lookup debounce, 4 s toast, ~0.4 s flash, 4 s→30 s
  probe backoff, 8 s probe timeout, 20 s request timeout, 5 send attempts spaced
  1.2 s / 4 s / 10 s / 20 s.

---

*A.M.D.G.*
