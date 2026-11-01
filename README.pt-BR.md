# Lume

Lume é um protótipo de linguagem compilada para um playground no navegador. O compilador, escrito em JavaScript sem dependências externas, transforma um subconjunto tipado da linguagem diretamente em um módulo binário WebAssembly. O módulo é validado e executado em um Web Worker; chamadas a APIs visuais passam por imports explícitos de JavaScript. O Worker mantém a interface responsiva e pode ser terminado para interromper um loop, mas não é uma sandbox de segurança para código arbitrário.

## Baixar e executar

A página de distribuição está em [luizcsbh.github.io/lume-language](https://luizcsbh.github.io/lume-language/). Use **Baixar código-fonte (.zip)** para obter o snapshot público do repositório, sem histórico Git ou arquivos de ambiente. Esta distribuição é código-fonte para navegador — não um instalador nem um executável nativo. O projeto está licenciado sob a [Licença MIT](LICENSE).

Depois de extrair o ZIP, abra um terminal nessa pasta e execute `python3 -m http.server 8000`; acesse `http://localhost:8000`. O contexto HTTP local permite testar a página e a API de localização. Com Node.js, `npm test` executa a suíte automatizada.

## Primeiros passos

1. Baixe ou clone este repositório e abra um terminal na pasta raiz (a pasta que contém `index.html`).
2. Inicie um servidor HTTP local:
   ```bash
   python3 -m http.server 8000
   ```
3. Acesse `http://localhost:8000` em um navegador moderno.
4. No playground, escolha um exemplo ou substitua o código no editor. Quando o armazenamento local está disponível, o editor salva o código no navegador; ele não carrega nem cria arquivos `.lume`.
5. Clique em **Compilar** para inspecionar a representação WebAssembly Text e depois em **Executar** para rodar o programa. Também é possível usar `Ctrl/⌘ + Enter`.

Teste este programa mínimo no editor:

```lume
fn main() -> i32 {
  print("Olá, Lume!");
  return 0;
}
```

O console do playground mostrará `Olá, Lume!`.

## Como desenvolvedores podem usar o Lume

O compilador pode ser instalado como dependência npm. O pacote ainda não foi publicado no registro npm; enquanto isso, instale diretamente do GitHub:

```bash
npm install github:luizcsbh/lume-language
```

Para desenvolver com uma cópia local do repositório, use o caminho até ela, por exemplo `npm install ../lume-language`. Depois que o pacote for publicado no npm, a instalação poderá ser feita com `npm install @luizcsbh/lume-language`.

Crie `app.mjs` no seu projeto:

```js
import { instantiate } from "@luizcsbh/lume-language";

const source = `
fn main() -> i32 {
  print_i32(42);
  return 0;
}`;

const { run } = await instantiate(source, {
  host: {
    print_i32(value) {
      console.log(value);
    },
  },
});

instance.exports.main();
```

Execute com `node app.mjs`. O console mostrará `42`. A função `instantiate` compila e valida o módulo WASM e devolve a instância e os dados da compilação. Implemente no objeto `host` cada função importada que seu programa usar; se o programa chamar uma função ausente, o runtime lança um erro explícito.

Para compilar e inspecionar sem instanciar:

```js
import { compile } from "@luizcsbh/lume-language";

const source = "fn main() -> i32 { return 0; }";
const { bytes, wat, functions } = compile(source);
```

Este helper executa `main()` de forma síncrona na thread atual; em uma interface de navegador, use um Web Worker para evitar bloquear a tela. O pacote não cria automaticamente uma ponte DOM ou Canvas: essas integrações devem ser fornecidas pelas funções `host` da sua aplicação. WebAssembly e Worker não são uma sandbox para código hostil.

### Usar pelo playground

Também é possível usar o Lume neste repositório para experimentar lógica numérica tipada e conectá-la aos recursos oferecidos pelo playground. Por exemplo, este programa lê o slider e escreve o valor em um alvo DOM registrado:

```lume
fn main() -> i32 {
  let value: i32 = read_slider();
  dom_set_i32(1, value);
  dom_set_visible(3, true);
  print_i32(value);
  return value;
}
```

Nesse exemplo, o alvo `1` é `result-value` e o alvo `3` é `result-pill`. Há também imports para desenhar no Canvas, receber callbacks de clique e usar os handles experimentais de memória `i32`; consulte as seções abaixo para mais detalhes.

O pacote distribui o compilador e um helper mínimo de execução WebAssembly. A integração completa do playground — incluindo Worker, DOM e Canvas — continua sendo responsabilidade da aplicação que o incorpora. A implementação está em `src/compiler.js`, `src/runtime.js`, `src/worker.js` e `src/app.js`.

### Arquivos relevantes do projeto

- `src/` contém o compilador, o Worker, a API DOM e o runtime.
- `index.html` carrega o playground no navegador.
- `localizacao.html` demonstra geolocalização usando um programa Lume compilado.
- `tests/` guarda a suíte automatizada de validação.

### Importante

- O Lume é uma linguagem experimental focada em navegador.
- Os programas são compilados para WebAssembly e executados em um Web Worker.
- Recursos do navegador são expostos por imports explícitos, como `print_i32`, `read_slider()`, `listen_click()` e as APIs controladas de DOM e memória.
- Use apenas programas que você entende e confia; o Worker não é uma sandbox para código hostil arbitrário.

## Controles do playground

Abra o [playground do repositório](https://luizcsbh.github.io/lume-language/playground/) ou rode o servidor local acima. O workflow do GitHub Pages publica a página e o playground; para ativar a publicação, selecione **Settings → Pages → Build and deployment → GitHub Actions** no repositório. **Compilar** mostra a representação WebAssembly Text; **Executar** compila e roda o módulo. **Interromper** encerra o Worker, inclusive se um programa entrar em loop sem fim. O valor do slider é lido quando `read_slider()` é chamada. O exemplo de cliques recebe coordenadas em `on_click(x, y)`.

## Sintaxe do protótipo

```lume
fn soma(a: i32, b: i32) -> i32 {
  return a + b;
}

fn main() -> i32 {
  let limite: i32 = 10;
  let soma_total: i32 = 0;
  let indice: i32 = 0;

  while indice < limite {
    soma_total = soma_total + indice;
    indice = indice + 1;
  }

  if soma_total > 0 {
    print_i32(soma(soma_total, 2));
  } else {
    print_i32(0);
  }
  return soma_total;
}
```

Funções são declaradas com `fn`, parâmetros têm nomes e tipos (`nome: tipo`), e o resultado pode vir depois de `->`. `main` é a entrada, não recebe parâmetros e retorna `i32`. Os tipos primitivos disponíveis são `i32`, `f64`, `bool` e `string`; booleanos usam a representação WebAssembly `i32`, e strings são armazenadas como UTF-8 na memória do módulo. Variáveis locais usam `let nome: tipo = valor;` e podem ser atualizadas. Inteiros são literais sem ponto decimal; decimais são `f64`. Existem `if`/`else`, `while`, chamadas de função, recursão, atribuição, comentários `//` e `/* ... */`, aritmética, comparações e operadores booleanos `&&` e `||` (com avaliação não short-circuit). Conversões implícitas e concatenação de strings com `+` não estão incluídas; `print("texto", numero)` concatena texto e número somente na saída.

### Arrays e structs

Arrays têm tipo explícito, tamanho fixo após a alocação, elementos mutáveis por índice e a propriedade `.length`. Um literal tipado aloca os elementos no heap gerenciado:

```lume
struct Point { x: i32, y: f64 }

fn main() -> i32 {
  let scores: array<i32> = [8, 13, 21];
  scores[1] = 34;
  let points: array<Point> = array_ref(1);
  points[0] = Point { x: scores[1], y: 2.5 };
  print_f64(points[0].y);
  return points.length;
}
```

Para tamanhos conhecidos apenas durante a execução, use `array_i32(tamanho)`, `array_f64(tamanho)`, `array_bool(tamanho)` ou `array_string(tamanho)`. `array_ref(tamanho)` cria arrays de structs e outros valores gerenciados, com o tipo informado, por exemplo `array<Point>`. Literais vazios são válidos quando a variável ou parâmetro informa o tipo. Structs declaram campos tipados; a inicialização exige todos os campos exatamente uma vez. Campos e elementos podem ser lidos e alterados, inclusive em valores aninhados.

O runtime gerencia essas alocações em um heap limitado e as libera ao final de `run()`, exceto se um listener mantiver callbacks ativos; nesse caso, chame `dispose()` ao terminar. No playground, o Worker libera o heap ao fim da execução. Isso é gerenciamento por região de execução, não um garbage collector: arrays não mudam de tamanho e valores não são compartilhados entre execuções ou Workers.

O compilador aceita módulos nomeados fornecidos explicitamente pelo host. Funções importadas precisam ser exportadas com `export fn`; caminhos são relativos, terminam em `.lume` e só podem resolver para fontes presentes no objeto `modules`:

```lume
import { somar as soma } from "./matematica.lume";
fn main() -> i32 { return soma(19, 23); }
```

```js
import { instantiate } from "@luizcsbh/lume-language";

const source = `
import { somar as soma } from "./matematica.lume";
fn main() -> i32 { return soma(19, 23); }`;

const { instance } = await instantiate(source, {
  modules: {
    "matematica.lume": "export fn somar(a: i32, b: i32) -> i32 { return a + b; }",
  },
  host: {},
});

console.log(run()); // 42
```

`run()` executa `main()` e libera o heap ao retornar, exceto quando o programa registra um listener de clique; nesse caso, chame `dispose()` após terminar os callbacks. Se chamar `instance.exports.main()` diretamente, libere os recursos com `dispose()` quando terminar. O runtime fornece os imports de memória gerenciada; implemente em `host` as demais funções importadas que seu programa usar. Chamadas a imports sem implementação falham explicitamente.

O compilador combina os arquivos em um único módulo WASM; não lê arquivos nem busca módulos na rede. Módulos não importados são rejeitados.

## Interoperabilidade com JavaScript

As funções de host importadas incluem `print_i32(i32)`, `print_f64(f64)`, `print_string(string)`, `print(string, numero)`, Canvas, a API DOM controlada, `read_slider() -> i32`, `listen_click()` e os imports de memória listados abaixo. Na linguagem, `print` e `print_string` são equivalentes: ambos aceitam `print("texto")` ou `print("texto", numero)`; o número pode ser `i32` ou `f64`, e o texto e a representação do número saem juntos. Para implementar os imports em outra aplicação, o argumento de texto é um ponteiro para bytes UTF-8 na memória exportada `instance.exports.memory`; os quatro bytes anteriores ao ponteiro contêm o comprimento em bytes como inteiro little-endian. Na forma com número, ele chega ao import `print` como `f64`; na forma só com texto, o import `print_string` recebe o ponteiro. No playground, o Worker decodifica o texto e o envia ao console. `listen_click()` habilita a chamada ao export WASM opcional `on_click(x: i32, y: i32) -> i32` quando o usuário clica no Canvas.

## API DOM controlada

O exemplo **DOM em lote** apresenta três imports tipados: `dom_set_i32(target: i32, value: i32)`, `dom_set_f64(target: i32, value: f64)` e `dom_set_visible(target: i32, visible: bool)`. O catálogo fixo usa os IDs 1=`result-value`, 2=`input-value`, 3=`result-pill` e 4=`canvas-empty`. Os dois primeiros aceitam somente valores numéricos escritos como texto; os dois últimos aceitam somente visibilidade. A importação legada `dom_value(i32)` continua disponível como atalho para atualizar `result-value` e exibir `result-pill`.

O Worker acumula os comandos de uma chamada `main` ou de um callback WASM `on_click` e envia um lote de até 4.096 operações, em vez de uma mensagem por operação. O serviço do host valida o lote inteiro antes de mutar qualquer nó, verifica os IDs, capacidades, intervalos i32, valores f64 finitos e bools 0/1 e então aplica as escritas numa única passagem síncrona. Um lote rejeitado na validação não deixa uma parte aplicada. Se a execução/callback lançar erro ou exceder o orçamento, os comandos pendentes são descartados e o listener de cliques é desligado até uma nova execução. A garantia é de validação integral, não uma transação com rollback se uma escrita do próprio DOM falhar inesperadamente. A interface não consulta medidas de layout para executar esses comandos e o texto passa por `textContent`, nunca por `innerHTML`.

O programa não fornece seletores, HTML, atributos, URLs, event listeners ou referências de nós: somente o host registra e disponibiliza os quatro destinos fixos. Isso reduz capacidades e riscos de injeção, mas não transforma Worker ou WebAssembly numa sandbox para executar código hostil. A API DOM controlada só escreve números; strings estão disponíveis para impressão no console por `print_string`, não para escrita arbitrária no DOM. Cada chamada continua cruzando a fronteira WASM–JavaScript: o lote reduz as mensagens, mas DOM simples ou intensivo em acessos ainda pode ser mais rápido em JavaScript. A lista de alvos não é uma API de acesso geral a páginas arbitrárias.

## Gerenciamento de memória numérica

O exemplo **Memória & threads** usa `memory_alloc_i32(cells: i32) -> i32`, `memory_load_i32(handle: i32, index: i32) -> i32`, `memory_store_i32(handle: i32, index: i32, value: i32)` e `memory_free(handle: i32)`. O resultado da alocação é um handle opaco, não um endereço nem um ponteiro. Cada leitura/escrita exige um handle ativo e um índice dentro do bloco; valores fora do intervalo `i32`, handles inválidos, índices inválidos e liberações repetidas são rejeitados.

O heap é mantido no Worker pelo host em um `Int32Array`, e **não** é a memória linear nativa do módulo WebAssembly. Começa com 64 KiB, cresce sob demanda até 16 MiB e aceita no máximo 16.384 blocos vivos por execução. Alocações novas e liberadas são zeradas; intervalos livres adjacentes são unidos. Quando a fragmentação impede uma alocação, os blocos podem ser compactados: o programa só possui handles estáveis, então não observa posições físicas. O Worker mostra bytes usados/reservados e blocos vivos no console.

O heap é reiniciado a cada execução: é liberado ao final de `main()` quando não há listener de clique; se `listen_click()` o mantiver ativo, dura até a próxima execução, erro ou encerramento do Worker. Arrays e structs usam o mesmo heap; valores `f64` ocupam duas células `i32`. O heap não expõe ponteiros crus nem acesso geral à memória WASM e não oferece garbage collector ou compartilhamento entre Workers.

O exemplo **Memória & threads** demonstra alocação, escrita, leitura, reutilização e liberação de um bloco. O Canvas mostra um gráfico de pontos: três pontos representam as três células `i32` alocadas, e um ponto para cada thread de execução compara Lume e JavaScript. Os rótulos e a soma calculada aparecem no console. Lume controla a memória por handles, enquanto o host JavaScript mantém o buffer real. No playground, o programa WASM roda em **um Worker (uma thread de execução)** e o JavaScript da interface permanece na thread principal. Um programa JavaScript síncrono na interface usa uma thread de execução; se precisar manter a interface responsiva com o cálculo isolado, também usa um Worker. Portanto, para esse cenário, Lume não exige mais threads do que JavaScript. O número de threads por si só não indica qual opção será mais rápida.

## Localização HTML5 processada por Lume

No servidor local, abra [`/localizacao.html`](localizacao.html); no site publicado, acesse a [demonstração de localização](https://luizcsbh.github.io/lume-language/playground/localizacao.html). Clique em **Localizar minha posição**. Só então JavaScript chama `navigator.geolocation.getCurrentPosition`, sujeito ao consentimento do navegador e a um contexto seguro (HTTPS ou localhost). A latitude e longitude são passadas como `f64` ao export `analyze_location` do programa Lume compilado para WebAssembly; essa função classifica os hemisférios. Depois, MapLibre GL JS 6.16.0, servido localmente com sua licença em `vendor/maplibre-gl`, mostra a posição em um mapa vetorial do OpenFreeMap. O mapa Liberty e seus dados só são requisitados depois que o navegador retorna uma posição autorizada; a página mostra um marcador e um círculo com a precisão estimada informada pelo navegador.

A instância pública do OpenFreeMap é anunciada atualmente como gratuita, sem cadastro, chave de API, limite de requisições ou cookies. O serviço não promete SLA e sua disponibilidade futura não é garantida. Seus mapas são servidos em `tiles.openfreemap.org`, mas os dados cartográficos vêm do OpenStreetMap. A atribuição visível identifica OpenFreeMap, OpenMapTiles e os colaboradores do OpenStreetMap. Consulte o [site do OpenFreeMap](https://openfreemap.org/), o [guia oficial de integração](https://openfreemap.org/quick_start/) e a [documentação MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/).

Para desenhar a região, o navegador solicita o estilo e os tiles públicos ao OpenFreeMap; o serviço recebe o IP e as áreas aproximadas solicitadas. O aplicativo não envia as coordenadas a um backend próprio nem as armazena. A biblioteca e sua folha de estilos são hospedadas no próprio site e carregadas somente depois da autorização. Se a pessoa negar o acesso ou o navegador não retornar uma posição, o app não consulta o provedor de mapas. A API HTML5 tem um limite de espera de 15 segundos e a interface libera o botão após 20 segundos se nenhum callback chegar. As coordenadas e o marcador são mostrados assim que Lume termina o cálculo, sem esperar a renderização dos tiles; se o mapa continuar carregando por mais de 35 segundos, a interface avisa, mas deixa o carregamento prosseguir e o mapa pode aparecer depois.

## Compilar e testar

MapLibre GL JS e o worker correspondente são servidos dos arquivos locais em `vendor/maplibre-gl`; os dados vetoriais de ruas vêm do OpenFreeMap depois da autorização. Com Node.js instalado, `npm test` executa os testes do compilador, heap e integrações com o executor WebAssembly nativo do Node. `npm start` inicia a prévia estática na porta 3000.

## Limites

Este projeto é um protótipo educacional: o heap é limitado ao serviço auxiliar `i32` descrito acima, sem gerenciamento da memória linear nativa WASM, depurador ou ecossistema de pacotes. O compilador recusa fonte acima de 65.536 unidades UTF-16 e profundidade sintática acima de 128; os efeitos do host são limitados a 4.096 por chamada. Esses limites reduzem falhas acidentais e abuso simples, mas não oferecem um orçamento de instruções WASM: um loop pode consumir CPU até a pessoa interromper o Worker. Não execute programas não confiáveis; WebAssembly e Workers não constituem uma sandbox de segurança. A revisão automatizada e manual reduz riscos conhecidos, mas não garante ausência de vulnerabilidades. WebAssembly não é automaticamente mais rápido que JavaScript para toda carga de trabalho; acessos frequentes ao DOM continuam passando por JavaScript. O endpoint público do OpenFreeMap não oferece SLA; para aplicações críticas, avalie um provedor comercial ou auto-hospedagem.


A aritmética `i32` segue as instruções assinadas do WebAssembly: divisão ou resto por zero causa um trap; a divisão `-2147483648 / -1` também causa trap. Nesse caso, o resto `-2147483648 % -1` é zero. Um trap interrompe a chamada e o Worker descarta comandos DOM ainda pendentes.

Para os achados corrigidos, verificações e riscos residuais, consulte [a revisão de segurança](SECURITY_REVIEW.md).


---

**Idiomas:** Português (Brasil) · [English](README.md). Para a revisão de segurança em português, consulte [SECURITY_REVIEW.pt-BR.md](SECURITY_REVIEW.pt-BR.md).
