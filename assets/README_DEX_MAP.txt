Dex / Sprites (battle-site)
==========================

O battle-site desenha sprites das peças (pokémons) e tenta ser compatível com o seu Streamlit.

Resolução de sprite (ordem):
1) `piece.spriteUrl` ou `piece.sprite_url` (se existir no Firestore).
2) Se `piece.pid` começar com `EXT:`: o texto após `EXT:` é tratado como nome do Pokémon.
3) Se houver um mapeamento local (JSON) com `pid -> nome`: usa esse nome.
4) Se `pid` for numérico: tenta sprite do PokeAPI (NatDex).

Formato do JSON (exemplo):
{
  "218": "Bronzong",
  "303": "Mawile"
}

Como usar:
- No battle-site, abra "Dev tools" e use "Dex / Sprites" para carregar o JSON.
- O arquivo fica salvo no `localStorage` do navegador.
