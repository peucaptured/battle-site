# battle-site (HTML/JS)

Front-end 100% em **HTML/JS** para o combate em tempo real via **Firestore**.

## O que esta versão faz (preserva o que já funcionava)

✅ Conecta em `rooms/{rid}` e escuta em tempo real:

- `rooms/{rid}/players` (subcoleção)
- `rooms/{rid}/public_state/state`
- `rooms/{rid}/public_state/battle`
- `rooms/{rid}/actions` (últimas 20, debug)

✅ Envia ações **somente criando docs** em `rooms/{rid}/actions`:

- `ADD_LOG` → `{ type, by, payload: { text } }`
- `MOVE_PIECE` → `{ type, by, payload: { pieceId, row, col } }`

✅ UI inspirada no layout do seu app:

- Arena central renderizada em **Canvas** (grid 10x10 por padrão, respeita `gridSize` do state)
- Painel esquerdo: “Sua Equipe” + peças filtradas por `piece.owner == by`
- Painel direito: “Oponentes” agrupado por `piece.owner`
- Abas: Arena / Log completos; outras como placeholders conectados
- Dev tools (colapsável) preservando a visão JSON + envio manual

## Rodar local

> Importante: por usar ES Modules, abra com um servidor local (não duplo clique no HTML).

Opção 1 (Python):

```bash
python -m http.server 5173
```

Abra no navegador:

```text
http://localhost:5173/
```

Opção 2 (Node):

```bash
npx serve .
```

## Publicar

É um site estático. Qualquer host serve (Firebase Hosting, GitHub Pages, Netlify, etc.).

Se quiser Firebase Hosting:

```bash
firebase init hosting
firebase deploy
```

## Notas

- Sprites: tenta `piece.spriteUrl` se existir; caso contrário usa sprites do repositório PokeAPI (pode falhar em ids custom).
- Performance: Firestore atualiza o estado local; o Canvas é desenhado em loop com `requestAnimationFrame`.

## Dex (sprites) e mapa

### Sprites com PID custom

Se as peças no Firestore usam `pid` que não é o NatDex, você tem 2 opções:

1) **Melhor**: adicionar `spriteUrl` em cada `piece` no `public_state/state` (server-side).
2) **Sem mexer no backend**: carregar um JSON de mapeamento `pid -> nome` pelo Dev Tools:
   - Crie um arquivo JSON como o exemplo em `assets/pokedex.example.json`.
   - No site, abra **Dev tools** → **Dex / Sprites** e carregue o arquivo.

O site então tenta buscar a imagem pelo nome (via sprites públicos) e faz cache no navegador.

### Mapa

- Se `public_state/state` tiver `mapUrl` (ou `backgroundUrl`), o canvas usa esse PNG como fundo.
- Alternativamente, você pode forçar uma URL pelo Dev Tools em **Mapa (opcional)**.
- Se não houver URL, o site gera um mapa procedural simples baseado em `seed` + `theme`.
