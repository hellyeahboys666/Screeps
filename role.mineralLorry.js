var roleLorry = require('role.lorry');
var energyReserve = require('energy.reserve');

function getAssignedLab(creep, mineralType)
{
    if (creep.memory.labId == undefined)
    {
        return undefined;
    }
    var lab = Game.getObjectById(creep.memory.labId);
    if (!lab || lab.structureType != STRUCTURE_LAB || lab.pos.roomName != creep.room.name)
    {
        delete creep.memory.labId;
        return undefined;
    }
    if (lab.mineralType != undefined
        && lab.mineralType != mineralType
        && lab.store.getUsedCapacity(mineralType) == 0)
    {
        creep.memory.labError = 'wrong mineral ' + lab.mineralType;
        return undefined;
    }
    delete creep.memory.labError;
    return lab;
}

function getAssignedSpecialStructure(creep, mineralType)
{
    if (creep.memory.specialStructureId == undefined)
    {
        return undefined;
    }
    var structure = Game.getObjectById(creep.memory.specialStructureId);
    var valid = structure && structure.store && structure.pos.roomName == creep.room.name
        && (creep.memory.specialStructureType == undefined
            || creep.memory.specialStructureType == structure.structureType)
        && ((structure.structureType == STRUCTURE_POWER_SPAWN && mineralType == RESOURCE_POWER)
            || (structure.structureType == STRUCTURE_NUKER && mineralType == RESOURCE_GHODIUM));
    if (!valid)
    {
        delete creep.memory.specialStructureId;
        delete creep.memory.specialStructureType;
        delete creep.memory.specialStructureWaiting;
        return undefined;
    }
    return structure;
}

function getSourceContainer(creep)
{
    if (creep.memory.sourceContainerId == undefined)
    {
        return undefined;
    }
    var container = Game.getObjectById(creep.memory.sourceContainerId);
    if (!container || container.structureType != STRUCTURE_CONTAINER
        || container.pos.roomName != creep.room.name)
    {
        delete creep.memory.sourceContainerId;
        return undefined;
    }
    return container;
}

function getStorageDeliveryTarget(creep, mineralType)
{
    if (creep.room.terminal
        && creep.room.terminal.store.getFreeCapacity(mineralType) > 0)
    {
        return creep.room.terminal;
    }
    if (creep.room.storage
        && creep.room.storage.store.getFreeCapacity(mineralType) > 0)
    {
        return creep.room.storage;
    }
    return undefined;
}

function getCarriedMineral(creep, mineralType)
{
    return creep.store.getUsedCapacity(mineralType) || 0;
}

function getTotalCarry(creep)
{
    return creep.store.getUsedCapacity() || 0;
}

function retireAsLorry(creep)
{
    delete creep.memory.labId;
    delete creep.memory.labError;
    delete creep.memory.specialStructureId;
    delete creep.memory.specialStructureType;
    delete creep.memory.specialStructureWaiting;
    delete creep.memory.specialStructureEnergyLoading;
    delete creep.memory.mineralType;
    creep.memory.role = 'lorry';
}

function waitForSpecialStructureRefill(creep, structure)
{
    // Keep this loader assigned after a short Power Spawn/Nuker refill. Retiring
    // it to an ordinary lorry would make the next deficit spawn another large
    // mineral lorry, steadily inflating the local-hauler fleet.
    creep.memory.empty = true;
    creep.memory.specialStructureWaiting = true;
    if (structure && creep.pos && !creep.pos.inRangeTo(structure, 2))
    {
        creep.moveTo(structure, {range: 2, reusePath: 10});
    }
}

function resumeSpecialStructureLoad(creep)
{
    delete creep.memory.specialStructureWaiting;
}

function withdrawMineral(creep, source, mineralType, requestedAmount)
{
    if (!source || !source.store)
    {
        return false;
    }
    var available = source.store.getUsedCapacity(mineralType) || 0;
    var amount = Math.min(requestedAmount || creep.store.getFreeCapacity(mineralType),
        creep.store.getFreeCapacity(mineralType),
        available);
    if (amount <= 0)
    {
        return false;
    }
    var result = creep.withdraw(source, mineralType, amount);
    if (result == ERR_NOT_IN_RANGE)
    {
        creep.moveTo(source);
    }
    return result == OK || result == ERR_NOT_IN_RANGE;
}

function tryWithdrawPowerSpawnEnergy(creep, powerSpawn)
{
    if (!powerSpawn || powerSpawn.structureType != STRUCTURE_POWER_SPAWN
        || powerSpawn.store.getFreeCapacity(RESOURCE_ENERGY) <= 0)
    {
        return false;
    }
    var reserve = energyReserve.getReserveStatus(creep.room);
    var surplus = Math.max(0, (reserve.total || 0) - (reserve.target || 0));
    var amount = Math.min(creep.store.getFreeCapacity(RESOURCE_ENERGY),
        powerSpawn.store.getFreeCapacity(RESOURCE_ENERGY),
        surplus);
    if (amount <= 0)
    {
        return false;
    }
    var source = creep.room.storage;
    if (!source || source.store.getUsedCapacity(RESOURCE_ENERGY) <= 0)
    {
        source = creep.room.terminal;
    }
    if (!withdrawMineral(creep, source, RESOURCE_ENERGY, amount))
    {
        return false;
    }
    creep.memory.specialStructureEnergyLoading = true;
    resumeSpecialStructureLoad(creep);
    return true;
}

function transferMineral(creep, target, mineralType, amount)
{
    if (!target || !target.store)
    {
        return ERR_INVALID_TARGET;
    }
    amount = Math.min(amount || getCarriedMineral(creep, mineralType),
        getCarriedMineral(creep, mineralType),
        target.store.getFreeCapacity(mineralType));
    if (amount <= 0)
    {
        return ERR_FULL;
    }
    var result = creep.transfer(target, mineralType, amount);
    if (result == ERR_NOT_IN_RANGE)
    {
        creep.moveTo(target);
    }
    return result;
}

function findGenericLabTarget(creep, mineralType)
{
    return creep.pos.findClosestByPath(FIND_STRUCTURES,
    {
        filter: (s) => s.structureType == STRUCTURE_LAB
            && (s.mineralType == mineralType
                || (s.store.getUsedCapacity() == s.store.getUsedCapacity(RESOURCE_ENERGY)))
            && s.store.getFreeCapacity(mineralType) > 0
    });
}

var rolemineralLorry = {

    /** @param {Creep} creep **/
    run: function(creep) {
        var mineralType = creep.memory.mineralType || RESOURCE_CATALYZED_LEMERGIUM_ACID;
        var carriedMineral = getCarriedMineral(creep, mineralType);
        var carriedEnergy = creep.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
        if (carriedMineral <= 0 && carriedEnergy > 0
            && creep.memory.specialStructureEnergyLoading)
        {
            var energyTarget = getAssignedSpecialStructure(creep, mineralType);
            if (energyTarget && energyTarget.structureType == STRUCTURE_POWER_SPAWN
                && energyTarget.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
            {
                var energyAmount = Math.min(carriedEnergy,
                    energyTarget.store.getFreeCapacity(RESOURCE_ENERGY));
                var energyResult = transferMineral(creep,
                    energyTarget,
                    RESOURCE_ENERGY,
                    energyAmount);
                if (energyResult == OK && energyAmount >= carriedEnergy)
                {
                    delete creep.memory.specialStructureEnergyLoading;
                }
                return;
            }
            delete creep.memory.specialStructureEnergyLoading;
        }
        if (carriedMineral > 0)
        {
            creep.memory.empty = false;
        }
        else if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0)
        {
            roleLorry.run(creep);
            return;
        }
        else if (getTotalCarry(creep) == 0)
        {
            creep.memory.empty = true;
        }

        if(creep.memory.empty == true)
        {
            var hadLabAssignment = creep.memory.labId != undefined;
            var hadSpecialAssignment = creep.memory.specialStructureId != undefined;
            var assignedLab = getAssignedLab(creep, mineralType);
            var assignedSpecialStructure = getAssignedSpecialStructure(creep, mineralType);
            var desiredAmount = creep.store.getFreeCapacity(mineralType);
            if (assignedLab)
            {
                desiredAmount = Math.min(desiredAmount, assignedLab.store.getFreeCapacity(mineralType));
            }
            if (assignedSpecialStructure)
            {
                desiredAmount = Math.min(desiredAmount,
                    assignedSpecialStructure.store.getFreeCapacity(mineralType));
            }
            if (hadSpecialAssignment)
            {
                if (!assignedSpecialStructure)
                {
                    // The assigned special structure was removed or the assignment
                    // became invalid, so this body can safely become a normal lorry.
                    retireAsLorry(creep);
                    return;
                }
                // processPower() frees 1 power per tick; batch Power Spawn
                // reloads instead of shuttling 1-2 power every other tick.
                var minReload = assignedSpecialStructure.structureType == STRUCTURE_POWER_SPAWN
                    ? Math.min(50, creep.store.getCapacity(mineralType) || 50)
                    : 1;
                if (desiredAmount < minReload)
                {
                    if (tryWithdrawPowerSpawnEnergy(creep, assignedSpecialStructure))
                    {
                        return;
                    }
                    waitForSpecialStructureRefill(creep, assignedSpecialStructure);
                    return;
                }
            }
            else if (hadLabAssignment && (!assignedLab || desiredAmount <= 0))
            {
                // The assigned lab filled while this loader was alive. Do not
                // withdraw a load that would only bounce back.
                retireAsLorry(creep);
                return;
            }

            var sourceContainer = getSourceContainer(creep);
            if (sourceContainer && sourceContainer.store.getUsedCapacity(mineralType) > 0)
            {
                if (assignedSpecialStructure)
                {
                    resumeSpecialStructureLoad(creep);
                }
                withdrawMineral(creep, sourceContainer, mineralType, desiredAmount);
            }
            else if (creep.memory.sourceContainerId != undefined)
            {
                delete creep.memory.sourceContainerId;
                if (assignedSpecialStructure)
                {
                    waitForSpecialStructureRefill(creep, assignedSpecialStructure);
                }
                else
                {
                    retireAsLorry(creep);
                }
            }
            else if (creep.room.terminal && creep.room.terminal.store.getUsedCapacity(mineralType) > 0)
            {
                if (assignedSpecialStructure)
                {
                    resumeSpecialStructureLoad(creep);
                }
                withdrawMineral(creep, creep.room.terminal, mineralType, desiredAmount);
            }
            else if (creep.room.storage && creep.room.storage.store.getUsedCapacity(mineralType) > 0)
            {
                if (assignedSpecialStructure)
                {
                    resumeSpecialStructureLoad(creep);
                }
                withdrawMineral(creep, creep.room.storage, mineralType, desiredAmount);
            }
            else if (assignedSpecialStructure)
            {
                // Power remains the first priority, but if no power stock is
                // currently available, use this dedicated loader to keep the
                // Power Spawn's energy channel supplied from reserve surplus.
                if (tryWithdrawPowerSpawnEnergy(creep, assignedSpecialStructure))
                {
                    return;
                }
                // Keep the dedicated loader parked and assigned until additional
                // power/ghodium or reserve-safe energy becomes available.
                waitForSpecialStructureRefill(creep, assignedSpecialStructure);
            }
            else if (!creep.room.terminal)
            {
                roleLorry.run(creep);
            }
            else
            {
                retireAsLorry(creep);
            }
        }
        else
        {
            carriedMineral = getCarriedMineral(creep, mineralType);
            if (carriedMineral <= 0)
            {
                creep.memory.empty = true;
                return;
            }

            var hadSpecialAssignment = creep.memory.specialStructureId != undefined;
            var assignedLab = getAssignedLab(creep, mineralType);
            var assignedSpecialStructure = getAssignedSpecialStructure(creep, mineralType);
            var structure = undefined;
            var transferAmount = carriedMineral;
            if (assignedSpecialStructure
                && assignedSpecialStructure.store.getFreeCapacity(mineralType) > 0)
            {
                structure = assignedSpecialStructure;
                transferAmount = Math.min(carriedMineral,
                    assignedSpecialStructure.store.getFreeCapacity(mineralType));
            }
            else if (hadSpecialAssignment)
            {
                structure = getStorageDeliveryTarget(creep, mineralType);
            }
            else if (creep.memory.sourceContainerId != undefined)
            {
                structure = getStorageDeliveryTarget(creep, mineralType);
            }
            else if (assignedLab && assignedLab.store.getFreeCapacity(mineralType) > 0)
            {
                structure = assignedLab;
                transferAmount = Math.min(carriedMineral, assignedLab.store.getFreeCapacity(mineralType));
            }
            else if (assignedLab && assignedLab.store.getFreeCapacity(mineralType) <= 0)
            {
                structure = getStorageDeliveryTarget(creep, mineralType);
            }
            else
            {
                structure = findGenericLabTarget(creep, mineralType);
            }
            if (structure == undefined)
            {
                structure = getStorageDeliveryTarget(creep, mineralType);
            }
            if (structure != undefined)
            {
                var transferResult = transferMineral(creep, structure, mineralType, transferAmount);
                if (transferResult == OK && structure.structureType != STRUCTURE_LAB
                    && creep.memory.specialStructureId == undefined
                    && transferAmount >= carriedMineral)
                {
                    retireAsLorry(creep);
                }
            }
        }
    }
};

module.exports = rolemineralLorry;