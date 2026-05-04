# Auditoria de golpes das fichas Firebase

Fonte: export Firestore gs://batalhas-de-gaal.appspot.com/2026-05-04T19:59:57_91098.

## Resumo

- Documentos exportados: 99
- Fichas com golpes: 97
- Fichas sem lista de golpes: 2
- Treinadores: 16
- Ocorrencias de golpes: 566
- Golpes unicos normalizados: 293
- Golpes unicos casados com moves-mm.json: 243
- Golpes unicos sem regra catalogada: 50
- Golpes automaticos pelo engine: 242
- Golpes com decisao runtime: 34
- Debuffs de usuario com alvo errado: 5

## Casos que exigem atencao

| Golpe | Ocorr. | Exemplos | Flags | Como Pokemon | Sistema atual | Como deveria sair |
| --- | --- | --- | --- | --- | --- | --- |
| Ally Switch | 3 | Delta/Malamar, Icarus/Dottler, Nala/Dottler | catalog;runtime_decision | User switches places with the friendly Pokémon opposite it. | teleport target=target res=dodge extras=Increased Range 1 / enhanced_trait target=self trait=seize_initiative linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Baton Pass | 2 | Ezenek/Clefairy, Shintaro/Mawile | catalog;runtime_decision | Allows the trainer to switch out the user and pass effects along to its replacement. | teleport target=target res=dodge | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Block | 2 | Delta/Malamar, Ezenek/Glalie | catalog;runtime_decision | Prevents the target from leaving battle. | nullify target=target res=will extras=Counter+Increased Range 1 | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Circle Throw | 1 | Ezenek/poliwrath | catalog;runtime_decision | Ends wild battles. Forces trainers to switch Pokémon. | damage target=target res=dodge / move_object target=target res=dodge linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Close Combat | 1 | Logan/Infernape | catalog;self_debuff;wrong_self_debuff_target | Lowers the user’s Defense and Special Defense by one stage after inflicting damage. | damage target=target res=will trait=thg/will / weaken target=target res=will trait=thg linked / weaken target=target res=will trait=will linked / weaken target=target res=fort trait=thg extras=Cumulative linked | Corrigir debuff de usuario: aplicar no atacante/self (Thg -1, Will -1), sem resistencia do alvo. |
| Disable | 5 | Ezenek/Darkrai, Ezenek/Gengar, Ezenek/Glalie, Ezenek/Nidoran ♀ | catalog;runtime_decision | Disables the target’s last used move for 1-8 turns. | nullify target=target res=will extras=Increased Range 1 | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Double Team (Alternative) | 1 | Delta/Zoroark | catalog;self_debuff;runtime_decision | Raises the user’s evasion by one stage. | concealment target=self / illusion target=field linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Draco Meteor | 1 | Delta/Hydreigon | catalog;self_debuff;wrong_self_debuff_target | Lowers the user’s Special Attack by two stages after inflicting damage. | damage target=target res=thg trait=int / weaken target=target res=fort trait=int linked / weaken target=target res=fort trait=int extras=Cumulative linked | Corrigir debuff de usuario: aplicar no atacante/self (Int -2), sem resistencia do alvo. |
| Electric Terrain | 2 | Felicia Fulgar/Raichu, James HiBorn/Magneton | catalog;runtime_decision | For five turns, prevents all Pokémon on the ground from sleeping and strengthens their Electric moves to 1.5× their power. | environment target=field extras=Increased Range 1+Area: Burst / nullify target=target res=will extras=Area: Burst linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Embargo | 3 | Delta/Weavile, Delta/Zoroark, Icarus/Mightyena | catalog;runtime_decision | Target cannot use held items. | nullify target=target res=will | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Fire Spin | 5 | Eneias/Centiskorch, Ezenek/pyroar, Logan/Infernape, Logan/Magmortar | catalog;runtime_decision | Prevents the target from fleeing and inflicts damage for 2-5 turns. | damage target=target res=thg extras=Increased Range 1 / nullify target=target res=dodge extras=Increased Duration 3 (Sustained) linked / damage target=target res=fort linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Foresight | 1 | Icarus/Riolu | catalog;runtime_decision | Forces the target to have no Evade, and allows it to be hit by Normal and Fighting moves even if it’s a Ghost. | nullify target=target res=will | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Gastro Acid | 1 | Ezenek/Seviper | catalog;runtime_decision | Nullifies target’s ability until it leaves battle. | nullify target=target res=will extras=Increased Range 1 | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Howl | 2 | Nyx/Houndour, Safira/shinx | catalog;self_debuff;needsReview | Raises the user’s Attack by one stage. | enhanced_trait target=self trait=stgr extras=Selective | NeedsReview: selective_without_area. |
| Hurricane (Alternative) | 1 | Ezenek/butterfree | catalog;secondary_guaranteed;runtime_decision | Has a 30% chance to confuse the target. | damage target=target res=thg extras=Increased Range 1+Area: Burst / move_object target=target res=thg extras=Area: Burst linked / environment target=field res=thg linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Ice Hammer | 1 | Ezenek/Crabominable | catalog;self_debuff;wrong_self_debuff_target | Lowers user’s Speed by one stage. | damage target=target res=thg / weaken target=target res=thg trait=initiative/dodge linked | Corrigir debuff de usuario: aplicar no atacante/self (Dodge & Initiative -1), sem resistencia do alvo. |
| Infestation | 5 | Ezenek/Araquanid, Ezenek/Dewpider, Ezenek/butterfree, Icarus/Dottler | catalog;runtime_decision | Prevents the target from fleeing and inflicts damage for 2-5 turns. | damage target=target res=thg extras=Increased Range 1 / nullify target=target res=dodge extras=Increased Duration 3 (Sustained) linked / damage target=target res=fort linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Mean Look | 5 | Delta/Bisharp, Delta/Muk-A, Delta/honchkrow, Ezenek/Gengar | catalog;runtime_decision | Prevents the target from leaving battle. | nullify target=target res=will extras=Counter+Increased Range 1 | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Misty Terrain | 1 | Shintaro/Mawile | catalog;runtime_decision | For five turns, protects all Pokémon on the ground from major status ailments and confusion, and halves the power of incoming Dragon moves. | environment target=field extras=Increased Range 1+Area: Burst / nullify target=target res=will extras=Area: Burst linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Overheat | 1 | Ezenek/pyroar | catalog;self_debuff;wrong_self_debuff_target | Lowers the user’s Special Attack by two stages after inflicting damage. | damage target=target res=thg trait=int / weaken target=target res=fort trait=int linked / weaken target=target res=fort trait=int extras=Cumulative linked | Corrigir debuff de usuario: aplicar no atacante/self (Int -2), sem resistencia do alvo. |
| Parting Shot | 2 | Amber/Pangoro, Ezenek/Pangoro | catalog;runtime_decision | Lowers all targets’ Attack and Special Attack by one stage. Makes the user switch out. | weaken target=target res=will extras=Increased Range 1 / teleport target=target res=will linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Psychic (Alternativo - Defletir / Redirecionar Golpes) | 1 | Delta/Zoroark | catalog;secondary_guaranteed;runtime_decision | Has a 10% chance to lower the target’s Special Defense by one stage. | deflect target=target res=will trait=will / weaken target=target res=will trait=will extras=Cumulative linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Roar | 5 | Delta/Hydreigon, Ezenek/pyroar, Icarus/Mightyena, Safira/shinx | catalog;runtime_decision | Immediately ends wild battles. Forces trainers to switch Pokémon. | teleport target=target res=will extras=Perception Area | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Rollout | 1 | James HiBorn/Golem | catalog;runtime_decision | Power doubles every turn this move is used in succession after the first, resetting after five turns. | damage target=target res=thg / nullify target=target res=thg extras=Increased Duration 2 (Sustained) linked / feature target=target res=thg linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Smack Down | 1 | James HiBorn/Golem | catalog;runtime_decision | Removes any immunity to Ground damage. | damage target=target res=thg / nullify target=target res=thg linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Spider Web | 3 | Eneias/Joltik, Ezenek/Araquanid, Ezenek/Dewpider | catalog;runtime_decision | Prevents the target from leaving battle. | nullify target=target res=will extras=Counter+Increased Range 1 | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Spikes | 1 | dtvcacaio/Crobat | catalog;runtime_decision | Scatters Spikes, hurting opposing Pokémon that switch in. | create target=field extras=Increased Range 1 / damage target=target res=thg extras=Area: Cloud linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Stealth Rock | 3 | Eneias/Dwebble, Ezenek/Golem-A, Ezenek/donphan | catalog;runtime_decision | Causes damage when opposing Pokémon switch in. | create target=field extras=Increased Range 1 / damage target=target res=thg extras=Area: Cloud linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Sticky Web | 1 | Ezenek/Dewpider | catalog;runtime_decision | Movimento de status do tipo Bug. Alcance à distância. | create target=field res=fort extras=Increased Range 1 / affliction target=target res=fort cond=poisoned/poisoned/poisoned linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Stone Edge (Alternativo - Palissada de Estacas) | 1 | Shintaro/Lycanroc (Midnight) | catalog;runtime_decision | Has an increased chance for a critical hit. | create target=field res=thg extras=Improved Critical 1 / damage target=target res=thg linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Superpower | 1 | Delta/Malamar | catalog;self_debuff;wrong_self_debuff_target | Lowers the user’s Attack and Defense by one stage after inflicting damage. | damage target=target res=thg / weaken target=target res=thg trait=stgr linked | Corrigir debuff de usuario: aplicar no atacante/self (Stgr -1, Thg -1), sem resistencia do alvo. |
| Teleport | 3 | Delta/Gallade, Icarus/Dottler, James HiBorn/Espeon | catalog;runtime_decision | Immediately ends wild battles. No effect otherwise. | teleport target=target res=will | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Thief | 1 | Delta/honchkrow | catalog;runtime_decision | Takes the target’s item. | damage target=target res=thg / move_object target=target res=thg linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Topsy-Turvy | 1 | Delta/Malamar | catalog;runtime_decision | Inverts the target’s stat modifiers. | nullify target=target res=will extras=Increased Range 1 | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Toxic Spikes | 2 | Ezenek/Clefairy, Ezenek/Nidoran ♀ | catalog;runtime_decision | Scatters poisoned spikes, poisoning opposing Pokémon that switch in. | create target=field res=fort extras=Increased Range 1 / affliction target=target res=fort cond=poisoned/poisoned/poisoned linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| U-turn | 4 | Eneias/Yanma, Ezenek/butterfree, Teste Batalha/Butterfree, dtvcacaio/Crobat | catalog;runtime_decision | User must switch out after attacking. | damage target=target res=dodge / teleport target=target res=dodge linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Volt Switch | 5 | Eneias/Joltik, Ezenek/Emolga, Felicia Fulgar/Electivire, Felicia Fulgar/Raichu | catalog;runtime_decision | User must switch out after attacking. | damage target=target res=thg extras=Increased Range 1 / teleport target=target res=thg linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Whirlpool | 2 | Delta/Staryu, James HiBorn/Empoleon | catalog;runtime_decision | Prevents the target from leaving battle and inflicts 1/16 its max HP in damage for 2-5 turns. | damage target=target res=thg extras=Increased Range 1 / nullify target=target res=dodge extras=Increased Duration 3 (Sustained) linked / damage target=target res=fort linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Whirlwind | 1 | Teste Batalha/Butterfree | catalog;runtime_decision | Immediately ends wild battles. Forces trainers to switch Pokémon. | move_object target=target res=fort extras=Area (Burst)+Increased Range 1 | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Wrap | 1 | Ezenek/Seviper | catalog;runtime_decision | Prevents the target from fleeing and inflicts damage for 2-5 turns. | damage target=target res=thg / nullify target=target res=dodge extras=Increased Duration 3 (Sustained) linked / damage target=target res=fort linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| 4 Braços Extras | 1 | Amber/golisopod | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Andando na Floresta | 1 | Nala/Primeape | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Andar na Floresta | 1 | Logan/Pikachu | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Andar nos Sipós | 1 | Logan/Victribell | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Bad Dreans | 2 | Ezenek/Darkrai, Logan/Darkrai | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Batton pass | 1 | James HiBorn/Espeon | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Bolinha de ferro | 1 | James HiBorn/Ferrothorn | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Camoflagem | 1 | Nala/Sawsbuck | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Cavar Dano | 1 | Logan/Infernape | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Cross Chop | 1 | Nala/Primeape | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Dark Void | 2 | Ezenek/Darkrai, Logan/Darkrai | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Dark Void Area | 2 | Ezenek/Darkrai, Logan/Darkrai | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Deflect: Deflect 15 | 1 | Logan/Pikachu | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Dream Eater | 2 | Ezenek/Darkrai, Logan/Darkrai | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Emotional Resonance | 1 | Shintaro/Ponyta (Galar) | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Escalar | 2 | RCsar/chimchar, RCsar/chimchar | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Extrassensory | 1 | Nala/Noctowl | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Fire Punch | 2 | Ezenek/gengar (Mega), Ezenek/gengar (Mega) | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Gatinho mental | 1 | James HiBorn/Espeon | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Golpe Customizado | 1 | Jason/poliwag | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Guilliotine | 2 | Delta/Krabbynho, Nala/Kingler | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Hidro Pump | 1 | James HiBorn/Empoleon | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Ilusão | 1 | Amber/Starmie | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Imperatriz do mar | 1 | James HiBorn/Empoleon | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Leaf Poison | 1 | Logan/Victribell | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Magic Cylinder | 1 | James HiBorn/Empoleon | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Mind control | 1 | James HiBorn/Espeon | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Mjonir | 1 | Logan/Dragonite | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Movimentar na Floresta | 1 | RCsar/Doduo | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Nadar | 1 | Amber/Starmie | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Nightmare | 2 | Ezenek/Darkrai, Logan/Darkrai | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Novo Poder | 2 | James HiBorn/Dodrio, James HiBorn/Ferrothorn | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Phantom Trap | 1 | Ezenek/Gengar | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Psy Up | 1 | James HiBorn/Espeon | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Rapidinha | 1 | Nala/Sawsbuck | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Rock Throw | 1 | Shintaro/Lycanroc (Midnight) | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Salta Macaco | 1 | Nala/Primeape | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Salto | 1 | RCsar/Doduo | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Sense | 2 | RCsar/chimchar, RCsar/chimchar | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Sentido Aguçado | 1 | Nyx/yungoos | no_catalog | sem descricao Pokemon no catalogo | fallback: sem PowerRule no catalogo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |

## Debuffs no usuario

| Golpe | Flags | Pokemon | Sistema atual | Correcao |
| --- | --- | --- | --- | --- |
| Agility | catalog;self_debuff | Raises the user’s Speed by two stages. | enhanced_trait target=self res=will trait=dodge/initiative | OK pelo catalogo/engine atual. |
| Agillity | catalog;self_debuff | Raises the user’s Speed by two stages. | enhanced_trait target=self res=will trait=dodge/initiative | OK pelo catalogo/engine atual. |
| Bulk Up | catalog;self_debuff | Raises the user’s Attack and Defense by one stage. | enhanced_trait target=self trait=stgr / enhanced_trait target=self trait=thg linked | OK pelo catalogo/engine atual. |
| Calm Mind | catalog;self_debuff | Raises the user’s Special Attack and Special Defense by one stage. | enhanced_trait target=self res=will trait=int / enhanced_trait target=self res=will trait=will linked | OK pelo catalogo/engine atual. |
| Charge | catalog;self_debuff | Raises the user’s Special Defense by one stage. User’s Electric moves have doubled power next turn. | enhanced_trait target=self trait=will / enhanced_trait target=self linked | OK pelo catalogo/engine atual. |
| Charge Beam | catalog;self_debuff;secondary_guaranteed | Has a 70% chance to raise the user’s Special Attack by one stage. | damage target=target res=thg trait=int extras=Increased Range 1 / enhanced_trait target=self res=thg trait=int linked | OK pela regra da mesa: efeito secundario tratado como garantido quando declarado. |
| Close Combat | catalog;self_debuff;wrong_self_debuff_target | Lowers the user’s Defense and Special Defense by one stage after inflicting damage. | damage target=target res=will trait=thg/will / weaken target=target res=will trait=thg linked / weaken target=target res=will trait=will linked / weaken target=target res=fort trait=thg extras=Cumulative linked | Corrigir debuff de usuario: aplicar no atacante/self (Thg -1, Will -1), sem resistencia do alvo. |
| Coil | catalog;self_debuff | Raises the user’s Attack, Defense, and accuracy by one stage each. | enhanced_trait target=self trait=stgr / enhanced_trait target=self trait=thg linked / enhanced_trait target=self linked | OK pelo catalogo/engine atual. |
| Cosmic Power | catalog;self_debuff | Raises the user’s Defense and Special Defense by one stage. | enhanced_trait target=self res=will trait=thg / enhanced_trait target=self res=will linked | OK pelo catalogo/engine atual. |
| Cotton Guard | catalog;self_debuff | Raises the user’s Defense by three stages. | enhanced_trait target=self trait=thg | OK pelo catalogo/engine atual. |
| Double Team | catalog;self_debuff | Raises the user’s evasion by one stage. | enhanced_trait target=self | OK pelo catalogo/engine atual. |
| Double Team (Alternative) | catalog;self_debuff;runtime_decision | Raises the user’s evasion by one stage. | concealment target=self / illusion target=field linked | Automatiza com decisao em runtime para dado ausente/escolha do jogador. |
| Draco Meteor | catalog;self_debuff;wrong_self_debuff_target | Lowers the user’s Special Attack by two stages after inflicting damage. | damage target=target res=thg trait=int / weaken target=target res=fort trait=int linked / weaken target=target res=fort trait=int extras=Cumulative linked | Corrigir debuff de usuario: aplicar no atacante/self (Int -2), sem resistencia do alvo. |
| Dragon Dance | catalog;self_debuff | Raises the user’s Attack and Speed by one stage. | enhanced_trait target=self trait=stgr / enhanced_trait target=self trait=dodge/initiative linked | OK pelo catalogo/engine atual. |
| Harden | catalog;self_debuff | Raises the user’s Defense by one stage. | enhanced_trait target=self trait=thg | OK pelo catalogo/engine atual. |
| Hone Claws | catalog;self_debuff | Raises the user’s Attack and accuracy by one stage. | enhanced_trait target=self / enhanced_trait target=self linked | OK pelo catalogo/engine atual. |
| Howl | catalog;self_debuff;needsReview | Raises the user’s Attack by one stage. | enhanced_trait target=self trait=stgr extras=Selective | NeedsReview: selective_without_area. |
| Ice Hammer | catalog;self_debuff;wrong_self_debuff_target | Lowers user’s Speed by one stage. | damage target=target res=thg / weaken target=target res=thg trait=initiative/dodge linked | Corrigir debuff de usuario: aplicar no atacante/self (Dodge & Initiative -1), sem resistencia do alvo. |
| Iron Defense | catalog;self_debuff | Raises the user’s Defense by two stages. | enhanced_trait target=self trait=thg | OK pelo catalogo/engine atual. |
| Metal Claw | catalog;self_debuff;secondary_guaranteed | Has a 10% chance to raise the user’s Attack by one stage. | damage target=target res=thg / enhanced_trait target=self res=thg trait=stgr linked | OK pela regra da mesa: efeito secundario tratado como garantido quando declarado. |
| Minimize | catalog;self_debuff | Raises the user’s evasion by two stages. | enhanced_trait target=self | OK pelo catalogo/engine atual. |
| Overheat | catalog;self_debuff;wrong_self_debuff_target | Lowers the user’s Special Attack by two stages after inflicting damage. | damage target=target res=thg trait=int / weaken target=target res=fort trait=int linked / weaken target=target res=fort trait=int extras=Cumulative linked | Corrigir debuff de usuario: aplicar no atacante/self (Int -2), sem resistencia do alvo. |
| Power-Up Punch | catalog;self_debuff | Raises the user’s Attack by one stage after inflicting damage. | damage target=target res=thg / enhanced_trait target=self res=thg trait=stgr linked | OK pelo catalogo/engine atual. |
| Quiver Dance | catalog;self_debuff | Raises the user’s Special Attack, Special Defense, and Speed by one stage each. | enhanced_trait target=self / enhanced_trait target=self linked / enhanced_trait target=self linked / enhanced_trait target=self trait=dodge/initiative linked | OK pelo catalogo/engine atual. |
| Rock Polish | catalog;self_debuff | Raises the user’s Speed by two stages. | enhanced_trait target=self trait=dodge/initiative | OK pelo catalogo/engine atual. |
| Skull Bash | catalog;self_debuff | Raises the user’s Defense by one stage. User charges for one turn before attacking. | damage target=target res=thg / enhanced_trait target=self res=thg trait=thg linked | OK pelo catalogo/engine atual. |
| Superpower | catalog;self_debuff;wrong_self_debuff_target | Lowers the user’s Attack and Defense by one stage after inflicting damage. | damage target=target res=thg / weaken target=target res=thg trait=stgr linked | Corrigir debuff de usuario: aplicar no atacante/self (Stgr -1, Thg -1), sem resistencia do alvo. |
| Swords Dance | catalog;self_debuff | Raises the user’s Attack by two stages. | enhanced_trait target=self trait=stgr | OK pelo catalogo/engine atual. |
| Withdraw | catalog;self_debuff | Raises the user’s Defense by one stage. | enhanced_trait target=self trait=thg | OK pelo catalogo/engine atual. |

## Sem catalogo local

| Golpe | Ocorr. | Exemplos | Recomendacao |
| --- | --- | --- | --- |
| 4 Braços Extras | 1 | Amber/golisopod | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Andando na Floresta | 1 | Nala/Primeape | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Andar na Floresta | 1 | Logan/Pikachu | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Andar nos Sipós | 1 | Logan/Victribell | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Bad Dreans | 2 | Ezenek/Darkrai, Logan/Darkrai | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Batton pass | 1 | James HiBorn/Espeon | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Bolinha de ferro | 1 | James HiBorn/Ferrothorn | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Camoflagem | 1 | Nala/Sawsbuck | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Cavar Dano | 1 | Logan/Infernape | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Cross Chop | 1 | Nala/Primeape | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Dark Void | 2 | Ezenek/Darkrai, Logan/Darkrai | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Dark Void Area | 2 | Ezenek/Darkrai, Logan/Darkrai | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Deflect: Deflect 15 | 1 | Logan/Pikachu | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Dream Eater | 2 | Ezenek/Darkrai, Logan/Darkrai | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Emotional Resonance | 1 | Shintaro/Ponyta (Galar) | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Escalar | 2 | RCsar/chimchar, RCsar/chimchar | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Extrassensory | 1 | Nala/Noctowl | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Fire Punch | 2 | Ezenek/gengar (Mega), Ezenek/gengar (Mega) | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Gatinho mental | 1 | James HiBorn/Espeon | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Golpe Customizado | 1 | Jason/poliwag | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Guilliotine | 2 | Delta/Krabbynho, Nala/Kingler | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Hidro Pump | 1 | James HiBorn/Empoleon | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Ilusão | 1 | Amber/Starmie | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Imperatriz do mar | 1 | James HiBorn/Empoleon | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Leaf Poison | 1 | Logan/Victribell | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Magic Cylinder | 1 | James HiBorn/Empoleon | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Mind control | 1 | James HiBorn/Espeon | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Mjonir | 1 | Logan/Dragonite | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Movimentar na Floresta | 1 | RCsar/Doduo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Nadar | 1 | Amber/Starmie | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Nightmare | 2 | Ezenek/Darkrai, Logan/Darkrai | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Novo Poder | 2 | James HiBorn/Dodrio, James HiBorn/Ferrothorn | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Phantom Trap | 1 | Ezenek/Gengar | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Psy Up | 1 | James HiBorn/Espeon | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Rapidinha | 1 | Nala/Sawsbuck | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Rock Throw | 1 | Shintaro/Lycanroc (Midnight) | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Salta Macaco | 1 | Nala/Primeape | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Salto | 1 | RCsar/Doduo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Sense | 2 | RCsar/chimchar, RCsar/chimchar | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Sentido Aguçado | 1 | Nyx/yungoos | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Sentidos | 1 | RCsar/Doduo | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Sky Uppercut | 2 | Amber/Pangoro, Ezenek/Pangoro | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Smogscreen | 1 | Logan/Magmortar | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Smokescreen | 1 | Ezenek/Seviper | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Stockpille | 1 | Logan/Victribell | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Sweet Kiss | 1 | Nala/PICHU | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Tempestade Eletrica | 1 | Logan/Dragonite | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Visão Aguçada | 1 | Nala/Noctowl | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Voar | 1 | Logan/Dragonite | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |
| Vôo | 1 | Nala/Noctowl | Criar PowerRule v2/catalogado; hoje cairia em fallback generico por ficha. |