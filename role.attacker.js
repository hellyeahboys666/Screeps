/*
 * Single-creep assault role.
 *
 * This is the solo counterpart to role.quad: it can be sent by targetRoom or
 * targetFlag, prioritizes dangerous creeps/towers/spawns, attacks blockers in
 * the next path step, and retreats when badly damaged if retreat info exists.
 *
 * Supported memory:
 *   target / targetRoom  - destination room
 *   targetFlag           - flag name to rally/attack around; default AttackTarget or Flag1
 *   targetId             - exact object id to focus when visible
 *   retreatRoom          - room to retreat toward when low
 *   retreatFlag          - flag name to retreat toward; default AttackRetreat
 *   avoidRooms           - array/string of rooms to avoid while routing
 *   retreatHits          - absolute hits threshold; default max(250, 35% hitsMax)
 *   retreatOnDamage      - set false to disable retreat behavior
 */

var combatMath = require('combat.math');

var ALLIES = ['MoMoCat'];
var DEFAULT_TARGET_FLAGS = ['AttackTarget', 'Flag1'];
var DEFAULT_RETREAT_FLAG = 'AttackRetreat';
var RETREAT_HITS_FRACTION = 0.35;
var SOLO_PATH_MAX_OPS = 2000;
var SOLO_PATH_MAX_OPS_BOOSTED = 5000;
var PATH_OPS_BOOST_STREAK = 3;

module.exports = {
    run: function(creep)
    {
        selfHeal(creep);

        var targetFlag = getTargetFlag(creep);
        var targetRoom = getTargetRoom(creep, targetFlag);

        if (targetRoom && creep.room.name != targetRoom)
        {
            attackNearby(creep, undefined);
            moveToRoom(creep, targetRoom);
            return;
        }

        var incomingDamage = estimateIncomingDamage(creep);
        var target = chooseAttackTarget(creep.room, creep, targetFlag);
        var movementGoal = getMovementGoal(creep, target, targetFlag, targetRoom);
        // One path search per tick: moveToward() reuses it. Once in range the
        // search always returned an empty path, so it is skipped.
        var pathResult = movementGoal && !isGoalReached(creep, movementGoal)
            ? findSinglePathResult(creep, creep.pos, movementGoal, 'blocker', false)
            : undefined;
        var blocker = pathResult ? getNextStepBlocker(creep.pos, pathResult) : undefined;
        var focusTarget = blocker || target;

        attackNearby(creep, focusTarget);

        if (shouldRetreat(creep, incomingDamage))
        {
            retreat(creep);
            return;
        }

        if (blocker)
        {
            return;
        }

        if (movementGoal)
        {
            moveToward(creep, movementGoal, target, pathResult);
        }
    }
};

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

function getExplicitTargetRoom(creep)
{
    var targetRoom = creep.memory.targetRoom || creep.memory.target || creep.memory.attackRoom;
    if (isValidRoomName(targetRoom))
    {
        return targetRoom;
    }
    if (targetRoom)
    {
        creep.memory.targetRoomError = 'invalid room ' + targetRoom;
    }
    return undefined;
}

function getTargetFlag(creep)
{
    var explicitRoom = getExplicitTargetRoom(creep);
    if (creep.memory.targetFlag && Game.flags[creep.memory.targetFlag])
    {
        var flag = Game.flags[creep.memory.targetFlag];
        if (!explicitRoom || flag.pos.roomName == explicitRoom)
        {
            return flag;
        }
    }
    if (explicitRoom)
    {
        return undefined;
    }
    for (var i = 0; i < DEFAULT_TARGET_FLAGS.length; i++)
    {
        if (Game.flags[DEFAULT_TARGET_FLAGS[i]])
        {
            return Game.flags[DEFAULT_TARGET_FLAGS[i]];
        }
    }
    return undefined;
}

function getTargetRoom(creep, targetFlag)
{
    var explicitRoom = getExplicitTargetRoom(creep);
    if (explicitRoom)
    {
        return explicitRoom;
    }
    if (targetFlag)
    {
        return targetFlag.pos.roomName;
    }
    return undefined;
}

function getAvoidRooms(creep)
{
    if (!creep.memory.avoidRooms)
    {
        return [];
    }
    if (Array.isArray(creep.memory.avoidRooms))
    {
        return creep.memory.avoidRooms;
    }
    return [creep.memory.avoidRooms];
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

function isOnExitEdge(creep, exit)
{
    return (exit == FIND_EXIT_TOP && creep.pos.y == 0)
        || (exit == FIND_EXIT_RIGHT && creep.pos.x == 49)
        || (exit == FIND_EXIT_BOTTOM && creep.pos.y == 49)
        || (exit == FIND_EXIT_LEFT && creep.pos.x == 0);
}

// Route and exit tile change only when the creep changes room, so look them up
// once per room visit instead of every tick; by path so an exit segment walled
// off from the creep is never picked.
function getTravelExit(creep, targetRoom, avoidRooms)
{
    var travel = creep.memory.travelExit;
    if (travel && travel.room == creep.room.name && travel.target == targetRoom
        && travel.time >= Game.time - 1)
    {
        travel.time = Game.time;
        return travel;
    }
    travel = {room: creep.room.name, target: targetRoom, time: Game.time};
    var route = Game.map.findRoute(creep.room.name, targetRoom,
    {
        routeCallback: function(roomName)
        {
            if (avoidRooms.indexOf(roomName) >= 0)
            {
                return Infinity;
            }
            return 1;
        }
    });
    if (Array.isArray(route) && route.length > 0)
    {
        travel.exit = route[0].exit;
        var exitPos = creep.pos.findClosestByPath(travel.exit)
            || creep.pos.findClosestByRange(travel.exit);
        if (exitPos)
        {
            travel.x = exitPos.x;
            travel.y = exitPos.y;
        }
    }
    creep.memory.travelExit = travel;
    return travel;
}

function moveToRoom(creep, targetRoom)
{
    if (!isValidRoomName(targetRoom))
    {
        return;
    }
    var avoidRooms = getAvoidRooms(creep);
    var travel = getTravelExit(creep, targetRoom, avoidRooms);

    if (travel.exit != undefined)
    {
        var exitType = travel.exit;
        var exitDirection = getExitMoveDirection(exitType);
        if (exitDirection && isOnExitEdge(creep, exitType))
        {
            creep.move(exitDirection);
            return;
        }

        var exit = travel.x != undefined ? new RoomPosition(travel.x, travel.y, creep.room.name) : undefined;
        if (exit)
        {
            if (exitDirection && exit.isEqualTo(creep.pos))
            {
                creep.move(exitDirection);
                return;
            }
            creep.moveTo(exit, {reusePath: 20});
            return;
        }
    }

    if (avoidRooms.length > 0)
    {
        creep.say('no route');
        return;
    }
    var center = getRoomCenterPos(targetRoom);
    if (center)
    {
        creep.moveTo(center, {reusePath: 20});
    }
}

function selfHeal(creep)
{
    if (creep.hits < creep.hitsMax && creep.getActiveBodyparts(HEAL) > 0)
    {
        creep.heal(creep);
    }
}

function shouldRetreat(creep, incomingDamage)
{
    if (creep.memory.retreatOnDamage === false)
    {
        return false;
    }

    var retreatHits = creep.memory.retreatHits || Math.max(250, Math.floor(creep.hitsMax * RETREAT_HITS_FRACTION));
    var projected = combatMath.projectedHits(creep, incomingDamage, combatMath.directHealPower(creep));
    return creep.hits < retreatHits || projected < retreatHits;
}

function retreat(creep)
{
    var retreatFlagName = creep.memory.retreatFlag || DEFAULT_RETREAT_FLAG;
    if (retreatFlagName && Game.flags[retreatFlagName])
    {
        creep.moveTo(Game.flags[retreatFlagName], {reusePath: 10});
        return;
    }

    var retreatRoom = creep.memory.retreatRoom || creep.memory.home || creep.memory.origin;
    if (isValidRoomName(retreatRoom) && creep.room.name != retreatRoom)
    {
        moveToRoom(creep, retreatRoom);
        return;
    }

    var homeSpawn = creep.pos.findClosestByRange(FIND_MY_SPAWNS);
    if (homeSpawn)
    {
        creep.moveTo(homeSpawn, {reusePath: 10});
    }
}

function estimateIncomingDamage(creep)
{
    return combatMath.estimateIncomingDamage(creep, isHostile, isHostileStructure);
}

function chooseAttackTarget(room, creep, targetFlag)
{
    if (creep.memory.targetId)
    {
        var directTarget = Game.getObjectById(creep.memory.targetId);
        if (directTarget && directTarget.structureType
            && (isHostileStructure(directTarget) || isDestructibleObstacle(directTarget)))
        {
            return directTarget;
        }
        if (directTarget && directTarget.owner && isHostile(directTarget))
        {
            return directTarget;
        }
    }

    var dangerous = room.find(FIND_HOSTILE_CREEPS,
    {
        filter: function(c) {
            return isTargetableHostile(c) && (c.getActiveBodyparts(ATTACK) > 0
                || c.getActiveBodyparts(RANGED_ATTACK) > 0
                || c.getActiveBodyparts(HEAL) > 0);
        }
    });
    if (dangerous.length > 0)
    {
        return closestToPos(dangerous, creep.pos);
    }

    var towers = room.find(FIND_HOSTILE_STRUCTURES,
    {
        filter: function(s) { return s.structureType == STRUCTURE_TOWER && isHostileStructure(s); }
    });
    if (towers.length > 0)
    {
        return closestToPos(towers, creep.pos);
    }

    var hostileCreeps = room.find(FIND_HOSTILE_CREEPS, {filter: isTargetableHostile});
    if (hostileCreeps.length > 0)
    {
        return closestToPos(hostileCreeps, creep.pos);
    }

    var spawns = room.find(FIND_HOSTILE_STRUCTURES,
    {
        filter: function(s) { return s.structureType == STRUCTURE_SPAWN && isHostileStructure(s); }
    });
    if (spawns.length > 0)
    {
        return closestToPos(spawns, creep.pos);
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
        return closestToPos(important, creep.pos);
    }

    if (targetFlag && targetFlag.pos.roomName == room.name)
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
            // Keeper lairs and other hitless structures can never be destroyed.
            return s.structureType != STRUCTURE_CONTROLLER && isHostileStructure(s) && s.hits;
        }
    });
    if (hostileStructures.length > 0)
    {
        return closestToPos(hostileStructures, creep.pos);
    }

    var obstacles = room.find(FIND_STRUCTURES,
    {
        filter: isDestructibleObstacle
    });
    return lowestHits(obstacles);
}

function getMovementGoal(creep, target, targetFlag, targetRoom)
{
    if (target && target.pos)
    {
        return {pos: target.pos, range: desiredAttackRange(creep, target)};
    }
    if (targetFlag)
    {
        return {pos: targetFlag.pos, range: creep.memory.flagRange || 3};
    }
    if (isValidRoomName(targetRoom) && creep.room.name != targetRoom)
    {
        var center = getRoomCenterPos(targetRoom);
        if (center)
        {
            return {pos: center, range: 20};
        }
    }
    return undefined;
}

function desiredAttackRange(creep, target)
{
    if (target && target.structureType && creep.getActiveBodyparts(WORK) > 0)
    {
        return 1;
    }
    if (creep.getActiveBodyparts(ATTACK) > 0)
    {
        return 1;
    }
    if (creep.getActiveBodyparts(RANGED_ATTACK) > 0)
    {
        return 3;
    }
    return 1;
}

function attackNearby(creep, focusTarget)
{
    focusTarget = getProtectedTarget(focusTarget) || focusTarget;

    if (creep.getActiveBodyparts(RANGED_ATTACK) > 0)
    {
        var massScore = rangedMassScore(creep);
        var rangedTarget = focusTarget && focusTarget.pos && creep.pos.getRangeTo(focusTarget) <= 3
            ? focusTarget
            : bestRangedTarget(creep);
        if (massScore > combatMath.rangedAttackPower(creep) && (!rangedTarget || !isDestructibleObstacle(rangedTarget)))
        {
            creep.rangedMassAttack();
        }
        else if (rangedTarget)
        {
            creep.rangedAttack(rangedTarget);
        }
    }

    var meleeTarget = focusTarget && focusTarget.pos && creep.pos.isNearTo(focusTarget)
        ? focusTarget
        : bestAdjacentTarget(creep);
    if (!meleeTarget)
    {
        return;
    }

    if (meleeTarget.structureType && creep.getActiveBodyparts(WORK) > 0)
    {
        creep.dismantle(meleeTarget);
    }
    else if (creep.getActiveBodyparts(ATTACK) > 0)
    {
        creep.attack(meleeTarget);
    }
}

function bestRangedTarget(creep)
{
    var targets = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3, {filter: isHostile});
    if (targets.length > 0)
    {
        return closestToPos(targets, creep.pos);
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

function bestAdjacentTarget(creep)
{
    var targets = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 1, {filter: isHostile});
    if (targets.length > 0)
    {
        return closestToPos(targets, creep.pos);
    }

    targets = creep.pos.findInRange(FIND_HOSTILE_STRUCTURES, 1,
    {
        filter: function(s) { return s.structureType != STRUCTURE_CONTROLLER && isHostileStructure(s); }
    });
    if (targets.length > 0)
    {
        return closestToPos(targets, creep.pos);
    }

    targets = creep.pos.findInRange(FIND_STRUCTURES, 1, {filter: isDestructibleObstacle});
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

function isGoalReached(creep, goal)
{
    return creep.pos.roomName == goal.pos.roomName && creep.pos.getRangeTo(goal.pos) <= goal.range;
}

function moveToward(creep, goal, target, pathResult)
{
    if (!goal || !goal.pos)
    {
        return;
    }
    if (isGoalReached(creep, goal))
    {
        return;
    }

    // run() already searched this path this tick (the incomplete-path streak
    // has not changed since); record it as the move search.
    recordSinglePathResult(creep, pathResult, getSoloPathMaxOps(creep), creep.pos, goal, 'move', true);
    var path = pathResult && pathResult.path;
    if (!path || path.length == 0)
    {
        var fallback = target ? blockingObstacle(creep, target) : undefined;
        if (fallback)
        {
            attackNearby(creep, fallback);
        }
        return;
    }

    var next = path[0];
    var nextPos = new RoomPosition(next.x, next.y, next.roomName || creep.room.name);
    var blocker = obstacleAt(nextPos);
    if (blocker)
    {
        attackNearby(creep, blocker);
        return;
    }

    creep.move(creep.pos.getDirectionTo(nextPos));
}

function serializePathPos(pos)
{
    if (!pos)
    {
        return undefined;
    }
    return {x: pos.x, y: pos.y, roomName: pos.roomName};
}

function getSoloPathMaxOps(creep)
{
    return (creep.memory.combatPathIncompleteStreak || 0) >= PATH_OPS_BOOST_STREAK
        ? SOLO_PATH_MAX_OPS_BOOSTED
        : SOLO_PATH_MAX_OPS;
}

function recordSinglePathResult(creep, result, maxOps, startPos, goal, context, affectsStreak)
{
    var pathLength = result && result.path ? result.path.length : 0;
    var incomplete = !result || result.incomplete == true;
    if (affectsStreak)
    {
        if (incomplete || pathLength == 0)
        {
            creep.memory.combatPathIncompleteStreak = Math.min((creep.memory.combatPathIncompleteStreak || 0) + 1, 50);
        }
        else
        {
            creep.memory.combatPathIncompleteStreak = 0;
        }
    }

    var field = context == 'blocker' ? 'combatBlockerPath' : 'combatPath';
    creep.memory[field] = {
        at: Game.time,
        context: context,
        ops: result ? result.ops : undefined,
        maxOps: maxOps,
        incomplete: incomplete,
        failed: incomplete || pathLength == 0,
        length: pathLength,
        from: serializePathPos(startPos),
        to: goal && goal.pos ? serializePathPos(goal.pos) : undefined,
        streak: creep.memory.combatPathIncompleteStreak || 0
    };
}

function findSinglePathResult(creep, startPos, goal, context, affectsStreak)
{
    var maxOps = getSoloPathMaxOps(creep);
    var result = PathFinder.search(startPos, goal,
    {
        plainCost: 2,
        swampCost: 10,
        maxOps: maxOps,
        roomCallback: function(roomName) {
            return singleCostMatrix(roomName, creep.name);
        }
    });
    recordSinglePathResult(creep, result, maxOps, startPos, goal, context, affectsStreak);
    return result;
}

function getNextStepBlocker(pos, result)
{
    if (!result.path || result.path.length == 0)
    {
        return undefined;
    }
    var next = result.path[0];
    return obstacleAt(new RoomPosition(next.x, next.y, next.roomName || pos.roomName));
}

function singleCostMatrix(roomName, selfName)
{
    var room = Game.rooms[roomName];
    // Terrain walls need no entry: a 0 cost already means "use terrain", and
    // PathFinder never enters a terrain wall unless a cost is set (tunnels).
    var costs = new PathFinder.CostMatrix();

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
        else if (s.structureType == STRUCTURE_RAMPART && s.my)
        {
            costs.set(s.pos.x, s.pos.y, 1);
        }
        else if (isBlockingStructure(s))
        {
            costs.set(s.pos.x, s.pos.y, obstacleCost(s));
        }
    }

    var creeps = room.find(FIND_CREEPS);
    for (var c = 0; c < creeps.length; c++)
    {
        if (creeps[c].name != selfName)
        {
            costs.set(creeps[c].pos.x, creeps[c].pos.y, 255);
        }
    }
    return costs;
}

function blockingObstacle(creep, target)
{
    if (!target || !target.pos)
    {
        return undefined;
    }

    var protectedTarget = obstacleAt(target.pos);
    if (protectedTarget)
    {
        return protectedTarget;
    }

    var path = creep.pos.findPathTo(target,
    {
        ignoreDestructibleStructures: true,
        range: desiredAttackRange(creep, target)
    });
    for (var i = 0; i < path.length; i++)
    {
        var pos = new RoomPosition(path[i].x, path[i].y, creep.room.name);
        var obstacle = obstacleAt(pos);
        if (obstacle)
        {
            return obstacle;
        }
    }
    return undefined;
}

function getProtectedTarget(target)
{
    if (!target || !target.pos)
    {
        return undefined;
    }
    var rampart = hostileRampartAt(target.pos, target.id);
    if (rampart)
    {
        return rampart;
    }
    var blocker = obstacleAt(target.pos);
    if (blocker && blocker.id != target.id)
    {
        return blocker;
    }
    return undefined;
}

function hostileRampartAt(pos, targetId)
{
    var structures = pos.lookFor(LOOK_STRUCTURES);
    for (var i = 0; i < structures.length; i++)
    {
        if (structures[i].structureType == STRUCTURE_RAMPART
            && structures[i].id != targetId
            && isDestructibleObstacle(structures[i]))
        {
            return structures[i];
        }
    }
    return undefined;
}

function obstacleAt(pos)
{
    return lowestHits(pos.lookFor(LOOK_STRUCTURES).filter(function(s) {
        return isBlockingStructure(s) && isDestructibleObstacle(s);
    }));
}

function isBlockingStructure(s)
{
    if (s.structureType == STRUCTURE_ROAD || s.structureType == STRUCTURE_CONTAINER)
    {
        return false;
    }
    if (s.structureType == STRUCTURE_RAMPART && s.my)
    {
        return false;
    }
    return OBSTACLE_OBJECT_TYPES.indexOf(s.structureType) >= 0
        || s.structureType == STRUCTURE_WALL
        || s.structureType == STRUCTURE_RAMPART;
}

function isDestructibleObstacle(s)
{
    // No hits: indestructible (keeper lairs, novice/respawn border walls).
    if (!s || !s.structureType || s.structureType == STRUCTURE_CONTROLLER || !s.hits)
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
    if (s.structureType == STRUCTURE_RAMPART && s.my)
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
    if (!s.owner)
    {
        return false;
    }
    if (s.owner && isAllyName(s.owner.username))
    {
        return false;
    }
    return true;
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
    if (!creep.owner)
    {
        return false;
    }
    return !isAllyName(creep.owner.username);
}

// Source Keepers outclass a solo attacker; they still count as threats for
// retreat math, but are only chased when named explicitly via targetId.
function isTargetableHostile(creep)
{
    return isHostile(creep) && creep.owner.username != 'Source Keeper';
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
