# Firebase Sheets M&M Move Audit

Input: `.codex-artifacts\sheets-export-decoded.json`

## Totals

- Sheets: 99
- Move occurrences: 566
- Unique moves: 297
- Catalog moves: 1069
- Self-debuff problems after normalization: 0

## Categories

- fullyAutomated: 345
- needsReview: 127
- requiresRuntimeDecision: 57
- automatedWithFallback: 35
- genericHandlerOnly: 2

## Unique Categories

- fullyAutomated: 157
- needsReview: 80
- requiresRuntimeDecision: 31
- automatedWithFallback: 28
- genericHandlerOnly: 1

## Sources

- catalog+sheet_build: 500
- sheet_build: 58
- name_build+sheet_modifiers: 6
- schema_v1_generic_fallback: 2

## Example Moves

### fullyAutomated

- Drain Punch (Pangoro) - catalog+sheet_build; effects: healing+damage
- Knock Off (Pangoro) - catalog+sheet_build; effects: damage
- Swords Dance (Pangoro) - catalog+sheet_build; effects: enhanced_trait
- Taunt (Pangoro) - catalog+sheet_build; effects: affliction
- Psychic (Starmie) - catalog+sheet_build; effects: damage+weaken
- Surf (Starmie) - catalog+sheet_build; effects: damage
- First Impression (golisopod) - catalog+sheet_build; effects: damage+enhanced_trait
- Iron Defense (golisopod) - catalog+sheet_build; effects: enhanced_trait

### needsReview

- Parting Shot (Pangoro) - catalog+sheet_build; effects: teleport+custom
- Surf (Pangoro) - catalog+sheet_build; effects: damage
- Recover (Starmie) - catalog+sheet_build; effects: healing
- Dive (Starmie) - catalog+sheet_build; effects: custom
- 4 Braços Extras (golisopod) - sheet_build; effects: feature
- Mean Look (Bisharp) - catalog+sheet_build; effects: custom
- Metal Burst (Bisharp) - catalog+sheet_build; effects: damage
- Mud Shot (Krabbynho) - catalog+sheet_build; effects: damage+custom

### automatedWithFallback

- Sky Uppercut (Pangoro) - sheet_build; effects: damage+leaping
- Nadar (Starmie) - sheet_build; effects: immunity+swimming
- Guilliotine (Krabbynho) - sheet_build; effects: damage
- Bad Dreans (Darkrai) - sheet_build; effects: damage
- Nightmare (Darkrai) - sheet_build; effects: damage
- Smokescreen (Seviper) - sheet_build; effects: weaken
- Imperatriz do mar (Empoleon) - sheet_build; effects: damage
- Psy Up (Espeon) - sheet_build; effects: enhanced_trait

### requiresRuntimeDecision

- Ilusão (Starmie) - sheet_build; effects: damage+illusion
- Guillotine (Bisharp) - catalog+sheet_build; effects: damage
- Teleport (Gallade) - catalog+sheet_build; effects: teleport
- Roar (Hydreigon) - catalog+sheet_build; effects: teleport
- Double Team (Alternative) (Zoroark) - catalog+sheet_build; effects: concealment+illusion
- Thief (honchkrow) - catalog+sheet_build; effects: damage+move_object
- Stealth Rock (Dwebble) - catalog+sheet_build; effects: create+damage
- Volt Switch (Joltik) - catalog+sheet_build; effects: damage+teleport

### genericHandlerOnly

- Fire Punch (gengar (Mega)) - schema_v1_generic_fallback; effects: damage

