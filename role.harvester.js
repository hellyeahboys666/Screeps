var roleBuilder = require('role.builder');
var energyFallback = require('energy.fallback');
var CONTROLLER_DOWNGRADE_SAFETY_TICKS = 5000;

function shouldEmergencyUpgrade(creep)
{
    return creep.room.controller
        && creep.room.controller.my
        && creep.room.controller.ticksToDowngrade != undefined
        && creep.room.controller.ticksToDowngrade < CONTROLLER_DOWNGRADE_SAFETY_TICKS;
}

function emergencyUpgrade(creep)
{
    if(creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE)
    {
        creep.moveTo(creep.room.controller, {range: 3, reusePath: 10});
    }
}

function getAssignedSource(creep)
{
    if (creep.memory.sourceId != undefined)
    {
        var assignedSource = Game.getObjectById(creep.memory.sourceId);
        if (assignedSource != undefined && assignedSource.room.name == creep.room.name)
        {
            return assignedSource;
        }
        delete creep.memory.sourceId;
    }

    var sources = creep.room.find(FIND_SOURCES);
    if (sources.length == 0)
    {
        return undefined;
    }

    var sourceCounts = {};
    for (let source of sources)
    {
        sourceCounts[source.id] = 0;
    }

    var harvesters = creep.room.find(FIND_MY_CREEPS,
    {
        filter: (c) => c.name != creep.name
            && c.memory.role == 'harvester'
            && c.memory.sourceId != undefined
    });
    for (let harvester of harvesters)
    {
        if (sourceCounts[harvester.memory.sourceId] != undefined)
        {
            sourceCounts[harvester.memory.sourceId]++;
        }
    }

    sources.sort(function(a, b)
    {
        var countDiff = sourceCounts[a.id] - sourceCounts[b.id];
        if (countDiff != 0)
        {
            return countDiff;
        }
        if ((a.energy > 0) != (b.energy > 0))
        {
            return a.energy > 0 ? -1 : 1;
        }
        return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
    });

    creep.memory.sourceId = sources[0].id;
    return sources[0];
}

var roleHarvester = {

    /** @param {Creep} creep **/
    run: function(creep) {
        if (creep.carry.energy == creep.carryCapacity)
        {
            creep.memory.empty = false;
        }
        else if (creep.carry.energy == 0)
        {
            creep.memory.empty = true;
        }
        var source = getAssignedSource(creep);
        if(creep.memory.empty == true) {
            if (energyFallback.pickupSpawnDropPile(creep, 100, 1))
            {
                return;
            }

            if (source)
            {
                if(creep.harvest(source) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(source, {reusePath: 10});
                }
            }
            else if (creep.room.storage && creep.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0)
            {
                if(creep.withdraw(creep.room.storage, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(creep.room.storage, {reusePath: 10});
                }
            }
        }
        else{
            if (shouldEmergencyUpgrade(creep))
            {
                emergencyUpgrade(creep);
                return;
            }
            var structure = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
                filter: (s) => (s.structureType == STRUCTURE_SPAWN
                            ||  s.structureType == STRUCTURE_EXTENSION
                            || s.structureType == STRUCTURE_TOWER) &&
                                s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
            });
            if (structure == undefined && creep.room.storage
                && creep.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
            {
                structure = creep.room.storage;
            }
            if (structure == undefined)
            {
                structure = creep.pos.findClosestByPath(FIND_STRUCTURES,
                {
                    filter: (s) => s.structureType == STRUCTURE_CONTAINER
                        && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
                });
            }
            if (structure == undefined)
            {
                roleBuilder.run(creep);
            }
            if (structure != undefined)
            {
                if(creep.transfer(structure, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) 
                {
                    creep.moveTo(structure, {reusePath: 10});
                }
            }
        }
    }
};

module.exports = roleHarvester;