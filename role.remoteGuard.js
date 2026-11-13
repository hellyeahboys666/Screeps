'use strict';
// Remote guard: RANGED_ATTACK + HEAL kiter sent by manager.remoteGuard to a room
// where our remote workers meet Invaders. It fights any threat in the room it is
// in (also on the way), heals itself and nearby workers, keeps out of melee reach,
// and once the room is quiet escorts the workers until it is needed elsewhere or
// goes home to be recycled. Memory: {role: 'remoteGuard', target, home}.
var combatMath = require('combat.math');
var guards = require('manager.remoteGuard');

var ESCORT_TICKS = 300;        // stay with the workers this long after the last fight
var RETREAT_RATIO = 0.4;       // back off below this share of hits...
var RESUME_RATIO = 0.8;        // ...until healed to this
var MELEE_KEEP_RANGE = 3;      // stay this far from ATTACK creeps
var WORKER_ROLES = {longDistanceHarvester: true, remoteLorry: true, reserver: true, remoteBuilder: true,
    remoteCarrier: true, claimer: true, looter: true};

function travel(creep, pos, range)
{
    return creep.moveTo(pos, {range: range, reusePath: 10, maxOps: 4000});
}

function flee(creep, threats, range)
{
    var result = PathFinder.search(creep.pos, threats.map(function(h) { return {pos: h.pos, range: range}; }),
        {flee: true, maxRooms: 1, maxOps: 500});
    if (result.path && result.path.length)
    {
        creep.move(creep.pos.getDirectionTo(result.path[0]));
        return true;
    }
    return false;
}

// Healers first (they undo our damage), then the creep that dies soonest.
function chooseTarget(creep, hostiles)
{
    var scored = hostiles.map(function(h) {
        var heals = combatMath.directHealPower(h) > 0;
        var hits = combatMath.damageAfterTough(h, 1000) > 0 ? h.hits * 1000 / combatMath.damageAfterTough(h, 1000) : h.hits;
        var range = creep.pos.getRangeTo(h);
        return {h: h, score: (heals ? 0 : 1e6) + hits + range * 50};
    });
    scored.sort(function(a, b) { return a.score - b.score || (a.h.id < b.h.id ? -1 : 1); });
    return scored[0].h;
}

function attack(creep, target)
{
    var range = creep.pos.getRangeTo(target);
    if (range > 3) return false;
    var near = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3, {filter: function(c) { return guards.isThreat(c, guards.config()); }});
    var mass = 0;
    for (var h of near)
    {
        mass += combatMath.damageAfterTough(h, combatMath.rangedMassAttackPower(creep, creep.pos.getRangeTo(h)));
    }
    var focus = combatMath.damageAfterTough(target, combatMath.rangedAttackPower(creep));
    if (mass > focus) creep.rangedMassAttack();
    else creep.rangedAttack(target);
    return true;
}

// heal() runs alongside rangedAttack; rangedHeal does not, so it is used only when
// nothing was shot this tick.
function heal(creep, shot)
{
    if (!creep.getActiveBodyparts(HEAL)) return;
    if (creep.hits < creep.hitsMax) { creep.heal(creep); return; }
    var hurt = creep.pos.findInRange(FIND_MY_CREEPS, 3, {filter: function(c) { return c.hits < c.hitsMax; }});
    if (!hurt.length) return;
    hurt.sort(function(a, b) { return a.hits / a.hitsMax - b.hits / b.hitsMax; });
    var patient = hurt[0];
    if (creep.pos.isNearTo(patient)) creep.heal(patient);
    else if (!shot) creep.rangedHeal(patient);
}

function fight(creep, hostiles)
{
    delete creep.memory.quietSince;
    if (creep.hits < creep.hitsMax * RETREAT_RATIO) creep.memory.recovering = true;
    else if (creep.hits >= creep.hitsMax * RESUME_RATIO) delete creep.memory.recovering;

    var target = chooseTarget(creep, hostiles);
    var shot = attack(creep, target);
    heal(creep, shot);

    var melee = hostiles.filter(function(h) {
        return combatMath.attackPower(h) > 0 && creep.pos.getRangeTo(h) < MELEE_KEEP_RANGE;
    });
    if (creep.memory.recovering)
    {
        flee(creep, hostiles, 5);
    }
    else if (melee.length)
    {
        flee(creep, melee, MELEE_KEEP_RANGE);
    }
    else if (creep.pos.getRangeTo(target) > 3)
    {
        travel(creep, target.pos, 3);
    }
}

function escort(creep)
{
    if (!creep.memory.quietSince) creep.memory.quietSince = Game.time;
    heal(creep, false);
    if (Game.time - creep.memory.quietSince > ESCORT_TICKS)
    {
        var next = guards.reassignment(creep.memory.target);
        if (next) { creep.memory.target = next; delete creep.memory.quietSince; return; }
        creep.memory.done = true;
        return;
    }
    var workers = creep.room.find(FIND_MY_CREEPS, {filter: function(c) { return c.memory && WORKER_ROLES[c.memory.role]; }});
    var nearest = creep.pos.findClosestByRange(workers);
    if (nearest && creep.pos.getRangeTo(nearest) > 3) travel(creep, nearest.pos, 3);
    else if (!nearest && creep.pos.getRangeTo(25, 25) > 10) travel(creep, new RoomPosition(25, 25, creep.room.name), 10);
}

function goHome(creep)
{
    var home = creep.memory.home;
    if (creep.room.name != home) { travel(creep, new RoomPosition(25, 25, home), 20); return; }
    var spawn = creep.pos.findClosestByRange(FIND_MY_SPAWNS);
    if (!spawn) return;
    if (spawn.recycleCreep(creep) == ERR_NOT_IN_RANGE) travel(creep, spawn.pos, 1);
}

module.exports = {
    run: function(creep)
    {
        if (creep.spawning) return;
        var cfg = guards.config();
        var hostiles = creep.room.find(FIND_HOSTILE_CREEPS, {filter: function(c) { return guards.isThreat(c, cfg); }});
        // Owned rooms have towers and home defenders; guards only fight outside them.
        var owned = creep.room.controller && creep.room.controller.my;
        if (hostiles.length && !owned)
        {
            delete creep.memory.done;
            fight(creep, hostiles);
            return;
        }
        if (creep.memory.done)
        {
            // A new threat while walking home turns the guard around.
            var next = guards.reassignment(null);
            if (next) { creep.memory.target = next; delete creep.memory.done; delete creep.memory.quietSince; }
            else { heal(creep, false); goHome(creep); return; }
        }
        if (creep.room.name != creep.memory.target)
        {
            heal(creep, false);
            travel(creep, new RoomPosition(25, 25, creep.memory.target), 20);
            return;
        }
        escort(creep);
    }
};
