# Garagem Pixel

Ferramenta no navegador que transforma a foto de um carro (vista de lado) em um sprite 2D em pixel art para jogos.
Arquivo único, sem servidor: a página final é um só `garagem-pixel.html`.

## O que faz
- Remove o fundo da foto, reduz para pixel art, escolhe a paleta (automática, PICO-8, Sweetie 16, Game Boy) e aplica contorno, luz e reflexos.
- Rodas: estampadas, da foto ou sem rodas. Também exporta corpo sem rodas e roda girando.
- Animação: balanço, rodas girando, fumaça, poeira, faróis, neon. Exporta PNG, folha de frames, GIF e pacote `.zip` com JSON.
- Garagem com vários carros e folha PNG.
- Assistente de IA que analisa o sprite e sugere ajustes (usa a capacidade `sample` do artefato do Claude).
- **Modo Racha de Rua**: escolhe um dos 19 carros da tabela do jogo, encaixa as rodas da foto nos centros da tabela,
  abre as caixas de roda (#0b0a14), separa a cor da lataria em um só matiz, mostra a guia (chão, raio 11 e 13),
  confere o resultado e exporta `carro-NN-nome.png`.
- **Editor de pixels** no modo jogo: pincel, borracha, conta-gotas, paleta clicável, desfazer/refazer (Ctrl+Z / Ctrl+Y).
  Cada retoque reavalia a conferência (pintar dentro da roda, por exemplo, vira aviso).
- **Altura do carro**: botões ▲ ▼, controle deslizante e setas do teclado (com o foco na prévia) sobem e descem a carroceria em relação às rodas.
- **Ajustes por carro**: cada carro da tabela lembra a própria altura, cor e posição das rodas durante a sessão.
- **Arquivo de ajustes** (`.json`): salva e carrega os ajustes de todos os carros e os retoques (sem a foto).
- **Garagem do jogo**: "Carros do jogo (.zip)" junta os carros adicionados com os nomes certos, prontos para `racha-de-rua/imagens/carros/`.

## Estrutura
```
src/pipeline.js   processamento de imagem (funções puras, roda no navegador e no Node)
src/encoders.js   PNG/ZIP/GIF sem dependências
src/racha.js      tabela e regras do modo Racha de Rua
src/template.html interface e lógica da página (recebe os três arquivos acima)
build.py          junta tudo em dist/garagem-pixel.html
test_*.js         testes em Node
tests/e2e/        testes de navegador (Playwright)
```

## Como usar
```
npm run build        # gera dist/garagem-pixel.html
npm test             # testes em Node
npm install && npx playwright install chromium
npm run test:e2e     # testes de navegador (fluxo geral, modo jogo, editor, projeto, garagem) (CHROME_PATH aponta um Chrome já instalado, se preferir)
```

Abra `dist/garagem-pixel.html` no navegador. Fora do Claude, o botão de download usa o fallback de "Mostrar imagem"
e o assistente de IA fica desligado.

## Tabela do jogo (Racha de Rua)
Está em `src/racha.js` (`TABLE`). Para mudar um carro ou adicionar outro, edite a linha:
`[número, nome, inspiração, largura, altura, rodaTrásX, rodaTrásY, rodaFrenteX, rodaFrenteY]`.
O nome do arquivo sai de `carro-NN-nome.png` (sem acento, minúsculo, com hífens).
Observação: nos carros 04 e 05 a base da roda fica 2 px acima da última linha na tabela original; o modo usa a base da roda como chão.

## Fluxo de atualização
1. Edite em `src/`.
2. `npm run check`.
3. Commit e push na `main`. O CI roda build e testes e guarda `garagem-pixel.html` como artefato.
