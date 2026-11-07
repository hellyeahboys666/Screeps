function findSourceContainer(source, creep)
{
    if (creep && creep.memory && creep.memory.sourceContainerId)
    {
        var cached = Game.getObjectById(creep.memory.sourceContainerId);
        if (cached && cached.structureType == STRUCTURE_CONTAINER
            && cached.pos.roomName == source.pos.roomName
            && cached.pos.inRangeTo(source, 1))
        {
            return cached;
        }
        delete creep.memory.sourceContainerId;
    }
    var container = source.pos.findInRange(FIND_STRUCTURES, 1,
    {
        filter: (s) => s.structureType == STRUCTURE_CONTAINER
    })[0];
    if (container && creep && creep.memory)
    {
        creep.memory.sourceContainerId = container.id;
    }
    return container;
}

function rememberMiningPosition(creep, pos)
{
    creep.memory.miningPos = {
        roomName: pos.roomName,
        x: pos.x,
        y: pos.y
    };
}

function getFallbackMiningPosition(creep, source)
{
    var terrain = creep.room.getTerrain();
    var best = undefined;
    var bestScore = undefined;
    for (let x = source.pos.x - 1; x <= source.pos.x + 1; x++)
    {
        for (let y = source.pos.y - 1; y <= source.pos.y + 1; y++)
        {
            if (x == source.pos.x && y == source.pos.y)
            {
                continue;
            }
            if (x <= 0 || x >= 49 || y <= 0 || y >= 49)
            {
                continue;
            }
            if (terrain.get(x, y) == TERRAIN_MASK_WALL)
            {
                continue;
            }
            var pos = new RoomPosition(x, y, source.room.name);
            var score = creep.pos.getRangeTo(pos);
            if (best == undefined || score < bestScore)
            {
                best = pos;
                bestScore = score;
            }
        }
    }
    return best;
}

function getMiningPosition(creep, source, container)
{
    var pos = container ? container.pos : getFallbackMiningPosition(creep, source);
    if (pos)
    {
        rememberMiningPosition(creep, pos);
    }
    return pos;
}

function isSamePosition(pos, memoryPos)
{
    return pos && memoryPos
        && pos.roomName == memoryPos.roomName
        && pos.x == memoryPos.x
        && pos.y == memoryPos.y;
}

function updateMinerStuckMemory(creep, miningPos)
{
    if (!miningPos || creep.pos.isEqualTo(miningPos))
    {
        delete creep.memory.minerLastPos;
        delete creep.memory.minerStuckTicks;
        return false;
    }

    var current = {
        roomName: creep.pos.roomName,
        x: creep.pos.x,
        y: creep.pos.y,
        targetRoom: miningPos.roomName,
        targetX: miningPos.x,
        targetY: miningPos.y
    };
    var last = creep.memory.minerLastPos;
    if (last
        && last.roomName == current.roomName
        && last.x == current.x
        && last.y == current.y
        && last.targetRoom == current.targetRoom
        && last.targetX == current.targetX
        && last.targetY == current.targetY
        && creep.fatigue == 0)
    {
        creep.memory.minerStuckTicks = (creep.memory.minerStuckTicks || 0) + 1;
    }
    else
    {
        creep.memory.minerStuckTicks = 0;
    }
    creep.memory.minerLastPos = current;
    return creep.memory.minerStuckTicks >= 2;
}

function markMoveAside(blocker, miner, source, miningPos)
{
    if (!blocker || blocker.name == miner.name || blocker.spawning
        || !blocker.my || !blocker.memory)
    {
        return;
    }
    if (blocker.memory.role == 'miner' || blocker.memory.role == 'Slinker')
    {
        return;
    }
    blocker.memory.moveAsideForMiner = {
        miner: miner.name,
        sourceId: source.id,
        roomName: miningPos.roomName,
        x: miningPos.x,
        y: miningPos.y,
        until: Game.time + 3
    };
}

function requestRightOfWay(creep, source, miningPos, stuck)
{
    if (!miningPos)
    {
        return;
    }

    var blockers = miningPos.lookFor(LOOK_CREEPS);
    for (let blocker of blockers)
    {
        markMoveAside(blocker, creep, source, miningPos);
    }

    if (!stuck)
    {
        return;
    }

    var nearbyBlockers = creep.pos.findInRange(FIND_MY_CREEPS, 1,
    {
        filter: (c) => c.name != creep.name
    });
    for (let blocker of nearbyBlockers)
    {
        markMoveAside(blocker, creep, source, miningPos);
    }

    var sourceAccessBlockers = source.pos.findInRange(FIND_MY_CREEPS, 1,
    {
        filter: (c) => c.name != creep.name
    });
    for (let blocker of sourceAccessBlockers)
    {
        markMoveAside(blocker, creep, source, miningPos);
    }
}

function clearCachedMove(creep)
{
    if (creep.memory._move)
    {
        delete creep.memory._move;
    }
}

function getAssignedSource(creep)
{
    var source = Game.getObjectById(creep.memory.sourceId);
    if (source && source.room && source.room.name == creep.room.name)
    {
        return source;
    }

    var sources = creep.room.find(FIND_SOURCES);
    source = creep.pos.findClosestByRange(sources) || sources[0];
    if (source)
    {
        creep.memory.sourceId = source.id;
        delete creep.memory.miningPos;
    }
    return source;
}

module.exports = {
    run: function (creep)
    {
        let source = getAssignedSource(creep);
        if (!source)
        {
            return;
        }
        var sourceSlinkers = source.pos.findInRange(FIND_MY_CREEPS, 1,
        {
            filter: (c) => c.memory.role == 'Slinker'
        });
        if (sourceSlinkers.length > 0)
        {
            creep.suicide();
            return;
        }

        var container = findSourceContainer(source, creep);
        var miningPos = getMiningPosition(creep, source, container);
        if (!miningPos)
        {
            return;
        }

        if (creep.pos.isEqualTo(miningPos))
        {
            delete creep.memory.minerLastPos;
            delete creep.memory.minerStuckTicks;
            creep.harvest(source);
            return;
        }

        var stuck = updateMinerStuckMemory(creep, miningPos);
        requestRightOfWay(creep, source, miningPos, stuck);
        if (stuck)
        {
            clearCachedMove(creep);
        }

        if (!container && creep.harvest(source) == OK)
        {
            return;
        }
        creep.moveTo(miningPos, {reusePath: 3, maxRooms: 1});
    }
};