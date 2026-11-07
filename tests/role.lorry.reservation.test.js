const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'role.lorry.js'), 'utf8');
const sandbox = {
    module: {exports: {}},
    exports: {},
    global: {},
    Game: {time: 100, creeps: {}},
    require(name) {
        if (name == 'energy.fallback') {
            return {};
        }
        if (name == 'energy.reserve') {
            return {};
        }
        if (name == 'source.link') {
            return {};
        }
        if (name == 'remote.build.depot') {
            return {};
        }
        if (name == 'market.specialStructures') {
            return {};
        }
        throw new Error(`unexpected require: ${name}`);
    },
    RESOURCE_ENERGY: 'energy',
    STRUCTURE_STORAGE: 'storage'
};
vm.runInNewContext(source, sandbox, {filename: 'role.lorry.js'});
const role = sandbox.module.exports;

assert.ok(role._test, 'role.lorry must expose focused reservation helpers to the regression harness');
assert.equal(typeof role._test.getReservedPickupCapacity, 'function');
assert.equal(typeof role._test.clearLorryPickup, 'function');
assert.equal(typeof role._test.rememberLorryPickup, 'function');

const room = {name: 'E9S19'};
const target = {id: 'container-1'};
function makeLorry(name, freeCapacity) {
    return {
        name,
        room,
        memory: {
            role: 'lorry',
            lorryPickupId: target.id,
            lorryPickupUntil: 110
        },
        store: {
            getFreeCapacity(resource) {
                assert.equal(resource, 'energy');
                return freeCapacity;
            }
        }
    };
}

const current = makeLorry('lorry-current', 600);
const other = makeLorry('lorry-other', 400);
sandbox.Game.creeps = {[current.name]: current, [other.name]: other};

// The room map includes every reservation, but a querying lorry must not count
// its own reservation against itself.
assert.equal(role._test.getReservedPickupCapacity(current, target), 400);

// Clearing a reservation must invalidate the room snapshot immediately.
role._test.clearLorryPickup(other);
assert.equal(role._test.getReservedPickupCapacity(current, target), 0);

// Remembering a new reservation in the same tick must also invalidate the
// snapshot so a later lorry sees it without a full Game.creeps rescan.
role._test.rememberLorryPickup(other, target);
assert.equal(role._test.getReservedPickupCapacity(current, target), 400);

console.log('lorry reservation cache tests passed');
