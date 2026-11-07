function isDangerousHostile(creep)
{
    return creep.getActiveBodyparts(ATTACK) > 0
        || creep.getActiveBodyparts(RANGED_ATTACK) > 0
        || creep.getActiveBodyparts(WORK) > 0
        || creep.getActiveBodyparts(CLAIM) > 0;
}

function isAttackingHostile(creep)
{
    return creep
        && creep.owner
        && creep.owner.username != 'MoMoCat'
        && (creep.getActiveBodyparts(ATTACK) > 0
            || creep.getActiveBodyparts(RANGED_ATTACK) > 0);
}

function getAttackingHostileCount(room)
{
    if (!room)
    {
        return 0;
    }
    return room.find(FIND_HOSTILE_CREEPS,
    {
        filter: isAttackingHostile
    }).length;
}

function hasAttackingHostiles(room)
{
    global.remoteAttackingDangerCache = global.remoteAttackingDangerCache || {};
    var cached = global.remoteAttackingDangerCache[room.name];
    if (cached && cached.tick == Game.time)
    {
        return cached.count > 0;
    }
    var count = getAttackingHostileCount(room);
    global.remoteAttackingDangerCache[room.name] = {
        tick: Game.time,
        count: count
    };
    return count > 0;
}

function shouldRetreat(creep)
{
    global.remoteDangerCache = global.remoteDangerCache || {};
    var cached = global.remoteDangerCache[creep.room.name];
    if (cached && cached.tick == Game.time)
    {
        return cached.danger;
    }

    var hostiles = creep.room.find(FIND_HOSTILE_CREEPS,
    {
        filter: (c) => c.owner.username != 'MoMoCat' && isDangerousHostile(c)
    });
    var danger = hostiles.length > 0;
    global.remoteDangerCache[creep.room.name] = {
        tick: Game.time,
        danger: danger
    };
    return danger;
}

module.exports = {
    isDangerousHostile: isDangerousHostile,
    isAttackingHostile: isAttackingHostile,
    getAttackingHostileCount: getAttackingHostileCount,
    hasAttackingHostiles: hasAttackingHostiles,
    shouldRetreat: shouldRetreat
};
