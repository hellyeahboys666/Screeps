var depotUtils = require('remote.build.depot');

var spawnDropPosCache = {};
var SPAWN_DROP_SPOT_VERSION = 3;
var SPAWN_DROP_SPOT_MAX_RANGE = 4;
var SPAWN_DROP_SPOT_IDEAL_RANGE = 3;
var RESERVED_DROP_SPOT_ROLES = {
    miner: true,
    Slinker: true,
    Clinker: true,
    Blinker: true,
    extractor: true
};

function getUsedEnergy(creep)
{
    if (creep.store)
    {
        return creep.store.getUsedCapacity(RESOURCE_ENERGY);
    }
    return creep.carry.energy;
}

function getPrimarySpawn(room)
{
    if (!room)
    {
        return undefined;
    }
    var spawns = room.find(FIND_MY_SPAWNS);
    if (spawns.length == 0)
    {
        return undefined;
    }
    spawns.sort(function(a, b)
    {
        if (a.name < b.name)
        {
            return -1;
        }
        if (a.name > b.name)
        {
            return 1;
        }
        return 0;
    });
    return spawns[0];
}

function isRoomCoord(x, y)
{
    return typeof x == 'number' && typeof y == 'number'
        && x >= 0 && x <= 49 && y >= 0 && y <= 49;
}

function makeRoomPosition(memory, roomName)
{
    if (!memory || !isRoomCoord(memory.x, memory.y))
    {
        return undefined;
    }
    return new RoomPosition(memory.x, memory.y, memory.roomName || roomName);
}

function isAllowedDropSpotStructure(structure)
{
    return structure.structureType == STRUCTURE_ROAD
        || (structure.structureType == STRUCTURE_RAMPART
            && (structure.my || structure.isPublic));
}

function isReservedWorkerDropSpot(pos)
{
    var creeps = pos.lookFor(LOOK_CREEPS);
    for (let creep of creeps)
    {
        if (creep.my && creep.memory && RESERVED_DROP_SPOT_ROLES[creep.memory.role])
        {
            return true;
        }
    }
    return false;
}

function isSourceAccessDropSpot(pos)
{
    return pos.findInRange(FIND_SOURCES, 1).length > 0;
}

function isWalkableDropSpot(pos)
{
    var room = Game.rooms[pos.roomName];
    if (!room || pos.x <= 0 || pos.x >= 49 || pos.y <= 0 || pos.y >= 49)
    {
        return false;
    }
    if (room.getTerrain().get(pos.x, pos.y) == TERRAIN_MASK_WALL)
    {
        return false;
    }
    if (isSourceAccessDropSpot(pos) || isReservedWorkerDropSpot(pos))
    {
        return false;
    }
    if (pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0)
    {
        return false;
    }
    var structures = pos.lookFor(LOOK_STRUCTURES);
    for (let structure of structures)
    {
        if (!isAllowedDropSpotStructure(structure))
        {
            return false;
        }
    }
    return true;
}

function scoreNearbyDropSpotTraffic(pos, spawn)
{
    var score = 0;
    var nearby = pos.findInRange(FIND_STRUCTURES, 1);
    for (let structure of nearby)
    {
        if (structure.pos.isEqualTo(pos))
        {
            continue;
        }
        if (structure.structureType == STRUCTURE_SPAWN)
        {
            score += 45;
        }
        else if (structure.structureType == STRUCTURE_CONTAINER)
        {
            score += 40;
        }
        else if (structure.structureType == STRUCTURE_LINK
            || structure.structureType == STRUCTURE_STORAGE
            || structure.structureType == STRUCTURE_TERMINAL)
        {
            score += 30;
        }
        else if (structure.structureType == STRUCTURE_EXTENSION
            || structure.structureType == STRUCTURE_TOWER)
        {
            score += 18;
        }
        else if (structure.structureType == STRUCTURE_ROAD)
        {
            score += 20;
        }
    }
    var nearbySites = pos.findInRange(FIND_CONSTRUCTION_SITES, 1);
    for (let site of nearbySites)
    {
        if (site.pos.isEqualTo(pos))
        {
            score += 100;
        }
        else if (site.structureType == STRUCTURE_ROAD)
        {
            score += 20;
        }
        else
        {
            score += 35;
        }
    }
    if (spawn.pos.isNearTo(pos))
    {
        score += 80;
    }
    return score;
}

function scorePathDistanceToDropSpot(pos, spawn)
{
    var path = spawn.pos.findPathTo(pos, {
        ignoreCreeps: true,
        maxOps: 100
    });
    if (!path || (path.length == 0 && !spawn.pos.isEqualTo(pos)))
    {
        return 1000;
    }
    return path.length * 4;
}

function scoreDropSpot(pos, spawn)
{
    var terrain = spawn.room.getTerrain();
    var range = spawn.pos.getRangeTo(pos);
    var score = Math.abs(range - SPAWN_DROP_SPOT_IDEAL_RANGE) * 40;
    if (range <= 1)
    {
        score += 150;
    }
    else if (range == 2)
    {
        score += 10;
    }
    if (terrain.get(pos.x, pos.y) == TERRAIN_MASK_SWAMP)
    {
        score += 25;
    }
    var hasRoad = pos.lookFor(LOOK_STRUCTURES).some((s) => s.structureType == STRUCTURE_ROAD);
    if (hasRoad)
    {
        // The overflow pile should be near the base, but not on the road grid
        // that workers use every tick. Roads are only a fallback if no quieter
        // tile exists.
        score += 80;
    }
    score += scoreNearbyDropSpotTraffic(pos, spawn);
    score += scorePathDistanceToDropSpot(pos, spawn);
    // Deterministic tie-breaker so the spot stays stable across global resets.
    score += Math.abs(pos.x - spawn.pos.x) / 100;
    score += Math.abs(pos.y - (spawn.pos.y + 2)) / 1000;
    score += pos.x / 10000 + pos.y / 100000;
    return score;
}

function chooseSpawnDropPos(room)
{
    var spawn = getPrimarySpawn(room);
    if (!spawn)
    {
        return undefined;
    }

    var best = undefined;
    var bestScore = undefined;
    for (let range = 1; range <= SPAWN_DROP_SPOT_MAX_RANGE; range++)
    {
        for (let x = spawn.pos.x - range; x <= spawn.pos.x + range; x++)
        {
            for (let y = spawn.pos.y - range; y <= spawn.pos.y + range; y++)
            {
                if (Math.max(Math.abs(x - spawn.pos.x), Math.abs(y - spawn.pos.y)) != range)
                {
                    continue;
                }
                if (!isRoomCoord(x, y))
                {
                    continue;
                }
                var pos = new RoomPosition(x, y, room.name);
                if (!isWalkableDropSpot(pos))
                {
                    continue;
                }
                var score = scoreDropSpot(pos, spawn);
                if (!best || score < bestScore)
                {
                    best = pos;
                    bestScore = score;
                }
            }
        }
    }
    return best;
}

function getSpawnDropPos(room)
{
    if (!room)
    {
        return undefined;
    }

    var cached = spawnDropPosCache[room.name];
    if (cached && cached.tick == Game.time)
    {
        return cached.pos;
    }

    var rememberedMemory = room.memory.spawnEnergyDropSpot;
    var remembered = makeRoomPosition(rememberedMemory, room.name);
    if (remembered
        && rememberedMemory.version == SPAWN_DROP_SPOT_VERSION
        && remembered.roomName == room.name
        && isWalkableDropSpot(remembered))
    {
        spawnDropPosCache[room.name] = {tick: Game.time, pos: remembered};
        return remembered;
    }
    if (room.memory.spawnEnergyDropSpot)
    {
        delete room.memory.spawnEnergyDropSpot;
    }

    var pos = chooseSpawnDropPos(room);
    if (pos)
    {
        room.memory.spawnEnergyDropSpot = {
            x: pos.x,
            y: pos.y,
            roomName: pos.roomName,
            version: SPAWN_DROP_SPOT_VERSION
        };
    }
    spawnDropPosCache[room.name] = {tick: Game.time, pos: pos};
    return pos;
}

function isSpawnDropPile(resource)
{
    if (!resource || !resource.pos || resource.resourceType != RESOURCE_ENERGY)
    {
        return false;
    }
    var room = Game.rooms[resource.pos.roomName];
    var pos = room ? getSpawnDropPos(room) : undefined;
    return pos != undefined && resource.pos.isEqualTo(pos);
}

function withdrawFromPreferredWorkerStore(creep)
{
    if (!creep || !creep.room)
    {
        return false;
    }
    var target = undefined;
    if (creep.room.storage
        && creep.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0
        && !depotUtils.isRemoteBuildDepotEnergyStructure(creep.room.storage))
    {
        target = creep.room.storage;
    }
    else if (creep.room.terminal
        && creep.room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) > 1000)
    {
        target = creep.room.terminal;
    }
    if (!target)
    {
        return false;
    }
    var result = creep.withdraw(target, RESOURCE_ENERGY);
    if (result == ERR_NOT_IN_RANGE)
    {
        creep.moveTo(target, {range: 1, reusePath: 10});
        return true;
    }
    return result == OK;
}

function findSpawnDropPile(creep, minAmount)
{
    var pos = getSpawnDropPos(creep.room);
    if (!pos)
    {
        return undefined;
    }
    minAmount = minAmount || 1;
    var resources = pos.lookFor(LOOK_RESOURCES);
    for (let resource of resources)
    {
        if (resource.resourceType == RESOURCE_ENERGY
            && resource.amount >= minAmount)
        {
            return resource;
        }
    }
    return undefined;
}

function pickupSpawnDropPile(creep, minAmount, maxRange)
{
    var pile = findSpawnDropPile(creep, minAmount);
    if (!pile)
    {
        return false;
    }
    if (maxRange != undefined && creep.pos.getRangeTo(pile) > maxRange)
    {
        return false;
    }
    if (creep.pickup(pile) == ERR_NOT_IN_RANGE)
    {
        creep.moveTo(pile, {reusePath: 10});
    }
    return true;
}

function dropAtSpawnPile(creep)
{
    if (getUsedEnergy(creep) <= 0)
    {
        return false;
    }
    var pos = getSpawnDropPos(creep.room);
    if (!pos)
    {
        return false;
    }
    if (creep.pos.isEqualTo(pos))
    {
        creep.drop(RESOURCE_ENERGY);
        return true;
    }
    creep.moveTo(pos, {reusePath: 10});
    return true;
}

module.exports = {
    dropAtSpawnPile: dropAtSpawnPile,
    findSpawnDropPile: findSpawnDropPile,
    isSpawnDropPile: isSpawnDropPile,
    pickupSpawnDropPile: pickupSpawnDropPile,
    withdrawFromPreferredWorkerStore: withdrawFromPreferredWorkerStore,
    getSpawnDropPos: getSpawnDropPos
};
