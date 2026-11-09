var energyFallback = require('energy.fallback');
var energyReserve = require('energy.reserve');
var remoteDanger = require('remote.danger');
var depotUtils = require('remote.build.depot');
var LAB_PRE_CONTROLLER_ENERGY = 1000;
// Keep aligned with TOWER_MAINTENANCE_ENERGY_RESERVE in main.js and role.lorry.js.
var TOWER_MAINTENANCE_ENERGY_RESERVE = 600;

function getUsedEnergy(creep)
{
    if (creep.store)
    {
        return creep.store.getUsedCapacity(RESOURCE_ENERGY);
    }
    return creep.carry.energy;
}

function getFreeEnergy(creep)
{
    if (creep.store)
    {
        return creep.store.getFreeCapacity(RESOURCE_ENERGY);
    }
    return creep.carryCapacity - creep.carry.energy;
}

var REMOTE_DANGER_RETREAT_TICKS = 50;

function startRemoteDangerRetreat(creep)
{
    creep.memory.remoteDangerRetreatRoom = creep.memory.target;
    creep.memory.remoteDangerRetreatUntil = Game.time + REMOTE_DANGER_RETREAT_TICKS;
}

function clearRemoteDangerRetreat(creep)
{
    delete creep.memory.remoteDangerRetreatRoom;
    delete creep.memory.remoteDangerRetreatUntil;
}

function shouldContinueRemoteDangerRetreat(creep)
{
    if (!creep.memory.remoteDangerRetreatUntil
        || creep.memory.remoteDangerRetreatUntil < Game.time
        || creep.memory.remoteDangerRetreatRoom != creep.memory.target)
    {
        clearRemoteDangerRetreat(creep);
        return false;
    }
    if (creep.room.name == creep.memory.target && !remoteDanger.shouldRetreat(creep))
    {
        clearRemoteDangerRetreat(creep);
        return false;
    }
    return true;
}

function isRoomCoord(x, y)
{
    return x >= 0 && x <= 49 && y >= 0 && y <= 49;
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

function stepOffEdge(creep)
{
    if (creep.pos.x == 0)
    {
        return creep.move(RIGHT) == OK;
    }
    if (creep.pos.x == 49)
    {
        return creep.move(LEFT) == OK;
    }
    if (creep.pos.y == 0)
    {
        return creep.move(BOTTOM) == OK;
    }
    if (creep.pos.y == 49)
    {
        return creep.move(TOP) == OK;
    }
    return false;
}

function moveToRoom(creep, roomName)
{
    if (!roomName)
    {
        return;
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
            creep.moveTo(exitPos, {reusePath: 20});
        }
    }
}

function findClosestByPathOrRange(creep, targets, opts)
{
    // Temporary traffic can make findClosestByPath miss a valid hauler target.
    // Use a range fallback so full/empty lorries keep a concrete sink/source
    // instead of wandering to a lower-priority fallback.
    return creep.pos.findClosestByPath(targets, opts)
        || creep.pos.findClosestByRange(targets, opts);
}

function getStructureEnergy(structure)
{
    if (!structure || !structure.store)
    {
        return 0;
    }
    return structure.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
}

function findMostDepletedTowerBelowMaintenanceReserve(creep)
{
    var towers = creep.room.find(FIND_MY_STRUCTURES,
    {
        filter: (structure) => structure.structureType == STRUCTURE_TOWER
            && getStructureEnergy(structure) < TOWER_MAINTENANCE_ENERGY_RESERVE
            && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });
    towers.sort(function(left, right)
    {
        var energyDifference = getStructureEnergy(left) - getStructureEnergy(right);
        if (energyDifference != 0)
        {
            return energyDifference;
        }
        var rangeDifference = creep.pos.getRangeTo(left) - creep.pos.getRangeTo(right);
        if (rangeDifference != 0)
        {
            return rangeDifference;
        }
        return left.id < right.id ? -1 : (left.id > right.id ? 1 : 0);
    });
    return towers[0];
}

function getRemoteSource(creep)
{
    if (creep.memory.sourceObjectId)
    {
        var rememberedSource = Game.getObjectById(creep.memory.sourceObjectId);
        if (rememberedSource && rememberedSource.pos.roomName == creep.memory.target)
        {
            return rememberedSource;
        }
        delete creep.memory.sourceObjectId;
        delete creep.memory.containerId;
    }

    var sourceById = typeof creep.memory.sourceId == 'string'
        ? Game.getObjectById(creep.memory.sourceId)
        : undefined;
    if (sourceById && sourceById.pos.roomName == creep.memory.target)
    {
        creep.memory.sourceObjectId = sourceById.id;
        return sourceById;
    }

    var sources = creep.room.find(FIND_SOURCES);
    var source = sources[creep.memory.sourceId] || sources[0];
    if (source)
    {
        creep.memory.sourceObjectId = source.id;
    }
    return source;
}

function getLargestDroppedEnergy(resources)
{
    var best = undefined;
    for (let resource of resources)
    {
        if (!best || resource.amount > best.amount)
        {
            best = resource;
        }
    }
    return best;
}

function isSourceAccessTile(pos, source)
{
    return source
        && pos.roomName == source.pos.roomName
        && pos.inRangeTo(source.pos, 1)
        && !pos.isEqualTo(source.pos);
}

function markSourceAccessCosts(costs, source)
{
    if (!source)
    {
        return;
    }
    for (let x = source.pos.x - 1; x <= source.pos.x + 1; x++)
    {
        for (let y = source.pos.y - 1; y <= source.pos.y + 1; y++)
        {
            if (x >= 0 && x <= 49 && y >= 0 && y <= 49)
            {
                costs.set(x, y, 255);
            }
        }
    }
}

function getSourceAccessCostCallback(source)
{
    return function(roomName, costs)
    {
        if (source && roomName == source.pos.roomName)
        {
            markSourceAccessCosts(costs, source);
        }
        return costs;
    };
}

function isWalkableNonSourceAccess(pos, source)
{
    if (!pos || pos.x <= 0 || pos.x >= 49 || pos.y <= 0 || pos.y >= 49)
    {
        return false;
    }
    if (isSourceAccessTile(pos, source))
    {
        return false;
    }
    if (creepRoomTerrain(pos).get(pos.x, pos.y) == TERRAIN_MASK_WALL)
    {
        return false;
    }
    if (pos.lookFor(LOOK_CREEPS).length > 0)
    {
        return false;
    }
    var structures = pos.lookFor(LOOK_STRUCTURES);
    for (let structure of structures)
    {
        if (structure.structureType == STRUCTURE_ROAD
            || structure.structureType == STRUCTURE_CONTAINER)
        {
            continue;
        }
        if (structure.structureType == STRUCTURE_RAMPART
            && (structure.my || structure.isPublic))
        {
            continue;
        }
        return false;
    }
    return true;
}

function creepRoomTerrain(pos)
{
    return Game.rooms[pos.roomName].getTerrain();
}

function moveOffSourceAccessTile(creep, source, target)
{
    if (!isSourceAccessTile(creep.pos, source))
    {
        return false;
    }

    var best = undefined;
    var bestScore = undefined;
    for (let x = creep.pos.x - 1; x <= creep.pos.x + 1; x++)
    {
        for (let y = creep.pos.y - 1; y <= creep.pos.y + 1; y++)
        {
            if (x == creep.pos.x && y == creep.pos.y)
            {
                continue;
            }
            if (!isRoomCoord(x, y))
            {
                continue;
            }
            var pos = new RoomPosition(x, y, creep.room.name);
            if (!isWalkableNonSourceAccess(pos, source))
            {
                continue;
            }
            var score = target && target.pos ? pos.getRangeTo(target.pos) : pos.getRangeTo(source.pos);
            if (best == undefined || score < bestScore)
            {
                best = pos;
                bestScore = score;
            }
        }
    }

    if (best)
    {
        creep.move(creep.pos.getDirectionTo(best));
        return true;
    }
    return false;
}

function targetIsNearSource(target, source)
{
    return source
        && target
        && target.pos
        && target.pos.roomName == source.pos.roomName
        && target.pos.inRangeTo(source.pos, 1);
}

function moveNearEnergyAvoidingSource(creep, target, source)
{
    if (targetIsNearSource(target, source))
    {
        if (isSourceAccessTile(creep.pos, source)
            && !creep.pos.isNearTo(target))
        {
            if (moveOffSourceAccessTile(creep, source, target))
            {
                return;
            }
        }
        creep.moveTo(target, {
            range: 1,
            reusePath: 3,
            costCallback: getSourceAccessCostCallback(source)
        });
        return;
    }
    creep.moveTo(target, {reusePath: 10});
}

function waitNearSourceWithoutBlocking(creep, source)
{
    if (!source)
    {
        return;
    }
    if (moveOffSourceAccessTile(creep, source))
    {
        return;
    }
    if (creep.pos.getRangeTo(source) > 2)
    {
        creep.moveTo(source, {
            range: 2,
            reusePath: 5,
            costCallback: getSourceAccessCostCallback(source)
        });
    }
}

function findRemoteEnergy(creep, source)
{
    source = source || getRemoteSource(creep);
    if (creep.memory.containerId)
    {
        var remembered = Game.getObjectById(creep.memory.containerId);
        if (remembered
            && source
            && remembered.structureType == STRUCTURE_CONTAINER
            && remembered.pos.roomName == creep.room.name
            && remembered.pos.inRangeTo(source, 1)
            && remembered.store
            && remembered.store.getUsedCapacity(RESOURCE_ENERGY) > 0)
        {
            return remembered;
        }
        delete creep.memory.containerId;
    }

    if (source)
    {
        var sourceContainer = source.pos.findInRange(FIND_STRUCTURES, 1,
        {
            filter: (s) => s.structureType == STRUCTURE_CONTAINER
                && s.store.getUsedCapacity(RESOURCE_ENERGY) > 0
        })[0];
        if (sourceContainer)
        {
            creep.memory.containerId = sourceContainer.id;
            return sourceContainer;
        }

        // No-CARRY remote miners drop energy near the source/container tile.
        // Prefer the largest nearby pile so haulers do not chase tiny leftovers.
        var sourceDrop = getLargestDroppedEnergy(source.pos.findInRange(FIND_DROPPED_RESOURCES, 2,
        {
            filter: (r) => r.resourceType == RESOURCE_ENERGY
                && r.amount > 0
                && !depotUtils.isRemoteBuildDepotDroppedEnergy(r)
        }));
        if (sourceDrop)
        {
            return sourceDrop;
        }
    }

    var dropped = findClosestByPathOrRange(creep, FIND_DROPPED_RESOURCES,
    {
        filter: (r) => r.resourceType == RESOURCE_ENERGY
            && r.amount >= 50
            && !depotUtils.isRemoteBuildDepotDroppedEnergy(r)
    });
    if (dropped)
    {
        return dropped;
    }

    return findClosestByPathOrRange(creep, FIND_STRUCTURES,
    {
        filter: (s) => s.structureType == STRUCTURE_CONTAINER
            && s.store.getUsedCapacity(RESOURCE_ENERGY) > 0
            && !depotUtils.isRemoteBuildDepotEnergyStructure(s)
    });
}

function takeEnergy(creep, target, source)
{
    if (!target)
    {
        return;
    }
    var result;
    if (target.resourceType == RESOURCE_ENERGY)
    {
        result = creep.pickup(target);
    }
    else
    {
        result = creep.withdraw(target, RESOURCE_ENERGY);
    }
    if (result == ERR_NOT_IN_RANGE)
    {
        moveNearEnergyAvoidingSource(creep, target, source);
    }
    else if (result == OK)
    {
        moveOffSourceAccessTile(creep, source, target);
    }
}

function findControllerUpgradeSink(creep)
{
    if (!creep.room.controller)
    {
        return undefined;
    }
    var controllerSinks = creep.room.controller.pos.findInRange(FIND_STRUCTURES, 3,
    {
        filter: (s) => (s.structureType == STRUCTURE_CONTAINER
                        || s.structureType == STRUCTURE_LINK)
            && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });
    return findClosestByPathOrRange(creep, controllerSinks);
}

function findSpawnContainerSink(creep)
{
    var spawn = findClosestByPathOrRange(creep, FIND_MY_SPAWNS);
    if (!spawn)
    {
        return undefined;
    }
    var spawnContainers = spawn.pos.findInRange(FIND_STRUCTURES, 5,
    {
        filter: (s) => s.structureType == STRUCTURE_CONTAINER
            && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });
    return findClosestByPathOrRange(creep, spawnContainers);
}

function findLabEnergySink(creep, preControllerOnly)
{
    return findClosestByPathOrRange(creep, FIND_MY_STRUCTURES,
    {
        filter: (s) => s.structureType == STRUCTURE_LAB
            && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
            && (!preControllerOnly
                || s.store.getUsedCapacity(RESOURCE_ENERGY) < LAB_PRE_CONTROLLER_ENERGY)
    });
}

function findStorageBufferSink(creep)
{
    if (energyReserve.needsRoomEnergyReserve(creep.room))
    {
        return creep.room.storage;
    }
    return undefined;
}

function findHomeEnergySink(creep)
{
    var structure = findMostDepletedTowerBelowMaintenanceReserve(creep);
    if (structure)
    {
        return structure;
    }

    structure = findClosestByPathOrRange(creep, FIND_MY_STRUCTURES,
    {
        filter: (s) => (s.structureType == STRUCTURE_SPAWN
                    ||  s.structureType == STRUCTURE_EXTENSION
                    ||  s.structureType == STRUCTURE_TOWER)
            && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });
    if (structure)
    {
        return structure;
    }

    structure = findStorageBufferSink(creep);
    if (structure)
    {
        return structure;
    }

    structure = findLabEnergySink(creep, true);
    if (structure)
    {
        return structure;
    }

    structure = findControllerUpgradeSink(creep);
    if (structure)
    {
        return structure;
    }

    if (creep.room.terminal
        && creep.room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) < 10000
        && creep.room.terminal.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
    {
        return creep.room.terminal;
    }

    structure = findLabEnergySink(creep, false);
    if (structure)
    {
        return structure;
    }

    if (creep.room.storage
        && creep.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
    {
        return creep.room.storage;
    }

    return findSpawnContainerSink(creep);
}

var roleRemoteLorry = {
    /**
     * Memory expected:
     *   role: 'remoteLorry'
     *   home: owned room name
     *   target: remote room name
     *   sourceId: optional source id or visible source index
     *   containerId: optional remembered remote container id
     * Empty lorries withdraw from a source container or pick up dropped energy
     * from no-CARRY drop miners near the remote source.
     */
    run: function(creep) {
        if (getFreeEnergy(creep) == 0)
        {
            creep.memory.empty = false;
        }
        else if (getUsedEnergy(creep) == 0)
        {
            creep.memory.empty = true;
        }

        if (!creep.memory.home)
        {
            creep.memory.home = creep.room.name;
        }

        if (creep.room.name != creep.memory.home && remoteDanger.shouldRetreat(creep))
        {
            startRemoteDangerRetreat(creep);
        }
        if (shouldContinueRemoteDangerRetreat(creep))
        {
            if (creep.room.name != creep.memory.home)
            {
                moveToRoom(creep, creep.memory.home);
                return;
            }
            if (creep.memory.empty == true)
            {
                // Idling on the exit tile would bounce the lorry back into danger.
                if (!stepOffEdge(creep))
                {
                    creep.say('danger');
                }
                return;
            }
            // A loaded lorry is already home: fall through and deliver.
        }

        if (creep.memory.empty == true)
        {
            if (creep.room.name != creep.memory.target)
            {
                moveToRoom(creep, creep.memory.target);
                return;
            }

            if (remoteDanger.shouldRetreat(creep))
            {
                moveToRoom(creep, creep.memory.home);
                return;
            }

            var source = getRemoteSource(creep);
            var energy = findRemoteEnergy(creep, source);
            if (energy)
            {
                takeEnergy(creep, energy, source);
                return;
            }

            if (source)
            {
                waitNearSourceWithoutBlocking(creep, source);
            }
            return;
        }

        if (creep.room.name != creep.memory.home)
        {
            moveToRoom(creep, creep.memory.home);
            return;
        }

        // Reuse the chosen sink briefly; re-ranking every tick costs path searches.
        var sink = creep.memory.sinkId ? Game.getObjectById(creep.memory.sinkId) : null;
        if (!sink
            || !sink.store
            || sink.store.getFreeCapacity(RESOURCE_ENERGY) <= 0
            || (creep.memory.sinkUntil || 0) < Game.time)
        {
            sink = findHomeEnergySink(creep);
            creep.memory.sinkId = sink ? sink.id : undefined;
            creep.memory.sinkUntil = Game.time + 10;
        }
        if (sink)
        {
            if (creep.transfer(sink, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE)
            {
                creep.moveTo(sink, {reusePath: 10});
            }
        }
        else
        {
            energyFallback.dropAtSpawnPile(creep);
        }
    }
};

roleRemoteLorry._test = {
    findMostDepletedTowerBelowMaintenanceReserve: findMostDepletedTowerBelowMaintenanceReserve,
    findHomeEnergySink: findHomeEnergySink
};

module.exports = roleRemoteLorry;
