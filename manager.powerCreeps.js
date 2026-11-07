// Conservative Power Creep lifecycle manager.
//
// The first stage is intentionally opt-in. Set
// Memory.powerCreepManagerEnabled = true to allow spawning and actions. Operators
// are assigned to an owned RCL8 room with a Power Spawn, enable powers there,
// renew before expiry, generate OPS, and unload OPS before their store fills.

var specialStructureMarket = require('market.specialStructures');
var DEFAULT_RENEW_TICKS = 1000;
var DEFAULT_OPS_UNLOAD_RATIO = 0.8;

function isEnabled()
{
    return Memory.powerCreepManagerEnabled === true;
}

function getOwnedPowerSpawns(room)
{
    if (!room || !room.controller || !room.controller.my || room.controller.level < 8)
    {
        return [];
    }
    return specialStructureMarket.getOwnedStructures(room, STRUCTURE_POWER_SPAWN);
}

function getAssignments()
{
    Memory.powerCreepAssignments = Memory.powerCreepAssignments || {};
    return Memory.powerCreepAssignments;
}

function readConfiguredHome(powerCreep)
{
    if (powerCreep.memory && typeof powerCreep.memory.homeRoom == 'string')
    {
        return powerCreep.memory.homeRoom;
    }
    var assignment = Memory.powerCreepAssignments
        && Memory.powerCreepAssignments[powerCreep.name];
    if (assignment && typeof assignment.homeRoom == 'string')
    {
        return assignment.homeRoom;
    }
    if (typeof Memory.powerCreepHomeRoom == 'string')
    {
        return Memory.powerCreepHomeRoom;
    }
    return undefined;
}

function findAutomaticHome()
{
    var roomNames = Object.keys(Game.rooms || {}).sort();
    for (let roomName of roomNames)
    {
        let room = Game.rooms[roomName];
        if (getOwnedPowerSpawns(room).length > 0)
        {
            return roomName;
        }
    }
    return undefined;
}

function rememberHome(powerCreep, roomName)
{
    if (!roomName)
    {
        return;
    }
    var assignments = getAssignments();
    assignments[powerCreep.name] = assignments[powerCreep.name] || {};
    assignments[powerCreep.name].homeRoom = roomName;
    if (powerCreep.memory)
    {
        powerCreep.memory.homeRoom = roomName;
    }
}

function getHomeRoomName(powerCreep, allowAutomatic)
{
    var configured = readConfiguredHome(powerCreep);
    if (configured)
    {
        return configured;
    }
    if (!allowAutomatic)
    {
        return undefined;
    }
    var automatic = findAutomaticHome();
    rememberHome(powerCreep, automatic);
    return automatic;
}

function getHomePowerSpawn(powerCreep, room)
{
    var powerSpawns = getOwnedPowerSpawns(room);
    if (powerSpawns.length == 0)
    {
        return undefined;
    }
    var assignment = Memory.powerCreepAssignments
        && Memory.powerCreepAssignments[powerCreep.name];
    var configuredId = powerCreep.memory && powerCreep.memory.powerSpawnId;
    if (!configuredId && assignment)
    {
        configuredId = assignment.powerSpawnId;
    }
    if (configuredId)
    {
        var configured = powerSpawns.find(powerSpawn => powerSpawn.id == configuredId);
        if (configured)
        {
            return configured;
        }
    }
    powerSpawns.sort((a, b) => a.id.localeCompare(b.id));
    return powerSpawns[0];
}

function getRenewThreshold(powerCreep)
{
    var configured = powerCreep.memory && powerCreep.memory.renewAt;
    if (typeof configured == 'number' && configured >= 100 && configured <= 4500)
    {
        return configured;
    }
    return DEFAULT_RENEW_TICKS;
}

function getOpsAmounts(powerCreep)
{
    if (!powerCreep.store)
    {
        return {used: 0, free: 0, capacity: 0};
    }
    var used = powerCreep.store.getUsedCapacity(RESOURCE_OPS) || 0;
    var free = powerCreep.store.getFreeCapacity(RESOURCE_OPS) || 0;
    return {used: used, free: free, capacity: used + free};
}

function getGenerateOpsAmount(powerCreep)
{
    var power = powerCreep.powers && powerCreep.powers[PWR_GENERATE_OPS];
    if (!power || power.level <= 0)
    {
        return 0;
    }
    var info = typeof POWER_INFO == 'object' && POWER_INFO[PWR_GENERATE_OPS];
    if (!info || !Array.isArray(info.effect))
    {
        return 1;
    }
    return info.effect[power.level - 1] || 1;
}

function shouldUnloadOps(powerCreep)
{
    var amounts = getOpsAmounts(powerCreep);
    if (amounts.used <= 0 || amounts.capacity <= 0)
    {
        return false;
    }
    return amounts.used >= amounts.capacity * DEFAULT_OPS_UNLOAD_RATIO
        || amounts.free < getGenerateOpsAmount(powerCreep);
}

function getOpsSink(room)
{
    var candidates = [room.storage, room.terminal];
    for (let target of candidates)
    {
        if (target && target.store && target.store.getFreeCapacity(RESOURCE_OPS) > 0)
        {
            return target;
        }
    }
    return undefined;
}

function moveTo(powerCreep, target, range)
{
    return powerCreep.moveTo(target, {
        range: range,
        reusePath: 10,
        visualizePathStyle: {stroke: '#d38bff'}
    });
}

function makeIdleStatus(powerCreep, homeRoomName, action, reason)
{
    return {
        name: powerCreep.name,
        className: powerCreep.className,
        level: powerCreep.level,
        homeRoom: homeRoomName,
        room: powerCreep.room && powerCreep.room.name,
        ticksToLive: powerCreep.ticksToLive || 0,
        action: action,
        reason: reason
    };
}

function runPowerCreep(powerCreep)
{
    var homeRoomName = getHomeRoomName(powerCreep, true);
    var status = makeIdleStatus(powerCreep, homeRoomName, 'idle');
    if (!homeRoomName)
    {
        status.reason = 'no owned RCL8 room with Power Spawn';
        return status;
    }
    var homeRoom = Game.rooms[homeRoomName];
    if (!homeRoom)
    {
        status.reason = 'home room not visible';
        return status;
    }
    var powerSpawn = getHomePowerSpawn(powerCreep, homeRoom);
    if (!powerSpawn)
    {
        status.reason = 'home room has no owned Power Spawn';
        return status;
    }

    if (!powerCreep.ticksToLive)
    {
        if (powerCreep.deleteTime)
        {
            status.reason = 'deletion pending';
            return status;
        }
        if (powerCreep.spawnCooldownTime && powerCreep.spawnCooldownTime > Date.now())
        {
            status.action = 'spawnCooldown';
            status.spawnCooldownTime = powerCreep.spawnCooldownTime;
            return status;
        }
        status.action = 'spawn';
        status.powerSpawnId = powerSpawn.id;
        status.result = powerCreep.spawn(powerSpawn);
        return status;
    }

    if (!powerCreep.room || powerCreep.room.name != homeRoomName)
    {
        status.action = 'returnHome';
        status.result = moveTo(powerCreep, powerSpawn, 1);
        return status;
    }

    if (powerCreep.ticksToLive <= getRenewThreshold(powerCreep))
    {
        status.powerSpawnId = powerSpawn.id;
        if (powerCreep.pos.isNearTo(powerSpawn))
        {
            status.action = 'renew';
            status.result = powerCreep.renew(powerSpawn);
        }
        else
        {
            status.action = 'moveToRenew';
            status.result = moveTo(powerCreep, powerSpawn, 1);
        }
        return status;
    }

    var controller = homeRoom.controller;
    if (controller && !controller.isPowerEnabled)
    {
        if (powerCreep.pos.isNearTo(controller))
        {
            status.action = 'enableRoom';
            status.result = powerCreep.enableRoom(controller);
        }
        else
        {
            status.action = 'moveToEnableRoom';
            status.result = moveTo(powerCreep, controller, 1);
        }
        return status;
    }

    if (shouldUnloadOps(powerCreep))
    {
        var sink = getOpsSink(homeRoom);
        if (!sink)
        {
            status.reason = 'OPS store full and no storage/terminal capacity';
            return status;
        }
        status.targetId = sink.id;
        if (powerCreep.pos.isNearTo(sink))
        {
            status.action = 'unloadOps';
            status.result = powerCreep.transfer(sink, RESOURCE_OPS);
        }
        else
        {
            status.action = 'moveToUnloadOps';
            status.result = moveTo(powerCreep, sink, 1);
        }
        return status;
    }

    var generateOps = powerCreep.powers && powerCreep.powers[PWR_GENERATE_OPS];
    if (!generateOps || generateOps.level <= 0)
    {
        status.reason = 'PWR_GENERATE_OPS unavailable';
        return status;
    }
    if ((generateOps.cooldown || 0) > 0)
    {
        status.action = 'generateOpsCooldown';
        status.cooldown = generateOps.cooldown;
        return status;
    }
    if (getOpsAmounts(powerCreep).free < getGenerateOpsAmount(powerCreep))
    {
        status.reason = 'not enough OPS store capacity';
        return status;
    }

    status.action = 'generateOps';
    status.result = powerCreep.usePower(PWR_GENERATE_OPS);
    return status;
}

function run()
{
    var enabled = isEnabled();
    var status = {
        tick: Game.time,
        enabled: enabled,
        gpl: Game.gpl ? {
            level: Game.gpl.level,
            progress: Game.gpl.progress,
            progressTotal: Game.gpl.progressTotal
        } : undefined,
        creeps: {}
    };
    Memory.powerCreepManagerStatus = status;

    var powerCreepNames = Object.keys(Game.powerCreeps || {}).sort();
    for (let name of powerCreepNames)
    {
        let powerCreep = Game.powerCreeps[name];
        if (!enabled)
        {
            status.creeps[name] = makeIdleStatus(powerCreep,
                getHomeRoomName(powerCreep, false), 'disabled');
            continue;
        }
        try
        {
            status.creeps[name] = runPowerCreep(powerCreep);
        }
        catch (error)
        {
            status.creeps[name] = makeIdleStatus(powerCreep,
                getHomeRoomName(powerCreep, false), 'error', String(error));
        }
    }
    return status;
}

module.exports = {
    getHomeRoomName: getHomeRoomName,
    getOwnedPowerSpawns: getOwnedPowerSpawns,
    isEnabled: isEnabled,
    run: run,
    runPowerCreep: runPowerCreep,
    shouldUnloadOps: shouldUnloadOps
};
