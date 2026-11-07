var E9S17_REMOTE_ROOM = 'E9S17';
var E9S17_REMOTE_SOURCE_ID = 0;
var E9S17_RESERVE_MIN_TICKS = 1500;
var RESERVER_REPLACEMENT_TICKS = 150;
var REMOTE_HARVESTER_REPLACEMENT_TICKS = 175;
var MIN_RESERVED_REMOTE_HARVESTER_WORK_PARTS = 5;
var FAST_REMOTE_HARVESTER_WORK_PARTS = 5;
var FAST_REMOTE_HARVESTER_TARGET_MOVE_PARTS = 3;
var FAST_REMOTE_HARVESTER_MIN_MOVE_PARTS = 2;
var DEFAULT_REMOTE_OWNER_MEMORY_KEY = 'defaultRemoteOwner';
var remoteCreepIndexTick;
var remoteCreepIndex;

function getRemoteReservationOverride(spawn, roomName)
{
    if (spawn.memory.remoteReservations
        && spawn.memory.remoteReservations[roomName] != undefined)
    {
        return spawn.memory.remoteReservations[roomName] == true;
    }
    var legacyKey = 'remote' + roomName + 'Reserved';
    if (spawn.memory[legacyKey] != undefined)
    {
        return spawn.memory[legacyKey] == true;
    }
    return undefined;
}

function isRemoteReservedForUs(spawn, roomName)
{
    var override = getRemoteReservationOverride(spawn, roomName);
    if (override != undefined)
    {
        return override;
    }

    var remoteRoom = Game.rooms[roomName];
    if (!remoteRoom || !remoteRoom.controller || !remoteRoom.controller.reservation)
    {
        return false;
    }
    return spawn.owner
        && remoteRoom.controller.reservation.username == spawn.owner.username;
}

function getRemoteReservationStatus(spawn, roomName)
{
    var status = {
        visible: false,
        canReserve: true,
        ticks: 0,
        reason: undefined
    };
    var remoteRoom = Game.rooms[roomName];
    if (!remoteRoom || !remoteRoom.controller)
    {
        status.reason = 'notVisible';
        return status;
    }

    status.visible = true;
    var controller = remoteRoom.controller;
    if (controller.owner)
    {
        status.canReserve = false;
        status.reason = spawn.owner && controller.owner.username == spawn.owner.username
            ? 'ownedByUs'
            : 'owned:' + controller.owner.username;
        return status;
    }

    if (controller.reservation)
    {
        if (spawn.owner && controller.reservation.username == spawn.owner.username)
        {
            status.ticks = controller.reservation.ticksToEnd || 0;
            status.reason = 'reservedByUs';
            return status;
        }
        status.canReserve = false;
        status.reason = 'reserved:' + controller.reservation.username;
        return status;
    }

    status.reason = 'unreserved';
    return status;
}

function createRemoteHomeCreepIndex()
{
    return {
        harvestersBySource: {},
        remoteLorryCountsBySource: {},
        reserverCountsByTarget: {},
        viableReserversByTarget: {}
    };
}

function getRemoteSourceKey(roomName, sourceId)
{
    return roomName + '|' + String(sourceId);
}

function getRemoteCreepIndex()
{
    if (remoteCreepIndex && remoteCreepIndexTick == Game.time)
    {
        return remoteCreepIndex;
    }

    var index = {byHome: {}, defaultRemoteHomeRooms: []};
    for (let creepName in Game.creeps)
    {
        let creep = Game.creeps[creepName];
        if (!creep || !creep.memory)
        {
            continue;
        }
        let memory = creep.memory;
        if (isDefaultRemoteCreep(creep) && memory.home)
        {
            addUniqueName(index.defaultRemoteHomeRooms, memory.home);
        }
        if (!memory.home
            || (memory.role != 'longDistanceHarvester'
                && memory.role != 'remoteLorry'
                && memory.role != 'reserver'))
        {
            continue;
        }

        let homeIndex = index.byHome[memory.home];
        if (!homeIndex)
        {
            homeIndex = createRemoteHomeCreepIndex();
            index.byHome[memory.home] = homeIndex;
        }
        if (memory.role == 'reserver')
        {
            homeIndex.reserverCountsByTarget[memory.target]
                = (homeIndex.reserverCountsByTarget[memory.target] || 0) + 1;
            if (creep.spawning
                || creep.ticksToLive == undefined
                || creep.ticksToLive > RESERVER_REPLACEMENT_TICKS)
            {
                homeIndex.viableReserversByTarget[memory.target] = true;
            }
            continue;
        }

        let sourceKey = getRemoteSourceKey(memory.target, memory.sourceId);
        if (memory.role == 'longDistanceHarvester')
        {
            if (!homeIndex.harvestersBySource[sourceKey])
            {
                homeIndex.harvestersBySource[sourceKey] = [];
            }
            homeIndex.harvestersBySource[sourceKey].push(creep);
        }
        else
        {
            homeIndex.remoteLorryCountsBySource[sourceKey]
                = (homeIndex.remoteLorryCountsBySource[sourceKey] || 0) + 1;
        }
    }
    remoteCreepIndexTick = Game.time;
    remoteCreepIndex = index;
    return index;
}

function getRemoteHomeCreepIndex(homeRoomName)
{
    return getRemoteCreepIndex().byHome[homeRoomName] || createRemoteHomeCreepIndex();
}

function hasViableRemoteReserver(spawn, roomName)
{
    return getRemoteHomeCreepIndex(spawn.room.name).viableReserversByTarget[roomName] == true;
}

function shouldSpawnRemoteReserver(spawn, roomName, reserveStatus)
{
    if (!reserveStatus.canReserve)
    {
        return false;
    }
    if (hasViableRemoteReserver(spawn, roomName))
    {
        return false;
    }
    return !reserveStatus.visible || reserveStatus.ticks < E9S17_RESERVE_MIN_TICKS;
}

function getManualReserveRooms(spawn)
{
    var configuredRooms = spawn.memory.reserveRooms;
    if (configuredRooms == undefined)
    {
        return [];
    }
    if (typeof configuredRooms == 'string')
    {
        configuredRooms = [configuredRooms];
    }
    if (!configuredRooms.length)
    {
        return [];
    }

    var rooms = [];
    var seen = {};
    for (let roomName of configuredRooms)
    {
        if (typeof roomName != 'string'
            || roomName == spawn.room.name
            || seen[roomName])
        {
            continue;
        }
        rooms.push(roomName);
        seen[roomName] = true;
    }
    return rooms;
}

function addUniqueName(names, name)
{
    if (name && names.indexOf(name) < 0)
    {
        names.push(name);
    }
}

function getPrimarySpawnNameForRoom(roomName)
{
    var names = [];
    for (let spawnName in Game.spawns)
    {
        let candidate = Game.spawns[spawnName];
        if (candidate && candidate.room && candidate.room.name == roomName)
        {
            names.push(candidate.name);
        }
    }
    names.sort();
    return names[0];
}

function getExplicitDefaultRemoteOwnerNames()
{
    var names = [];
    var invalidValues = [];
    for (let spawnName in Game.spawns)
    {
        let candidate = Game.spawns[spawnName];
        let configured = candidate.memory[DEFAULT_REMOTE_OWNER_MEMORY_KEY];
        if (configured == true)
        {
            addUniqueName(names, candidate.name);
        }
        else if (typeof configured == 'string' && configured.length > 0)
        {
            if (Game.spawns[configured])
            {
                addUniqueName(names, configured);
            }
            else
            {
                let roomOwner = getPrimarySpawnNameForRoom(configured);
                if (roomOwner)
                {
                    addUniqueName(names, roomOwner);
                }
                else
                {
                    invalidValues.push(candidate.name + ':' + configured);
                }
            }
        }
    }
    return {names: names, invalidValues: invalidValues};
}

function isDefaultRemoteCreep(creep)
{
    if (!creep || !creep.memory || creep.memory.target != E9S17_REMOTE_ROOM)
    {
        return false;
    }
    if (creep.memory.role == 'reserver')
    {
        return true;
    }
    return (creep.memory.role == 'longDistanceHarvester'
            || creep.memory.role == 'remoteLorry')
        && creep.memory.sourceId == E9S17_REMOTE_SOURCE_ID;
}

function getDefaultRemoteCreepOwnerNames()
{
    var names = [];
    var homeRooms = getRemoteCreepIndex().defaultRemoteHomeRooms;
    for (let homeRoom of homeRooms)
    {
        addUniqueName(names, getPrimarySpawnNameForRoom(homeRoom));
    }
    return names;
}

function getRequestedDefaultRemoteOwnerNames()
{
    var roomNames = [];
    for (let spawnName in Game.spawns)
    {
        let candidate = Game.spawns[spawnName];
        if (candidate.memory.minLDH_E11S23Source0 > 0
            || getManualReserveRooms(candidate).indexOf(E9S17_REMOTE_ROOM) >= 0)
        {
            addUniqueName(roomNames, candidate.room.name);
        }
    }

    var names = [];
    for (let roomName of roomNames)
    {
        addUniqueName(names, getPrimarySpawnNameForRoom(roomName));
    }
    return names;
}

function getDefaultRemoteOwner()
{
    if (typeof global != 'undefined'
        && global.defaultRemoteOwnerCache
        && global.defaultRemoteOwnerCache.tick == Game.time)
    {
        return global.defaultRemoteOwnerCache.owner;
    }

    var owner = {name: undefined, reason: 'disabled', error: undefined};
    var explicit = getExplicitDefaultRemoteOwnerNames();
    if (explicit.invalidValues.length > 0)
    {
        owner.error = 'invalid ' + DEFAULT_REMOTE_OWNER_MEMORY_KEY + ': ' + explicit.invalidValues.join(',');
    }
    else if (explicit.names.length > 1)
    {
        owner.error = 'conflicting explicit owners: ' + explicit.names.join(',');
    }
    else if (explicit.names.length == 1)
    {
        owner.name = explicit.names[0];
        owner.reason = 'explicit';
    }
    else
    {
        var activeOwners = getDefaultRemoteCreepOwnerNames();
        if (activeOwners.length > 1)
        {
            owner.error = 'conflicting active homes: ' + activeOwners.join(',');
        }
        else if (activeOwners.length == 1)
        {
            owner.name = activeOwners[0];
            owner.reason = 'activeCreepHome';
        }
        else
        {
            var requestedOwners = getRequestedDefaultRemoteOwnerNames();
            if (requestedOwners.length > 1)
            {
                owner.error = 'conflicting requested homes: ' + requestedOwners.join(',');
            }
            else if (requestedOwners.length == 1)
            {
                owner.name = requestedOwners[0];
                owner.reason = 'requestedHome';
            }
        }
    }

    if (typeof global != 'undefined')
    {
        global.defaultRemoteOwnerCache = {tick: Game.time, owner: owner};
    }
    return owner;
}

function isDefaultRemoteOwner(spawn)
{
    var owner = getDefaultRemoteOwner();
    return owner.name == spawn.name;
}

function getReserveAvoidRooms(spawn, roomName)
{
    if (spawn.memory.reserveAvoidRooms
        && spawn.memory.reserveAvoidRooms[roomName] != undefined)
    {
        return spawn.memory.reserveAvoidRooms[roomName];
    }
    if (roomName == E9S17_REMOTE_ROOM)
    {
        return spawn.memory.remoteE9S17AvoidRooms;
    }
    return undefined;
}

function getManualReservePlan(spawn, roomNames)
{
    var plan = {
        request: undefined,
        statusObjectsByRoom: {},
        statusByRoom: {},
        ticksByRoom: {},
        needsByRoom: {},
        reserversByRoom: {}
    };

    var homeCreeps = roomNames.length > 0
        ? getRemoteHomeCreepIndex(spawn.room.name)
        : undefined;
    for (let roomName of roomNames)
    {
        var status = getRemoteReservationStatus(spawn, roomName);
        var needed = shouldSpawnRemoteReserver(spawn, roomName, status);
        plan.statusObjectsByRoom[roomName] = status;
        plan.statusByRoom[roomName] = status.reason;
        plan.ticksByRoom[roomName] = status.ticks;
        plan.needsByRoom[roomName] = needed;
        plan.reserversByRoom[roomName] = homeCreeps.reserverCountsByTarget[roomName] || 0;
        if (!plan.request && needed)
        {
            plan.request = {
                roomName: roomName,
                avoidRooms: getReserveAvoidRooms(spawn, roomName),
                status: status
            };
        }
    }
    return plan;
}

function getRemoteHarvesterWorkParts(reserved)
{
    return reserved ? 6 : 3;
}

function getRemoteLorryTarget(remoteActive, reserved)
{
    if (!remoteActive)
    {
        return 0;
    }
    return reserved ? 3 : 2;
}

function updateRemoteLorryAutoTarget(spawn, targetKey, autoKey, remoteActive, reserved)
{
    var desiredTarget = getRemoteLorryTarget(remoteActive, reserved);
    var previousAutoTarget = spawn.memory[autoKey];
    if (spawn.memory[targetKey] == undefined
        || spawn.memory[targetKey] == previousAutoTarget
        || (reserved && previousAutoTarget == undefined && spawn.memory[targetKey] == 2))
    {
        spawn.memory[targetKey] = desiredTarget;
        spawn.memory[autoKey] = desiredTarget;
    }
}

function updateDefaultRemoteLorryAutoTarget(spawn)
{
    var remoteActive = isDefaultRemoteOwner(spawn)
        && spawn.memory.minLDH_E11S23Source0 > 0;
    var reserved = remoteActive && isRemoteReservedForUs(spawn, E9S17_REMOTE_ROOM);
    updateRemoteLorryAutoTarget(spawn,
        'minRemoteLorriesE9S17',
        'remoteLorriesE9S17AutoTarget',
        remoteActive,
        reserved);
    spawn.memory.remoteE9S17ReservedDetected = reserved;
    return reserved;
}

function countLongDistanceHarvesters(spawn, roomName, sourceId)
{
    var key = getRemoteSourceKey(roomName, sourceId);
    var harvesters = getRemoteHomeCreepIndex(spawn.room.name).harvestersBySource[key];
    return harvesters ? harvesters.length : 0;
}

function getLongDistanceHarvesterWorkParts(creep)
{
    if (creep.memory.workParts != undefined)
    {
        return creep.memory.workParts;
    }
    return creep.getActiveBodyparts(WORK);
}

function getLongDistanceHarvesterMoveParts(creep)
{
    if (creep.memory.moveParts != undefined)
    {
        return creep.memory.moveParts;
    }
    return creep.getActiveBodyparts(MOVE);
}

function getExpectedLongDistanceHarvesterMoveParts(workParts, energyCapacity)
{
    if (workParts < FAST_REMOTE_HARVESTER_WORK_PARTS)
    {
        return 1;
    }
    if (workParts >= 6 && energyCapacity >= workParts * 100 + FAST_REMOTE_HARVESTER_TARGET_MOVE_PARTS * 50)
    {
        return FAST_REMOTE_HARVESTER_TARGET_MOVE_PARTS;
    }
    if (workParts >= 6 && energyCapacity >= 650)
    {
        return FAST_REMOTE_HARVESTER_MIN_MOVE_PARTS;
    }
    if (energyCapacity >= workParts * 100 + FAST_REMOTE_HARVESTER_TARGET_MOVE_PARTS * 50)
    {
        return FAST_REMOTE_HARVESTER_TARGET_MOVE_PARTS;
    }
    if (energyCapacity >= workParts * 100 + FAST_REMOTE_HARVESTER_MIN_MOVE_PARTS * 50)
    {
        return FAST_REMOTE_HARVESTER_MIN_MOVE_PARTS;
    }
    return 1;
}

function isLongDistanceHarvesterForSource(creep, spawn, roomName, sourceId)
{
    return creep.memory.role == 'longDistanceHarvester'
        && creep.memory.home == spawn.room.name
        && creep.memory.target == roomName
        && creep.memory.sourceId == sourceId;
}

function isAdequateLongDistanceHarvester(creep, spawn, roomName, sourceId, reserved)
{
    if (!isLongDistanceHarvesterForSource(creep, spawn, roomName, sourceId))
    {
        return false;
    }
    if (!creep.spawning
        && creep.ticksToLive != undefined
        && creep.ticksToLive <= REMOTE_HARVESTER_REPLACEMENT_TICKS)
    {
        return false;
    }
    var workParts = getLongDistanceHarvesterWorkParts(creep);
    var moveParts = getLongDistanceHarvesterMoveParts(creep);
    var expectedMoveParts = getExpectedLongDistanceHarvesterMoveParts(workParts, spawn.room.energyCapacityAvailable);
    if (moveParts < expectedMoveParts)
    {
        return false;
    }
    if (!reserved)
    {
        return true;
    }
    return workParts >= MIN_RESERVED_REMOTE_HARVESTER_WORK_PARTS;
}

function countAdequateLongDistanceHarvesters(spawn, roomName, sourceId, reserved)
{
    var key = getRemoteSourceKey(roomName, sourceId);
    var harvesters = getRemoteHomeCreepIndex(spawn.room.name).harvestersBySource[key] || [];
    var count = 0;
    for (let creep of harvesters)
    {
        if (isAdequateLongDistanceHarvester(creep, spawn, roomName, sourceId, reserved))
        {
            count++;
        }
    }
    return count;
}

function countRemoteLorries(spawn, roomName, sourceId)
{
    var key = getRemoteSourceKey(roomName, sourceId);
    return getRemoteHomeCreepIndex(spawn.room.name).remoteLorryCountsBySource[key] || 0;
}

function countReservers(spawn, roomName)
{
    return getRemoteHomeCreepIndex(spawn.room.name).reserverCountsByTarget[roomName] || 0;
}

// A remote can become reserved while an old 3W unreserved miner is still alive.
// Once its 5+ WORK reserved replacement is actually present, keeping the old
// miner only creates redundant harvest intents and another per-tick role run.
function shouldRetireObsoleteDefaultRemoteHarvester(creep)
{
    if (!creep || !creep.memory
        || creep.memory.role != 'longDistanceHarvester'
        || !creep.memory.home
        || creep.memory.target != E9S17_REMOTE_ROOM
        || creep.memory.sourceId != E9S17_REMOTE_SOURCE_ID)
    {
        return false;
    }
    if (creep.memory.reserved == true
        && getLongDistanceHarvesterWorkParts(creep) >= MIN_RESERVED_REMOTE_HARVESTER_WORK_PARTS)
    {
        return false;
    }
    var remoteRoom = Game.rooms[E9S17_REMOTE_ROOM];
    if (!remoteRoom || !remoteRoom.controller || !remoteRoom.controller.reservation
        || !creep.owner
        || remoteRoom.controller.reservation.username != creep.owner.username)
    {
        return false;
    }
    var sourceKey = getRemoteSourceKey(E9S17_REMOTE_ROOM, E9S17_REMOTE_SOURCE_ID);
    var harvesters = getRemoteHomeCreepIndex(creep.memory.home).harvestersBySource[sourceKey] || [];
    for (let other of harvesters)
    {
        if (other.name != creep.name
            && other.memory.reserved == true
            && getLongDistanceHarvesterWorkParts(other) >= MIN_RESERVED_REMOTE_HARVESTER_WORK_PARTS)
        {
            return true;
        }
    }
    return false;
}

function getDefaultRemoteState(spawn)
{
    var owner = getDefaultRemoteOwner();
    var isOwner = owner.name == spawn.name;
    var active = isOwner && spawn.memory.minLDH_E11S23Source0 > 0;
    var reserved = isOwner && isRemoteReservedForUs(spawn, E9S17_REMOTE_ROOM);
    var harvesterTotalCount = isOwner
        ? countLongDistanceHarvesters(spawn, E9S17_REMOTE_ROOM, E9S17_REMOTE_SOURCE_ID)
        : 0;
    var harvesterCount = isOwner
        ? countAdequateLongDistanceHarvesters(spawn, E9S17_REMOTE_ROOM, E9S17_REMOTE_SOURCE_ID, reserved)
        : 0;
    return {
        roomName: E9S17_REMOTE_ROOM,
        sourceId: E9S17_REMOTE_SOURCE_ID,
        ownerName: owner.name,
        ownerReason: owner.reason,
        ownerError: owner.error,
        isOwner: isOwner,
        active: active,
        reserved: reserved,
        harvesterWorkParts: getRemoteHarvesterWorkParts(reserved),
        harvesterCount: harvesterCount,
        harvesterTotalCount: harvesterTotalCount,
        undersizedHarvesterCount: harvesterTotalCount - harvesterCount,
        remoteLorryCount: isOwner
            ? countRemoteLorries(spawn, E9S17_REMOTE_ROOM, E9S17_REMOTE_SOURCE_ID)
            : 0,
        reserverCount: isOwner ? countReservers(spawn, E9S17_REMOTE_ROOM) : 0
    };
}

function updateReserveMemory(spawn, manualReserveRooms, manualReservePlan, defaultRemote)
{
    var remoteReserveStatus = manualReservePlan.statusObjectsByRoom[defaultRemote.roomName]
        || getRemoteReservationStatus(spawn, defaultRemote.roomName);
    var remoteReserveNeeded = manualReservePlan.needsByRoom[defaultRemote.roomName] == true;
    var manualReserveRequest = manualReservePlan.request;

    if (manualReserveRooms.length > 0)
    {
        spawn.memory.reserveRoomsActive = manualReserveRooms;
        spawn.memory.reserveRoomStatus = manualReservePlan.statusByRoom;
        spawn.memory.reserveRoomTicks = manualReservePlan.ticksByRoom;
        spawn.memory.reserveRoomNeedsReserver = manualReservePlan.needsByRoom;
        spawn.memory.reserveRoomReserverCounts = manualReservePlan.reserversByRoom;
        if (manualReserveRequest)
        {
            spawn.memory.reserveRoomNext = manualReserveRequest.roomName;
        }
        else
        {
            delete spawn.memory.reserveRoomNext;
        }
    }
    else
    {
        delete spawn.memory.reserveRoomsActive;
        delete spawn.memory.reserveRoomStatus;
        delete spawn.memory.reserveRoomTicks;
        delete spawn.memory.reserveRoomNeedsReserver;
        delete spawn.memory.reserveRoomReserverCounts;
        delete spawn.memory.reserveRoomNext;
    }

    if (manualReserveRequest && spawn.room.energyCapacityAvailable < 650)
    {
        spawn.memory.reserveRoomError = 'need 650 energy capacity for ' + manualReserveRequest.roomName;
    }
    else
    {
        delete spawn.memory.reserveRoomError;
    }

    spawn.memory.remoteE9S17ReserveManual = manualReservePlan.needsByRoom[defaultRemote.roomName] != undefined;
    spawn.memory.remoteE9S17ReserveTicks = remoteReserveStatus.ticks;
    spawn.memory.remoteE9S17ReserveStatus = remoteReserveStatus.reason;
    spawn.memory.remoteE9S17OwnerReason = defaultRemote.ownerReason;
    spawn.memory.remoteE9S17Active = defaultRemote.active;
    if (defaultRemote.ownerName)
    {
        spawn.memory.remoteE9S17Owner = defaultRemote.ownerName;
    }
    else
    {
        delete spawn.memory.remoteE9S17Owner;
    }
    if (defaultRemote.ownerError)
    {
        spawn.memory.remoteE9S17OwnerError = defaultRemote.ownerError;
    }
    else
    {
        delete spawn.memory.remoteE9S17OwnerError;
    }
    spawn.memory.remoteE9S17ReserverNeeded = remoteReserveNeeded;
    spawn.memory.remoteE9S17Reservers = defaultRemote.reserverCount;
    spawn.memory.remoteE9S17Harvesters = defaultRemote.harvesterTotalCount;
    spawn.memory.remoteE9S17QualifiedHarvesters = defaultRemote.harvesterCount;
    spawn.memory.remoteE9S17UndersizedHarvesters = defaultRemote.undersizedHarvesterCount;
    if (remoteReserveNeeded && spawn.room.energyCapacityAvailable < 650)
    {
        spawn.memory.remoteE9S17ReserverError = 'need 650 energy capacity';
    }
    else
    {
        delete spawn.memory.remoteE9S17ReserverError;
    }
}

function getSpawnPlan(spawn)
{
    var defaultRemote = getDefaultRemoteState(spawn);
    var manualReserveRooms = getManualReserveRooms(spawn);
    var manualReservePlan = getManualReservePlan(spawn, manualReserveRooms);
    updateReserveMemory(spawn, manualReserveRooms, manualReservePlan, defaultRemote);

    return {
        defaultRemote: defaultRemote,
        manualReserveRooms: manualReserveRooms,
        manualReservePlan: manualReservePlan,
        manualReserveRequest: manualReservePlan.request
    };
}

module.exports = {
    DEFAULT_REMOTE_ROOM: E9S17_REMOTE_ROOM,
    DEFAULT_REMOTE_SOURCE_ID: E9S17_REMOTE_SOURCE_ID,
    getRemoteReservationStatus: getRemoteReservationStatus,
    isRemoteReservedForUs: isRemoteReservedForUs,
    getRemoteHarvesterWorkParts: getRemoteHarvesterWorkParts,
    shouldRetireObsoleteDefaultRemoteHarvester: shouldRetireObsoleteDefaultRemoteHarvester,
    updateDefaultRemoteLorryAutoTarget: updateDefaultRemoteLorryAutoTarget,
    getSpawnPlan: getSpawnPlan
};
