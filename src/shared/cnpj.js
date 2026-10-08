/**
 * cnpj.js
 * -----------------------------------------------------------------------------
 * Brazilian issuer-document check digits: strip, format, and validate.
 * Used so a volunteer can paste any institution CNPJ and get instant feedback,
 * and by chave.js to judge the issuer embedded in an access key.
 * Pure functions — no DOM, no storage.
 *
 * CNPJ is still this module's subject — limpar and formatar are CNPJ-only — but
 * validarCpf lives here too. A note issued by a pessoa física carries a CPF
 * where the key otherwise carries a CNPJ (see analisarChave in chave.js), so
 * the two are always needed together. Eleven lines of the same módulo-11
 * arithmetic did not justify a fourth <script> line in three separate files.
 *
 * THE CNPJ IS ALPHANUMERIC (IN RFB 2.229/2024, in production since 07/2026).
 * Fourteen characters still, but the first TWELVE may hold uppercase letters —
 * the last two stay numeric, because they are the check digits this file
 * computes. The arithmetic did not change: the same weights, the same módulo
 * 11, over each character's ASCII value MINUS 48. That mapping is a no-op on
 * digits ('5' is 53, 53 - 48 = 5) and gives A = 17 … Z = 42, so every numeric
 * CNPJ validates exactly as it did. Verified against Receita's own published
 * example, 12.ABC.345/01DE-35.
 *
 * Assignment is progressive and only for NEW inscrições, so the overwhelming
 * majority of documents this code meets are still all digits. That is why
 * nothing here forks on "is it alphanumeric": there is one algorithm, and the
 * numeric case is the special case of it.
 *
 * TWO STRIPS, AND CONFUSING THEM IS A DATA-LOSS BUG. `limpar` keeps letters,
 * because that is what a CNPJ may now contain; `soDigitos` does not, because a
 * CPF may not. validar uses the first and validarCpf the second, and the day
 * they were the same function an alphanumeric issuer span came out twelve
 * characters long and every note carrying one was refused red.
 * -----------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  const NFPR = (root.NFPR = root.NFPR || {});

  /**
   * A character's value in the módulo-11 sum: its ASCII code minus 48.
   *
   * THE ONE PLACE THE ALPHANUMERIC RULE IS WRITTEN. Digits map to themselves,
   * which is what makes this safe to apply unconditionally; letters map to
   * 17..42. chave.js has its own copy for the access key's own check digit —
   * deliberately, because that file stays free of dependencies on this one, and
   * two lines of arithmetic are cheaper than the coupling.
   */
  const valorCaractere = (c) => String(c).charCodeAt(0) - 48;

  /** Digits and uppercase letters — everything a CNPJ may hold. */
  const limpar = (valor) =>
    String(valor == null ? '' : valor).toUpperCase().replace(/[^0-9A-Z]/g, '');

  /** Digits only. For the CPF, which never became alphanumeric. */
  const soDigitos = (valor) => String(valor == null ? '' : valor).replace(/\D/g, '');

  /** The shape of a CNPJ: twelve alphanumeric, then two numeric check digits. */
  const RE_CNPJ = /^[0-9A-Z]{12}[0-9]{2}$/;

  /** Progressive format: 00.000.000/0000-00 (formats partial input too). */
  function formatar(valor) {
    const d = limpar(valor).slice(0, 14);
    if (!d) return '';
    return d
      .replace(/^([0-9A-Z]{2})([0-9A-Z])/, '$1.$2')
      .replace(/^([0-9A-Z]{2})\.([0-9A-Z]{3})([0-9A-Z])/, '$1.$2.$3')
      .replace(/\.([0-9A-Z]{3})([0-9A-Z])/, '.$1/$2')
      .replace(/([0-9A-Z]{4})([0-9A-Z])/, '$1-$2');
  }

  /** True when the 14-character CNPJ has valid módulo-11 check digits. */
  function validar(valor) {
    const cnpj = limpar(valor);
    if (!RE_CNPJ.test(cnpj)) return false;
    // Rejects 00000000000000 and its nine numeric siblings. DELIBERATELY STILL
    // NUMERIC-ONLY: this guard exists because zeros are what a half-filled
    // fixed part template puts in the issuer span, and a fixed part that fixes
    // it to zeros would otherwise be waved through. Letters are never padding,
    // so widening it to `(.)\1{13}` would only invent a refusal for a
    // repeated-letter CNPJ — and which letter strings Receita declines to ISSUE
    // is an assignment policy, not something a validator may enforce against a
    // real document.
    if (/^(\d)\1{13}$/.test(cnpj)) return false;

    function digito(base) {
      let pos = base.length - 7;
      let soma = 0;
      for (let i = 0; i < base.length; i += 1) {
        soma += valorCaractere(base[i]) * pos;
        pos -= 1;
        if (pos < 2) pos = 9;
      }
      const r = soma % 11;
      return r < 2 ? 0 : 11 - r;
    }

    const base12 = cnpj.slice(0, 12);
    const dv1 = digito(base12);
    if (dv1 !== Number(cnpj[12])) return false;

    const dv2 = digito(base12 + dv1);
    return dv2 === Number(cnpj[13]);
  }

  /**
   * True when the 11-digit CPF has valid módulo-11 check digits.
   *
   * The repunit guard mirrors validar's, and for the same reason: 00000000000
   * and its ten siblings satisfy the arithmetic and are not CPFs. A fixed part
   * that fixes the issuer span to zeros would otherwise be waved through, and
   * zeros are exactly what a half-filled template contains.
   *
   * NO ASCII-48 HERE, AND NO LETTERS EITHER. The alphanumeric change is the
   * CNPJ's alone. A CPF with a letter in it is not a CPF, and `soDigitos`
   * removing one leaves a ten-character string that fails the length test —
   * which is the right answer, and the reason this function must never be
   * pointed at `limpar`.
   */
  function validarCpf(valor) {
    const cpf = soDigitos(valor);
    if (cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false; // reject 00000000000 etc.

    function digito(base) {
      let peso = base.length + 1;
      let soma = 0;
      for (let i = 0; i < base.length; i += 1) {
        soma += Number(base[i]) * peso;
        peso -= 1;
      }
      const r = soma % 11;
      return r < 2 ? 0 : 11 - r;
    }

    const base9 = cpf.slice(0, 9);
    const dv1 = digito(base9);
    if (dv1 !== Number(cpf[9])) return false;

    const dv2 = digito(base9 + dv1);
    return dv2 === Number(cpf[10]);
  }

  NFPR.Cnpj = { limpar, soDigitos, formatar, validar, validarCpf };
})(typeof globalThis !== 'undefined' ? globalThis : self);
