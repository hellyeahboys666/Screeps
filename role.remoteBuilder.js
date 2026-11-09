var remoteDanger = require('remote.danger');
var depotUtils = require('remote.build.depot');

var DEFAULT_HOME_TERMINAL_RESERVE = 20000;
var DEFAULT_HOME_STORAGE_RESERVE = 30000;
var CONTROLLER_DOWNGRADE_SAFETY_TICKS = 5000;

function getUsedEnergy(creep)
{
    if (creep.store)
    {
        return creep.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
    }
    return creep.carry.energy || 0;
}

function getFreeEnergy(creep)
{
    if (creep.store)
    {
        return creep.store.getFreeCapacity(RESOURCE_ENERGY) || 0;
    }
    return creep.carryCapacity - (creep.carry.energy || 0);
}

function getStoredEnergy(target)
{
    if (!target || !target.store)
    {
        return 0;
    }
    return target.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
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

function getMissionConfig(creep)
{
    var config = {
        homeTerminalReserve: DEFAULT_HOME_TERMINAL_RESERVE,
        homeStorageReserve: DEFAULT_HOME_STORAGE_RESERVE
    };
    var missions = Memory.remoteBuildMissions;
    if (!missions)
    {
        return config;
    }

    function matches(key, raw)
    {
        if (!raw)
        {
            return false;
        }
        var rawTarget = raw.target || raw.targetRoom
            || (/^[WE][0-9]+[NS][0-9]+$/.test(key) ? key : undefined);
        var nameMatches = key == creep.memory.remoteBuildMission
            || raw.name == creep.memory.remoteBuildMission;
        var targetMatches = creep.memory.target
            && rawTarget == creep.memory.target;
        return nameMatches ? (!creep.memory.target || targetMatches) : targetMatches;
    }

    var raw = undefined;
    if (Array.isArray(missions))
    {
        for (var i = 0; i < missions.length; i++)
        {
            if (matches(String(i), missions[i]))
            {
                raw = missions[i];
                break;
            }
        }
    }
    else
    {
        for (let key in missions)
        {
            if (matches(key, missions[key]))
            {
                raw = missions[key];
                break;
            }
        }
    }

    if (raw)
    {
        if (typeof raw.homeTerminalReserve == 'number')
        {
            config.homeTerminalReserve = raw.homeTerminalReserve;
        }
        if (typeof raw.homeStorageReserve == 'number')
        {
            config.homeStorageReserve = raw.homeStorageReserve;
        }
    }
    return config;
}

function statusMatchesCreep(status, creep)
{
    return status
        && (!status.home || !creep.memory.home || status.home == creep.memory.home)
        && (!status.target || !creep.memory.target || status.target == creep.memory.target);
}

function getMissionStatus(creep)
{
    var statuses = Memory.remoteBuildMissionStatus;
    if (!statuses)
    {
        return undefined;
    }
    var missionName = creep.memory.remoteBuildMission || creep.memory.mission || creep.memory.missionName;
    if (missionName && statuses[missionName] && statusMatchesCreep(statuses[missionName], creep))
    {
        return statuses[missionName];
    }
    if (creep.memory.target && statuses[creep.memory.target] && statusMatchesCreep(statuses[creep.memory.target], creep))
    {
        return statuses[creep.memory.target];
    }
    return undefined;
}

function shouldPauseBeforeTarget(creep)
{
    var status = getMissionStatus(creep);
    return status
        && creep.room.name != creep.memory.target
        && (status.blockedReason
            || status.dangerousHostiles > 0
            || status.controllerMy == false);
}

function isRemoteBuildComplete(creep)
{
    var status = getMissionStatus(creep);
    return status && status.remoteBuildComplete == true;
}

function getCompletionSay(creep)
{
    var status = getMissionStatus(creep);
    return status && status.completeReason == 'targetSpawnBuilt' ? 'spawn' : 'rcl6';
}

function clearRemoteBuildMemory(creep)
{
    delete creep.memory.target;
    delete creep.memory.remoteBuildMission;
    delete creep.memory.mission;
    delete creep.memory.missionName;
    delete creep.memory.depotPos;
    delete creep.memory.depotFlag;
    delete creep.memory.avoidRooms;
    delete creep.memory.conditionalAvoidRooms;
    delete creep.memory._exitCache;
    delete creep.memory.buildTargetId;
    delete creep.memory.buildTargetUntil;
    delete creep.memory.lastDitch;
}

function retireCompletedRemoteBuilder(creep)
{
    if (creep.room.name != creep.memory.home)
    {
        moveToRoom(creep, creep.memory.home);
        return true;
    }
    if (moveOffRoomEdge(creep))
    {
        return true;
    }
    creep.memory.role = 'builder';
    creep.memory.empty = getUsedEnergy(creep) <= 0;
    var completionSay = getCompletionSay(creep);
    clearRemoteBuildMemory(creep);
    creep.say(completionSay);
    return true;
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

function moveOffRoomEdge(creep)
{
    if (creep.pos.x == 0)
    {
        creep.move(RIGHT);
        return true;
    }
    if (creep.pos.x == 49)
    {
        creep.move(LEFT);
        return true;
    }
    if (creep.pos.y == 0)
    {
        creep.move(BOTTOM);
        return true;
    }
    if (creep.pos.y == 49)
    {
        creep.move(TOP);
        return true;
    }
    return false;
}

function moveToRoom(creep, roomName)
{
    if (!roomName || creep.room.name == roomName)
    {
        return;
    }

    var exit = undefined;
    var avoidRooms = getAvoidRooms(creep);
    if (avoidRooms.length > 0)
    {
        // Only the first exit is used, so route once per room instead of per tick.
        var routeKey = creep.room.name + '>' + roomName + '|' + avoidRooms.join(',');
        var cachedExit = creep.memory._exitCache;
        if (cachedExit && cachedExit.key == routeKey)
        {
            exit = cachedExit.exit;
        }
        else
        {
            var route = Game.map.findRoute(creep.room.name, roomName,
            {
                routeCallback: function(nextRoomName)
                {
                    if (avoidRooms.indexOf(nextRoomName) >= 0)
                    {
                        return Infinity;
                    }
                    return 1;
                }
            });
            if (!Array.isArray(route) || route.length <= 0)
            {
                creep.say('no route');
                return;
            }
            exit = route[0].exit;
            creep.memory._exitCache = {key: routeKey, exit: exit};
        }
    }
    else
    {
        exit = creep.room.findExitTo(roomName);
    }

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
            creep.moveTo(exitPos, {reusePath: 20});
        }
    }
}

function getHomeEnergySource(creep)
{
    var config = getMissionConfig(creep);
    if (creep.room.terminal)
    {
        var terminalAvailable = getStoredEnergy(creep.room.terminal) - config.homeTerminalReserve;
        if (terminalAvailable > 0)
        {
            return {structure: creep.room.terminal, amount: terminalAvailable};
        }
    }
    if (creep.room.storage)
    {
        var storageAvailable = getStoredEnergy(creep.room.storage) - config.homeStorageReserve;
        if (storageAvailable > 0)
        {
            return {structure: creep.room.storage, amount: storageAvailable};
        }
    }
    return undefined;
}

function withdrawHomeEnergy(creep)
{
    var source = getHomeEnergySource(creep);
    if (!source)
    {
        return false;
    }
    var amount = Math.min(getFreeEnergy(creep), source.amount);
    if (amount <= 0)
    {
        return false;
    }
    var result = creep.withdraw(source.structure, RESOURCE_ENERGY, amount);
    if (result == ERR_NOT_IN_RANGE)
    {
        creep.moveTo(source.structure, {reusePath: 10});
        return true;
    }
    return result == OK;
}

function getDepotPos(creep)
{
    var depot = depotUtils.resolveCreepDepotPosition(creep);
    if (!depot.pos)
    {
        return undefined;
    }
    creep.memory.depotPos = {
        x: depot.pos.x,
        y: depot.pos.y,
        roomName: depot.pos.roomName
    };
    if (depot.flagName)
    {
        creep.memory.depotFlag = depot.flagName;
    }
    return new RoomPosition(depot.pos.x, depot.pos.y, depot.pos.roomName);
}

function getDepotEnergyStructure(creep, depotPos)
{
    if (!depotPos)
    {
        return undefined;
    }

    var flaggedStorage = depotUtils.getFlaggedDepotStorage(depotPos);
    if (flaggedStorage && getStoredEnergy(flaggedStorage) > 0)
    {
        return flaggedStorage;
    }

    var structures = depotPos.findInRange(FIND_STRUCTURES, 1,
    {
        filter: function(structure)
        {
            return (structure.structureType == STRUCTURE_CONTAINER
                || structure.structureType == STRUCTURE_STORAGE)
                && getStoredEnergy(structure) > 0;
        }
    });
    return creep.pos.findClosestByRange(structures) || structures[0];
}

function getDepotDroppedEnergy(creep, depotPos)
{
    if (!depotPos)
    {
        return undefined;
    }
    var resources = depotPos.findInRange(FIND_DROPPED_RESOURCES, 1,
    {
        filter: function(resource)
        {
            return resource.resourceType == RESOURCE_ENERGY && resource.amount > 0;
        }
    });
    return creep.pos.findClosestByRange(resources) || resources[0];
}

function refillFromDepot(creep)
{
    var depotPos = getDepotPos(creep);
    if (!depotPos)
    {
        creep.say('no depot');
        return false;
    }

    var drop = getDepotDroppedEnergy(creep, depotPos);
    if (drop)
    {
        // Pick up decaying depot energy first, including energy dropped on top
        // of the depot container, before withdrawing stored container energy.
        var pickupResult = creep.pickup(drop);
        if (pickupResult == ERR_NOT_IN_RANGE)
        {
            creep.moveTo(drop, {reusePath: 10});
            return true;
        }
        return pickupResult == OK;
    }

    var structure = getDepotEnergyStructure(creep, depotPos);
    if (structure)
    {
        var withdrawResult = creep.withdraw(structure, RESOURCE_ENERGY);
        if (withdrawResult == ERR_NOT_IN_RANGE)
        {
            creep.moveTo(structure, {reusePath: 10});
            return true;
        }
        return withdrawResult == OK;
    }
    return false;
}

function harvestLastDitch(creep)
{
    var source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (!source)
    {
        return false;
    }
    var result = creep.harvest(source);
    if (result == ERR_NOT_IN_RANGE)
    {
        creep.moveTo(source, {reusePath: 10});
        return true;
    }
    return result == OK;
}

function isNearSource(site, sources)
{
    for (let source of sources)
    {
        if (site.pos.inRangeTo(source.pos, 1))
        {
            return true;
        }
    }
    return false;
}

function isDepotContainerSite(site, depotPos)
{
    return site.structureType == STRUCTURE_CONTAINER
        && depotPos
        && site.pos.isEqualTo(depotPos);
}

function getConstructionPriority(site, depotPos, sources, criticalOnly)
{
    if (isDepotContainerSite(site, depotPos))
    {
        return 1;
    }
    if (site.structureType == STRUCTURE_SPAWN)
    {
        return 2;
    }
    if (site.structureType == STRUCTURE_TOWER)
    {
        return 3;
    }
    if (site.structureType == STRUCTURE_EXTENSION)
    {
        return 4;
    }
    if (site.structureType == STRUCTURE_CONTAINER && isNearSource(site, sources))
    {
        return 5;
    }
    if ((site.structureType == STRUCTURE_CONTAINER || site.structureType == STRUCTURE_STORAGE)
        && depotPos
        && site.pos.inRangeTo(depotPos, 1))
    {
        return 6;
    }
    if (site.structureType == STRUCTURE_ROAD)
    {
        // Manual road sites are useful remote-build logistics work after the
        // critical spawn/depot/source setup, so do not hide them during the
        // post-spawn upgrade-preference phase.
        return 7;
    }
    if (criticalOnly)
    {
        return undefined;
    }
    if (site.structureType == STRUCTURE_STORAGE)
    {
        return 8;
    }
    if (site.structureType == STRUCTURE_TERMINAL)
    {
        return 9;
    }
    return 10;
}

function countMyStructures(room, structureType)
{
    return room.find(FIND_MY_STRUCTURES,
    {
        filter: function(structure)
        {
            return structure.structureType == structureType;
        }
    }).length;
}

function shouldPreferUpgrade(room, sites, depotPos, sources)
{
    if (!room.controller || !room.controller.my || countMyStructures(room, STRUCTURE_SPAWN) <= 0)
    {
        return false;
    }
    for (let site of sites)
    {
        if (getConstructionPriority(site, depotPos, sources, true) != undefined)
        {
            return false;
        }
    }
    return true;
}

function findBuildTarget(creep)
{
    var depotPos = getDepotPos(creep);
    var sites = creep.room.find(FIND_CONSTRUCTION_SITES);
    var sources = creep.room.find(FIND_SOURCES);
    var criticalOnly = shouldPreferUpgrade(creep.room, sites, depotPos, sources);
    var bestPriority = undefined;
    var candidates = [];

    for (let site of sites)
    {
        let priority = getConstructionPriority(site, depotPos, sources, criticalOnly);
        if (priority == undefined)
        {
            continue;
        }
        if (bestPriority == undefined || priority < bestPriority)
        {
            bestPriority = priority;
            candidates = [site];
        }
        else if (priority == bestPriority)
        {
            candidates.push(site);
        }
    }

    if (candidates.length <= 0)
    {
        return undefined;
    }
    return creep.pos.findClosestByPath(candidates, {range: 3})
        || creep.pos.findClosestByRange(candidates)
        || candidates[0];
}

function shouldEmergencyUpgrade(creep)
{
    return creep.room.controller
        && creep.room.controller.my
        && creep.room.controller.ticksToDowngrade != undefined
        && creep.room.controller.ticksToDowngrade < CONTROLLER_DOWNGRADE_SAFETY_TICKS;
}

function upgradeController(creep)
{
    if (!creep.room.controller || !creep.room.controller.my)
    {
        return false;
    }
    var result = creep.upgradeController(creep.room.controller);
    if (result == ERR_NOT_IN_RANGE)
    {
        creep.moveTo(creep.room.controller, {range: 3, reusePath: 10});
        return true;
    }
    return result == OK;
}

function buildOrUpgrade(creep)
{
    if (shouldEmergencyUpgrade(creep))
    {
        upgradeController(creep);
        return;
    }

    // Re-rank sites every 20 ticks instead of path-searching on every build tick.
    var target = creep.memory.buildTargetId ? Game.getObjectById(creep.memory.buildTargetId) : null;
    if (!target || (creep.memory.buildTargetUntil || 0) < Game.time)
    {
        target = findBuildTarget(creep);
        creep.memory.buildTargetId = target ? target.id : undefined;
        creep.memory.buildTargetUntil = Game.time + 20;
    }
    if (target)
    {
        var result = creep.build(target);
        if (result == ERR_NOT_IN_RANGE)
        {
            creep.moveTo(target, {range: 3, reusePath: 10});
        }
        return;
    }

    upgradeController(creep);
}

var roleRemoteBuilder = {
    /** @param {Creep} creep **/
    run: function(creep) {
        if (!creep.memory.home || !creep.memory.target)
        {
            return;
        }

        if (isRemoteBuildComplete(creep))
        {
            retireCompletedRemoteBuilder(creep);
            return;
        }

        var used = getUsedEnergy(creep);
        if (used == 0)
        {
            creep.memory.empty = true;
        }
        else if (getFreeEnergy(creep) == 0)
        {
            creep.memory.empty = false;
        }

        if (creep.room.name == creep.memory.target
            && (remoteDanger.shouldRetreat(creep)
                || !creep.room.controller
                || !creep.room.controller.my))
        {
            moveToRoom(creep, creep.memory.home);
            return;
        }

        if (shouldPauseBeforeTarget(creep))
        {
            if (creep.room.name != creep.memory.home)
            {
                moveToRoom(creep, creep.memory.home);
            }
            else if (!moveOffRoomEdge(creep))
            {
                creep.say('pause');
            }
            return;
        }

        if (creep.room.name == creep.memory.target && moveOffRoomEdge(creep))
        {
            return;
        }

        if (creep.memory.empty == true)
        {
            if (creep.room.name == creep.memory.home)
            {
                if (withdrawHomeEnergy(creep))
                {
                    return;
                }
                if (getUsedEnergy(creep) <= 0)
                {
                    if (!moveOffRoomEdge(creep))
                    {
                        creep.say('reserve');
                    }
                    return;
                }
                creep.memory.empty = false;
            }
            else if (creep.room.name != creep.memory.target)
            {
                moveToRoom(creep, creep.memory.home);
                return;
            }
            else
            {
                if (refillFromDepot(creep))
                {
                    delete creep.memory.lastDitch;
                    return;
                }
                // Keep harvesting until full; one harvest tick is too little
                // energy to justify walking to the build site.
                if (getUsedEnergy(creep) <= 0 || creep.memory.lastDitch)
                {
                    creep.memory.lastDitch = harvestLastDitch(creep);
                    if (creep.memory.lastDitch || getUsedEnergy(creep) <= 0)
                    {
                        return;
                    }
                }
                delete creep.memory.lastDitch;
                creep.memory.empty = false;
            }
        }

        if (creep.room.name != creep.memory.target)
        {
            moveToRoom(creep, creep.memory.target);
            return;
        }

        buildOrUpgrade(creep);
    }
};

module.exports = roleRemoteBuilder;
