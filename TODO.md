# TODO

Work that is wanted and not built. Nothing here is committed to — delete an
entry freely if it turns out not to be wanted.

`DOCS.md` describes what runs. `CLAUDE.md` holds the load-bearing decisions.
This file is the only place that describes what does *not* exist yet; keep it
that way, so a reader can always tell the three apart. Finished work moves to
*Done* at the bottom and stays there until the maintainer says to delete it —
nobody else clears that section.

Each entry names the files it touches. That is the point of the format: a
session should be able to start editing without re-deriving where the thing
lives, and the **Why** should survive long enough that nobody "simplifies" the
reason away.

---

## The order to chew through them

A sequencing view of everything below — the entries keep their own sections
(*Broken* / *Wanted*), because what is wrong and what is merely wanted stay
different questions. This list answers *next*.

**Nothing here is numbered, on purpose — not the items, not the phases.** The
order is simply the order things appear, items are referred to by NAME elsewhere
in this file, and the phases carry PLACEHOLDER names that mean nothing at all
(Cobalt, Juniper, Marlin… — never Greek letters, which smuggle the order back
in).

Both were numbered once and both went stale the same way. Finishing an item or
discovering an urgent one forced a choice between renumbering, which silently
breaks every cross-reference written earlier, and keeping the old numbers, which
is how this list briefly ran 1, 2, 3, 4, 13, 14, 5. A phase called "Phase 3" has
the same defect one level up: it claims a position, so the day something jumps
the queue the name is a lie. "Phase Marlin" cannot be wrong about where it sits.
Reorder anything freely; nothing else needs updating.

A ticked box records progress inside a phase still being worked; a finished
item moves to *Done*.

Three rules produce the order: do first the things that get **more expensive
the longer they wait**; then the cheap independent wins; then any arc whose
parts are interlocked; then whatever is blocked on a decision nobody has made
yet. Anything that destroys work already done jumps all of it.

Every fix lands with a `smoke.js` assertion, checked by reverting the fix and
watching it fail. The 2026-09-29 audit's mutation pass showed that half of what
`smoke.js` was said to pin, it did not.

No phase is open.

---

## Broken — things that are wrong in the current build

Nothing open. (Kept as a heading: this is where the next one goes.)

---

## Wanted — decided, just not built

Nothing open. (Kept as a heading: this is where the next one goes.)

---

## Unshaped

Ideas with no agreed shape. Not scheduled; here so they are not re-invented.

Nothing open. (Kept as a heading: this is where the next one goes.)

---

## Open questions that were never answered

Nothing open. (Kept as a heading: this is where the next one goes.)

---

## Done — waiting to be deleted

Finished work lands here with its reasoning, and leaves only when the
maintainer says so.

Nothing waiting. (Kept as a heading: this is where the next one goes.)
