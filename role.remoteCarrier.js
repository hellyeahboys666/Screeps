var remoteDanger = require('remote.danger');
var depotUtils = require('remote.build.depot');

var DEFAULT_HOME_TERMINAL_RESERVE = 20000;
var DEFAULT_HOME_STORAGE_RESERVE = 30000;
var LARGE_ROUTE_DROP_MIN_ENERGY = 300;
var LARGE_ROUTE_DROP_PICKUP_RANGE = 5;

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

function getStoreFreeEnergy(target)
{
    if (!target || !target.store)
    {
        return 0;
    }
    return target.store.getFreeCapacity(RESOURCE_ENERGY) || 0;
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
}

function retireCompletedRemoteCarrier(creep)
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
    creep.memory.role = 'lorry';
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
    if (creep.fatigue > 0)
    {
        return false;
    }
    if (creep.pos.y == 0)
    {
        return creep.move(BOTTOM) == OK;
    }
    if (creep.pos.y == 49)
    {
        return creep.move(TOP) == OK;
    }
    if (creep.pos.x == 0)
    {
        return creep.move(RIGHT) == OK;
    }
    if (creep.pos.x == 49)
    {
        return creep.move(LEFT) == OK;
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

function getDepotStructure(creep, depotPos)
{
    var flaggedStorage = depotUtils.getFlaggedDepotStorage(depotPos);
    if (flaggedStorage && getStoreFreeEnergy(flaggedStorage) > 0)
    {
        return flaggedStorage;
    }

    var structures = depotPos.findInRange(FIND_STRUCTURES, 1,
    {
        filter: function(structure)
        {
            return (structure.structureType == STRUCTURE_CONTAINER
                || structure.structureType == STRUCTURE_STORAGE)
                && getStoreFreeEnergy(structure) > 0;
        }
    });
    return creep.pos.findClosestByRange(structures) || structures[0];
}

function transferToAdjacentBuilder(creep)
{
    var builders = creep.pos.findInRange(FIND_MY_CREEPS, 1,
    {
        filter: function(other)
        {
            return other.memory
                && other.memory.role == 'remoteBuilder'
                && other.memory.target == creep.memory.target
                && (other.memory.remoteBuildMission == creep.memory.remoteBuildMission
                    || !creep.memory.remoteBuildMission)
                && other.store
                && other.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
        }
    });
    if (builders.length <= 0)
    {
        return false;
    }
    return creep.transfer(builders[0], RESOURCE_ENERGY) == OK;
}

function getLargestNearbyRouteDrop(creep)
{
    if (getFreeEnergy(creep) <= 0)
    {
        return undefined;
    }
    if (creep.memory.empty == true && creep.room.name == creep.memory.home)
    {
        return undefined;
    }
    if (remoteDanger.shouldRetreat(creep) || shouldPauseBeforeTarget(creep))
    {
        return undefined;
    }

    var drops = creep.pos.findInRange(FIND_DROPPED_RESOURCES, LARGE_ROUTE_DROP_PICKUP_RANGE,
    {
        filter: function(resource)
        {
            return resource.resourceType == RESOURCE_ENERGY
                && resource.amount >= LARGE_ROUTE_DROP_MIN_ENERGY
                // Depot drops are intentional remote-build supply. Builders
                // consume them; carriers must not pick them back up and re-drop
                // them in place forever when the depot container is full.
                && !depotUtils.isRemoteBuildDepotDroppedEnergy(resource);
        }
    });
    var best = undefined;
    for (let drop of drops)
    {
        if (!best
            || drop.amount > best.amount
            || (drop.amount == best.amount && creep.pos.getRangeTo(drop) < creep.pos.getRangeTo(best)))
        {
            best = drop;
        }
    }
    return best;
}

function pickupLargeRouteDrop(creep)
{
    var drop = getLargestNearbyRouteDrop(creep);
    if (!drop)
    {
        return false;
    }

    var result = creep.pickup(drop);
    if (result == ERR_NOT_IN_RANGE)
    {
        creep.moveTo(drop, {reusePath: 3});
        return true;
    }
    if (result == OK)
    {
        // A dead remote-build carrier can leave a full load on the route.
        // Once any carrier recovers dropped energy, treat it as a delivery run.
        creep.memory.empty = false;
        return true;
    }
    return false;
}

function deliverEnergy(creep)
{
    if (transferToAdjacentBuilder(creep))
    {
        return true;
    }

    var depotPos = getDepotPos(creep);
    if (!depotPos)
    {
        creep.say('no depot');
        return false;
    }

    var depot = getDepotStructure(creep, depotPos);
    if (depot)
    {
        var result = creep.transfer(depot, RESOURCE_ENERGY);
        if (result == ERR_NOT_IN_RANGE)
        {
            creep.moveTo(depot, {range: 1, reusePath: 10});
            return true;
        }
        return result == OK;
    }

    if (!creep.pos.isEqualTo(depotPos))
    {
        creep.moveTo(depotPos, {reusePath: 10});
        return true;
    }
    return creep.drop(RESOURCE_ENERGY) == OK;
}

var roleRemoteCarrier = {
    /** @param {Creep} creep **/
    run: function(creep) {
        if (!creep.memory.home || !creep.memory.target)
        {
            return;
        }

        if (isRemoteBuildComplete(creep))
        {
            retireCompletedRemoteCarrier(creep);
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

        if (creep.memory.empty == true)
        {
            if (pickupLargeRouteDrop(creep))
            {
                return;
            }
            if (creep.room.name != creep.memory.home)
            {
                moveToRoom(creep, creep.memory.home);
                return;
            }
            if (moveOffRoomEdge(creep))
            {
                return;
            }
            if (withdrawHomeEnergy(creep))
            {
                return;
            }
            if (getUsedEnergy(creep) > 0)
            {
                creep.memory.empty = false;
            }
            else
            {
                creep.say('reserve');
                return;
            }
        }

        if (pickupLargeRouteDrop(creep))
        {
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

        if (creep.room.name != creep.memory.target)
        {
            moveToRoom(creep, creep.memory.target);
            return;
        }

        if (remoteDanger.shouldRetreat(creep)
            || !creep.room.controller
            || !creep.room.controller.my)
        {
            moveToRoom(creep, creep.memory.home);
            return;
        }

        if (moveOffRoomEdge(creep))
        {
            return;
        }

        deliverEnergy(creep);
    }
};

module.exports = roleRemoteCarrier;
