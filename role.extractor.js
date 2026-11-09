function getRoomMineral(creep)
{
    if (creep.memory.mineralId)
    {
        var cached = Game.getObjectById(creep.memory.mineralId);
        if (cached && cached.pos && cached.pos.roomName == creep.room.name)
        {
            return cached;
        }
        delete creep.memory.mineralId;
    }
    var minerals = creep.room.find(FIND_MINERALS);
    var mineral = minerals[0];
    if (mineral)
    {
        creep.memory.mineralId = mineral.id;
    }
    return mineral;
}

function getMineralExtractor(creep, mineral)
{
    if (creep.memory.extractorId)
    {
        var cached = Game.getObjectById(creep.memory.extractorId);
        if (cached && cached.structureType == STRUCTURE_EXTRACTOR
            && cached.pos.roomName == mineral.pos.roomName
            && cached.pos.inRangeTo(mineral, 1))
        {
            return cached;
        }
        delete creep.memory.extractorId;
    }
    var extractor = mineral.pos.findInRange(FIND_MY_STRUCTURES, 1,
    {
        filter: (s) => s.structureType == STRUCTURE_EXTRACTOR
    })[0];
    if (extractor)
    {
        creep.memory.extractorId = extractor.id;
    }
    return extractor;
}

var roleExtractor = {

    /** @param {Creep} creep **/
    run: function(creep) {
        var mineral = getRoomMineral(creep);
        if (!mineral)
        {
            return;
        }
        creep.memory.mineralType = mineral.mineralType;
        if (creep.store.getFreeCapacity(creep.memory.mineralType) == 0)
        {
            creep.memory.empty = false;
        }
        else if (creep.store.getUsedCapacity(creep.memory.mineralType) == 0)
        {
            creep.memory.empty = true;
        }
        else if (creep.memory.empty == true && mineral.mineralAmount == 0)
        {
            // Mineral exhausted mid-load: bank the partial load.
            creep.memory.empty = false;
        }
        if(creep.memory.empty == true) 
        {
            var target = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, 
            {
                filter: (r) => r.amount > 50 && r.resourceType == creep.memory.mineralType
            });
            if(target != undefined) 
            {
                if(creep.pickup(target) == ERR_NOT_IN_RANGE) 
                {
                    creep.moveTo(target);
                }
            }
            else
            {
                var extractor = getMineralExtractor(creep, mineral);
                if (extractor && mineral.mineralAmount > 0
                    && creep.harvest(mineral) == ERR_NOT_IN_RANGE)
                {
                    creep.moveTo(mineral);
                }
            }
        }
        else
        {
            var structure = undefined;
            if (creep.room.terminal
                && creep.room.terminal.store.getFreeCapacity(creep.memory.mineralType) > 0)
            {
                structure = creep.room.terminal;
            }
            if (structure == undefined && creep.room.storage
                && creep.room.storage.store.getFreeCapacity(creep.memory.mineralType) > 0)
            {
                structure = creep.room.storage;
            }
            if (structure != undefined)
            {
                if(creep.transfer(structure, creep.memory.mineralType) == ERR_NOT_IN_RANGE) 
                {
                    creep.moveTo(structure);
                }
            }
        }
    }
};

module.exports = roleExtractor;