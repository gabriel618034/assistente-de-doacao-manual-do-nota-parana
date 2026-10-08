# Privacidade

**A extensão não coleta nada.** Não tem servidor, conta, estatística de uso
nem anúncio, e não envia nenhum dado a quem a desenvolve nem a terceiros.

## O que fica guardado no seu navegador

Tudo fica no armazenamento local da extensão, neste computador e neste perfil
do navegador. Nada é sincronizado com outros aparelhos.

- As entidades cadastradas: CNPJ e nome.
- As partes fixas da chave e as preferências.
- As chaves de acesso que ainda esperam envio, com a entidade de destino e o
  momento em que foram lidas.
- As chaves das notas que o site não registrou sem dizer o motivo, com a
  mensagem recebida. São no máximo 100.
- O estado do modo de depuração, uma ferramenta de desenvolvimento que vem
  desligada.

Além disso, ao encerrar uma sessão duplicada a extensão deixa um marcador na
aba, que desaparece quando a aba é fechada.

Remover a extensão apaga tudo isso.

## O que é enviado, e para onde

A extensão só se comunica com `notaparana.pr.gov.br`, usando o login que você
mesmo abriu no site.

- **A doação**: a chave de acesso e o CNPJ da entidade — os mesmos dados que o
  formulário do site envia.
- **A consulta de uma entidade pelo CNPJ**, para mostrar o nome oficial.
- **Pedidos de conferência**, para saber se o site está respondendo e se o
  login continua válido.
- **O encerramento de sessões duplicadas**: quando você pede, quando essa
  preferência está ligada ou, no primeiro uso, antes de haver uma entidade
  cadastrada.

## O que ela não lê

A extensão não lê nem guarda a sua senha, o seu nome ou o seu CPF. Ela muda a
aparência do cabeçalho do site, onde o nome e o CPF aparecem, sem ler o que
está escrito ali.

## As permissões pedidas

- **Armazenamento** (`storage`): guarda o que está listado acima.
- **Redirecionamento** (`declarativeNetRequest`): leva a página de doação para
  a página offline da extensão quando não há conexão. Vale só para esse
  endereço.
- **Navegação** (`webNavigation`): percebe quando a página de doação não
  carregou, para abrir a página offline no lugar da tela de erro.
- **Acesso a `notaparana.pr.gov.br`**: a página inicial (conta corrente) e a
  página de doação, onde a extensão funciona, e a consulta de entidades pelo
  CNPJ.

## Dúvidas

Abra uma *issue* no repositório do projeto.
