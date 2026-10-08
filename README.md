# Assistente de Doação Manual do Nota Paraná

Extensão de navegador que transforma a página de **doação manual** do Nota
Paraná em uma área de trabalho para registrar as chaves de acesso de NFC-e e
NF-e — digitadas ou lidas com um leitor de código de barras ou de QR Code.

Funciona no Chrome, no Edge e no Brave a partir da versão 109, e no Firefox
115 ou mais novo. Tudo o que aparece na tela está em português, em linguagem
simples.

> Projeto independente, sem vínculo com o Governo do Paraná.

## O que ela faz

- **A doação acontece na própria página.** Ao abrir a página de doação manual,
  o painel já está lá: as 44 casas da chave e a lista do que aconteceu com cada
  nota.
- **Digite ou use o leitor.** Leitores de código de barras e de QR Code que
  funcionam como teclado são reconhecidos. De um QR Code, a extensão separa a
  chave do resto do endereço.
- **A chave é conferida antes de ser enviada.** A extensão confere os dígitos
  da própria chave e aponta na hora a maior parte dos erros de leitura e de
  digitação — enquanto você digita, inclusive.
- **Ela diz por que uma nota não pode ser doada**: de outro estado, fora do
  prazo, ou de um tipo de documento que o programa não aceita.
- **As notas ficam guardadas quando a internet ou o site falham**, e são
  enviadas quando voltam. Se a página de doação nem abrir, uma página offline
  da própria extensão continua recebendo as chaves; elas são enviadas na
  próxima vez que a página de doação abrir com conexão.
- **Várias entidades.** Cadastre uma ou mais pelo CNPJ; o nome oficial vem do
  cadastro do próprio site. Cada nota vai para a entidade que estava escolhida
  quando ela foi lida.
- **Parte fixa da chave.** Para quem digita as chaves: quando várias começam da
  mesma forma, escreva o começo uma vez; em cada nota, digite o restante.
- **Sons e avisos.** Um som para chave lida, outro para nota registrada, outro
  para aviso e outro para erro — cada um pode ser desligado. O ícone da
  extensão mostra quantas notas ainda esperam envio.
- **Nota não registrada não some.** Quando o site recusa uma nota sem dizer o
  motivo, ela entra numa lista com a chave, que fica na tela até ser vista.

## O que ela não faz

- Não entra no Nota Paraná por você e não guarda senha: você usa o site com o
  seu próprio login.
- Não lê códigos pela câmera — só por leitor de mão ou pelo teclado.
- Não garante o crédito. *"Documento fiscal doado com sucesso"* quer dizer que
  o site registrou a doação; o que é creditado à entidade é decidido pelo
  programa, na conferência mensal.

## Instalação

Não há nada para compilar: a pasta é a extensão.

### Chrome, Edge ou Brave

1. Baixe este repositório (**Code → Download ZIP**) e descompacte.
2. Abra `chrome://extensions` (ou `edge://extensions`).
3. Ligue o **Modo do desenvolvedor**, no canto superior direito.
4. Clique em **Carregar sem compactação** e escolha a pasta que contém
   `manifest.json`.

O Chrome mostra um aviso amarelo sobre `background.scripts`. É esperado e não
atrapalha. Em versões anteriores à 121 o aviso é um erro e a pasta não
carrega: gere os pacotes com `node tools/empacotar.js`, descompacte o de
`chromium` e carregue essa pasta.

### Firefox

1. Baixe este repositório e descompacte.
2. Abra `about:debugging#/runtime/this-firefox`.
3. Clique em **Carregar extensão temporária…** e escolha o arquivo
   `manifest.json`.

Instalada assim, a extensão sai quando o Firefox é fechado.

No Firefox anterior ao 127 a extensão é instalada sem acesso ao site. Clique
no ícone dela e em **Permitir no site do Nota Paraná**; o aviso só aparece
quando falta essa permissão.

## Primeiro uso

1. Entre no Nota Paraná e abra a
   [página de doação manual](https://notaparana.pr.gov.br/nfprweb/DoacaoDocumentoFiscalCadastrar).
2. Clique no ícone da extensão, na barra do navegador, e adicione a entidade
   pelo **CNPJ**. Não é preciso digitar o nome.
3. Digite a chave de acesso ou use o leitor. **Enter** envia — o leitor
   costuma fazer isso — e **Esc** limpa o que foi digitado.

Uma mensagem que começa com `[nfprweb]` veio do site, e não da extensão.

## Privacidade

Nada sai do seu navegador além dos pedidos feitos ao próprio site do Nota
Paraná. Não há servidor, conta nem estatística de uso. Os detalhes estão em
[PRIVACIDADE.md](PRIVACIDADE.md).

## Encontrou um problema?

Abra uma *issue* neste repositório. Ajuda muito dizer o navegador, o que você
estava fazendo e a mensagem que apareceu na tela. **Não cole a chave de acesso
de uma nota verdadeira nem dados pessoais.**

## Para quem vai mexer no código

**Esta página e [PRIVACIDADE.md](PRIVACIDADE.md) são os únicos documentos em
português.** Todo o resto — os outros documentos e os comentários do código —
está em inglês. Os nomes no código (`chave`, `entidade`, `parteFixa`) e todos
os textos da tela estão em português.

- [DOCS.md](DOCS.md) — como a extensão funciona, o protocolo observado do
  site, o roteiro de testes manuais, os casos-limite e as lacunas conhecidas.
- [CLAUDE.md](CLAUDE.md) — as decisões de engenharia e o motivo de cada uma.
  Foi escrito para quem trabalha com agentes de código, que o leem no começo
  de cada sessão.
- [TODO.md](TODO.md) — o que foi pensado e ainda não existe.

Não há etapa de *build*, nem dependências. Com o Node instalado:

```bash
node tools/smoke.js
```

confere a carga dos módulos e a lógica sem abrir o navegador, e

```bash
node tools/empacotar.js
```

gera em `dist/` um pacote para cada loja.

A pasta `reference/` não vem no repositório. Ela é uma cópia local das páginas
do site, que cada pessoa salva com o próprio login; o final de
[CLAUDE.md](CLAUDE.md) explica como fazer e por que vale a pena.

## Licença

[MIT](LICENSE).
