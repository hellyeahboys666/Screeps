/*
 * Standalone quad/squad role.
 *
 * Spawn logic lives in main.js / prototype.spawn.js.
 * Spawn four creeps with memory similar to:
 *   {role: 'quad', squad: 'quad1', slot: 0, targetRoom: 'E12S34', targetFlag: 'QuadTarget'}
 * Slots are 0=top-left, 1=top-right, 2=bottom-left, 3=bottom-right.
 * If slots are missing, this role assigns stable slots by creep name.
 */

var combatMath = require('combat.math');

var roleQuad = {

    /** @param {Creep} creep **/
    run: function(creep) {
        var squadName = creep.memory.squad || creep.memory.squadId || 'default';
        Memory.quads = Memory.quads || {};
        var squadMemory = Memory.quads[squadName] = Memory.quads[squadName] || {};

        // The first quad creep processed each tick controls the whole squad. This avoids
        // four creeps recalculating paths and overwriting each other's movement intents.
        if (squadMemory.lastRun == Game.time)
        {
            return;
        }
        squadMemory.lastRun = Game.time;

        var members = getMembers(squadName);
        if (members.length == 0)
        {
            return;
        }

        assignMissingSlots(members);
        members = getActiveMembers(getMembers(squadName));
        if (members.length == 0)
        {
            return;
        }
        if (squadMemory.autoNormalizeSlots !== false)
        {
            normalizeSlotsIfAlreadyPacked(members);
        }

        var targetFlag = getTargetFlag(members, squadMemory);
        var targetRoom = getTargetRoom(members, squadMemory, targetFlag);
        var rallyPos = getRallyPos(members, squadMemory, targetFlag, targetRoom);
        var currentRoom = members[0].room;
        recordQuadRoomPath(squadMemory, members, currentRoom.name);

        if (members.length < 4)
        {
            var hadFullSquad = squadMemory.formed == true
                || squadMemory.retreatingAfterLoss == true
                || squadMemory.topLeft != undefined;
            squadMemory.formed = false;
            delete squadMemory.packTopLeft;
            healSquad(currentRoom, members, false);
            attackNearby(members, undefined);
            if (hadFullSquad)
            {
                markMemberLossRetreat(squadMemory, members.length);
                retreatIncompleteSquad(members, squadMemory);
            }
            else
            {
                squadMemory.state = 'waiting';
                holdIncompleteSquad(members, rallyPos);
            }
            return;
        }

        if (squadMemory.retreatingAfterLoss == true)
        {
            squadMemory.formed = false;
            delete squadMemory.packTopLeft;
            healSquad(currentRoom, members, false);
            attackNearby(members, undefined);
            if (!allAtRetreatTarget(members, squadMemory))
            {
                squadMemory.state = 'retreating_member_lost';
                retreatIncompleteSquad(members, squadMemory);
                return;
            }
            delete squadMemory.retreatingAfterLoss;
            delete squadMemory.memberLostAt;
            delete squadMemory.memberLostLiveCount;
            squadMemory.state = 'regrouping_after_loss';
        }

        var packed = getPackedInfo(members);
        if (!packed)
        {
            if (shouldContinueUnpackedRetreat(members, squadMemory))
            {
                return;
            }
            if (squadMemory.narrowFormationActive == true
                && runNarrowFormationMovement(currentRoom, members, squadMemory, targetFlag, targetRoom, rallyPos))
            {
                return;
            }
            squadMemory.state = 'packing';
            healSquad(currentRoom, members, false);
            attackNearby(members, undefined);
            packSquad(members, squadMemory, targetFlag, targetRoom, rallyPos);
            return;
        }

        squadMemory.state = 'packed';
        squadMemory.formed = true;
        squadMemory.topLeft = serializePos(packed.topLeft);
        markNarrowFormationRepacked(squadMemory, packed.topLeft);

        var damage = estimateIncomingDamage(currentRoom, members);
        var retreatStatus = getRetreatStatus(members, damage);
        recordQuadCombatStatus(squadMemory, retreatStatus);

        var slotSwap = tryRepositionPackedQuadForDamage(currentRoom, members, packed.topLeft, squadMemory, damage, retreatStatus);
        if (slotSwap)
        {
            damage = slotSwap.damage;
            retreatStatus = slotSwap.status;
            recordQuadCombatStatus(squadMemory, retreatStatus);
            healSquad(currentRoom, members, true, damage);
            if (targetRoom && currentRoom.name != targetRoom)
            {
                attackNearby(members, undefined);
            }
            else
            {
                var swapTarget = chooseAttackTarget(currentRoom, members, packed.topLeft, targetFlag, squadMemory);
                attackNearby(members, swapTarget);
            }
            return;
        }

        healSquad(currentRoom, members, true, damage);

        if (targetRoom && currentRoom.name != targetRoom)
        {
            attackNearby(members, undefined);
            if (retreatStatus.shouldRetreat)
            {
                if (kiteQuadAwayFromDamage(currentRoom, members, packed.topLeft, squadMemory, retreatStatus))
                {
                    return;
                }
                squadMemory.state = 'retreating';
                retreatQuad(members, packed.topLeft, squadMemory, targetRoom);
                return;
            }

            var exitGoal = getPackedExitGoal(currentRoom, targetRoom, packed.topLeft, members);
            if (exitGoal && !isQuadInGoalRange(packed.topLeft, exitGoal))
            {
                var exitBlocker = getNextStepBlocker(packed.topLeft, exitGoal, members, squadMemory);
                if (exitBlocker)
                {
                    squadMemory.state = 'breaking_exit_blocker';
                    squadMemory.crossRoomExitStage = serializePos(exitGoal.pos);
                    squadMemory.crossRoomExit = exitGoal.exit;
                    squadMemory.crossRoomExitType = exitGoal.exitType;
                    attackNearby(members, exitBlocker);
                    return;
                }
                squadMemory.state = 'traveling_packed_to_exit';
                squadMemory.crossRoomExitStage = serializePos(exitGoal.pos);
                squadMemory.crossRoomExit = exitGoal.exit;
                squadMemory.crossRoomExitType = exitGoal.exitType;
                movePackedQuad(members, packed.topLeft, exitGoal, squadMemory, {avoidUnsafeDamage: true});
                return;
            }

            squadMemory.state = 'crossing_exit_unpacked';
            squadMemory.formed = false;
            delete squadMemory.packTopLeft;
            moveIncompleteSquad(members, targetFlag, targetRoom, undefined,
            {
                preferredExit: squadMemory.crossRoomExit,
                preferredExitType: squadMemory.crossRoomExitType
            });
            return;
        }

        var target = chooseAttackTarget(currentRoom, members, packed.topLeft, targetFlag, squadMemory);
        var movementGoal = getMovementGoal(currentRoom, packed.topLeft, target, targetFlag, targetRoom, members);
        var blocker = movementGoal ? getNextStepBlocker(packed.topLeft, movementGoal, members, squadMemory) : undefined;
        var focusTarget = blocker || target;

        attackNearby(members, focusTarget);

        if (retreatStatus.shouldRetreat)
        {
            if (kiteQuadAwayFromDamage(currentRoom, members, packed.topLeft, squadMemory, retreatStatus))
            {
                return;
            }
            squadMemory.state = 'retreating';
            retreatQuad(members, packed.topLeft, squadMemory, targetRoom);
            return;
        }

        if (blocker)
        {
            // A destructible object is in the next 2x2 footprint. Focus fire it and
            // do not move into the blocked square this tick.
            squadMemory.state = 'breaking_blocker';
            return;
        }

        if (movementGoal)
        {
            movePackedQuad(members, packed.topLeft, movementGoal, squadMemory, {avoidUnsafeDamage: true});
        }
    }
};

var SLOT_OFFSETS = [
    {x: 0, y: 0},
    {x: 1, y: 0},
    {x: 0, y: 1},
    {x: 1, y: 1}
];

var ALLIES = ['MoMoCat'];
var DEFAULT_TARGET_FLAG = 'QuadTarget';
var PACK_SEARCH_RANGE = 6;
var PACK_FALLBACK_SEARCH_RANGE = 20;
var RETREAT_EXPECTED_HITS = 250;
var QUAD_IMMEDIATE_DANGER_RANGE = 4;
var QUAD_CLOSE_DANGER_RANGE = 8;
var QUAD_PATH_MAX_OPS = 4000;
var QUAD_PATH_MAX_OPS_BOOSTED = 8000;
var QUAD_PATH_OPS_BOOST_STREAK = 3;
var KITE_ESCAPE_SEARCH_RANGE = 5;
var KITE_ESCAPE_MAX_OPS = 800;
var KITE_STEP_RISK_TOLERANCE = 250;
var KITE_EDGE_PENALTY = 150;
var KITE_BACKTRACK_PENALTY = 500;
var SLOT_SWAP_MIN_SCORE_IMPROVEMENT = 500;
var SLOT_SWAP_RETREAT_SCORE_IMPROVEMENT = 50;
var SLOT_SWAP_MIN_DAMAGE_REDUCTION = 50;
var SLOT_SWAP_COOLDOWN = 2;
var SLOT_SWAP_BACKTRACK_PENALTY = 750;
var NARROW_FORMATION_PATH_MAX_OPS = 1200;
var NARROW_FORMATION_REPACK_SEARCH_RANGE = 3;
var NARROW_FORMATION_BACKTRACK_PENALTY = 250;

function getMembers(squadName)
{
    var members = [];
    for (var name in Game.creeps)
    {
        var c = Game.creeps[name];
        if (c.memory && c.memory.role == 'quad'
            && (c.memory.squad || c.memory.squadId || 'default') == squadName)
        {
            members.push(c);
        }
    }
    members.sort(function(a, b) {
        var sa = typeof a.memory.slot == 'number' ? a.memory.slot : 99;
        var sb = typeof b.memory.slot == 'number' ? b.memory.slot : 99;
        if (sa != sb)
        {
            return sa - sb;
        }
        return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
    return members;
}

function assignMissingSlots(members)
{
    var used = {};
    for (var i = 0; i < members.length; i++)
    {
        var slot = members[i].memory.slot;
        if (typeof slot == 'number' && slot >= 0 && slot < 4 && !used[slot])
        {
            used[slot] = true;
        }
        else
        {
            delete members[i].memory.slot;
        }
    }

    members.sort(function(a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
    for (var j = 0; j < members.length; j++)
    {
        if (typeof members[j].memory.slot != 'number')
        {
            for (var s = 0; s < 4; s++)
            {
                if (!used[s])
                {
                    members[j].memory.slot = s;
                    used[s] = true;
                    break;
                }
            }
        }
    }
}

function getActiveMembers(members)
{
    var active = [];
    for (var i = 0; i < members.length; i++)
    {
        var slot = members[i].memory.slot;
        if (typeof slot == 'number' && slot >= 0 && slot < 4)
        {
            active.push(members[i]);
        }
    }
    return active;
}

function normalizeSlotsIfAlreadyPacked(members)
{
    if (members.length != 4)
    {
        return false;
    }

    var roomName = members[0].room.name;
    var minX = 49;
    var minY = 49;
    var maxX = 0;
    var maxY = 0;
    var occupied = {};
    for (var i = 0; i < members.length; i++)
    {
        if (members[i].room.name != roomName)
        {
            return false;
        }
        var pos = members[i].pos;
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        maxX = Math.max(maxX, pos.x);
        maxY = Math.max(maxY, pos.y);
        occupied[pos.x + ':' + pos.y] = members[i];
    }

    if (maxX - minX != 1 || maxY - minY != 1)
    {
        return false;
    }

    var topLeft = new RoomPosition(minX, minY, roomName);
    if (!isValidTopLeft(topLeft))
    {
        return false;
    }

    for (var s = 0; s < SLOT_OFFSETS.length; s++)
    {
        var slotPos = offsetPos(topLeft, SLOT_OFFSETS[s].x, SLOT_OFFSETS[s].y);
        var member = occupied[slotPos.x + ':' + slotPos.y];
        if (!member)
        {
            return false;
        }
        member.memory.slot = s;
    }
    return true;
}

function getTargetFlag(members, squadMemory)
{
    var flagName = squadMemory.targetFlag;
    for (var i = 0; i < members.length && !flagName; i++)
    {
        flagName = members[i].memory.targetFlag;
    }
    if (flagName)
    {
        if (Game.flags[flagName])
        {
            delete squadMemory.targetFlagError;
            return Game.flags[flagName];
        }
        squadMemory.targetFlagError = 'missing flag ' + flagName;
        squadMemory.targetFlagErrorAt = Game.time;
        return undefined;
    }
    return Game.flags[DEFAULT_TARGET_FLAG];
}

function getTargetRoom(members, squadMemory, targetFlag)
{
    if (targetFlag)
    {
        return targetFlag.pos.roomName;
    }
    if (isValidRoomName(squadMemory.targetRoom))
    {
        return squadMemory.targetRoom;
    }
    if (squadMemory.targetRoom)
    {
        squadMemory.targetRoomError = 'invalid room ' + squadMemory.targetRoom;
    }
    for (var i = 0; i < members.length; i++)
    {
        var memberTargetRoom = members[i].memory.targetRoom || members[i].memory.target;
        if (isValidRoomName(memberTargetRoom))
        {
            return memberTargetRoom;
        }
        if (memberTargetRoom)
        {
            members[i].memory.targetRoomError = 'invalid room ' + memberTargetRoom;
        }
    }
    return undefined;
}

function getRallyPos(members, squadMemory, targetFlag, targetRoom)
{
    var rallyFlagName = squadMemory.rallyFlag;
    for (var i = 0; i < members.length && !rallyFlagName; i++)
    {
        rallyFlagName = members[i].memory.rallyFlag;
    }
    if (rallyFlagName && Game.flags[rallyFlagName])
    {
        return Game.flags[rallyFlagName].pos;
    }

    var rallyPos = deserializePos(squadMemory.rallyPos);
    for (var j = 0; j < members.length && !rallyPos; j++)
    {
        rallyPos = deserializePos(members[j].memory.rallyPos);
    }
    if (rallyPos)
    {
        return rallyPos;
    }

    var rallyRoom = squadMemory.rallyRoom;
    for (var k = 0; k < members.length && !rallyRoom; k++)
    {
        rallyRoom = members[k].memory.rallyRoom;
    }
    if (isValidRoomName(rallyRoom))
    {
        return getRoomCenterPos(rallyRoom);
    }

    if (targetFlag)
    {
        return targetFlag.pos;
    }
    if (isValidRoomName(targetRoom))
    {
        return getRoomCenterPos(targetRoom);
    }
    return undefined;
}

function recordQuadRoomPath(squadMemory, members, roomName)
{
    if (!squadMemory || !isValidRoomName(roomName) || !allInSameRoom(members, roomName))
    {
        return;
    }
    // Once retreat has started, keep the inbound path stable so the squad can
    // walk it backward instead of learning a new path while fleeing.
    if (squadMemory.retreatingAfterLoss == true || isRetreatState(squadMemory.state)
        || (squadMemory.lastRetreatAt && Game.time - squadMemory.lastRetreatAt <= 10))
    {
        return;
    }

    var path = sanitizeRoomPath(squadMemory.roomPath);
    if (path.length == 0)
    {
        var originRoom = getSquadOriginRoom(members, squadMemory);
        if (originRoom && originRoom != roomName)
        {
            path.push(originRoom);
        }
    }

    var existingIndex = lastRoomPathIndex(path, roomName);
    if (existingIndex >= 0)
    {
        path = path.slice(0, existingIndex + 1);
    }
    else
    {
        path.push(roomName);
    }
    if (path.length > 16)
    {
        path = path.slice(path.length - 16);
    }

    squadMemory.roomPath = path;
    squadMemory.lastRoom = roomName;
    squadMemory.roomPathUpdated = Game.time;
}

function isRetreatState(state)
{
    return typeof state == 'string' && state.indexOf('retreating') == 0;
}

function getPackedInfo(members)
{
    var bySlot = getBySlot(members);
    if (!bySlot[0] || !bySlot[1] || !bySlot[2] || !bySlot[3])
    {
        return undefined;
    }

    var roomName = bySlot[0].room.name;
    for (var i = 0; i < 4; i++)
    {
        if (bySlot[i].room.name != roomName || bySlot[i].fatigue > 0)
        {
            return undefined;
        }
    }

    var topLeft = bySlot[0].pos;
    if (!isValidTopLeft(topLeft))
    {
        return undefined;
    }
    for (var s = 1; s < 4; s++)
    {
        var expected = offsetPos(topLeft, SLOT_OFFSETS[s].x, SLOT_OFFSETS[s].y);
        if (!samePos(bySlot[s].pos, expected))
        {
            return undefined;
        }
    }
    return {topLeft: topLeft, bySlot: bySlot};
}

function getBySlot(members)
{
    var bySlot = [];
    for (var i = 0; i < members.length; i++)
    {
        var slot = members[i].memory.slot;
        if (typeof slot == 'number' && slot >= 0 && slot < 4)
        {
            bySlot[slot] = members[i];
        }
    }
    return bySlot;
}

function holdIncompleteSquad(members, rallyPos)
{
    for (var i = 0; i < members.length; i++)
    {
        var member = members[i];
        if (member.fatigue > 0)
        {
            continue;
        }
        if (rallyPos)
        {
            if (!isNearRoomPosition(member.pos, rallyPos, 3))
            {
                moveToRally(member, rallyPos, 15);
            }
            continue;
        }
        var homeSpawn = getHomeSpawn(member);
        if (!homeSpawn)
        {
            continue;
        }
        if (member.pos.isEqualTo(homeSpawn.pos) || !member.pos.inRangeTo(homeSpawn, 3))
        {
            member.moveTo(homeSpawn, {range: 2, reusePath: 10});
        }
    }
}

function markMemberLossRetreat(squadMemory, liveCount)
{
    squadMemory.state = 'retreating_member_lost';
    squadMemory.retreatingAfterLoss = true;
    if (!squadMemory.memberLostAt)
    {
        squadMemory.memberLostAt = Game.time;
    }
    squadMemory.memberLostLiveCount = liveCount;
}

function shouldContinueUnpackedRetreat(members, squadMemory)
{
    if (!members || members.length == 0 || !squadMemory || !isRetreatState(squadMemory.state))
    {
        return false;
    }
    var retreatPos = getRetreatTargetPos(members[0], squadMemory);
    if (!retreatPos)
    {
        return false;
    }
    if (allAtRetreatTarget(members, squadMemory))
    {
        squadMemory.state = 'regrouping_after_retreat';
        return false;
    }
    squadMemory.formed = false;
    delete squadMemory.packTopLeft;
    healSquad(members[0].room, members, false);
    attackNearby(members, undefined);
    retreatIncompleteSquad(members, squadMemory);
    return true;
}

function retreatIncompleteSquad(members, squadMemory)
{
    if (squadMemory)
    {
        squadMemory.lastRetreatAt = Game.time;
    }
    for (var i = 0; i < members.length; i++)
    {
        var member = members[i];
        var retreatPos = getRetreatTargetPos(member, squadMemory);
        if (!retreatPos)
        {
            continue;
        }
        if (member.fatigue == 0 && !isNearRoomPosition(member.pos, retreatPos, 3))
        {
            if (member.room.name != retreatPos.roomName)
            {
                moveToRoom(member, retreatPos.roomName, 10,
                    squadMemory && squadMemory.retreatExit,
                    squadMemory && squadMemory.retreatExitType);
            }
            else
            {
                member.moveTo(retreatPos, {range: 3, reusePath: 10});
            }
        }
    }
}

function allAtRetreatTarget(members, squadMemory)
{
    for (var i = 0; i < members.length; i++)
    {
        var retreatPos = getRetreatTargetPos(members[i], squadMemory);
        if (!retreatPos || !isNearRoomPosition(members[i].pos, retreatPos, 5))
        {
            return false;
        }
    }
    return true;
}

function getRetreatTargetPos(creep, squadMemory)
{
    var retreatRoom = getRetreatRoomName(creep, squadMemory);
    if (retreatRoom)
    {
        var retreatAnchor = getRetreatAnchorPos(retreatRoom);
        if (retreatAnchor)
        {
            return retreatAnchor;
        }
        if (squadMemory)
        {
            squadMemory.retreatRoomError = 'invalid room ' + retreatRoom;
        }
    }
    var homeSpawn = getHomeSpawn(creep);
    if (homeSpawn)
    {
        return homeSpawn.pos;
    }
    var homeRoom = creep.memory.home || creep.memory.origin;
    if (homeRoom)
    {
        return getRoomCenterPos(homeRoom);
    }
    return undefined;
}

function getRetreatRoomName(creep, squadMemory)
{
    if (!creep)
    {
        return undefined;
    }
    squadMemory = squadMemory || {};
    var currentRoom = creep.room && creep.room.name;
    var pathRoom = getPreviousRetreatRoomFromPath(currentRoom, squadMemory);
    if (pathRoom)
    {
        squadMemory.retreatSource = 'roomPath';
        squadMemory.retreatTargetRoom = pathRoom;
        return pathRoom;
    }

    var ownedRoom = getOwnedRcl6RetreatRoom(currentRoom, creep, squadMemory);
    if (ownedRoom)
    {
        squadMemory.retreatSource = 'ownedRcl6';
        squadMemory.retreatTargetRoom = ownedRoom;
        return ownedRoom;
    }

    var homeRoom = getCreepHomeRoom(creep, squadMemory);
    if (isValidRoomName(homeRoom))
    {
        squadMemory.retreatSource = 'homeFallback';
        squadMemory.retreatTargetRoom = homeRoom;
        return homeRoom;
    }
    return undefined;
}

function getPreviousRetreatRoomFromPath(currentRoom, squadMemory)
{
    if (!isValidRoomName(currentRoom) || !squadMemory)
    {
        return undefined;
    }
    var path = sanitizeRoomPath(squadMemory.roomPath);
    if (path.length == 0)
    {
        return undefined;
    }
    var index = lastRoomPathIndex(path, currentRoom);
    if (index > 0)
    {
        return path[index - 1];
    }
    if (index < 0)
    {
        return chooseNearestRoomFromPath(currentRoom, path);
    }
    return undefined;
}

function sanitizeRoomPath(path)
{
    if (!Array.isArray(path))
    {
        return [];
    }
    var result = [];
    for (var i = 0; i < path.length; i++)
    {
        var roomName = path[i];
        if (!isValidRoomName(roomName))
        {
            continue;
        }
        if (result.length == 0 || result[result.length - 1] != roomName)
        {
            result.push(roomName);
        }
    }
    return result;
}

function lastRoomPathIndex(path, roomName)
{
    for (var i = path.length - 1; i >= 0; i--)
    {
        if (path[i] == roomName)
        {
            return i;
        }
    }
    return -1;
}

function chooseNearestRoomFromPath(currentRoom, path)
{
    var bestRoom = undefined;
    var bestScore = Infinity;
    for (var i = path.length - 1; i >= 0; i--)
    {
        var roomName = path[i];
        if (!isValidRoomName(roomName))
        {
            continue;
        }
        var score = Game.map.getRoomLinearDistance(currentRoom, roomName) * 100 - i;
        if (score < bestScore)
        {
            bestScore = score;
            bestRoom = roomName;
        }
    }
    return bestRoom;
}

function getSquadOriginRoom(members, squadMemory)
{
    if (members)
    {
        for (var i = 0; i < members.length; i++)
        {
            var roomName = getCreepHomeRoom(members[i], squadMemory);
            if (isValidRoomName(roomName))
            {
                return roomName;
            }
        }
    }
    if (squadMemory && isValidRoomName(squadMemory.retreatRoom))
    {
        return squadMemory.retreatRoom;
    }
    return undefined;
}

function getCreepHomeRoom(creep, squadMemory)
{
    if (creep && creep.memory)
    {
        if (isValidRoomName(creep.memory.home))
        {
            return creep.memory.home;
        }
        if (isValidRoomName(creep.memory.origin))
        {
            return creep.memory.origin;
        }
        if (isValidRoomName(creep.memory.retreatRoom))
        {
            return creep.memory.retreatRoom;
        }
    }
    if (squadMemory && isValidRoomName(squadMemory.retreatRoom))
    {
        return squadMemory.retreatRoom;
    }
    return undefined;
}

function getOwnedRcl6RetreatRoom(currentRoom, creep, squadMemory)
{
    if (isOwnedRcl6Room(currentRoom))
    {
        return currentRoom;
    }

    var preferred = [getCreepHomeRoom(creep, squadMemory)];
    if (squadMemory && isValidRoomName(squadMemory.retreatRoom))
    {
        preferred.push(squadMemory.retreatRoom);
    }
    for (var p = 0; p < preferred.length; p++)
    {
        if (isOwnedRcl6Room(preferred[p]))
        {
            return preferred[p];
        }
    }

    var rooms = getOwnedRcl6Rooms();
    var bestRoom = undefined;
    var bestScore = Infinity;
    for (var i = 0; i < rooms.length; i++)
    {
        var roomName = rooms[i];
        var distance = isValidRoomName(currentRoom) ? Game.map.getRoomLinearDistance(currentRoom, roomName) : 0;
        var score = distance * 10 + (getSpawnInRoom(roomName) ? 0 : 1);
        if (score < bestScore)
        {
            bestScore = score;
            bestRoom = roomName;
        }
    }
    return bestRoom;
}

function getOwnedRcl6Rooms()
{
    var rooms = [];
    var seen = {};
    for (var spawnName in Game.spawns)
    {
        var spawn = Game.spawns[spawnName];
        if (spawn && spawn.room && isOwnedRcl6Room(spawn.room.name) && !seen[spawn.room.name])
        {
            seen[spawn.room.name] = true;
            rooms.push(spawn.room.name);
        }
    }
    for (var roomName in Game.rooms)
    {
        if (isOwnedRcl6Room(roomName) && !seen[roomName])
        {
            seen[roomName] = true;
            rooms.push(roomName);
        }
    }
    return rooms;
}

function isOwnedRcl6Room(roomName)
{
    if (!isValidRoomName(roomName))
    {
        return false;
    }
    var room = Game.rooms[roomName];
    return !!(room && room.controller && room.controller.my && room.controller.level >= 6);
}

function getRetreatAnchorPos(roomName)
{
    var spawn = getSpawnInRoom(roomName);
    if (spawn)
    {
        return spawn.pos;
    }
    var room = Game.rooms[roomName];
    if (room && room.storage)
    {
        return room.storage.pos;
    }
    if (room && room.terminal)
    {
        return room.terminal.pos;
    }
    return getRoomCenterPos(roomName);
}

function isNearRoomPosition(pos, targetPos, range)
{
    return pos.roomName == targetPos.roomName && pos.getRangeTo(targetPos) <= range;
}

function getSpawnInRoom(roomName)
{
    for (var spawnName in Game.spawns)
    {
        var spawn = Game.spawns[spawnName];
        if (spawn.room.name == roomName)
        {
            return spawn;
        }
    }
    return undefined;
}

function getHomeSpawn(creep)
{
    var homeRoom = creep.memory.home || creep.memory.retreatRoom || creep.room.name;
    return getSpawnInRoom(homeRoom) || creep.pos.findClosestByRange(FIND_MY_SPAWNS);
}

function moveIncompleteSquad(members, targetFlag, targetRoom, rallyPos, options)
{
    options = options || {};
    var preferredExit = options.preferredExit;
    var preferredExitType = options.preferredExitType;
    var rally = rallyPos || (targetFlag ? targetFlag.pos : undefined);
    if (!rally && targetRoom)
    {
        rally = getRoomCenterPos(targetRoom);
    }
    if (!rally)
    {
        return;
    }

    var allInRallyRoom = allInSameRoom(members, rally.roomName);
    var landingHold = !allInRallyRoom ? getExitLandingHoldPos(preferredExit, rally.roomName, preferredExitType) : undefined;
    for (var i = 0; i < members.length; i++)
    {
        if (members[i].fatigue > 0)
        {
            continue;
        }
        if (landingHold && members[i].room.name == landingHold.roomName)
        {
            if (!isNearRoomPosition(members[i].pos, landingHold, 2) || isRoomEdgePos(members[i].pos))
            {
                members[i].moveTo(landingHold, {range: 1, reusePath: 3});
            }
            continue;
        }
        if (!isNearRoomPosition(members[i].pos, rally, 1))
        {
            moveToRally(members[i], rally, 15, preferredExit, preferredExitType);
        }
    }
}

function moveToRally(creep, rally, reusePath, preferredExit, preferredExitType)
{
    if (!creep || !rally)
    {
        return;
    }
    if (creep.room.name != rally.roomName)
    {
        moveToRoom(creep, rally.roomName, reusePath || 15, preferredExit, preferredExitType);
        return;
    }
    creep.moveTo(rally, {reusePath: reusePath || 15});
}

function getExitMoveDirection(exit)
{
    if (exit == FIND_EXIT_TOP)
    {
        return TOP;
    }
    if (exit == FIND_EXIT_RIGHT)
    {
        return RIGHT;
    }
    if (exit == FIND_EXIT_BOTTOM)
    {
        return BOTTOM;
    }
    if (exit == FIND_EXIT_LEFT)
    {
        return LEFT;
    }
    return undefined;
}

function getExitDirectionFromEdgePosition(pos, exitType)
{
    var direction = getExitMoveDirection(exitType);
    if (direction)
    {
        return direction;
    }
    if (!pos)
    {
        return undefined;
    }
    if (pos.y == 0)
    {
        return TOP;
    }
    if (pos.x == 49)
    {
        return RIGHT;
    }
    if (pos.y == 49)
    {
        return BOTTOM;
    }
    if (pos.x == 0)
    {
        return LEFT;
    }
    return undefined;
}

function getExitLandingHoldPos(preferredExit, targetRoom, preferredExitType)
{
    var exitPos = deserializePos(preferredExit);
    if (!exitPos || !isValidRoomName(targetRoom))
    {
        return undefined;
    }
    var x = Math.max(1, Math.min(48, exitPos.x));
    var y = Math.max(1, Math.min(48, exitPos.y));
    if (preferredExitType == FIND_EXIT_TOP)
    {
        y = 48;
    }
    else if (preferredExitType == FIND_EXIT_RIGHT)
    {
        x = 1;
    }
    else if (preferredExitType == FIND_EXIT_BOTTOM)
    {
        y = 1;
    }
    else if (preferredExitType == FIND_EXIT_LEFT)
    {
        x = 48;
    }
    else if (exitPos.y == 0)
    {
        y = 48;
    }
    else if (exitPos.x == 49)
    {
        x = 1;
    }
    else if (exitPos.y == 49)
    {
        y = 1;
    }
    else if (exitPos.x == 0)
    {
        x = 48;
    }
    return new RoomPosition(x, y, targetRoom);
}

function isOnExitEdge(creep, exit)
{
    return (exit == FIND_EXIT_TOP && creep.pos.y == 0)
        || (exit == FIND_EXIT_RIGHT && creep.pos.x == 49)
        || (exit == FIND_EXIT_BOTTOM && creep.pos.y == 49)
        || (exit == FIND_EXIT_LEFT && creep.pos.x == 0);
}

function moveToRoom(creep, roomName, reusePath, preferredExit, preferredExitType)
{
    if (!isValidRoomName(roomName) || creep.room.name == roomName)
    {
        return;
    }

    var preferredExitPos = deserializePos(preferredExit);
    if (preferredExitPos && preferredExitPos.roomName == creep.room.name && isRoomEdgePos(preferredExitPos))
    {
        var preferredDirection = getExitDirectionFromEdgePosition(preferredExitPos, preferredExitType);
        if (preferredDirection)
        {
            if (creep.pos.isEqualTo(preferredExitPos))
            {
                creep.move(preferredDirection);
                return;
            }
            creep.moveTo(preferredExitPos, {reusePath: reusePath || 15, range: 0});
            return;
        }
    }

    var exit = creep.room.findExitTo(roomName);
    if (exit > 0)
    {
        var exitDirection = getExitMoveDirection(exit);
        if (exitDirection && isOnExitEdge(creep, exit))
        {
            creep.move(exitDirection);
            return;
        }
        var exitPos = creep.pos.findClosestByRange(exit);
        if (exitPos)
        {
            if (exitDirection && exitPos.isEqualTo(creep.pos))
            {
                creep.move(exitDirection);
                return;
            }
            creep.moveTo(exitPos, {reusePath: reusePath || 15});
        }
    }
}

function getUnpackedTravelOptions(squadMemory)
{
    if (!squadMemory)
    {
        return {};
    }
    if (isRetreatState(squadMemory.state))
    {
        return {
            preferredExit: squadMemory.retreatExit,
            preferredExitType: squadMemory.retreatExitType
        };
    }
    return {
        preferredExit: squadMemory.crossRoomExit,
        preferredExitType: squadMemory.crossRoomExitType
    };
}

function packSquad(members, squadMemory, targetFlag, targetRoom, rallyPos)
{
    var roomName = members[0].room.name;
    if (!allInSameRoom(members, roomName))
    {
        moveIncompleteSquad(members, targetFlag, targetRoom, rallyPos, getUnpackedTravelOptions(squadMemory));
        delete squadMemory.packTopLeft;
        return;
    }

    var topLeft = deserializePos(squadMemory.packTopLeft);
    if (!topLeft || topLeft.roomName != roomName || !canStandQuadAt(topLeft, members, false))
    {
        topLeft = findPackTopLeft(members, targetFlag, rallyPos);
        if (topLeft)
        {
            squadMemory.packTopLeft = serializePos(topLeft);
        }
    }
    if (!topLeft)
    {
        squadMemory.packBlockedAt = Game.time;
        squadMemory.packBlockedRoom = roomName;
        squadMemory.packBlockedMembers = members.length;
        return;
    }
    delete squadMemory.packBlockedAt;
    delete squadMemory.packBlockedRoom;
    delete squadMemory.packBlockedMembers;

    var bySlot = getBySlot(members);
    for (var s = 0; s < 4; s++)
    {
        if (bySlot[s])
        {
            var goal = offsetPos(topLeft, SLOT_OFFSETS[s].x, SLOT_OFFSETS[s].y);
            if (!samePos(bySlot[s].pos, goal) && bySlot[s].fatigue == 0)
            {
                bySlot[s].moveTo(goal, {reusePath: 3, ignoreCreeps: false});
            }
        }
    }
}

function allInSameRoom(members, roomName)
{
    for (var i = 0; i < members.length; i++)
    {
        if (members[i].room.name != roomName)
        {
            return false;
        }
    }
    return true;
}

function findPackTopLeft(members, targetFlag, rallyPos)
{
    var roomName = members[0].room.name;
    var center = rallyPos && rallyPos.roomName == roomName ? rallyPos : averagePosition(members, roomName);

    var topLeft = findPackTopLeftNear(center, members, targetFlag, rallyPos, PACK_SEARCH_RANGE);
    if (topLeft)
    {
        return topLeft;
    }

    // If the spawn/rally area is crowded by structures, walls, or other creeps,
    // deliberately relocate to a larger nearby open 2x2 instead of freezing.
    topLeft = findPackTopLeftNear(center, members, targetFlag, rallyPos, PACK_FALLBACK_SEARCH_RANGE);
    if (topLeft)
    {
        return topLeft;
    }

    var homeSpawn = getHomeSpawn(members[0]);
    if (homeSpawn && homeSpawn.room.name == roomName)
    {
        topLeft = findPackTopLeftNear(homeSpawn.pos, members, targetFlag, rallyPos, PACK_FALLBACK_SEARCH_RANGE);
        if (topLeft)
        {
            return topLeft;
        }
    }

    return findPackTopLeftNear(new RoomPosition(25, 25, roomName), members, targetFlag, rallyPos, PACK_FALLBACK_SEARCH_RANGE);
}

function findPackTopLeftNear(center, members, targetFlag, rallyPos, maxRange)
{
    var roomName = center.roomName;
    var best = undefined;
    var bestScore = Infinity;
    for (var range = 0; range <= maxRange; range++)
    {
        for (var dx = -range; dx <= range; dx++)
        {
            for (var dy = -range; dy <= range; dy++)
            {
                if (Math.max(Math.abs(dx), Math.abs(dy)) != range)
                {
                    continue;
                }
                var px = center.x + dx;
                var py = center.y + dy;
                if (px < 1 || py < 1 || px > 47 || py > 47)
                {
                    continue;
                }
                var pos = new RoomPosition(px, py, roomName);
                if (!canStandQuadAt(pos, members, false))
                {
                    continue;
                }
                var score = packTopLeftScore(pos, members, targetFlag, rallyPos);
                if (score < bestScore)
                {
                    best = pos;
                    bestScore = score;
                }
            }
        }
        if (best)
        {
            return best;
        }
    }
    return best;
}

function packTopLeftScore(pos, members, targetFlag, rallyPos)
{
    var score = 0;
    for (var i = 0; i < members.length; i++)
    {
        var slot = members[i].memory.slot;
        var slotPos = offsetPos(pos, SLOT_OFFSETS[slot].x, SLOT_OFFSETS[slot].y);
        score += members[i].pos.getRangeTo(slotPos);
    }
    if (rallyPos && rallyPos.roomName == pos.roomName)
    {
        score += pos.getRangeTo(rallyPos) / 5;
    }
    else if (targetFlag && targetFlag.pos.roomName == pos.roomName)
    {
        score += pos.getRangeTo(targetFlag.pos) / 10;
    }
    return score;
}

function averagePosition(members, roomName)
{
    var x = 0;
    var y = 0;
    var count = 0;
    for (var i = 0; i < members.length; i++)
    {
        if (members[i].room.name == roomName)
        {
            x += members[i].pos.x;
            y += members[i].pos.y;
            count++;
        }
    }
    if (count == 0)
    {
        return new RoomPosition(25, 25, roomName);
    }
    return new RoomPosition(Math.round(x / count), Math.round(y / count), roomName);
}

function canStandQuadAt(topLeft, squadMembers, allowDestructible)
{
    if (!isValidTopLeft(topLeft))
    {
        return false;
    }
    for (var i = 0; i < SLOT_OFFSETS.length; i++)
    {
        var pos = offsetPos(topLeft, SLOT_OFFSETS[i].x, SLOT_OFFSETS[i].y);
        if (!canStandAt(pos, squadMembers, allowDestructible))
        {
            return false;
        }
    }
    return true;
}

function isValidTopLeft(pos)
{
    return pos && pos.x >= 1 && pos.y >= 1 && pos.x <= 47 && pos.y <= 47;
}

function canStandAt(pos, squadMembers, allowDestructible)
{
    var terrain = Game.map.getRoomTerrain(pos.roomName);
    if (terrain.get(pos.x, pos.y) == TERRAIN_MASK_WALL)
    {
        return false;
    }

    var structures = pos.lookFor(LOOK_STRUCTURES);
    for (var i = 0; i < structures.length; i++)
    {
        if (isBlockingStructure(structures[i]) && !(allowDestructible && isDestructibleObstacle(structures[i])))
        {
            return false;
        }
    }

    var creeps = pos.lookFor(LOOK_CREEPS);
    for (var c = 0; c < creeps.length; c++)
    {
        if (!isSquadMember(creeps[c], squadMembers))
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

function isBlockingStructure(s)
{
    if (s.structureType == STRUCTURE_ROAD || s.structureType == STRUCTURE_CONTAINER)
    {
        return false;
    }
    if (s.structureType == STRUCTURE_RAMPART)
    {
        return !s.my && !s.isPublic;
    }
    return OBSTACLE_OBJECT_TYPES.indexOf(s.structureType) >= 0
        || s.structureType == STRUCTURE_WALL;
}

function isDestructibleObstacle(s)
{
    if (!s || !s.structureType || s.structureType == STRUCTURE_CONTROLLER)
    {
        return false;
    }
    if (s.my || (s.owner && isAllyName(s.owner.username)))
    {
        return false;
    }
    if (s.structureType == STRUCTURE_ROAD || s.structureType == STRUCTURE_CONTAINER)
    {
        return false;
    }
    if (s.structureType == STRUCTURE_RAMPART && (s.my || s.isPublic))
    {
        return false;
    }
    return s.structureType == STRUCTURE_WALL
        || s.structureType == STRUCTURE_RAMPART
        || s.my === false
        || !!s.owner;
}

function isHostileStructure(s)
{
    if (!s || s.my || s.structureType == STRUCTURE_CONTROLLER)
    {
        return false;
    }
    if (s.structureType == STRUCTURE_ROAD || s.structureType == STRUCTURE_CONTAINER
        || s.structureType == STRUCTURE_WALL || s.structureType == STRUCTURE_RAMPART)
    {
        return false;
    }
    if (s.owner && isAllyName(s.owner.username))
    {
        return false;
    }
    return true;
}

function getTowerAttackEnergyCost()
{
    return typeof TOWER_ENERGY_COST == 'number' ? TOWER_ENERGY_COST : 10;
}

function isActiveHostileTower(s)
{
    return s && s.structureType == STRUCTURE_TOWER
        && isHostileStructure(s)
        && s.store
        && s.store.getUsedCapacity(RESOURCE_ENERGY) >= getTowerAttackEnergyCost();
}

function getProtectedTarget(target)
{
    if (!target || !target.pos)
    {
        return undefined;
    }
    var structures = target.pos.lookFor(LOOK_STRUCTURES);
    for (var i = 0; i < structures.length; i++)
    {
        if (structures[i].structureType == STRUCTURE_RAMPART
            && structures[i].id != target.id
            && isDestructibleObstacle(structures[i]))
        {
            return structures[i];
        }
    }
    return undefined;
}

function isSquadMember(creep, squadMembers)
{
    for (var i = 0; i < squadMembers.length; i++)
    {
        if (squadMembers[i].id == creep.id)
        {
            return true;
        }
    }
    return false;
}

function estimateIncomingDamage(room, members)
{
    var result = {};
    var towers = room.find(FIND_HOSTILE_STRUCTURES,
    {
        filter: function(s) {
            return isActiveHostileTower(s);
        }
    });
    var hostiles = room.find(FIND_HOSTILE_CREEPS, {filter: isHostile});

    for (var i = 0; i < members.length; i++)
    {
        var rawDamage = 0;
        for (var t = 0; t < towers.length; t++)
        {
            rawDamage += combatMath.towerDamageAt(towers[t], members[i].pos);
        }
        for (var h = 0; h < hostiles.length; h++)
        {
            rawDamage += estimateMobileHostileRawDamageAt(hostiles[h], members[i].pos);
        }
        result[members[i].name] = combatMath.damageAfterTough(members[i], rawDamage);
    }
    return result;
}

function healSquad(room, members, packed, incomingDamage)
{
    incomingDamage = incomingDamage || {};
    if (packed)
    {
        var healPlan = getPackedHealPlan(members, incomingDamage);
        for (var i = 0; i < members.length; i++)
        {
            var healer = members[i];
            if (healer.getActiveBodyparts(HEAL) <= 0)
            {
                continue;
            }
            var targetName = healPlan.assignments[healer.name];
            var target = targetName ? Game.creeps[targetName] : undefined;
            if (!target)
            {
                target = chooseHealTarget(members, incomingDamage);
            }
            if (target && healer.pos.isNearTo(target))
            {
                healer.heal(target);
            }
            else if (target && healer.pos.inRangeTo(target, 3))
            {
                healer.rangedHeal(target);
            }
        }
        return;
    }

    var target = chooseHealTarget(members, incomingDamage);
    if (!target)
    {
        return;
    }
    for (var j = 0; j < members.length; j++)
    {
        var unpackedHealer = members[j];
        if (unpackedHealer.getActiveBodyparts(HEAL) <= 0)
        {
            continue;
        }
        if (unpackedHealer.pos.isNearTo(target))
        {
            unpackedHealer.heal(target);
        }
        else if (unpackedHealer.pos.inRangeTo(target, 3))
        {
            unpackedHealer.rangedHeal(target);
        }
        else
        {
            var localTarget = chooseHealTarget(unpackedHealer.pos.findInRange(members, 3), incomingDamage);
            if (localTarget)
            {
                if (unpackedHealer.pos.isNearTo(localTarget))
                {
                    unpackedHealer.heal(localTarget);
                }
                else
                {
                    unpackedHealer.rangedHeal(localTarget);
                }
            }
        }
    }
}

function chooseHealTarget(members, incomingDamage)
{
    var target = undefined;
    var worstScore = Infinity;
    incomingDamage = incomingDamage || {};
    for (var i = 0; i < members.length; i++)
    {
        var expected = members[i].hits - (incomingDamage[members[i].name] || 0);
        var missing = members[i].hitsMax - members[i].hits;
        var score = expected - missing;
        if (!target || score < worstScore)
        {
            target = members[i];
            worstScore = score;
        }
    }
    return target;
}

function getPackedHealPlan(members, incomingDamage)
{
    var assignedHeal = {};
    var assignments = {};
    var healers = [];
    var totalHeal = 0;
    var maxDamage = 0;
    var totalDamage = 0;
    incomingDamage = incomingDamage || {};

    for (var i = 0; i < members.length; i++)
    {
        var member = members[i];
        var power = combatMath.directHealPower(member);
        var damage = incomingDamage[member.name] || 0;
        assignedHeal[member.name] = 0;
        maxDamage = Math.max(maxDamage, damage);
        totalDamage += damage;
        if (power > 0)
        {
            healers.push({creep: member, power: power});
            totalHeal += power;
        }
    }

    healers.sort(function(a, b) { return b.power - a.power; });
    for (var h = 0; h < healers.length; h++)
    {
        var target = chooseHealAssignmentTarget(members, incomingDamage, assignedHeal);
        if (!target)
        {
            continue;
        }
        assignments[healers[h].creep.name] = target.name;
        assignedHeal[target.name] = (assignedHeal[target.name] || 0) + healers[h].power;
    }

    var worstProjected = Infinity;
    var maxUncoveredDamage = 0;
    var totalUncoveredDamage = 0;
    for (var j = 0; j < members.length; j++)
    {
        var creep = members[j];
        var memberDamage = incomingDamage[creep.name] || 0;
        var memberHeal = assignedHeal[creep.name] || 0;
        var uncovered = Math.max(0, memberDamage - memberHeal);
        maxUncoveredDamage = Math.max(maxUncoveredDamage, uncovered);
        totalUncoveredDamage += uncovered;
        worstProjected = Math.min(worstProjected, combatMath.projectedHits(creep, memberDamage, memberHeal));
    }
    if (worstProjected == Infinity)
    {
        worstProjected = 0;
    }

    return {
        assignments: assignments,
        assignedHeal: assignedHeal,
        totalHeal: totalHeal,
        maxDamage: maxDamage,
        totalDamage: totalDamage,
        worstProjected: worstProjected,
        maxUncoveredDamage: maxUncoveredDamage,
        totalUncoveredDamage: totalUncoveredDamage
    };
}

function chooseHealAssignmentTarget(members, incomingDamage, assignedHeal)
{
    var target = undefined;
    var bestScore = -Infinity;
    for (var i = 0; i < members.length; i++)
    {
        var member = members[i];
        var damage = incomingDamage[member.name] || 0;
        var assigned = assignedHeal[member.name] || 0;
        var missing = member.hitsMax - member.hits;
        var uncoveredDamage = Math.max(0, damage - assigned);
        var remainingNeed = Math.max(0, damage + missing - assigned);
        var projected = combatMath.projectedHits(member, damage, assigned);
        var score = uncoveredDamage * 100000
            + remainingNeed * 1000
            + (member.hitsMax - projected);
        if (!target || score > bestScore)
        {
            target = member;
            bestScore = score;
        }
    }
    return target;
}

function getRetreatStatus(members, incomingDamage)
{
    var healPlan = getPackedHealPlan(members, incomingDamage || {});
    return {
        assignments: healPlan.assignments,
        assignedHeal: healPlan.assignedHeal,
        totalHeal: healPlan.totalHeal,
        maxDamage: healPlan.maxDamage,
        totalDamage: healPlan.totalDamage,
        maxUncoveredDamage: healPlan.maxUncoveredDamage,
        totalUncoveredDamage: healPlan.totalUncoveredDamage,
        worstProjected: healPlan.worstProjected,
        shouldRetreat: healPlan.worstProjected < RETREAT_EXPECTED_HITS
            || healPlan.maxDamage > healPlan.totalHeal
            || healPlan.totalDamage > healPlan.totalHeal
            || healPlan.maxUncoveredDamage > 0
    };
}

function recordQuadCombatStatus(squadMemory, status)
{
    if (!squadMemory || !status)
    {
        return;
    }
    squadMemory.combatStatusAt = Game.time;
    squadMemory.combatTotalHeal = Math.round(status.totalHeal || 0);
    squadMemory.combatMaxDamage = Math.round(status.maxDamage || 0);
    squadMemory.combatTotalDamage = Math.round(status.totalDamage || 0);
    squadMemory.combatMaxUncoveredDamage = Math.round(status.maxUncoveredDamage || 0);
    squadMemory.combatTotalUncoveredDamage = Math.round(status.totalUncoveredDamage || 0);
    squadMemory.combatWorstProjected = Math.round(status.worstProjected || 0);
    squadMemory.combatShouldRetreat = status.shouldRetreat == true;
    squadMemory.combatHealAssignments = status.assignments;
}

function tryRepositionPackedQuadForDamage(room, members, topLeft, squadMemory, currentDamage, currentStatus)
{
    if (!room || !topLeft || !members || members.length != 4 || !currentStatus)
    {
        return undefined;
    }
    if (squadMemory && squadMemory.slotSwapEnabled === false)
    {
        return undefined;
    }
    if (!canIssuePackedSlotSwap(members, topLeft, squadMemory))
    {
        return undefined;
    }

    var damageSources = getDamageSources(room);
    if (damageSources.length == 0)
    {
        clearSlotSwapBlockedMemory(squadMemory);
        return undefined;
    }

    var currentAssignment = getCurrentSlotAssignment(members);
    var currentSignature = getSlotAssignmentSignature(members, currentAssignment);
    var currentScore = getSlotAssignmentScore(members, currentDamage || {}, currentStatus, squadMemory, currentSignature);
    var best = chooseBestSlotAssignment(members, topLeft, damageSources, squadMemory, currentAssignment, currentSignature);
    if (!best || best.signature == currentSignature)
    {
        return undefined;
    }

    var decision = shouldExecuteSlotSwap(currentStatus, currentScore, best, squadMemory);
    if (!decision.execute)
    {
        if (currentStatus.shouldRetreat)
        {
            squadMemory.slotSwapBlockedAt = Game.time;
            squadMemory.slotSwapBlockedReason = decision.reason;
            squadMemory.slotSwapBlockedCurrentScore = Math.round(currentScore);
            squadMemory.slotSwapBlockedBestScore = Math.round(best.score);
            squadMemory.slotSwapBlockedBest = best.changeSummary;
        }
        return undefined;
    }

    if (!executePackedSlotSwap(members, topLeft, best.assignment, squadMemory, currentSignature, best, currentScore, decision.reason))
    {
        return undefined;
    }
    return best;
}

function canIssuePackedSlotSwap(members, topLeft, squadMemory)
{
    for (var i = 0; i < members.length; i++)
    {
        var member = members[i];
        var slot = member.memory.slot;
        if (typeof slot != 'number' || slot < 0 || slot >= SLOT_OFFSETS.length)
        {
            if (squadMemory)
            {
                squadMemory.slotSwapBlockedAt = Game.time;
                squadMemory.slotSwapBlockedReason = 'invalid slot memory';
            }
            return false;
        }
        if (member.fatigue > 0)
        {
            if (squadMemory)
            {
                squadMemory.slotSwapBlockedAt = Game.time;
                squadMemory.slotSwapBlockedReason = 'fatigue';
                squadMemory.slotSwapBlockedCreep = member.name;
            }
            return false;
        }
        if (!samePos(member.pos, offsetPos(topLeft, SLOT_OFFSETS[slot].x, SLOT_OFFSETS[slot].y)))
        {
            if (squadMemory)
            {
                squadMemory.slotSwapBlockedAt = Game.time;
                squadMemory.slotSwapBlockedReason = 'member not in assigned slot';
                squadMemory.slotSwapBlockedCreep = member.name;
            }
            return false;
        }
    }
    return true;
}

function getCurrentSlotAssignment(members)
{
    var assignment = [];
    for (var i = 0; i < members.length; i++)
    {
        assignment.push(members[i].memory.slot);
    }
    return assignment;
}

function chooseBestSlotAssignment(members, topLeft, damageSources, squadMemory, currentAssignment, currentSignature)
{
    var best = undefined;
    for (var a = 0; a < 4; a++)
    {
        for (var b = 0; b < 4; b++)
        {
            if (b == a)
            {
                continue;
            }
            for (var c = 0; c < 4; c++)
            {
                if (c == a || c == b)
                {
                    continue;
                }
                for (var d = 0; d < 4; d++)
                {
                    if (d == a || d == b || d == c)
                    {
                        continue;
                    }
                    var assignment = [a, b, c, d];
                    var signature = getSlotAssignmentSignature(members, assignment);
                    var damage = estimateIncomingDamageForSlotAssignment(members, topLeft, damageSources, assignment);
                    var status = getRetreatStatus(members, damage);
                    var baseScore = getSlotAssignmentScore(members, damage, status, squadMemory, signature);
                    var score = baseScore + getSlotSwapBacktrackPenalty(signature, squadMemory);
                    var moveCount = getSlotAssignmentMoveCount(currentAssignment, assignment);
                    var candidate = {
                        assignment: assignment,
                        signature: signature,
                        damage: damage,
                        status: status,
                        baseScore: baseScore,
                        score: score,
                        moveCount: moveCount,
                        changeSummary: describeSlotAssignmentChange(members, currentAssignment, assignment)
                    };
                    if (!best || isBetterSlotAssignmentCandidate(candidate, best))
                    {
                        best = candidate;
                    }
                }
            }
        }
    }
    return best;
}

function estimateIncomingDamageForSlotAssignment(members, topLeft, damageSources, assignment)
{
    var result = {};
    for (var i = 0; i < members.length; i++)
    {
        var member = members[i];
        var slot = assignment[i];
        var slotPos = offsetPos(topLeft, SLOT_OFFSETS[slot].x, SLOT_OFFSETS[slot].y);
        var rawDamage = 0;
        for (var s = 0; s < damageSources.length; s++)
        {
            rawDamage += getRawDamageFromSourceAtPos(damageSources[s], slotPos);
        }
        result[member.name] = combatMath.damageAfterTough(member, rawDamage);
    }
    return result;
}

function getSlotAssignmentScore(members, damage, status, squadMemory, signature)
{
    var score = (status.shouldRetreat ? 10000000 : 0)
        + (status.maxUncoveredDamage || 0) * 5000
        + (status.totalUncoveredDamage || 0) * 2000
        + Math.max(0, RETREAT_EXPECTED_HITS - (status.worstProjected || 0)) * 2000
        + (status.maxDamage || 0) * 25
        + (status.totalDamage || 0) * 5;
    for (var i = 0; i < members.length; i++)
    {
        var member = members[i];
        var memberDamage = damage[member.name] || 0;
        var assignedHeal = status.assignedHeal ? (status.assignedHeal[member.name] || 0) : 0;
        var projected = combatMath.projectedHits(member, memberDamage, assignedHeal);
        score += Math.max(0, member.hitsMax - projected) * 5;
        score += Math.max(0, RETREAT_EXPECTED_HITS - projected) * 1000;
        if (member.hits < member.hitsMax)
        {
            score += memberDamage * 10;
        }
    }
    if (squadMemory && squadMemory.slotSwapPreferredSignature == signature)
    {
        score -= 100;
    }
    return score;
}

function getSlotSwapBacktrackPenalty(signature, squadMemory)
{
    if (!squadMemory || !squadMemory.slotSwapAt || Game.time - squadMemory.slotSwapAt > 3)
    {
        return 0;
    }
    if (signature == squadMemory.slotSwapFromSignature)
    {
        return SLOT_SWAP_BACKTRACK_PENALTY;
    }
    return 0;
}

function isBetterSlotAssignmentCandidate(candidate, best)
{
    if (candidate.score != best.score)
    {
        return candidate.score < best.score;
    }
    if (candidate.status.shouldRetreat != best.status.shouldRetreat)
    {
        return !candidate.status.shouldRetreat;
    }
    if ((candidate.status.maxUncoveredDamage || 0) != (best.status.maxUncoveredDamage || 0))
    {
        return (candidate.status.maxUncoveredDamage || 0) < (best.status.maxUncoveredDamage || 0);
    }
    if ((candidate.status.maxDamage || 0) != (best.status.maxDamage || 0))
    {
        return (candidate.status.maxDamage || 0) < (best.status.maxDamage || 0);
    }
    return candidate.moveCount < best.moveCount;
}

function shouldExecuteSlotSwap(currentStatus, currentScore, best, squadMemory)
{
    var improvement = currentScore - best.score;
    if (currentStatus.shouldRetreat)
    {
        if (!best.status.shouldRetreat && improvement >= SLOT_SWAP_RETREAT_SCORE_IMPROVEMENT)
        {
            return {execute: true, reason: 'swap_makes_damage_healable'};
        }
        return {execute: false, reason: 'swap_does_not_make_damage_healable'};
    }
    if (best.status.shouldRetreat)
    {
        return {execute: false, reason: 'best_swap_is_unsafe'};
    }
    if (squadMemory && squadMemory.slotSwapAt && Game.time - squadMemory.slotSwapAt < SLOT_SWAP_COOLDOWN)
    {
        return {execute: false, reason: 'slot_swap_cooldown'};
    }
    if ((currentStatus.maxDamage || 0) <= 0)
    {
        return {execute: false, reason: 'no_incoming_damage'};
    }
    if (improvement >= SLOT_SWAP_MIN_SCORE_IMPROVEMENT)
    {
        return {execute: true, reason: 'reduce_projected_damage'};
    }
    if ((currentStatus.maxDamage || 0) - (best.status.maxDamage || 0) >= SLOT_SWAP_MIN_DAMAGE_REDUCTION)
    {
        return {execute: true, reason: 'reduce_peak_damage'};
    }
    if ((currentStatus.totalDamage || 0) - (best.status.totalDamage || 0) >= SLOT_SWAP_MIN_DAMAGE_REDUCTION)
    {
        return {execute: true, reason: 'reduce_total_damage'};
    }
    return {execute: false, reason: 'insufficient_improvement'};
}

function executePackedSlotSwap(members, topLeft, assignment, squadMemory, currentSignature, best, currentScore, reason)
{
    var intents = [];
    for (var i = 0; i < members.length; i++)
    {
        var member = members[i];
        var slot = assignment[i];
        var targetPos = offsetPos(topLeft, SLOT_OFFSETS[slot].x, SLOT_OFFSETS[slot].y);
        if (samePos(member.pos, targetPos))
        {
            intents.push({member: member, slot: slot, direction: undefined});
            continue;
        }
        var direction = member.pos.getDirectionTo(targetPos);
        if (!direction)
        {
            if (squadMemory)
            {
                squadMemory.slotSwapBlockedAt = Game.time;
                squadMemory.slotSwapBlockedReason = 'invalid internal direction';
                squadMemory.slotSwapBlockedCreep = member.name;
            }
            return false;
        }
        intents.push({member: member, slot: slot, direction: direction});
    }

    var errors = {};
    var ok = true;
    for (var j = 0; j < intents.length; j++)
    {
        if (!intents[j].direction)
        {
            continue;
        }
        var moveResult = intents[j].member.move(intents[j].direction);
        if (moveResult != OK)
        {
            ok = false;
            errors[intents[j].member.name] = moveResult;
        }
    }
    if (!ok)
    {
        if (squadMemory)
        {
            squadMemory.slotSwapBlockedAt = Game.time;
            squadMemory.slotSwapBlockedReason = 'move intent failed';
            squadMemory.slotSwapErrors = errors;
        }
        return false;
    }

    for (var k = 0; k < intents.length; k++)
    {
        intents[k].member.memory.previousSlot = intents[k].member.memory.slot;
        intents[k].member.memory.slot = intents[k].slot;
    }

    if (squadMemory)
    {
        squadMemory.state = 'swapping_slots';
        squadMemory.slotSwapAt = Game.time;
        squadMemory.slotSwapReason = reason;
        squadMemory.slotSwapFromSignature = currentSignature;
        squadMemory.slotSwapToSignature = best.signature;
        squadMemory.slotSwapPreferredSignature = best.signature;
        squadMemory.slotSwapChange = best.changeSummary;
        squadMemory.slotSwapCurrentScore = Math.round(currentScore);
        squadMemory.slotSwapScore = Math.round(best.score);
        squadMemory.slotSwapBaseScore = Math.round(best.baseScore);
        squadMemory.slotSwapMaxDamage = Math.round(best.status.maxDamage || 0);
        squadMemory.slotSwapTotalDamage = Math.round(best.status.totalDamage || 0);
        squadMemory.slotSwapMaxUncoveredDamage = Math.round(best.status.maxUncoveredDamage || 0);
        squadMemory.slotSwapTotalUncoveredDamage = Math.round(best.status.totalUncoveredDamage || 0);
        squadMemory.slotSwapWorstProjected = Math.round(best.status.worstProjected || 0);
        squadMemory.slotSwapHealAssignments = best.status.assignments;
        delete squadMemory.slotSwapBlockedAt;
        delete squadMemory.slotSwapBlockedReason;
        delete squadMemory.slotSwapBlockedCreep;
        delete squadMemory.slotSwapErrors;
    }
    return true;
}

function getSlotAssignmentMoveCount(currentAssignment, assignment)
{
    var count = 0;
    for (var i = 0; i < assignment.length; i++)
    {
        if (assignment[i] != currentAssignment[i])
        {
            count++;
        }
    }
    return count;
}

function getSlotAssignmentSignature(members, assignment)
{
    var parts = [];
    for (var i = 0; i < members.length; i++)
    {
        parts.push(members[i].name + ':' + assignment[i]);
    }
    return parts.join('|');
}

function describeSlotAssignmentChange(members, currentAssignment, assignment)
{
    var changes = [];
    for (var i = 0; i < members.length; i++)
    {
        if (currentAssignment[i] != assignment[i])
        {
            changes.push(members[i].name + ':' + currentAssignment[i] + '>' + assignment[i]);
        }
    }
    return changes.join('|');
}

function clearSlotSwapBlockedMemory(squadMemory)
{
    if (!squadMemory)
    {
        return;
    }
    delete squadMemory.slotSwapBlockedAt;
    delete squadMemory.slotSwapBlockedReason;
    delete squadMemory.slotSwapBlockedCreep;
    delete squadMemory.slotSwapErrors;
}

function kiteQuadAwayFromDamage(room, members, topLeft, squadMemory, currentStatus)
{
    var damageSources = getDamageSources(room);
    var threatCenter = getDamageThreatCenter(members, topLeft, damageSources);
    if (!threatCenter)
    {
        squadMemory.kiteBlocked = 'no damage source';
        squadMemory.kiteBlockedAt = Game.time;
        return false;
    }

    var currentScore = getKiteScore(topLeft, currentStatus, threatCenter, topLeft, squadMemory);
    var best = chooseBestAdjacentKiteStep(members, topLeft, squadMemory, damageSources, threatCenter, currentScore);

    if (!best || best.score >= currentScore)
    {
        best = findKiteEscapeStep(members, topLeft, squadMemory, damageSources, threatCenter, currentScore);
    }

    if (!best)
    {
        squadMemory.kiteBlocked = 'no safer adjacent 2x2 tile';
        squadMemory.kiteBlockedAt = Game.time;
        squadMemory.kiteFrom = serializePos(topLeft);
        squadMemory.kiteThreatCenter = serializePos(threatCenter);
        squadMemory.kiteMaxDamage = currentStatus.maxDamage;
        squadMemory.kiteTotalDamage = currentStatus.totalDamage;
        squadMemory.kiteMaxUncoveredDamage = currentStatus.maxUncoveredDamage;
        squadMemory.kiteTotalUncoveredDamage = currentStatus.totalUncoveredDamage;
        squadMemory.kiteTotalHeal = currentStatus.totalHeal;
        squadMemory.kiteWorstProjected = currentStatus.worstProjected;
        delete squadMemory.kiteTo;
        delete squadMemory.kiteGoal;
        return false;
    }

    if (!movePackedToTopLeft(members, topLeft, best.pos, squadMemory, 'kite'))
    {
        squadMemory.kiteBlocked = 'invalid kite direction';
        squadMemory.kiteBlockedAt = Game.time;
        return false;
    }

    squadMemory.state = best.status.shouldRetreat ? 'kiting' : 'kiting_to_healable_damage';
    squadMemory.kiteAt = Game.time;
    squadMemory.kiteFrom = serializePos(topLeft);
    squadMemory.kiteTo = serializePos(best.pos);
    squadMemory.kiteThreatCenter = serializePos(threatCenter);
    squadMemory.kiteMaxDamage = best.status.maxDamage;
    squadMemory.kiteTotalDamage = best.status.totalDamage;
    squadMemory.kiteMaxUncoveredDamage = best.status.maxUncoveredDamage;
    squadMemory.kiteTotalUncoveredDamage = best.status.totalUncoveredDamage;
    squadMemory.kiteTotalHeal = best.status.totalHeal;
    squadMemory.kiteWorstProjected = best.status.worstProjected;
    squadMemory.kiteScore = Math.round(best.score);
    squadMemory.kiteCurrentScore = Math.round(currentScore);
    if (best.goal)
    {
        squadMemory.kiteGoal = serializePos(best.goal);
        squadMemory.kiteGoalScore = Math.round(best.goalScore);
        squadMemory.kiteEscapePathLength = best.pathLength;
    }
    else
    {
        delete squadMemory.kiteGoal;
        delete squadMemory.kiteGoalScore;
        delete squadMemory.kiteEscapePathLength;
    }
    delete squadMemory.kiteBlocked;
    delete squadMemory.kiteBlockedAt;
    return true;
}

function chooseBestAdjacentKiteStep(members, topLeft, squadMemory, damageSources, threatCenter, currentScore)
{
    var best = undefined;
    var bestRange = getRangeToThreat(topLeft, threatCenter);
    var candidates = getAdjacentTopLeftCandidates(topLeft, members);
    for (var i = 0; i < candidates.length; i++)
    {
        var candidate = candidates[i];
        var candidateDamage = estimateIncomingDamageAt(members, candidate, damageSources);
        var candidateStatus = getRetreatStatus(members, candidateDamage);
        var candidateScore = getKiteScore(candidate, candidateStatus, threatCenter, topLeft, squadMemory);
        var candidateRange = getRangeToThreat(candidate, threatCenter);
        if (!best || candidateScore < best.score
            || (candidateScore == best.score && candidateRange > bestRange))
        {
            best = {
                pos: candidate,
                damage: candidateDamage,
                status: candidateStatus,
                range: candidateRange,
                score: candidateScore
            };
            bestRange = candidateRange;
        }
    }
    if (best && best.score < currentScore)
    {
        return best;
    }
    return best;
}

function findKiteEscapeStep(members, topLeft, squadMemory, damageSources, threatCenter, currentScore)
{
    var best = undefined;
    for (var range = 2; range <= KITE_ESCAPE_SEARCH_RANGE; range++)
    {
        for (var dx = -range; dx <= range; dx++)
        {
            for (var dy = -range; dy <= range; dy++)
            {
                if (Math.max(Math.abs(dx), Math.abs(dy)) != range)
                {
                    continue;
                }
                var gx = topLeft.x + dx;
                var gy = topLeft.y + dy;
                if (gx < 0 || gy < 0 || gx > 49 || gy > 49)
                {
                    continue;
                }
                var goal = new RoomPosition(gx, gy, topLeft.roomName);
                if (!isValidTopLeft(goal) || !canStandQuadAt(goal, members, false))
                {
                    continue;
                }
                var goalDamage = estimateIncomingDamageAt(members, goal, damageSources);
                var goalStatus = getRetreatStatus(members, goalDamage);
                var goalScore = getKiteScore(goal, goalStatus, threatCenter, topLeft, squadMemory);
                if (goalScore >= currentScore)
                {
                    continue;
                }

                var pathResult = PathFinder.search(topLeft, {pos: goal, range: 0},
                {
                    plainCost: 1,
                    swampCost: 5,
                    maxOps: KITE_ESCAPE_MAX_OPS,
                    maxRooms: 1,
                    roomCallback: function(roomName) {
                        return quadCostMatrix(roomName, members);
                    }
                });
                if (!pathResult || pathResult.incomplete || !pathResult.path || pathResult.path.length == 0
                    || pathResult.path.length > KITE_ESCAPE_SEARCH_RANGE + 2
                    || !isStandableQuadPath(pathResult.path, members))
                {
                    continue;
                }

                var first = new RoomPosition(pathResult.path[0].x, pathResult.path[0].y, pathResult.path[0].roomName || topLeft.roomName);
                if (!isValidTopLeft(first) || !canStandQuadAt(first, members, false))
                {
                    continue;
                }
                var firstDamage = estimateIncomingDamageAt(members, first, damageSources);
                var firstStatus = getRetreatStatus(members, firstDamage);
                var firstScore = getKiteScore(first, firstStatus, threatCenter, topLeft, squadMemory);
                if (firstScore > currentScore + KITE_STEP_RISK_TOLERANCE)
                {
                    continue;
                }
                if (!best || goalScore < best.goalScore
                    || (goalScore == best.goalScore && firstScore < best.score)
                    || (goalScore == best.goalScore && firstScore == best.score && pathResult.path.length < best.pathLength))
                {
                    best = {
                        pos: first,
                        damage: firstDamage,
                        status: firstStatus,
                        range: getRangeToThreat(first, threatCenter),
                        score: firstScore,
                        goal: goal,
                        goalScore: goalScore,
                        pathLength: pathResult.path.length
                    };
                }
            }
        }
        if (best && !best.status.shouldRetreat)
        {
            return best;
        }
    }
    return best;
}

function getAdjacentTopLeftCandidates(topLeft, members, allowDestructible)
{
    var candidates = [];
    for (var dx = -1; dx <= 1; dx++)
    {
        for (var dy = -1; dy <= 1; dy++)
        {
            if (dx == 0 && dy == 0)
            {
                continue;
            }
            var x = topLeft.x + dx;
            var y = topLeft.y + dy;
            if (x < 0 || y < 0 || x > 49 || y > 49)
            {
                continue;
            }
            var candidate = new RoomPosition(x, y, topLeft.roomName);
            if (isValidTopLeft(candidate) && canStandQuadAt(candidate, members, allowDestructible == true))
            {
                candidates.push(candidate);
            }
        }
    }
    return candidates;
}

function isStandableQuadPath(path, members)
{
    for (var i = 0; i < path.length; i++)
    {
        var pos = new RoomPosition(path[i].x, path[i].y, path[i].roomName || members[0].room.name);
        if (!isValidTopLeft(pos) || !canStandQuadAt(pos, members, false))
        {
            return false;
        }
    }
    return true;
}

function getKiteScore(topLeft, status, threatCenter, currentTopLeft, squadMemory)
{
    var range = getRangeToThreat(topLeft, threatCenter);
    var currentRange = getRangeToThreat(currentTopLeft, threatCenter);
    var distanceBonus = range - currentRange;
    var overheal = Math.max(0, status.maxDamage - status.totalHeal);
    var lowHits = Math.max(0, RETREAT_EXPECTED_HITS - status.worstProjected);
    var maxUncoveredDamage = status.maxUncoveredDamage || 0;
    var totalUncoveredDamage = status.totalUncoveredDamage || 0;
    return (status.shouldRetreat ? 1000000 : 0)
        + maxUncoveredDamage * 2000
        + totalUncoveredDamage * 1000
        + overheal * 1000
        + lowHits * 1000
        + status.maxDamage * 10
        + status.totalDamage
        + getKiteEdgePenalty(topLeft)
        + getKiteBacktrackPenalty(topLeft, squadMemory)
        - distanceBonus * 100;
}

function getKiteEdgePenalty(topLeft)
{
    var edgeDistance = Math.min(topLeft.x, topLeft.y, 48 - topLeft.x, 48 - topLeft.y);
    if (edgeDistance <= 1)
    {
        return (2 - edgeDistance) * KITE_EDGE_PENALTY;
    }
    return 0;
}

function getKiteBacktrackPenalty(topLeft, squadMemory)
{
    if (!squadMemory || !squadMemory.kiteFrom || !squadMemory.kiteAt || Game.time - squadMemory.kiteAt > 3)
    {
        return 0;
    }
    var previous = deserializePos(squadMemory.kiteFrom);
    if (previous && samePos(previous, topLeft))
    {
        return KITE_BACKTRACK_PENALTY;
    }
    return 0;
}

function getDamageSources(room)
{
    var sources = [];
    var towers = room.find(FIND_HOSTILE_STRUCTURES,
    {
        filter: function(s) {
            return isActiveHostileTower(s);
        }
    });
    for (var t = 0; t < towers.length; t++)
    {
        sources.push({type: 'tower', object: towers[t], pos: towers[t].pos});
    }

    var hostiles = room.find(FIND_HOSTILE_CREEPS,
    {
        filter: function(c) {
            return isHostile(c) && (combatMath.attackPower(c) > 0 || combatMath.rangedAttackPower(c) > 0);
        }
    });
    for (var h = 0; h < hostiles.length; h++)
    {
        sources.push({type: 'creep', object: hostiles[h], pos: hostiles[h].pos});
    }
    return sources;
}

function getDamageThreatCenter(members, topLeft, damageSources)
{
    var weightedX = 0;
    var weightedY = 0;
    var totalWeight = 0;
    for (var s = 0; s < damageSources.length; s++)
    {
        var source = damageSources[s];
        var sourceDamage = 0;
        for (var m = 0; m < members.length; m++)
        {
            sourceDamage += getRawDamageFromSourceAtPos(source, getMemberPosAtTopLeft(members[m], topLeft));
        }
        if (sourceDamage <= 0)
        {
            continue;
        }
        weightedX += source.pos.x * sourceDamage;
        weightedY += source.pos.y * sourceDamage;
        totalWeight += sourceDamage;
    }
    if (totalWeight <= 0)
    {
        return undefined;
    }
    var x = Math.max(0, Math.min(49, Math.round(weightedX / totalWeight)));
    var y = Math.max(0, Math.min(49, Math.round(weightedY / totalWeight)));
    return new RoomPosition(x, y, topLeft.roomName);
}

function estimateIncomingDamageAt(members, topLeft, damageSources)
{
    var result = {};
    for (var i = 0; i < members.length; i++)
    {
        var member = members[i];
        var pos = getMemberPosAtTopLeft(member, topLeft);
        var rawDamage = 0;
        for (var s = 0; s < damageSources.length; s++)
        {
            rawDamage += getRawDamageFromSourceAtPos(damageSources[s], pos);
        }
        result[member.name] = combatMath.damageAfterTough(member, rawDamage);
    }
    return result;
}

function getRawDamageFromSourceAtPos(source, pos)
{
    if (!source || !source.object || !pos)
    {
        return 0;
    }
    if (source.type == 'tower')
    {
        return combatMath.towerDamageAt(source.object, pos);
    }
    if (source.type == 'creep')
    {
        return estimateMobileHostileRawDamageAt(source.object, pos);
    }
    return 0;
}

function canHostileStepThisTick(hostile)
{
    return hostile
        && hostile.fatigue == 0
        && hostile.getActiveBodyparts(MOVE) > 0;
}

function estimateMobileHostileRawDamageAt(hostile, target)
{
    if (!hostile || !target)
    {
        return 0;
    }
    var targetPos = target.pos || target;
    var range = hostile.pos.getRangeTo(targetPos);
    var canStep = canHostileStepThisTick(hostile);
    var damage = 0;
    if (range <= 1 || (canStep && range <= 2))
    {
        damage += combatMath.attackPower(hostile);
    }
    if (range <= 3 || (canStep && range <= 4))
    {
        damage += combatMath.rangedAttackPower(hostile);
    }
    return damage;
}

function getMemberPosAtTopLeft(member, topLeft)
{
    var slot = member.memory.slot;
    if (typeof slot != 'number' || slot < 0 || slot >= SLOT_OFFSETS.length)
    {
        return topLeft;
    }
    return offsetPos(topLeft, SLOT_OFFSETS[slot].x, SLOT_OFFSETS[slot].y);
}

function getRangeToThreat(topLeft, threatCenter)
{
    if (!threatCenter)
    {
        return 0;
    }
    return topLeft.getRangeTo(threatCenter);
}

function chooseAttackTarget(room, members, topLeft, targetFlag, squadMemory)
{
    var targetId = squadMemory.targetId;
    for (var i = 0; i < members.length && !targetId; i++)
    {
        targetId = members[i].memory.targetId;
    }
    if (targetId)
    {
        var directTarget = Game.getObjectById(targetId);
        if (directTarget && directTarget.pos && directTarget.pos.roomName == room.name
            && directTarget.structureType
            && (isHostileStructure(directTarget) || isDestructibleObstacle(directTarget)))
        {
            delete squadMemory.targetIdError;
            return directTarget;
        }
        if (directTarget && directTarget.pos && directTarget.pos.roomName == room.name
            && directTarget.owner && isHostile(directTarget))
        {
            delete squadMemory.targetIdError;
            return directTarget;
        }
        if (directTarget && directTarget.pos && directTarget.pos.roomName != room.name)
        {
            squadMemory.targetIdError = 'target in other room ' + directTarget.pos.roomName;
            squadMemory.targetIdErrorAt = Game.time;
        }
        else
        {
            squadMemory.targetIdError = 'invalid or non-hostile targetId';
            squadMemory.targetIdErrorAt = Game.time;
        }
    }

    var dangerous = room.find(FIND_HOSTILE_CREEPS,
    {
        filter: function(c) {
            return isHostile(c) && (c.getActiveBodyparts(ATTACK) > 0
                || c.getActiveBodyparts(RANGED_ATTACK) > 0
                || c.getActiveBodyparts(HEAL) > 0);
        }
    });
    var immediateDangerous = filterDangerousCreepsByRange(dangerous, members, QUAD_IMMEDIATE_DANGER_RANGE, true);
    if (immediateDangerous.length > 0)
    {
        return chooseDangerousCreepTarget(immediateDangerous, members, topLeft, squadMemory);
    }

    var activeTowers = room.find(FIND_HOSTILE_STRUCTURES,
    {
        filter: isActiveHostileTower
    });
    if (activeTowers.length > 0)
    {
        return closestToPos(activeTowers, topLeft);
    }

    var closeDangerous = filterDangerousCreepsByRange(dangerous, members, QUAD_CLOSE_DANGER_RANGE, false);
    if (closeDangerous.length > 0)
    {
        return chooseDangerousCreepTarget(closeDangerous, members, topLeft, squadMemory);
    }

    var towers = room.find(FIND_HOSTILE_STRUCTURES,
    {
        filter: function(s) { return s.structureType == STRUCTURE_TOWER && isHostileStructure(s); }
    });
    if (towers.length > 0)
    {
        return closestToPos(towers, topLeft);
    }

    var spawns = room.find(FIND_HOSTILE_STRUCTURES,
    {
        filter: function(s) { return s.structureType == STRUCTURE_SPAWN && isHostileStructure(s); }
    });
    if (spawns.length > 0)
    {
        return closestToPos(spawns, topLeft);
    }

    var important = room.find(FIND_HOSTILE_STRUCTURES,
    {
        filter: function(s) {
            return isHostileStructure(s) && (s.structureType == STRUCTURE_INVADER_CORE
                || s.structureType == STRUCTURE_NUKER
                || s.structureType == STRUCTURE_POWER_SPAWN
                || s.structureType == STRUCTURE_TERMINAL
                || s.structureType == STRUCTURE_STORAGE
                || s.structureType == STRUCTURE_LAB);
        }
    });
    if (important.length > 0)
    {
        return closestToPos(important, topLeft);
    }

    var hostileCreeps = room.find(FIND_HOSTILE_CREEPS, {filter: isHostile});
    if (hostileCreeps.length > 0)
    {
        return closestToAnyMember(hostileCreeps, members);
    }

    if (targetFlag)
    {
        var nearFlagObstacle = lowestHits(targetFlag.pos.findInRange(FIND_STRUCTURES, 3,
        {
            filter: isDestructibleObstacle
        }));
        if (nearFlagObstacle)
        {
            return nearFlagObstacle;
        }
    }

    var hostileStructures = room.find(FIND_HOSTILE_STRUCTURES,
    {
        filter: function(s) {
            return s.structureType != STRUCTURE_CONTROLLER && isHostileStructure(s);
        }
    });
    if (hostileStructures.length > 0)
    {
        return closestToPos(hostileStructures, topLeft);
    }

    var obstacles = room.find(FIND_STRUCTURES,
    {
        filter: isDestructibleObstacle
    });
    return lowestHits(obstacles);
}

function getQuadAttackGoalRange(members, target)
{
    if (target && target.structureType
        && (squadHasActivePart(members, WORK) || squadHasActivePart(members, ATTACK)))
    {
        // A packed melee/dismantle quad cannot put all four members adjacent to a
        // one-tile target, but max range 2 lets the front side reach it. Do this
        // before ranged range-3 logic so hybrid breaker quads keep closing on
        // edge ramparts/walls/structures instead of stopping too far away.
        return 2;
    }
    if (squadHasActivePart(members, RANGED_ATTACK))
    {
        return 3;
    }
    if (squadHasActivePart(members, WORK) || squadHasActivePart(members, ATTACK))
    {
        return 2;
    }
    return 3;
}

function squadHasActivePart(members, partType)
{
    if (!members)
    {
        return false;
    }
    for (var i = 0; i < members.length; i++)
    {
        if (members[i].getActiveBodyparts(partType) > 0)
        {
            return true;
        }
    }
    return false;
}

function getMovementGoal(room, topLeft, target, targetFlag, targetRoom, members)
{
    if (target && target.pos)
    {
        return {pos: target.pos, range: getQuadAttackGoalRange(members, target), requireFullQuadRange: true};
    }
    if (targetFlag)
    {
        return {pos: targetFlag.pos, range: 3, requireFullQuadRange: true};
    }
    if (isValidRoomName(targetRoom) && room.name != targetRoom)
    {
        var route = Game.map.findRoute(room.name, targetRoom);
        if (Array.isArray(route) && route.length > 0)
        {
            var exit = topLeft.findClosestByRange(route[0].exit);
            if (exit)
            {
                return {pos: exit, range: 0, crossRoom: true};
            }
        }
        var targetCenter = getRoomCenterPos(targetRoom);
        if (targetCenter)
        {
            return {pos: targetCenter, range: 20};
        }
    }
    return undefined;
}

function getPackedExitGoal(room, targetRoom, topLeft, members)
{
    if (!room || !isValidRoomName(targetRoom) || room.name == targetRoom)
    {
        return undefined;
    }
    var route = Game.map.findRoute(room.name, targetRoom);
    if (!Array.isArray(route) || route.length == 0)
    {
        return undefined;
    }

    var exits = room.find(route[0].exit);
    var blockedFallback = undefined;
    exits.sort(function(a, b) { return topLeft.getRangeTo(a) - topLeft.getRangeTo(b); });
    for (var i = 0; i < exits.length; i++)
    {
        var stage = getPackedExitStage(exits[i]);
        if (!stage)
        {
            continue;
        }
        if (canStandQuadAt(stage, members, false))
        {
            return {
                pos: stage,
                range: 0,
                crossRoom: true,
                exit: serializePos(exits[i]),
                exitType: route[0].exit
            };
        }
        if (!blockedFallback && canStandQuadAt(stage, members, true))
        {
            blockedFallback = {
                pos: stage,
                range: 0,
                crossRoom: true,
                exit: serializePos(exits[i]),
                exitType: route[0].exit,
                blocked: true
            };
        }
    }
    return blockedFallback;
}

function getPackedExitStage(exit)
{
    if (!exit)
    {
        return undefined;
    }
    var x = exit.x;
    var y = exit.y;

    if (exit.x == 0)
    {
        x = 1;
    }
    else if (exit.x == 49)
    {
        x = 47;
    }
    else
    {
        x = Math.max(1, Math.min(47, x));
    }

    if (exit.y == 0)
    {
        y = 1;
    }
    else if (exit.y == 49)
    {
        y = 47;
    }
    else
    {
        y = Math.max(1, Math.min(47, y));
    }

    return new RoomPosition(x, y, exit.roomName);
}

function getNextStepBlocker(topLeft, goal, members, squadMemory)
{
    if (isQuadInGoalRange(topLeft, goal))
    {
        return undefined;
    }
    var path = findQuadPath(topLeft, goal, members, squadMemory, 'blocker', false);
    if (!path || path.length == 0)
    {
        return getAdjacentDestructibleFootprintBlocker(topLeft, goal, members);
    }
    var next = path[0];
    var nextTopLeft = new RoomPosition(next.x, next.y, next.roomName || topLeft.roomName);
    var blockers = [];
    for (var i = 0; i < SLOT_OFFSETS.length; i++)
    {
        var pos = offsetPos(nextTopLeft, SLOT_OFFSETS[i].x, SLOT_OFFSETS[i].y);
        var structures = pos.lookFor(LOOK_STRUCTURES);
        for (var s = 0; s < structures.length; s++)
        {
            if (isBlockingStructure(structures[s]) && isDestructibleObstacle(structures[s]))
            {
                blockers.push(structures[s]);
            }
        }
    }
    return lowestHits(blockers);
}

function getFootprintDestructibleBlocker(topLeft, members)
{
    var blockers = [];
    for (var i = 0; i < SLOT_OFFSETS.length; i++)
    {
        var pos = offsetPos(topLeft, SLOT_OFFSETS[i].x, SLOT_OFFSETS[i].y);
        var structures = pos.lookFor(LOOK_STRUCTURES);
        for (var s = 0; s < structures.length; s++)
        {
            if (isBlockingStructure(structures[s]) && isDestructibleObstacle(structures[s]))
            {
                blockers.push(structures[s]);
            }
        }
    }
    return lowestHits(blockers);
}

function getAdjacentDestructibleFootprintBlocker(topLeft, goal, members)
{
    var candidates = getAdjacentTopLeftCandidates(topLeft, members, true);
    var bestBlocker = undefined;
    var bestScore = Infinity;
    for (var i = 0; i < candidates.length; i++)
    {
        var candidate = candidates[i];
        if (canStandQuadAt(candidate, members, false))
        {
            continue;
        }
        var blocker = getFootprintDestructibleBlocker(candidate, members);
        if (!blocker)
        {
            continue;
        }
        var score = getQuadGoalRange(candidate, goal) * 100000 + (blocker.hits || 0);
        if (!bestBlocker || score < bestScore)
        {
            bestBlocker = blocker;
            bestScore = score;
        }
    }
    return bestBlocker;
}

function attackNearby(members, focusTarget)
{
    focusTarget = getProtectedTarget(focusTarget) || focusTarget;
    for (var i = 0; i < members.length; i++)
    {
        var creep = members[i];
        if (creep.getActiveBodyparts(RANGED_ATTACK) > 0)
        {
            var massScore = rangedMassScore(creep);
            var target = focusTarget && creep.pos.getRangeTo(focusTarget) <= 3
                ? focusTarget
                : bestRangedTarget(creep);
            target = getProtectedTarget(target) || target;
            if (shouldUseRangedMassAttack(creep, target, massScore))
            {
                creep.rangedMassAttack();
            }
            else if (target)
            {
                creep.rangedAttack(target);
            }
        }
        if (focusTarget && creep.getActiveBodyparts(WORK) > 0 && creep.pos.isNearTo(focusTarget)
            && focusTarget.structureType)
        {
            creep.dismantle(focusTarget);
        }
        else if (focusTarget && creep.getActiveBodyparts(ATTACK) > 0 && creep.pos.isNearTo(focusTarget))
        {
            creep.attack(focusTarget);
        }
    }
}

function shouldUseRangedMassAttack(creep, target, massScore)
{
    var focusedPower = combatMath.rangedAttackPower(creep);
    if (massScore <= focusedPower)
    {
        return false;
    }
    if (!target)
    {
        return true;
    }
    if (isDestructibleObstacle(target))
    {
        return false;
    }

    var range = creep.pos.getRangeTo(target);
    var massDamageToTarget = range <= 3 ? combatMath.rangedMassAttackPower(creep, range) : 0;
    if (isPriorityFocusTarget(target))
    {
        // At range 2-3 mass attack badly under-damages the priority target. At
        // range 1 it equals focused damage and can safely splash extras.
        return range <= 1 && massDamageToTarget >= focusedPower;
    }
    return massDamageToTarget >= focusedPower || massScore >= focusedPower * 2;
}

function isPriorityFocusTarget(target)
{
    if (!target)
    {
        return false;
    }
    if (target.structureType)
    {
        return target.structureType == STRUCTURE_TOWER
            || target.structureType == STRUCTURE_SPAWN
            || target.structureType == STRUCTURE_INVADER_CORE
            || target.structureType == STRUCTURE_NUKER
            || target.structureType == STRUCTURE_POWER_SPAWN
            || target.structureType == STRUCTURE_TERMINAL
            || target.structureType == STRUCTURE_STORAGE
            || target.structureType == STRUCTURE_LAB;
    }
    if (target.owner && isHostile(target))
    {
        return combatMath.attackPower(target) > 0
            || combatMath.rangedAttackPower(target) > 0
            || combatMath.directHealPower(target) > 0
            || combatMath.rangedHealPower(target) > 0;
    }
    return false;
}

function bestRangedTarget(creep)
{
    var targets = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3, {filter: isHostile});
    if (targets.length > 0)
    {
        return chooseDangerousCreepTarget(targets, [creep], creep.pos, undefined);
    }
    targets = creep.pos.findInRange(FIND_HOSTILE_STRUCTURES, 3,
    {
        filter: function(s) { return s.structureType != STRUCTURE_CONTROLLER && isHostileStructure(s); }
    });
    if (targets.length > 0)
    {
        return closestToPos(targets, creep.pos);
    }
    targets = creep.pos.findInRange(FIND_STRUCTURES, 3, {filter: isDestructibleObstacle});
    return lowestHits(targets);
}

function rangedMassScore(creep)
{
    var score = 0;
    var hostileCreeps = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3, {filter: isHostile});
    var hostileStructures = creep.pos.findInRange(FIND_HOSTILE_STRUCTURES, 3,
    {
        filter: function(s) {
            return isHostileStructure(s)
                && s.structureType != STRUCTURE_CONTROLLER
                && s.structureType != STRUCTURE_WALL
                && s.structureType != STRUCTURE_RAMPART;
        }
    });
    var targets = hostileCreeps.concat(hostileStructures);
    for (var i = 0; i < targets.length; i++)
    {
        var range = creep.pos.getRangeTo(targets[i]);
        if (range <= 1)
        {
            score += combatMath.rangedMassAttackPower(creep, range);
        }
        else if (range == 2)
        {
            score += combatMath.rangedMassAttackPower(creep, range);
        }
        else if (range == 3)
        {
            score += combatMath.rangedMassAttackPower(creep, range);
        }
    }
    return score;
}

function retreatQuad(members, topLeft, squadMemory, targetRoom)
{
    if (squadMemory)
    {
        squadMemory.lastRetreatAt = Game.time;
    }
    var retreatPos = getRetreatTargetPos(members[0], squadMemory);
    if (!retreatPos)
    {
        return;
    }

    if (retreatPos.roomName != topLeft.roomName)
    {
        var exitGoal = getPackedExitGoal(members[0].room, retreatPos.roomName, topLeft, members);
        if (exitGoal && !isQuadInGoalRange(topLeft, exitGoal))
        {
            var exitBlocker = getNextStepBlocker(topLeft, exitGoal, members, squadMemory);
            if (exitBlocker)
            {
                squadMemory.state = 'breaking_retreat_exit_blocker';
                squadMemory.retreatExitStage = serializePos(exitGoal.pos);
                squadMemory.retreatExit = exitGoal.exit;
                squadMemory.retreatExitType = exitGoal.exitType;
                attackNearby(members, exitBlocker);
                return;
            }
            squadMemory.state = 'retreating_packed_to_exit';
            squadMemory.retreatExitStage = serializePos(exitGoal.pos);
            squadMemory.retreatExit = exitGoal.exit;
            squadMemory.retreatExitType = exitGoal.exitType;
            movePackedQuad(members, topLeft, exitGoal, squadMemory);
            return;
        }

        squadMemory.state = 'retreating_crossing_exit_unpacked';
        squadMemory.formed = false;
        delete squadMemory.packTopLeft;
        moveIncompleteSquad(members, {pos: retreatPos}, retreatPos.roomName, undefined,
        {
            preferredExit: squadMemory.retreatExit,
            preferredExitType: squadMemory.retreatExitType
        });
        return;
    }

    squadMemory.state = 'retreating_packed';
    movePackedQuad(members, topLeft, {pos: retreatPos, range: 3}, squadMemory);
}

function movePackedQuad(members, topLeft, goal, squadMemory, options)
{
    if (!goal || !goal.pos)
    {
        return;
    }
    if (isQuadInGoalRange(topLeft, goal))
    {
        return;
    }

    var pathResult = findQuadPathResult(topLeft, goal, members, squadMemory, 'move', true);
    if (!pathResult || pathResult.incomplete || !pathResult.path || pathResult.path.length == 0)
    {
        var adjacentBlocker = getAdjacentDestructibleFootprintBlocker(topLeft, goal, members);
        if (adjacentBlocker)
        {
            squadMemory.state = 'breaking_adjacent_blocker';
            squadMemory.pathBlocked = 'adjacent destructible blocker';
            squadMemory.pathBlockedFrom = serializePos(topLeft);
            squadMemory.pathBlockedTo = serializePos(goal.pos);
            squadMemory.pathBlockedTarget = adjacentBlocker.id;
            squadMemory.pathBlockedAt = Game.time;
            attackNearby(members, adjacentBlocker);
            return;
        }
        if (tryStartNarrowFormationMove(members, topLeft, goal, squadMemory, options))
        {
            return;
        }
        squadMemory.stuck = (squadMemory.stuck || 0) + 1;
        squadMemory.state = 'no_2x2_path';
        squadMemory.pathBlocked = 'no valid 2x2 path';
        squadMemory.pathBlockedFrom = serializePos(topLeft);
        squadMemory.pathBlockedTo = serializePos(goal.pos);
        squadMemory.pathBlockedAt = Game.time;
        return;
    }

    var path = pathResult.path;
    var next = path[0];
    var nextPos = new RoomPosition(next.x, next.y, next.roomName || topLeft.roomName);
    if (options && options.avoidUnsafeDamage)
    {
        var safeStep = chooseSafePackedMoveStep(members, topLeft, goal, nextPos, squadMemory);
        if (!safeStep)
        {
            return;
        }
        nextPos = safeStep.pos;
    }

    if (!movePackedToTopLeft(members, topLeft, nextPos, squadMemory, 'move'))
    {
        return;
    }
    squadMemory.stuck = 0;
    delete squadMemory.pathBlocked;
    delete squadMemory.pathBlockedFrom;
    delete squadMemory.pathBlockedTo;
    delete squadMemory.pathBlockedTarget;
    delete squadMemory.pathBlockedAt;
}

function chooseSafePackedMoveStep(members, topLeft, goal, intendedNext, squadMemory)
{
    var room = Game.rooms[topLeft.roomName];
    if (!room || !isValidTopLeft(intendedNext) || !canStandQuadAt(intendedNext, members, false))
    {
        squadMemory.damageHoldAt = Game.time;
        squadMemory.damageHoldReason = 'next packed step is blocked';
        squadMemory.damageHoldFrom = serializePos(topLeft);
        squadMemory.damageHoldIntended = serializePos(intendedNext);
        squadMemory.damageHoldBlockers = describeFootprintBlockers(intendedNext, members);
        return undefined;
    }

    var damageSources = getDamageSources(room);
    if (damageSources.length == 0)
    {
        clearDamageHoldMemory(squadMemory);
        return {pos: intendedNext};
    }

    var currentDamage = estimateIncomingDamageAt(members, topLeft, damageSources);
    var currentStatus = getRetreatStatus(members, currentDamage);
    var nextDamage = estimateIncomingDamageAt(members, intendedNext, damageSources);
    var nextStatus = getRetreatStatus(members, nextDamage);
    if (!nextStatus.shouldRetreat || currentStatus.shouldRetreat)
    {
        clearDamageHoldMemory(squadMemory);
        return {pos: intendedNext, damage: nextDamage, status: nextStatus};
    }

    var currentGoalRange = getQuadGoalRange(topLeft, goal);
    var best = undefined;
    var candidates = getAdjacentTopLeftCandidates(topLeft, members);
    for (var i = 0; i < candidates.length; i++)
    {
        var candidate = candidates[i];
        var candidateDamage = estimateIncomingDamageAt(members, candidate, damageSources);
        var candidateStatus = getRetreatStatus(members, candidateDamage);
        if (candidateStatus.shouldRetreat)
        {
            continue;
        }
        var candidateGoalRange = getQuadGoalRange(candidate, goal);
        if (candidateGoalRange > currentGoalRange + 1)
        {
            continue;
        }
        var score = candidateGoalRange * 10000
            + candidateStatus.maxDamage * 10
            + candidateStatus.totalDamage
            + (samePos(candidate, intendedNext) ? -1000 : 0);
        if (!best || score < best.score)
        {
            best = {
                pos: candidate,
                damage: candidateDamage,
                status: candidateStatus,
                goalRange: candidateGoalRange,
                score: score
            };
        }
    }

    if (best)
    {
        squadMemory.damageAvoidMoveAt = Game.time;
        squadMemory.damageAvoidIntended = serializePos(intendedNext);
        squadMemory.damageAvoidChosen = serializePos(best.pos);
        squadMemory.damageAvoidMaxDamage = best.status.maxDamage;
        squadMemory.damageAvoidTotalHeal = best.status.totalHeal;
        squadMemory.damageAvoidWorstProjected = best.status.worstProjected;
        delete squadMemory.damageHoldAt;
        delete squadMemory.damageHoldReason;
        delete squadMemory.damageHoldBlockers;
        return best;
    }

    squadMemory.damageHoldAt = Game.time;
    squadMemory.damageHoldReason = 'next step would be unhealable';
    squadMemory.damageHoldFrom = serializePos(topLeft);
    squadMemory.damageHoldIntended = serializePos(intendedNext);
    squadMemory.damageHoldMaxDamage = nextStatus.maxDamage;
    squadMemory.damageHoldTotalHeal = nextStatus.totalHeal;
    squadMemory.damageHoldWorstProjected = nextStatus.worstProjected;
    return undefined;
}

function clearDamageHoldMemory(squadMemory)
{
    if (!squadMemory)
    {
        return;
    }
    delete squadMemory.damageHoldAt;
    delete squadMemory.damageHoldReason;
    delete squadMemory.damageHoldFrom;
    delete squadMemory.damageHoldIntended;
    delete squadMemory.damageHoldMaxDamage;
    delete squadMemory.damageHoldTotalHeal;
    delete squadMemory.damageHoldWorstProjected;
    delete squadMemory.damageHoldBlockers;
}

function markNarrowFormationRepacked(squadMemory, topLeft)
{
    if (!squadMemory || squadMemory.narrowFormationActive !== true)
    {
        return;
    }
    squadMemory.narrowFormationActive = false;
    squadMemory.narrowRepackedAt = Game.time;
    squadMemory.narrowRepackedTopLeft = serializePos(topLeft);
    delete squadMemory.narrowBlockedAt;
    delete squadMemory.narrowBlockedReason;
    delete squadMemory.narrowMoveErrors;
}

function runNarrowFormationMovement(currentRoom, members, squadMemory, targetFlag, targetRoom, rallyPos)
{
    if (!members || members.length != 4 || !currentRoom || !allInSameRoom(members, currentRoom.name))
    {
        if (squadMemory)
        {
            squadMemory.narrowFormationActive = false;
            squadMemory.narrowBlockedAt = Game.time;
            squadMemory.narrowBlockedReason = 'members not in same room';
        }
        return false;
    }

    var anchor = averagePosition(members, currentRoom.name);
    var target = chooseAttackTarget(currentRoom, members, anchor, targetFlag, squadMemory);
    var goal = getMovementGoal(currentRoom, anchor, target, targetFlag, targetRoom, members);
    var damageSources = getDamageSources(currentRoom);
    var currentPositions = getCurrentPositionsByName(members);
    var currentDamage = estimateIncomingDamageAtPositions(members, currentPositions, damageSources);
    var currentStatus = getLooseRetreatStatus(members, currentPositions, currentDamage);

    recordNarrowCombatStatus(squadMemory, currentStatus, 'current');
    healLooseFormation(members, currentPositions, currentDamage, currentStatus);
    attackNearby(members, target);

    if (tryRepackFromNarrowFormation(members, squadMemory, targetFlag, rallyPos, goal, damageSources))
    {
        return true;
    }

    if (!isNarrowStatusHealable(currentStatus))
    {
        recordNarrowFormationBlocked(squadMemory, 'current loose damage is not healable', currentStatus, undefined, goal);
        squadMemory.state = 'narrow_hold_unhealable';
        return true;
    }

    if (!goal || !goal.pos || goal.pos.roomName != currentRoom.name)
    {
        squadMemory.narrowFormationActive = false;
        squadMemory.state = 'narrow_no_same_room_goal';
        return false;
    }

    if (tryMoveNarrowTrain(members, goal, squadMemory, damageSources, currentStatus, 'continue'))
    {
        return true;
    }

    squadMemory.state = 'narrow_hold';
    return true;
}

function tryStartNarrowFormationMove(members, topLeft, goal, squadMemory, options)
{
    if (!members || members.length != 4 || !topLeft || !goal || !goal.pos)
    {
        return false;
    }
    if ((options && options.allowNarrowFormation === false)
        || (squadMemory && squadMemory.narrowFormationEnabled === false))
    {
        return false;
    }
    if (goal.pos.roomName != topLeft.roomName || !allInSameRoom(members, topLeft.roomName))
    {
        return false;
    }
    var room = Game.rooms[topLeft.roomName];
    if (!room)
    {
        return false;
    }

    var damageSources = getDamageSources(room);
    var currentPositions = getCurrentPositionsByName(members);
    var currentDamage = estimateIncomingDamageAtPositions(members, currentPositions, damageSources);
    var currentStatus = getLooseRetreatStatus(members, currentPositions, currentDamage);
    if (!isNarrowStatusHealable(currentStatus))
    {
        recordNarrowFormationBlocked(squadMemory, 'packed position not healable enough to start narrow movement', currentStatus, undefined, goal);
        return false;
    }

    return tryMoveNarrowTrain(members, goal, squadMemory, damageSources, currentStatus, 'start');
}

function tryMoveNarrowTrain(members, goal, squadMemory, damageSources, currentStatus, reason)
{
    var candidate = chooseNarrowMoveCandidate(members, goal, squadMemory, damageSources, currentStatus);
    if (!candidate)
    {
        recordNarrowFormationBlocked(squadMemory, 'no healable narrow train step', currentStatus, undefined, goal);
        return false;
    }
    if (!executePositionMoveAssignments(members, candidate.positions, squadMemory, 'narrow_' + reason))
    {
        recordNarrowFormationBlocked(squadMemory, 'narrow move intent failed', candidate.status, candidate.positions, goal);
        return false;
    }

    squadMemory.state = reason == 'start' ? 'narrow_formation_starting' : 'narrow_formation_moving';
    squadMemory.formed = false;
    squadMemory.narrowFormationActive = true;
    squadMemory.narrowMoveAt = Game.time;
    squadMemory.narrowMoveReason = reason;
    squadMemory.narrowOrder = candidate.orderNames;
    squadMemory.narrowLeader = candidate.orderNames[0];
    squadMemory.narrowGoal = goal && goal.pos ? serializePos(goal.pos) : undefined;
    squadMemory.narrowGoalRange = candidate.goalRange;
    squadMemory.narrowScore = Math.round(candidate.score);
    recordNarrowCombatStatus(squadMemory, candidate.status, 'candidate');
    delete squadMemory.pathBlocked;
    delete squadMemory.pathBlockedAt;
    delete squadMemory.pathBlockedFrom;
    delete squadMemory.pathBlockedTo;
    delete squadMemory.narrowBlockedAt;
    delete squadMemory.narrowBlockedReason;
    return true;
}

function chooseNarrowMoveCandidate(members, goal, squadMemory, damageSources, currentStatus)
{
    if (!goal || !goal.pos)
    {
        return undefined;
    }
    var currentPositions = getCurrentPositionsByName(members);
    var currentGoalRange = getLooseGoalRange(currentPositions, goal);
    var orders = getNarrowOrderPermutations(members, squadMemory);
    var best = undefined;
    for (var i = 0; i < orders.length; i++)
    {
        var order = orders[i];
        if (!isValidNarrowOrder(order))
        {
            continue;
        }
        var leaderStep = findNarrowLeaderNextPos(order[0], goal, members);
        if (!leaderStep)
        {
            continue;
        }
        var positions = buildNarrowTrainPositions(order, leaderStep);
        var validation = validateLooseMovePositions(members, positions, false);
        if (!validation.ok)
        {
            continue;
        }
        var goalRange = getLooseGoalRange(positions, goal);
        if (goalRange > currentGoalRange + 1)
        {
            continue;
        }
        var damage = estimateIncomingDamageAtPositions(members, positions, damageSources);
        var status = getLooseRetreatStatus(members, positions, damage);
        if (!isNarrowStatusHealable(status))
        {
            continue;
        }
        var signature = getPositionAssignmentSignature(members, positions);
        var orderNames = getOrderNames(order);
        var score = goalRange * 100000
            + (status.maxDamage || 0) * 25
            + (status.totalDamage || 0) * 5
            + validation.moveCount * 10
            + getNarrowBacktrackPenalty(signature, squadMemory)
            + (isSameNarrowOrder(orderNames, squadMemory && squadMemory.narrowOrder) ? -500 : 0);
        if (currentStatus && currentStatus.shouldRetreat)
        {
            score += 1000000;
        }
        var candidate = {
            positions: positions,
            status: status,
            damage: damage,
            goalRange: goalRange,
            score: score,
            signature: signature,
            orderNames: orderNames
        };
        if (!best || candidate.score < best.score)
        {
            best = candidate;
        }
    }
    return best;
}

function getNarrowOrderPermutations(members, squadMemory)
{
    var result = [];
    var seen = {};
    function add(order)
    {
        if (!order || order.length != members.length)
        {
            return;
        }
        var signature = getOrderNames(order).join('|');
        if (!seen[signature])
        {
            seen[signature] = true;
            result.push(order);
        }
    }

    if (squadMemory && squadMemory.narrowOrder && squadMemory.narrowOrder.length == members.length)
    {
        var byName = {};
        for (var n = 0; n < members.length; n++)
        {
            byName[members[n].name] = members[n];
        }
        var remembered = [];
        for (var r = 0; r < squadMemory.narrowOrder.length; r++)
        {
            remembered.push(byName[squadMemory.narrowOrder[r]]);
        }
        add(remembered);
    }

    for (var a = 0; a < members.length; a++)
    {
        for (var b = 0; b < members.length; b++)
        {
            if (b == a) { continue; }
            for (var c = 0; c < members.length; c++)
            {
                if (c == a || c == b) { continue; }
                for (var d = 0; d < members.length; d++)
                {
                    if (d == a || d == b || d == c) { continue; }
                    add([members[a], members[b], members[c], members[d]]);
                }
            }
        }
    }
    return result;
}

function isValidNarrowOrder(order)
{
    if (!order || order.length != 4)
    {
        return false;
    }
    var seen = {};
    for (var i = 0; i < order.length; i++)
    {
        if (!order[i] || seen[order[i].name] || order[i].fatigue > 0)
        {
            return false;
        }
        seen[order[i].name] = true;
        if (i > 0 && !order[i].pos.isNearTo(order[i - 1].pos))
        {
            return false;
        }
    }
    return true;
}

function findNarrowLeaderNextPos(leader, goal, members)
{
    if (!leader || !goal || !goal.pos || leader.pos.roomName != goal.pos.roomName || leader.fatigue > 0)
    {
        return undefined;
    }
    var range = typeof goal.range == 'number' ? Math.max(0, goal.range) : 0;
    if (leader.pos.getRangeTo(goal.pos) <= range)
    {
        return undefined;
    }
    var result = PathFinder.search(leader.pos, {pos: goal.pos, range: range},
    {
        plainCost: 1,
        swampCost: 5,
        maxOps: NARROW_FORMATION_PATH_MAX_OPS,
        maxRooms: 1,
        roomCallback: function(roomName) {
            var costs = baseCostMatrix(roomName, members);
            for (var i = 0; i < members.length; i++)
            {
                if (members[i].id != leader.id && members[i].pos.roomName == roomName)
                {
                    costs.set(members[i].pos.x, members[i].pos.y, 255);
                }
            }
            return costs;
        }
    });
    if (!result || result.incomplete || !result.path || result.path.length == 0)
    {
        return undefined;
    }
    var step = result.path[0];
    var stepPos = new RoomPosition(step.x, step.y, step.roomName || leader.pos.roomName);
    for (var m = 0; m < members.length; m++)
    {
        if (samePos(stepPos, members[m].pos))
        {
            return undefined;
        }
    }
    return stepPos;
}

function buildNarrowTrainPositions(order, leaderStep)
{
    var positions = {};
    positions[order[0].name] = leaderStep;
    for (var i = 1; i < order.length; i++)
    {
        positions[order[i].name] = order[i - 1].pos;
    }
    return positions;
}

function validateLooseMovePositions(members, positions, allowRoomEdge)
{
    var occupied = {};
    var moveCount = 0;
    for (var i = 0; i < members.length; i++)
    {
        var member = members[i];
        var pos = positions[member.name];
        if (!pos || pos.roomName != member.room.name)
        {
            return {ok: false, reason: 'missing or cross-room target'};
        }
        if (member.fatigue > 0)
        {
            return {ok: false, reason: 'fatigue'};
        }
        if (!allowRoomEdge && isRoomEdgePos(pos))
        {
            return {ok: false, reason: 'room edge target'};
        }
        if (Math.max(Math.abs(member.pos.x - pos.x), Math.abs(member.pos.y - pos.y)) > 1)
        {
            return {ok: false, reason: 'non-adjacent target'};
        }
        var key = pos.roomName + ':' + pos.x + ':' + pos.y;
        if (occupied[key])
        {
            return {ok: false, reason: 'duplicate target'};
        }
        occupied[key] = true;
        if (!canStandLooseAt(pos, members))
        {
            return {ok: false, reason: 'blocked target'};
        }
        if (!samePos(member.pos, pos))
        {
            moveCount++;
        }
    }
    return {ok: true, moveCount: moveCount};
}

function canStandLooseAt(pos, squadMembers)
{
    if (!pos || pos.x < 0 || pos.y < 0 || pos.x > 49 || pos.y > 49)
    {
        return false;
    }
    var terrain = Game.map.getRoomTerrain(pos.roomName);
    if (terrain.get(pos.x, pos.y) == TERRAIN_MASK_WALL)
    {
        return false;
    }
    var structures = pos.lookFor(LOOK_STRUCTURES);
    for (var s = 0; s < structures.length; s++)
    {
        if (isBlockingStructure(structures[s]))
        {
            return false;
        }
    }
    var creeps = pos.lookFor(LOOK_CREEPS);
    for (var c = 0; c < creeps.length; c++)
    {
        if (!isSquadMember(creeps[c], squadMembers))
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

function isRoomEdgePos(pos)
{
    return pos && (pos.x == 0 || pos.y == 0 || pos.x == 49 || pos.y == 49);
}

function getCurrentPositionsByName(members)
{
    var positions = {};
    for (var i = 0; i < members.length; i++)
    {
        positions[members[i].name] = members[i].pos;
    }
    return positions;
}

function estimateIncomingDamageAtPositions(members, positions, damageSources)
{
    var result = {};
    for (var i = 0; i < members.length; i++)
    {
        var member = members[i];
        var pos = positions[member.name];
        var rawDamage = 0;
        for (var s = 0; s < damageSources.length; s++)
        {
            rawDamage += getRawDamageFromSourceAtPos(damageSources[s], pos);
        }
        result[member.name] = combatMath.damageAfterTough(member, rawDamage);
    }
    return result;
}

function getLooseRetreatStatus(members, positions, incomingDamage)
{
    var healPlan = getLooseHealPlan(members, positions, incomingDamage || {});
    return {
        assignments: healPlan.assignments,
        healActions: healPlan.healActions,
        assignedHeal: healPlan.assignedHeal,
        totalHeal: healPlan.totalHeal,
        maxDamage: healPlan.maxDamage,
        totalDamage: healPlan.totalDamage,
        maxUncoveredDamage: healPlan.maxUncoveredDamage,
        totalUncoveredDamage: healPlan.totalUncoveredDamage,
        worstProjected: healPlan.worstProjected,
        shouldRetreat: healPlan.worstProjected < RETREAT_EXPECTED_HITS
            || healPlan.maxUncoveredDamage > 0
            || healPlan.totalUncoveredDamage > 0
    };
}

function getLooseHealPlan(members, positions, incomingDamage)
{
    incomingDamage = incomingDamage || {};
    var optionsByHealer = [];
    var totalPotentialHeal = 0;
    var maxDamage = 0;
    var totalDamage = 0;
    for (var i = 0; i < members.length; i++)
    {
        var damage = incomingDamage[members[i].name] || 0;
        maxDamage = Math.max(maxDamage, damage);
        totalDamage += damage;
        if (members[i].getActiveBodyparts(HEAL) <= 0)
        {
            continue;
        }
        var options = [];
        for (var t = 0; t < members.length; t++)
        {
            var power = getLooseHealPower(members[i], members[t], positions);
            if (power > 0)
            {
                options.push({target: members[t], power: power, action: getLooseHealAction(members[i], members[t], positions)});
            }
        }
        if (options.length > 0)
        {
            totalPotentialHeal += combatMath.directHealPower(members[i]);
            optionsByHealer.push({healer: members[i], options: options});
        }
    }

    var initialAssigned = {};
    for (var m = 0; m < members.length; m++)
    {
        initialAssigned[members[m].name] = 0;
    }
    var best = undefined;
    function consider(index, assignedHeal, assignments, healActions, totalAssigned)
    {
        if (index >= optionsByHealer.length)
        {
            var plan = scoreLooseHealPlan(members, incomingDamage, assignedHeal, assignments, healActions, totalAssigned, maxDamage, totalDamage);
            if (!best || plan.score < best.score)
            {
                best = plan;
            }
            return;
        }
        var healerEntry = optionsByHealer[index];
        for (var o = 0; o < healerEntry.options.length; o++)
        {
            var option = healerEntry.options[o];
            var nextAssigned = copyNumberMap(assignedHeal);
            var nextAssignments = copyStringMap(assignments);
            var nextActions = copyStringMap(healActions);
            nextAssigned[option.target.name] = (nextAssigned[option.target.name] || 0) + option.power;
            nextAssignments[healerEntry.healer.name] = option.target.name;
            nextActions[healerEntry.healer.name] = option.action;
            consider(index + 1, nextAssigned, nextAssignments, nextActions, totalAssigned + option.power);
        }
    }
    consider(0, initialAssigned, {}, {}, 0);
    if (!best)
    {
        best = scoreLooseHealPlan(members, incomingDamage, initialAssigned, {}, {}, 0, maxDamage, totalDamage);
    }
    best.totalPotentialHeal = totalPotentialHeal;
    return best;
}

function scoreLooseHealPlan(members, incomingDamage, assignedHeal, assignments, healActions, totalAssigned, maxDamage, totalDamage)
{
    var worstProjected = Infinity;
    var maxUncoveredDamage = 0;
    var totalUncoveredDamage = 0;
    var projectedDeficit = 0;
    for (var i = 0; i < members.length; i++)
    {
        var creep = members[i];
        var memberDamage = incomingDamage[creep.name] || 0;
        var memberHeal = assignedHeal[creep.name] || 0;
        var uncovered = Math.max(0, memberDamage - memberHeal);
        var projected = combatMath.projectedHits(creep, memberDamage, memberHeal);
        maxUncoveredDamage = Math.max(maxUncoveredDamage, uncovered);
        totalUncoveredDamage += uncovered;
        worstProjected = Math.min(worstProjected, projected);
        projectedDeficit += Math.max(0, creep.hitsMax - projected);
    }
    if (worstProjected == Infinity)
    {
        worstProjected = 0;
    }
    var score = (worstProjected < RETREAT_EXPECTED_HITS ? 10000000 : 0)
        + maxUncoveredDamage * 100000
        + totalUncoveredDamage * 50000
        + Math.max(0, RETREAT_EXPECTED_HITS - worstProjected) * 10000
        + projectedDeficit * 10
        + (maxDamage || 0) * 2
        + (totalDamage || 0)
        - totalAssigned;
    return {
        assignments: assignments,
        healActions: healActions,
        assignedHeal: assignedHeal,
        totalHeal: totalAssigned,
        maxDamage: maxDamage || 0,
        totalDamage: totalDamage || 0,
        maxUncoveredDamage: maxUncoveredDamage,
        totalUncoveredDamage: totalUncoveredDamage,
        worstProjected: worstProjected,
        score: score
    };
}

function getLooseHealPower(healer, target, positions)
{
    var healerPos = positions[healer.name] || healer.pos;
    var targetPos = positions[target.name] || target.pos;
    if (!healerPos || !targetPos || healerPos.roomName != targetPos.roomName)
    {
        return 0;
    }
    var range = healerPos.getRangeTo(targetPos);
    if (range <= 1)
    {
        return combatMath.directHealPower(healer);
    }
    if (range <= 3)
    {
        return combatMath.rangedHealPower(healer);
    }
    return 0;
}

function getLooseHealAction(healer, target, positions)
{
    var healerPos = positions[healer.name] || healer.pos;
    var targetPos = positions[target.name] || target.pos;
    return healerPos && targetPos && healerPos.getRangeTo(targetPos) <= 1 ? 'heal' : 'rangedHeal';
}

function isNarrowStatusHealable(status)
{
    return status && status.shouldRetreat !== true
        && (status.maxUncoveredDamage || 0) <= 0
        && (status.totalUncoveredDamage || 0) <= 0
        && (status.worstProjected || 0) >= RETREAT_EXPECTED_HITS;
}

function healLooseFormation(members, positions, incomingDamage, status)
{
    status = status || getLooseRetreatStatus(members, positions, incomingDamage || {});
    var assignments = status.assignments || {};
    var actions = status.healActions || {};
    for (var i = 0; i < members.length; i++)
    {
        var healer = members[i];
        if (healer.getActiveBodyparts(HEAL) <= 0)
        {
            continue;
        }
        var target = assignments[healer.name] ? Game.creeps[assignments[healer.name]] : undefined;
        if (!target)
        {
            target = chooseHealTarget(members, incomingDamage || {});
        }
        if (!target)
        {
            continue;
        }
        if (actions[healer.name] == 'heal' && healer.pos.isNearTo(target))
        {
            healer.heal(target);
        }
        else if (healer.pos.inRangeTo(target, 3))
        {
            healer.rangedHeal(target);
        }
    }
}

function tryRepackFromNarrowFormation(members, squadMemory, targetFlag, rallyPos, goal, damageSources)
{
    var candidate = chooseImmediateRepackCandidate(members, targetFlag, rallyPos, goal, damageSources);
    if (!candidate)
    {
        return false;
    }
    if (!executePositionMoveAssignments(members, candidate.positions, squadMemory, 'narrow_repack'))
    {
        return false;
    }
    squadMemory.state = 'repacking_from_narrow';
    squadMemory.packTopLeft = serializePos(candidate.topLeft);
    squadMemory.narrowRepackAt = Game.time;
    squadMemory.narrowRepackTopLeft = serializePos(candidate.topLeft);
    squadMemory.narrowRepackScore = Math.round(candidate.score);
    squadMemory.narrowRepackWorstProjected = Math.round(candidate.status.worstProjected || 0);
    squadMemory.narrowRepackMaxDamage = Math.round(candidate.status.maxDamage || 0);
    return true;
}

function chooseImmediateRepackCandidate(members, targetFlag, rallyPos, goal, damageSources)
{
    if (!members || members.length != 4 || !allInSameRoom(members, members[0].room.name))
    {
        return undefined;
    }
    var roomName = members[0].room.name;
    var center = averagePosition(members, roomName);
    var rallyRangeTarget = rallyPos && rallyPos.roomName == roomName ? rallyPos : undefined;
    var best = undefined;
    for (var range = 0; range <= NARROW_FORMATION_REPACK_SEARCH_RANGE; range++)
    {
        for (var dx = -range; dx <= range; dx++)
        {
            for (var dy = -range; dy <= range; dy++)
            {
                if (Math.max(Math.abs(dx), Math.abs(dy)) != range)
                {
                    continue;
                }
                var x = center.x + dx;
                var y = center.y + dy;
                if (x < 1 || y < 1 || x > 47 || y > 47)
                {
                    continue;
                }
                var topLeft = new RoomPosition(x, y, roomName);
                if (!canStandQuadAt(topLeft, members, false))
                {
                    continue;
                }
                var positions = buildPackedSlotPositions(members, topLeft);
                var validation = validateLooseMovePositions(members, positions, false);
                if (!validation.ok)
                {
                    continue;
                }
                var damage = estimateIncomingDamageAtPositions(members, positions, damageSources || []);
                var status = getRetreatStatus(members, damage);
                if (status.shouldRetreat)
                {
                    continue;
                }
                var goalRange = goal && goal.pos ? getQuadGoalRange(topLeft, goal) : 0;
                var rallyRange = rallyRangeTarget && (!goal || !goal.pos) ? topLeft.getRangeTo(rallyRangeTarget) : 0;
                var score = goalRange * 100000 + validation.moveCount * 100
                    + rallyRange * 1000
                    + (status.maxDamage || 0) * 25 + (status.totalDamage || 0) * 5;
                var candidate = {topLeft: topLeft, positions: positions, status: status, score: score};
                if (!best || candidate.score < best.score)
                {
                    best = candidate;
                }
            }
        }
        if (best)
        {
            return best;
        }
    }
    return best;
}

function buildPackedSlotPositions(members, topLeft)
{
    var positions = {};
    for (var i = 0; i < members.length; i++)
    {
        var slot = members[i].memory.slot;
        if (typeof slot != 'number' || slot < 0 || slot >= SLOT_OFFSETS.length)
        {
            slot = i;
        }
        positions[members[i].name] = offsetPos(topLeft, SLOT_OFFSETS[slot].x, SLOT_OFFSETS[slot].y);
    }
    return positions;
}

function executePositionMoveAssignments(members, positions, squadMemory, context)
{
    var validation = validateLooseMovePositions(members, positions, false);
    if (!validation.ok)
    {
        if (squadMemory)
        {
            squadMemory.narrowMoveRejectedAt = Game.time;
            squadMemory.narrowMoveRejectedReason = validation.reason;
        }
        return false;
    }
    var errors = {};
    var ok = true;
    var fromSignature = getPositionAssignmentSignature(members, getCurrentPositionsByName(members));
    var toSignature = getPositionAssignmentSignature(members, positions);
    for (var i = 0; i < members.length; i++)
    {
        var member = members[i];
        var pos = positions[member.name];
        if (samePos(member.pos, pos))
        {
            continue;
        }
        var direction = member.pos.getDirectionTo(pos);
        if (!direction)
        {
            ok = false;
            errors[member.name] = 'invalid direction';
            continue;
        }
        var result = member.move(direction);
        if (result != OK)
        {
            ok = false;
            errors[member.name] = result;
        }
    }
    if (squadMemory)
    {
        squadMemory.narrowLastMoveAt = Game.time;
        squadMemory.narrowLastMoveContext = context;
        squadMemory.narrowMoveFromSignature = fromSignature;
        squadMemory.narrowMoveToSignature = toSignature;
        if (ok)
        {
            delete squadMemory.narrowMoveErrors;
            delete squadMemory.narrowMoveRejectedAt;
            delete squadMemory.narrowMoveRejectedReason;
        }
        else
        {
            squadMemory.narrowMoveErrors = errors;
        }
    }
    return ok;
}

function recordNarrowFormationBlocked(squadMemory, reason, status, positions, goal)
{
    if (!squadMemory)
    {
        return;
    }
    squadMemory.narrowBlockedAt = Game.time;
    squadMemory.narrowBlockedReason = reason;
    squadMemory.narrowBlockedGoal = goal && goal.pos ? serializePos(goal.pos) : undefined;
    if (positions)
    {
        squadMemory.narrowBlockedSignature = getPositionAssignmentSignature(getMembersFromPositions(positions), positions);
    }
    if (status)
    {
        squadMemory.narrowBlockedMaxDamage = Math.round(status.maxDamage || 0);
        squadMemory.narrowBlockedTotalDamage = Math.round(status.totalDamage || 0);
        squadMemory.narrowBlockedMaxUncoveredDamage = Math.round(status.maxUncoveredDamage || 0);
        squadMemory.narrowBlockedTotalUncoveredDamage = Math.round(status.totalUncoveredDamage || 0);
        squadMemory.narrowBlockedWorstProjected = Math.round(status.worstProjected || 0);
        squadMemory.narrowBlockedTotalHeal = Math.round(status.totalHeal || 0);
    }
}

function recordNarrowCombatStatus(squadMemory, status, prefix)
{
    if (!squadMemory || !status)
    {
        return;
    }
    var key = prefix == 'candidate' ? 'narrowCandidate' : 'narrowCurrent';
    squadMemory[key + 'At'] = Game.time;
    squadMemory[key + 'TotalHeal'] = Math.round(status.totalHeal || 0);
    squadMemory[key + 'MaxDamage'] = Math.round(status.maxDamage || 0);
    squadMemory[key + 'TotalDamage'] = Math.round(status.totalDamage || 0);
    squadMemory[key + 'MaxUncoveredDamage'] = Math.round(status.maxUncoveredDamage || 0);
    squadMemory[key + 'TotalUncoveredDamage'] = Math.round(status.totalUncoveredDamage || 0);
    squadMemory[key + 'WorstProjected'] = Math.round(status.worstProjected || 0);
    squadMemory[key + 'ShouldRetreat'] = status.shouldRetreat == true;
    squadMemory[key + 'HealAssignments'] = status.assignments;
    squadMemory[key + 'HealActions'] = status.healActions;
}

function getMembersFromPositions(positions)
{
    var result = [];
    for (var name in positions)
    {
        if (Game.creeps[name])
        {
            result.push(Game.creeps[name]);
        }
    }
    return result;
}

function getLooseGoalRange(positions, goal)
{
    if (!goal || !goal.pos)
    {
        return Infinity;
    }
    if (goal.requireFullQuadRange)
    {
        var worst = 0;
        var foundAll = true;
        for (var memberName in positions)
        {
            var memberPos = positions[memberName];
            if (!memberPos || memberPos.roomName != goal.pos.roomName)
            {
                foundAll = false;
                break;
            }
            worst = Math.max(worst, memberPos.getRangeTo(goal.pos));
        }
        return foundAll ? worst : Infinity;
    }
    var best = Infinity;
    for (var name in positions)
    {
        var pos = positions[name];
        if (pos && pos.roomName == goal.pos.roomName)
        {
            best = Math.min(best, pos.getRangeTo(goal.pos));
        }
    }
    return best;
}

function getPositionAssignmentSignature(members, positions)
{
    var parts = [];
    for (var i = 0; i < members.length; i++)
    {
        var pos = positions[members[i].name];
        parts.push(members[i].name + ':' + (pos ? serializePos(pos) : 'none'));
    }
    return parts.join('|');
}

function getOrderNames(order)
{
    var names = [];
    for (var i = 0; i < order.length; i++)
    {
        names.push(order[i] ? order[i].name : 'missing');
    }
    return names;
}

function isSameNarrowOrder(a, b)
{
    if (!a || !b || a.length != b.length)
    {
        return false;
    }
    for (var i = 0; i < a.length; i++)
    {
        if (a[i] != b[i])
        {
            return false;
        }
    }
    return true;
}

function getNarrowBacktrackPenalty(signature, squadMemory)
{
    if (!squadMemory || !squadMemory.narrowLastMoveAt || Game.time - squadMemory.narrowLastMoveAt > 3)
    {
        return 0;
    }
    if (signature == squadMemory.narrowMoveFromSignature)
    {
        return NARROW_FORMATION_BACKTRACK_PENALTY;
    }
    return 0;
}

function copyNumberMap(map)
{
    var result = {};
    for (var key in map)
    {
        result[key] = map[key] || 0;
    }
    return result;
}

function copyStringMap(map)
{
    var result = {};
    for (var key in map)
    {
        result[key] = map[key];
    }
    return result;
}

function movePackedToTopLeft(members, topLeft, nextTopLeft, squadMemory, context)
{
    if (!isAdjacentTopLeft(topLeft, nextTopLeft))
    {
        recordPackedMoveRejected(squadMemory, 'non_adjacent_top_left', topLeft, nextTopLeft, context, members);
        return false;
    }
    if (!canStandQuadAt(nextTopLeft, members, false))
    {
        recordPackedMoveRejected(squadMemory, 'blocked_footprint', topLeft, nextTopLeft, context, members);
        return false;
    }

    var direction = topLeft.getDirectionTo(nextTopLeft);
    if (!direction)
    {
        recordPackedMoveRejected(squadMemory, 'invalid_direction', topLeft, nextTopLeft, context, members);
        return false;
    }
    for (var i = 0; i < members.length; i++)
    {
        if (members[i].fatigue > 0)
        {
            if (squadMemory)
            {
                squadMemory.lastPackedMoveError = 'fatigue';
                squadMemory.lastPackedMoveErrorAt = Game.time;
                squadMemory.lastPackedMoveFatigued = members[i].name;
            }
            return false;
        }
    }
    var ok = true;
    var errors = {};
    for (var m = 0; m < members.length; m++)
    {
        var result = members[m].move(direction);
        if (result != OK)
        {
            ok = false;
            errors[members[m].name] = result;
            if (squadMemory)
            {
                squadMemory.lastPackedMoveError = result;
                squadMemory.lastPackedMoveErrorAt = Game.time;
            }
        }
    }
    if (squadMemory)
    {
        squadMemory.lastPackedMoveAt = Game.time;
        squadMemory.lastPackedMoveContext = context;
        squadMemory.lastPackedMoveFrom = serializePos(topLeft);
        squadMemory.lastPackedMoveTo = serializePos(nextTopLeft);
        squadMemory.lastPackedMoveDirection = direction;
        if (ok)
        {
            delete squadMemory.lastPackedMoveError;
            delete squadMemory.lastPackedMoveErrorAt;
            delete squadMemory.lastPackedMoveErrors;
            delete squadMemory.lastPackedMoveBlockers;
            delete squadMemory.lastPackedMoveFatigued;
        }
        else
        {
            squadMemory.lastPackedMoveErrors = errors;
            squadMemory.lastPackedMoveBlockers = describeFootprintBlockers(nextTopLeft, members);
        }
    }
    return ok;
}

function isQuadInGoalRange(topLeft, goal)
{
    return goal && goal.pos && topLeft.roomName == goal.pos.roomName
        && getQuadGoalRange(topLeft, goal) <= goal.range;
}

function getQuadGoalRange(topLeft, goal)
{
    if (!goal || !goal.pos || topLeft.roomName != goal.pos.roomName)
    {
        return Infinity;
    }
    if (goal.requireFullQuadRange)
    {
        return getQuadMaxRangeToPos(topLeft, goal.pos);
    }
    return topLeft.getRangeTo(goal.pos);
}

function getQuadMaxRangeToPos(topLeft, pos)
{
    var maxRange = 0;
    for (var i = 0; i < SLOT_OFFSETS.length; i++)
    {
        var slotPos = offsetPos(topLeft, SLOT_OFFSETS[i].x, SLOT_OFFSETS[i].y);
        maxRange = Math.max(maxRange, slotPos.getRangeTo(pos));
    }
    return maxRange;
}

function getQuadPathSearchGoal(topLeft, goal)
{
    if (!goal || !goal.pos || !goal.requireFullQuadRange || goal.pos.roomName != topLeft.roomName)
    {
        return goal;
    }
    var goals = getFullQuadRangeGoals(goal.pos, goal.range);
    return goals.length > 0 ? goals : goal;
}

function getFullQuadRangeGoals(targetPos, range)
{
    var goals = [];
    var minX = Math.max(1, targetPos.x - range);
    var maxX = Math.min(47, targetPos.x + range - 1);
    var minY = Math.max(1, targetPos.y - range);
    var maxY = Math.min(47, targetPos.y + range - 1);
    for (var x = minX; x <= maxX; x++)
    {
        for (var y = minY; y <= maxY; y++)
        {
            var pos = new RoomPosition(x, y, targetPos.roomName);
            if (getQuadMaxRangeToPos(pos, targetPos) <= range)
            {
                goals.push({pos: pos, range: 0});
            }
        }
    }
    return goals;
}

function getQuadPathMaxOps(squadMemory)
{
    return squadMemory && (squadMemory.pathIncompleteStreak || 0) >= QUAD_PATH_OPS_BOOST_STREAK
        ? QUAD_PATH_MAX_OPS_BOOSTED
        : QUAD_PATH_MAX_OPS;
}

function recordQuadPathResult(squadMemory, result, maxOps, topLeft, goal, context, affectsStreak)
{
    if (!squadMemory)
    {
        return;
    }
    var pathLength = result && result.path ? result.path.length : 0;
    var incomplete = !result || result.incomplete == true;
    if (affectsStreak)
    {
        if (incomplete || pathLength == 0)
        {
            squadMemory.pathIncompleteStreak = Math.min((squadMemory.pathIncompleteStreak || 0) + 1, 50);
        }
        else
        {
            squadMemory.pathIncompleteStreak = 0;
        }
    }

    var prefix = context == 'blocker' ? 'lastBlockerPath' : 'lastPath';
    squadMemory[prefix + 'At'] = Game.time;
    squadMemory[prefix + 'Context'] = context;
    squadMemory[prefix + 'Ops'] = result ? result.ops : undefined;
    squadMemory[prefix + 'MaxOps'] = maxOps;
    squadMemory[prefix + 'Incomplete'] = incomplete;
    squadMemory[prefix + 'Failed'] = incomplete || pathLength == 0;
    squadMemory[prefix + 'Length'] = pathLength;
    squadMemory[prefix + 'From'] = serializePos(topLeft);
    squadMemory[prefix + 'To'] = goal && goal.pos ? serializePos(goal.pos) : undefined;
    squadMemory[prefix + 'IncompleteStreak'] = squadMemory.pathIncompleteStreak || 0;
}

function findQuadPath(topLeft, goal, members, squadMemory, context, affectsStreak)
{
    var result = findQuadPathResult(topLeft, goal, members, squadMemory, context, affectsStreak);
    if (!result || result.incomplete)
    {
        return undefined;
    }
    return result.path;
}

function findQuadPathResult(topLeft, goal, members, squadMemory, context, affectsStreak)
{
    var maxOps = getQuadPathMaxOps(squadMemory);
    var pathGoal = getQuadPathSearchGoal(topLeft, goal);
    var result = PathFinder.search(topLeft, pathGoal,
    {
        plainCost: 1,
        swampCost: 5,
        maxOps: maxOps,
        maxRooms: 1,
        roomCallback: function(roomName) {
            return quadCostMatrix(roomName, members);
        }
    });
    recordQuadPathResult(squadMemory, result, maxOps, topLeft, goal, context, affectsStreak);
    return result;
}

function quadCostMatrix(roomName, squadMembers)
{
    var base = baseCostMatrix(roomName, squadMembers || []);
    if (!base)
    {
        return false;
    }
    var result = new PathFinder.CostMatrix();
    for (var x = 0; x < 50; x++)
    {
        for (var y = 0; y < 50; y++)
        {
            if (x < 1 || y < 1 || x > 47 || y > 47)
            {
                result.set(x, y, 255);
                continue;
            }
            var cost = 1;
            for (var i = 0; i < SLOT_OFFSETS.length; i++)
            {
                var cx = x + SLOT_OFFSETS[i].x;
                var cy = y + SLOT_OFFSETS[i].y;
                var cell = base.get(cx, cy);
                if (cell >= 255)
                {
                    cost = 255;
                    break;
                }
                cost = Math.max(cost, cell || 1);
            }
            result.set(x, y, cost);
        }
    }
    return result;
}

function baseCostMatrix(roomName, squadMembers)
{
    var room = Game.rooms[roomName];
    var terrain = Game.map.getRoomTerrain(roomName);
    var costs = new PathFinder.CostMatrix();
    for (var x = 0; x < 50; x++)
    {
        for (var y = 0; y < 50; y++)
        {
            var terrainCell = terrain.get(x, y);
            if (terrainCell == TERRAIN_MASK_WALL)
            {
                costs.set(x, y, 255);
            }
            else
            {
                // Store explicit movement cost so quadCostMatrix can use the
                // slowest tile in each 2x2 footprint. A single member on swamp
                // gates the next packed move for the whole squad.
                costs.set(x, y, terrainCell == TERRAIN_MASK_SWAMP ? 5 : 1);
            }
        }
    }

    if (!room)
    {
        return costs;
    }

    var structures = room.find(FIND_STRUCTURES);
    for (var i = 0; i < structures.length; i++)
    {
        var s = structures[i];
        if (s.structureType == STRUCTURE_ROAD)
        {
            costs.set(s.pos.x, s.pos.y, 1);
        }
        else if (s.structureType == STRUCTURE_CONTAINER)
        {
            costs.set(s.pos.x, s.pos.y, 5);
        }
        else if (s.structureType == STRUCTURE_RAMPART && (s.my || s.isPublic))
        {
            // Passable ramparts do not reduce movement fatigue. Keep the
            // underlying terrain cost, or a road cost already written here.
        }
        else if (isBlockingStructure(s))
        {
            costs.set(s.pos.x, s.pos.y, obstacleCost(s));
        }
    }

    var creeps = room.find(FIND_CREEPS);
    for (var c = 0; c < creeps.length; c++)
    {
        if (!isSquadMember(creeps[c], squadMembers || []))
        {
            costs.set(creeps[c].pos.x, creeps[c].pos.y, 255);
        }
    }
    if (typeof FIND_POWER_CREEPS != 'undefined')
    {
        var powerCreeps = room.find(FIND_POWER_CREEPS);
        for (var p = 0; p < powerCreeps.length; p++)
        {
            costs.set(powerCreeps[p].pos.x, powerCreeps[p].pos.y, 255);
        }
    }
    return costs;
}

function obstacleCost(s)
{
    if (!isDestructibleObstacle(s))
    {
        return 255;
    }
    if (!s.hits || s.hits < 10000)
    {
        return 20;
    }
    if (s.hits < 100000)
    {
        return 50;
    }
    if (s.hits < 1000000)
    {
        return 100;
    }
    if (s.hits < 10000000)
    {
        return 200;
    }
    return 254;
}

function filterDangerousCreepsByRange(targets, members, maxRange, includePredictedDamage)
{
    var result = [];
    for (var i = 0; i < targets.length; i++)
    {
        var target = targets[i];
        if (getMinRangeToMembers(target, members) <= maxRange
            || (includePredictedDamage && canDamageAnyMemberNextTick(target, members)))
        {
            result.push(target);
        }
    }
    return result;
}

function canDamageAnyMemberNextTick(hostile, members)
{
    for (var i = 0; i < members.length; i++)
    {
        if (estimateMobileHostileRawDamageAt(hostile, members[i].pos) > 0)
        {
            return true;
        }
    }
    return false;
}

function chooseDangerousCreepTarget(targets, members, topLeft, squadMemory)
{
    var best = undefined;
    var bestScore = -Infinity;
    for (var i = 0; i < targets.length; i++)
    {
        var score = scoreDangerousCreepTarget(targets[i], members, topLeft);
        if (!best || score > bestScore)
        {
            best = targets[i];
            bestScore = score;
        }
    }
    if (best && squadMemory)
    {
        squadMemory.focusTargetId = best.id;
        squadMemory.focusTargetName = best.name;
        squadMemory.focusTargetScore = Math.round(bestScore);
        squadMemory.focusTargetAt = Game.time;
        squadMemory.focusTargetRange = getMinRangeToMembers(best, members);
        squadMemory.focusTargetAttackPower = Math.round(combatMath.attackPower(best));
        squadMemory.focusTargetRangedPower = Math.round(combatMath.rangedAttackPower(best));
        squadMemory.focusTargetHealPower = Math.round(combatMath.directHealPower(best) + combatMath.rangedHealPower(best));
    }
    return best;
}

function scoreDangerousCreepTarget(target, members, topLeft)
{
    var minRange = getMinRangeToMembers(target, members);
    var attackPower = combatMath.attackPower(target);
    var rangedPower = combatMath.rangedAttackPower(target);
    var healPower = combatMath.directHealPower(target) + combatMath.rangedHealPower(target);
    var wounded = target.hitsMax - target.hits;
    var score = attackPower * 30
        + rangedPower * 25
        + healPower * 20
        + wounded * 5
        - target.hits / 10
        - minRange * 500;
    if (minRange <= 3)
    {
        score += 100000;
    }
    if (attackPower > 0 && minRange <= 2)
    {
        score += attackPower * 50;
    }
    if (rangedPower > 0 && minRange <= 4)
    {
        score += rangedPower * 25;
    }
    if (topLeft && target.pos.roomName == topLeft.roomName)
    {
        score -= topLeft.getRangeTo(target) * 25;
    }
    return score;
}

function getMinRangeToMembers(target, members)
{
    var range = Infinity;
    for (var i = 0; i < members.length; i++)
    {
        range = Math.min(range, members[i].pos.getRangeTo(target));
    }
    return range == Infinity ? 50 : range;
}

function closestToAnyMember(targets, members)
{
    var best = undefined;
    var bestRange = Infinity;
    for (var i = 0; i < targets.length; i++)
    {
        for (var m = 0; m < members.length; m++)
        {
            var range = members[m].pos.getRangeTo(targets[i]);
            if (range < bestRange)
            {
                best = targets[i];
                bestRange = range;
            }
        }
    }
    return best;
}

function closestToPos(targets, pos)
{
    var best = undefined;
    var bestRange = Infinity;
    for (var i = 0; i < targets.length; i++)
    {
        var range = pos.getRangeTo(targets[i]);
        if (range < bestRange)
        {
            best = targets[i];
            bestRange = range;
        }
    }
    return best;
}

function lowestHits(structures)
{
    var best = undefined;
    for (var i = 0; i < structures.length; i++)
    {
        if (!best || structures[i].hits < best.hits)
        {
            best = structures[i];
        }
    }
    return best;
}

function isHostile(creep)
{
    if (!creep || creep.my || !creep.owner)
    {
        return false;
    }
    return !isAllyName(creep.owner.username);
}

function isAllyName(username)
{
    for (var i = 0; i < ALLIES.length; i++)
    {
        if (username == ALLIES[i])
        {
            return true;
        }
    }
    return false;
}

function offsetPos(pos, dx, dy)
{
    return new RoomPosition(pos.x + dx, pos.y + dy, pos.roomName);
}

function samePos(a, b)
{
    return a && b && a.x == b.x && a.y == b.y && a.roomName == b.roomName;
}

function isAdjacentTopLeft(a, b)
{
    return a && b
        && a.roomName == b.roomName
        && Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) == 1;
}

function recordPackedMoveRejected(squadMemory, reason, topLeft, nextTopLeft, context, members)
{
    if (!squadMemory)
    {
        return;
    }
    squadMemory.lastPackedMoveError = reason;
    squadMemory.lastPackedMoveErrorAt = Game.time;
    squadMemory.lastPackedMoveContext = context;
    squadMemory.lastPackedMoveFrom = serializePos(topLeft);
    squadMemory.lastPackedMoveTo = serializePos(nextTopLeft);
    if (members && nextTopLeft)
    {
        squadMemory.lastPackedMoveBlockers = describeFootprintBlockers(nextTopLeft, members);
    }
}

function describeFootprintBlockers(topLeft, members)
{
    if (!topLeft || !isValidTopLeft(topLeft))
    {
        return 'invalid_top_left';
    }
    var blockers = [];
    for (var i = 0; i < SLOT_OFFSETS.length; i++)
    {
        var pos = offsetPos(topLeft, SLOT_OFFSETS[i].x, SLOT_OFFSETS[i].y);
        var creeps = pos.lookFor(LOOK_CREEPS);
        for (var c = 0; c < creeps.length; c++)
        {
            if (!isSquadMember(creeps[c], members))
            {
                blockers.push('creep:' + creeps[c].name + '@' + pos.x + ',' + pos.y);
            }
        }
        if (typeof LOOK_POWER_CREEPS != 'undefined')
        {
            var powerCreeps = pos.lookFor(LOOK_POWER_CREEPS);
            for (var p = 0; p < powerCreeps.length; p++)
            {
                blockers.push('powerCreep:' + powerCreeps[p].name + '@' + pos.x + ',' + pos.y);
            }
        }
        var structures = pos.lookFor(LOOK_STRUCTURES);
        for (var s = 0; s < structures.length; s++)
        {
            if (isBlockingStructure(structures[s]))
            {
                blockers.push(structures[s].structureType + ':' + structures[s].id + '@' + pos.x + ',' + pos.y);
            }
        }
    }
    return blockers.slice(0, 6).join('|');
}

function isValidRoomName(roomName)
{
    return typeof roomName == 'string' && /^[WE][0-9]+[NS][0-9]+$/.test(roomName);
}

function getRoomCenterPos(roomName)
{
    if (!isValidRoomName(roomName))
    {
        return undefined;
    }
    return new RoomPosition(25, 25, roomName);
}

function serializePos(pos)
{
    if (!pos)
    {
        return undefined;
    }
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
    if (!isValidRoomName(parts[0]) || isNaN(x) || isNaN(y) || x < 0 || x > 49 || y < 0 || y > 49)
    {
        return undefined;
    }
    return new RoomPosition(x, y, parts[0]);
}

module.exports = roleQuad;
