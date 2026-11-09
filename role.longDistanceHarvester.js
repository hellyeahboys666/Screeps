var remoteDanger = require('remote.danger');
var remoteMining = require('manager.remoteMining');

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

// A creep left idle on an exit tile is moved back into the neighbouring room.
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

function findSourceContainer(creep, source)
{
    if (creep.memory.containerId)
    {
        var remembered = Game.getObjectById(creep.memory.containerId);
        if (remembered
            && remembered.structureType == STRUCTURE_CONTAINER
            && source
            && remembered.pos.roomName == creep.room.name
            && remembered.pos.inRangeTo(source, 1))
        {
            return remembered;
        }
        delete creep.memory.containerId;
    }

    if (!source)
    {
        return undefined;
    }
    var container = source.pos.findInRange(FIND_STRUCTURES, 1,
    {
        filter: (s) => s.structureType == STRUCTURE_CONTAINER
    })[0];
    if (container)
    {
        creep.memory.containerId = container.id;
    }
    return container;
}

function unloadIfFull(creep, container)
{
    // No-CARRY drop miners have 0 free capacity forever, but they should still
    // harvest; harvest() will drop energy on the ground for remote lorries.
    if (getUsedEnergy(creep) == 0 || getFreeEnergy(creep) > 0)
    {
        return false;
    }
    if (container && container.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
    {
        if (creep.transfer(container, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE)
        {
            creep.moveTo(container, {reusePath: 5});
        }
        return true;
    }
    creep.drop(RESOURCE_ENERGY);
    return true;
}

var rolelongDistanceHarvester = {

    /** @param {Creep} creep **/
    run: function(creep) {
        if (!creep.memory.target)
        {
            return;
        }
        if (remoteMining.shouldRetireObsoleteDefaultRemoteHarvester(creep))
        {
            creep.suicide();
            return;
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
            }
            else if (!stepOffEdge(creep))
            {
                creep.say('danger');
            }
            return;
        }

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
        if (!source)
        {
            return;
        }

        var container = findSourceContainer(creep, source);

        if (unloadIfFull(creep, container))
        {
            return;
        }

        if (container && !creep.pos.isEqualTo(container.pos))
        {
            creep.moveTo(container, {reusePath: 20});
            return;
        }

        var result = creep.harvest(source);
        if (result == ERR_NOT_IN_RANGE)
        {
            creep.moveTo(source, {reusePath: 20});
        }
        else if (result == ERR_FULL)
        {
            unloadIfFull(creep, container);
        }
    }
};

module.exports = rolelongDistanceHarvester;