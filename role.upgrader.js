var energyFallback = require('energy.fallback');
var depotUtils = require('remote.build.depot');
var workPosition = require('work.position');

var MIN_CONTROLLER_BUFFER_WITHDRAW_ENERGY = 200;

function getFreeEnergyCapacity(creep)
{
    if (creep.store)
    {
        return creep.store.getFreeCapacity(RESOURCE_ENERGY);
    }
    return creep.carryCapacity - creep.carry.energy;
}

function hasUsefulControllerBufferEnergy(creep, structure)
{
    var stored = structure.store.getUsedCapacity(RESOURCE_ENERGY);
    var needed = Math.min(MIN_CONTROLLER_BUFFER_WITHDRAW_ENERGY, getFreeEnergyCapacity(creep));
    return stored >= needed;
}

function isRcl8MinimalUpgradeTick(creep)
{
    var controller = creep.room.controller;
    if (!controller || controller.level < 8)
    {
        return true;
    }

    var upgraders = creep.room.find(FIND_MY_CREEPS,
    {
        filter: (candidate) => candidate.memory.role == 'upgrader'
            && candidate.getActiveBodyparts(WORK) > 0
    });
    upgraders.sort(function(left, right)
    {
        var workDifference = left.getActiveBodyparts(WORK) - right.getActiveBodyparts(WORK);
        if (workDifference != 0)
        {
            return workDifference;
        }
        return left.name < right.name ? -1 : (left.name > right.name ? 1 : 0);
    });
    if (upgraders.length == 0 || upgraders[0].id != creep.id)
    {
        return false;
    }

    // RCL8 accepts at most 15 upgrade energy per tick. Throttle legacy
    // large upgraders to a one-energy-per-tick average until they expire.
    var energyPerUpgrade = Math.min(15, creep.getActiveBodyparts(WORK));
    return energyPerUpgrade <= 1 || Game.time % energyPerUpgrade == 0;
}

var roleUpgrader = {

    /** @param {Creep} creep **/
    run: function(creep) {
        if (!creep.room.controller || !creep.room.controller.my)
        {
            return;
        }
        if (creep.carry.energy == creep.carryCapacity)
        {
            creep.memory.empty = false;
        }
        else if (creep.carry.energy == 0)
        {
            creep.memory.empty = true;
        }
        if(creep.memory.empty == true) 
        {
            if (energyFallback.pickupSpawnDropPile(creep, 100, 1))
            {
                return;
            }

            var controllerBuffer = undefined;
            if (creep.room.controller)
            {
                var controllerBuffers = creep.room.controller.pos.findInRange(FIND_STRUCTURES, 3,
                {
                    filter: (s) => (s.structureType == STRUCTURE_CONTAINER
                                    || s.structureType == STRUCTURE_LINK)
                        && hasUsefulControllerBufferEnergy(creep, s)
                        && !depotUtils.isRemoteBuildDepotEnergyStructure(s)
                });
                controllerBuffer = creep.pos.findClosestByPath(controllerBuffers);
            }
            var container = controllerBuffer;
            if (container == undefined && energyFallback.withdrawFromPreferredWorkerStore(creep))
            {
                return;
            }
            if (container == undefined)
            {
                container = creep.pos.findClosestByPath(FIND_STRUCTURES,
                {
                    filter: (s) => s.structureType == STRUCTURE_CONTAINER
                    && s.store.getUsedCapacity(RESOURCE_ENERGY) > 0
                    && !depotUtils.isRemoteBuildDepotEnergyStructure(s)
                });
            }
            if (container != undefined)
            {
                if(creep.withdraw(container, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) 
                {
                    creep.moveTo(container, {reusePath: 10});
                }
            }
            if (container == undefined)
            {
                var target = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, 
                {
                    filter: (r) => r.amount > 200
                        && r.resourceType == RESOURCE_ENERGY
                        && !energyFallback.isSpawnDropPile(r)
                });
                if (target)
                {
                    if(creep.pickup(target) == ERR_NOT_IN_RANGE)
                    {
                        creep.moveTo(target, {reusePath: 10});
                    }
                }
                else
                {
                    var sources = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
                    if (sources && creep.harvest(sources) == ERR_NOT_IN_RANGE)
                    {
                        creep.moveTo(sources, {reusePath: 10});
                    }
                }
            }
        }
        else if (isRcl8MinimalUpgradeTick(creep))
        {
            var upgradeResult = creep.upgradeController(creep.room.controller);
            if(upgradeResult == ERR_NOT_IN_RANGE) 
            {
                workPosition.moveToWorkTarget(creep, creep.room.controller, 3);
            }
            else if (upgradeResult == OK)
            {
                workPosition.holdWorkPosition(creep, creep.room.controller, 3);
            }
        }
    }
};

module.exports = roleUpgrader;