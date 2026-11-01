# Revisão de segurança — Lume

**Data:** 1º de novembro de 2026

**Escopo:** compilador e emissão WebAssembly, ciclo do Worker, ponte DOM, heap numérico, página de distribuição e conteúdo do snapshot.

## Achados corrigidos

1. `listen_click()` reenviava uma notificação a cada chamada e não consumia o orçamento de efeitos do host. Isso permitia uma fila desnecessária de mensagens Worker → interface. Agora cada chamada consome o orçamento de 4.096 efeitos por execução/callback, enquanto o aviso de listener é idempotente e enviado uma única vez.
2. Um programa podia solicitar o listener sem exportar `on_click`, deixando o Worker e o heap ativos sem callback útil. Agora a solicitação falha com erro controlado, o estado de execução é limpo e nenhum listener é anunciado.
3. Quando `main()` terminava com callback ativo, a interface desabilitava **Interromper** embora o Worker continuasse vivo. O Worker agora informa esse estado à interface, que mantém o controle disponível até a execução ser encerrada.

Esses caminhos têm regressões em `tests/worker.test.js`. A aritmética assinada segue os traps definidos pelo WebAssembly: divisão e resto por zero causam trap, assim como a divisão do menor `i32` por `-1`. A documentação e os testes agora tornam essa semântica explícita.

## Verificações realizadas

A revisão independente foi estática e focada no parser/emissor WASM, nas validações da ponte DOM, nos handles e limites do heap e no ciclo de vida dos imports do Worker. Não foram confirmados outros defeitos nos trechos examinados; isso não é uma prova de ausência de falhas nem substitui análise exaustiva.

A suíte executada em 1º de novembro de 2026 terminou com **27 testes aprovados e zero falhas**, cobrindo compilação e execução WASM, erros de tipos, limites de fonte/profundidade, rejeição de lotes DOM, operações do heap, invalidação de handles, compactação, o listener de cliques e traps aritméticos. `node --check` aprovou `src/app.js`, `src/worker.js` e `src/compiler.js`; `git diff --check` não encontrou problemas de whitespace.

O build estático foi reproduzido a partir do contrato de publicação e contém somente a interface, os módulos necessários, o manifesto de rotas e a dependência MapLibre local com sua licença. A landing page do GitHub Pages respondeu por HTTP junto com seu CSS e logo, sem scripts ou recursos CSS remotos. O manifesto compilado contém apenas `/` e `/localizacao.html`. A inspeção do projeto não encontrou arquivos `.env` e os padrões de credenciais conhecidos não encontraram correspondência nos arquivos de fonte. `package.json` não declara dependências npm externas.

## Riscos que permanecem

WebAssembly e Web Workers não são, por si sós, uma sandbox para executar código hostil. Um loop pode consumir CPU até que o Worker seja terminado; portanto, não execute programas de terceiros que você não revisou. O projeto não implementa orçamento de instruções nem isolamento de origem específico para código Lume.

A validação DOM verifica o lote inteiro antes de delegar a mutação. Ela não pode fazer rollback se uma escrita nativa do DOM falhar inesperadamente durante a aplicação. O heap é um serviço auxiliar limitado a células `i32`; ele não é a memória linear WASM, não oferece strings ou ponteiros e pode ser mais lento que acesso direto por causa das chamadas entre WASM e JavaScript.

Os limites de 65.536 unidades UTF-16 de fonte, profundidade sintática 128, heap de 16 MiB, 16.384 blocos vivos e 4.096 efeitos do host reduzem algumas classes de erro e abuso. Eles não garantem segurança completa. A análise não foi um pentest, fuzzing abrangente ou verificação formal; bugs em navegadores, dependências vendorizadas ou fluxos não cobertos pelos testes continuam possíveis.


---

**Idiomas:** Português (Brasil) · [English](SECURITY_REVIEW.md).
