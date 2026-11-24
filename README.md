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

## Editor de sprites (aba)

Aba "Editor de sprites" no topo da página: uma grade de pixels para desenhar do zero ou retocar um carro.

- Ferramentas: lápis, borracha, balde, conta-gotas, linha, retângulo, elipse (cheios ou só contorno) e simetria. Botão direito apaga com o lápis.
- Atalhos: B, E, G, I, L, R, O, Ctrl+Z, Ctrl+Y.
- Cores: paleta Sweetie 16, cor livre, "Guardar cor" e as cores usadas no desenho.
- Tela de 1 a 256 px, zoom de 4× a 24×, grade, espelhar, limpar.
- Abre o carro do gerador, um carro da garagem ou um PNG; salva PNG em 1× a 8× ou envia para a garagem.
- O último desenho fica guardado no navegador.
- Código: `src/sprite.js` (lógica pura, testada em `test_sprite.js`) e a interface em `src/template.html`.
- Camadas: criar, duplicar, ordenar, esconder, renomear, mesclar e excluir (até 16). Frames: criar, duplicar, mover, excluir (até 64), casca de cebola do frame anterior e prévia animada com velocidade ajustável. Atalhos: vírgula e ponto trocam de frame, P toca.
- Salva PNG do frame, folha de frames e GIF animado. Abre uma folha de frames informando quantos frames ela tem.
- Estrutura (camadas, frames, tamanho) também entra no desfazer.
- Código: `src/sprite.js` (modelo de projeto e histórico), `src/editor_ui.js` (interface do editor, inlinada no módulo principal).
- Guia do Racha de Rua: escolha um carro da tabela e o editor mostra por cima do desenho o chão, a folga de 7 px, as rodas e as caixas de roda, com conferência (tamanho, rodas vazias, fundo, folga e cor do anel). "Ajustar a tela ao carro" muda o tamanho. Enviar para a garagem com o tamanho certo coloca o sprite no pacote .zip do jogo.
- Seleção (M): arraste para marcar uma área; arrastar dentro dela move (Alt copia); setas movem 1 px (Shift, 8 px); Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+A, Delete e Esc; espelhar a área. A área copiada pode ser colada em outro frame ou camada. Sem seleção, as setas movem a camada inteira. Desfazer e refazer desmarcam a seleção.
- Começar de novo: "Novo sprite" (topo, usa a largura e a altura de Tela) e "Apagar tudo" (mantém o tamanho). Abrir um carro, uma imagem ou a garagem também troca o sprite. Nenhum deles pede confirmação, porque todos entram no Desfazer.
- Pincéis de 1 a 4 px (quadrado ou redondo; [ e ] mudam o tamanho) para lápis, borracha, linha, retângulo e elipse. "Só onde já tem cor" pinta apenas pixels que já têm cor, sem invadir o fundo transparente (a borracha ignora essa trava).
- Próximas etapas planejadas: prévia em tamanho real, girar 90°, importar paleta.
