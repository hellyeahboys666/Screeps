var BASE_MATRIX_TTL = 73;
var DYNAMIC_MATRIX_TTL = 1;
var BLOCKED_TILE_COST = 255;
var STATIONARY_TICKS = 2;
// CostMatrix 255 is an unwalkable wall. Creeps are dynamic blockers that can
// swap/yield, so even anchored workers must stay below hard-blocking cost.
var STATIONARY_WORKER_COST = 20;
var STATIONARY_ANCHORED_WORKER_COST = 45;
var STATIONARY_ADJACENT_COST = 8;

var CIVILIAN_MOVE_ROLES = {
    harvester: true,
    upgrader: true,
    builder: true,
    repairer: true,
    lorry: true,
    remoteLorry: true,
    remoteCarrier: true,
    remoteBuilder: true,
    mineralLorry: true
};

var STATIONARY_COST_ROLES = {
    miner: STATIONARY_ANCHORED_WORKER_COST,
    Slinker: STATIONARY_ANCHORED_WORKER_COST,
    Clinker: STATIONARY_WORKER_COST,
    Blinker: STATIONARY_WORKER_COST,
    upgrader: STATIONARY_WORKER_COST,
    builder: STATIONARY_WORKER_COST,
    remoteBuilder: STATIONARY_WORKER_COST,
    repairer: STATIONARY_WORKER_COST,
    harvester: STATIONARY_WORKER_COST
};

function isEnabled()
{
    return Memory.civilianMovementEnabled == true;
}

function getState()
{
    if (!global.__civilianMovement)
    {
        global.__civilianMovement = {
            baseMatrices: {},
            dynamicMatrices: {},
            stationary: {},
            stationaryUpdated: {},
            stats: {}
        };
    }
    return global.__civilianMovement;
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

function setCostAtLeast(matrix, x, y, cost)
{
    if (x < 0 || x > 49 || y < 0 || y > 49)
    {
        return;
    }
    var existing = matrix.get(x, y);
    if (existing < cost)
    {
        matrix.set(x, y, cost);
    }
}

function buildBaseMatrix(room)
{
    var matrix = new PathFinder.CostMatrix();
    var structures = room.find(FIND_STRUCTURES);
    for (let structure of structures)
    {
        if (structure.structureType == STRUCTURE_ROAD)
        {
            matrix.set(structure.pos.x, structure.pos.y, 1);
        }
        else if (isBlockingStructure(structure))
        {
            matrix.set(structure.pos.x, structure.pos.y, BLOCKED_TILE_COST);
        }
    }
    return matrix;
}

function getBaseMatrix(room)
{
    var state = getState();
    var cached = state.baseMatrices[room.name];
    if (!cached || cached.expires <= Game.time)
    {
        cached = {
            matrix: buildBaseMatrix(room),
            expires: Game.time + BASE_MATRIX_TTL
        };
        state.baseMatrices[room.name] = cached;
    }
    return cached.matrix;
}

function posKey(pos)
{
    return pos.roomName + ':' + pos.x + ':' + pos.y;
}

function updateStationaryState(room)
{
    var state = getState();
    if (state.stationaryUpdated[room.name] == Game.time)
    {
        return;
    }
    state.stationaryUpdated[room.name] = Game.time;

    var seen = {};
    var creeps = room.find(FIND_MY_CREEPS);
    for (let creep of creeps)
    {
        seen[creep.name] = true;
        var last = state.stationary[creep.name];
        var currentKey = posKey(creep.pos);
        var ticks = 0;
        if (last && last.posKey == currentKey)
        {
            ticks = (last.ticks || 0) + 1;
        }
        state.stationary[creep.name] = {
            posKey: currentKey,
            roomName: creep.room.name,
            x: creep.pos.x,
            y: creep.pos.y,
            role: creep.memory.role,
            ticks: ticks,
            seen: Game.time
        };
    }

    if (Game.time % 251 == 0)
    {
        for (let name in state.stationary)
        {
            if (!seen[name] && (!Game.creeps[name]
                || state.stationary[name].seen < Game.time - 100))
            {
                delete state.stationary[name];
            }
        }
    }
}

function addAdjacentCost(matrix, x, y, cost)
{
    for (let dx = -1; dx <= 1; dx++)
    {
        for (let dy = -1; dy <= 1; dy++)
        {
            if (dx == 0 && dy == 0)
            {
                continue;
            }
            setCostAtLeast(matrix, x + dx, y + dy, cost);
        }
    }
}

function addStationaryCreepCosts(room, matrix)
{
    updateStationaryState(room);
    var state = getState();
    for (let name in state.stationary)
    {
        let info = state.stationary[name];
        if (!info || info.roomName != room.name || info.ticks < STATIONARY_TICKS)
        {
            continue;
        }
        let cost = STATIONARY_COST_ROLES[info.role];
        if (!cost)
        {
            continue;
        }
        setCostAtLeast(matrix, info.x, info.y, cost);
        if (cost >= STATIONARY_ANCHORED_WORKER_COST)
        {
            addAdjacentCost(matrix, info.x, info.y, STATIONARY_ADJACENT_COST);
        }
    }
}

function getDynamicMatrix(room)
{
    var state = getState();
    var cached = state.dynamicMatrices[room.name];
    if (!cached || cached.expires <= Game.time)
    {
        var matrix = getBaseMatrix(room).clone();
        addStationaryCreepCosts(room, matrix);
        cached = {
            matrix: matrix,
            expires: Game.time + DYNAMIC_MATRIX_TTL
        };
        state.dynamicMatrices[room.name] = cached;
    }
    return cached.matrix;
}

function getTargetPos(target)
{
    if (!target)
    {
        return undefined;
    }
    if (target.pos)
    {
        return target.pos;
    }
    if (target.roomName != undefined && target.x != undefined && target.y != undefined)
    {
        return target;
    }
    return undefined;
}

function shouldUseCivilianMatrix(creep, target, opts, argCount)
{
    if (!isEnabled())
    {
        return false;
    }
    if (!creep || !creep.memory || !CIVILIAN_MOVE_ROLES[creep.memory.role])
    {
        return false;
    }
    if (!creep.room || !creep.room.controller || !creep.room.controller.my)
    {
        return false;
    }
    if (argCount > 2 || typeof target == 'number')
    {
        return false;
    }
    if (opts && opts.costCallback)
    {
        return false;
    }
    var targetPos = getTargetPos(target);
    if (!targetPos || targetPos.roomName != creep.room.name)
    {
        return false;
    }
    return true;
}

function copyOptions(opts)
{
    var copied = {};
    if (!opts)
    {
        return copied;
    }
    for (let key in opts)
    {
        copied[key] = opts[key];
    }
    return copied;
}

function recordUse(creep)
{
    var state = getState();
    var roomName = creep.room.name;
    var stats = state.stats[roomName] || {tick: Game.time, uses: 0};
    if (stats.tick != Game.time)
    {
        stats.tick = Game.time;
        stats.uses = 0;
    }
    stats.uses++;
    state.stats[roomName] = stats;
}

function callOriginalMoveTo(creep, originalMoveTo, args)
{
    return originalMoveTo.apply(creep, args);
}

function moveToWithMatrix(creep, originalMoveTo, args)
{
    var target = args[0];
    var opts = args.length > 1 ? args[1] : undefined;
    if (!shouldUseCivilianMatrix(creep, target, opts, args.length))
    {
        return callOriginalMoveTo(creep, originalMoveTo, args);
    }

    var newOpts = copyOptions(opts);
    if (newOpts.plainCost == undefined)
    {
        newOpts.plainCost = 2;
    }
    if (newOpts.swampCost == undefined)
    {
        newOpts.swampCost = 10;
    }
    if (newOpts.maxRooms == undefined)
    {
        newOpts.maxRooms = 1;
    }
    // Do not force ignoreCreeps here. The default false lets moveTo avoid
    // live blockers; callers that explicitly want creep-blind paths can still
    // pass ignoreCreeps: true themselves.
    newOpts.costCallback = function(roomName)
    {
        if (roomName != creep.room.name)
        {
            return false;
        }
        return getDynamicMatrix(creep.room);
    };

    recordUse(creep);
    return originalMoveTo.call(creep, target, newOpts);
}

function install()
{
    if (global.__civilianMovementInstalled && global.__civilianOriginalMoveTo)
    {
        return;
    }
    if (typeof Creep == 'undefined' || !Creep.prototype || !Creep.prototype.moveTo)
    {
        return;
    }
    global.__civilianOriginalMoveTo = Creep.prototype.moveTo;
    Creep.prototype.moveTo = function(target, opts)
    {
        return moveToWithMatrix(this, global.__civilianOriginalMoveTo, arguments);
    };
    global.__civilianMovementInstalled = true;
}

function getDebugStats()
{
    return getState().stats;
}

module.exports = {
    getDebugStats: getDebugStats,
    getDynamicMatrix: getDynamicMatrix,
    install: install,
    isEnabled: isEnabled
};
