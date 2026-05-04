import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyCombatPatches,
  buildResistanceQueue,
  collectPendingReactions,
  getRulesEngineRegistry,
  resolveCombatEvent,
  validatePowerRule,
} from "../mm-rules-engine.js";
import {
  fallbackPowerRuleFromMove,
  mergeLiveMoveIntoPowerRule,
  normalizePowerName,
} from "../mm-power-catalog.js";
import {
  getAttackModifierSummary,
  resolveAttackHitAndCritical,
} from "../mm-attack-modifiers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const catalogFixture = JSON.parse(fs.readFileSync(path.join(root, "assets/rules/moves-mm.json"), "utf8"));

function catalogPower(name) {
  const key = normalizePowerName(name);
  const rule = (catalogFixture.moves || []).find((move) => normalizePowerName(move.name) === key);
  assert.ok(rule, `catalog rule not found for ${name}`);
  return rule;
}

function combatant(owner, pid, row, col, powers = []) {
  return {
    owner,
    pid,
    pieceId: `${owner}-${pid}`,
    row,
    col,
    hp: 6,
    stats: { speed: owner === "Guard" ? 10 : 5 },
    powers,
  };
}

function seededEnv(seed, fixedNow = "2026-05-04T00:00:00.000Z") {
  let t = seed >>> 0;
  return {
    rng: () => {
      t += 0x6D2B79F5;
      let r = t;
      r = Math.imul(r ^ (r >>> 15), r | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    },
    clock: () => fixedNow,
  };
}

function structureOf(value) {
  if (Array.isArray(value)) return value.map(structureOf);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, structureOf(value[key])]));
  }
  return typeof value;
}

const damageRule = {
  schema: "PowerRule",
  schemaVersion: 2,
  id: "test:damage",
  name: "Damage Test",
  effects: [{
    id: "e0",
    type: "damage",
    rank: { source: "fixed", value: 6 },
    resistance: "thg",
  }],
};

const deflectRule = {
  schema: "PowerRule",
  schemaVersion: 2,
  id: "test:deflect",
  name: "Deflect Test",
  action: "reaction",
  range: "ranged",
  effects: [{
    id: "e0",
    type: "deflect",
    rank: { source: "fixed", value: 8 },
    range: "ranged",
    reaction: true,
    parameters: { protectedTarget: "attack.target", rangeSquares: 6 },
  }],
};

test("registry exposes handlers for every known effect and planned modifier", () => {
  const registry = getRulesEngineRegistry();
  for (const [type, meta] of Object.entries(registry.effects)) {
    if (type === "custom") continue;
    assert.notEqual(meta.handler, "unsupported", `${type} should have a handler`);
  }
  for (const key of [
    "area",
    "selective",
    "linked",
    "alternate_effect",
    "secondary_effect",
    "reaction",
    "triggered",
    "cumulative",
    "progressive",
    "limited",
    "fades",
    "unreliable",
    "check_required",
    "sense_dependent",
    "side_effect",
    "tiring",
  ]) {
    assert.ok(registry.modifiers[key], `${key} should be handled`);
  }
});

test("catalog effects validate without unsupported handlers", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, "assets/rules/moves-mm.json"), "utf8"));
  const unsupported = [];
  for (const rule of catalog.moves || []) {
    const validation = validatePowerRule(rule);
    if (validation.status === "unsupported") {
      unsupported.push({ id: rule.id, name: rule.name, issues: validation.issues });
    }
  }
  assert.deepEqual(unsupported, []);
});

test("resistance event resolves damage and structured combat log", () => {
  const resolution = resolveCombatEvent({
    type: "resistanceCheck",
    powerRule: damageRule,
    actor: { owner: "A", pid: "1", pieceId: "A-1" },
    target: { owner: "B", pid: "1", pieceId: "B-1", hp: 6, conditions: { deg1: [], deg2: [], deg3: [] } },
    d20: 3,
    stats: { thg: 0 },
    rank: 6,
  });
  assert.equal(resolution.schemaVersion, 2);
  assert.equal(resolution.patches.find((patch) => patch.kind === "hp")?.after, 2);
  assert.ok(resolution.combatLog.entries.some((entry) => entry.kind === "roll"));
  assert.ok(resolution.combatLog.entries.some((entry) => entry.kind === "damage"));
});

test("open effects create pending decisions instead of inventing data", () => {
  const createRule = {
    id: "test:create",
    name: "Create Missing",
    effects: [{ id: "e0", type: "create", rank: { source: "fixed", value: 4 } }],
  };
  const validation = validatePowerRule(createRule);
  assert.equal(validation.status, "automatic");
  assert.deepEqual(validation.pendingDecisionTemplates[0].choices, ["shape", "location", "toughness"]);

  const resolution = resolveCombatEvent({
    type: "immediatePower",
    powerRule: createRule,
    actor: { owner: "A", pid: "1", pieceId: "A-1" },
    rank: 4,
  });
  assert.ok(resolution.pendingDecisions.some((decision) => decision.effectType === "create"));
});

test("resisted choice effects ask for runtime decisions after a failed resistance", () => {
  const moveObjectRule = {
    id: "test:move-object",
    name: "Move Object Missing",
    effects: [{
      id: "e0",
      type: "move_object",
      rank: { source: "fixed", value: 5 },
      resistance: "dodge",
    }],
  };
  const resolution = resolveCombatEvent({
    type: "resistanceCheck",
    powerRule: moveObjectRule,
    actor: { owner: "A", pid: "1", pieceId: "A-1" },
    target: { owner: "B", pid: "1", pieceId: "B-1", hp: 6, conditions: { deg1: [], deg2: [], deg3: [] } },
    d20: 2,
    stats: { dodge: 0 },
    rank: 5,
  });
  assert.ok(resolution.pendingDecisions.some((decision) => decision.effectType === "move_object"));
});

test("collectPendingReactions queues Deflect before attack resolution", () => {
  const attack = {
    type: "attackDeclared",
    attack: {
      actor: combatant("Attacker", "1", 0, 0),
      target: combatant("Target", "1", 2, 2),
      attackTotal: 18,
      defenseKey: "dodge",
      isArea: false,
      isPerception: false,
    },
  };
  const reactions = collectPendingReactions(attack, {
    combatants: [
      combatant("Attacker", "1", 0, 0),
      combatant("Target", "1", 2, 2),
      combatant("Guard", "1", 2, 4, [{ powerRule: deflectRule, moveName: "Deflect Test" }]),
    ],
  });
  assert.equal(reactions.length, 1);
  assert.equal(reactions[0].effectType, "deflect");
  assert.equal(reactions[0].reactor.owner, "Guard");
});

test("collectPendingReactions is deterministic without generated global IDs", () => {
  const attack = {
    type: "attackDeclared",
    id: "attack:deterministic",
    attack: {
      id: "attack:deterministic",
      actor: combatant("Attacker", "1", 0, 0),
      target: combatant("Target", "1", 2, 2),
      attackTotal: 18,
      defenseKey: "dodge",
      isArea: false,
      isPerception: false,
    },
  };
  const state = {
    combatants: [
      combatant("Target", "1", 2, 2),
      combatant("Guard", "1", 2, 4, [{ powerRule: deflectRule, moveName: "Deflect Test" }]),
    ],
  };
  assert.deepEqual(collectPendingReactions(attack, state), collectPendingReactions(attack, state));
});

test("Deflect resolves as a player-controlled reaction and can block", () => {
  const reaction = collectPendingReactions({
    type: "attackDeclared",
    attack: {
      actor: combatant("Attacker", "1", 0, 0),
      target: combatant("Target", "1", 2, 2),
      attackTotal: 18,
      defenseKey: "dodge",
      isArea: false,
      isPerception: false,
    },
  }, {
    combatants: [
      combatant("Target", "1", 2, 2),
      combatant("Guard", "1", 2, 4, [{ powerRule: deflectRule }]),
    ],
  })[0];

  const resolution = resolveCombatEvent({
    type: "reactionDecision",
    reaction,
    attack: { total_atk: 18, target_owner: "Target", target_pid: "1", target_id: "Target-1" },
  }, {}, { accept: true, reaction, d20: 8 });

  assert.equal(resolution.blocked, true);
  assert.equal(resolution.patches[0].kind, "attack_blocked");
  assert.ok(resolution.combatLog.entries.some((entry) => entry.kind === "blocked"));
});

test("Deflect without d20 or env rng creates a pending decision instead of rolling randomly", () => {
  const reaction = collectPendingReactions({
    type: "attackDeclared",
    id: "attack:deflect-pending",
    attack: {
      id: "attack:deflect-pending",
      actor: combatant("Attacker", "1", 0, 0),
      target: combatant("Target", "1", 2, 2),
      attackTotal: 18,
      defenseKey: "dodge",
      isArea: false,
      isPerception: false,
    },
  }, {
    combatants: [
      combatant("Target", "1", 2, 2),
      combatant("Guard", "1", 2, 4, [{ powerRule: deflectRule }]),
    ],
  })[0];

  const resolution = resolveCombatEvent({
    type: "reactionDecision",
    id: "reaction:deflect-pending",
    reaction,
    attack: { total_atk: 18, target_owner: "Target", target_pid: "1", target_id: "Target-1" },
  }, {}, { accept: true, reaction });

  assert.equal(resolution.blocked, undefined);
  assert.equal(resolution.pendingDecisions[0]?.decisionType, "deflectRoll");
  assert.equal(resolution.pendingDecisions[0]?.choices[0], "d20");
});

test("same seed replays identical reaction resolution and another seed preserves structure", () => {
  const reaction = collectPendingReactions({
    type: "attackDeclared",
    id: "attack:replay",
    attack: {
      id: "attack:replay",
      actor: combatant("Attacker", "1", 0, 0),
      target: combatant("Target", "1", 2, 2),
      attackTotal: 35,
      defenseKey: "dodge",
      isArea: false,
      isPerception: false,
    },
  }, {
    combatants: [
      combatant("Target", "1", 2, 2),
      combatant("Guard", "1", 2, 4, [{ powerRule: deflectRule }]),
    ],
  })[0];
  const event = {
    type: "reactionDecision",
    id: "reaction:replay",
    reaction,
    attack: { total_atk: 35, target_owner: "Target", target_pid: "1", target_id: "Target-1" },
  };

  const a = resolveCombatEvent(event, {}, { accept: true, reaction }, seededEnv(1234));
  const b = resolveCombatEvent(event, {}, { accept: true, reaction }, seededEnv(1234));
  const c = resolveCombatEvent(event, {}, { accept: true, reaction }, seededEnv(4321));

  assert.deepEqual(a, b);
  assert.notEqual(a.effectResults[0].d20, c.effectResults[0].d20);
  assert.deepEqual(structureOf(a), structureOf(c));
});

test("Deflect is not eligible against area or perception attacks", () => {
  const base = {
    actor: combatant("Attacker", "1", 0, 0),
    target: combatant("Target", "1", 2, 2),
    attackTotal: 18,
    defenseKey: "dodge",
  };
  const battleState = {
    combatants: [
      combatant("Target", "1", 2, 2),
      combatant("Guard", "1", 2, 4, [{ powerRule: deflectRule }]),
    ],
  };
  assert.equal(collectPendingReactions({ type: "attackDeclared", attack: { ...base, isArea: true } }, battleState).length, 0);
  assert.equal(collectPendingReactions({ type: "attackDeclared", attack: { ...base, isPerception: true } }, battleState).length, 0);
});

test("applyCombatPatches is pure and separate from UI persistence", () => {
  const state = { combatants: [combatant("B", "1", 0, 0)], activeEffects: [] };
  const next = applyCombatPatches(state, [{ kind: "hp", owner: "B", pid: "1", before: 6, after: 3, delta: -3 }]);
  assert.equal(state.combatants[0].hp, 6);
  assert.equal(next.combatants[0].hp, 3);
});

test("active effects are deterministic and resolvers do not mutate input state", () => {
  const protectionRule = {
    id: "test:protection",
    name: "Protection Test",
    effects: [{ id: "e0", type: "protection", rank: { source: "fixed", value: 3 }, duration: "sustained" }],
  };
  const actor = combatant("A", "1", 0, 0);
  const before = JSON.stringify(actor);
  const event = {
    type: "immediatePower",
    id: "event:protection",
    powerRule: protectionRule,
    actor,
    rank: 3,
  };

  const first = resolveCombatEvent(event);
  const second = resolveCombatEvent(event);

  assert.equal(JSON.stringify(actor), before);
  assert.deepEqual(first, second);
  assert.equal(first.patches[0]?.kind, "active_effect");
});

test("Unreliable without roll data asks for a runtime roll instead of using Math.random", () => {
  const unreliableRule = {
    id: "test:unreliable",
    name: "Unreliable Test",
    effects: [{
      id: "e0",
      type: "damage",
      rank: { source: "fixed", value: 6 },
      resistance: "thg",
      unreliable: true,
    }],
  };
  const resolution = resolveCombatEvent({
    type: "resistanceCheck",
    id: "event:unreliable",
    powerRule: unreliableRule,
    actor: { owner: "A", pid: "1", pieceId: "A-1" },
    target: { owner: "B", pid: "1", pieceId: "B-1", hp: 6, conditions: { deg1: [], deg2: [], deg3: [] } },
    d20: 3,
    stats: { thg: 0 },
    rank: 6,
  });

  assert.equal(resolution.pendingDecisions[0]?.choices[0], "unreliableRoll");
  assert.equal(resolution.effectResults[0]?.requiresRoll, true);
});

test("Pokemon self debuff notes convert catalog Weaken into self stat shifts", () => {
  const cases = [
    ["Overheat", { int: -2 }],
    ["Draco Meteor", { int: -2 }],
    ["Close Combat", { thg: -1, will: -1 }],
    ["Superpower", { stgr: -1, thg: -1 }],
    ["Ice Hammer", { initiative: -1, dodge: -1 }],
  ];

  for (const [name, expected] of cases) {
    const rule = mergeLiveMoveIntoPowerRule(catalogPower(name), { name, rank: 10 });
    const badTargetWeakens = rule.effects.filter((effect) => effect.type === "weaken" && effect.target === "target");
    assert.deepEqual(badTargetWeakens, [], `${name} should not debuff the target`);

    for (const [trait, delta] of Object.entries(expected)) {
      const shifts = rule.effects.filter((effect) => (
        effect.type === "enhanced_trait"
        && effect.target === "self"
        && Array.isArray(effect.traits)
        && effect.traits.includes(trait)
      ));
      const shift = shifts[0];
      assert.equal(shifts.length, 1, `${name} should create exactly one self shift for ${trait}`);
      assert.ok(shift, `${name} should create a self shift for ${trait}`);
      assert.equal(shift.statDeltas?.[trait] ?? shift.statDelta, delta, `${name} ${trait} delta`);
    }
  }
});

test("self debuffs from catalog apply to the actor, not the defender", () => {
  const rule = mergeLiveMoveIntoPowerRule(catalogPower("Overheat"), { name: "Overheat", rank: 12 });
  const resolution = resolveCombatEvent({
    type: "resistanceCheck",
    id: "event:overheat",
    powerRule: rule,
    actor: { owner: "A", pid: "1", pieceId: "A-1", hp: 6, statBoosts: {} },
    target: { owner: "B", pid: "1", pieceId: "B-1", hp: 6, conditions: { deg1: [], deg2: [], deg3: [] }, statBoosts: {} },
    d20: 20,
    stats: { thg: 99 },
    rank: 12,
  });

  const statPatches = resolution.patches.filter((patch) => patch.kind === "stat_boost");
  assert.deepEqual(statPatches.map((patch) => ({
    owner: patch.owner,
    pid: patch.pid,
    stat: patch.stat,
    delta: patch.delta,
  })), [{ owner: "A", pid: "1", stat: "int", delta: -2 }]);
});

test("fallback schema parses sheet build effects instead of generic move-only damage", () => {
  const rule = fallbackPowerRuleFromMove({
    name: "Teste Custom Debuff",
    rank: 9,
    type: "Ice",
    category: "Fisico",
    build: "Damage 9; Linked Weaken Initiative & Dodge 1 [Flaw: Limited (apenas o proprio usuario)]",
  });

  assert.equal(rule.schemaVersion, 2);
  assert.ok(rule.effects.some((effect) => effect.type === "damage"), "build should create Damage");
  assert.equal(rule.effects.some((effect) => effect.type === "weaken" && effect.target === "target"), false);

  for (const trait of ["initiative", "dodge"]) {
    const shift = rule.effects.find((effect) => effect.type === "enhanced_trait" && effect.traits?.includes(trait));
    assert.ok(shift, `build should create a self ${trait} shift`);
    assert.equal(shift.target, "self");
    assert.equal(shift.statDeltas?.[trait] ?? shift.statDelta, -1);
  }
});

test("fallback parser reads effect declarations embedded in move names", () => {
  const environmentRule = fallbackPowerRuleFromMove({ name: "Rain Dance: Environment 10", rank: 0 });
  assert.equal(environmentRule.source, "name_build");
  assert.equal(environmentRule.schemaVersion, 2);
  assert.equal(environmentRule.effects[0]?.type, "environment");
  assert.equal(environmentRule.effects[0]?.rank?.value, 10);

  const nullifyRule = fallbackPowerRuleFromMove({ name: "Disable: Nullify 22", rank: 0 });
  assert.equal(nullifyRule.source, "name_build");
  assert.equal(nullifyRule.effects[0]?.type, "nullify");
  assert.equal(nullifyRule.effects[0]?.rank?.value, 22);
  assert.ok(validatePowerRule(nullifyRule).pendingDecisionTemplates.some((decision) => decision.effectType === "nullify"));

  const mixedRule = fallbackPowerRuleFromMove({
    name: "Disable: Nullify 22",
    rank: 17,
    build: "Counters: Pokemon, DC 32; Effortless, Reaction 3: reaction, Simultaneous",
  });
  assert.equal(mixedRule.source, "name_build+sheet_modifiers");
  assert.equal(mixedRule.effects[0]?.type, "nullify");
});

test("fallback parser preserves Area declarations without brackets for Selective support powers", () => {
  const rule = fallbackPowerRuleFromMove({
    name: "Howl Variant",
    rank: 1,
    build: "Enhanced Stgr 1 (Sustained) (Affects Others; Limited: apenas aliados; Area: Cloud; Selective)",
  });
  assert.equal(rule.effects[0]?.type, "enhanced_trait");
  assert.equal(rule.effects[0]?.area?.type, "Cloud");
  assert.ok(rule.effects[0]?.extras.some((extra) => normalizePowerName(extra).includes("area") || normalizePowerName(extra) === "cloud"));
  assert.equal(validatePowerRule(rule).status, "automatic");
});

test("catalog Howl no longer needs review when Area is declared in raw text", () => {
  const validation = validatePowerRule(catalogPower("Howl"));
  assert.equal(validation.status, "automatic");
  assert.ok(validation.issues.some((issue) => issue.code === "selective_area_inferred"));
});

test("live sheet build wins over catalog while mandatory Pokemon self debuffs still apply", () => {
  const rule = mergeLiveMoveIntoPowerRule(catalogPower("Overheat"), {
    name: "Overheat",
    rank: 12,
    build: "Affliction 12 (Dazed, Stunned, Paralyzed) (Resisted by Fortitude)",
  });

  assert.equal(rule.source, "catalog+sheet_build");
  assert.equal(rule.effects.some((effect) => effect.type === "damage"), false, "catalog Damage should not override the sheet build");
  assert.equal(rule.effects[0]?.type, "affliction");
  assert.deepEqual(rule.effects[0]?.conditions.map((item) => item.condition), ["dazed", "stunned", "paralyzed"]);

  const selfDebuff = rule.effects.find((effect) => effect.type === "enhanced_trait" && effect.target === "self" && effect.traits?.includes("int"));
  assert.ok(selfDebuff, "Pokemon/Ga'Al self debuff should still be attached from the move identity");
  assert.equal(selfDebuff.statDeltas?.int, -2);
});

test("Pokemon base power applies global damage bonus thresholds", () => {
  const hydroPump = mergeLiveMoveIntoPowerRule(catalogPower("Hydro Pump"), {
    name: "Hydro Pump",
    rank: 10,
    build: "Damage 10",
  });
  const hydroQueue = buildResistanceQueue(hydroPump, { rank: 10 });
  assert.equal(hydroPump.damageBonus?.basePower, 110);
  assert.equal(hydroQueue[0]?.rankBase, 10);
  assert.equal(hydroQueue[0]?.damageBonus, 5);
  assert.equal(hydroQueue[0]?.rank, 15);

  const explosion = mergeLiveMoveIntoPowerRule(catalogPower("Explosion"), {
    name: "Explosion",
    rank: 10,
    build: "Damage 10",
  });
  const explosionQueue = buildResistanceQueue(explosion, { rank: 10 });
  assert.equal(explosion.damageBonus?.basePower, 250);
  assert.equal(explosionQueue[0]?.damageBonus, 10);
  assert.equal(explosionQueue[0]?.rank, 20);

  const draco = mergeLiveMoveIntoPowerRule(catalogPower("Draco Meteor"), {
    name: "Draco Meteor",
    rank: 7,
    build: "Damage 7 [Custom 0/r: Bonus de dano +10]",
  });
  const dracoQueue = buildResistanceQueue(draco, { rank: 7 });
  assert.equal(draco.damageBonus?.basePower, 130);
  assert.equal(dracoQueue[0]?.damageBonus, 5, "base power 130 is +5, not the legacy +10 text");
  assert.equal(dracoQueue[0]?.rank, 12);

  const lowCustomBonus = fallbackPowerRuleFromMove({
    name: "Custom Low Bonus",
    rank: 10,
    build: "Damage 10 [Custom +2 Damage]",
  });
  assert.equal(lowCustomBonus.damageBonus?.bonus || 0, 0, "non-threshold +2 text is not a base-power bonus");
});

test("linked effects use the saved move rank instead of their local rank", () => {
  const rule = fallbackPowerRuleFromMove({
    name: "Linked Rank Test",
    rank: 10,
    build: "Damage 10; Linked Weaken Will 1 (Resisted by Will); Linked Affliction 2 (Dazed, Stunned, Paralyzed; Resisted by Fortitude)",
  });
  const queue = buildResistanceQueue(rule, { rank: 10 });
  assert.deepEqual(queue.map((item) => ({
    type: item.type,
    rank: item.rank,
    rankBase: item.rankBase,
    damageBonus: item.damageBonus,
  })), [
    { type: "damage", rank: 10, rankBase: 10, damageBonus: 0 },
    { type: "weaken", rank: 10, rankBase: 10, damageBonus: 0 },
    { type: "affliction", rank: 10, rankBase: 10, damageBonus: 0 },
  ]);
});

test("attack modifiers automate Accurate, Inaccurate and Improved Critical", () => {
  const rule = fallbackPowerRuleFromMove({
    name: "Attack Modifier Test",
    rank: 8,
    build: "Damage 8; Accurate 2; Inaccurate 1; Improved Critical 1",
  });
  const summary = getAttackModifierSummary(rule);
  assert.equal(summary.accurateRanks, 2);
  assert.equal(summary.inaccurateRanks, 1);
  assert.equal(summary.attackBonus, 2);
  assert.equal(summary.criticalThreshold, 19);

  const crit = resolveAttackHitAndCritical({ roll: 19, totalAtk: 29, needed: 25, powerRule: rule });
  assert.equal(crit.hit, true);
  assert.equal(crit.critical, true);
  assert.equal(crit.critBonus, 5);

  const miss = resolveAttackHitAndCritical({ roll: 19, totalAtk: 20, needed: 25, powerRule: rule });
  assert.equal(miss.hit, false, "expanded critical range does not make 19 an automatic hit");
  assert.equal(miss.critical, false);
});

test("Pokemon/Ga'Al critical text and active Critical trait affect critical outcome", () => {
  const highCrit = mergeLiveMoveIntoPowerRule(catalogPower("Karate Chop"), {
    name: "Karate Chop",
    rank: 7,
  });
  assert.equal(getAttackModifierSummary(highCrit).criticalThreshold, 19);

  const alwaysCrit = fallbackPowerRuleFromMove({
    name: "Always Critical Test",
    rank: 7,
    build: "Damage 7 [Custom 0/r: Stgr Based]",
    description: "Always results in a critical hit.",
  });
  const guaranteed = resolveAttackHitAndCritical({ roll: 12, totalAtk: 24, needed: 20, powerRule: alwaysCrit });
  assert.equal(guaranteed.hit, true);
  assert.equal(guaranteed.critical, true);

  const focused = resolveAttackHitAndCritical({
    roll: 18,
    totalAtk: 25,
    needed: 20,
    powerRule: damageRule,
    attackerStats: { critical: 2 },
  });
  assert.equal(focused.critical, true);
  assert.equal(focused.criticalThreshold, 18);
});
