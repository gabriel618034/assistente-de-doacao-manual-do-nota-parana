/**
 * sec-preferencias.js  (settings section)
 * -----------------------------------------------------------------------------
 * The "Preferências" card: eight toggles in four named blocks — Comportamento,
 * Sons, Tela, Envio — each persisting a one-key patch.
 *
 * THE BLOCKS ARE SHAPE, NOT BEHAVIOUR. Nothing was deleted, merged or
 * defaulted differently when they arrived; seven unlabelled switches in one
 * column simply gave a volunteer no way to find the one they came for. The
 * three sound toggles in particular stay three: turning one off must never
 * silence another.
 *
 * The sound set is ordered by the moment each fires — read, registered,
 * something wrong. They are worded together on purpose: see the comment beside
 * them.
 *
 * One of three sections composed by settings-ui.js. Each is a factory returning
 * { elemento, render(cfg) }: it builds its static skeleton once and repaints
 * only what comes from storage, so an update from another surface can never
 * wipe what the volunteer is mid-typing.
 *
 * Every write goes through Config.atualizarConfig — never a whole-object
 * overwrite (see config.js).
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  var NFPR = (root.NFPR = root.NFPR || {});
  var Config = NFPR.Config;
  var el = NFPR.el; // shared DOM builder (src/shared/dom.js)

  NFPR.secaoPreferencias = function secaoPreferencias(opcoes) {
    opcoes = opcoes || {};

    // --- Preferences -----------------------------------------------------------
    function toggle(id, rotulo, descricao) {
      var input = el('input', { type: 'checkbox', class: 'nfpr-switch-input', id: id });
      var sw = el('label', { class: 'nfpr-switch', attrs: { for: id } }, [
        input,
        el('span', { class: 'nfpr-switch-track' }, [el('span', { class: 'nfpr-switch-thumb' })])
      ]);
      var linha = el('div', { class: 'nfpr-pref' }, [
        el('div', { class: 'nfpr-pref-text' }, [
          el('span', { class: 'nfpr-pref-label', text: rotulo }),
          descricao ? el('span', { class: 'nfpr-pref-desc', text: descricao }) : null
        ]),
        sw
      ]);
      return { linha: linha, input: input };
    }

    // THE THREE SOUND TOGGLES READ AS A SET, in the order the volunteer meets
    // them: the key is read, the site registers it, something goes wrong. They
    // were two before ("Sons de alerta" / "Sons de confirmação"), and adding a
    // third line to that pair would have left the middle one still called
    // "confirmação" while two of the three confirm something. Each label now
    // names the MOMENT it fires, which is the only thing that tells them apart.
    var prefSomLeitura = toggle(
      'nfpr-pref-som-leitura',
      'Som ao ler a chave',
      'Toca quando uma chave é lida e aprovada nas verificações do assistente.'
    );
    var prefSomSucesso = toggle(
      'nfpr-pref-som-sucesso',
      'Som ao registrar a doação',
      'Toca quando o Nota Paraná confirma o registro.'
    );
    var prefSomAlerta = toggle(
      'nfpr-pref-som-alerta',
      'Sons de aviso e de erro',
      'Tocam em caso de erro, de aviso ou de chave repetida.'
    );
    // "ao escanear" was never the whole truth — it fires at the top of
    // aceitar(), before any branch, so it flashes on a typed key and on a
    // refusal exactly as it does on a good read. That is the point: it confirms
    // something reached the end of submission, whatever the verdict, and it is
    // the only feedback that works with the sound off.
    var prefPiscar = toggle(
      'nfpr-pref-piscar',
      'Piscar a tela',
      'A tela pisca a cada chave enviada, seja ela digitada ou escaneada.'
    );
    // THE FIXED PART STRIP, AND THE FIXED PARTS WITH IT. On by default; a
    // fixed part is a typist's tool and the volunteer holding a scanner never
    // types a digit, so for them the line under the cells, its popover and its
    // editor are clutter they can switch off. Turning it off does not merely hide the
    // strip — no fixed part applies either (config.js), because the one-click
    // way out of an armed fixed part lives on the strip that would no longer be
    // there.
    //
    // The label is the feature's NAME, the same one Ajuda and the strip's list
    // use, and the description says what the volunteer does: they write the
    // repeated start once and type the rest of every note. See *Words for the
    // fixed part* in CLAUDE.md.
    var prefPartesFixas = toggle(
      'nfpr-pref-partes-fixas',
      'Parte fixa da chave',
      'Para quem digita as chaves. Quando várias chaves começam da mesma forma, escreva o começo uma vez; em cada nota, digite o restante.'
    );
    var prefAuto = toggle(
      'nfpr-pref-auto',
      'Enviar automaticamente ao completar a chave',
      'Dispensa o Enter: a chave é enviada assim que os 44 caracteres forem preenchidos.'
    );
    // Default OFF, and the description has to be honest about what it removes
    // rather than sell it: with this on the assistant stops refusing anything,
    // so a mistyped key reaches the government's server exactly as it would
    // from the official page. The volunteer who wants that wants it for
    // accountability — "the extension decided not to send it" is not a defence
    // anyone wants to give — so the wording says who decides, not who is right.
    var prefSemValidar = toggle(
      'nfpr-pref-sem-validar',
      'Enviar sem verificação prévia',
      'Todas as chaves são enviadas ao Nota Paraná, inclusive as que o assistente recusaria. A decisão cabe ao ' +
        'servidor, como na página oficial. Os avisos do assistente continuam sendo exibidos.'
    );
    var prefEncerrarSessoes = toggle(
      'nfpr-pref-encerrar-sessoes',
      'Encerrar sessões duplicadas automaticamente',
      'Quando o Nota Paraná bloquear o envio porque sua conta está aberta em mais de um lugar, todas as sessões são encerradas imediatamente.'
    );

    prefSomAlerta.input.addEventListener('change', function () {
      Config.atualizarConfig({ preferencias: { somAlerta: prefSomAlerta.input.checked } });
    });
    prefSomLeitura.input.addEventListener('change', function () {
      Config.atualizarConfig({ preferencias: { somLeitura: prefSomLeitura.input.checked } });
    });
    prefSomSucesso.input.addEventListener('change', function () {
      Config.atualizarConfig({ preferencias: { somSucesso: prefSomSucesso.input.checked } });
    });
    // TOUCHING THE SWITCH ANSWERS THE OFFER, whichever way it is moved. The
    // line under the cells exists only to tell a typist the option is there;
    // someone who has just worked the switch knows, so it stamps
    // `dicaPartesFixasEm` alongside — including when they turn fixed parts OFF
    // again, which is the clearest possible statement that they were told. Like
    // every other answer it expires (Config.PRAZO_DICA_PARTES_FIXAS), so the
    // next volunteer at a shared machine is not bound by this one's decision.
    //
    // It does NOT clear `parteFixaAtivaId` the way the offer's own "Ativar"
    // does. This is somebody who knows what a fixed part is turning their own
    // one back on, and finding it still armed is the point; over there it is
    // somebody being introduced to the feature, for whom a stranger's fixed
    // part filling the cells reads as a fault.
    prefPartesFixas.input.addEventListener('change', function () {
      Config.atualizarConfig({
        preferencias: { partesFixas: prefPartesFixas.input.checked, dicaPartesFixasEm: Date.now() }
      });
    });
    prefPiscar.input.addEventListener('change', function () {
      Config.atualizarConfig({ preferencias: { piscar: prefPiscar.input.checked } });
    });
    prefAuto.input.addEventListener('change', function () {
      Config.atualizarConfig({ preferencias: { autoEnviar: prefAuto.input.checked } });
    });
    prefSemValidar.input.addEventListener('change', function () {
      Config.atualizarConfig({ preferencias: { enviarSemValidar: prefSemValidar.input.checked } });
    });
    prefEncerrarSessoes.input.addEventListener('change', function () {
      Config.atualizarConfig({ preferencias: { encerrarSessoesDuplicadas: prefEncerrarSessoes.input.checked } });
    });

    function bloco(titulo, linhas) {
      return el('div', { class: 'nfpr-pref-bloco' }, [
        el('h3', { class: 'nfpr-pref-bloco-titulo', text: titulo })
      ].concat(linhas));
    }

    var secPref = el('section', { class: 'nfpr-card' }, [
      el('div', { class: 'nfpr-card-head' }, [
        el('h2', { class: 'nfpr-card-title', text: 'Preferências' })
      ]),
      bloco('Comportamento', [prefEncerrarSessoes.linha, prefPartesFixas.linha]),
      bloco('Sons', [prefSomLeitura.linha, prefSomSucesso.linha, prefSomAlerta.linha]),
      bloco('Tela', [prefPiscar.linha]),
      bloco('Envio', [prefAuto.linha, prefSemValidar.linha])
    ]);

    function render(cfg) {
      prefSomAlerta.input.checked = cfg.preferencias.somAlerta !== false;
      prefSomLeitura.input.checked = !!cfg.preferencias.somLeitura;
      prefSomSucesso.input.checked = !!cfg.preferencias.somSucesso;
      prefPartesFixas.input.checked = cfg.preferencias.partesFixas === true;
      prefPiscar.input.checked = cfg.preferencias.piscar !== false;
      prefAuto.input.checked = !!cfg.preferencias.autoEnviar;
      prefSemValidar.input.checked = cfg.preferencias.enviarSemValidar === true;
      prefEncerrarSessoes.input.checked = cfg.preferencias.encerrarSessoesDuplicadas !== false;
    }

    return { elemento: secPref, render: render };
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
