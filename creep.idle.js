'use strict';
// Haulers often have nothing to do (every sink full, nothing to pick up) and would
// re-run their whole search chain, path searches included, every tick. A hauler that
// stood on the same tile with the same load and no move order for IDLE_STREAK ticks
// sleeps IDLE_SLEEP ticks. It never sleeps while its room has seen hostiles.
var IDLE_STREAK = 3;
var IDLE_SLEEP = 4;

function roomHot(creep)
{
    var mem = creep.room && creep.room.memory;
    return !!(mem && mem.hostileCount > 0 && mem.hostileLastSeen >= Game.time - 1);
}

function movedThisTick(creep)
{
    var store = typeof Creep != 'undefined' && Creep.prototype ? Creep.prototype.__trafficMoveStore : undefined;
    return !!(store && store.tick == Game.time && store.dirs[creep.name] !== undefined);
}

// true = skip this tick's role logic.
function sleeping(creep)
{
    var s = creep.memory._idle;
    if (!s || !(s.until > Game.time)) return false;
    if (roomHot(creep)) { delete s.until; return false; }
    return true;
}

// Call after the role ran this tick.
function record(creep)
{
    var load = creep.store.getUsedCapacity();
    var s = creep.memory._idle || (creep.memory._idle = {});
    var still = !movedThisTick(creep) && !(creep.fatigue > 0)
        && s.t === Game.time - 1 && s.x === creep.pos.x && s.y === creep.pos.y
        && s.r === creep.pos.roomName && s.load === load;
    s.n = still ? (s.n || 0) + 1 : 0;
    s.t = Game.time; s.x = creep.pos.x; s.y = creep.pos.y; s.r = creep.pos.roomName; s.load = load;
    if (s.n >= IDLE_STREAK && !roomHot(creep))
    {
        s.until = Game.time + 1 + IDLE_SLEEP;
        s.n = 0;
    }
}

module.exports = {sleeping: sleeping, record: record, IDLE_STREAK: IDLE_STREAK, IDLE_SLEEP: IDLE_SLEEP};
