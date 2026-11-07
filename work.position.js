/*
 * Shared range-3 worker positioning helper.
 *
 * Builders, repairers, and upgraders can work from range 3.  Plain moveTo(target,
 * {range: 3}) tends to park multiple creeps on the same road/source-access tiles
 * around busy work sites.  This helper gives each worker a sticky exact work tile
 * near the target, with per-tick reservations so nearby workers spread out.
 */

var DEFAULT_WORK_RANGE = 3;
var MAX_WORK_RANGE = 3;
var RECALCULATE_EVERY = 25;
var candidatePositionCacheTick;
var candidatePositionsByTarget = {};

function moveToWorkTarget(creep, target, range)
{
    return moveToAssignedWorkPosition(creep, target, range || DEFAULT_WORK_RANGE, true);
}

function holdWorkPosition(creep, target, range)
{
    return moveToAssignedWorkPosition(creep, target, range || DEFAULT_WORK_RANGE, false);
}

function moveToAssignedWorkPosition(creep, target, range, fallbackToTarget)
{
    if (!creep || !target || !target.pos || !creep.room || creep.room.name != target.pos.roomName)
    {
        if (fallbackToTarget && creep && target)
        {
            creep.moveTo(target, {range: range || DEFAULT_WORK_RANGE, reusePath: 5});
        }
        return false;
    }

    range = Math.min(Math.max(range || DEFAULT_WORK_RANGE, 1), MAX_WORK_RANGE);
    var workPos = chooseWorkPosition(creep, target, range);
    if (!workPos)
    {
        if (fallbackToTarget)
        {
            creep.moveTo(target, {range: range, reusePath: 5});
        }
        return false;
    }

    rememberWorkPosition(creep, target, workPos, range);
    reserveWorkPosition(creep, target, workPos);

    if (sameRoomPosition(creep.pos, workPos))
    {
        return true;
    }
    if (creep.fatigue > 0)
    {
        return true;
    }

    creep.moveTo(workPos, {range: 0, reusePath: 3, maxRooms: 1});
    return true;
}

function chooseWorkPosition(creep, target, range)
{
    var remembered = getRememberedWorkPosition(creep, target, range);
    var best = undefined;
    var bestScore = Infinity;
    var positions = getCandidatePositions(target.pos, range);
    var terrain = Game.map.getRoomTerrain(target.pos.roomName);

    for (var i = 0; i < positions.length; i++)
    {
        var pos = positions[i];
        var score = scoreWorkPosition(creep, target, pos, range, remembered, terrain);
        if (score < bestScore || (score == bestScore && isBetterTieBreak(pos, best, target.pos)))
        {
            best = pos;
            bestScore = score;
        }
    }
    return best;
}

function getCandidatePositions(center, range)
{
    if (candidatePositionCacheTick != Game.time)
    {
        candidatePositionCacheTick = Game.time;
        candidatePositionsByTarget = {};
    }
    var cacheKey = center.roomName + ':' + center.x + ':' + center.y + ':' + range;
    if (candidatePositionsByTarget[cacheKey])
    {
        return candidatePositionsByTarget[cacheKey].slice();
    }

    var result = [];
    for (var dx = -range; dx <= range; dx++)
    {
        for (var dy = -range; dy <= range; dy++)
        {
            var x = center.x + dx;
            var y = center.y + dy;
            if (!isRoomCoord(x, y))
            {
                continue;
            }
            var pos = new RoomPosition(x, y, center.roomName);
            if (pos.getRangeTo(center) <= range)
            {
                result.push(pos);
            }
        }
    }
    candidatePositionsByTarget[cacheKey] = result;
    return result.slice();
}

function scoreWorkPosition(creep, target, pos, range, remembered, terrain)
{
    terrain = terrain || Game.map.getRoomTerrain(pos.roomName);
    var tileState = {};
    if (!isStandableWorkPosition(creep, pos, terrain, tileState))
    {
        return Infinity;
    }
    if (isReservedByAnother(creep, pos))
    {
        return Infinity;
    }

    var score = 0;
    var targetRange = pos.getRangeTo(target.pos);
    score += (range - targetRange) * 12; // Prefer outer range-3 tiles over crowding the work target.
    score += creep.pos.getRangeTo(pos) * 8;

    if (tileState.terrain == TERRAIN_MASK_SWAMP)
    {
        score += 25;
    }
    if (isExitEdge(pos))
    {
        score += 200;
    }

    var tile = classifyTile(pos, tileState.structures);
    if (tile.road)
    {
        score += 140;
    }
    if (tile.container)
    {
        score += 180;
    }
    if (tile.constructionSite)
    {
        score += 120;
    }
    if (tile.rampart)
    {
        score += 25;
    }
    if (isNearSourceOrMineral(pos))
    {
        score += 350;
    }

    if (sameRoomPosition(creep.pos, pos))
    {
        score -= 40;
    }
    if (remembered && sameRoomPosition(remembered, pos))
    {
        score -= 120;
    }

    var reservations = getWorkReservations();
    var key = posKey(pos);
    if (reservations[key] == creep.name)
    {
        score -= 60;
    }
    return score;
}

function isStandableWorkPosition(creep, pos, terrain, tileState)
{
    terrain = terrain || Game.map.getRoomTerrain(pos.roomName);
    tileState = tileState || {};
    tileState.terrain = terrain.get(pos.x, pos.y);
    if (tileState.terrain == TERRAIN_MASK_WALL)
    {
        return false;
    }

    if (pos.lookFor(LOOK_SOURCES).length > 0 || pos.lookFor(LOOK_MINERALS).length > 0)
    {
        return false;
    }

    var structures = pos.lookFor(LOOK_STRUCTURES);
    tileState.structures = structures;
    for (var i = 0; i < structures.length; i++)
    {
        if (isBlockingStructure(structures[i]))
        {
            return false;
        }
    }

    var creeps = pos.lookFor(LOOK_CREEPS);
    for (var c = 0; c < creeps.length; c++)
    {
        if (creeps[c].name != creep.name)
        {
            return false;
        }
    }
    if (typeof LOOK_POWER_CREEPS != 'undefined')
    {
        var powerCreeps = pos.lookFor(LOOK_POWER_CREEPS);
        if (powerCreeps.length > 0)
        {
            return false;
        }
    }
    return true;
}

function isBlockingStructure(structure)
{
    if (!structure || !structure.structureType)
    {
        return false;
    }
    if (structure.structureType == STRUCTURE_ROAD || structure.structureType == STRUCTURE_CONTAINER)
    {
        return false;
    }
    if (structure.structureType == STRUCTURE_RAMPART)
    {
        return !structure.my && !structure.isPublic;
    }
    return structure.structureType == STRUCTURE_WALL
        || OBSTACLE_OBJECT_TYPES.indexOf(structure.structureType) >= 0;
}

function classifyTile(pos, structures)
{
    var result = {road: false, container: false, rampart: false, constructionSite: false};
    structures = structures || pos.lookFor(LOOK_STRUCTURES);
    for (var i = 0; i < structures.length; i++)
    {
        if (structures[i].structureType == STRUCTURE_ROAD)
        {
            result.road = true;
        }
        else if (structures[i].structureType == STRUCTURE_CONTAINER)
        {
            result.container = true;
        }
        else if (structures[i].structureType == STRUCTURE_RAMPART)
        {
            result.rampart = true;
        }
    }
    result.constructionSite = pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0;
    return result;
}

function isNearSourceOrMineral(pos)
{
    var hazards = getWorkHazardObjects(pos.roomName);
    for (var i = 0; i < hazards.length; i++)
    {
        if (pos.inRangeTo(hazards[i], 1))
        {
            return true;
        }
    }
    return false;
}

function getWorkHazardObjects(roomName)
{
    if (!global.__workPositionHazards || global.__workPositionHazards.time != Game.time)
    {
        global.__workPositionHazards = {time: Game.time, rooms: {}};
    }
    if (global.__workPositionHazards.rooms[roomName] != undefined)
    {
        return global.__workPositionHazards.rooms[roomName];
    }
    var room = Game.rooms[roomName];
    if (!room)
    {
        global.__workPositionHazards.rooms[roomName] = [];
        return global.__workPositionHazards.rooms[roomName];
    }
    global.__workPositionHazards.rooms[roomName] = room.find(FIND_SOURCES).concat(room.find(FIND_MINERALS));
    return global.__workPositionHazards.rooms[roomName];
}

function getRememberedWorkPosition(creep, target, range)
{
    var memory = creep.memory.workPosition;
    if (!memory || memory.targetId != getTargetId(target) || memory.range != range)
    {
        return undefined;
    }
    if (memory.updated != undefined && Game.time - memory.updated > RECALCULATE_EVERY)
    {
        return undefined;
    }
    var pos = deserializePos(memory.pos);
    if (!pos || pos.roomName != creep.room.name || pos.getRangeTo(target.pos) > range)
    {
        return undefined;
    }
    return pos;
}

function rememberWorkPosition(creep, target, pos, range)
{
    creep.memory.workPosition = {
        targetId: getTargetId(target),
        pos: serializePos(pos),
        range: range,
        updated: Game.time
    };
}

function reserveWorkPosition(creep, target, pos)
{
    var reservations = getWorkReservations();
    reservations[posKey(pos)] = creep.name;
}

function isReservedByAnother(creep, pos)
{
    var reservations = getWorkReservations();
    var reservedBy = reservations[posKey(pos)];
    return reservedBy != undefined && reservedBy != creep.name;
}

function getWorkReservations()
{
    if (!global.__workPositionReservations || global.__workPositionReservations.time != Game.time)
    {
        global.__workPositionReservations = {time: Game.time, positions: {}};
    }
    return global.__workPositionReservations.positions;
}

function getTargetId(target)
{
    if (target.id)
    {
        return target.id;
    }
    if (target.pos)
    {
        return target.pos.roomName + ':' + target.pos.x + ':' + target.pos.y + ':' + (target.structureType || target.constructor && target.constructor.name || 'target');
    }
    return 'unknown';
}

function isBetterTieBreak(pos, best, targetPos)
{
    if (!best)
    {
        return true;
    }
    var posTargetRange = pos.getRangeTo(targetPos);
    var bestTargetRange = best.getRangeTo(targetPos);
    if (posTargetRange != bestTargetRange)
    {
        return posTargetRange > bestTargetRange;
    }
    if (pos.y != best.y)
    {
        return pos.y < best.y;
    }
    return pos.x < best.x;
}

function isExitEdge(pos)
{
    return pos.x == 0 || pos.x == 49 || pos.y == 0 || pos.y == 49;
}

function isRoomCoord(x, y)
{
    return x >= 0 && x <= 49 && y >= 0 && y <= 49;
}

function posKey(pos)
{
    return pos.roomName + ':' + pos.x + ':' + pos.y;
}

function serializePos(pos)
{
    return pos.roomName + ':' + pos.x + ':' + pos.y;
}

function deserializePos(value)
{
    if (!value || typeof value != 'string')
    {
        return undefined;
    }
    var parts = value.split(':');
    if (parts.length != 3)
    {
        return undefined;
    }
    var x = parseInt(parts[1], 10);
    var y = parseInt(parts[2], 10);
    if (!isValidRoomName(parts[0]) || isNaN(x) || isNaN(y) || !isRoomCoord(x, y))
    {
        return undefined;
    }
    return new RoomPosition(x, y, parts[0]);
}

function isValidRoomName(roomName)
{
    return typeof roomName == 'string' && /^[WE][0-9]+[NS][0-9]+$/.test(roomName);
}

function sameRoomPosition(a, b)
{
    return !!(a && b && a.x == b.x && a.y == b.y && a.roomName == b.roomName);
}

module.exports = {
    moveToWorkTarget: moveToWorkTarget,
    holdWorkPosition: holdWorkPosition,
    _test: {
        chooseWorkPosition: chooseWorkPosition,
        scoreWorkPosition: scoreWorkPosition,
        isStandableWorkPosition: isStandableWorkPosition,
        getCandidatePositions: getCandidatePositions,
        serializePos: serializePos,
        deserializePos: deserializePos
    }
};
