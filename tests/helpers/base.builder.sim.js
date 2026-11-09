'use strict';

// Dependency-free test adapter, not a Screeps server or a gameplay implementation.
// Constants/API rules checked against official screeps/common/lib/constants.js,
// screeps/engine/src/game/rooms.js, src/utils.js and the room/creeps processors.
// Site intents are invisible during run(); sites finish only at a tick boundary.
// Energy, creep work, decay, combat, CPU credits and controller XP are NOT modeled.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const {performance} = require('perf_hooks');

const ROOT = path.resolve(__dirname, '../..');
const clone = value => JSON.parse(JSON.stringify(value));
const key = p => p.y * 50 + p.x;
const range = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const position = p => p && Number.isInteger(p.x) && Number.isInteger(p.y)
    && p.x >= 0 && p.x <= 49 && p.y >= 0 && p.y <= 49;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// Preserve official zero-level omissions, rather than inventing caps there.
const CONTROLLER_STRUCTURES = {
    spawn: {0: 0, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 2, 8: 3},
    extension: {0: 0, 1: 0, 2: 5, 3: 10, 4: 20, 5: 30, 6: 40, 7: 50, 8: 60},
    link: {1: 0, 2: 0, 3: 0, 4: 0, 5: 2, 6: 3, 7: 4, 8: 6},
    road: {0: 2500, 1: 2500, 2: 2500, 3: 2500, 4: 2500, 5: 2500, 6: 2500, 7: 2500, 8: 2500},
    constructedWall: {1: 0, 2: 2500, 3: 2500, 4: 2500, 5: 2500, 6: 2500, 7: 2500, 8: 2500},
    rampart: {1: 0, 2: 2500, 3: 2500, 4: 2500, 5: 2500, 6: 2500, 7: 2500, 8: 2500},
    storage: {1: 0, 2: 0, 3: 0, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1},
    tower: {1: 0, 2: 0, 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 6},
    observer: {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 1},
    powerSpawn: {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 1},
    extractor: {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1, 7: 1, 8: 1},
    terminal: {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1, 7: 1, 8: 1},
    lab: {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 3, 7: 6, 8: 10},
    container: {0: 5, 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5, 8: 5},
    nuker: {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 1},
    factory: {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 1, 8: 1}
};
const CONSTRUCTION_COST = {spawn: 15000, extension: 3000, road: 300,
    constructedWall: 1, rampart: 1, link: 5000, storage: 30000, tower: 5000,
    observer: 8000, powerSpawn: 100000, extractor: 5000, lab: 50000,
    terminal: 100000, container: 5000, nuker: 100000, factory: 100000};
const OBSTACLE_OBJECT_TYPES = ['spawn', 'creep', 'powerCreep', 'source', 'mineral',
    'deposit', 'controller', 'constructedWall', 'extension', 'link', 'storage',
    'tower', 'observer', 'powerSpawn', 'powerBank', 'lab', 'terminal', 'nuker',
    'factory', 'invaderCore'];
const C = {
    OK: 0, ERR_NOT_OWNER: -1, ERR_NO_PATH: -2, ERR_NAME_EXISTS: -3,
    ERR_BUSY: -4, ERR_NOT_FOUND: -5, ERR_NOT_ENOUGH_ENERGY: -6,
    ERR_NOT_ENOUGH_RESOURCES: -6, ERR_INVALID_TARGET: -7, ERR_FULL: -8,
    ERR_NOT_IN_RANGE: -9, ERR_INVALID_ARGS: -10, ERR_TIRED: -11,
    ERR_NO_BODYPART: -12, ERR_RCL_NOT_ENOUGH: -14, ERR_GCL_NOT_ENOUGH: -15,
    FIND_EXIT_TOP: 1, FIND_EXIT_RIGHT: 3, FIND_EXIT_BOTTOM: 5, FIND_EXIT_LEFT: 7,
    FIND_EXIT: 10, FIND_CREEPS: 101, FIND_MY_CREEPS: 102, FIND_HOSTILE_CREEPS: 103,
    FIND_SOURCES_ACTIVE: 104, FIND_SOURCES: 105, FIND_DROPPED_RESOURCES: 106,
    FIND_STRUCTURES: 107, FIND_MY_STRUCTURES: 108, FIND_HOSTILE_STRUCTURES: 109,
    FIND_FLAGS: 110, FIND_CONSTRUCTION_SITES: 111, FIND_MY_SPAWNS: 112,
    FIND_HOSTILE_SPAWNS: 113, FIND_MY_CONSTRUCTION_SITES: 114,
    FIND_HOSTILE_CONSTRUCTION_SITES: 115, FIND_MINERALS: 116,
    FIND_POWER_CREEPS: 119, FIND_MY_POWER_CREEPS: 120, FIND_HOSTILE_POWER_CREEPS: 121,
    TERRAIN_MASK_WALL: 1, TERRAIN_MASK_SWAMP: 2, COLOR_WHITE: 10,
    LOOK_TERRAIN: 'terrain', LOOK_STRUCTURES: 'structure', LOOK_SOURCES: 'source',
    LOOK_MINERALS: 'mineral', LOOK_CONSTRUCTION_SITES: 'constructionSite',
    MAX_CONSTRUCTION_SITES: 100, FLAGS_LIMIT: 10000,
    CONTROLLER_STRUCTURES, CONSTRUCTION_COST, OBSTACLE_OBJECT_TYPES
};
for (const [name, value] of Object.entries({SPAWN: 'spawn', EXTENSION: 'extension',
    ROAD: 'road', WALL: 'constructedWall', RAMPART: 'rampart', CONTROLLER: 'controller',
    LINK: 'link', STORAGE: 'storage', TOWER: 'tower', OBSERVER: 'observer',
    POWER_SPAWN: 'powerSpawn', EXTRACTOR: 'extractor', LAB: 'lab', TERMINAL: 'terminal',
    CONTAINER: 'container', NUKER: 'nuker', FACTORY: 'factory'})) C['STRUCTURE_' + name] = value;
for (const limits of Object.values(CONTROLLER_STRUCTURES)) Object.freeze(limits);
Object.freeze(CONTROLLER_STRUCTURES);
Object.freeze(CONSTRUCTION_COST);
Object.freeze(OBSTACLE_OBJECT_TYPES);
Object.freeze(C);

function countBy(objects) {
    const counts = {};
    for (const object of objects) {
        const type = object.structureType || object.type;
        counts[type] = (counts[type] || 0) + 1;
    }
    return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}
function sourceSnapshot() {
    const sources = {};
    for (const file of fs.readdirSync(ROOT).sort()) {
        if (/^base\.builder\..+\.js$/.test(file) || file === 'manager.baseBuilder.js') {
            sources[file.slice(0, -3)] = fs.readFileSync(path.join(ROOT, file), 'utf8');
        }
    }
    return sources;
}
function sourceHashes(sources) {
    return Object.fromEntries(Object.entries(sources).map(([name, text]) => [name + '.js', digest(text)]));
}
// Mirrors base.builder.executor.js typeLimit(): default minRcl gate, then caps.
function effectiveCap(type, level, globalLimits = {}, roomLimits = {}, globalMin = {}, roomMin = {}) {
    const official = CONTROLLER_STRUCTURES[type] && CONTROLLER_STRUCTURES[type][level] || 0;
    const pick = (fallback, layers) => {
        let value = fallback;
        for (const limits of layers) {
            if (limits && typeof limits === 'object' && !Array.isArray(limits) && Object.hasOwn(limits, type)) value = limits[type];
        }
        return value;
    };
    const minRcl = pick(({road: 2, rampart: 3})[type] || 0, [globalMin, roomMin]);
    if (!Number.isInteger(minRcl) || minRcl < 0 || level < minRcl) return 0;
    const defaults = {factory: 0, lab: 3, link: 4, container: level >= 6 ? 4 : 3};
    const value = pick(Object.hasOwn(defaults, type) ? defaults[type] : official, [globalLimits, roomLimits]);
    return Number.isInteger(value) && value >= 0 ? Math.min(official, value) : 0;
}
function validateFixture(fixture) {
    if (!fixture || !/^([WE]\d+[NS]\d+)$/.test(fixture.room)
        || fixture.shard !== 'shard3' || !['existing', 'fresh'].includes(fixture.variant)
        || typeof fixture.capturedAt !== 'string' || !Number.isFinite(Date.parse(fixture.capturedAt))
        || !/^[0-3]{2500}$/.test(fixture.terrain) || !Array.isArray(fixture.objects)) {
        throw new Error('invalid real-room fixture schema (room/shard/variant/capturedAt/terrain/objects)');
    }
    const ids = new Set();
    for (const o of fixture.objects) {
        if (!o || typeof o._id !== 'string' || !o._id || ids.has(o._id) || !position(o)
            || typeof o.type !== 'string' || ['creep', 'powerCreep'].includes(o.type)) {
            throw new Error('invalid/duplicate fixture object: ' + JSON.stringify(o));
        }
        ids.add(o._id);
    }
    const controllers = fixture.objects.filter(o => o.type === 'controller');
    if (controllers.length !== 1 || !Number.isInteger(controllers[0].level)
        || controllers[0].level < 1 || controllers[0].level > 8 || !controllers[0].user
        || !fixture.objects.some(o => o.type === 'source')
        || !fixture.objects.some(o => o.type === 'mineral')
        || !fixture.objects.some(o => o.type === 'spawn' && o.user === controllers[0].user)) {
        throw new Error('fixture requires owned controller, spawn, sources and mineral');
    }
    if (fixture.variant === 'fresh' && (controllers[0].level !== 1
        || fixture.objects.filter(o => o.type === 'spawn').length !== 1
        || fixture.objects.some(o => !['controller', 'source', 'mineral', 'spawn'].includes(o.type)))) {
        throw new Error('fresh fixture must contain only RCL1 controller, one spawn, sources and mineral');
    }
    if (fixture.livePlan !== null && (!fixture.livePlan || !Array.isArray(fixture.livePlan.entries))) {
        throw new Error('livePlan must be a captured plan with entries or null');
    }
}

// Public construction validation, independently implemented from the planner.
// Official code permits roads on wall terrain and an extractor on a mineral;
// build completion additionally rejects hard-object collisions.
function siteLegal(objects, terrain, type, x, y) {
    if (!position({x, y}) || x === 0 || y === 0 || x === 49 || y === 49
        || !Object.hasOwn(CONSTRUCTION_COST, type)) return false;
    const here = objects.filter(o => o.x === x && o.y === y);
    if (type === 'extractor' && !here.some(o => o.type === 'mineral')) return false;
    if (here.some(o => o.type === type || o.type === 'constructionSite')) return false;
    if (!['road', 'extractor'].includes(type) && (Number(terrain[key({x, y})]) & C.TERRAIN_MASK_WALL)) return false;
    if (!['road', 'container'].includes(type)) {
        const border = [];
        if (x === 1) border.push([0, y - 1], [0, y], [0, y + 1]);
        if (x === 48) border.push([49, y - 1], [49, y], [49, y + 1]);
        if (y === 1) border.push([x - 1, 0], [x, 0], [x + 1, 0]);
        if (y === 48) border.push([x - 1, 49], [x, 49], [x + 1, 49]);
        if (border.some(([bx, by]) => !(Number(terrain[by * 50 + bx]) & 1))) return false;
    }
    if (!['rampart', 'road'].includes(type) && here.some(o =>
        !['rampart', 'road'].includes(o.type) && CONSTRUCTION_COST[o.type])) return false;
    return true;
}
function buildLegal(objects, terrain, site) {
    const type = site.structureType;
    if (!position(site) || !Object.hasOwn(CONSTRUCTION_COST, type)) return false;
    const here = objects.filter(o => o !== site && o.x === site.x && o.y === site.y);
    return !here.some(o => o.type === type)
        && (type !== 'extractor' || here.some(o => o.type === 'mineral'))
        && (!OBSTACLE_OBJECT_TYPES.includes(type) || !here.some(o => OBSTACLE_OBJECT_TYPES.includes(o.type)))
        && (['extractor', 'road'].includes(type) || !(Number(terrain[key(site)]) & 1));
}

class Simulation {
    constructor(fixture, options = {}) {
        this.fixture = clone(fixture);
        this.objects = clone(fixture.objects);
        this.owner = this.objects.find(o => o.type === 'controller').user;
        this.sources = options.sources || sourceSnapshot();
        this.tick = 1000000;
        this.nextId = 0;
        this.pending = [];
        this.attempts = [];
        this.additions = [];
        this.completions = [];
        this.flags = {};
        this.externalSites = {};
        this.destroyCalls = [];
        this.instrumentation = {calls: {}, compose: [], executions: [], resets: 0};
        // Do not inject policy defaults: the real executor must supply them.
        this.memory = {baseBuilder: {},
            rooms: {[fixture.room]: {baseBuilder: {mode: options.mode || 'observe',
                ...(Object.hasOwn(options, 'roomLimits') ? {typeLimits: options.roomLimits} : {})}}},
            spawns: {}, creeps: {}};
        if (Object.hasOwn(options, 'globalLimits')) this.memory.baseBuilder.typeLimits = options.globalLimits;
        this.reload();
    }
    get level() { return this.objects.find(o => o.type === 'controller').level; }
    set level(value) { this.objects.find(o => o.type === 'controller').level = value; this.refresh(); }
    get state() { return this.memory.rooms[this.fixture.room].baseBuilder; }
    get built() { return this.objects.filter(o => CONSTRUCTION_COST[o.type]); }
    get sites() { return this.objects.filter(o => o.type === 'constructionSite'); }
    get counts() { return countBy(this.built.concat(this.sites)); }
    cap(type, level = this.level) {
        return effectiveCap(type, level, this.memory.baseBuilder && this.memory.baseBuilder.typeLimits, this.state.typeLimits,
            this.memory.baseBuilder && this.memory.baseBuilder.minRcl, this.state.minRcl);
    }
    reload() {
        this.instrumentation.resets++;
        this.memory = clone(this.memory);
        this.context = vm.createContext(Object.assign({}, C, {console, Memory: this.memory}));
        this.context.global = this.context;
        const cache = new Map();
        const self = this;
        this.load = function load(name) {
            if (!Object.hasOwn(self.sources, name)) throw new Error('unexpected production require: ' + name);
            if (cache.has(name)) return cache.get(name).exports;
            const mod = {exports: {}};
            cache.set(name, mod);
            const factory = vm.runInContext('(function(require,module,exports){\n' + self.sources[name] + '\n})',
                self.context, {filename: path.join(ROOT, name + '.js'), timeout: 30000});
            factory(load, mod, mod.exports);
            const observed = {'base.builder.runtime': 'run', 'base.builder.compose': 'compose', 'manager.baseBuilder': 'run',
                'base.builder.executor': 'execute', 'base.builder.survey': 'survey'}[name];
            if (observed) {
                const real = mod.exports[observed];
                mod.exports[observed] = function(...args) {
                    const label = name + '.' + observed;
                    self.instrumentation.calls[label] = (self.instrumentation.calls[label] || 0) + 1;
                    const started = performance.now();
                    const result = real.apply(this, args);
                    if (name === 'base.builder.compose') self.instrumentation.compose.push({
                        tick: self.tick, rcl: self.level, elapsedMs: performance.now() - started,
                        counts: countBy(result.entries || []), result: clone(result)});
                    if (name === 'base.builder.executor') self.instrumentation.executions.push({
                        tick: self.tick, rcl: self.level, result: clone(result)});
                    return result;
                };
            }
            return mod.exports;
        };
        this.context.__runtime = this.load('base.builder.runtime');
        this.refresh();
    }
    refresh() {
        const self = this;
        function RoomPosition(x, y, roomName) {
            if (!position({x, y})) throw new Error('invalid RoomPosition');
            this.x = x; this.y = y; this.roomName = roomName;
        }
        RoomPosition.prototype.getRangeTo = function(target, y) {
            const p = typeof target === 'number' ? {x: target, y} : target.pos || target;
            return p.roomName && p.roomName !== this.roomName ? Infinity : range(this, p);
        };
        RoomPosition.prototype.inRangeTo = function(target, distance) { return this.getRangeTo(target) <= distance; };
        RoomPosition.prototype.isNearTo = function(target) { return this.getRangeTo(target) <= 1; };
        RoomPosition.prototype.isEqualTo = function(target) { return this.getRangeTo(target) === 0; };
        this.context.RoomPosition = RoomPosition;
        const room = {name: this.fixture.room, memory: this.memory.rooms[this.fixture.room]};
        this.room = room;
        const wrappers = this.objects.map(raw => {
            const object = {id: raw._id, pos: new RoomPosition(raw.x, raw.y, room.name), room};
            if (raw.user) { object.owner = {username: raw.user}; object.my = raw.user === self.owner; }
            if (raw.name) object.name = raw.name;
            if (raw.type === 'controller') Object.assign(object, {structureType: 'controller', level: raw.level});
            if (CONSTRUCTION_COST[raw.type] || raw.type === 'constructionSite') {
                object.structureType = raw.structureType || raw.type;
                if (raw.type === 'constructionSite') {
                    object.progress = raw.progress || 0;
                    object.progressTotal = CONSTRUCTION_COST[raw.structureType];
                }
                object.destroy = () => { self.destroyCalls.push(raw._id); throw new Error('destructive gameplay call'); };
                object.remove = object.destroy;
            }
            Object.defineProperty(object, '__raw', {value: raw});
            return object;
        });
        const byId = new Map(wrappers.map(o => [o.id, o]));
        room.controller = wrappers.find(o => o.__raw.type === 'controller');
        room.storage = wrappers.find(o => o.__raw.type === 'storage' && o.my);
        room.terminal = wrappers.find(o => o.__raw.type === 'terminal' && o.my);
        room.getTerrain = () => ({get(x, y) {
            if (!position({x, y})) throw new Error('terrain out of bounds');
            return Number(self.fixture.terrain[y * 50 + x]);
        }});
        room.find = function(type, options = {}) {
            let found;
            const structures = wrappers.filter(o => o.structureType && o.__raw.type !== 'constructionSite');
            const sites = wrappers.filter(o => o.__raw.type === 'constructionSite');
            switch (type) {
            case C.FIND_STRUCTURES: found = structures; break;
            case C.FIND_MY_STRUCTURES: found = structures.filter(o => o.my === true); break;
            case C.FIND_HOSTILE_STRUCTURES: found = structures.filter(o => o.my === false); break;
            case C.FIND_MY_SPAWNS: found = structures.filter(o => o.structureType === 'spawn' && o.my === true); break;
            case C.FIND_HOSTILE_SPAWNS: found = structures.filter(o => o.structureType === 'spawn' && o.my === false); break;
            case C.FIND_CONSTRUCTION_SITES: found = sites; break;
            case C.FIND_MY_CONSTRUCTION_SITES: found = sites.filter(o => o.my === true); break;
            case C.FIND_HOSTILE_CONSTRUCTION_SITES: found = sites.filter(o => o.my === false); break;
            case C.FIND_SOURCES: case C.FIND_SOURCES_ACTIVE: found = wrappers.filter(o => o.__raw.type === 'source'); break;
            case C.FIND_MINERALS: found = wrappers.filter(o => o.__raw.type === 'mineral'); break;
            case C.FIND_FLAGS: found = Object.values(self.flags); break;
            case C.FIND_HOSTILE_CREEPS: case C.FIND_HOSTILE_POWER_CREEPS:
            case C.FIND_CREEPS: case C.FIND_MY_CREEPS: case C.FIND_POWER_CREEPS:
            case C.FIND_MY_POWER_CREEPS: found = []; break;
            default: throw new Error('unimplemented room.find constant: ' + type);
            }
            return found.filter(options.filter || (() => true));
        };
        room.createConstructionSite = (x, y, type, name) => this.createSite(x, y, type, name);
        room.createFlag = function(x, y, name, color, secondaryColor) {
            if (!position({x, y}) || typeof name !== 'string' || name.length > 100
                || !Number.isInteger(color) || color < 1 || color > 10
                || !Number.isInteger(secondaryColor) || secondaryColor < 1 || secondaryColor > 10) return C.ERR_INVALID_ARGS;
            if (self.flags[name]) return C.ERR_NAME_EXISTS;
            if (Object.keys(self.flags).length >= C.FLAGS_LIMIT) return C.ERR_FULL;
            self.flags[name] = {name, color, secondaryColor, pos: new RoomPosition(x, y, room.name)};
            return name;
        };
        this.game = {time: this.tick, rooms: {[room.name]: room},
            spawns: Object.fromEntries(wrappers.filter(o => o.__raw.type === 'spawn' && o.my).map(o => [o.name || o.id, o])),
            constructionSites: Object.assign({}, this.externalSites,
                Object.fromEntries(wrappers.filter(o => o.__raw.type === 'constructionSite' && o.my).map(o => [o.id, o]))),
            creeps: {}, powerCreeps: {}, flags: this.flags, shard: {name: this.fixture.shard},
            getObjectById: id => byId.get(id) || null,
            cpu: {bucket: 10000, limit: 500, tickLimit: 500, getUsed: () => performance.now() - this.tickStarted}};
        this.context.Game = this.game;
        this.context.Memory = this.memory;
    }
    createSite(x, y, type, name) {
        let code = C.OK;
        if (!position({x, y}) || !CONSTRUCTION_COST[type] || (type === 'spawn' && typeof name === 'string'
            && (name.length > 100 || Object.hasOwn(this.game.spawns, name)
                || this.sites.concat(this.pending).some(o => o.name === name)))) code = C.ERR_INVALID_ARGS;
        else if (!this.room.controller.my) code = C.ERR_NOT_OWNER;
        else if ((this.counts[type] || 0) >= (CONTROLLER_STRUCTURES[type][this.level] || 0)) code = C.ERR_RCL_NOT_ENOUGH;
        else if (!siteLegal(this.objects, this.fixture.terrain, type, x, y)) code = C.ERR_INVALID_TARGET;
        else if (Object.keys(this.game.constructionSites).length + this.pending.length >= C.MAX_CONSTRUCTION_SITES) code = C.ERR_FULL;
        const attempt = {tick: this.tick, rcl: this.level, type, x, y, code};
        if (name !== undefined) attempt.name = name;
        this.attempts.push(attempt);
        if (code === C.OK) this.pending.push({type: 'constructionSite', structureType: type, x, y,
            _id: 'simulation-site-' + (++this.nextId), user: this.owner,
            name, acceptedTick: this.tick, acceptedRcl: this.level});
        return code;
    }
    run() {
        this.tickStarted = performance.now();
        this.refresh();
        return clone(vm.runInContext('__runtime.run()', this.context, {timeout: 30000}));
    }
    finishTick() {
        // Existing sites complete first; new intents become sites after this tick
        // and are completed on the following tick (never while runtime.run runs).
        const done = [];
        for (const site of this.sites) {
            if (!buildLegal(this.objects, this.fixture.terrain, site)) throw new Error('unbuildable accepted site: ' + JSON.stringify(site));
            const built = {_id: site._id + '-built', type: site.structureType, x: site.x, y: site.y};
            if (!['road', 'container', 'constructedWall'].includes(built.type)) built.user = site.user;
            if (site.name) built.name = site.name;
            this.objects = this.objects.filter(o => o !== site);
            this.objects.push(built);
            done.push({_id: site._id, builtId: built._id, tick: this.tick, type: built.type, x: built.x, y: built.y});
        }
        this.completions.push(...done);
        for (const site of this.pending) {
            if (!siteLegal(this.objects, this.fixture.terrain, site.structureType, site.x, site.y)
                || (this.counts[site.structureType] || 0) >= (CONTROLLER_STRUCTURES[site.structureType][this.level] || 0)) {
                throw new Error('accepted intent rejected at settlement: ' + JSON.stringify(site));
            }
            this.objects.push(site);
            this.additions.push({tick: site.acceptedTick, rcl: site.acceptedRcl, type: site.structureType,
                x: site.x, y: site.y, id: site._id, ...(site.name ? {name: site.name} : {})});
        }
        this.pending = [];
        this.tick++;
        this.refresh();
        return done;
    }
}

function neighbors(p) {
    const output = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const next = {x: p.x + dx, y: p.y + dy};
        if ((dx || dy) && next.x > 0 && next.x < 49 && next.y > 0 && next.y < 49) output.push(next);
    }
    return output;
}
function accessReport(fixture, objects, anchorId, entries = []) {
    const built = objects.filter(o => o.type !== 'constructionSite');
    const anchor = built.find(o => o._id === anchorId);
    if (!anchor || anchor.type !== 'spawn') throw new Error('independent audit requires the original built spawn anchor');
    const roads = new Set(built.filter(o => o.type === 'road').map(key));
    const transit = new Set(built.filter(o => ['road', 'container'].includes(o.type)).map(key));
    const blocked = new Set(built.filter(o => OBSTACLE_OBJECT_TYPES.includes(o.type)
        || (o.type === 'rampart' && o.user && o.user !== anchor.user && o.isPublic !== true)).map(key));
    function walkable(p) {
        return position(p) && p.x > 0 && p.x < 49 && p.y > 0 && p.y < 49
            && (!(Number(fixture.terrain[key(p)]) & 1) || roads.has(key(p))) && !blocked.has(key(p));
    }
    function flood(roadOnly) {
        const seen = new Set(), queue = [];
        for (const p of neighbors(anchor)) if (walkable(p) && (!roadOnly || transit.has(key(p)))) {
            seen.add(key(p)); queue.push(p);
        }
        for (let head = 0; head < queue.length; head++) for (const p of neighbors(queue[head])) {
            if (!seen.has(key(p)) && walkable(p) && (!roadOnly || transit.has(key(p)))) {
                seen.add(key(p)); queue.push(p);
            }
        }
        return {seen, queue};
    }
    const reached = flood(false), roadReached = flood(true);
    // Containers may be road termini, but a container-only island is not a road
    // network. Credit only components containing an actual connected road.
    const paved = roadReached.queue.filter(p => roads.has(key(p)));
    const pavedSeen = new Set(paved.map(key));
    for (let head = 0; head < paved.length; head++) for (const p of neighbors(paved[head])) {
        if (roadReached.seen.has(key(p)) && !pavedSeen.has(key(p))) {
            pavedSeen.add(key(p)); paved.push(p);
        }
    }
    const hasSeat = (goal, distance, list) => list.some(p => range(p, goal) <= distance);
    const workerTypes = ['spawn', 'extension', 'storage', 'terminal', 'link', 'tower', 'lab',
        'factory', 'powerSpawn', 'observer', 'nuker', 'extractor'];
    const workers = built.filter(o => (workerTypes.includes(o.type) && o.user === anchor.user) || o.type === 'container');
    const goals = built.filter(o => ['spawn', 'source', 'controller', 'storage'].includes(o.type));
    const access = goals.concat(workers).filter((o, i, all) => all.findIndex(q => q._id === o._id) === i)
        .map(o => ({id: o._id, type: o.type, x: o.x, y: o.y, range: o.type === 'controller' ? 3 : 1,
            reachable: hasSeat(o, o.type === 'controller' ? 3 : 1, reached.queue)}));
    const connections = goals.map(o => ({id: o._id, type: o.type, x: o.x, y: o.y,
        connected: hasSeat(o, o.type === 'controller' ? 3 : 1, paved)}));
    const vital = new Set(['spawn', 'storage', 'tower', 'terminal', 'link', 'powerSpawn', 'lab', 'factory', 'nuker']);
    const ramparts = new Set(built.filter(o => o.type === 'rampart' && o.user === anchor.user).map(key));
    const coverage = built.filter(o => vital.has(o.type) && o.user === anchor.user).map(o =>
        ({id: o._id, type: o.type, x: o.x, y: o.y, covered: ramparts.has(key(o))}));
    // Link workers need one shared reachable seat, not two independent seats.
    const linkSeats = [];
    for (const entry of entries) {
        if (entry.type !== 'link' || typeof entry.purpose !== 'string') continue;
        const link = built.find(o => o.type === 'link' && key(o) === key(entry.pos));
        if (!link) continue; // Future-RCL proposals are not yet worker structures.
        let target, distance;
        if (entry.purpose.startsWith('sourceLink:')) {
            target = built.find(o => o.type === 'source' && o._id === entry.purpose.slice('sourceLink:'.length));
            distance = 1;
        } else if (entry.purpose === 'controllerLink') {
            target = built.find(o => o.type === 'controller'); distance = 3;
        } else if (entry.purpose === 'baseLink') {
            target = built.find(o => o.type === 'storage'); distance = 1;
        } else continue;
        linkSeats.push({id: link._id, purpose: entry.purpose, targetId: target && target._id,
            reachable: !!target && reached.queue.some(p => range(p, link) === 1 && range(p, target) <= distance)});
    }
    return {access, connections, coverage, linkSeats, reachableTiles: reached.seen.size,
        connectedRoads: [...roads].filter(i => roadReached.seen.has(i)).length,
        disconnectedRoads: built.filter(o => o.type === 'road' && !roadReached.seen.has(key(o)))
            .map(o => ({id: o._id, x: o.x, y: o.y}))};
}

module.exports = {ROOT, C, Simulation, clone, key, range, position, digest, countBy,
    sourceSnapshot, sourceHashes, effectiveCap, validateFixture, siteLegal, buildLegal, accessReport};
