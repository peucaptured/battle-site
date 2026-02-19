# ⚔️ Aba de Combate — Battle-Site

## O que foi feito

A aba **⚔️ Combate** do battle-site agora replica **toda** a calculadora de combate do `app.py` (Streamlit).

### Arquivos novos

| Arquivo | Descrição |
|---|---|
| `combat.js` | Classe `CombatUI` — toda a lógica de combate (fases, rolagens, defesa) |
| `combat-patch.js` | Script de integração — conecta o CombatUI ao battle-site sem modificar `main.js` |
| `index.html` | Versão atualizada — placeholder do combate substituído por container funcional |
| `combat-styles.css` | CSS extra para o combate (já inline no index.html) |

### Fases do combate (idênticas ao app.py)

```
idle → setup → [Normal: rola ataque] → hit_confirmed → waiting_defense → resultado → idle
                                      → missed → idle
             → [Área: lançar]        → aoe_defense → waiting_defense → resultado → idle
```

### O que cada fase faz

1. **idle** — Botão "Nova Batalha (Atacar)" (só para players)
2. **setup** — Atacante escolhe:
   - Pokémon atacante (peças no mapa)
   - Alvo (peças de oponentes)
   - Modo: Normal ou Área
   - Golpe (da ficha salva no Firestore) ou manual
   - Alcance: Distância (Dodge) ou Corpo-a-corpo (Parry)
3. **hit_confirmed** — Atacante define Rank do dano / efeito
4. **missed** — Ataque errou, encerrar
5. **aoe_defense** — Defensor rola defesa de área (reduz rank pela metade se sucesso)
6. **waiting_defense** — Defensor escolhe resistência (Dodge/Parry/Fort/Will/THG)
   - Rola d20 + stat
   - Calcula graus de falha (M&M 3e: CD - check, 1 grau a cada 5 pontos)

### Dados sincronizados do Firebase

| Coleção | Uso |
|---|---|
| `rooms/{rid}/public_state/battle` | Estado do combate (leitura/escrita) |
| `rooms/{rid}/public_state/state` | Peças no tabuleiro (leitura) |
| `rooms/{rid}/public_state/party_states` | Stats dos Pokémon (leitura) |
| `trainers/{name}/sheets` | Fichas com golpes (leitura) |

### Como usar

1. Substitua o `index.html` antigo pelo novo
2. Coloque `combat.js` e `combat-patch.js` na mesma pasta
3. Rode normalmente: `python -m http.server 5173`
4. Conecte na sala, vá na aba ⚔️ Combate

### Regras M&M 3e implementadas

- d20 natural 1 = erro automático
- d20 natural 20 = acerto + crítico (+5 no rank)
- Defesa = stat + 10 (Dodge ou Parry)
- Resistência = d20 + stat vs CD (15 + rank para dano, 10 + rank para efeito)
- Graus de falha = ceil((CD - check) / 5)
- Área: Dodge CD 10 + nível, sucesso = rank / 2
