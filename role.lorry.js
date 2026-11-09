var energyFallback = require('energy.fallback');
var energyReserve = require('energy.reserve');
var sourceLinkUtils = require('source.link');
var depotUtils = require('remote.build.depot');
var specialStructureMarket = require('market.specialStructures');
var LOCAL_LORRY_SECOND_PICKUP_MIN_ENERGY = 400;
var LAB_PRE_CONTROLLER_ENERGY = 1000;
// Keep aligned with TOWER_MAINTENANCE_ENERGY_RESERVE in main.js. Towers below
// this level cannot spend energy on ordinary maintenance, so lorries refill
// the weakest tower before choosing the usual spawn/extension/tower sink.
var TOWER_MAINTENANCE_ENERGY_RESERVE = 600;

function isControllerUpgradeBuffer(creep, structure)
{
    if (!creep.room.controller || !structure)
    {
        return false;
    }
    if (structure.structureType == STRUCTURE_LINK)
    {
        return sourceLinkUtils.isUsableControllerLink(creep.room.controller, structure);
    }
    return structure.structureType == STRUCTURE_CONTAINER
        && structure.pos.inRangeTo(creep.room.controller, 3);
}

function findControllerUpgradeSink(creep)
{
    if (!creep.room.controller)
    {
        return undefined;
    }
    var controllerSinks = creep.room.controller.pos.findInRange(FIND_STRUCTURES, 3,
    {
        filter: (s) => s.structureType == STRUCTURE_CONTAINER
            && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });
    // In builderPriority the Blinker drains the controller link back into
    // storage, so refilling it would only loop energy through the link.
    var controllerLinks = creep.room.memory.economyMode == 'builderPriority'
        ? [] : sourceLinkUtils.findUsableControllerLinks(creep.room.controller);
    for (let link of controllerLinks)
    {
        if (link.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
        {
            controllerSinks.push(link);
        }
    }
    return creep.pos.findClosestByRange(controllerSinks);
}

function roomHasRecentHostiles(creep)
{
    return creep.room.memory
        && creep.room.memory.hostileCount > 0
        && creep.room.memory.hostileLastSeen >= Game.time - 1;
}

function isActiveQuadSpawnRequest(request)
{
    return request
        && request !== false
        && (typeof request != 'object' || request.enabled !== false);
}

function getGlobalQuadSourceRoom(rawRequest, fallbackRoom)
{
    var request = typeof rawRequest == 'object' ? rawRequest : {};
    if (typeof Memory.quadSpawnRoom == 'string')
    {
        return Memory.quadSpawnRoom;
    }
    if (typeof request.sourceRoom == 'string')
    {
        return request.sourceRoom;
    }
    if (typeof request.retreatRoom == 'string')
    {
        return request.retreatRoom;
    }
    var spawnNames = Object.keys(Game.spawns || {}).sort();
    if (spawnNames.length > 0 && Game.spawns[spawnNames[0]])
    {
        return Game.spawns[spawnNames[0]].room.name;
    }
    return fallbackRoom;
}

function roomHasPendingQuadSpawn(room)
{
    if (!room)
    {
        return false;
    }
    if (room.memory && isActiveQuadSpawnRequest(room.memory.spawnQuad))
    {
        return true;
    }
    for (var spawnName in Game.spawns)
    {
        var spawn = Game.spawns[spawnName];
        if (spawn
            && spawn.room.name == room.name
            && spawn.memory
            && isActiveQuadSpawnRequest(spawn.memory.spawnQuad))
        {
            return true;
        }
    }
    if (isActiveQuadSpawnRequest(Memory.spawnQuad)
        && getGlobalQuadSourceRoom(Memory.spawnQuad, room.name) == room.name)
    {
        return true;
    }
    return isActiveQuadSpawnRequest(Memory.quadSpawn)
        && getGlobalQuadSourceRoom(Memory.quadSpawn, room.name) == room.name;
}

function getStoragePickupPriorityReason(room, roomUnderAttack)
{
    if (roomUnderAttack)
    {
        return 'combat';
    }
    return roomHasPendingQuadSpawn(room) ? 'quadSpawn' : undefined;
}

function findPriorityStoragePickup(storage)
{
    if (storage
        && storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0
        && !depotUtils.isRemoteBuildDepotEnergyStructure(storage))
    {
        return storage;
    }
    return undefined;
}

function needsStorageEnergyBuffer(room)
{
    return energyReserve.needsRoomEnergyReserve(room);
}

function findTerminalStorageRebalanceSource(creep, storage)
{
    if (!storage
        || !needsStorageEnergyBuffer(creep.room)
        || !creep.room.terminal
        || creep.room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) <= energyReserve.getTerminalRebalanceReserve(creep.room))
    {
        return undefined;
    }
    return creep.room.terminal;
}

function findSpawnContainerSink(creep)
{
    var spawn = creep.pos.findClosestByRange(FIND_MY_SPAWNS);
    if (!spawn)
    {
        return undefined;
    }
    var spawnContainers = spawn.pos.findInRange(FIND_STRUCTURES, 5, {
        filter: (s) => s.structureType == STRUCTURE_CONTAINER
            && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });
    return creep.pos.findClosestByRange(spawnContainers);
}

function findLabEnergySink(creep, preControllerOnly)
{
    return findClosestByPathOrRange(creep, FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType == STRUCTURE_LAB
            && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
            && (!preControllerOnly
                || s.store.getUsedCapacity(RESOURCE_ENERGY) < LAB_PRE_CONTROLLER_ENERGY)
    });
}

function findSpecialStructureEnergySink(creep)
{
    // Preserve the room reserve before filling the Nuker. The smaller Power
    // Spawn is a high-priority energy sink once regular spawns/towers/labs are safe.
    var reserveHealthy = !needsStorageEnergyBuffer(creep.room);
    return specialStructureMarket.getEnergySink(creep.room,
        reserveHealthy,
        reserveHealthy);
}

function findClosestByPathOrRange(creep, targets, opts)
{
    // Dynamic creep traffic can make findClosestByPath return undefined for a
    // valid sink on this tick. Keep the delivery target instead of falling
    // through to a lower-priority sink/drop pile; moveTo/traffic yielding can
    // then work through the temporary blockage.
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

function getCarriedNonEnergyResource(creep)
{
    if (!creep.store)
    {
        return undefined;
    }
    for (let resourceType in creep.store)
    {
        if (resourceType != RESOURCE_ENERGY && creep.store[resourceType] > 0)
        {
            return resourceType;
        }
    }
    return undefined;
}

function getNonEnergyDeliveryTarget(creep, resourceType)
{
    if (creep.room.terminal
        && creep.room.terminal.store.getFreeCapacity(resourceType) > 0)
    {
        return creep.room.terminal;
    }
    if (creep.room.storage
        && creep.room.storage.store.getFreeCapacity(resourceType) > 0)
    {
        return creep.room.storage;
    }
    return undefined;
}

function deliverNonEnergyCargo(creep, resourceType)
{
    var target = getNonEnergyDeliveryTarget(creep, resourceType);
    if (!target)
    {
        return false;
    }
    var result = creep.transfer(target, resourceType);
    if (result == ERR_NOT_IN_RANGE)
    {
        creep.moveTo(target, {reusePath: 10});
    }
    return result == OK || result == ERR_NOT_IN_RANGE;
}

function clearLorryPickup(creep)
{
    var hadPickup = creep && creep.memory && creep.memory.lorryPickupId;
    delete creep.memory.lorryPickupId;
    delete creep.memory.lorryPickupUntil;
    if (hadPickup)
    {
        invalidateLorryPickupReservationCache(creep.room);
    }
}

function getLorryEnergy(creep)
{
    if (creep.store)
    {
        return creep.store.getUsedCapacity(RESOURCE_ENERGY);
    }
    return creep.carry.energy;
}

function getLorryCapacity(creep)
{
    if (creep.store)
    {
        return creep.store.getCapacity(RESOURCE_ENERGY);
    }
    return creep.carryCapacity;
}

function getLorryFreeCapacity(creep)
{
    if (creep.store)
    {
        return creep.store.getFreeCapacity(RESOURCE_ENERGY);
    }
    return creep.carryCapacity - creep.carry.energy;
}

function shouldDeliverPartialLoad(creep)
{
    var carried = getLorryEnergy(creep);
    var capacity = getLorryCapacity(creep);
    return carried > 0
        && capacity > 0
        && carried >= Math.floor(capacity * 0.75);
}

function getPickupEnergyAmount(target)
{
    if (!target)
    {
        return 0;
    }
    if (target.resourceType == RESOURCE_ENERGY)
    {
        return target.amount || 0;
    }
    if (target.store)
    {
        return target.store.getUsedCapacity(RESOURCE_ENERGY);
    }
    return 0;
}

function invalidateLorryPickupReservationCache(room)
{
    if (typeof global == 'undefined' || !room || !global.lorryPickupReservationRooms)
    {
        return;
    }
    delete global.lorryPickupReservationRooms[room.name];
}

function getLorryPickupReservationMap(room)
{
    if (typeof global == 'undefined' || !room)
    {
        return undefined;
    }
    if (global.lorryPickupReservationTick != Game.time)
    {
        global.lorryPickupReservationTick = Game.time;
        global.lorryPickupReservationRooms = {};
    }
    global.lorryPickupReservationRooms = global.lorryPickupReservationRooms || {};
    if (global.lorryPickupReservationRooms[room.name])
    {
        return global.lorryPickupReservationRooms[room.name];
    }
    var reservations = {};
    for (let name in Game.creeps)
    {
        let other = Game.creeps[name];
        if (!other.memory
            || other.memory.role != 'lorry'
            || other.room.name != room.name
            || other.memory.lorryPickupId == undefined
            || other.memory.lorryPickupUntil == undefined
            || other.memory.lorryPickupUntil < Game.time)
        {
            continue;
        }
        let targetId = other.memory.lorryPickupId;
        reservations[targetId] = (reservations[targetId] || 0)
            + Math.max(1, getLorryFreeCapacity(other));
    }
    global.lorryPickupReservationRooms[room.name] = reservations;
    return reservations;
}

function getReservedPickupCapacity(creep, target)
{
    if (!target || !target.id)
    {
        return 0;
    }
    var reservations = getLorryPickupReservationMap(creep.room);
    if (reservations)
    {
        var reserved = reservations[target.id] || 0;
        if (creep.memory
            && creep.memory.role == 'lorry'
            && creep.memory.lorryPickupId == target.id
            && creep.memory.lorryPickupUntil != undefined
            && creep.memory.lorryPickupUntil >= Game.time)
        {
            reserved -= Math.max(1, getLorryFreeCapacity(creep));
        }
        return Math.max(0, reserved);
    }

    var reserved = 0;
    for (let name in Game.creeps)
    {
        let other = Game.creeps[name];
        if (other.name == creep.name
            || !other.memory
            || other.memory.role != 'lorry'
            || other.room.name != creep.room.name
            || other.memory.lorryPickupId != target.id
            || other.memory.lorryPickupUntil == undefined
            || other.memory.lorryPickupUntil < Game.time)
        {
            continue;
        }
        reserved += Math.max(1, getLorryFreeCapacity(other));
    }
    return reserved;
}

function hasUnreservedPickupEnergy(creep, target, requireNoOtherReservation)
{
    var reserved = getReservedPickupCapacity(creep, target);
    if (requireNoOtherReservation && reserved > 0)
    {
        return false;
    }
    var unreserved = getPickupEnergyAmount(target) - reserved;
    if (unreserved <= 0)
    {
        return false;
    }
    if (reserved <= 0)
    {
        return true;
    }
    return unreserved >= LOCAL_LORRY_SECOND_PICKUP_MIN_ENERGY;
}

function isValidLorryPickup(creep, target, canDrainNonControllerLinks, requireNoOtherReservation)
{
    if (!target || !target.pos || target.pos.roomName != creep.room.name)
    {
        return false;
    }
    if (target.resourceType == RESOURCE_ENERGY)
    {
        return target.amount > 0
            && !energyFallback.isSpawnDropPile(target)
            && !depotUtils.isRemoteBuildDepotDroppedEnergy(target)
            && hasUnreservedPickupEnergy(creep, target, requireNoOtherReservation);
    }
    if (!target.store || target.store.getUsedCapacity(RESOURCE_ENERGY) <= 0)
    {
        return false;
    }
    if (target.structureType == STRUCTURE_LINK && !canDrainNonControllerLinks)
    {
        return false;
    }
    if (target.structureType != STRUCTURE_CONTAINER
        && target.structureType != STRUCTURE_LINK)
    {
        return false;
    }
    return !isControllerUpgradeBuffer(creep, target)
        && !depotUtils.isRemoteBuildDepotEnergyStructure(target)
        && hasUnreservedPickupEnergy(creep, target, requireNoOtherReservation);
}

function getStickyLorryPickup(creep, canDrainNonControllerLinks)
{
    if (!creep.memory.lorryPickupId
        || creep.memory.lorryPickupUntil == undefined
        || creep.memory.lorryPickupUntil < Game.time)
    {
        clearLorryPickup(creep);
        return undefined;
    }
    var target = Game.getObjectById(creep.memory.lorryPickupId);
    if (isValidLorryPickup(creep, target, canDrainNonControllerLinks))
    {
        return target;
    }
    clearLorryPickup(creep);
    return undefined;
}

function rememberLorryPickup(creep, target)
{
    if (!target || !target.id || target.structureType == STRUCTURE_STORAGE)
    {
        return;
    }
    creep.memory.lorryPickupId = target.id;
    creep.memory.lorryPickupUntil = Game.time + 10;
    invalidateLorryPickupReservationCache(creep.room);
}

function takeLorryEnergy(creep, target)
{
    if (target.resourceType == RESOURCE_ENERGY)
    {
        delete creep.memory.withdrawnFromStorage;
        if(creep.pickup(target) == ERR_NOT_IN_RANGE)
        {
            creep.moveTo(target, {reusePath: 10});
        }
        return;
    }
    if (target.structureType == STRUCTURE_STORAGE)
    {
        creep.memory.withdrawnFromStorage = true;
    }
    else
    {
        delete creep.memory.withdrawnFromStorage;
    }
    if(creep.withdraw(target, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE)
    {
        creep.moveTo(target, {reusePath: 10});
    }
}

function findDroppedLorryPickup(creep, requireNoOtherReservation)
{
    return creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES,
    {
        filter: (r) => r.amount > 200
            && r.resourceType == RESOURCE_ENERGY
            && !energyFallback.isSpawnDropPile(r)
            && !depotUtils.isRemoteBuildDepotDroppedEnergy(r)
            && hasUnreservedPickupEnergy(creep, r, requireNoOtherReservation)
    });
}

function findStorageLinkPickup(creep, storage, canDrainNonControllerLinks, requireNoOtherReservation)
{
    if (!storage || !canDrainNonControllerLinks)
    {
        return undefined;
    }
    return storage.pos.findInRange(FIND_MY_STRUCTURES, 3,
    {
        filter: (s) => s.structureType == STRUCTURE_LINK
            && s.store.getUsedCapacity(RESOURCE_ENERGY) > 0
            && isValidLorryPickup(creep, s, canDrainNonControllerLinks, requireNoOtherReservation)
    })[0];
}

function findContainerLorryPickup(creep, canDrainNonControllerLinks, requireNoOtherReservation)
{
    return findClosestByPathOrRange(creep, FIND_STRUCTURES,
    {
        filter: (s) => (s.structureType == STRUCTURE_CONTAINER
                        || (s.structureType == STRUCTURE_LINK && canDrainNonControllerLinks))
            && s.store.getUsedCapacity(RESOURCE_ENERGY) > 0
            && !isControllerUpgradeBuffer(creep, s)
            && !depotUtils.isRemoteBuildDepotEnergyStructure(s)
            && hasUnreservedPickupEnergy(creep, s, requireNoOtherReservation)
    });
}

// Storage energy is only worth withdrawing when a non-storage sink will take it;
// otherwise an idle lorry withdraws and returns the same load every tick.
function hasNonStorageEnergySink(creep, roomUnderAttack)
{
    var room = creep.room;
    if (room.energyAvailable < room.energyCapacityAvailable)
    {
        return true;
    }
    if (room.find(FIND_MY_STRUCTURES,
    {
        filter: (s) => s.structureType == STRUCTURE_TOWER
            && s.store.getFreeCapacity(RESOURCE_ENERGY) >= 100
    }).length > 0)
    {
        return true;
    }
    if (roomUnderAttack)
    {
        return false;
    }
    return !!(findLabEnergySink(creep, false)
        || findSpecialStructureEnergySink(creep)
        || (!needsStorageEnergyBuffer(room) && findControllerUpgradeSink(creep))
        || (room.terminal
            && room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) < 10000
            && room.terminal.store.getFreeCapacity(RESOURCE_ENERGY) > 0));
}

var roleLorry = {

    /** @param {Creep} creep **/
    run: function(creep) {
        var roomUnderAttack = roomHasRecentHostiles(creep);
        var storage = creep.room.storage;
        var storagePickupPriority = getStoragePickupPriorityReason(creep.room, roomUnderAttack);
        if (storagePickupPriority)
        {
            creep.memory.storagePickupPriority = storagePickupPriority;
        }
        else
        {
            delete creep.memory.storagePickupPriority;
        }
        var controllerLink = undefined;
        if (creep.room.controller)
        {
            var controllerLinks = sourceLinkUtils.findUsableControllerLinks(creep.room.controller);
            controllerLink = creep.pos.findClosestByRange(controllerLinks) || controllerLinks[0];
        }
        // The full-controller-link guard only matters while a Clinker forwards
        // base link energy to the controller link (none exist at RCL8).
        var canDrainNonControllerLinks = !controllerLink
            || controllerLink.store.getFreeCapacity(RESOURCE_ENERGY) == 0
            || creep.room.find(FIND_MY_CREEPS,
                {filter: (c) => c.memory.role == 'Clinker'}).length == 0;

        var nonEnergyResource = getCarriedNonEnergyResource(creep);
        if (nonEnergyResource != undefined)
        {
            creep.memory.empty = false;
            clearLorryPickup(creep);
            if (deliverNonEnergyCargo(creep, nonEnergyResource))
            {
                return;
            }
        }

        if (creep.carry.energy == creep.carryCapacity)
        {
            creep.memory.empty = false;
            clearLorryPickup(creep);
        }
        else if (creep.carry.energy == 0)
        {
            creep.memory.empty = true;
            delete creep.memory.storageRebalance;
            delete creep.memory.withdrawnFromStorage;
            delete creep.memory.lorrySinkId;
        }
        else if (creep.memory.empty == true && shouldDeliverPartialLoad(creep))
        {
            creep.memory.empty = false;
            clearLorryPickup(creep);
        }

        if(creep.memory.empty == true) {
            // During a live defense or while a quad is still being produced, refill
            // from the central stockpile before travelling to source-side pickups.
            var priorityStorage = storagePickupPriority
                && hasNonStorageEnergySink(creep, roomUnderAttack)
                && findPriorityStoragePickup(storage);
            if (priorityStorage)
            {
                clearLorryPickup(creep);
                takeLorryEnergy(creep, priorityStorage);
                return;
            }

            var rememberedPickup = getStickyLorryPickup(creep, canDrainNonControllerLinks);
            if (rememberedPickup)
            {
                takeLorryEnergy(creep, rememberedPickup);
                return;
            }

            var rebalanceSource = findTerminalStorageRebalanceSource(creep, storage);
            if (rebalanceSource)
            {
                creep.memory.storageRebalance = true;
                takeLorryEnergy(creep, rebalanceSource);
                return;
            }

            var target = findDroppedLorryPickup(creep, true)
                || findDroppedLorryPickup(creep, false);
            if(target != undefined)
            {
                rememberLorryPickup(creep, target);
                takeLorryEnergy(creep, target);
                return;
            }

            var link = findStorageLinkPickup(creep, storage, canDrainNonControllerLinks, true)
                || findStorageLinkPickup(creep, storage, canDrainNonControllerLinks, false);
            if (link)
            {
                rememberLorryPickup(creep, link);
                takeLorryEnergy(creep, link);
                return;
            }

            var container = findContainerLorryPickup(creep, canDrainNonControllerLinks, true)
                || findContainerLorryPickup(creep, canDrainNonControllerLinks, false);
            if (container == undefined && storage
                && storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0
                && !depotUtils.isRemoteBuildDepotEnergyStructure(storage)
                && hasNonStorageEnergySink(creep, roomUnderAttack))
            {
                container = storage;
            }
            if (container != undefined)
            {
                rememberLorryPickup(creep, container);
                takeLorryEnergy(creep, container);
            }
        }
        else
        {
            clearLorryPickup(creep);
            var structure = findMostDepletedTowerBelowMaintenanceReserve(creep);
            if (structure == undefined
                && !roomUnderAttack
                && creep.memory.storageRebalance
                && needsStorageEnergyBuffer(creep.room))
            {
                structure = storage;
            }
            if (structure == undefined)
            {
                // Keep walking to the last chosen sink instead of re-running
                // findClosestByPath (and re-pathing moveTo) every tick.
                var lastSink = creep.memory.lorrySinkId
                    ? Game.getObjectById(creep.memory.lorrySinkId) : null;
                if (lastSink
                    && lastSink.pos.roomName == creep.room.name
                    && lastSink.store.getFreeCapacity(RESOURCE_ENERGY) > 0
                    && (lastSink.structureType == STRUCTURE_EXTENSION
                        || lastSink.structureType == STRUCTURE_TOWER
                        || (!roomUnderAttack && lastSink.structureType == STRUCTURE_SPAWN)))
                {
                    structure = lastSink;
                }
                else
                {
                    structure = findClosestByPathOrRange(creep, FIND_MY_STRUCTURES, {
                        filter: (s) => ((roomUnderAttack
                                        && (s.structureType == STRUCTURE_TOWER
                                            || s.structureType == STRUCTURE_EXTENSION))
                                    || (!roomUnderAttack
                                        && (s.structureType == STRUCTURE_SPAWN
                                            || s.structureType == STRUCTURE_EXTENSION
                                            || s.structureType == STRUCTURE_TOWER)))
                                    && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
                    });
                    if (structure)
                    {
                        creep.memory.lorrySinkId = structure.id;
                    }
                    else
                    {
                        delete creep.memory.lorrySinkId;
                    }
                }
            }
            if (structure == undefined
                && creep.memory.storageRebalance
                && needsStorageEnergyBuffer(creep.room))
            {
                structure = storage;
            }
            if (structure == undefined
                && !roomUnderAttack
                && !creep.memory.withdrawnFromStorage
                && needsStorageEnergyBuffer(creep.room))
            {
                structure = storage;
            }
            if (structure == undefined && !roomUnderAttack)
            {
                structure = findLabEnergySink(creep, true);
            }
            if (structure == undefined && !roomUnderAttack)
            {
                structure = findSpecialStructureEnergySink(creep);
            }
            if (structure == undefined
                && !roomUnderAttack
                && (!creep.memory.withdrawnFromStorage || !needsStorageEnergyBuffer(creep.room)))
            {
                structure = findControllerUpgradeSink(creep);
            }
            if (creep.room.terminal)
            {
                if (structure == undefined
                    && creep.room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) < 10000
                    && creep.room.terminal.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
                {
                    structure = creep.room.terminal;
                }
            }
            if (structure == undefined)
            {
                structure = findLabEnergySink(creep, false);
            }
            if (structure == undefined)
            {
                if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
                {
                    structure = storage;
                }
                else
                {
                    structure = findSpawnContainerSink(creep);
                }
            }
            if (structure != undefined)
            {
                var transferResult = creep.transfer(structure, RESOURCE_ENERGY);
                if(transferResult == ERR_NOT_IN_RANGE) 
                {
                    creep.moveTo(structure, {reusePath: 10});
                }
                else if (transferResult == OK && structure.structureType == STRUCTURE_STORAGE)
                {
                    delete creep.memory.storageRebalance;
                }
            }
            else
            {
                energyFallback.dropAtSpawnPile(creep);
            }
        }
    }
};

// Focused exports for the Node regression harness. Screeps still dispatches only
// roleLorry.run; these helpers make reservation-cache behavior independently testable.
roleLorry._test = {
    getReservedPickupCapacity: getReservedPickupCapacity,
    clearLorryPickup: clearLorryPickup,
    rememberLorryPickup: rememberLorryPickup,
    findMostDepletedTowerBelowMaintenanceReserve: findMostDepletedTowerBelowMaintenanceReserve
};

module.exports = roleLorry;