var depotUtils = require('remote.build.depot');
var routeSafety = require('remote.route.safety');

var DEFAULT_HOME_TERMINAL_RESERVE = 20000;
var DEFAULT_HOME_STORAGE_RESERVE = 30000;
var DEFAULT_TARGET_ENERGY_LOW = 1000;
var DEFAULT_TARGET_ENERGY_HIGH = 6000;
var DEFAULT_MAX_BUILDERS = 1;
var DEFAULT_MAX_CARRIERS = 3;
var DEFAULT_MODE = 'rushSpawn';
var DEFAULT_STOP_CONDITION = 'rcl6';
var STOP_CONDITION_SPAWN_BUILT = 'spawnBuilt';
var CLAIMER_REPLACEMENT_TICKS = 120;
var REMOTE_BUILD_STOP_RCL = 6;
var DEFAULT_ROAD_COVERAGE_THRESHOLD = 0.8;
var ROAD_PROFILE_CHECK_INTERVAL = 503;
var ROAD_PROFILE_MAX_ROOMS = 4;
var ROAD_PROFILE_MAX_OPS = 2000;
var spawnPlanCache = {tick: -1, byRoom: {}};

function isObject(value)
{
    return value != undefined && typeof value == 'object' && !Array.isArray(value);
}

function isRoomName(value)
{
    return typeof value == 'string' && /^[WE][0-9]+[NS][0-9]+$/.test(value);
}

function isFiniteNumber(value)
{
    return typeof value == 'number' && isFinite(value);
}

function getNumber(value, fallback)
{
    if (isFiniteNumber(value))
    {
        return value;
    }
    return fallback;
}

function asArray(value)
{
    if (value == undefined)
    {
        return [];
    }
    if (Array.isArray(value))
    {
        return value;
    }
    return [value];
}

function getAvoidRooms(raw)
{
    var rooms = [];
    var rawRooms = asArray(raw);
    for (let roomName of rawRooms)
    {
        if (isRoomName(roomName) && rooms.indexOf(roomName) < 0)
        {
            rooms.push(roomName);
        }
    }
    return rooms;
}

function normalizeMaxCount(value, fallback)
{
    if (value == 'auto')
    {
        return value;
    }
    if (isFiniteNumber(value))
    {
        return Math.max(0, Math.floor(value));
    }
    return fallback;
}

function normalizeRoadCoverageThreshold(value)
{
    if (!isFiniteNumber(value))
    {
        return DEFAULT_ROAD_COVERAGE_THRESHOLD;
    }
    return Math.max(0, Math.min(1, value));
}

function normalizeBodyProfile(value)
{
    if (value == 'roaded')
    {
        return 'roaded';
    }
    if (value == 'offroad')
    {
        return 'offroad';
    }
    return undefined;
}

function normalizeStopCondition(value)
{
    if (value == STOP_CONDITION_SPAWN_BUILT)
    {
        return STOP_CONDITION_SPAWN_BUILT;
    }
    return DEFAULT_STOP_CONDITION;
}

function getDepotFlagName(data)
{
    if (typeof data.depotFlag == 'string')
    {
        return data.depotFlag;
    }
    if (typeof data.depotFlagName == 'string')
    {
        return data.depotFlagName;
    }
    return undefined;
}

function getMissionFromMemory(key, raw, spawn)
{
    if (raw == false)
    {
        return undefined;
    }

    var data = isObject(raw) ? raw : {};
    if (data.active == false)
    {
        return undefined;
    }

    var target = data.target || data.targetRoom || (isRoomName(key) ? key : undefined);
    if (!isRoomName(target))
    {
        return undefined;
    }

    var home = data.home || data.homeRoom || spawn.room.name;
    if (!isRoomName(home) || home != spawn.room.name)
    {
        return undefined;
    }

    var depotResolution = depotUtils.resolveDepotPosition(data.name || key || target,
        target,
        data.depotPos,
        getDepotFlagName(data));

    return {
        name: data.name || key || target,
        raw: isObject(raw) ? raw : undefined,
        home: home,
        target: target,
        active: data.active != false,
        avoidRooms: getAvoidRooms(data.avoidRooms),
        conditionalAvoidRooms: getAvoidRooms(data.conditionalAvoidRooms || data.combatAvoidRooms),
        depotPos: depotResolution.pos,
        depotSource: depotResolution.source,
        depotFlag: depotResolution.flagName,
        depotFlagCount: depotResolution.flagCount,
        depotConfigError: depotResolution.error,
        mode: data.mode || DEFAULT_MODE,
        stopCondition: normalizeStopCondition(data.stopCondition),
        maxBuilders: normalizeMaxCount(data.maxBuilders, DEFAULT_MAX_BUILDERS),
        maxCarriers: normalizeMaxCount(data.maxCarriers, 'auto'),
        homeTerminalReserve: getNumber(data.homeTerminalReserve, DEFAULT_HOME_TERMINAL_RESERVE),
        homeStorageReserve: getNumber(data.homeStorageReserve, DEFAULT_HOME_STORAGE_RESERVE),
        targetEnergyLow: getNumber(data.targetEnergyLow, DEFAULT_TARGET_ENERGY_LOW),
        targetEnergyHigh: getNumber(data.targetEnergyHigh, DEFAULT_TARGET_ENERGY_HIGH),
        roadCoverageThreshold: normalizeRoadCoverageThreshold(data.roadCoverageThreshold),
        bodyProfileOverride: normalizeBodyProfile(data.bodyProfile || data.remoteBuildBodyProfile)
    };
}

function getConfiguredMissions(spawn)
{
    if (!Memory.remoteBuildMissions)
    {
        return [];
    }

    var missions = [];
    var rawMissions = Memory.remoteBuildMissions;
    if (Array.isArray(rawMissions))
    {
        for (var i = 0; i < rawMissions.length; i++)
        {
            let raw = rawMissions[i];
            let key = isObject(raw) && raw.name ? raw.name : String(i);
            let mission = getMissionFromMemory(key, raw, spawn);
            if (mission)
            {
                missions.push(mission);
            }
        }
        return missions;
    }

    for (let key in rawMissions)
    {
        let mission = getMissionFromMemory(key, rawMissions[key], spawn);
        if (mission)
        {
            missions.push(mission);
        }
    }
    return missions;
}

function getOwnerName(owner)
{
    return owner && owner.username ? owner.username : undefined;
}

function isAlly(username)
{
    return username == 'MoMoCat';
}

function getStoredEnergy(target)
{
    if (!target || !target.store)
    {
        return 0;
    }
    if (target.store.getUsedCapacity)
    {
        return target.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
    }
    return target.store[RESOURCE_ENERGY] || 0;
}

function getHomeEnergyStatus(room)
{
    return {
        terminalEnergy: room.terminal ? getStoredEnergy(room.terminal) : 0,
        storageEnergy: room.storage ? getStoredEnergy(room.storage) : 0,
        hasTerminal: !!room.terminal,
        hasStorage: !!room.storage
    };
}

function creepMatchesMission(roleName, creep, mission)
{
    if (roleName == 'claimer')
    {
        return creep.memory.target == mission.target;
    }

    var homeTargetMatch = creep.memory.home == mission.home
        && creep.memory.target == mission.target;
    if (!homeTargetMatch)
    {
        return false;
    }

    return creep.memory.remoteBuildMission == mission.name
        || creep.memory.mission == mission.name
        || creep.memory.missionName == mission.name
        || homeTargetMatch;
}

function countMissionCreeps(roleName, mission)
{
    var count = 0;
    for (let name in Game.creeps)
    {
        let creep = Game.creeps[name];
        if (!creep || !creep.memory || creep.memory.role != roleName)
        {
            continue;
        }
        if (creepMatchesMission(roleName, creep, mission))
        {
            count++;
        }
    }
    return count;
}

function syncMissionCreepRouteSafety(mission, safety)
{
    for (let name in Game.creeps)
    {
        let creep = Game.creeps[name];
        if (!creep || !creep.memory
            || (creep.memory.role != 'remoteBuilder'
                && creep.memory.role != 'remoteCarrier'
                && creep.memory.role != 'claimer')
            || !creepMatchesMission(creep.memory.role, creep, mission))
        {
            continue;
        }
        creep.memory.avoidRooms = safety.activeAvoidRooms.slice();
        if (safety.conditionalAvoidRooms.length > 0)
        {
            creep.memory.conditionalAvoidRooms = safety.conditionalAvoidRooms.slice();
        }
        else
        {
            delete creep.memory.conditionalAvoidRooms;
        }
    }
}

function hasViableClaimer(mission)
{
    for (let name in Game.creeps)
    {
        let creep = Game.creeps[name];
        if (!creep || !creep.memory || creep.memory.role != 'claimer')
        {
            continue;
        }
        if (creep.memory.target != mission.target)
        {
            continue;
        }
        if (creep.spawning || creep.ticksToLive == undefined || creep.ticksToLive > CLAIMER_REPLACEMENT_TICKS)
        {
            return true;
        }
    }
    return false;
}

// claimController fails with ERR_GCL_NOT_ENOUGH at the GCL cap, so a claimer
// spawned then would idle and be replaced forever.
function canClaimAnotherRoom()
{
    if (!Game.gcl)
    {
        return true;
    }
    var ownedRooms = 0;
    for (let roomName in Game.rooms)
    {
        let controller = Game.rooms[roomName].controller;
        if (controller && controller.my)
        {
            ownedRooms++;
        }
    }
    return Game.gcl.level > ownedRooms;
}

function getDangerousHostileCount(room)
{
    if (!room)
    {
        return 0;
    }
    var hostiles = room.find(FIND_HOSTILE_CREEPS, {
        filter: function(creep)
        {
            var username = getOwnerName(creep.owner);
            if (isAlly(username))
            {
                return false;
            }
            return creep.getActiveBodyparts(ATTACK) > 0
                || creep.getActiveBodyparts(RANGED_ATTACK) > 0
                || creep.getActiveBodyparts(HEAL) > 0
                || creep.getActiveBodyparts(WORK) > 0
                || creep.getActiveBodyparts(CLAIM) > 0;
        }
    });
    return hostiles.length;
}

function getDepotRangeBounds(depotPos)
{
    return {
        top: Math.max(0, depotPos.y - 1),
        left: Math.max(0, depotPos.x - 1),
        bottom: Math.min(49, depotPos.y + 1),
        right: Math.min(49, depotPos.x + 1)
    };
}

function isDepotEnergyStructure(structure)
{
    return structure
        && (structure.structureType == STRUCTURE_CONTAINER
            || structure.structureType == STRUCTURE_STORAGE);
}

function isDepotContainerSite(site, depotPos)
{
    return site.structureType == STRUCTURE_CONTAINER
        && depotPos
        && site.pos.roomName == depotPos.roomName
        && site.pos.x == depotPos.x
        && site.pos.y == depotPos.y;
}

function countConstructionSites(room, depotPos)
{
    var counts = {
        total: 0,
        spawn: 0,
        tower: 0,
        extension: 0,
        container: 0,
        depotContainer: 0,
        storage: 0
    };
    if (!room)
    {
        return counts;
    }

    var sites = room.find(FIND_CONSTRUCTION_SITES);
    for (let site of sites)
    {
        if (site.my == false)
        {
            continue;
        }
        counts.total++;
        if (site.structureType == STRUCTURE_SPAWN)
        {
            counts.spawn++;
        }
        else if (site.structureType == STRUCTURE_TOWER)
        {
            counts.tower++;
        }
        else if (site.structureType == STRUCTURE_EXTENSION)
        {
            counts.extension++;
        }
        else if (site.structureType == STRUCTURE_CONTAINER)
        {
            counts.container++;
            if (isDepotContainerSite(site, depotPos))
            {
                counts.depotContainer++;
            }
        }
        else if (site.structureType == STRUCTURE_STORAGE)
        {
            counts.storage++;
        }
    }
    return counts;
}

function countMySpawns(room)
{
    if (!room)
    {
        return 0;
    }
    return room.find(FIND_MY_SPAWNS).length;
}

function getDepotEnergy(room, mission)
{
    if (!room || !mission.depotPos || mission.depotPos.roomName != room.name || !room.lookForAtArea)
    {
        return undefined;
    }

    var energy = 0;
    var bounds = getDepotRangeBounds(mission.depotPos);
    var resources = room.lookForAtArea(LOOK_RESOURCES,
        bounds.top,
        bounds.left,
        bounds.bottom,
        bounds.right,
        true);
    for (let item of resources)
    {
        let resource = item.resource || item;
        if (resource.resourceType == RESOURCE_ENERGY)
        {
            energy += resource.amount;
        }
    }

    var structures = room.lookForAtArea(LOOK_STRUCTURES,
        bounds.top,
        bounds.left,
        bounds.bottom,
        bounds.right,
        true);
    for (let item of structures)
    {
        let structure = item.structure || item;
        if (isDepotEnergyStructure(structure))
        {
            energy += getStoredEnergy(structure);
        }
    }
    return energy;
}

function getTargetEnergyState(depotEnergy, mission)
{
    if (depotEnergy == undefined)
    {
        return 'unknown';
    }
    if (depotEnergy < mission.targetEnergyLow)
    {
        return 'low';
    }
    if (depotEnergy >= mission.targetEnergyHigh)
    {
        return 'high';
    }
    return 'buffering';
}

function getRouteRoadProfileKey(spawn, mission)
{
    var depot = mission.depotPos || {};
    return spawn.name + ':' + mission.name + ':' + mission.home + ':' + mission.target
        + ':' + (depot.roomName || '-') + ':' + (depot.x == undefined ? '-' : depot.x)
        + ':' + (depot.y == undefined ? '-' : depot.y);
}

function getHomeRouteStart(spawn)
{
    if (spawn.room.terminal)
    {
        return spawn.room.terminal.pos;
    }
    if (spawn.room.storage)
    {
        return spawn.room.storage.pos;
    }
    return spawn.pos;
}

function isPassableRouteStructure(structure)
{
    if (structure.structureType == STRUCTURE_ROAD || structure.structureType == STRUCTURE_CONTAINER)
    {
        return true;
    }
    if (structure.structureType == STRUCTURE_RAMPART)
    {
        return structure.my || structure.isPublic;
    }
    return false;
}

function getRoadCostMatrix(roomName)
{
    var room = Game.rooms[roomName];
    if (!room)
    {
        return undefined;
    }
    var costs = new PathFinder.CostMatrix();
    var structures = room.find(FIND_STRUCTURES);
    for (let structure of structures)
    {
        if (structure.structureType == STRUCTURE_ROAD)
        {
            costs.set(structure.pos.x, structure.pos.y, 1);
        }
        else if (!isPassableRouteStructure(structure))
        {
            costs.set(structure.pos.x, structure.pos.y, 255);
        }
    }
    return costs;
}

function hasRoadAt(pos)
{
    var room = Game.rooms[pos.roomName];
    if (!room)
    {
        return undefined;
    }
    var structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
    for (let structure of structures)
    {
        if (structure.structureType == STRUCTURE_ROAD)
        {
            return true;
        }
    }
    return false;
}

function getRouteRoadProfile(spawn, mission)
{
    var fallback = {
        bodyProfile: mission.bodyProfileOverride || 'offroad',
        roadCoverage: undefined,
        roadPathLength: 0,
        roadTiles: 0,
        roadUnknownTiles: 0,
        roadProfileUpdated: Game.time,
        roadProfileOverride: !!mission.bodyProfileOverride
    };
    if (mission.bodyProfileOverride || !mission.depotPos)
    {
        return fallback;
    }

    Memory.remoteBuildRoadProfiles = Memory.remoteBuildRoadProfiles || {};
    var key = getRouteRoadProfileKey(spawn, mission);
    var cached = Memory.remoteBuildRoadProfiles[key];
    if (cached
        && cached.threshold == mission.roadCoverageThreshold
        && cached.nextCheck != undefined
        && Game.time < cached.nextCheck)
    {
        return cached;
    }

    var start = getHomeRouteStart(spawn);
    var depotPos = new RoomPosition(mission.depotPos.x, mission.depotPos.y, mission.depotPos.roomName);
    var result = PathFinder.search(start,
        {pos: depotPos, range: 1},
        {
            plainCost: 2,
            swampCost: 10,
            maxRooms: ROAD_PROFILE_MAX_ROOMS,
            maxOps: ROAD_PROFILE_MAX_OPS,
            roomCallback: getRoadCostMatrix
        });

    var roadTiles = 0;
    var knownTiles = 0;
    var unknownTiles = 0;
    for (let pos of result.path)
    {
        let hasRoad = hasRoadAt(pos);
        if (hasRoad == undefined)
        {
            unknownTiles++;
            continue;
        }
        knownTiles++;
        if (hasRoad)
        {
            roadTiles++;
        }
    }

    var roadCoverage = knownTiles > 0 ? Math.round((roadTiles / knownTiles) * 1000) / 1000 : 0;
    var bodyProfile = (!result.incomplete
        && unknownTiles == 0
        && roadCoverage >= mission.roadCoverageThreshold) ? 'roaded' : 'offroad';
    cached = {
        bodyProfile: bodyProfile,
        roadCoverage: roadCoverage,
        roadPathLength: knownTiles,
        roadTiles: roadTiles,
        roadUnknownTiles: unknownTiles,
        roadProfileUpdated: Game.time,
        nextCheck: Game.time + ROAD_PROFILE_CHECK_INTERVAL,
        threshold: mission.roadCoverageThreshold,
        incomplete: result.incomplete == true,
        roadProfileOverride: false
    };
    Memory.remoteBuildRoadProfiles[key] = cached;
    return cached;
}

function getDesiredCarrierCount(mission, status)
{
    if (status.remoteBuildComplete)
    {
        return 0;
    }
    // Remote build lorries/carriers should not spawn before the controller is ours.
    // Before claim, only the claimer is allowed to spend spawn time for the mission.
    if (!status.controllerMy
        || status.dangerousHostiles > 0
        || status.configError
        || !status.missionWorkReady)
    {
        return 0;
    }
    if (mission.maxCarriers != 'auto')
    {
        if (status.depotContainerSites > 0
            && mission.maxBuilders > 0
            && status.remoteBuilderCount <= 0
            && mission.maxCarriers > 1)
        {
            return 1;
        }
        return mission.maxCarriers;
    }
    if (status.depotContainerSites > 0
        && mission.maxBuilders > 0
        && status.remoteBuilderCount <= 0)
    {
        // Stage one carrier, then spawn the first builder so dropped energy
        // gets turned into the depot container instead of waiting on the ground.
        return 1;
    }
    if (status.targetEnergyState == 'high')
    {
        return 1;
    }
    return DEFAULT_MAX_CARRIERS;
}

function getDesiredBuilderCount(mission, status)
{
    if (status.remoteBuildComplete)
    {
        return 0;
    }
    if (!status.controllerMy
        || status.dangerousHostiles > 0
        || status.configError
        || !status.missionWorkReady)
    {
        return 0;
    }
    if (status.targetEnergyState == 'low'
        || status.targetEnergyState == 'unknown')
    {
        if (status.depotContainerSites > 0
            && status.remoteCarrierCount > 0
            && mission.maxBuilders > 0)
        {
            return mission.maxBuilders;
        }
        return 0;
    }
    return mission.maxBuilders;
}

function determinePhase(status)
{
    if (status.blockedReason)
    {
        return 'paused';
    }
    if (!status.homeReady)
    {
        return 'prepare';
    }
    if (!status.targetVisible)
    {
        return 'claimPending';
    }
    if (status.dangerousHostiles > 0)
    {
        return 'pausedHostiles';
    }
    if (!status.controllerMy)
    {
        return 'claimPending';
    }
    if (status.remoteBuildComplete)
    {
        return status.completeReason == 'targetSpawnBuilt'
            ? 'completeSpawnBuilt'
            : 'completeRcl6';
    }
    if (status.configError)
    {
        return 'configError';
    }
    if (!status.missionWorkReady)
    {
        return 'claimedNeedsSpawnSite';
    }
    if (!status.hasSpawn && status.spawnSites > 0)
    {
        return 'firstSpawn';
    }
    if (status.constructionSites > 0)
    {
        return 'bootstrap';
    }
    return 'transition';
}

function getMissionStatus(spawn, mission)
{
    var homeEnergy = getHomeEnergyStatus(spawn.room);
    var homeReady = homeEnergy.terminalEnergy > mission.homeTerminalReserve
        || homeEnergy.storageEnergy > mission.homeStorageReserve;
    var missionRouteSafety = routeSafety.evaluate(mission.avoidRooms, mission.conditionalAvoidRooms);
    var targetRoom = Game.rooms[mission.target];
    var targetVisible = !!targetRoom;
    var controller = targetRoom ? targetRoom.controller : undefined;
    var ownerName = controller ? getOwnerName(controller.owner) : undefined;
    var reservationName = controller && controller.reservation ? getOwnerName(controller.reservation) : undefined;
    var controllerMy = !!(controller && controller.my);
    var controllerLevel = controller ? controller.level : undefined;
    var hasSpawn = countMySpawns(targetRoom) > 0;
    var completedBySpawn = mission.stopCondition == STOP_CONDITION_SPAWN_BUILT && hasSpawn;
    var completedByRcl = mission.stopCondition == DEFAULT_STOP_CONDITION
        && controllerLevel >= REMOTE_BUILD_STOP_RCL;
    var remoteBuildComplete = controllerMy && (completedBySpawn || completedByRcl);
    var completeReason = remoteBuildComplete
        ? (completedBySpawn ? 'targetSpawnBuilt' : 'targetRcl' + REMOTE_BUILD_STOP_RCL)
        : undefined;
    var blockedReason = undefined;

    if (ownerName && spawn.owner && ownerName != spawn.owner.username)
    {
        blockedReason = 'owned:' + ownerName;
    }
    else if (reservationName && spawn.owner && reservationName != spawn.owner.username)
    {
        blockedReason = 'reserved:' + reservationName;
    }

    var siteCounts = countConstructionSites(targetRoom, mission.depotPos);
    var depotEnergy = getDepotEnergy(targetRoom, mission);
    var roadProfile = getRouteRoadProfile(spawn, mission);
    var missionWorkReady = hasSpawn || siteCounts.spawn > 0 || siteCounts.depotContainer > 0;
    var configError = mission.depotPos ? undefined : (mission.depotConfigError || 'missingDepotPos');
    var status = {
        name: mission.name,
        home: mission.home,
        target: mission.target,
        mode: mission.mode,
        stopCondition: mission.stopCondition,
        active: mission.active,
        targetVisible: targetVisible,
        controllerMy: controllerMy,
        controllerLevel: controllerLevel,
        remoteBuildComplete: remoteBuildComplete,
        completeReason: completeReason,
        controllerOwner: ownerName,
        controllerReservation: reservationName,
        blockedReason: blockedReason,
        dangerousHostiles: getDangerousHostileCount(targetRoom),
        homeTerminalEnergy: homeEnergy.terminalEnergy,
        homeStorageEnergy: homeEnergy.storageEnergy,
        homeReady: homeReady,
        configError: configError,
        missionWorkReady: missionWorkReady,
        depotEnergy: depotEnergy,
        targetEnergyState: getTargetEnergyState(depotEnergy, mission),
        bodyProfile: roadProfile.bodyProfile,
        roadCoverage: roadProfile.roadCoverage,
        roadCoverageThreshold: mission.roadCoverageThreshold,
        roadPathLength: roadProfile.roadPathLength,
        roadTiles: roadProfile.roadTiles,
        roadUnknownTiles: roadProfile.roadUnknownTiles,
        roadProfileUpdated: roadProfile.roadProfileUpdated,
        roadProfileOverride: roadProfile.roadProfileOverride,
        hasSpawn: hasSpawn,
        constructionSites: siteCounts.total,
        spawnSites: siteCounts.spawn,
        towerSites: siteCounts.tower,
        extensionSites: siteCounts.extension,
        containerSites: siteCounts.container,
        depotContainerSites: siteCounts.depotContainer,
        storageSites: siteCounts.storage,
        claimerCount: countMissionCreeps('claimer', mission),
        remoteBuilderCount: countMissionCreeps('remoteBuilder', mission),
        remoteCarrierCount: countMissionCreeps('remoteCarrier', mission),
        avoidRooms: mission.avoidRooms,
        conditionalAvoidRooms: missionRouteSafety.conditionalAvoidRooms,
        activeAvoidRooms: missionRouteSafety.activeAvoidRooms,
        routeRoomSafety: missionRouteSafety.rooms,
        depotPos: mission.depotPos,
        depotSource: mission.depotSource,
        depotFlag: mission.depotFlag,
        depotFlagCount: mission.depotFlagCount,
        updated: Game.time
    };

    syncMissionCreepRouteSafety(mission, missionRouteSafety);
    status.phase = determinePhase(status);
    status.needsClaimer = homeReady
        && !blockedReason
        && status.dangerousHostiles == 0
        && !controllerMy
        && !remoteBuildComplete
        && !hasViableClaimer(mission)
        && canClaimAnotherRoom();
    status.desiredCarriers = getDesiredCarrierCount(mission, status);
    status.desiredBuilders = getDesiredBuilderCount(mission, status);
    status.needsCarrier = homeReady
        && !blockedReason
        && status.dangerousHostiles == 0
        && !status.configError
        && status.missionWorkReady
        && controllerMy
        && !status.remoteBuildComplete
        && status.remoteCarrierCount < status.desiredCarriers;
    status.needsBuilder = homeReady
        && !blockedReason
        && status.dangerousHostiles == 0
        && !status.configError
        && status.missionWorkReady
        && controllerMy
        && !status.remoteBuildComplete
        && status.remoteBuilderCount < status.desiredBuilders;
    return status;
}

function compactStatus(status)
{
    return {
        phase: status.phase,
        home: status.home,
        target: status.target,
        stopCondition: status.stopCondition,
        targetVisible: status.targetVisible,
        controllerMy: status.controllerMy,
        controllerLevel: status.controllerLevel,
        remoteBuildComplete: status.remoteBuildComplete,
        completeReason: status.completeReason,
        blockedReason: status.blockedReason,
        dangerousHostiles: status.dangerousHostiles,
        avoidRooms: status.avoidRooms,
        conditionalAvoidRooms: status.conditionalAvoidRooms,
        activeAvoidRooms: status.activeAvoidRooms,
        routeRoomSafety: status.routeRoomSafety,
        homeReady: status.homeReady,
        homeTerminalEnergy: status.homeTerminalEnergy,
        homeStorageEnergy: status.homeStorageEnergy,
        configError: status.configError,
        missionWorkReady: status.missionWorkReady,
        targetEnergyState: status.targetEnergyState,
        depotEnergy: status.depotEnergy,
        bodyProfile: status.bodyProfile,
        roadCoverage: status.roadCoverage,
        roadCoverageThreshold: status.roadCoverageThreshold,
        roadPathLength: status.roadPathLength,
        roadTiles: status.roadTiles,
        roadUnknownTiles: status.roadUnknownTiles,
        roadProfileUpdated: status.roadProfileUpdated,
        roadProfileOverride: status.roadProfileOverride,
        depotPos: status.depotPos,
        depotSource: status.depotSource,
        depotFlag: status.depotFlag,
        depotFlagCount: status.depotFlagCount,
        hasSpawn: status.hasSpawn,
        constructionSites: status.constructionSites,
        spawnSites: status.spawnSites,
        depotContainerSites: status.depotContainerSites,
        claimerCount: status.claimerCount,
        remoteCarrierCount: status.remoteCarrierCount,
        remoteBuilderCount: status.remoteBuilderCount,
        desiredCarriers: status.desiredCarriers,
        desiredBuilders: status.desiredBuilders,
        needsClaimer: status.needsClaimer,
        needsCarrier: status.needsCarrier,
        needsBuilder: status.needsBuilder,
        updated: status.updated
    };
}

function writeStatusMemory(spawn, statuses)
{
    Memory.remoteBuildMissionStatus = Memory.remoteBuildMissionStatus || {};

    var activeNames = {};
    for (let status of statuses)
    {
        activeNames[status.name] = true;
    }

    for (let name in Memory.remoteBuildMissionStatus)
    {
        let remembered = Memory.remoteBuildMissionStatus[name];
        if (remembered && remembered.home == spawn.room.name && !activeNames[name])
        {
            delete Memory.remoteBuildMissionStatus[name];
        }
    }

    if (statuses.length <= 0)
    {
        delete spawn.memory.remoteBuildMissionStatus;
        delete spawn.memory.remoteBuildMissionCount;
        if (Object.keys(Memory.remoteBuildMissionStatus).length <= 0)
        {
            delete Memory.remoteBuildMissionStatus;
        }
        return;
    }

    spawn.memory.remoteBuildMissionStatus = {};
    spawn.memory.remoteBuildMissionCount = statuses.length;

    for (let status of statuses)
    {
        let compact = compactStatus(status);
        spawn.memory.remoteBuildMissionStatus[status.name] = compact;
        Memory.remoteBuildMissionStatus[status.name] = compact;
    }
}

function pruneRoadProfiles()
{
    if (!Memory.remoteBuildRoadProfiles || Game.time % 500 != 0)
    {
        return;
    }
    // Live profiles are refreshed every ROAD_PROFILE_CHECK_INTERVAL ticks;
    // anything older belongs to a removed mission, moved depot or old spawn key.
    for (let key in Memory.remoteBuildRoadProfiles)
    {
        let entry = Memory.remoteBuildRoadProfiles[key];
        if (!entry
            || entry.nextCheck == undefined
            || Game.time - entry.nextCheck > 2 * ROAD_PROFILE_CHECK_INTERVAL)
        {
            delete Memory.remoteBuildRoadProfiles[key];
        }
    }
}

function getSpawnPlan(spawn)
{
    // Every spawn in a room gets the same missions and status, so evaluate once
    // per room per tick. main.js still guards same-tick duplicate spawns.
    if (spawnPlanCache.tick != Game.time)
    {
        spawnPlanCache = {tick: Game.time, byRoom: {}};
    }
    if (spawnPlanCache.byRoom[spawn.room.name])
    {
        delete spawn.memory.remoteBuildMissionStatus;
        delete spawn.memory.remoteBuildMissionCount;
        return spawnPlanCache.byRoom[spawn.room.name];
    }

    var missions = getConfiguredMissions(spawn);
    var conditionalRooms = [];
    for (let mission of missions)
    {
        for (let roomName of mission.conditionalAvoidRooms)
        {
            if (conditionalRooms.indexOf(roomName) < 0)
            {
                conditionalRooms.push(roomName);
            }
        }
    }
    routeSafety.observeRooms(spawn.room, conditionalRooms);

    var statuses = [];
    var plan = {
        missions: missions,
        statuses: statuses,
        claimerRequest: undefined,
        carrierRequest: undefined,
        builderRequest: undefined
    };

    for (let mission of missions)
    {
        let status = getMissionStatus(spawn, mission);
        statuses.push(status);
        // Retire a finished mission once its creeps have converted or died, so it
        // stops being evaluated every tick. Waiting for a spawn keeps first-spawn
        // placement alive for an RCL6 completion without one.
        if (status.remoteBuildComplete
            && status.hasSpawn
            && mission.raw
            && status.claimerCount == 0
            && status.remoteCarrierCount == 0
            && status.remoteBuilderCount == 0)
        {
            mission.raw.active = false;
            mission.raw.completedAt = Game.time;
        }
        if (!plan.claimerRequest && status.needsClaimer)
        {
            plan.claimerRequest = {
                mission: mission.name,
                home: mission.home,
                target: mission.target,
                phase: status.phase,
                avoidRooms: status.activeAvoidRooms,
                conditionalAvoidRooms: status.conditionalAvoidRooms,
                reason: 'claimPending'
            };
        }
        if (!plan.carrierRequest && status.needsCarrier)
        {
            plan.carrierRequest = {
                mission: mission.name,
                home: mission.home,
                target: mission.target,
                phase: status.phase,
                targetEnergyState: status.targetEnergyState,
                bodyProfile: status.bodyProfile,
                roadCoverage: status.roadCoverage,
                desiredCarriers: status.desiredCarriers,
                depotEnergy: status.depotEnergy,
                depotPos: mission.depotPos,
                // Snapshot evaluated routing safety so a new carrier avoids a
                // conditional room that has recently been observed unsafe.
                avoidRooms: status.activeAvoidRooms,
                conditionalAvoidRooms: status.conditionalAvoidRooms,
                homeTerminalReserve: mission.homeTerminalReserve,
                homeStorageReserve: mission.homeStorageReserve,
                targetEnergyLow: mission.targetEnergyLow,
                targetEnergyHigh: mission.targetEnergyHigh,
                reason: status.targetEnergyState == 'high' ? 'maintainBuffer' : 'buildEnergyImport'
            };
        }
        if (!plan.builderRequest && status.needsBuilder)
        {
            plan.builderRequest = {
                mission: mission.name,
                home: mission.home,
                target: mission.target,
                phase: status.phase,
                targetEnergyState: status.targetEnergyState,
                bodyProfile: status.bodyProfile,
                roadCoverage: status.roadCoverage,
                desiredBuilders: status.desiredBuilders,
                depotEnergy: status.depotEnergy,
                depotPos: mission.depotPos,
                // Builders need the same first-tick route protection as
                // carriers; existing creeps are synchronized above.
                avoidRooms: status.activeAvoidRooms,
                conditionalAvoidRooms: status.conditionalAvoidRooms,
                homeTerminalReserve: mission.homeTerminalReserve,
                homeStorageReserve: mission.homeStorageReserve,
                targetEnergyLow: mission.targetEnergyLow,
                targetEnergyHigh: mission.targetEnergyHigh,
                reason: 'spendImportedEnergy'
            };
        }
    }

    writeStatusMemory(spawn, statuses);
    pruneRoadProfiles();
    spawnPlanCache.byRoom[spawn.room.name] = plan;
    return plan;
}

module.exports = {
    getSpawnPlan: getSpawnPlan,
    getConfiguredMissions: getConfiguredMissions,
    getMissionStatus: getMissionStatus
};
