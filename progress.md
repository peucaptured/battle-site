Original prompt: Quando nÃ£o tem ID na ficha, o sistema nÃ£o devolve o pokÃ©mon corretamente, o sprite na aba de ficha

- InvestigaÃ§Ã£o inicial: projeto localizado em `battle-site/`; bug reportado na aba de fichas quando a ficha nÃ£o possui ID.
- PrÃ³ximo passo: localizar a resoluÃ§Ã£o de sprite/dados do PokÃ©mon para a ficha selecionada e aplicar fallback por nome/espÃ©cie.
- CorreÃ§Ã£o aplicada em `main.js`: a aba de fichas e o inspector agora resolvem a ficha por `pokemon.id`, `linked_pid`, PID da party e `pokemon.name`, nessa ordem, em vez de depender sÃ³ do ID da ficha.
- Ajuste de sprite: `_artUrlFromPidForSheets` agora aceita nome/forma direta, e os renders de card/detalhe usam fallback por nome quando o ID vier vazio ou `0`.
- Ajuste de estado/seleÃ§Ã£o: HP, shiny e seleÃ§Ã£o da ficha passaram a usar a chave resolvida da ficha, evitando cair no placeholder de pokÃ©bola quando o documento nÃ£o traz ID vÃ¡lido.
- ValidaÃ§Ã£o: `node --check main.js` sem erro; pÃ¡gina abriu em `http://127.0.0.1:4173/index.html` sem erros no console.
- Novo trabalho: iniciativa e scoreboard agora sincronizam a rodada atual apenas com peÃ§as realmente em campo, removendo da vez quem saiu do tabuleiro sem reordenar a rodada em andamento.
- Virada de rodada ajustada em `main.js` e `preprep-patch.js`: a prÃ³xima rodada reconstrÃ³i `turn_state.order` a partir do tabuleiro atual + `battle.initiative`, entÃ£o mudanÃ§as feitas na aba de iniciativa passam a valer no inÃ­cio da rodada seguinte.
- ValidaÃ§Ã£o atual: parse de `main.js`, `scoreboard-patch.js` e `preprep-patch.js` confirmado com `node --experimental-vm-modules`; nÃ£o consegui validar no navegador porque o `http.server` nÃ£o subiu dentro do sandbox.
- Ajuste extra no scoreboard: o patch agora usa `public_state/state.seen` para manter o sprite visÃ­vel depois que um pokÃ©mon jÃ¡ foi revelado, mesmo fora do campo.
- Novo trabalho: a aba `Fichas` agora lê `moves[].notes` direto da ficha persistida e mostra o texto abaixo da descrição do golpe.
- Ajuste de UX em `main.js`: o inspector espelhado da aba `Fichas` passou a iniciar com os golpes recolhidos, alinhando o comportamento com o detalhe principal da aba.
- Validação atual: `node --check main.js` sem erro. Não consegui fechar a validação visual no Playwright porque o servidor HTTP temporário derrubado pelo shell respondeu `ERR_EMPTY_RESPONSE` para `main.js` e os patches antes do app concluir a carga.
