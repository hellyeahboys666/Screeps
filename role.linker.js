var energyFallback = require('energy.fallback');
var sourceLinkUtils = require('source.link');

var roleLinker = {

    /** @param {Creep} creep **/
    run: function(creep) {
        var storage = creep.room.storage;
        var CLink = undefined;
        if (creep.room.controller)
        {
            var CLinks = sourceLinkUtils.findUsableControllerLinks(creep.room.controller);
            CLink = creep.pos.findClosestByPath(CLinks)
                || creep.pos.findClosestByRange(CLinks)
                || CLinks[0];
        }
        var BLink = storage ? storage.pos.findInRange(FIND_MY_STRUCTURES, 3, 
        {
            filter: (s) => s.structureType == STRUCTURE_LINK
        })[0] : undefined;
        var economyMode = getLinkerEconomyMode(creep);
        if (creep.memory.role == 'Clinker' && economyMode == 'builderPriority')
        {
            creep.memory.role = 'Blinker';
            if (creep.memory._move)
            {
                delete creep.memory._move;
            }
        }
        var role = creep.memory.role;

        if (creep.carry.energy == creep.carryCapacity)
        {
            creep.memory.empty = false;
        }
        else if (creep.carry.energy == 0)
        {
            creep.memory.empty = true;
        }

        if (role == 'Slinker')
        {
            var f = creep.memory.flag ? Game.flags[creep.memory.flag] : undefined;
            var source = isValidSlinkerFlag(f, creep.room.name) ? getSlinkerFlagSource(f) : undefined;
            if (!source || isSlinkerSourceAssigned(source.id, creep))
            {
                delete creep.memory.flag;
                delete creep.memory.sourceId;
                var unassignedFlags = creep.room.find(FIND_FLAGS,
                {
                    filter: (flag) =>
                    {
                        var flagSource = getSlinkerFlagSource(flag);
                        return isValidSlinkerFlag(flag, creep.room.name)
                            && flagSource
                            && !isSlinkerFlagAssigned(flag.name, creep)
                            && !isSlinkerSourceAssigned(flagSource.id, creep);
                    }
                });
                f = creep.pos.findClosestByPath(unassignedFlags)
                    || creep.pos.findClosestByRange(unassignedFlags)
                    || unassignedFlags[0];
                source = f ? getSlinkerFlagSource(f) : undefined;
                if (f && source)
                {
                    creep.memory.flag = f.name;
                    creep.memory.sourceId = source.id;
                }
            }
            if (!f || !source)
            {
                return;
            }
            creep.memory.sourceId = source.id;
            var sourceLinks = sourceLinkUtils.findUsableSourceLinks(source);
            var SLink = creep.pos.findClosestByPath(sourceLinks)
                || creep.pos.findClosestByRange(sourceLinks)
                || sourceLinks[0];
            var seat = SLink ? sourceLinkUtils.findSharedSourceLinkSeat(creep, source, SLink) : undefined;
            var moveToSeat = seat && !sourceLinkUtils.isSharedSourceLinkSeat(creep.pos, source, SLink);
            if (SLink && creep.carry.energy > 0)
            {
                if(creep.transfer(SLink, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE)
                {
                    moveToSeat = true;
                }
            }
            if (source)
            {
                var harvestResult = creep.harvest(source);
                if (harvestResult == ERR_NOT_IN_RANGE)
                {
                    moveToSeat = true;
                }
            }
            if (moveToSeat)
            {
                if (seat)
                {
                    creep.moveTo(seat, {reusePath: 10});
                }
                else if (SLink && creep.carry.energy > 0)
                {
                    creep.moveTo(SLink);
                }
                else if (source)
                {
                    creep.moveTo(source);
                }
            }
            var receiverLink = BLink || CLink;
            if (SLink && receiverLink && receiverLink.id != SLink.id
                && SLink.store.getFreeCapacity(RESOURCE_ENERGY) < 30
                && receiverLink.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
            {
                var transferAmount = Math.min(SLink.store.getUsedCapacity(RESOURCE_ENERGY),
                    receiverLink.store.getFreeCapacity(RESOURCE_ENERGY));
                if (transferAmount > 0)
                {
                    SLink.transferEnergy(receiverLink, transferAmount);
                }
            }
        }
        else if (role == 'Clinker')
        {
            if (creep.memory.empty == true)
            {
                if (energyFallback.pickupSpawnDropPile(creep, 100, 1))
                {
                    return;
                }

                if (CLink && CLink.store.getUsedCapacity(RESOURCE_ENERGY) > 0)
                {
                    if(creep.withdraw(CLink, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) 
                    {
                        creep.moveTo(CLink);
                    }
                }
                else if (storage && storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0)
                {
                    if(creep.withdraw(storage, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE)
                    {
                        creep.moveTo(storage);
                    }
                }
            }
            else
            {
                if(creep.room.controller && creep.room.controller.my
                    && creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE)
                {
                    creep.moveTo(creep.room.controller, {range: 3, reusePath: 10});
                }
            }
            if (CLink && BLink && CLink.id != BLink.id
                && CLink.store.getFreeCapacity(RESOURCE_ENERGY) > 0
                && BLink.store.getUsedCapacity(RESOURCE_ENERGY) > 0)
            {
                var amount = Math.min(BLink.store.getUsedCapacity(RESOURCE_ENERGY),
                    CLink.store.getFreeCapacity(RESOURCE_ENERGY));
                BLink.transferEnergy(CLink, amount);
            }
        }
        else if (role == 'Blinker')
        {
            runBlinker(creep, BLink, CLink, storage, economyMode);
        }
    }
};

function getLinkerEconomyMode(creep)
{
    if (creep.room.memory && creep.room.memory.economyMode)
    {
        return creep.room.memory.economyMode;
    }
    var spawns = creep.room.find(FIND_MY_SPAWNS);
    for (let spawn of spawns)
    {
        if (spawn.memory && spawn.memory.economyMode)
        {
            return spawn.memory.economyMode;
        }
    }
    return 'balanced';
}

function getStoreUsedEnergy(target)
{
    if (!target || !target.store)
    {
        return 0;
    }
    return target.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
}

function getStoreFreeEnergy(target)
{
    if (!target || !target.store)
    {
        return 0;
    }
    return target.store.getFreeCapacity(RESOURCE_ENERGY) || 0;
}

function findBlinkerWithdrawTarget(BLink, CLink, economyMode)
{
    if (BLink && getStoreUsedEnergy(BLink) > 0)
    {
        return BLink;
    }
    if (economyMode == 'builderPriority' && CLink && getStoreUsedEnergy(CLink) > 0)
    {
        return CLink;
    }
    return undefined;
}

function findBlinkerDepositTarget(creep, storage)
{
    if (storage && getStoreFreeEnergy(storage) > 0)
    {
        return storage;
    }
    if (creep.room.terminal && getStoreFreeEnergy(creep.room.terminal) > 0)
    {
        return creep.room.terminal;
    }
    var containers = creep.room.find(FIND_STRUCTURES,
    {
        filter: (s) => s.structureType == STRUCTURE_CONTAINER
            && getStoreFreeEnergy(s) > 0
    });
    return creep.pos.findClosestByPath(containers)
        || creep.pos.findClosestByRange(containers)
        || containers[0];
}

function runBlinker(creep, BLink, CLink, storage, economyMode)
{
    if (creep.memory.empty == true)
    {
        var withdrawTarget = findBlinkerWithdrawTarget(BLink, CLink, economyMode);
        if (withdrawTarget)
        {
            if (creep.withdraw(withdrawTarget, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE)
            {
                creep.moveTo(withdrawTarget, {range: 1, reusePath: 10});
            }
            return;
        }
        var waitTarget = BLink || storage;
        if (waitTarget && !creep.pos.inRangeTo(waitTarget, 1))
        {
            creep.moveTo(waitTarget, {range: 1, reusePath: 20});
        }
        return;
    }

    var depositTarget = findBlinkerDepositTarget(creep, storage);
    if (depositTarget)
    {
        if (creep.transfer(depositTarget, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE)
        {
            creep.moveTo(depositTarget, {range: 1, reusePath: 10});
        }
        return;
    }
    energyFallback.dropAtSpawnPile(creep);
}

function getSlinkerFlagSource(flag)
{
    if (!flag || !flag.room)
    {
        return undefined;
    }
    return flag.pos.findClosestByRange(FIND_SOURCES);
}

function isValidSlinkerFlag(flag, roomName)
{
    if (!flag || flag.color != COLOR_WHITE || !flag.room || flag.room.name != roomName)
    {
        return false;
    }
    var source = getSlinkerFlagSource(flag);
    return sourceLinkUtils.findUsableSourceLinks(source).length > 0;
}

function isSlinkerFlagAssigned(flagName, creep)
{
    for (let name in Game.creeps)
    {
        let other = Game.creeps[name];
        if (other.name != creep.name
            && other.memory.role == 'Slinker'
            && other.memory.flag == flagName)
        {
            return true;
        }
    }
    return false;
}

function getSlinkerAssignedSourceId(creep)
{
    var flag = creep.memory.flag ? Game.flags[creep.memory.flag] : undefined;
    if (!isValidSlinkerFlag(flag, creep.room.name))
    {
        return undefined;
    }
    var source = getSlinkerFlagSource(flag);
    return source ? source.id : undefined;
}

function isSlinkerSourceAssigned(sourceId, creep)
{
    for (let name in Game.creeps)
    {
        let other = Game.creeps[name];
        if (other.name != creep.name
            && other.memory.role == 'Slinker'
            && getSlinkerAssignedSourceId(other) == sourceId)
        {
            return true;
        }
    }
    return false;
}

module.exports = roleLinker;