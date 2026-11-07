var roleUpgrader = require('role.upgrader');
var energyFallback = require('energy.fallback');
var depotUtils = require('remote.build.depot');
var workPosition = require('work.position');
var DEFAULT_RAMPART_TARGET_HITS = 100000;

function parseRampartTargetHits(value)
{
    if (typeof value == 'number' && isFinite(value) && value >= 0)
    {
        return Math.floor(value);
    }
    if (typeof value == 'string' && value.length > 0)
    {
        var parsed = parseInt(value, 10);
        if (!isNaN(parsed) && parsed >= 0)
        {
            return parsed;
        }
    }
    return undefined;
}

function getRampartRepairTargetHits(creep)
{
    var homeRoomName = creep.room.name;
    if (creep.memory && creep.memory.home != undefined)
    {
        homeRoomName = creep.memory.home;
    }
    for (let spawnName in Game.spawns)
    {
        var spawn = Game.spawns[spawnName];
        if (!spawn || !spawn.room || !spawn.memory || spawn.room.name != homeRoomName)
        {
            continue;
        }
        var configuredTargetHits = parseRampartTargetHits(spawn.memory.rampartTargetHits);
        if (configuredTargetHits != undefined)
        {
            return configuredTargetHits;
        }
    }
    return DEFAULT_RAMPART_TARGET_HITS;
}

function findRampartRepairTarget(creep)
{
    var rampartTargetHits = getRampartRepairTargetHits(creep);
    var ramparts = creep.room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType == STRUCTURE_RAMPART
            && s.hits < rampartTargetHits
    });
    var weakest = undefined;
    for (let rampart of ramparts)
    {
        if (!weakest || rampart.hits < weakest.hits)
        {
            weakest = rampart;
        }
    }
    return weakest;
}

var roleRepairer = {

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
        if(creep.memory.empty == true)
        {
            if (energyFallback.withdrawFromPreferredWorkerStore(creep))
            {
                return;
            }
            if (energyFallback.pickupSpawnDropPile(creep, 100, 1))
            {
                return;
            }

            var target = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, 
            {
                filter: (r) => r.amount > 200
                    && r.resourceType == RESOURCE_ENERGY
                    && !energyFallback.isSpawnDropPile(r)
            });
            if(target != undefined) 
            {
                if(creep.pickup(target) == ERR_NOT_IN_RANGE) 
                {
                    creep.moveTo(target, {reusePath: 10});
                }
            }
            else
            {
                var container = creep.pos.findClosestByPath(FIND_STRUCTURES, 
                {
                    filter: (s) => (s.structureType == STRUCTURE_CONTAINER
                    || s.structureType == STRUCTURE_STORAGE)
                    && s.store.getUsedCapacity(RESOURCE_ENERGY) > 0
                    && !depotUtils.isRemoteBuildDepotEnergyStructure(s)
                });
                if (container != undefined)
                {
                    if(creep.withdraw(container, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) 
                    {
                        creep.moveTo(container, {reusePath: 10});
                    }
                }
                if (container == undefined)
                {
                    var sources = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
                    if (sources && creep.harvest(sources) == ERR_NOT_IN_RANGE) 
                    {
                        creep.moveTo(sources, {reusePath: 10});
                    }
                }
            }
        }
        else{
            // Ordinary structure maintenance belongs to RCL6+ towers. A
            // repairer exists to raise owned ramparts to the room target.
            var structure = findRampartRepairTarget(creep);
            if (structure != undefined)
            {
                var repairResult = creep.repair(structure);
                if (repairResult == ERR_NOT_IN_RANGE)
                {
                    workPosition.moveToWorkTarget(creep, structure, 3);
                }
                else if (repairResult == OK)
                {
                    workPosition.holdWorkPosition(creep, structure, 3);
                }
            }
            else
            {
                roleUpgrader.run(creep);
            }
        }
    }
};

module.exports = roleRepairer;