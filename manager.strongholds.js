'use strict';
// Invader strongholds (core level 1-5) in our sector. Observers find them, an
// assessment decides whether a fully boosted quad can kill the core, the normal
// quad system does the fighting (Memory.spawnQuad + Memory.quads[squad].targetId),
// and looters carry the reward home afterwards.
//
// Engine facts (screeps/common lib/strongholds.js + constants.js, engine
// processor/intents/invader-core/stronghold):
//   level             1      2      3      4      5
//   towers            1      2      3      4      6
//   rampart hits      100k   200k   500k   1M     2M    (every structure is under one)
//   defenders         -      1x15A  2x25A  4 of: T1 25A / T1 25RA / T3 fortifier
//                                                 fortifier + 8 T3 44A or 44RA
// The core has 100k hits and runs every tower and defender: once it dies they go
// inert. The core's ruin and the containers hold the loot; a container can only be
// emptied once its rampart is gone. Deploying cores are invulnerable for ~5000 ticks
// and a stronghold collapses ~75000 ticks after deploying.
//
// Settings (all optional): Memory.strongholdAssault =
//   {enabled: true, maxLevel: 3, lootContainers: true, maxSquads: 2}
// Status: Memory.strongholds[roomName] (verdict, reason, level, squad, loot...).

var DEFAULTS = {enabled: true, maxLevel: 3, lootContainers: true, maxSquads: 2};
var SQUAD_PREFIX = 'sh_';
var SCAN_INTERVAL = 100;          // one sector room per 100 ticks (9 rooms: ~900-tick cycle)
var WATCH_INTERVAL = 5;           // a stronghold we are fighting or looting
var OBSERVER_RANGE = 10;
var MAX_HOME_DISTANCE = 5;        // rooms between the boost room and the stronghold
var RECORD_TTL = 20000;           // forget a stronghold not seen for this long
var LAUNCH_LEAD_TICKS = 300;      // spawn + boost + walk before invulnerability ends
var MIN_REMAINING_TICKS = 2500;   // do not start on one about to collapse
var MAX_BREAK_TICKS = 1000;       // core rampart + core must fall within one quad's life
var MAX_LOOTERS = 2;
var TOWERS_BY_LEVEL = [0, 1, 2, 3, 4, 6];
var RAMPART_HITS_BY_LEVEL = [0, 100000, 200000, 500000, 1000000, 2000000];
var CORE_HITS = 100000;
// Expected defender damage per tick by level when none are visible yet (the core only
// spawns them once hostiles arrive): level 2 one 15-ATTACK, level 3 two 25-ATTACK.
var DEFENDER_DAMAGE_BY_LEVEL = [0, 0, 450, 1500, 6000, 40000];
var TOWER_MAX_DAMAGE = 600;
// A createQuadMember quad at RCL8 energy (8 TOUGH-RA-HEAL bundles per member) fully
// boosted with XGHO2 / XKHO2 / XLHO2: 4 x 8 HEAL x 12 x 4, 4 x 8 RA x 10 x 4.
var QUAD = {heal: 1536, ranged: 1280, toughFactor: 0.3, healMargin: 0.75};
var QUAD_BOOSTS = {XGHO2: 1080, XKHO2: 960, XLHO2: 960};

function config()
{
    var raw = Memory.strongholdAssault;
    var cfg = Object.assign({}, DEFAULTS);
    if (raw && typeof raw == 'object')
    {
        if (typeof raw.enabled == 'boolean') cfg.enabled = raw.enabled;
        if (Number.isInteger(raw.maxLevel)) cfg.maxLevel = Math.max(0, Math.min(5, raw.maxLevel));
        if (typeof raw.lootContainers == 'boolean') cfg.lootContainers = raw.lootContainers;
        if (Number.isInteger(raw.maxSquads)) cfg.maxSquads = Math.max(1, Math.min(5, raw.maxSquads));
    }
    else if (raw === false)
    {
        cfg.enabled = false;
    }
    return cfg;
}

function parseRoom(name)
{
    var m = /^([WE])(\d+)([NS])(\d+)$/.exec(name || '');
    return m ? {we: m[1], x: Number(m[2]), ns: m[3], y: Number(m[4])} : null;
}

// The 3x3 middle of a room's sector (source keeper rooms and the centre room),
// where strongholds deploy. Works for W/N coordinates too (W5 is a W sector centre).
function sectorCenterRooms(roomName)
{
    var p = parseRoom(roomName);
    if (!p) return [];
    var cx = Math.floor(p.x / 10) * 10 + 5, cy = Math.floor(p.y / 10) * 10 + 5, out = [];
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++)
    {
        out.push(p.we + (cx + dx) + p.ns + (cy + dy));
    }
    return out;
}

function roomDistance(a, b)
{
    if (typeof Game != 'undefined' && Game.map && typeof Game.map.getRoomLinearDistance == 'function')
    {
        return Game.map.getRoomLinearDistance(a, b);
    }
    var pa = parseRoom(a), pb = parseRoom(b);
    if (!pa || !pb) return Infinity;
    var ax = pa.we == 'E' ? pa.x : -pa.x - 1, bx = pb.we == 'E' ? pb.x : -pb.x - 1;
    var ay = pa.ns == 'S' ? pa.y : -pa.y - 1, by = pb.ns == 'S' ? pb.y : -pb.y - 1;
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function ownedRooms()
{
    var out = [];
    for (var name in Game.rooms)
    {
        var room = Game.rooms[name];
        if (room && room.controller && room.controller.my) out.push(room);
    }
    return out;
}

function scanRooms()
{
    var seen = {}, out = [];
    for (var room of ownedRooms())
    {
        for (var name of sectorCenterRooms(room.name))
        {
            if (!seen[name]) { seen[name] = true; out.push(name); }
        }
    }
    return out.sort();
}

function findObserver(target)
{
    var best = null, bestDistance = Infinity;
    for (var room of ownedRooms())
    {
        var d = roomDistance(room.name, target);
        if (d > OBSERVER_RANGE || d >= bestDistance) continue;
        var observers = room.find(FIND_MY_STRUCTURES, {
            filter: function(s) { return s.structureType == STRUCTURE_OBSERVER; }
        });
        if (observers.length) { best = observers[0]; bestDistance = d; }
    }
    return best;
}

function effectTicks(object, effect)
{
    var list = object && object.effects;
    if (!Array.isArray(list)) return 0;
    for (var e of list)
    {
        if (e && e.effect == effect && Number.isFinite(e.ticksRemaining)) return e.ticksRemaining;
    }
    return 0;
}

function boostMultiplier(part, action)
{
    if (!part || !part.boost || typeof BOOSTS == 'undefined' || !BOOSTS[part.type]) return 1;
    var b = BOOSTS[part.type][part.boost];
    return b && b[action] ? b[action] : 1;
}

// Damage a creep can deal per tick (ATTACK at range 1, RANGED_ATTACK at range 3),
// and rampart repair per tick (a fortifier's WORK parts).
function creepPower(creep)
{
    var damage = 0, repair = 0;
    for (var part of creep.body || [])
    {
        if (!part || part.hits <= 0) continue;
        if (part.type == ATTACK) damage += 30 * boostMultiplier(part, 'attack');
        else if (part.type == RANGED_ATTACK) damage += 10 * boostMultiplier(part, 'rangedAttack');
        else if (part.type == WORK) repair += 100 * boostMultiplier(part, 'repair');
    }
    return {damage: damage, repair: repair};
}

function isInvader(object)
{
    return object && object.owner && object.owner.username == 'Invader';
}

function rampartAt(room, pos)
{
    var found = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y).filter(function(s) {
        return s.structureType == STRUCTURE_RAMPART && !s.my && !s.isPublic;
    });
    return found[0];
}

function storeTotal(store)
{
    if (!store) return 0;
    if (typeof store.getUsedCapacity == 'function') return store.getUsedCapacity() || 0;
    var total = 0;
    for (var k in store) if (typeof store[k] == 'number') total += store[k];
    return total;
}

// Everything worth carrying home: ruins (the core's), containers and tombstones with
// resources. `open` = no hostile rampart over it, so creeps can withdraw.
function lootSources(room)
{
    var out = [];
    var add = function(object, kind) {
        var amount = storeTotal(object.store);
        if (amount <= 0) return;
        var rampart = rampartAt(room, object.pos);
        out.push({id: object.id, kind: kind, amount: amount, open: !rampart,
            rampartId: rampart ? rampart.id : undefined, rampartHits: rampart ? rampart.hits : 0,
            x: object.pos.x, y: object.pos.y});
    };
    if (typeof FIND_RUINS != 'undefined') for (var r of room.find(FIND_RUINS)) add(r, 'ruin');
    for (var c of room.find(FIND_STRUCTURES, {filter: function(s) { return s.structureType == STRUCTURE_CONTAINER; }}))
    {
        add(c, 'container');
    }
    return out;
}

// Refresh the record of a visible sector room. Level-0 cores belong to the remote
// mining manager and are ignored here.
function observe(room)
{
    Memory.strongholds = Memory.strongholds || {};
    var record = Memory.strongholds[room.name];
    var core = room.find(FIND_HOSTILE_STRUCTURES, {
        filter: function(s) { return s.structureType == STRUCTURE_INVADER_CORE && s.level > 0; }
    })[0];
    if (!core)
    {
        if (!record) return undefined;
        record.seen = Game.time;
        record.coreDead = true;
        record.loot = lootSources(room);
        record.defenders = 0;
        record.towers = 0;
        if (!record.loot.length) { delete Memory.strongholds[room.name]; return undefined; }
        return record;
    }
    if (!record || record.id != core.id)
    {
        record = Memory.strongholds[room.name] = {id: core.id, room: room.name, firstSeen: Game.time, squadMembers: []};
    }
    var coreRampart = rampartAt(room, core.pos);
    var towers = room.find(FIND_HOSTILE_STRUCTURES, {
        filter: function(s) { return s.structureType == STRUCTURE_TOWER && isInvader(s); }
    });
    var defenders = room.find(FIND_HOSTILE_CREEPS, {filter: isInvader});
    var damage = 0, repair = 0;
    for (var creep of defenders)
    {
        var power = creepPower(creep);
        damage += power.damage; repair += power.repair;
    }
    var invulnerable = effectTicks(core, typeof EFFECT_INVULNERABILITY != 'undefined' ? EFFECT_INVULNERABILITY : 1001);
    var collapse = effectTicks(core, typeof EFFECT_COLLAPSE_TIMER != 'undefined' ? EFFECT_COLLAPSE_TIMER : 1002);
    Object.assign(record, {
        level: core.level, x: core.pos.x, y: core.pos.y, seen: Game.time, coreDead: false,
        coreHits: core.hits, coreRampartId: coreRampart ? coreRampart.id : undefined,
        coreRampartHits: coreRampart ? coreRampart.hits : 0,
        towers: towers.length, defenders: defenders.length, defenderDamage: damage, defenderRepair: repair,
        deployUntil: invulnerable ? Game.time + invulnerable : undefined,
        collapseAt: collapse ? Game.time + collapse : record.collapseAt,
        loot: lootSources(room)
    });
    return record;
}

function roomBoostStock(room)
{
    var stock = {};
    var add = function(store) {
        if (!store) return;
        for (var k in QUAD_BOOSTS) stock[k] = (stock[k] || 0) + (store[k] || 0);
    };
    add(room.storage && room.storage.store);
    add(room.terminal && room.terminal.store);
    for (var lab of room.find(FIND_MY_STRUCTURES, {filter: function(s) { return s.structureType == STRUCTURE_LAB; }}))
    {
        add(lab.store);
    }
    return stock;
}

// Nearest owned RCL7+ room with labs and a quad's worth of T3 boosts.
function findBoostHome(targetRoom)
{
    var best = null, bestDistance = Infinity;
    for (var room of ownedRooms())
    {
        if (room.controller.level < 7) continue;
        var d = roomDistance(room.name, targetRoom);
        if (d > MAX_HOME_DISTANCE || d >= bestDistance) continue;
        var stock = roomBoostStock(room), ok = true;
        for (var k in QUAD_BOOSTS) if ((stock[k] || 0) < QUAD_BOOSTS[k]) ok = false;
        if (ok) { best = room.name; bestDistance = d; }
    }
    return best;
}

// Can a fully boosted quad kill this core? Pure; `home` is the boost room or null.
function assess(record, now, cfg, home)
{
    if (!record || !(record.level > 0)) return {verdict: 'ignore', reason: 'notStronghold'};
    if (record.coreDead) return {verdict: 'loot', reason: 'coreDead'};
    var level = record.level;
    if (level > cfg.maxLevel) return {verdict: 'tooStrong', reason: 'level' + level + '>max' + cfg.maxLevel};
    var towers = Math.max(record.towers || 0, TOWERS_BY_LEVEL[level] || 0);
    var defenderDamage = Math.max(record.defenderDamage || 0, DEFENDER_DAMAGE_BY_LEVEL[level] || 0);
    var incoming = QUAD.toughFactor * (towers * TOWER_MAX_DAMAGE + defenderDamage);
    if (incoming > QUAD.heal * QUAD.healMargin)
    {
        return {verdict: 'tooStrong', reason: 'damage' + Math.round(incoming) + '>heal' + Math.round(QUAD.heal * QUAD.healMargin)};
    }
    if ((record.defenderRepair || 0) * 1.2 >= QUAD.ranged)
    {
        return {verdict: 'tooStrong', reason: 'fortifierRepair' + record.defenderRepair};
    }
    var rampartHits = record.coreRampartHits > 0 ? record.coreRampartHits
        : (record.deployUntil ? RAMPART_HITS_BY_LEVEL[level] : 0);
    var breakTicks = Math.ceil((rampartHits + (record.coreHits || CORE_HITS)) / (QUAD.ranged - (record.defenderRepair || 0)));
    if (breakTicks > MAX_BREAK_TICKS) return {verdict: 'tooStrong', reason: 'breakTicks' + breakTicks};
    if (record.collapseAt && record.collapseAt - now < MIN_REMAINING_TICKS)
    {
        return {verdict: 'wait', reason: 'collapsingSoon'};
    }
    if (record.deployUntil && record.deployUntil - now > LAUNCH_LEAD_TICKS)
    {
        return {verdict: 'wait', reason: 'deployingUntil' + record.deployUntil};
    }
    if (!home) return {verdict: 'wait', reason: 'noBoostRoomInRange'};
    return {verdict: 'engage', reason: 'breakTicks' + breakTicks, home: home};
}

function isOurSquad(name)
{
    return typeof name == 'string' && name.indexOf(SQUAD_PREFIX) == 0;
}

// Any quad request or live quad that is not one of ours: never override the user's.
function foreignQuadActive()
{
    var requests = [Memory.spawnQuad, Memory.quadSpawn];
    for (var name in Game.spawns)
    {
        var spawn = Game.spawns[name];
        requests.push(spawn.memory && spawn.memory.spawnQuad, spawn.room.memory && spawn.room.memory.spawnQuad);
    }
    for (var req of requests)
    {
        if (!req) continue;
        var squad = typeof req == 'string' ? req : (req.squad || req.squadId || 'quad1');
        if (req.enabled === false) continue;
        if (!isOurSquad(squad)) return true;
    }
    for (var creepName in Game.creeps)
    {
        var mem = Game.creeps[creepName].memory;
        if (mem && mem.role == 'quad' && !isOurSquad(mem.squad)) return true;
    }
    return false;
}

function squadMembers(squad)
{
    var out = [];
    for (var name in Game.creeps)
    {
        var creep = Game.creeps[name];
        if (creep.memory && creep.memory.role == 'quad' && creep.memory.squad == squad) out.push(creep);
    }
    return out;
}

function stopAssault(record, reason)
{
    if (Memory.spawnQuad && Memory.spawnQuad.squad == record.squad) delete Memory.spawnQuad;
    if (record.squad && Memory.quads && Memory.quads[record.squad]) delete Memory.quads[record.squad].targetId;
    record.assault = reason;
    record.assaultEndedAt = Game.time;
}

function launch(record, home)
{
    var squad = SQUAD_PREFIX + record.room;
    Memory.spawnQuad = {squad: squad, targetRoom: record.room, retreatRoom: home, spawnRooms: [home],
        boostMode: 'required', enabled: true, stronghold: true};
    Memory.quads = Memory.quads || {};
    Memory.quads[squad] = Object.assign(Memory.quads[squad] || {}, {stronghold: record.room});
    record.squad = squad;
    record.home = home;
    record.assault = 'active';
    record.launchedAt = Game.time;
}

// Point the quad: armed defenders first (the quad's own logic), then the core's
// rampart, the core, and with lootContainers the ramparts over loaded containers.
function direct(record, room, cfg)
{
    var squadMemory = Memory.quads && Memory.quads[record.squad];
    if (!squadMemory) return;
    var armed = room.find(FIND_HOSTILE_CREEPS, {
        filter: function(c) { return isInvader(c) && creepPower(c).damage > 0; }
    });
    var target;
    if (!record.coreDead)
    {
        if (armed.length) { delete squadMemory.targetId; return; }
        target = record.coreRampartId || record.id;
    }
    else if (cfg.lootContainers)
    {
        var closed = (record.loot || []).filter(function(l) { return !l.open && l.rampartId; })
            .sort(function(a, b) { return a.rampartHits - b.rampartHits; });
        target = closed.length ? closed[0].rampartId : undefined;
    }
    if (target) squadMemory.targetId = target;
    else
    {
        delete squadMemory.targetId;
        stopAssault(record, record.coreDead ? 'won' : 'noTarget');
    }
}

function trackMembers(record)
{
    var members = squadMembers(record.squad);
    record.squadMembers = record.squadMembers || [];
    for (var creep of members)
    {
        if (record.squadMembers.indexOf(creep.name) < 0) record.squadMembers.push(creep.name);
    }
    return members;
}

function chooseObservation(state, records, scan)
{
    for (var name in records)
    {
        var r = records[name];
        if ((r.assault == 'active' || r.coreDead) && Game.time % WATCH_INTERVAL == 0) return name;
    }
    if (!scan.length || Game.time - (state.lastScan || 0) < SCAN_INTERVAL) return undefined;
    state.scanIndex = ((state.scanIndex || 0) + 1) % scan.length;
    state.lastScan = Game.time;
    return scan[state.scanIndex];
}

function run()
{
    if (typeof Game == 'undefined' || !Game.rooms) return;
    var cfg = config();
    Memory.strongholds = Memory.strongholds || {};
    var records = Memory.strongholds;
    var state = Memory.strongholdState = Memory.strongholdState || {};
    var scan = scanRooms();
    // Visible sector rooms (observed last tick, or with our creeps in them).
    for (var name of scan.concat(Object.keys(records)))
    {
        if (Game.rooms[name] && !(Game.rooms[name].controller && Game.rooms[name].controller.my)) observe(Game.rooms[name]);
    }
    for (var roomName in records)
    {
        var record = records[roomName];
        if (Game.time - (record.seen || 0) > RECORD_TTL
            || (record.collapseAt && Game.time > record.collapseAt))
        {
            if (record.assault == 'active') stopAssault(record, 'expired');
            delete records[roomName];
            continue;
        }
        // Boost stock changes slowly; look for a boost room every 50 ticks, not every tick.
        if (record.assault != 'active' && !record.coreDead
            && (!Number.isInteger(record.homeCheckedAt) || Game.time - record.homeCheckedAt >= 50))
        {
            record.boostHome = findBoostHome(roomName);
            record.homeCheckedAt = Game.time;
        }
        var home = record.assault == 'active' ? record.home : (record.coreDead ? null : record.boostHome);
        var verdict = assess(record, Game.time, cfg, home);
        record.verdict = verdict.verdict;
        record.reason = verdict.reason;
        if (record.assault == 'active')
        {
            var members = trackMembers(record);
            if (!cfg.enabled) { stopAssault(record, 'disabled'); continue; }
            if (verdict.verdict == 'tooStrong') { stopAssault(record, 'aborted:' + verdict.reason); continue; }
            var requesting = Memory.spawnQuad && Memory.spawnQuad.squad == record.squad;
            if (!members.length && !requesting)
            {
                stopAssault(record, record.coreDead ? 'won' : 'failed'); continue;
            }
            if (!record.coreDead && record.squadMembers.length >= 4 * cfg.maxSquads && !members.length)
            {
                stopAssault(record, 'failed'); continue;
            }
            // The quad system respawns missing members while the request stands;
            // stop asking once the squad budget is spent.
            if (record.squadMembers.length >= 4 * cfg.maxSquads && Memory.spawnQuad
                && Memory.spawnQuad.squad == record.squad) delete Memory.spawnQuad;
            if (Game.rooms[roomName]) direct(record, Game.rooms[roomName], cfg);
        }
        else if (cfg.enabled && verdict.verdict == 'engage' && !record.assault && !foreignQuadActive()
            && !Object.keys(records).some(function(n) { return records[n].assault == 'active'; }))
        {
            launch(record, verdict.home);
            if (Game.rooms[roomName]) direct(record, Game.rooms[roomName], cfg);
        }
    }
    var target = chooseObservation(state, records, scan);
    if (target && !Game.rooms[target])
    {
        var observer = findObserver(target);
        if (observer) observer.observeRoom(target);
    }
}

// Looters go out once the core is dead and some loot can be withdrawn.
function getLooterRequest(spawn)
{
    var records = Memory.strongholds;
    if (!records || !config().enabled) return undefined;
    for (var roomName in records)
    {
        var record = records[roomName];
        if (!record.coreDead || !(record.loot || []).some(function(l) { return l.open; })) continue;
        var home = record.home || nearestStorageRoom(roomName);
        if (home != spawn.room.name) continue;
        var looters = 0;
        for (var name in Game.creeps)
        {
            var mem = Game.creeps[name].memory;
            if (mem && mem.role == 'looter' && mem.target == roomName) looters++;
        }
        if (looters < MAX_LOOTERS) return {targetRoom: roomName, home: home, distance: roomDistance(home, roomName)};
    }
    return undefined;
}

function nearestStorageRoom(target)
{
    var best = null, bestDistance = Infinity;
    for (var room of ownedRooms())
    {
        if (!room.storage) continue;
        var d = roomDistance(room.name, target);
        if (d < bestDistance) { best = room.name; bestDistance = d; }
    }
    return bestDistance <= MAX_HOME_DISTANCE ? best : null;
}

module.exports = {
    run: run,
    getLooterRequest: getLooterRequest,
    // exported for tests
    assess: assess,
    sectorCenterRooms: sectorCenterRooms,
    config: config,
    QUAD: QUAD,
    SQUAD_PREFIX: SQUAD_PREFIX
};
