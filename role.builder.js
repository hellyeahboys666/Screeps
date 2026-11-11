var roleUpgrader = require('role.upgrader');
var roleRepairer = require('role.repairer');
var energyFallback = require('energy.fallback');
var depotUtils = require('remote.build.depot');
var workPosition = require('work.position');
var decayRepair = require('maintenance.decay');
var CONTROLLER_DOWNGRADE_SAFETY_TICKS = 5000;

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

function shouldEmergencyUpgrade(creep)
{
    return creep.room.controller
        && creep.room.controller.my
        && creep.room.controller.ticksToDowngrade != undefined
        && creep.room.controller.ticksToDowngrade < CONTROLLER_DOWNGRADE_SAFETY_TICKS;
}

function emergencyUpgrade(creep)
{
    var result = creep.upgradeController(creep.room.controller);
    if(result == ERR_NOT_IN_RANGE)
    {
        workPosition.moveToWorkTarget(creep, creep.room.controller, 3);
    }
    else if (result == OK)
    {
        workPosition.holdWorkPosition(creep, creep.room.controller, 3);
    }
}

function getConstructionPriority(site)
{
    if (site.structureType == STRUCTURE_SPAWN)
    {
        return 1;
    }
    if (site.structureType == STRUCTURE_EXTENSION)
    {
        return 2;
    }
    if (site.structureType == STRUCTURE_TOWER)
    {
        return 3;
    }
    if (site.structureType == STRUCTURE_STORAGE)
    {
        return 4;
    }
    if (site.structureType == STRUCTURE_CONTAINER)
    {
        return 5;
    }
    return 6;
}

function findBuildTarget(creep)
{
    var sites = creep.room.find(FIND_CONSTRUCTION_SITES);
    var bestPriority = undefined;
    var candidates = [];
    for (let site of sites)
    {
        let priority = getConstructionPriority(site);
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
    // Builders can work from range 3.  Some edge/choke construction sites are
    // reachable from range 3 even when pathing to an adjacent tile fails, so do
    // not drop the build target just because findClosestByPath(... default
    // range) cannot find a range-1 path.
    return creep.pos.findClosestByPath(candidates, {range: 3})
        || creep.pos.findClosestByRange(candidates)
        || candidates[0];
}

function getBuilderEconomyMode(creep)
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

var roleBuilder = {

    /** @param {Creep} creep **/
    run: function(creep) {
        if (creep.memory.target != undefined && creep.room.name != creep.memory.target)
        {
            moveToRoom(creep, creep.memory.target);
            return;
        }
        else
    {
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
                return;
            }

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
                return;
            }

            var sources = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
            if (sources)
            {
                if(creep.harvest(sources) == ERR_NOT_IN_RANGE) 
                {
                    creep.moveTo(sources, {reusePath: 10});
                }
            }
        }
        else
        {
            if (shouldEmergencyUpgrade(creep))
            {
                emergencyUpgrade(creep);
                return;
            }
            // With no tower in the room, builders are the only repairers: save
            // a nearly-decayed road or container before building the next site.
            var creepRepairRoom = decayRepair.needsCreepRepair(creep.room);
            if (creepRepairRoom && decayRepair.run(creep, decayRepair.CRITICAL_RATIO))
            {
                return;
            }
            var constructionSite = findBuildTarget(creep);
            if (constructionSite != undefined)
            {
                var buildResult = creep.build(constructionSite);
                if(buildResult == ERR_NOT_IN_RANGE) 
                {
                    workPosition.moveToWorkTarget(creep, constructionSite, 3);
                }
                else if (buildResult == OK)
                {
                    workPosition.holdWorkPosition(creep, constructionSite, 3);
                }
            }
            else if (creepRepairRoom && decayRepair.run(creep, decayRepair.REPAIR_RATIO))
            {
                return;
            }
            else
            {
                if (getBuilderEconomyMode(creep) == 'builderPriority')
                {
                    roleRepairer.run(creep);
                }
                else
                {
                    roleUpgrader.run(creep);
                }
            }
        }
    }
    }
};

module.exports = roleBuilder;