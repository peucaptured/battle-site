# 🧭 Aba de Iniciativa — Battle-Site

## Arquivos novos
- `initiative.js` — Classe `InitiativeUI` (lógica completa)
- `initiative-patch.js` — Conecta ao battle-site sem alterar o `main.js`

## Instalação (1 linha no index.html)

Encontre no final do `index.html`:
```html
  <script type="module" src="./main.js"></script>
  <script type="module" src="./combat-patch.js"></script>
</body>
```

Adicione o `initiative-patch.js` logo depois:
```html
  <script type="module" src="./main.js"></script>
  <script type="module" src="./combat-patch.js"></script>
  <script type="module" src="./initiative-patch.js"></script>
</body>
```

## NÃO precisa alterar mais nada
- NÃO mexe no `main.js`
- NÃO mexe no resto do `index.html`
- Os dois arquivos novos se encaixam diretamente no `#tab_initiative`

---

## O que a aba faz

### Lógica (igual ao app.py)
- Lê as **peças em campo** do `public_state/state.pieces`
- Lê e escreve **iniciativas** em `public_state/battle.initiative`
- Fórmula Pokémon: `d20 + mod_speed + ajuste`
- Fórmula Avatar/Treinador: apenas `ajuste`

### Tabela Speed → Mod
| Speed | Mod |
|-------|-----|
| 1–40  | -4  |
| 41–60 | -1  |
| 61–70 | 0   |
| 71–80 | +1  |
| 81–100| +2  |
|101–120| +4  |
| 121+  | +8  |

### Permissões
- **Owner / GM** → botão "Rolar todos", pode editar qualquer Pokémon, pode resetar
- **Jogador comum** → rola e edita apenas os próprios Pokémon

### Controles
1. **🎲 Rolar todos** (owner only) — rola d20 para todos os Pokémon em campo
2. **🎯 Rolar selecionado** — rola d20 para o Pokémon escolhido no select
3. **Campo "Ajuste"** — bônus manual por linha (editável de acordo com a permissão)
4. **💾 Salvar iniciativa** — persiste no Firebase (sincroniza entre jogadores)
5. **🔄 Resetar todos** (owner only) — zera tudo

### 🏁 Tabela de Ordem
Exibida abaixo das linhas, ordenada da maior para a menor iniciativa, igual ao dataframe do Streamlit.
