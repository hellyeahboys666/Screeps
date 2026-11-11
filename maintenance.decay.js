'use strict';
// Roads, containers and fresh ramparts decay. RCL6+ towers maintain them, RCL3-5
// towers only rescue them (main.js), and a room with no tower (a newly claimed
// room) has nobody else to repair them, so they quietly disappear. Creeps that
// already carry energy and WORK parts patch them before they are lost.

var CRITICAL_RATIO = 0.25;   // repair even while construction sites are waiting
var REPAIR_RATIO = 0.5;      // repair when there is nothing to build
var RESTORE_RATIO = 0.9;     // once started on a target, top it up to here
var RAMPART_FLOOR_HITS = 3000;     // matches TOWER_RAMPART_DECAY_BUFFER_HITS
var RAMPART_RESTORE_HITS = 10000;
var CONTAINER_START_RATIO = 0.5;   // remote harvester sitting on its container
var CONTAINER_RESTORE_RATIO = 0.9;
// Towers only repair above this reserve (TOWER_MAINTENANCE_ENERGY_RESERVE).
var TOWER_REPAIR_RESERVE = 600;

var cache = {tick: -1, rooms: {}};

function isDecayStructure(s)
{
    if (!s || !(s.hitsMax > 0) || typeof s.hits != 'number')
    {
        return false;
    }
    if (s.structureType == STRUCTURE_ROAD || s.structureType == STRUCTURE_CONTAINER)
    {
        return true;
    }
    return s.structureType == STRUCTURE_RAMPART && s.my === true;
}

// Ramparts have huge hitsMax, so they use an absolute floor instead of a ratio.
function isBelow(s, ratio)
{
    if (s.structureType == STRUCTURE_RAMPART)
    {
        return s.hits < RAMPART_FLOOR_HITS;
    }
    return s.hits < s.hitsMax * ratio;
}

function isRestored(s)
{
    if (s.structureType == STRUCTURE_RAMPART)
    {
        return s.hits >= RAMPART_RESTORE_HITS;
    }
    return s.hits >= s.hitsMax * RESTORE_RATIO;
}

function getRoomCache(room)
{
    var tick = typeof Game != 'undefined' ? Game.time : 0;
    if (cache.tick !== tick)
    {
        cache = {tick: tick, rooms: {}};
    }
    var entry = cache.rooms[room.name];
    if (!entry)
    {
        entry = cache.rooms[room.name] = {};
    }
    return entry;
}

function hasActiveTower(room)
{
    if (!room || !room.controller || !room.controller.my)
    {
        return false;
    }
    var entry = getRoomCache(room);
    if (entry.hasActiveTower === undefined)
    {
        var towers = room.find(FIND_MY_STRUCTURES, {
            filter: (s) => s.structureType == STRUCTURE_TOWER
                && s.isActive() !== false
                && s.store && s.store.getUsedCapacity(RESOURCE_ENERGY) >= TOWER_REPAIR_RESERVE
        });
        entry.hasActiveTower = towers.length > 0;
    }
    return entry.hasActiveTower;
}

// Creeps repair only where no tower does it: any room without a tower of ours
// fueled past its repair reserve (new rooms, remote rooms, starved towers).
// Tower rooms keep their energy-saving policy.
function needsCreepRepair(room)
{
    return !!room && !hasActiveTower(room);
}

function getDecaying(room)
{
    var entry = getRoomCache(room);
    if (!entry.decaying)
    {
        entry.decaying = room.find(FIND_STRUCTURES, {
            filter: (s) => isDecayStructure(s) && isBelow(s, REPAIR_RATIO)
        });
    }
    return entry.decaying;
}

function findTarget(creep, ratio)
{
    var candidates = getDecaying(creep.room).filter((s) => isBelow(s, ratio));
    if (candidates.length == 0)
    {
        return undefined;
    }
    return creep.pos.findClosestByRange(candidates);
}

function getWorkParts(creep)
{
    if (typeof creep.getActiveBodyparts == 'function')
    {
        return creep.getActiveBodyparts(WORK);
    }
    return (creep.body || []).filter((p) => p.type == WORK && p.hits > 0).length;
}

function getEnergy(creep)
{
    if (creep.store && typeof creep.store.getUsedCapacity == 'function')
    {
        return creep.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
    }
    return (creep.carry && creep.carry.energy) || 0;
}

// Repair (or walk to) a decaying structure in the creep's room. A target found
// below `ratio` is kept until restored, so a creep does not stop at the trigger
// line and come back a few hundred ticks later. Returns true if the creep acted.
function run(creep, ratio)
{
    if (!creep || !creep.room || getEnergy(creep) <= 0 || getWorkParts(creep) <= 0)
    {
        return false;
    }
    var target = creep.memory.decayRepairId ? Game.getObjectById(creep.memory.decayRepairId) : null;
    if (!target || !target.pos || target.pos.roomName != creep.room.name
        || !isDecayStructure(target) || isRestored(target))
    {
        delete creep.memory.decayRepairId;
        target = findTarget(creep, ratio === undefined ? REPAIR_RATIO : ratio);
        if (!target)
        {
            return false;
        }
        creep.memory.decayRepairId = target.id;
    }
    var result = creep.repair(target);
    if (result == ERR_NOT_IN_RANGE)
    {
        creep.moveTo(target, {range: 3, reusePath: 10});
        return true;
    }
    if (result != OK)
    {
        delete creep.memory.decayRepairId;
        return false;
    }
    return true;
}

// A harvester standing on its container patches it from carried energy instead
// of dropping that energy in. Remote containers lose 5000 hits per 100 ticks and
// are gone in ~5000 ticks without this. Returns true if the creep repaired.
function repairOwnContainer(creep, container)
{
    if (!creep || !container || container.structureType != STRUCTURE_CONTAINER
        || !creep.pos || !creep.pos.isEqualTo(container.pos)
        || getEnergy(creep) <= 0 || getWorkParts(creep) <= 0)
    {
        if (creep && creep.memory) delete creep.memory.repairingContainer;
        return false;
    }
    var ratio = container.hits / container.hitsMax;
    var start = creep.memory.repairingContainer ? CONTAINER_RESTORE_RATIO : CONTAINER_START_RATIO;
    if (ratio >= start)
    {
        delete creep.memory.repairingContainer;
        return false;
    }
    if (creep.repair(container) == OK)
    {
        creep.memory.repairingContainer = true;
        return true;
    }
    delete creep.memory.repairingContainer;
    return false;
}

module.exports = {
    CRITICAL_RATIO: CRITICAL_RATIO,
    REPAIR_RATIO: REPAIR_RATIO,
    needsCreepRepair: needsCreepRepair,
    run: run,
    repairOwnContainer: repairOwnContainer
};
