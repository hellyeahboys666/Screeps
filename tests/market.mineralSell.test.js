const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'market.mineralSell.js'), 'utf8');

function makeStore(amounts) {
    return {getUsedCapacity: (resource) => amounts[resource] || 0};
}

// Transfer energy for `amount` units: 0.1 per unit per 10 rooms of distance.
function distance(a, b) {
    return {near: 1, far: 30}[b] || 1;
}

function load({orders, history, memory, myOrders}) {
    const deals = [];
    const Game = {
        time: 1000,
        market: {
            orders: myOrders || {},
            getHistory: (resource) => history[resource] || [],
            getAllOrders: (filter) => orders.filter((o) => o.type == filter.type && o.resourceType == filter.resourceType),
            calcTransactionCost: (amount, from, to) => Math.ceil(amount * distance(from, to) * 0.01),
            deal: (id, amount, roomName) => { deals.push({id, amount, roomName}); return 0; }
        }
    };
    const sandbox = {module: {exports: {}}, exports: {}, Game, Memory: memory || {},
        ORDER_BUY: 'buy', RESOURCE_ENERGY: 'energy', FIND_MINERALS: 'minerals', OK: 0};
    vm.runInNewContext(source, sandbox, {filename: 'market.mineralSell.js'});
    return {sell: sandbox.module.exports, deals, Game};
}

function makeRoom({terminal, storage, cooldown}) {
    return {
        name: 'home',
        memory: {},
        terminal: {my: true, cooldown: cooldown || 0, store: makeStore(terminal)},
        storage: storage ? {store: makeStore(storage)} : undefined,
        find: () => [{mineralType: 'O'}]
    };
}

const history = {O: [{avgPrice: 22, volume: 1000}], energy: [{avgPrice: 15, volume: 1000}]};
const order = (id, price, amount, roomName) => ({id, type: 'buy', resourceType: 'O', price, amount, roomName});

// Sells into the buyer with the best price after energy, above the floor.
{
    const {sell, deals} = load({history, orders: [
        order('lowball', 10, 50000, 'near'),
        order('far', 24, 50000, 'far'),
        order('near', 21, 50000, 'near')
    ]});
    const room = makeRoom({terminal: {O: 50000, energy: 20000}});
    sell.maintain(room);
    assert.equal(deals.length, 1);
    assert.equal(deals[0].id, 'near', 'far buyer nets 24 - 0.3*15 = 19.5 < near buyer 21 - 0.15');
    assert.equal(deals[0].amount, 20000, 'one deal is capped at maxPerDeal');
    assert.equal(room.memory.mineralSellStatus.reason, 'sold');
    assert.equal(room.memory.mineralSold.O.amount, 20000);
}

// Keeps the reserve across terminal and storage.
{
    const {sell, deals} = load({history, orders: [order('near', 22, 50000, 'near')]});
    const room = makeRoom({terminal: {O: 8000, energy: 20000}, storage: {O: 4000}});
    sell.maintain(room);
    assert.equal(deals[0].amount, 2000, '12000 stored minus 10000 kept');
}

// No buyer above the floor: nothing is sold.
{
    const {sell, deals} = load({history, orders: [order('lowball', 15, 50000, 'near')]});
    const room = makeRoom({terminal: {O: 50000, energy: 20000}});
    sell.maintain(room);
    assert.equal(deals.length, 0);
    assert.equal(room.memory.mineralSellStatus.reason, 'noBuyerAboveFloor');
}

// Limited terminal energy shrinks the deal instead of failing it.
{
    const {sell, deals} = load({history, orders: [order('far', 30, 50000, 'far')]});
    const room = makeRoom({terminal: {O: 50000, energy: 3000}});
    sell.maintain(room);
    assert.equal(deals[0].amount, 10000, '3000 energy pays for 10000 units at 0.3 each');
}

// Skips our own orders, a terminal on cooldown, and throttles between checks.
{
    const {sell, deals, Game} = load({history, orders: [order('mine', 30, 50000, 'near')],
        myOrders: {mine: {}}});
    const room = makeRoom({terminal: {O: 50000, energy: 20000}});
    sell.maintain(room);
    assert.equal(deals.length, 0);

    const cooled = makeRoom({terminal: {O: 50000, energy: 20000}, cooldown: 5});
    sell.maintain(cooled);
    assert.equal(cooled.memory.mineralSellStatus.reason, 'terminalCooldown');

    Game.time += 10;
    sell.maintain(room);
    assert.equal(room.memory.mineralSellStatus.tick, 1000, 'next check waits 50 ticks');
}

// Can be switched off globally.
{
    const {sell, deals} = load({history, orders: [order('near', 22, 50000, 'near')],
        memory: {mineralSellEnabled: false}});
    sell.maintain(makeRoom({terminal: {O: 50000, energy: 20000}}));
    assert.equal(deals.length, 0);
}

console.log('mineral sell tests passed');
