/**
 * tools/cnpj.js — run with:  node tools/cnpj.js 12.ABC.345/01DE-35 [...]
 *                 check digits for a base:  node tools/cnpj.js 12ABC34501DE
 *                 random valid ones:        node tools/cnpj.js --gerar [n]
 * -----------------------------------------------------------------------------
 * NOT part of the extension. A dependency-free validator for the alphanumeric
 * CNPJ (IN RFB 2.229/2024), because the public validators a maintainer would
 * reach for mostly still assume fourteen digits and refuse every new
 * inscrição — which is useless as a second opinion on the one case worth
 * checking.
 *
 * IT IS WRITTEN INDEPENDENTLY OF src/shared/cnpj.js, on purpose. A tool that
 * imported the extension's validator could only ever agree with it. This one
 * computes the check digits its own way (weights 2..9 cycling from the right),
 * then loads the extension's `NFPR.Cnpj.validar` in a vm and prints DIVERGE
 * beside any input where the two answers differ. It exits 1 if anything is
 * invalid or divergent, so it can sit in a shell loop.
 *
 * The rule, for whoever reads this before the code: 14 characters, the first
 * twelve `[0-9A-Z]`, the last two numeric. Each character counts as its ASCII
 * value minus 48 (digits map to themselves, A = 17 … Z = 42), then the usual
 * módulo 11. Receita's published vector is 12.ABC.345/01DE-35.
 *
 * One non-arithmetic refusal is mirrored: a numeric repunit (00000000000000
 * and its siblings) satisfies the sum and is refused anyway, exactly as the
 * extension refuses it — otherwise every such input would read as DIVERGE.
 * -----------------------------------------------------------------------------
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ALFABETO = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const normalizar = (s) => String(s).toUpperCase().replace(/[^0-9A-Z]/g, '');

/** One check digit over `base`, weights 2..9 cycling from the rightmost char. */
function digitoVerificador(base) {
  let soma = 0;
  for (let k = 0; k < base.length; k += 1) {
    const c = base[base.length - 1 - k];
    soma += (c.charCodeAt(0) - 48) * (2 + (k % 8));
  }
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}

function digitosPara(base12) {
  const dv1 = digitoVerificador(base12);
  const dv2 = digitoVerificador(base12 + dv1);
  return String(dv1) + String(dv2);
}

const formatar = (c) =>
  `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;

/** { ok, motivo } — motivo is set whenever ok is false. */
function avaliar(cnpj) {
  if (cnpj.length !== 14) return { ok: false, motivo: `tem ${cnpj.length} caracteres, não 14` };
  if (!/^[0-9]{2}$/.test(cnpj.slice(12))) return { ok: false, motivo: 'os dígitos verificadores devem ser números' };
  if (/^(\d)\1{13}$/.test(cnpj)) return { ok: false, motivo: 'números todos iguais' };
  const esperado = digitosPara(cnpj.slice(0, 12));
  if (esperado !== cnpj.slice(12)) return { ok: false, motivo: `dígitos verificadores deveriam ser ${esperado}` };
  return { ok: true };
}

/** The extension's own validator, or null if it cannot be loaded. */
function validadorDaExtensao() {
  try {
    const arquivo = path.join(__dirname, '..', 'src', 'shared', 'cnpj.js');
    const ctx = vm.createContext({});
    vm.runInContext(fs.readFileSync(arquivo, 'utf8'), ctx, { filename: arquivo });
    return ctx.NFPR.Cnpj.validar;
  } catch (e) {
    console.error('aviso: não foi possível carregar src/shared/cnpj.js — ' + e.message);
    return null;
  }
}

function gerar() {
  let base = '';
  for (let i = 0; i < 12; i += 1) base += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  return base + digitosPara(base);
}

const args = process.argv.slice(2);

if (!args.length) {
  console.log('uso: node tools/cnpj.js <CNPJ ou base de 12> [...]   |   node tools/cnpj.js --gerar [n]');
  process.exit(2);
}

if (args[0] === '--gerar') {
  const n = Math.max(1, Number(args[1]) || 1);
  for (let i = 0; i < n; i += 1) console.log(formatar(gerar()));
  process.exit(0);
}

const validarExtensao = validadorDaExtensao();
let falhou = false;

for (const arg of args) {
  const cnpj = normalizar(arg);

  // A 12-character base: say what its check digits are, and stop there.
  if (cnpj.length === 12) {
    console.log(`${arg}  →  ${formatar(cnpj + digitosPara(cnpj))}`);
    continue;
  }

  const { ok, motivo } = avaliar(cnpj);
  let linha = `${arg}  ${ok ? 'válido' : 'INVÁLIDO — ' + motivo}`;
  if (validarExtensao && validarExtensao(arg) !== ok) {
    linha += `   DIVERGE (extensão diz ${validarExtensao(arg) ? 'válido' : 'inválido'})`;
    falhou = true;
  }
  if (!ok) falhou = true;
  console.log(linha);
}

process.exit(falhou ? 1 : 0);
