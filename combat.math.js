/*
 * Boost-aware combat math shared by attackers, defenders, and quads.
 * Screeps boosts are multiplicative per body part; TOUGH damage reduction only
 * applies while incoming damage is being absorbed by active TOUGH parts.
 */

function getBoostMultiplier(part, action)
{
    if (!part || !part.boost || typeof BOOSTS == 'undefined')
    {
        return 1;
    }
    var partBoosts = BOOSTS[part.type];
    if (!partBoosts || !partBoosts[part.boost] || partBoosts[part.boost][action] == undefined)
    {
        return 1;
    }
    return partBoosts[part.boost][action];
}

function activeBodyPower(creep, bodyPart, action, basePower)
{
    var total = 0;
    if (!creep || !creep.body)
    {
        return total;
    }
    for (var i = 0; i < creep.body.length; i++)
    {
        var part = creep.body[i];
        if (part.type == bodyPart && part.hits > 0)
        {
            total += basePower * getBoostMultiplier(part, action);
        }
    }
    return total;
}

function directHealPower(creep)
{
    var healPower = typeof HEAL_POWER == 'number' ? HEAL_POWER : 12;
    return activeBodyPower(creep, HEAL, 'heal', healPower);
}

function rangedHealPower(creep)
{
    var rangedHealPowerBase = typeof RANGED_HEAL_POWER == 'number' ? RANGED_HEAL_POWER : 4;
    return activeBodyPower(creep, HEAL, 'rangedHeal', rangedHealPowerBase);
}

function attackPower(creep)
{
    var attackPowerBase = typeof ATTACK_POWER == 'number' ? ATTACK_POWER : 30;
    return activeBodyPower(creep, ATTACK, 'attack', attackPowerBase);
}

function rangedAttackPower(creep)
{
    var rangedAttackPowerBase = typeof RANGED_ATTACK_POWER == 'number' ? RANGED_ATTACK_POWER : 10;
    return activeBodyPower(creep, RANGED_ATTACK, 'rangedAttack', rangedAttackPowerBase);
}

function rangedMassAttackPower(creep, range)
{
    var base = 0;
    if (range <= 1)
    {
        base = typeof RANGED_ATTACK_POWER == 'number' ? RANGED_ATTACK_POWER : 10;
    }
    else if (range == 2)
    {
        base = 4;
    }
    else if (range == 3)
    {
        base = 1;
    }
    if (base <= 0)
    {
        return 0;
    }
    return activeBodyPower(creep, RANGED_ATTACK, 'rangedMassAttack', base);
}

function damageAfterTough(creep, rawDamage)
{
    if (!creep || !creep.body || rawDamage <= 0)
    {
        return 0;
    }

    var remainingRawDamage = rawDamage;
    var hitsLost = 0;
    for (var i = 0; i < creep.body.length && remainingRawDamage > 0; i++)
    {
        var part = creep.body[i];
        if (!part || part.hits <= 0)
        {
            continue;
        }

        var damageMultiplier = part.type == TOUGH ? getBoostMultiplier(part, 'damage') : 1;
        if (damageMultiplier <= 0)
        {
            damageMultiplier = 1;
        }

        var rawToDestroyPart = part.hits / damageMultiplier;
        if (remainingRawDamage >= rawToDestroyPart)
        {
            hitsLost += part.hits;
            remainingRawDamage -= rawToDestroyPart;
        }
        else
        {
            hitsLost += remainingRawDamage * damageMultiplier;
            remainingRawDamage = 0;
        }
    }
    // Damage that remains after every body part has been consumed still matters
    // for projected-survival checks. Screeps can apply overkill damage beyond the
    // creep's current body hits, so do not silently cap estimates at hitsMax.
    if (remainingRawDamage > 0)
    {
        hitsLost += remainingRawDamage;
    }
    return Math.ceil(hitsLost);
}

function towerDamageAt(tower, pos)
{
    var range = tower.pos.getRangeTo(pos);
    var attackPowerBase = typeof TOWER_POWER_ATTACK == 'number' ? TOWER_POWER_ATTACK : 600;
    var falloff = typeof TOWER_FALLOFF == 'number' ? TOWER_FALLOFF : 0.75;
    var optimal = typeof TOWER_OPTIMAL_RANGE == 'number' ? TOWER_OPTIMAL_RANGE : 5;
    var falloffRange = typeof TOWER_FALLOFF_RANGE == 'number' ? TOWER_FALLOFF_RANGE : 20;
    if (range <= optimal)
    {
        return attackPowerBase;
    }
    if (range >= falloffRange)
    {
        return attackPowerBase * (1 - falloff);
    }
    return attackPowerBase * (1 - falloff * (range - optimal) / (falloffRange - optimal));
}

function isHostileTower(structure, hostileStructureFilter)
{
    if (!structure || structure.structureType != STRUCTURE_TOWER)
    {
        return false;
    }
    if (hostileStructureFilter && !hostileStructureFilter(structure))
    {
        return false;
    }
    if (!hostileStructureFilter && structure.my)
    {
        return false;
    }
    // A tower needs a full shot's worth of energy to fire at all.
    var energyPerShot = typeof TOWER_ENERGY_COST == 'number' ? TOWER_ENERGY_COST : 10;
    return structure.store && structure.store.getUsedCapacity(RESOURCE_ENERGY) >= energyPerShot;
}

function estimateHostileCreepRawDamage(hostile, target)
{
    var targetPos = target.pos || target;
    var range = hostile.pos.getRangeTo(targetPos);
    var damage = 0;
    if (range <= 1)
    {
        damage += attackPower(hostile);
    }
    if (range <= 3)
    {
        // Use focused rangedAttack power as the conservative per-target threat.
        damage += rangedAttackPower(hostile);
    }
    return damage;
}

function estimateIncomingRawDamage(creep, hostileFilter, hostileStructureFilter)
{
    if (!creep || !creep.room)
    {
        return 0;
    }

    var damage = 0;
    var towers = creep.room.find(FIND_HOSTILE_STRUCTURES,
    {
        filter: function(s) { return isHostileTower(s, hostileStructureFilter); }
    });
    for (var t = 0; t < towers.length; t++)
    {
        damage += towerDamageAt(towers[t], creep.pos);
    }

    var hostiles = creep.room.find(FIND_HOSTILE_CREEPS,
    {
        filter: hostileFilter || function(c) { return c.owner && !c.my; }
    });
    for (var h = 0; h < hostiles.length; h++)
    {
        damage += estimateHostileCreepRawDamage(hostiles[h], creep);
    }
    return damage;
}

function estimateIncomingDamageBreakdown(creep, hostileFilter, hostileStructureFilter)
{
    var rawDamage = estimateIncomingRawDamage(creep, hostileFilter, hostileStructureFilter);
    return {
        raw: Math.ceil(rawDamage),
        hits: damageAfterTough(creep, rawDamage)
    };
}

function estimateIncomingDamage(creep, hostileFilter, hostileStructureFilter)
{
    return estimateIncomingDamageBreakdown(creep, hostileFilter, hostileStructureFilter).hits;
}

function projectedHits(creep, incomingDamage, availableHeal)
{
    if (!creep)
    {
        return 0;
    }
    var healedHits = Math.min(creep.hitsMax, creep.hits + (availableHeal || 0));
    return healedHits - (incomingDamage || 0);
}

module.exports = {
    getBoostMultiplier: getBoostMultiplier,
    activeBodyPower: activeBodyPower,
    directHealPower: directHealPower,
    rangedHealPower: rangedHealPower,
    attackPower: attackPower,
    rangedAttackPower: rangedAttackPower,
    rangedMassAttackPower: rangedMassAttackPower,
    damageAfterTough: damageAfterTough,
    towerDamageAt: towerDamageAt,
    estimateHostileCreepRawDamage: estimateHostileCreepRawDamage,
    estimateIncomingRawDamage: estimateIncomingRawDamage,
    estimateIncomingDamageBreakdown: estimateIncomingDamageBreakdown,
    estimateIncomingDamage: estimateIncomingDamage,
    projectedHits: projectedHits
};
