'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class CostMatrix {
    constructor() {
        this.data = new Uint8Array(50 * 50);
    }

    set(x, y, value) {
        this.data[y * 50 + x] = value;
    }

    get(x, y) {
        return this.data[y * 50 + x];
    }
}

function loadQuadInternals(terrainCells, structures) {
    const rolePath = path.join(__dirname, '..', 'role.quad.js');
    const source = fs.readFileSync(rolePath, 'utf8')
        + '\nmodule.exports.__test = { quadCostMatrix: quadCostMatrix };\n';

    const terrain = {
        get(x, y) {
            return terrainCells[`${x}:${y}`] || 0;
        }
    };
    const room = {
        find(type) {
            if (type === 'structures') return structures || [];
            return [];
        }
    };
    const sandbox = {
        module: {exports: {}},
        exports: {},
        require(name) {
            if (name === 'combat.math') return {};
            throw new Error(`unexpected require: ${name}`);
        },
        Uint8Array,
        PathFinder: {CostMatrix},
        Game: {
            rooms: {W0N0: room},
            map: {getRoomTerrain() { return terrain; }}
        },
        TERRAIN_MASK_WALL: 1,
        TERRAIN_MASK_SWAMP: 2,
        FIND_STRUCTURES: 'structures',
        FIND_CREEPS: 'creeps',
        FIND_POWER_CREEPS: 'powerCreeps',
        STRUCTURE_ROAD: 'road',
        STRUCTURE_CONTAINER: 'container',
        STRUCTURE_RAMPART: 'rampart',
        STRUCTURE_CONTROLLER: 'controller',
        STRUCTURE_WALL: 'constructedWall',
        OBSTACLE_OBJECT_TYPES: []
    };

    vm.runInNewContext(source, sandbox, {filename: rolePath});
    return sandbox.module.exports.__test;
}

(function testPackedFootprintUsesSlowestTerrain() {
    const quad = loadQuadInternals({'11:10': 2}, []);
    const matrix = quad.quadCostMatrix('W0N0', []);

    assert.strictEqual(matrix.get(8, 8), 1,
        'an all-plain 2x2 footprint should cost 1');
    assert.strictEqual(matrix.get(10, 10), 5,
        'a 2x2 footprint with one swamp tile should cost 5 because the slowest member gates the packed quad');
})();

(function testRoadOverridesSwampFatigue() {
    const road = {structureType: 'road', pos: {x: 11, y: 10}};
    const quad = loadQuadInternals({'11:10': 2}, [road]);
    const matrix = quad.quadCostMatrix('W0N0', []);

    assert.strictEqual(matrix.get(10, 10), 1,
        'a road under the swamp member should restore the footprint cost when the other three tiles are plain');
})();

(function testPassableRampartDoesNotHideSwampFatigue() {
    const rampart = {structureType: 'rampart', pos: {x: 11, y: 10}, my: true, isPublic: false};
    const quad = loadQuadInternals({'11:10': 2}, [rampart]);
    const matrix = quad.quadCostMatrix('W0N0', []);

    assert.strictEqual(matrix.get(10, 10), 5,
        'a passable rampart without a road should retain the swamp movement cost underneath it');
})();

(function testRoadUnderPassableRampartStillOverridesSwampFatigue() {
    const road = {structureType: 'road', pos: {x: 11, y: 10}};
    const rampart = {structureType: 'rampart', pos: {x: 11, y: 10}, my: true, isPublic: false};
    const quad = loadQuadInternals({'11:10': 2}, [road, rampart]);
    const matrix = quad.quadCostMatrix('W0N0', []);

    assert.strictEqual(matrix.get(10, 10), 1,
        'a road should remain fast when a passable rampart shares the swamp tile');
})();

(function testWallStillBlocksWholeFootprint() {
    const quad = loadQuadInternals({'21:20': 1}, []);
    const matrix = quad.quadCostMatrix('W0N0', []);

    assert.strictEqual(matrix.get(20, 20), 255,
        'a wall in any member slot should block the full 2x2 footprint');
})();

console.log('role.quad swamp footprint tests passed');
