import {
  effectRequiresMmDecision,
  getMmEffectMeta,
  inferMmDurationTurns,
  isMmResistanceEffect,
  isMmSupportEffect,
  isMmTrackableActiveEffect,
  makeMmActiveEffectId,
  validatePowerRule,
} from "./mm-rulebook.js?v=20260501mm8";

function safeStr(value) {
  return value == null ? "" : String(value).trim();
}

function safeInt(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeResistance(value) {
  const raw = safeStr(value).toLowerCase();
  if (["toughness", "resistencia", "resistance"].includes(raw)) return "thg";
  if (raw === "fortitude") return "fort";
  return raw || "thg";
}

function resolveEffectRank(effect, fallbackRank = 0) {
  const rank = effect?.rank || {};
  if (rank.source === "fixed" && Number.isFinite(Number(rank.value))) return safeInt(rank.value, fallbackRank);
  return safeInt(fallbackRank, 0);
}

export function isResistanceEffect(effect) {
  return isMmResistanceEffect(safeStr(effect?.type));
}

export function buildResistanceQueue(powerRule, options = {}) {
  const fallbackRank = safeInt(options.rank, 0);
  const critBonus = safeInt(options.critBonus, 0);
  const fallbackResistance = normalizeResistance(options.fallbackResistance || powerRule?.resistance || "thg");
  const effects = Array.isArray(powerRule?.effects) ? powerRule.effects : [];
  const queue = [];

  for (const effect of effects) {
    if (!isResistanceEffect(effect)) continue;
    const rank = resolveEffectRank(effect, fallbackRank);
    const type = safeStr(effect.type);
    const baseDc = type === "damage" ? 15 : 10;
    const resistance = normalizeResistance(effect.resistance || fallbackResistance);
    queue.push({
      effectId: safeStr(effect.id) || `e${queue.length}`,
      type,
      label: safeStr(effect.label || type),
      rank,
      baseDc,
      dc: baseDc + rank + critBonus,
      resistance,
      effect,
    });
  }

  if (!queue.length) {
    const isEffect = !!options.fallbackIsEffect;
    const baseDc = isEffect ? 10 : 15;
    queue.push({
      effectId: "fallback",
      type: isEffect ? "affliction" : "damage",
      label: isEffect ? "Affliction" : "Damage",
      rank: fallbackRank,
      baseDc,
      dc: baseDc + fallbackRank + critBonus,
      resistance: fallbackResistance,
      effect: null,
    });
  }

  return queue;
}

function conditionBucketForDegree(degree) {
  if (degree <= 1) return "deg1";
  if (degree === 2) return "deg2";
  return "deg3";
}

function normalizeConditionId(value) {
  return safeStr(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function addConditionPatch(patches, target, conditionId, degree, source) {
  const id = normalizeConditionId(conditionId);
  if (!id || !target?.pieceId) return;
  const before = normalizeConditionState(target.conditions);
  const after = normalizeConditionState(target.conditions);
  const bucket = conditionBucketForDegree(degree);
  if (!after[bucket].includes(id)) after[bucket].push(id);
  patches.push({
    kind: "conditions",
    pieceId: target.pieceId,
    owner: target.owner,
    pid: target.pid,
    before: { mm_conditions: before, pokemon_conditions: target.pokemonConditions || [] },
    after: { mm_conditions: after, pokemon_conditions: target.pokemonConditions || [] },
    source,
  });
  target.conditions = after;
}

function normalizeConditionState(state) {
  const src = state && typeof state === "object" ? state : {};
  return {
    deg1: Array.isArray(src.deg1) ? src.deg1.map(normalizeConditionId).filter(Boolean) : [],
    deg2: Array.isArray(src.deg2) ? src.deg2.map(normalizeConditionId).filter(Boolean) : [],
    deg3: Array.isArray(src.deg3) ? src.deg3.map(normalizeConditionId).filter(Boolean) : [],
  };
}

function degreeFromCheck(dc, total) {
  const diff = safeInt(dc, 0) - safeInt(total, 0);
  return diff <= 0 ? 0 : clamp(Math.ceil(diff / 5), 1, 4);
}

function traitList(effect) {
  const traits = Array.isArray(effect?.traits) ? effect.traits : [];
  return traits.map((x) => safeStr(x).toLowerCase()).filter(Boolean);
}

function addBoostPatch(patches, target, stat, delta, source) {
  const key = safeStr(stat).toLowerCase();
  if (!key || !target?.owner || !target?.pid || !delta) return;
  const boosts = target.statBoosts || {};
  const before = safeInt(boosts[key], 0);
  const after = before + safeInt(delta, 0);
  patches.push({
    kind: "stat_boost",
    owner: target.owner,
    pid: target.pid,
    stat: key,
    before,
    after,
    delta: after - before,
    source,
  });
  target.statBoosts = { ...(target.statBoosts || {}), [key]: after };
}

function addAdjudication(patches, effect, reason, target) {
  patches.push({
    kind: "adjudication",
    effectId: safeStr(effect?.id),
    effectType: safeStr(effect?.type || "custom"),
    label: safeStr(effect?.label || effect?.type || "Efeito"),
    reason,
    owner: target?.owner || "",
    pid: target?.pid || "",
    raw: safeStr(effect?.raw),
  });
}

function targetIdentity(target, actor) {
  const src = target || actor || {};
  return {
    owner: safeStr(src.owner),
    pid: safeStr(src.pid),
    pieceId: safeStr(src.pieceId),
  };
}

function addDecisionPatch(patches, effect, reason, target, actor, extra = {}) {
  const meta = getMmEffectMeta(effect?.type);
  const ident = targetIdentity(target, actor);
  patches.push({
    kind: "mm_decision",
    effectId: safeStr(effect?.id),
    effectType: safeStr(effect?.type || "custom"),
    label: safeStr(effect?.label || effect?.type || "Efeito"),
    reason,
    choices: Array.isArray(meta.choices) ? meta.choices : [],
    requiresAdjudication: true,
    owner: ident.owner,
    pid: ident.pid,
    pieceId: ident.pieceId,
    raw: safeStr(effect?.raw),
    ...extra,
  });
}

function addActiveEffectPatch(patches, effect, target, actor, rank, powerRule, extra = {}) {
  const meta = getMmEffectMeta(effect?.type);
  const ident = targetIdentity(target, actor);
  const durationTurns = inferMmDurationTurns(effect, powerRule);
  const scope = safeStr(effect?.target) === "field" || meta.kind === "field" ? "field" : "combatant";
  patches.push({
    kind: "active_effect",
    id: makeMmActiveEffectId("ae"),
    owner: ident.owner,
    pid: ident.pid,
    pieceId: ident.pieceId,
    effectId: safeStr(effect?.id),
    effectType: safeStr(effect?.type || "custom"),
    label: safeStr(effect?.label || effect?.type || "Efeito"),
    rank: Math.max(1, safeInt(rank, 1)),
    duration: safeStr(effect?.duration || powerRule?.duration || "scene"),
    remainingTurns: durationTurns,
    tickPolicy: scope === "field" ? "round_end" : "owner_turn_end",
    scope,
    flags: {
      secondaryEffect: !!effect?.secondaryEffect,
      fades: !!effect?.fades,
      unreliable: !!effect?.unreliable,
      reaction: !!effect?.reaction,
      selective: !!effect?.selective,
      limited: !!effect?.limited,
    },
    automation: meta.automation,
    requiresAdjudication: effectRequiresMmDecision(effect),
    raw: safeStr(effect?.raw),
    ...extra,
  });
}

function addSecondaryEffectPatch(patches, effect, target, actor, rank, powerRule, source) {
  if (!effect?.secondaryEffect) return;
  addActiveEffectPatch(patches, {
    ...effect,
    id: `${safeStr(effect.id) || "effect"}:secondary`,
    type: "secondary_effect",
    label: `${safeStr(effect.label || effect.type || "Effect")} - Secondary Effect`,
    secondaryEffect: true,
    requiresChoice: false,
    duration: "round",
  }, target, actor, rank, powerRule, {
    trigger: "next_turn",
    linkedSource: source || { effectId: safeStr(effect?.id), type: safeStr(effect?.type) },
    requiresAdjudication: true,
  });
}

function resolveUnreliableCheck(effect, input, index = 0) {
  if (!effect?.unreliable) return null;
  const id = safeStr(effect?.id);
  const rolls = input?.unreliableRolls && typeof input.unreliableRolls === "object" ? input.unreliableRolls : {};
  const rawRoll = rolls[id] ?? rolls[index] ?? input?.unreliableRoll;
  const roll = rawRoll == null
    ? Math.floor(Math.random() * 100) + 1
    : clamp(safeInt(rawRoll, 1), 1, 100);
  return {
    roll,
    threshold: 50,
    success: roll <= 50,
  };
}

function addUnreliablePatch(patches, effect, check, target, actor) {
  if (!check) return;
  const ident = targetIdentity(target, actor);
  patches.push({
    kind: "unreliable_check",
    effectId: safeStr(effect?.id),
    effectType: safeStr(effect?.type || "custom"),
    label: safeStr(effect?.label || effect?.type || "Efeito"),
    owner: ident.owner,
    pid: ident.pid,
    pieceId: ident.pieceId,
    roll: check.roll,
    threshold: check.threshold,
    success: !!check.success,
    raw: safeStr(effect?.raw),
  });
}

export function resolveMmPowerResistance(input) {
  const {
    powerRule,
    target,
    d20,
    stats = {},
    rank = 0,
    critBonus = 0,
    fallbackIsEffect = false,
    fallbackResistance = "thg",
  } = input || {};
  const actor = input?.actor || null;
  const queue = buildResistanceQueue(powerRule, { rank, critBonus, fallbackIsEffect, fallbackResistance });
  const patches = [];
  const effectResults = [];

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const item = queue[queueIndex];
    const resistance = normalizeResistance(item.resistance);
    const statVal = safeInt(stats[resistance], 0);
    const total = safeInt(d20, 0) + statVal;
    const degree = degreeFromCheck(item.dc, total);
    const effect = item.effect || {};
    const unreliable = resolveUnreliableCheck(effect, input, queueIndex);
    addUnreliablePatch(patches, effect, unreliable, target, actor);

    if (unreliable && !unreliable.success) {
      effectResults.push({
        effectId: item.effectId,
        type: item.type,
        label: item.label,
        resistance,
        d20: safeInt(d20, 0),
        statVal,
        total,
        dc: item.dc,
        degree: 0,
        success: true,
        skipped: true,
        unreliable,
      });
      continue;
    }

    effectResults.push({
      effectId: item.effectId,
      type: item.type,
      label: item.label,
      resistance,
      d20: safeInt(d20, 0),
      statVal,
      total,
      dc: item.dc,
      degree,
      success: degree === 0,
      unreliable,
    });

    if (degree === 0) continue;

    if (item.type === "damage") {
      const hpBefore = safeInt(target?.hp, 6);
      const hpAfter = clamp(hpBefore - degree, 0, 6);
      patches.push({
        kind: "hp",
        owner: target?.owner || "",
        pid: target?.pid || "",
        pieceId: target?.pieceId || "",
        before: hpBefore,
        after: hpAfter,
        delta: hpAfter - hpBefore,
        source: { effectId: item.effectId, type: item.type },
      });
      target.hp = hpAfter;
      if (hpAfter <= 0) addConditionPatch(patches, target, "incapacitated", 3, { effectId: item.effectId, type: "damage_ko" });
      addSecondaryEffectPatch(patches, effect, target, actor, item.rank, powerRule, { effectId: item.effectId, type: "damage" });
    } else if (item.type === "affliction") {
      const conditions = Array.isArray(effect.conditions) ? effect.conditions : [];
      const chosen = conditions.find((cond) => safeInt(cond.degree, 0) === clamp(degree, 1, 3))
        || conditions[conditions.length - 1]
        || { condition: degree >= 3 ? "incapacitated" : degree === 2 ? "stunned" : "dazed" };
      addConditionPatch(patches, target, chosen.condition, clamp(degree, 1, 3), { effectId: item.effectId, type: "affliction" });
      addSecondaryEffectPatch(patches, effect, target, actor, item.rank, powerRule, { effectId: item.effectId, type: "affliction" });
    } else if (item.type === "weaken") {
      const traits = traitList(effect);
      if (traits.length) {
        for (const trait of traits) addBoostPatch(patches, target, trait, -Math.max(1, item.rank || 1) * degree, { effectId: item.effectId, type: "weaken" });
        addSecondaryEffectPatch(patches, effect, target, actor, item.rank, powerRule, { effectId: item.effectId, type: "weaken" });
      } else {
        addAdjudication(patches, effect, "Weaken sem trait estruturado.", target);
      }
    } else if (item.type === "move_object") {
      addDecisionPatch(patches, effect, "Move Object resistido teve efeito; escolha direcao, distancia e colisao antes de mover a peca.", target, actor, {
        degree,
        rank: item.rank,
        dc: item.dc,
      });
    } else if (item.type === "teleport") {
      addDecisionPatch(patches, effect, "Teleport Attack resistido teve efeito; escolha destino valido antes de reposicionar.", target, actor, {
        degree,
        rank: item.rank,
        dc: item.dc,
      });
    } else if (item.type === "nullify") {
      addDecisionPatch(patches, effect, "Nullify teve sucesso; escolha o efeito ativo/poder alvo para cancelar.", target, actor, {
        degree,
        rank: item.rank,
        dc: item.dc,
      });
    } else if (item.type === "transform") {
      addActiveEffectPatch(patches, effect, target, actor, item.rank, powerRule, {
        degree,
        requiresAdjudication: true,
      });
    } else if (item.type === "mind_reading") {
      addDecisionPatch(patches, effect, "Mind Reading teve graus de sucesso; escolha o nivel de informacao acessado.", target, actor, {
        degree,
        rank: item.rank,
        dc: item.dc,
      });
    } else {
      addDecisionPatch(patches, effect, "Efeito resistido ainda exige handler especifico.", target, actor, {
        degree,
        rank: item.rank,
        dc: item.dc,
      });
    }
  }

  const nonResistance = (Array.isArray(powerRule?.effects) ? powerRule.effects : [])
    .filter((effect) => !isResistanceEffect(effect));
  for (const effect of nonResistance) {
    const type = safeStr(effect.type);
    const effectRank = Math.max(1, resolveEffectRank(effect, rank || powerRule?.live?.rank || 1));
    const meta = getMmEffectMeta(type);
    const unreliable = resolveUnreliableCheck(effect, input, safeInt(safeStr(effect.id).replace(/\D+/g, ""), 0));
    addUnreliablePatch(patches, effect, unreliable, target, actor);
    if (unreliable && !unreliable.success) {
      effectResults.push({ effectId: effect.id, type, rank: effectRank, automatic: true, skipped: true, unreliable });
      continue;
    }
    if (meta.automation === "ignored") {
      effectResults.push({ effectId: effect.id, type, rank: effectRank, automatic: true, ignored: true });
    } else if (isMmTrackableActiveEffect(type)) {
      addActiveEffectPatch(patches, effect, target, actor, effectRank, powerRule);
    } else if (isMmSupportEffect(type)) {
      const supportTarget = safeStr(effect.target) === "target" ? target : (actor || target);
      if (type === "healing" && supportTarget) {
        const hpBefore = safeInt(supportTarget?.hp, 6);
        const hpAfter = clamp(hpBefore + effectRank, 0, 6);
        patches.push({
          kind: "hp",
          owner: supportTarget?.owner || "",
          pid: supportTarget?.pid || "",
          pieceId: supportTarget?.pieceId || "",
          before: hpBefore,
          after: hpAfter,
          delta: hpAfter - hpBefore,
          source: { effectId: effect.id, type },
        });
        supportTarget.hp = hpAfter;
      } else if (type === "enhanced_trait" && supportTarget) {
        const traits = traitList(effect);
        if (traits.length) {
          for (const trait of traits) addBoostPatch(patches, supportTarget, trait, effectRank, { effectId: effect.id, type });
        } else {
          addAdjudication(patches, effect, "Enhanced Trait sem trait estruturado.", supportTarget);
        }
      } else {
        addDecisionPatch(patches, effect, "Efeito de suporte linkado precisa de alvo explicito.", target, actor);
      }
    } else {
      addDecisionPatch(patches, effect, "Efeito nao resistido registrado para revisao.", target, actor);
    }
  }

  return makeResolution({
    kind: "resistance",
    powerRule,
    patches,
    effectResults,
    actor,
    target,
  });
}

export function resolveMmImmediatePower(input) {
  const { powerRule, actor, target = actor, rank = 0 } = input || {};
  const patches = [];
  const effectResults = [];
  const effects = Array.isArray(powerRule?.effects) ? powerRule.effects : [];

  for (let effectIndex = 0; effectIndex < effects.length; effectIndex += 1) {
    const effect = effects[effectIndex];
    const effectRank = Math.max(1, resolveEffectRank(effect, rank || powerRule?.live?.rank || 1));
    const type = safeStr(effect.type);
    const meta = getMmEffectMeta(type);
    const unreliable = resolveUnreliableCheck(effect, input, effectIndex);
    addUnreliablePatch(patches, effect, unreliable, target, actor);
    if (unreliable && !unreliable.success) {
      effectResults.push({ effectId: effect.id, type, rank: effectRank, automatic: true, skipped: true, unreliable });
      continue;
    }
    effectResults.push({ effectId: effect.id, type, rank: effectRank, automatic: true, unreliable });
    if (type === "enhanced_trait") {
      const traits = traitList(effect);
      if (!traits.length) {
        addAdjudication(patches, effect, "Enhanced Trait sem trait estruturado.", target);
        continue;
      }
      for (const trait of traits) addBoostPatch(patches, target, trait, effectRank, { effectId: effect.id, type });
    } else if (type === "healing") {
      const hpBefore = safeInt(target?.hp, 6);
      const hpAfter = clamp(hpBefore + effectRank, 0, 6);
      patches.push({
        kind: "hp",
        owner: target?.owner || "",
        pid: target?.pid || "",
        pieceId: target?.pieceId || "",
        before: hpBefore,
        after: hpAfter,
        delta: hpAfter - hpBefore,
        source: { effectId: effect.id, type },
      });
      target.hp = hpAfter;
    } else if (meta.automation === "ignored") {
      effectResults[effectResults.length - 1].ignored = true;
    } else if (isMmTrackableActiveEffect(type)) {
      addActiveEffectPatch(patches, effect, target, actor, effectRank, powerRule);
    } else if (isResistanceEffect(effect)) {
      addDecisionPatch(patches, effect, "Efeito precisa de alvo/resistencia.", target, actor);
    } else {
      addDecisionPatch(patches, effect, "Efeito imediato ainda exige adjudicacao.", target, actor);
    }
  }

  return makeResolution({
    kind: "immediate",
    powerRule,
    patches,
    effectResults,
    actor,
    target,
  });
}

function makeResolution(data) {
  const patches = data.patches || [];
  const undoPatches = patches
    .filter((patch) => ["hp", "conditions", "stat_boost", "active_effect"].includes(patch.kind))
    .map((patch) => {
      if (patch.kind === "hp") return { ...patch, before: patch.after, after: patch.before, delta: -patch.delta };
      if (patch.kind === "conditions") return { ...patch, before: patch.after, after: patch.before };
      if (patch.kind === "stat_boost") return { ...patch, before: patch.after, after: patch.before, delta: patch.before - patch.after };
      if (patch.kind === "active_effect") return { kind: "active_effect_remove", activeEffectId: safeStr(patch.id), source: { effectId: patch.effectId, type: patch.effectType } };
      return patch;
    })
    .reverse();
  const validation = data.powerRule?.validation || validatePowerRule(data.powerRule || {});
  const validationAdjudications = (validation.issues || [])
    .filter((issue) => issue.severity === "warning" || issue.severity === "error")
    .map((issue) => ({
      kind: "rule_validation",
      requiresAdjudication: true,
      effectId: safeStr(issue.effectId),
      code: safeStr(issue.code),
      severity: safeStr(issue.severity),
      message: safeStr(issue.message || issue.label || issue.code),
    }));
  const adjudications = patches
    .filter((patch) => patch.kind === "adjudication" || patch.kind === "mm_decision" || patch.requiresAdjudication)
    .concat(validationAdjudications);
  return {
    schema: "CombatResolution",
    schemaVersion: 1,
    kind: data.kind,
    powerRuleId: safeStr(data.powerRule?.id),
    powerName: safeStr(data.powerRule?.name),
    actor: data.actor || null,
    target: data.target || null,
    effectResults: data.effectResults || [],
    validation,
    patches,
    undoPatches,
    adjudications,
    requiresAdjudication: adjudications.length > 0,
    summary: summarizeResolution(data.powerRule, data.effectResults || [], patches),
    createdAtLocal: new Date().toISOString(),
  };
}

function summarizeResolution(powerRule, effectResults, patches) {
  const parts = [];
  const name = safeStr(powerRule?.name) || "Power";
  const hpPatch = patches.find((patch) => patch.kind === "hp");
  if (hpPatch) {
    const lost = hpPatch.before - hpPatch.after;
    parts.push(lost > 0 ? `${lost} HP perdido` : `${Math.abs(lost)} HP recuperado`);
  }
  const conds = patches.filter((patch) => patch.kind === "conditions").length;
  if (conds) parts.push(`${conds} condicao(oes)`);
  const boosts = patches.filter((patch) => patch.kind === "stat_boost").length;
  if (boosts) parts.push(`${boosts} ajuste(s) de trait`);
  const active = patches.filter((patch) => patch.kind === "active_effect").length;
  if (active) parts.push(`${active} efeito(s) ativo(s)`);
  const unreliableFails = patches.filter((patch) => patch.kind === "unreliable_check" && !patch.success).length;
  if (unreliableFails) parts.push(`${unreliableFails} falha(s) Unreliable`);
  const adj = patches.filter((patch) => patch.kind === "adjudication" || patch.kind === "mm_decision" || patch.requiresAdjudication).length;
  if (adj) parts.push(`${adj} revisao(oes)`);
  if (!parts.length && effectResults.some((result) => result.success)) parts.push("sem efeito aplicado");
  return `${name}: ${parts.join(", ") || "resolvido"}`;
}
