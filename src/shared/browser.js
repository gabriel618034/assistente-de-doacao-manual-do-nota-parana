/**
 * browser.js
 * -----------------------------------------------------------------------------
 * Cross-browser API shim and the single shared namespace (NFPR).
 *
 * Chrome/Edge expose `chrome.*`; Firefox exposes both `browser.*` (promises) and
 * `chrome.*` (callbacks). Modern Chrome MV3 also returns promises from `chrome.*`
 * when no callback is given, so awaiting `api.storage.local.get(...)` works in
 * every supported browser.
 *
 * This file MUST be loaded before any other NFPR file. In content scripts it
 * runs in the isolated world, so attaching to `globalThis` never leaks to the
 * host page. In the popup it attaches to the popup window. Same code, both work.
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  // Every context this file runs in is an extension context, so one of the two
  // globals is always present — no third fallback branch is reachable.
  const api = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;

  const NFPR = (root.NFPR = root.NFPR || {});
  NFPR.api = api;

  // Resolve an extension-internal URL (icons, CSS injected into the shadow DOM).
  NFPR.url = (caminho) => api.runtime.getURL(caminho);
})(typeof globalThis !== 'undefined' ? globalThis : self);
