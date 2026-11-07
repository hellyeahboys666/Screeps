var WINDOW_TICKS = 1500;
var MAX_LAST_CONFLICTS = 10;
var MAX_LAST_UNRESOLVED = 10;
var MAX_RESOLUTION_CHAIN = 8;
var DEFAULT_MAX_YIELD_MOVES_PER_ROOM = 3;

var FLOW_DEFAULT_ROLES = {
    lorry: true,
    remoteLorry: true,
    remoteCarrier: true,
    remoteBuilder: true,
    builder: true,
    repairer: true,
    upgrader: true
};

var PINNED_ROLES = {
    miner: true,
    Slinker: true,
    Clinker: true,
    Blinker: true,
    attacker: true,
    defender: true,
    healer: true,
    quad: true,
    claimer: true,
    reserver: true,
    controllerAttacker: true
};

var FLOW_ROLE_PRIORITY = {
    remoteLorry: 70,
    remoteCarrier: 68,
    lorry: 65,
    remoteBuilder: 45,
    builder: 45,
    repairer: 45,
    upgrader: 35
};

function isObject(value)
{
    return value != undefined && typeof value == 'object' && !Array.isArray(value);
}

function isEnabled()
{
    return Memory.flowTrafficEnabled == true
        && Memory.civilianMovementEnabled != true;
}

function getMode()
{
    return Memory.flowTrafficMode || 'observe';
}

function isRoomCoord(x, y)
{
    return x >= 0 && x <= 49 && y >= 0 && y <= 49;
}

function isRoomEdge(pos)
{
    return pos.x == 0 || pos.x == 49 || pos.y == 0 || pos.y == 49;
}

function getRole(creep)
{
    return creep && creep.memory && creep.memory.role ? creep.memory.role : 'unknown';
}

function getEnabledRoles()
{
    return isObject(Memory.flowTrafficRoles) ? Memory.flowTrafficRoles : FLOW_DEFAULT_ROLES;
}

function isRoleEnabled(creep)
{
    return getEnabledRoles()[getRole(creep)] == true;
}

function isPinned(creep)
{
    if (!creep || !creep.memory)
    {
        return true;
    }
    var role = getRole(creep);
    if (isObject(Memory.flowTrafficPinnedRoles)
        && Memory.flowTrafficPinnedRoles[role] == true)
    {
        return true;
    }
    return PINNED_ROLES[role] == true;
}

function isRoomEnabled(room)
{
    return isEnabled()
        && room
        && room.controller
        && room.controller.my
        && isObject(Memory.flowTrafficRooms)
        && Memory.flowTrafficRooms[room.name] == true;
}

function getCpuUsed()
{
    if (Game.cpu && Game.cpu.getUsed)
    {
        return Game.cpu.getUsed();
    }
    return undefined;
}

function getState()
{
    if (!global.__flowTraffic || global.__flowTraffic.tick != Game.time)
    {
        global.__flowTraffic = {
            tick: Game.time,
            roomStates: {}
        };
    }
    return global.__flowTraffic;
}

function makeSummary(stats)
{
    return {
        windowStart: stats.windowStart,
        updated: stats.updated,
        windowTicks: stats.windowTicks || 0,
        enabledTicks: stats.enabledTicks || 0,
        seenTicks: stats.seenTicks || 0,
        eligibleTicks: stats.eligibleTicks || 0,
        intentTicks: stats.intentTicks || 0,
        predictedConflictTicks: stats.predictedConflictTicks || 0,
        pinnedBlockerTicks: stats.pinnedBlockerTicks || 0,
        idleEligibleTicks: stats.idleEligibleTicks || 0,
        hypotheticalResolvedTicks: stats.hypotheticalResolvedTicks || 0,
        hypotheticalUnresolvedTicks: stats.hypotheticalUnresolvedTicks || 0,
        hypotheticalResolvedConflictTicks: stats.hypotheticalResolvedConflictTicks || 0,
        hypotheticalUnresolvedConflictTicks: stats.hypotheticalUnresolvedConflictTicks || 0,
        hypotheticalChainTicks: stats.hypotheticalChainTicks || 0,
        hypotheticalYieldMoveTicks: stats.hypotheticalYieldMoveTicks || 0,
        resolveModeTicks: stats.resolveModeTicks || 0,
        executedYieldMoveTicks: stats.executedYieldMoveTicks || 0,
        executedYieldMoveErrorTicks: stats.executedYieldMoveErrorTicks || 0,
        skippedYieldMoveCapTicks: stats.skippedYieldMoveCapTicks || 0,
        skippedRoomTicks: stats.skippedRoomTicks || 0,
        skippedRoleTicks: stats.skippedRoleTicks || 0,
        skippedPinnedTicks: stats.skippedPinnedTicks || 0,
        skippedEdgeTicks: stats.skippedEdgeTicks || 0,
        skippedFatigueTicks: stats.skippedFatigueTicks || 0,
        skippedNoMovePartsTicks: stats.skippedNoMovePartsTicks || 0,
        skippedNoIntentTicks: stats.skippedNoIntentTicks || 0,
        skippedRemoteIntentTicks: stats.skippedRemoteIntentTicks || 0,
        skippedHardBlockedTicks: stats.skippedHardBlockedTicks || 0,
        resolverRoomTicks: stats.resolverRoomTicks || 0,
        cpuTotal: stats.cpuTotal || 0,
        cpuMax: stats.cpuMax || 0
    };
}

function ensureStats()
{
    var existing = Memory.flowTrafficStats;
    if (!existing
        || existing.windowStart == undefined
        || Game.time - existing.windowStart >= WINDOW_TICKS)
    {
        var history = existing && existing.history ? existing.history : [];
        if (existing && existing.windowStart != undefined)
        {
            history.unshift(makeSummary(existing));
        }
        while (history.length > 5)
        {
            history.pop();
        }
        Memory.flowTrafficStats = {
            windowStart: Game.time,
            windowTicks: 0,
            updated: Game.time,
            enabledTicks: 0,
            seenTicks: 0,
            eligibleTicks: 0,
            intentTicks: 0,
            predictedConflictTicks: 0,
            pinnedBlockerTicks: 0,
            idleEligibleTicks: 0,
            hypotheticalResolvedTicks: 0,
            hypotheticalUnresolvedTicks: 0,
            hypotheticalResolvedConflictTicks: 0,
            hypotheticalUnresolvedConflictTicks: 0,
            hypotheticalChainTicks: 0,
            hypotheticalYieldMoveTicks: 0,
            resolveModeTicks: 0,
            executedYieldMoveTicks: 0,
            executedYieldMoveErrorTicks: 0,
            skippedYieldMoveCapTicks: 0,
            skippedRoomTicks: 0,
            skippedRoleTicks: 0,
            skippedPinnedTicks: 0,
            skippedEdgeTicks: 0,
            skippedFatigueTicks: 0,
            skippedNoMovePartsTicks: 0,
            skippedNoIntentTicks: 0,
            skippedRemoteIntentTicks: 0,
            skippedHardBlockedTicks: 0,
            resolverRoomTicks: 0,
            roles: {},
            rooms: {},
            lastConflicts: [],
            lastUnresolved: [],
            history: history,
            mode: getMode()
        };
    }
    var stats = Memory.flowTrafficStats;
    stats.roles = stats.roles || {};
    stats.rooms = stats.rooms || {};
    stats.lastConflicts = stats.lastConflicts || [];
    stats.lastUnresolved = stats.lastUnresolved || [];
    stats.history = stats.history || [];
    return stats;
}

function inc(bucket, key, amount)
{
    bucket[key] = (bucket[key] || 0) + (amount || 1);
}

function getBucket(parent, key)
{
    key = key || 'unknown';
    if (!parent[key])
    {
        parent[key] = {};
    }
    return parent[key];
}

function beginTick()
{
    if (!isEnabled())
    {
        return;
    }
    getState();
    var stats = ensureStats();
    if (stats.lastTick != Game.time)
    {
        stats.lastTick = Game.time;
        stats.updated = Game.time;
        stats.mode = getMode();
        stats.windowTicks = (stats.windowTicks || 0) + 1;
        stats.enabledTicks = (stats.enabledTicks || 0) + 1;
        if (getMode() == 'resolve')
        {
            stats.resolveModeTicks = (stats.resolveModeTicks || 0) + 1;
        }
        stats.lastConflicts = [];
        stats.lastUnresolved = [];
    }
}

function packXY(roomName, x, y)
{
    return roomName + ':' + x + ':' + y;
}

function packPos(pos)
{
    return packXY(pos.roomName, pos.x, pos.y);
}

function isBlockingStructure(structure)
{
    if (!structure)
    {
        return false;
    }
    if (structure.structureType == STRUCTURE_ROAD
        || structure.structureType == STRUCTURE_CONTAINER)
    {
        return false;
    }
    if (structure.structureType == STRUCTURE_RAMPART)
    {
        return !structure.my && !structure.isPublic;
    }
    if (typeof OBSTACLE_OBJECT_TYPES != 'undefined')
    {
        return OBSTACLE_OBJECT_TYPES.indexOf(structure.structureType) >= 0;
    }
    return true;
}

function isWalkablePosition(room, pos, roomState)
{
    if (!pos || !isRoomCoord(pos.x, pos.y) || isRoomEdge(pos))
    {
        return false;
    }
    var key = packPos(pos);
    if (roomState.walkableCache[key] != undefined)
    {
        return roomState.walkableCache[key];
    }
    var walkable = true;
    if (room && room.getTerrain && typeof TERRAIN_MASK_WALL != 'undefined')
    {
        var terrain = room.getTerrain();
        if (terrain && terrain.get(pos.x, pos.y) == TERRAIN_MASK_WALL)
        {
            walkable = false;
        }
    }
    if (walkable && pos.lookFor && typeof LOOK_STRUCTURES != 'undefined')
    {
        var structures = pos.lookFor(LOOK_STRUCTURES);
        for (let structure of structures)
        {
            if (isBlockingStructure(structure))
            {
                walkable = false;
                break;
            }
        }
    }
    roomState.walkableCache[key] = walkable;
    return walkable;
}

function ensureRoomState(room)
{
    var state = getState();
    var roomState = state.roomStates[room.name];
    if (roomState)
    {
        return roomState;
    }
    roomState = {
        room: room,
        occupants: {},
        intents: [],
        intentsByName: {},
        intentsByDest: {},
        idleByName: {},
        yieldDestByName: {},
        assignedYields: [],
        walkableCache: {},
        resolved: false
    };
    var findType = typeof FIND_CREEPS != 'undefined' ? FIND_CREEPS : FIND_MY_CREEPS;
    var creeps = room.find(findType);
    for (let creep of creeps)
    {
        roomState.occupants[packPos(creep.pos)] = {
            name: creep.name,
            role: getRole(creep),
            my: creep.my == true,
            pinned: creep.my != true || isPinned(creep)
        };
    }
    state.roomStates[room.name] = roomState;
    return roomState;
}

function getMoveDest(creep)
{
    if (!creep.memory
        || !creep.memory._move
        || !creep.memory._move.dest
        || creep.memory._move.time != Game.time)
    {
        return undefined;
    }
    var dest = creep.memory._move.dest;
    var x = Math.floor(dest.x);
    var y = Math.floor(dest.y);
    var roomName = dest.room || dest.roomName || creep.room.name;
    if (!isRoomCoord(x, y))
    {
        return undefined;
    }
    return new RoomPosition(x, y, roomName);
}

function getPositionInDirection(pos, direction)
{
    var dx = 0;
    var dy = 0;
    if (direction == TOP || direction == TOP_RIGHT || direction == TOP_LEFT)
    {
        dy = -1;
    }
    else if (direction == BOTTOM || direction == BOTTOM_RIGHT || direction == BOTTOM_LEFT)
    {
        dy = 1;
    }
    if (direction == RIGHT || direction == TOP_RIGHT || direction == BOTTOM_RIGHT)
    {
        dx = 1;
    }
    else if (direction == LEFT || direction == TOP_LEFT || direction == BOTTOM_LEFT)
    {
        dx = -1;
    }
    if (!isRoomCoord(pos.x + dx, pos.y + dy))
    {
        return undefined;
    }
    return new RoomPosition(pos.x + dx, pos.y + dy, pos.roomName);
}

function getPredictedNextPos(creep, dest)
{
    if (!dest || dest.roomName != creep.room.name || dest.isEqualTo(creep.pos))
    {
        return undefined;
    }
    return getPositionInDirection(creep.pos, creep.pos.getDirectionTo(dest));
}

function getFlowPriority(creep)
{
    var role = getRole(creep);
    var priority = FLOW_ROLE_PRIORITY[role] || 10;
    if ((role == 'remoteLorry' || role == 'remoteCarrier' || role == 'lorry') && creep.memory.empty == false)
    {
        priority += 20;
    }
    else if ((role == 'remoteLorry' || role == 'remoteCarrier' || role == 'lorry') && creep.memory.empty == true)
    {
        priority += 5;
    }
    else if ((role == 'builder' || role == 'repairer' || role == 'upgrader')
        && creep.memory.empty == false)
    {
        priority += 5;
    }
    if (creep.memory._trafficStuckTicks >= 3)
    {
        priority += 20;
    }
    return priority;
}

function recordSkip(stats, creep, key)
{
    var role = getRole(creep);
    var roomName = creep && creep.room ? creep.room.name : 'unknown';
    inc(stats, key);
    inc(getBucket(stats.roles, role), key);
    inc(getBucket(stats.rooms, roomName), key);
}

function registerIdleEligibleCreep(stats, creep)
{
    var roomState = ensureRoomState(creep.room);
    var key = packPos(creep.pos);
    if (roomState.idleByName[creep.name] || roomState.intentsByName[creep.name])
    {
        return;
    }
    roomState.idleByName[creep.name] = {
        name: creep.name,
        role: getRole(creep),
        roomName: creep.room.name,
        fromKey: key,
        fromX: creep.pos.x,
        fromY: creep.pos.y,
        priority: getFlowPriority(creep)
    };
    inc(stats, 'idleEligibleTicks');
    inc(getBucket(stats.roles, getRole(creep)), 'idleEligibleTicks');
    inc(getBucket(stats.rooms, creep.room.name), 'idleEligibleTicks');
}

function recordConflict(stats, creep, nextPos, occupant, duplicateIntent)
{
    inc(stats, 'predictedConflictTicks');
    var roleStats = getBucket(stats.roles, getRole(creep));
    var roomStats = getBucket(stats.rooms, creep.room.name);
    inc(roleStats, 'predictedConflictTicks');
    inc(roomStats, 'predictedConflictTicks');
    if (occupant && occupant.pinned)
    {
        inc(stats, 'pinnedBlockerTicks');
        inc(roleStats, 'pinnedBlockerTicks');
        inc(roomStats, 'pinnedBlockerTicks');
    }
    if (stats.lastConflicts.length < MAX_LAST_CONFLICTS)
    {
        stats.lastConflicts.push({
            creep: creep.name,
            role: getRole(creep),
            roomName: creep.room.name,
            fromX: creep.pos.x,
            fromY: creep.pos.y,
            nextX: nextPos.x,
            nextY: nextPos.y,
            blocker: occupant ? occupant.name : undefined,
            blockerRole: occupant ? occupant.role : undefined,
            blockerPinned: occupant ? occupant.pinned : undefined,
            duplicateIntent: duplicateIntent ? duplicateIntent.name : undefined,
            duplicateRole: duplicateIntent ? duplicateIntent.role : undefined,
            tick: Game.time
        });
    }
}

function observeCreep(creep)
{
    if (!isEnabled() || !creep || !creep.memory)
    {
        return;
    }
    var stats = ensureStats();
    var role = getRole(creep);
    var roleStats = getBucket(stats.roles, role);
    var roomName = creep.room ? creep.room.name : 'unknown';
    var roomStats = getBucket(stats.rooms, roomName);
    inc(stats, 'seenTicks');
    inc(roleStats, 'seenTicks');
    inc(roomStats, 'seenTicks');

    if (!isRoomEnabled(creep.room))
    {
        recordSkip(stats, creep, 'skippedRoomTicks');
        return;
    }
    if (!isRoleEnabled(creep))
    {
        recordSkip(stats, creep, 'skippedRoleTicks');
        return;
    }
    if (isPinned(creep))
    {
        recordSkip(stats, creep, 'skippedPinnedTicks');
        return;
    }
    if (isRoomEdge(creep.pos))
    {
        recordSkip(stats, creep, 'skippedEdgeTicks');
        return;
    }
    if (creep.fatigue > 0)
    {
        recordSkip(stats, creep, 'skippedFatigueTicks');
        return;
    }
    if (creep.getActiveBodyparts && creep.getActiveBodyparts(MOVE) <= 0)
    {
        recordSkip(stats, creep, 'skippedNoMovePartsTicks');
        return;
    }

    inc(stats, 'eligibleTicks');
    inc(roleStats, 'eligibleTicks');
    inc(roomStats, 'eligibleTicks');

    var dest = getMoveDest(creep);
    if (!dest)
    {
        registerIdleEligibleCreep(stats, creep);
        recordSkip(stats, creep, 'skippedNoIntentTicks');
        return;
    }
    if (dest.roomName != creep.room.name)
    {
        recordSkip(stats, creep, 'skippedRemoteIntentTicks');
        return;
    }
    var nextPos = getPredictedNextPos(creep, dest);
    if (!nextPos || isRoomEdge(nextPos))
    {
        recordSkip(stats, creep, 'skippedEdgeTicks');
        return;
    }

    var roomState = ensureRoomState(creep.room);
    if (!isWalkablePosition(creep.room, nextPos, roomState))
    {
        recordSkip(stats, creep, 'skippedHardBlockedTicks');
        return;
    }

    inc(stats, 'intentTicks');
    inc(roleStats, 'intentTicks');
    inc(roomStats, 'intentTicks');

    var nextKey = packPos(nextPos);
    var fromKey = packPos(creep.pos);
    var occupant = roomState.occupants[nextKey];
    if (occupant && occupant.name == creep.name)
    {
        occupant = undefined;
    }
    var duplicateIntent = roomState.intentsByDest[nextKey];
    var intent = {
        name: creep.name,
        role: role,
        roomName: creep.room.name,
        fromKey: fromKey,
        nextKey: nextKey,
        fromX: creep.pos.x,
        fromY: creep.pos.y,
        nextX: nextPos.x,
        nextY: nextPos.y,
        priority: getFlowPriority(creep),
        conflicted: !!(occupant || duplicateIntent)
    };
    if (occupant || duplicateIntent)
    {
        recordConflict(stats, creep, nextPos, occupant, duplicateIntent);
    }
    roomState.intents.push(intent);
    roomState.intentsByName[creep.name] = intent;
    roomState.intentsByDest[nextKey] = {
        name: creep.name,
        role: role,
        priority: intent.priority
    };
}

function sortIntents(a, b)
{
    if (b.priority != a.priority)
    {
        return b.priority - a.priority;
    }
    return a.name < b.name ? -1 : 1;
}

function findIdleYieldKey(roomState, idle, assigned, reserved)
{
    var bestKey = undefined;
    var bestScore = undefined;
    for (let dx = -1; dx <= 1; dx++)
    {
        for (let dy = -1; dy <= 1; dy++)
        {
            if (dx == 0 && dy == 0)
            {
                continue;
            }
            var x = idle.fromX + dx;
            var y = idle.fromY + dy;
            if (!isRoomCoord(x, y))
            {
                continue;
            }
            var pos = new RoomPosition(x, y, idle.roomName);
            var key = packPos(pos);
            if (key == idle.fromKey || reserved[key])
            {
                continue;
            }
            if (!isWalkablePosition(roomState.room, pos, roomState))
            {
                continue;
            }
            var occupant = roomState.occupants[key];
            if (occupant && !assigned[occupant.name])
            {
                continue;
            }
            var score = 0;
            if (!occupant)
            {
                score += 20;
            }
            if (Math.abs(dx) + Math.abs(dy) == 1)
            {
                score += 2;
            }
            // Prefer not to push idle workers onto room edges even if a caller
            // later allows edge positions globally.
            if (x <= 1 || x >= 48 || y <= 1 || y >= 48)
            {
                score -= 5;
            }
            if (bestKey == undefined || score > bestScore)
            {
                bestKey = key;
                bestScore = score;
            }
        }
    }
    return bestKey;
}

function findResolutionChain(roomState, name, assigned, reserved, stack, depth)
{
    var intent = roomState.intentsByName[name];
    if (!intent || depth > MAX_RESOLUTION_CHAIN)
    {
        return undefined;
    }
    if (assigned[name])
    {
        return [];
    }
    if (reserved[intent.nextKey] && reserved[intent.nextKey] != name)
    {
        return undefined;
    }
    var occupant = roomState.occupants[intent.nextKey];
    if (!occupant || occupant.name == name)
    {
        return [name];
    }
    if (assigned[occupant.name])
    {
        return [name];
    }
    if (stack[occupant.name])
    {
        return [name];
    }
    if (!roomState.intentsByName[occupant.name])
    {
        var idle = roomState.idleByName[occupant.name];
        if (!idle)
        {
            return undefined;
        }
        var yieldKey = findIdleYieldKey(roomState, idle, assigned, reserved);
        if (!yieldKey)
        {
            return undefined;
        }
        roomState.yieldDestByName[occupant.name] = yieldKey;
        return [name, occupant.name];
    }
    var nextStack = {};
    for (let stackName in stack)
    {
        nextStack[stackName] = true;
    }
    nextStack[name] = true;
    var rest = findResolutionChain(roomState, occupant.name, assigned, reserved, nextStack, depth + 1);
    if (!rest)
    {
        return undefined;
    }
    var chain = [name];
    for (let member of rest)
    {
        if (chain.indexOf(member) < 0)
        {
            chain.push(member);
        }
    }
    return chain;
}

function recordHypotheticalYieldMove(stats, idle, chainLength)
{
    inc(stats, 'hypotheticalYieldMoveTicks');
    inc(getBucket(stats.roles, idle.role), 'hypotheticalYieldMoveTicks');
    inc(getBucket(stats.rooms, idle.roomName), 'hypotheticalYieldMoveTicks');
    if (chainLength > 1)
    {
        inc(stats, 'hypotheticalChainTicks');
        inc(getBucket(stats.roles, idle.role), 'hypotheticalChainTicks');
        inc(getBucket(stats.rooms, idle.roomName), 'hypotheticalChainTicks');
    }
}

function unpackKey(key)
{
    var parts = key.split(':');
    if (parts.length != 3)
    {
        return undefined;
    }
    var x = parseInt(parts[1], 10);
    var y = parseInt(parts[2], 10);
    if (!isRoomCoord(x, y))
    {
        return undefined;
    }
    return new RoomPosition(x, y, parts[0]);
}

function recordExecutedYield(stats, idle, result)
{
    var key = result == OK ? 'executedYieldMoveTicks' : 'executedYieldMoveErrorTicks';
    inc(stats, key);
    inc(getBucket(stats.roles, idle.role), key);
    inc(getBucket(stats.rooms, idle.roomName), key);
}

function getMaxYieldMovesPerRoom()
{
    var value = Memory.flowTrafficMaxYieldMovesPerRoom;
    if (typeof value != 'number' || value < 0)
    {
        return DEFAULT_MAX_YIELD_MOVES_PER_ROOM;
    }
    if (value > 20)
    {
        return 20;
    }
    return Math.floor(value);
}

function recordYieldCapSkip(stats, idle)
{
    inc(stats, 'skippedYieldMoveCapTicks');
    inc(getBucket(stats.roles, idle.role), 'skippedYieldMoveCapTicks');
    inc(getBucket(stats.rooms, idle.roomName), 'skippedYieldMoveCapTicks');
}

function executeAssignedYieldMoves(roomState, stats)
{
    if (getMode() != 'resolve' || !roomState.assignedYields || roomState.assignedYields.length == 0)
    {
        return;
    }
    var maxMoves = getMaxYieldMovesPerRoom();
    var executed = 0;
    for (let assignment of roomState.assignedYields)
    {
        let idle = roomState.idleByName[assignment.name];
        if (executed >= maxMoves)
        {
            if (idle)
            {
                recordYieldCapSkip(stats, idle);
            }
            continue;
        }
        let creep = Game.creeps[assignment.name];
        let targetPos = unpackKey(assignment.yieldKey);
        if (!idle || !creep || !targetPos || creep.spawning || creep.fatigue > 0
            || creep.pos.roomName != targetPos.roomName || creep.pos.getRangeTo(targetPos) > 1)
        {
            if (idle)
            {
                recordExecutedYield(stats, idle, ERR_INVALID_ARGS);
            }
            continue;
        }
        let result = creep.move(creep.pos.getDirectionTo(targetPos));
        executed++;
        recordExecutedYield(stats, idle, result);
    }
}

function recordHypotheticalResolution(stats, intent, resolved, chainLength)
{
    var key = resolved ? 'hypotheticalResolvedTicks' : 'hypotheticalUnresolvedTicks';
    var conflictKey = resolved ? 'hypotheticalResolvedConflictTicks' : 'hypotheticalUnresolvedConflictTicks';
    inc(stats, key);
    inc(getBucket(stats.roles, intent.role), key);
    inc(getBucket(stats.rooms, intent.roomName), key);
    if (intent.conflicted)
    {
        inc(stats, conflictKey);
        inc(getBucket(stats.roles, intent.role), conflictKey);
        inc(getBucket(stats.rooms, intent.roomName), conflictKey);
    }
    if (resolved && chainLength > 1)
    {
        inc(stats, 'hypotheticalChainTicks');
        inc(getBucket(stats.roles, intent.role), 'hypotheticalChainTicks');
        inc(getBucket(stats.rooms, intent.roomName), 'hypotheticalChainTicks');
    }
    if (!resolved && stats.lastUnresolved.length < MAX_LAST_UNRESOLVED)
    {
        stats.lastUnresolved.push({
            creep: intent.name,
            role: intent.role,
            roomName: intent.roomName,
            fromX: intent.fromX,
            fromY: intent.fromY,
            nextX: intent.nextX,
            nextY: intent.nextY,
            conflicted: intent.conflicted,
            tick: Game.time
        });
    }
}

function runObserveResolverForRoom(roomState, stats)
{
    if (!roomState || roomState.resolved || roomState.intents.length == 0)
    {
        return;
    }
    roomState.resolved = true;
    inc(stats, 'resolverRoomTicks');
    var sorted = roomState.intents.slice().sort(sortIntents);
    var assigned = {};
    var reserved = {};
    for (let intent of sorted)
    {
        if (assigned[intent.name])
        {
            continue;
        }
        var chain = findResolutionChain(roomState, intent.name, assigned, reserved, {}, 0);
        if (chain)
        {
            for (let memberName of chain)
            {
                let memberIntent = roomState.intentsByName[memberName];
                if (memberIntent && !assigned[memberName])
                {
                    assigned[memberName] = true;
                    reserved[memberIntent.nextKey] = memberName;
                    recordHypotheticalResolution(stats, memberIntent, true, chain.length);
                    continue;
                }
                let idle = roomState.idleByName[memberName];
                let yieldKey = roomState.yieldDestByName[memberName];
                if (idle && yieldKey && !assigned[memberName])
                {
                    assigned[memberName] = true;
                    reserved[yieldKey] = memberName;
                    roomState.assignedYields.push({name: memberName, yieldKey: yieldKey});
                    recordHypotheticalYieldMove(stats, idle, chain.length);
                }
            }
        }
        else
        {
            assigned[intent.name] = true;
            recordHypotheticalResolution(stats, intent, false, 0);
        }
    }
    executeAssignedYieldMoves(roomState, stats);
}

function runObserveResolvers(stats)
{
    var state = getState();
    for (let roomName in state.roomStates)
    {
        runObserveResolverForRoom(state.roomStates[roomName], stats);
    }
}

function endTick()
{
    if (!isEnabled())
    {
        return;
    }
    var stats = ensureStats();
    var cpuBefore = getCpuUsed();
    runObserveResolvers(stats);
    var cpuAfter = getCpuUsed();
    if (cpuBefore != undefined && cpuAfter != undefined)
    {
        var used = cpuAfter - cpuBefore;
        if (used >= 0)
        {
            stats.cpuTotal = (stats.cpuTotal || 0) + used;
            if (used > (stats.cpuMax || 0))
            {
                stats.cpuMax = used;
            }
        }
    }
    stats.updated = Game.time;
}

function runRoom(room)
{
    // Per-room execution is currently driven from endTick() after all selected
    // creep intents have been observed.
    return isRoomEnabled(room) ? OK : ERR_INVALID_ARGS;
}

function runAllRooms()
{
    return OK;
}

module.exports = {
    beginTick: beginTick,
    endTick: endTick,
    getMode: getMode,
    isEnabled: isEnabled,
    isRoomEnabled: isRoomEnabled,
    isRoleEnabled: isRoleEnabled,
    observeCreep: observeCreep,
    runAllRooms: runAllRooms,
    runRoom: runRoom
};
