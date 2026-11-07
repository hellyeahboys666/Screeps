const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'source.link.js'), 'utf8');

function inRangeTo(from, target, range) {
    const to = target.pos || target;
    return from.roomName == to.roomName
        && Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y)) <= range;
}

function RoomPosition(x, y, roomName) {
    this.x = x;
    this.y = y;
    this.roomName = roomName;
}
RoomPosition.prototype.inRangeTo = function(target, range) {
    return inRangeTo(this, target, range);
};

const sandbox = {
    module: {exports: {}},
    exports: {},
    Game: {time: 100},
    RoomPosition,
    FIND_MY_STRUCTURES: 1,
    STRUCTURE_ROAD: 'road',
    STRUCTURE_CONTAINER: 'container',
    STRUCTURE_RAMPART: 'rampart',
    STRUCTURE_LINK: 'link',
    LOOK_TERRAIN: 'terrain',
    LOOK_STRUCTURES: 'structure',
    LOOK_SOURCES: 'source',
    LOOK_MINERALS: 'mineral'
};
vm.runInNewContext(source, sandbox, {filename: 'source.link.js'});
const sourceLinks = sandbox.module.exports;

function makeFixture(roomName, controllerId, linkId) {
    const room = {
        name: roomName,
        lookCalls: 0,
        lookAt() {
            this.lookCalls += 1;
            return [{type: 'terrain', terrain: 'plain'}];
        }
    };
    const link = {
        id: linkId,
        structureType: 'link',
        room,
        pos: new RoomPosition(20, 23, roomName)
    };
    const controller = {
        id: controllerId,
        room,
        pos: new RoomPosition(20, 20, roomName)
    };
    controller.findCalls = 0;
    controller.candidates = [link];
    controller.pos.findInRange = function(type, range, options) {
        assert.equal(type, 1);
        assert.equal(range, 4);
        controller.findCalls += 1;
        return controller.candidates.filter(options.filter);
    };
    return {room, link, controller};
}

const first = makeFixture('E9S19', 'controller-1', 'link-1');
const firstResult = sourceLinks.findUsableControllerLinks(first.controller);
const lookCallsAfterFirstLookup = first.room.lookCalls;
assert.deepEqual(Array.from(firstResult, link => link.id), [first.link.id]);

// Linkers and lorries call this helper independently in the same room. The
// expensive topology/seat validation should happen only once per controller/tick.
const secondResult = sourceLinks.findUsableControllerLinks(first.controller);
assert.deepEqual(Array.from(secondResult, link => link.id), [first.link.id]);
assert.equal(first.controller.findCalls, 1,
    'controller-link discovery must be cached for the current tick');
assert.equal(first.room.lookCalls, lookCallsAfterFirstLookup,
    'cached controller-link discovery must not revalidate shared seats');

// Callers receive independent arrays so sorting/splicing one cannot corrupt
// another creep's view of the cached topology.
secondResult.pop();
assert.deepEqual(
    Array.from(sourceLinks.findUsableControllerLinks(first.controller), link => link.id),
    [first.link.id]);

// Different controllers remain independent within the same tick.
const second = makeFixture('E8S19', 'controller-2', 'link-2');
assert.deepEqual(
    Array.from(sourceLinks.findUsableControllerLinks(second.controller), link => link.id),
    [second.link.id]);
assert.equal(second.controller.findCalls, 1);
assert.equal(first.controller.findCalls, 1);

// A new tick refreshes topology immediately.
sandbox.Game.time += 1;
first.controller.candidates = [];
assert.deepEqual(Array.from(sourceLinks.findUsableControllerLinks(first.controller)), []);
assert.equal(first.controller.findCalls, 2,
    'controller-link discovery must refresh when Game.time advances');

console.log('controller link topology cache tests passed');
