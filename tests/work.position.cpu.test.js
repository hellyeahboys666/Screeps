const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'work.position.js'), 'utf8');

let roomPositionConstructions = 0;
let terrainRequests = 0;
let terrainReads = 0;
const lookCounts = {};
const tileContents = {};

function key(pos) {
    return `${pos.roomName}:${pos.x}:${pos.y}`;
}

function RoomPosition(x, y, roomName) {
    roomPositionConstructions += 1;
    this.x = x;
    this.y = y;
    this.roomName = roomName;
}
RoomPosition.prototype.getRangeTo = function(target) {
    const pos = target.pos || target;
    return Math.max(Math.abs(this.x - pos.x), Math.abs(this.y - pos.y));
};
RoomPosition.prototype.inRangeTo = function(target, range) {
    const pos = target.pos || target;
    return this.roomName == pos.roomName && this.getRangeTo(pos) <= range;
};
RoomPosition.prototype.lookFor = function(type) {
    lookCounts[type] = (lookCounts[type] || 0) + 1;
    const contents = tileContents[key(this)] || {};
    return contents[type] || [];
};

const room = {
    name: 'E9S18',
    find() { return []; }
};
const game = {
    time: 100,
    rooms: {E9S18: room},
    map: {
        getRoomTerrain(roomName) {
            assert.equal(roomName, 'E9S18');
            terrainRequests += 1;
            return {
                get() {
                    terrainReads += 1;
                    return 0;
                }
            };
        }
    }
};
const sandbox = {
    module: {exports: {}},
    exports: {},
    // No spawn drop spot in this room.
    require: (name) => (name == 'energy.fallback' ? {getSpawnDropPos: () => undefined} : undefined),
    Game: game,
    global: {},
    RoomPosition,
    TERRAIN_MASK_WALL: 1,
    TERRAIN_MASK_SWAMP: 2,
    LOOK_SOURCES: 'source',
    LOOK_MINERALS: 'mineral',
    LOOK_STRUCTURES: 'structure',
    LOOK_CREEPS: 'creep',
    LOOK_POWER_CREEPS: 'powerCreep',
    LOOK_CONSTRUCTION_SITES: 'constructionSite',
    STRUCTURE_ROAD: 'road',
    STRUCTURE_CONTAINER: 'container',
    STRUCTURE_RAMPART: 'rampart',
    STRUCTURE_WALL: 'constructedWall',
    OBSTACLE_OBJECT_TYPES: ['spawn', 'extension'],
    FIND_SOURCES: 1,
    FIND_MINERALS: 2
};
vm.runInNewContext(source, sandbox, {filename: 'work.position.js'});
const workPosition = sandbox.module.exports;

const creep = {
    name: 'upgrader-1',
    room,
    memory: {},
    pos: new RoomPosition(20, 20, 'E9S18')
};
const target = {
    id: 'controller-1',
    pos: new RoomPosition(22, 20, 'E9S18')
};
const candidate = new RoomPosition(23, 20, 'E9S18');

// Scoring one viable tile previously fetched RoomTerrain twice and looked up
// structures twice: once for standability and again for road/container scoring.
const score = workPosition._test.scoreWorkPosition(creep, target, candidate, 3, undefined);
assert.ok(Number.isFinite(score));
assert.equal(terrainRequests, 1,
    'one tile score should request the room terrain at most once');
assert.equal(terrainReads, 1,
    'one tile score should read terrain at most once');
assert.equal(lookCounts.structure, 1,
    'standability and tile classification must share one structure lookup');

// Candidate coordinates depend only on target position/range. Same-tick workers
// targeting the same controller/site should share construction of RoomPositions.
const center = target.pos;
const firstCandidates = workPosition._test.getCandidatePositions(center, 3);
const constructionsAfterFirstList = roomPositionConstructions;
const secondCandidates = workPosition._test.getCandidatePositions(center, 3);
assert.equal(roomPositionConstructions, constructionsAfterFirstList,
    'same-tick candidate generation should reuse cached RoomPositions');
assert.equal(secondCandidates.length, firstCandidates.length);
secondCandidates.pop();
assert.equal(workPosition._test.getCandidatePositions(center, 3).length, firstCandidates.length,
    'callers must receive independent candidate arrays');

// Candidate caches are deliberately tick-scoped.
game.time += 1;
workPosition._test.getCandidatePositions(center, 3);
assert.ok(roomPositionConstructions > constructionsAfterFirstList,
    'candidate positions must refresh after Game.time advances');

// Blocking and road semantics remain unchanged after sharing tile inspection.
const blocked = new RoomPosition(24, 20, 'E9S18');
tileContents[key(blocked)] = {
    structure: [{structureType: 'spawn'}]
};
assert.equal(workPosition._test.scoreWorkPosition(creep, target, blocked, 3, undefined), Infinity);

const road = new RoomPosition(23, 21, 'E9S18');
tileContents[key(road)] = {
    structure: [{structureType: 'road'}]
};
const roadScore = workPosition._test.scoreWorkPosition(creep, target, road, 3, undefined);
delete tileContents[key(road)];
const plainScore = workPosition._test.scoreWorkPosition(creep, target, road, 3, undefined);
assert.ok(roadScore > plainScore, 'roads must retain their work-position penalty');

console.log('work position CPU cache tests passed');
