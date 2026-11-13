'use strict';
// Carries a dead stronghold's loot home: the core's ruin, its containers once their
// ramparts are gone, and tombstones. Memory: {role: 'looter', home, target}.
// Source Keepers share stronghold rooms, so paths keep 4 tiles away from them.

var KEEPER_RANGE = 4;

function keeperCostCallback(roomName, matrix)
{
    var room = Game.rooms[roomName];
    if (!room) return matrix;
    var keepers = room.find(FIND_HOSTILE_CREEPS, {
        filter: function(c) { return c.owner && c.owner.username == 'Source Keeper'; }
    });
    for (var k of keepers)
    {
        for (var dy = -KEEPER_RANGE; dy <= KEEPER_RANGE; dy++) for (var dx = -KEEPER_RANGE; dx <= KEEPER_RANGE; dx++)
        {
            var x = k.pos.x + dx, y = k.pos.y + dy;
            if (x >= 0 && x <= 49 && y >= 0 && y <= 49) matrix.set(x, y, 0xff);
        }
    }
    return matrix;
}

function travel(creep, pos, range)
{
    return creep.moveTo(pos, {range: range, reusePath: 10, maxOps: 4000, costCallback: keeperCostCallback});
}

function storeTotal(store)
{
    return store && typeof store.getUsedCapacity == 'function' ? store.getUsedCapacity() || 0 : 0;
}

function underHostileRampart(object)
{
    return object.pos.lookFor(LOOK_STRUCTURES).some(function(s) {
        return s.structureType == STRUCTURE_RAMPART && !s.my && !s.isPublic;
    });
}

function findLoot(creep)
{
    var room = creep.room;
    var candidates = [];
    if (typeof FIND_RUINS != 'undefined') candidates = candidates.concat(room.find(FIND_RUINS));
    candidates = candidates.concat(room.find(FIND_TOMBSTONES));
    candidates = candidates.concat(room.find(FIND_STRUCTURES, {
        filter: function(s) { return s.structureType == STRUCTURE_CONTAINER; }
    }));
    candidates = candidates.filter(function(o) { return storeTotal(o.store) > 0 && !underHostileRampart(o); });
    var dropped = room.find(FIND_DROPPED_RESOURCES, {filter: function(r) { return r.amount >= 50; }});
    return creep.pos.findClosestByRange(candidates.concat(dropped));
}

function deliver(creep)
{
    var home = Game.rooms[creep.memory.home];
    if (creep.room.name != creep.memory.home || !home)
    {
        travel(creep, new RoomPosition(25, 25, creep.memory.home), 20);
        return;
    }
    var sink = home.terminal && home.terminal.store.getFreeCapacity() > 0 ? home.terminal : home.storage;
    if (!sink)
    {
        return;
    }
    for (var type in creep.store)
    {
        if (creep.store[type] > 0)
        {
            if (creep.transfer(sink, type) == ERR_NOT_IN_RANGE) travel(creep, sink.pos, 1);
            return;
        }
    }
}

function retire(creep)
{
    var spawn = creep.room.name == creep.memory.home
        ? creep.pos.findClosestByRange(FIND_MY_SPAWNS) : undefined;
    if (!spawn)
    {
        travel(creep, new RoomPosition(25, 25, creep.memory.home), 20);
        return;
    }
    if (spawn.recycleCreep(creep) == ERR_NOT_IN_RANGE) travel(creep, spawn.pos, 1);
}

module.exports = {
    run: function(creep)
    {
        if (creep.spawning) return;
        var carried = storeTotal(creep.store);
        // Leave with enough life to walk home (about 60 ticks per room, plus margin).
        var returnTicks = creep.memory.returnTicks || 200;
        if (carried > 0 && (creep.store.getFreeCapacity() == 0 || creep.ticksToLive < returnTicks))
        {
            creep.memory.returning = true;
        }
        if (creep.memory.returning)
        {
            if (carried == 0)
            {
                creep.memory.returning = false;
                if (creep.memory.done || creep.ticksToLive < 2 * returnTicks) { creep.memory.done = true; retire(creep); return; }
            }
            else
            {
                deliver(creep);
                return;
            }
        }
        if (creep.memory.done) { retire(creep); return; }
        if (creep.room.name != creep.memory.target)
        {
            travel(creep, new RoomPosition(25, 25, creep.memory.target), 20);
            return;
        }
        var loot = findLoot(creep);
        if (!loot)
        {
            creep.memory.done = true;
            if (carried > 0) creep.memory.returning = true;
            return;
        }
        var result;
        if (loot.store)
        {
            var type = Object.keys(loot.store).filter(function(k) { return loot.store[k] > 0; })[0];
            result = creep.withdraw(loot, type);
        }
        else
        {
            result = creep.pickup(loot);
        }
        if (result == ERR_NOT_IN_RANGE) travel(creep, loot.pos, 1);
    }
};
