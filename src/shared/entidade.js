/**
 * entidade.js  (shared)
 * -----------------------------------------------------------------------------
 * Confirms an institution by CNPJ against the official Nota Paraná endpoint, so
 * we can show the real entity name and only save CNPJs that are actually
 * registered to receive donations.
 *
 *   GET .../app/v1/documentoFiscalDoado/entidadePorCnpj/<cnpj>
 *   -> { idEntidade, nmEmpresarial, nmFantasia, nmMunicipio, cnpj, cnpjFormatado, ... }
 *
 * From the on-page modal (content script) this is a SAME-ORIGIN, authenticated
 * request. From the toolbar popup it is cross-origin and needs the app/v1 host
 * permission declared in the manifest; if that fails (offline, logged out), the
 * caller falls back to local validation (motivo 'INDISPONIVEL'/'SESSAO').
 *
 * salvar() below is the single place an entity is persisted, so the settings
 * form and the site's own search dialog cannot drift apart again. It needs
 * NFPR.Config, hence this file now loads AFTER config.js in all three loaders.
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  const NFPR = (root.NFPR = root.NFPR || {});

  /**
   * consultar(cnpj) -> Promise<resultado>
   *   { ok: true,  entidade: { idEntidade, nmEmpresarial, nmFantasia, municipio,
   *                            cnpj, cnpjFormatado } }
   *   { ok: false, motivo: 'CNPJ_INVALIDO' | 'NAO_ENCONTRADA' | 'SESSAO' | 'INDISPONIVEL' }
   *
   * NAO_ENCONTRADA NEEDS THE REGISTRY TO HAVE SAID SO. It is the one answer
   * with consequences — content.js latches the entity as refused and parks the
   * queue behind "não aceita doações", and salvar() refuses to save it.
   *
   * WHAT THE REGISTRY SAYS IS 204 NO CONTENT, an empty body (observed
   * 2026-09-29, for 00000000000191). It is not a 404, whatever DOCS.md once
   * claimed: that line was never an observation, and the old code only got
   * the 204 right by accident — `resp.ok` is true for it, `json()` then failed
   * on the empty body, and a failed parse happened to mean "not found". A 404
   * is still read the same way; it has never been seen and says the same
   * thing if it ever comes.
   *
   * Anything else that does not hold an entity — a 200 whose body will not
   * parse or carries no entity — is the registry failing to answer
   * (maintenance, a duplicate session, an HTML error page served as 200) and
   * is INDISPONIVEL: the entity is kept unverified and asked about again on the
   * next load. That is why the 204 is matched by STATUS, before any parse: a
   * parse failure alone cannot tell the two apart.
   */
  async function consultar(cnpj) {
    const limpo = NFPR.Cnpj.limpar(cnpj);
    if (limpo.length !== 14) return { ok: false, motivo: 'CNPJ_INVALIDO' };

    // The deadline covers the body too: the settings form sits on a disabled
    // "Verificando…" until this settles, and nothing else ever settled it.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), NFPR.Site.PRAZO_RESPOSTA_MS);
    let resp, dados;
    try {
      try {
        resp = await fetch(NFPR.Site.URL_ENTIDADE_POR_CNPJ + limpo, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
          signal: ctl.signal
        });
      } catch {
        // Network failure, a timeout, or a cross-origin block from the popup.
        return { ok: false, motivo: 'INDISPONIVEL' };
      }

      if (resp.redirected && /login/i.test(resp.url)) return { ok: false, motivo: 'SESSAO' };
      if (resp.status === 204 || resp.status === 404) return { ok: false, motivo: 'NAO_ENCONTRADA' };
      if (!resp.ok) return { ok: false, motivo: 'INDISPONIVEL' };

      try {
        dados = await resp.json();
      } catch {
        return { ok: false, motivo: 'INDISPONIVEL' };
      }
    } finally {
      clearTimeout(timer);
    }
    if (!dados || (!dados.idEntidade && !dados.nmEmpresarial && !dados.cnpj)) {
      return { ok: false, motivo: 'INDISPONIVEL' };
    }

    return {
      ok: true,
      entidade: {
        idEntidade: dados.idEntidade || null,
        nmEmpresarial: dados.nmEmpresarial || '',
        nmFantasia: dados.nmFantasia || '',
        municipio: dados.nmMunicipio || '',
        cnpj: limpo,
        cnpjFormatado: dados.cnpjFormatado || NFPR.Cnpj.formatar(limpo)
      }
    };
  }

  /**
   * Persist an entity, applying the ONE set of rules both entry points obey:
   *
   *   - a CNPJ already stored            -> 'duplicada', never a second copy
   *   - the registry says it is NOT an entity -> 'nao_registrada', refused
   *   - the registry could not be reached at all -> saved, verificada: false
   *   - otherwise                        -> saved with the official name and
   *                                         municipality, verificada: true
   *
   * An unverified entity is saved with a blank name (or the site's own, when
   * it came from the site's search dialog) until completarNomes fills it.
   *
   * The entity just saved becomes the active one, every time — not only the
   * first. See the write below for why.
   *
   * The settings form and the site's own search dialog used to implement all of
   * this separately and disagreed on the second rule — the dialog saved
   * unregistered CNPJs anyway — while building the same eight-field record two
   * different ways.
   *
   * salvar(cnpj, { nomeHint, consulta }) -> { estado, entidade }
   *   nomeHint a name scraped from the site's own search results; used only
   *            when the registry could not be asked
   *   consulta a lookup result the caller already has, to avoid querying twice
   *
   * THE NAME IS NEVER TYPED. It comes from the server or it is blank, and a
   * blank one is shown as the CNPJ alone. A typed name used to win over the
   * official one, so the chip could say "doando para AMARAS" over a CNPJ that
   * belonged to someone else — the one place a volunteer checks where the
   * notes are going, vouching for a target nobody had verified. The CNPJ is
   * the target; a name is only ever the registry's description of it, filled
   * in by completarNomes the first time the registry answers.
   */
  async function salvar(cnpj, opcoes) {
    opcoes = opcoes || {};
    const limpo = NFPR.Cnpj.limpar(cnpj);
    const res = opcoes.consulta || (await consultar(limpo));
    if (!res.ok && res.motivo === 'NAO_ENCONTRADA') return { estado: 'nao_registrada' };

    const oficial = res.ok ? res.entidade : null;
    const nova = Object.assign(
      { id: NFPR.Config.gerarId(), cnpj: limpo },
      oficial ? dadosOficiais(oficial) : {
        nome: (opcoes.nomeHint || '').trim(),
        idEntidade: null,
        nmEmpresarial: '',
        nmFantasia: '',
        municipio: '',
        verificada: false
      }
    );

    // The duplicate check runs INSIDE the write, because the lookup above may
    // have been a full network round trip during which another surface could
    // have saved the same CNPJ.
    let estado = 'salva';
    await NFPR.Config.atualizarConfig((cfg) => {
      if (cfg.entidades.some((i) => i.cnpj === limpo)) {
        estado = 'duplicada';
        return null;
      }
      return {
        entidades: cfg.entidades.concat([nova]),
        // THE ONE JUST ADDED BECOMES ACTIVE, always — the same rule fixed part
        // creation already follows. It used to activate only the first one
        // ever saved, so adding a second entity looked like nothing happened:
        // the chip still named the old one, and the next note went to it.
        // Nobody adds an entity they did not mean to donate to next.
        //
        // Safe against the frozen-target rule: switching the active entity has
        // never retargeted a queued note, and does not here — those carry the
        // CNPJ they were scanned with.
        entidadeAtivaId: nova.id
      };
    });

    return { estado, entidade: nova };
  }

  // The fields a registry answer writes onto a stored entity — the same ones
  // whether it answered at save time or on a later load.
  function dadosOficiais(oficial) {
    return {
      nome: oficial.nmFantasia || oficial.nmEmpresarial || '',
      idEntidade: oficial.idEntidade,
      nmEmpresarial: oficial.nmEmpresarial,
      nmFantasia: oficial.nmFantasia,
      municipio: oficial.municipio,
      verificada: true
    };
  }

  /**
   * Ask the registry about every entity saved WITHOUT its answer (offline, the
   * popup cross-origin, a lapsed login), and write the official name onto each
   * one it confirms. Until then that entity is shown by its CNPJ alone.
   *
   * completarNomes() -> Promise<{ [cnpj]: resultado }>
   *   Every lookup made, keyed by CNPJ, so a caller that needs a verdict on one
   *   of them (content.js, on the active target) does not ask twice.
   *
   * Only a confirmation writes anything. NAO_ENCONTRADA is left for content.js
   * to latch, and "could not ask" changes nothing — the next load asks again.
   * Matched by CNPJ inside the write, because the entity may have been removed
   * or re-added while the lookups were in flight.
   */
  async function completarNomes() {
    const cfg = await NFPR.Config.obterConfig();
    const pendentes = cfg.entidades.filter((e) => e.cnpj && !e.verificada);
    const resultados = {};
    await Promise.all(pendentes.map(async (e) => {
      resultados[e.cnpj] = await consultar(e.cnpj);
    }));
    const confirmadas = Object.keys(resultados).filter((c) => resultados[c].ok);
    if (confirmadas.length) {
      await NFPR.Config.atualizarConfig((c) => {
        let mudou = false;
        const entidades = c.entidades.map((e) => {
          const r = resultados[e.cnpj];
          if (e.verificada || !r || !r.ok) return e;
          mudou = true;
          return Object.assign({}, e, dadosOficiais(r.entidade));
        });
        return mudou ? { entidades } : null;
      });
    }
    return resultados;
  }

  NFPR.Entidade = { consultar, salvar, completarNomes };
})(typeof globalThis !== 'undefined' ? globalThis : self);
