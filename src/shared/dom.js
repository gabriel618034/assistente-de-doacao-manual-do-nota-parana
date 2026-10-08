/**
 * dom.js  (shared)
 * -----------------------------------------------------------------------------
 * NFPR.el — the one tiny DOM builder used by every NFPR surface.
 *
 *   el('button', { class: 'x', text: 'Ok', onClick: fn }, [children])
 *
 * Recognised props:
 *   class   -> className
 *   text    -> textContent (always safe)
 *   html    -> innerHTML   (TRUSTED STATIC MARKUP ONLY — never server/user data)
 *   attrs   -> setAttribute for each key
 *   onXxx   -> addEventListener('xxx', fn)
 *   anything else -> direct property assignment
 *
 * Children may be elements, strings (become text nodes), or null (skipped).
 *
 * Also holds NFPR.iconeMarca(classe) — the one definition of the brand mark,
 * used by the offline registrar's head, the modal header and the toolbar popup.
 *
 * ...and NFPR.agruparChave(chave), which spaces 44 digits into fours so a human
 * can read one off the screen and match it against a printed receipt. It lives
 * here for the same reason the brand mark does: the registrar's rows and the
 * "erros desconhecidos" page both show keys, and two copies of a formatting
 * rule drift.
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  const NFPR = (root.NFPR = root.NFPR || {});

  NFPR.el = function el(tag, props, filhos) {
    const n = document.createElement(tag);
    for (const k of Object.keys(props || {})) {
      const v = props[k];
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'attrs') {
        for (const a of Object.keys(v)) n.setAttribute(a, v[a]);
      } else if (k.startsWith('on') && typeof v === 'function') {
        n.addEventListener(k.slice(2).toLowerCase(), v);
      } else {
        n[k] = v;
      }
    }
    for (const c of filhos || []) {
      if (c == null) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  };

  /**
   * The brand mark: the extension's own icon (icons/, sources in tools/icone/),
   * the same picture the toolbar and the stores show. It is a full-colour tile
   * with its own rounded corners, so the surfaces show it bare, with no frame
   * of their own. 48px at 1x, 128px on dense screens — the 16 and 32 are
   * simplified for the toolbar and read worse at this size. Decorative, hence
   * the empty alt; the title beside it says the same thing in words.
   */
  NFPR.iconeMarca = (classe) =>
    NFPR.el('img', {
      class: classe,
      src: NFPR.url('icons/icon-48.png'),
      srcset: NFPR.url('icons/icon-48.png') + ' 1x, ' + NFPR.url('icons/icon-128.png') + ' 2x',
      alt: '',
      draggable: false
    });

  /**
   * 44 digits, spaced in fours. The only job is legibility: the volunteer is
   * comparing what is on screen against what is printed on a creased receipt,
   * and an unbroken run of 44 characters is the hardest possible thing to check
   * a digit at a time.
   */
  NFPR.agruparChave = (chave) => String(chave).replace(/(.{4})(?=.)/g, '$1 ');
})(typeof globalThis !== 'undefined' ? globalThis : self);
