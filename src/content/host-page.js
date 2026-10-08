/**
 * host-page.js
 * -----------------------------------------------------------------------------
 * THE ONLY FILE THAT TOUCHES THE GOVERNMENT PAGE'S OWN DOCUMENT — everything
 * that has to be true about it BEFORE the browser paints. Runs at
 * document_start; deliberately has no dependency on NFPR/browser.js, because
 * this must survive being the very first thing to run.
 *
 * (It was called anti-flash.js when hiding #main was all it did. The name
 * described one of its sheets rather than its job, and stopped being true the
 * moment a second one arrived. Keep the file about the host document: anything
 * that belongs to OUR subtree belongs in the Shadow DOM, not here.)
 *
 * Three style sheets, and the difference between them is their lifetime:
 *
 *   `estilo`  hides #main AND #header (the server-rendered donation form /
 *             duplicate-session screen, and the site's own header) the instant
 *             they exist, so the volunteer never sees a flash of raw
 *             government-page markup before our Shadow DOM registrar replaces
 *             it. ui.js calls revelar() right after it mounts real content into
 *             both, which REMOVES this sheet. The setTimeout is a safety net: if
 *             the rest of the extension never runs (a bug, a blocked script),
 *             the page reveals itself anyway instead of staying blank forever
 *             for a non-technical volunteer.
 *
 *             #header is in it for a reason #main is not: the header is not
 *             replaced, it is RESTYLED and then has our own chip mounted into
 *             it at document_idle. Revealed early it would draw once as a bar
 *             with a hole in it and then pop.
 *
 *   `rodape`  restyles the site's own #footer, and is never removed. #main gets
 *             replaced by our registrar, but the footer below it survives as the
 *             government page rendered it: a ~90px blue slab where a <br> drops
 *             the Celepar logo onto its own line. The registrar is sized to the
 *             viewport, so every pixel that slab occupies is scrolling the
 *             volunteer has to do to reach nothing. 35px, one row, text at the
 *             left and the logo pinned to the right.
 *
 *             The logo keeps its natural size at normal widths — rescaling
 *             another organisation's brand mark is not ours to do — which is
 *             also why #footer keeps overflow:hidden rather than growing to fit
 *             it. Below 500px it halves, because at that width it no longer
 *             fits beside the version string at all.
 *
 *   `cabecalho`  THE MERGED HEADER. The site's #header and the registrar's own
 *             head used to stack: 127px of government chrome (60px + a floated
 *             #user-info below 992px, which is WORSE at 148px) and then 64px of
 *             ours, before a single result row. Both are now one 54px bar —
 *             their logo, our Início link, our entity chip, their name and CPF,
 *             their Configurações and their Sair — reclaiming 101-148px
 *             depending on the width. Never removed.
 *
 *             It is a stylesheet and nothing else: every control in that bar is
 *             still THEIRS, in their DOM, with their handlers on it. Their
 *             account dropdown positions itself, /sair is still their anchor.
 *             We move nothing, because a node moved into a shadow root stops
 *             answering document.querySelector — and their own toggle is
 *             `$('.user-config-options')`, which would then find nothing and
 *             silently never open.
 *
 *             ALL OF IT IS !important AND THAT IS THE MECHANISM, not defensive
 *             noise. Their header changes shape at 767/768/991/992/1200px in
 *             four media queries; every one of those declarations is normal
 *             weight, so an !important declaration of the same property beats
 *             it at every width without us reading their table at all. The rule
 *             to keep is therefore: declare enough PROPERTIES. A property we
 *             leave undeclared is one they still control, and it will change
 *             under us at a breakpoint nobody tested.
 *
 *             Two things must NOT be declared here, both load-bearing:
 *             `overflow` on #header (their account dropdown hangs below the bar
 *             and would be clipped) and `display` on .user-config-options
 *             (jQuery's fadeIn writes it inline, and an !important rule would
 *             pin the dropdown open or shut forever).
 *
 * These are mutations of the host document OUTSIDE our own subtree — the third
 * and last place we do that (the others are `scrollbar-width: none` in ui.js
 * and the shadow host ui.js mounts INTO #header, which is a mount rather than a
 * restyling). All are recorded as exceptions in CLAUDE.md and DOCS.md, which
 * otherwise promise we never touch the government page. A fourth is a bug.
 *
 * It belongs at document_start rather than alongside the mount in ui.js for the
 * same reason the #main sheet does: applied at document_idle, the volunteer
 * sees the tall footer render and then jump.
 *
 * Every rule is !important because it is overriding a stylesheet we do not
 * control and cannot see change.
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  var estilo = document.createElement('style');
  estilo.textContent = '#main,#header{visibility:hidden !important}';
  document.documentElement.appendChild(estilo);

  // Declared once, styled with AND published below: painel.js reserves exactly
  // this many pixels so the footer lands on the fold instead of one scroll past
  // it. A second copy of the number in painel.js would be a footer that is
  // silently clipped or a gap under the panel, with nothing to point at.
  var ALTURA_RODAPE = 35;

  var rodape = document.createElement('style');
  rodape.textContent = [
    // The blue slab itself. box-sizing so the padding lives inside the height.
    '#footer{',
    'height:H !important;min-height:H !important;max-height:H !important;'.replace(
      /H/g,
      ALTURA_RODAPE + 'px'
    ),
    'box-sizing:border-box !important;padding:0 14px !important;margin:0 !important;',
    'overflow:hidden !important}',
    // One row: text, then logo. The <br> that stacked them is the whole problem.
    '#footer #footer-info{',
    'display:flex !important;align-items:center !important;gap:14px !important;',
    'height:100% !important;margin:0 !important;padding:0 !important;float:none !important}',
    '#footer #footer-info>br{display:none !important}',
    '#footer #footer-info>p{margin:0 !important;padding:0 !important;line-height:1 !important}',
    // The logo is left at its natural size — resizing someone else's brand mark
    // is not ours to do. right/top only bite because the site positions .logos;
    // they pin it to the right edge of the bar instead of wherever the site's
    // own offsets put it once the bar is 35px tall.
    '#footer #footer-info .logos{',
    'right:0 !important;top:auto !important;',
    'display:flex !important;align-items:center !important;',
    'margin:0 !important;padding:0 !important;float:none !important;line-height:0 !important}',
    '#footer #footer-info .logos a{display:block !important;line-height:0 !important}',
    '#footer #footer-info .logos img{',
    'display:block !important;margin:0 !important;padding:0 !important}',
    // Narrow windows: the version string alone nearly fills the bar, and the
    // logo is pinned to right:0, so it stops fitting beside the text. Half size
    // below 500px.
    //
    // `zoom` rather than width/height because it means "half of whatever the
    // site renders this at" — we do not know that number. The file is named
    // 51x47, but the site's own CSS sizes .photo and nothing here has looked at
    // it, so a pixel value would be half of a guess. `transform: scale(.5)` is
    // the wrong tool: it leaves the layout box full size, which is the one
    // thing that has to shrink. Chrome has always had zoom; Firefox since 126,
    // and the manifest floor is 128.
    '@media (max-width:500px){#footer #footer-info .logos img{zoom:.5 !important}}'
  ].join('');
  document.documentElement.appendChild(rodape);

  // ---------------------------------------------------------------- the bar
  // One row, 54px, holding both headers' worth of controls. The height is a
  // local constant and is deliberately NOT published: painel.js sizes itself
  // from getBoundingClientRect().top, so nothing downstream has to restate it
  // (unlike ALTURA_RODAPE above, which reserves space it cannot measure).
  var ALTURA_BARRA = 54;

  // The gradient is --nf-grad-chrome from src/shared/tokens.css, written out.
  // THE ONE DELIBERATE COPY of a token: tokens.css is fetched into the shadow
  // roots at document_idle, and this bar has to be the right colour at first
  // paint, in a file that by design depends on nothing. Keep the two in step by
  // hand; nothing else can.
  var GRADIENTE = 'linear-gradient(125deg, #00386c 0%, #0a5ea0 52%, #1486c9 100%)';

  // Two more copies, for the same reason, and both exist so their account pill
  // is typeset EXACTLY like our entity chip beside it: the font stack from
  // src/content/base.css (their page is Arial), and MONO, the stack the 44 key
  // cells use (src/content/registrar.css) and the chip's CNPJ with them — a
  // document number is set in it wherever it appears. Keep them in step by
  // hand.
  var FONTE = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  var MONO = 'ui-monospace, "SFMono-Regular", "Cascadia Mono", Consolas, monospace';

  // Their pill's icon: a person in a circle, the account avatar every site
  // uses, drawn in the chip's own hand — 24-unit viewBox, 2px round stroke, no
  // fill, 17px — so the two pills are one set and differ only in WHAT they
  // show. It is deliberately NOT the gear. Both pills open settings, but a
  // gear on each made two look-alike buttons a few centimetres apart; the
  // gear says "this extension's settings", the person says "your account".
  // Painted as a CSS mask so it takes the pill's colour.
  var PERFIL =
    'url("data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3.5"/>' +
        '<path d="M6.2 19.2a6.5 6.5 0 0 1 11.6 0"/></svg>'
    ) +
    '")';

  var cabecalho = document.createElement('style');
  cabecalho.textContent = [
    // The bar. No `overflow` here — their account dropdown hangs below it.
    '#header{',
    'height:H !important;min-height:H !important;'.replace(/H/g, ALTURA_BARRA + 'px'),
    'box-sizing:border-box !important;padding:0 12px !important;margin:0 0 10px 0 !important;',
    'background:' + GRADIENTE + ' !important;',
    'display:flex !important;align-items:center !important;gap:12px !important;',
    'box-shadow:0 2px 10px rgba(13,38,64,.18) !important}',

    // Their logo, kept exactly where the volunteer expects it and only resized.
    // position:static is the load-bearing part: theirs is `absolute` with
    // z-index 999, which would take it out of the flex row entirely.
    '#header .logo{',
    'position:static !important;z-index:auto !important;flex:0 0 auto !important;',
    'display:flex !important;align-items:center !important;',
    'width:auto !important;height:auto !important;padding:0 !important;margin:0 !important}',
    '#header .logo img{width:38px !important;height:38px !important;display:block !important}',

    // OUR shadow host, mounted here by ui.js. !important because novoShadow
    // writes `all: initial` as an INLINE style, and an important author rule is
    // the only thing that beats one. flex-basis 0 rather than auto: the host
    // must take exactly the space left over by the logo and their user block,
    // never a width derived from its own contents — that is what makes the
    // container queries inside it (registrar.css) describe real available room
    // instead of feeding back on themselves.
    '#nfpr-cabecalho-host{flex:1 1 0% !important;min-width:0 !important;',
    'align-self:stretch !important}',

    // Their user block: the JPEG band goes, the two floated columns become one
    // row pinned to the right, and a hairline separates their controls from
    // ours. The height on #system-info is what gives that hairline its length.
    '#header #system-info{',
    'background:none !important;display:flex !important;align-items:center !important;',
    'flex:0 0 auto !important;min-width:0 !important;height:38px !important;',
    'border-left:1px solid rgba(255,255,255,.28) !important;',
    'padding-left:14px !important;margin-left:6px !important}',
    // Empty on this page (an <h1> around an empty <span>), and carrying a
    // min-width of 677px that would blow the row apart on its own.
    '#header #system-info #page-info{display:none !important}',
    // A GRID, not a row: the name goes ON TOP OF the CPF, in one column, and
    // their "Configurações" is laid UNDER the pair as the button they sit on —
    // the same shape as the entity chip on our half of the bar: one pill, the
    // icon at its left edge, the two-line identity after it. "Sair" is beside it.
    //
    // It used to be three things in a row (name/CPF, a "Configurações" pill,
    // "Sair"), and the identity block was the widest thing in their half while
    // doing nothing when clicked. Now the thing that says who is logged in is
    // the way into that person's account settings, which is where anyone looks
    // for them, and the word "Configurações" is gone from the bar entirely —
    // the profile icon at the pill's left edge says whose settings these are.
    //
    // Side by side the name cost its own full width, fitted only in the top
    // band, and was written as `display:none` plus a `@media (min-width:1200px)`
    // override — which in practice never showed it. That threshold is the
    // CEILING of their fixed-width #container (758 / 982 / 1200 in style.css,
    // the last from a `min-width:1200px` query with nothing above it), so it
    // asked for a viewport as wide as the widest bar that can ever exist while
    // the bar itself gains not one pixel above 1200. Everything hung on a
    // single condition, on the one row where the least room is left over.
    //
    // Stacked, the name costs only what it exceeds the CPF by — at most
    // ~90px — so it fits in every band but the tightest, and it is a plain
    // part of the ladder below instead of an all-or-nothing switch.
    //
    // Their markup is three SIBLINGS (#user-name, #user-log,
    // .user-info-options), with #user-config one level further down. Nothing
    // is moved INTO the anchor, although that is the obvious way to build
    // this, and it is fatal twice over: we move no node (see the banner), and
    // their outside-click closer in layout.js fades the dropdown out on any
    // click whose e.target.id is not `user-config` or `user-config-icone` —
    // so a click landing on a name span moved inside the anchor would open the
    // dropdown and shut it again in the same event.
    //
    // So it is done by OVERLAP: .user-info-options becomes `display:contents`,
    // which makes #user-config a grid item of #user-info, and the anchor is
    // placed in the same cell as the name and the CPF. The two spans are
    // painted above it (z-index) and are transparent to the pointer
    // (pointer-events:none), so every click on the pill — text, icon or
    // padding — has #user-config or its icon as its target, exactly as their
    // handler requires, and :hover lights the whole pill. `display` on
    // .user-info-options is allowed; it is .user-config-options that must
    // never have one declared.
    //
    // Explicit placement, so a page that renders no #user-name (their template
    // leaves the span out) collapses row 1 to nothing instead of leaving the
    // CPF hanging under a gap.
    '#header #system-info #user-info{',
    'background:none !important;float:none !important;clear:none !important;',
    'display:grid !important;grid-template-columns:auto auto !important;',
    'align-items:center !important;column-gap:8px !important;row-gap:0 !important;',
    'width:auto !important;min-width:0 !important;height:auto !important;',
    'margin:0 !important;padding:0 !important;color:#fff !important;',
    // Kept relative on purpose: their account dropdown is absolutely positioned
    // against this box, so this is what stops it landing against the viewport.
    'position:relative !important;font-size:13px !important;line-height:1.2 !important}',
    // Capped and ellipsized rather than left to its own content. #system-info
    // is flex:0 0 auto and our host is flex:1 1 0%, so every pixel their block
    // takes comes straight out of our strip — an unusually long name would
    // otherwise push our container queries into collapsing the chip on the
    // widest screen there is. 200px fits ~28 uppercase characters at 12px
    // bold (measured: a 26-character name is 181px, which 180 cut by a pixel).
    //
    // The two lines are typeset like the chip's — the name bold on top, the
    // number lighter under it — so the two pills read as one family. The
    // margins are the pill's own padding: 16px on the right — the chip's
    // `1em` as it actually resolves (see registrar.css), written out because
    // this anchor's font-size is 0 and an em here would be nothing — and on
    // the left the pill's 12px plus the 17px icon
    // plus the chip's 9px gap. They are
    // MARGINS rather than padding because the grid sizes the column from them,
    // which is what makes the pill exactly as wide as the longer line needs.
    '#header #system-info #user-info #user-name,',
    '#header #system-info #user-info #user-log{',
    'position:relative !important;z-index:1 !important;pointer-events:none !important;',
    'margin:0 16px 0 38px !important;padding:0 !important;',
    'float:none !important;clear:none !important;font-family:' + FONTE + ' !important;',
    'white-space:nowrap !important;line-height:1.15 !important;color:#fff !important;',
    'transition:transform .05s ease !important}',
    '#header #system-info #user-info #user-name{',
    'grid-area:1 / 1 / 2 / 2 !important;align-self:end !important;display:block !important;',
    'max-width:200px !important;min-width:0 !important;overflow:hidden !important;',
    'text-overflow:ellipsis !important;',
    'font-size:12px !important;font-weight:700 !important;opacity:1 !important}',
    // The CPF is the line that survives every collapse: it identifies the
    // volunteer in less than half the width, and it is the number they check
    // against a screen. So the NAME is what the ladder drops first.
    '@media (max-width:767px){#header #system-info #user-info #user-name{',
    'display:none !important}}',
    '#header #system-info #user-info #user-log{',
    'grid-area:2 / 1 / 3 / 2 !important;align-self:start !important;display:block !important;',
    // Monospace, like the chip's CNPJ and the key cells: every digit its own
    // column, which is what someone checking a number against a screen reads.
    'font-family:' + MONO + ' !important;',
    'font-size:11.5px !important;font-weight:600 !important;opacity:.82 !important;',
    'font-variant-numeric:normal !important}',
    // WITH NO NAME ABOVE IT, THE CPF TAKES BOTH ROWS. Not cosmetic: the pill is
    // 38px and spans rows 1-2, and a spanning item hands its leftover height
    // to the rows it crosses — so an EMPTY row 1 still grows to ~12px and
    // drops the CPF into the bottom half of the pill, a line that should be
    // centred sitting visibly low. Left in row 2 it cannot be fixed by
    // alignment: the row is where it is, and it is the row that is wrong.
    //
    // Two ways the name goes missing, and both need saying. The ladder hides
    // it below 768px, which leaves the span in place as a first child that no
    // longer occupies row 1; and their template renders the block with no
    // #user-name at all, which is what `:first-child` catches — written as a
    // selector rather than a script because it has to hold from first paint.
    '@media (max-width:767px){#header #system-info #user-info #user-log{',
    'grid-area:1 / 1 / 3 / 2 !important;align-self:center !important}}',
    '#header #system-info #user-info #user-log:first-child{',
    'grid-area:1 / 1 / 3 / 2 !important;align-self:center !important}',
    // THE DUPLICATE-SESSION SCREEN RENDERS NO CONTROLS. Same URL, same header,
    // but their template comments out #user-config and its dropdown and leaves
    // #user-logout out entirely, so .user-info-options arrives empty and the
    // name and CPF are all there is. Everything above still applies and would
    // lay out a pill that is not there: the two lines keep the margins that
    // make room for its icon and padding (38px of blank before the text, 16px
    // after), and the "Sair" column keeps its column-gap with nothing in it.
    //
    // So each half is keyed to its own control being PRESENT, separately —
    // nothing says they come and go together. Without the pill the two lines
    // are plain text flush against the hairline, like any label; they must
    // not be dressed as a pill, because a pill in this bar means "click me"
    // and there is nothing to click. `:has()` rather than a script for the
    // same reason as `:first-child` above: it holds from first paint.
    '#header #system-info #user-info:not(:has(#user-config)) #user-name,',
    '#header #system-info #user-info:not(:has(#user-config)) #user-log{',
    'margin:0 !important}',
    '#header #system-info #user-info:not(:has(#user-logout)){',
    'grid-template-columns:auto !important;column-gap:0 !important}',
    '#header #system-info #user-info .user-info-options{',
    'display:contents !important;float:none !important}',
    // THE PILL. It sits under the two lines and stretches to their column; its
    // own label is a bare text node beside the icon <span>, and font-size:0 is
    // the only way to drop one — the icon then gets its size back explicitly.
    // The icon is pinned to the LEFT edge, where the chip keeps its gear.
    '#header #system-info #user-info #user-config{',
    'grid-area:1 / 1 / 3 / 2 !important;justify-self:stretch !important;',
    'align-self:center !important;justify-content:flex-start !important;',
    'margin:0 !important;padding:0 12px !important;min-width:38px !important;',
    'box-sizing:border-box !important;font-size:0 !important;gap:0 !important;',
    'cursor:pointer !important}',
    // "Sair" stays a pill of its own. A way off a shared machine must not be
    // folded into anything.
    '#header #system-info #user-info #user-logout{',
    'grid-area:1 / 2 / 3 / 3 !important;align-self:center !important;',
    'margin:0 !important;padding:0 13px !important;gap:7px !important;',
    'font-family:' + FONTE + ' !important;font-size:13px !important;font-weight:600 !important}',
    '#header #system-info #user-info #user-config,',
    '#header #system-info #user-info #user-logout{',
    'display:inline-flex !important;align-items:center !important;',
    'height:38px !important;border-radius:999px !important;',
    'background:rgba(255,255,255,.14) !important;color:#fff !important;',
    'text-decoration:none !important;',
    'white-space:nowrap !important;border:0 !important;box-shadow:none !important;',
    'transition:background .15s ease, transform .05s ease !important}',
    '#header #system-info #user-info #user-config:hover,',
    '#header #system-info #user-info #user-logout:hover{',
    'background:rgba(255,255,255,.26) !important;text-decoration:none !important}',
    '#header #system-info #user-info #user-config:focus-visible,',
    '#header #system-info #user-info #user-logout:focus-visible{',
    'outline:2px solid #fff !important;outline-offset:2px !important}',
    // The press, as the chip does it. The two lines are separate grid items
    // painted over the anchor rather than inside it, so they only move with
    // it because :has() says so.
    '#header #system-info #user-info #user-config:active,',
    '#header #system-info #user-info:has(#user-config:active) #user-name,',
    '#header #system-info #user-info:has(#user-config:active) #user-log{',
    'transform:translateY(1px) !important}',
    '#header #system-info #user-info #user-logout .fa{',
    'font-size:14px !important;opacity:.9 !important}',
    // Their FontAwesome gear becomes the profile icon, at the chip's size: the
    // glyph is emptied and the span is painted through a mask in currentColor. The
    // span itself stays, id and all — their outside-click closer whitelists
    // `user-config-icone` as a click target, and it must go on being one.
    '#header #system-info #user-info #user-config .fa{',
    'display:block !important;flex:0 0 auto !important;',
    'width:17px !important;height:17px !important;opacity:.9 !important;',
    'background-color:currentColor !important;',
    '-webkit-mask:' + PERFIL + ' center / contain no-repeat !important;',
    'mask:' + PERFIL + ' center / contain no-repeat !important}',
    '#header #system-info #user-info #user-config .fa::before{',
    'content:none !important}',

    // Their account dropdown. It hangs off #user-info, which now sits at the
    // right edge, so their left:64px would put it off the screen. `display` is
    // never touched here — jQuery's fadeIn writes it inline, and an !important
    // rule would freeze the dropdown open or shut for the life of the page.
    '.user-config-options{',
    'left:auto !important;right:0 !important;top:calc(100% + 8px) !important;',
    'margin:0 !important;border-radius:10px !important}',

    // The last two collapses. The name went at 767px (above). Next is the
    // "Sair" label, which keeps its icon and its hit area — font-size:0 again,
    // for the same bare-text-node reason as the pill's own label — and last,
    // on the narrowest phones, the CPF (below this block).
    //
    // These are viewport media queries and cannot be container queries: they
    // style THEIR elements, whose nearest container would have to be #header
    // itself, which means putting `contain` on a box we do not own. The
    // thresholds account for #container being FIXED-width per breakpoint
    // (758/982/1200), so a bar this narrow only happens below 768px, where the
    // container IS the viewport.
    '@media (max-width:440px){',
    '#header{padding:0 8px !important;gap:8px !important}',
    '#header .logo img{width:32px !important;height:32px !important}',
    '#header #system-info{padding-left:10px !important;margin-left:2px !important}',
    '#header #system-info #user-info{column-gap:6px !important}',
    '#header #system-info #user-info #user-logout{',
    'font-size:0 !important;gap:0 !important;padding:0 !important;',
    'width:38px !important;justify-content:center !important}}',
    // And below that, the CPF. Measured on the saved page at 400px: their
    // block is 197.5px with a 88.5px CPF in Consolas (~97px in Cascadia Mono),
    // so our half gets the viewport less ~264-272px, and it needs 85px at its
    // smallest (the icon-only Início link, the gap, the gear-only chip). That
    // runs out at ~349px in Consolas and ~357px in Cascadia; 360 — the
    // narrowest common phone above 320 — keeps it. Below, the pill becomes the
    // profile icon alone, a 38px circle like "Sair" beside it and our gear.
    //
    // Only while the pill is there. On the duplicate-session screen the name
    // and CPF are plain text and all their half holds, and it is narrower with
    // nothing else beside it — hiding it would leave a hairline in front of
    // nothing.
    '@media (max-width:359px){',
    '#header #system-info #user-info:has(#user-config) #user-log{display:none !important}',
    '#header #system-info #user-info #user-config{',
    'width:38px !important;min-width:0 !important;padding:0 !important;',
    'justify-content:center !important}}'
  ].join('');
  document.documentElement.appendChild(cabecalho);

  var revelado = false;
  function revelar() {
    if (revelado) return;
    revelado = true;
    estilo.remove();
  }

  setTimeout(revelar, 4000);

  root.__nfprHostPage = { revelar: revelar, alturaRodape: ALTURA_RODAPE };
})(typeof globalThis !== 'undefined' ? globalThis : self);
