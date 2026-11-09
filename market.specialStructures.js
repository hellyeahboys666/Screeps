// Keeps completed Power Spawns and Nukers supplied without giving every tick a market scan.
// Resource purchases are passive BUY orders: sellers pay the transaction energy, which is
// important while a room's terminal is being refilled by lorries.

var marketExposure = require('market.exposure');

var DEFAULT_POWER_MAX_PRICE = 1750;
var DEFAULT_GHODIUM_MAX_PRICE = 400;
var RCL8_POWER_STOCKPILE_TARGET = 10000;
var DEFAULT_CREDIT_FLOOR = 10000000;
// A full RCL8 power stockpile may be priced at the configured power cap.
var DEFAULT_MAX_OPEN_EXPOSURE = RCL8_POWER_STOCKPILE_TARGET * DEFAULT_POWER_MAX_PRICE;
var DEFAULT_MAX_ORDER_AMOUNT = 5000;
var DEFAULT_ORDER_DEFICIT = 1;
var ownedStructureCacheTick;
var ownedStructuresByRoom = {};

function getPowerSpawnPowerCapacity()
{
    return typeof POWER_SPAWN_POWER_CAPACITY == 'number' ? POWER_SPAWN_POWER_CAPACITY : 100;
}

function getNukerGhodiumCapacity()
{
    return typeof NUKER_GHODIUM_CAPACITY == 'number' ? NUKER_GHODIUM_CAPACITY : 5000;
}

var SPECIAL_STRUCTURE_RESOURCES = [
    {
        key: 'power',
        structureType: STRUCTURE_POWER_SPAWN,
        resource: RESOURCE_POWER,
        fallbackCapacity: getPowerSpawnPowerCapacity(),
        defaultMaxPrice: DEFAULT_POWER_MAX_PRICE,
        defaultMaxOrderAmount: RCL8_POWER_STOCKPILE_TARGET
    },
    {
        key: 'ghodium',
        structureType: STRUCTURE_NUKER,
        resource: RESOURCE_GHODIUM,
        fallbackCapacity: getNukerGhodiumCapacity(),
        defaultMaxPrice: DEFAULT_GHODIUM_MAX_PRICE,
        defaultMaxOrderAmount: DEFAULT_MAX_ORDER_AMOUNT
    }
];

function getConfiguredNumber(spawn, key, resource, fallback)
{
    var sources = [spawn.memory, spawn.room.memory, Memory];
    for (let source of sources)
    {
        if (!source || source[key] == undefined)
        {
            continue;
        }
        let value = source[key];
        if (typeof value == 'object' && value[resource] != undefined)
        {
            value = value[resource];
        }
        if (typeof value == 'number' && isFinite(value))
        {
            return value;
        }
    }
    return fallback;
}

function getOwnedStructures(room, structureType)
{
    if (!room)
    {
        return [];
    }
    if (ownedStructureCacheTick != Game.time)
    {
        ownedStructureCacheTick = Game.time;
        ownedStructuresByRoom = {};
    }
    var roomCache = ownedStructuresByRoom[room.name];
    if (!roomCache || roomCache.room !== room)
    {
        roomCache = {room: room, byType: {}};
        var structures = room.find(FIND_MY_STRUCTURES,
        {
            filter: (s) => !!s.store
        });
        for (let structure of structures)
        {
            if (!roomCache.byType[structure.structureType])
            {
                roomCache.byType[structure.structureType] = [];
            }
            roomCache.byType[structure.structureType].push(structure);
        }
        ownedStructuresByRoom[room.name] = roomCache;
    }
    return (roomCache.byType[structureType] || []).slice();
}

function getResourceCapacity(structure, resource, fallbackCapacity)
{
    if (!structure || !structure.store)
    {
        return 0;
    }
    var capacity = structure.store.getCapacity(resource);
    if (typeof capacity != 'number' || capacity <= 0)
    {
        capacity = fallbackCapacity;
    }
    return capacity;
}

function getResourceNeeds(room)
{
    var needs = [];
    for (let definition of SPECIAL_STRUCTURE_RESOURCES)
    {
        let structures = getOwnedStructures(room, definition.structureType);
        for (let structure of structures)
        {
            let capacity = getResourceCapacity(structure, definition.resource, definition.fallbackCapacity);
            let stored = structure.store.getUsedCapacity(definition.resource) || 0;
            needs.push({
                key: definition.key,
                structureId: structure.id,
                structureType: definition.structureType,
                resource: definition.resource,
                capacity: capacity,
                stored: stored,
                deficit: Math.max(0, capacity - stored),
                defaultMaxPrice: definition.defaultMaxPrice
            });
        }
    }
    return needs;
}

function getRoomResourceAmount(room, resource)
{
    var amount = 0;
    if (room.storage)
    {
        amount += room.storage.store.getUsedCapacity(resource) || 0;
    }
    if (room.terminal)
    {
        amount += room.terminal.store.getUsedCapacity(resource) || 0;
    }
    return amount;
}

function getOrderRemaining(order)
{
    if (!order)
    {
        return 0;
    }
    if (typeof order.remainingAmount == 'number')
    {
        return Math.max(0, order.remainingAmount);
    }
    if (typeof order.amount == 'number')
    {
        return Math.max(0, order.amount);
    }
    return 0;
}

function getOpenRoomBuyAmount(roomName)
{
    var amount = 0;
    for (let id in Game.market.orders)
    {
        let order = Game.market.orders[id];
        if (order.type == ORDER_BUY && order.roomName == roomName)
        {
            amount += getOrderRemaining(order);
        }
    }
    return amount;
}

function getActiveBuyOrder(resource, roomName)
{
    var best = undefined;
    for (let id in Game.market.orders)
    {
        let order = Game.market.orders[id];
        if (order.type != ORDER_BUY
            || order.resourceType != resource
            || order.roomName != roomName
            || !order.active
            || getOrderRemaining(order) <= 0)
        {
            continue;
        }
        if (!best || order.price > best.price)
        {
            best = order;
        }
    }
    return best;
}

function getOpenBuyExposure()
{
    var exposure = 0;
    for (let id in Game.market.orders)
    {
        let order = Game.market.orders[id];
        if (order.type == ORDER_BUY && order.active)
        {
            exposure += getOrderRemaining(order) * (order.price || 0);
        }
    }
    return exposure + marketExposure.getPending();
}

function getBestSellOrder(resource, roomName)
{
    var orders = Game.market.getAllOrders({type: ORDER_SELL, resourceType: resource});
    var best = undefined;
    for (let order of orders)
    {
        if (!order
            || getOrderRemaining(order) <= 0
            || order.roomName == roomName)
        {
            continue;
        }
        if (!best || order.price < best.price)
        {
            best = order;
        }
    }
    return best;
}

function getBuyOrderPrice(resource, roomName, maxPrice)
{
    var bestSell = getBestSellOrder(resource, roomName);
    if (!bestSell)
    {
        return undefined;
    }
    if (bestSell.price > maxPrice)
    {
        return undefined;
    }
    // Posting at the current lowest sell price makes the order immediately useful
    // when sellers accept BUY orders without issuing an energy-expensive deal.
    return bestSell.price;
}

function cancelOrder(order)
{
    if (!order)
    {
        return undefined;
    }
    var result = Game.market.cancelOrder(order.id);
    return result == OK ? 'cancelled' : result;
}

function getNeedForResource(room, resource, needs)
{
    var capacity = 0;
    var stored = getRoomResourceAmount(room, resource);
    for (let need of needs)
    {
        if (need.resource == resource)
        {
            capacity += need.capacity;
            stored += need.stored;
        }
    }
    // At RCL8, build a power reserve before a Power Spawn is constructed so
    // processing can begin immediately once the structure is ready.
    if (resource == RESOURCE_POWER
        && room.controller
        && room.controller.my
        && room.controller.level >= 8)
    {
        capacity = Math.max(capacity, RCL8_POWER_STOCKPILE_TARGET);
    }
    return {capacity: capacity, stored: stored, deficit: Math.max(0, capacity - stored)};
}

function getEnergySink(room, allowNuker, allowPowerSpawn)
{
    if (allowPowerSpawn !== false)
    {
        var powerSpawns = getOwnedStructures(room, STRUCTURE_POWER_SPAWN);
        for (let powerSpawn of powerSpawns)
        {
            if (powerSpawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
            {
                return powerSpawn;
            }
        }
    }
    if (!allowNuker)
    {
        return undefined;
    }
    var nukers = getOwnedStructures(room, STRUCTURE_NUKER);
    for (let nuker of nukers)
    {
        if (nuker.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
        {
            return nuker;
        }
    }
    return undefined;
}

function getLoadRequest(spawn, creepsInRoom)
{
    if (!spawn || !spawn.room)
    {
        return undefined;
    }
    creepsInRoom = creepsInRoom || [];
    var needs = getResourceNeeds(spawn.room);
    var request = undefined;

    // A Power Spawn has a permanent, dedicated logistics assignment. Create its
    // loader as soon as the owned structure exists, even while it is full or the
    // room has not yet acquired power. The assigned creep waits near the target
    // and resumes loading after processPower() creates the next deficit.
    for (let need of needs)
    {
        if (need.structureType != STRUCTURE_POWER_SPAWN)
        {
            continue;
        }
        let assigned = _.some(creepsInRoom, (c) => c.memory.role == 'mineralLorry'
            && c.memory.specialStructureId == need.structureId
            && c.memory.mineralType == need.resource);
        if (!assigned)
        {
            request = need;
            break;
        }
    }

    // Nuker loading remains demand-driven: unlike the Power Spawn, it does not
    // need a permanently parked lorry.
    if (!request && (spawn.room.storage || spawn.room.terminal))
    {
        for (let need of needs)
        {
            if (need.structureType == STRUCTURE_POWER_SPAWN
                || need.deficit <= 0
                || getRoomResourceAmount(spawn.room, need.resource) <= 0)
            {
                continue;
            }
            let assigned = _.some(creepsInRoom, (c) => c.memory.role == 'mineralLorry'
                && c.memory.specialStructureId == need.structureId
                && c.memory.mineralType == need.resource);
            if (!assigned)
            {
                request = need;
                break;
            }
        }
    }
    if (request)
    {
        spawn.memory.specialStructureLoadRequest = {
            resource: request.resource,
            structureId: request.structureId,
            structureType: request.structureType,
            deficit: request.deficit,
            persistent: request.structureType == STRUCTURE_POWER_SPAWN,
            tick: Game.time
        };
    }
    else
    {
        delete spawn.memory.specialStructureLoadRequest;
    }
    return request;
}

function maintain(spawn)
{
    if (!spawn || !spawn.room || !spawn.room.terminal || !Game.market)
    {
        return undefined;
    }
    var room = spawn.room;
    var needs = getResourceNeeds(room);
    var status = {
        tick: Game.time,
        enabled: spawn.memory.specialStructureMarketEnabled !== false
            && room.memory.specialStructureMarketEnabled !== false
            && Memory.specialStructureMarketEnabled !== false,
        room: room.name,
        resources: {}
    };
    spawn.memory.specialStructureMarketStatus = status;
    if (!status.enabled)
    {
        status.reason = 'disabled';
        return status;
    }
    if (needs.length == 0 && getNeedForResource(room, RESOURCE_POWER, needs).capacity <= 0)
    {
        status.reason = 'no managed structures';
        return status;
    }

    var creditFloor = getConfiguredNumber(spawn,
        'specialStructureCreditFloor', RESOURCE_POWER, DEFAULT_CREDIT_FLOOR);
    var maxExposure = getConfiguredNumber(spawn,
        'specialStructureMaxOpenExposure', RESOURCE_POWER, DEFAULT_MAX_OPEN_EXPOSURE);
    var minDeficit = getConfiguredNumber(spawn,
        'specialStructureMinOrderDeficit', RESOURCE_POWER, DEFAULT_ORDER_DEFICIT);
    var exposure = getOpenBuyExposure();
    var terminalFree = room.terminal.store.getFreeCapacity();
    var openRoomBuyAmount = getOpenRoomBuyAmount(room.name);
    var terminalFreeForNewBuys = Math.max(0, terminalFree - openRoomBuyAmount);
    status.terminalFree = terminalFree;
    status.openRoomBuyAmount = openRoomBuyAmount;
    status.availableTerminalFree = terminalFreeForNewBuys;

    for (let definition of SPECIAL_STRUCTURE_RESOURCES)
    {
        let summary = getNeedForResource(room, definition.resource, needs);
        if (summary.capacity <= 0)
        {
            continue;
        }
        let activeOrder = getActiveBuyOrder(definition.resource, room.name);
        let activeAmount = getOrderRemaining(activeOrder);
        let remaining = Math.max(0, summary.deficit - activeAmount);
        let resourceStatus = {
            capacity: summary.capacity,
            inStructures: summary.stored - getRoomResourceAmount(room, definition.resource),
            available: getRoomResourceAmount(room, definition.resource),
            activeOrderAmount: activeAmount,
            remaining: remaining
        };
        status.resources[definition.key] = resourceStatus;

        if (summary.deficit <= 0)
        {
            resourceStatus.action = cancelOrder(activeOrder) || 'ready';
            continue;
        }
        let maxPrice = getConfiguredNumber(spawn,
            'specialStructureBuyPrices', definition.resource, definition.defaultMaxPrice);
        let price = getBuyOrderPrice(definition.resource, room.name, maxPrice);
        resourceStatus.maxPrice = maxPrice;
        // Keep an open order at the lowest sell price, down as well as up, even
        // while it already covers the deficit. A raise must fit the credit reserve
        // (5% fee on the increase); extending waits for the next check.
        if (activeOrder && price != undefined && activeOrder.price != price)
        {
            let extra = Math.max(0, price - activeOrder.price) * activeAmount;
            resourceStatus.price = price;
            resourceStatus.action = extra > 0
                    && (Game.market.credits < creditFloor + exposure + extra * 1.05 || exposure + extra > maxExposure)
                ? 'reprice would breach credit reserve'
                : Game.market.changeOrderPrice(activeOrder.id, price);
            if (resourceStatus.action == OK)
            {
                exposure += extra;
                marketExposure.addPending(extra * 1.05);
            }
            continue;
        }
        if (remaining < minDeficit)
        {
            resourceStatus.action = 'awaiting active order';
            continue;
        }
        if (Game.market.credits < creditFloor)
        {
            resourceStatus.reason = 'credit floor';
            continue;
        }
        if (exposure >= maxExposure)
        {
            resourceStatus.reason = 'open exposure limit';
            continue;
        }

        let maxOrderAmount = getConfiguredNumber(spawn,
            'specialStructureMaxOrderAmount', definition.resource, definition.defaultMaxOrderAmount);
        if (price == undefined)
        {
            resourceStatus.reason = 'no sell at or below cap';
            continue;
        }
        let desiredOrderAmount = Math.min(summary.deficit, maxOrderAmount);
        let amount = activeOrder
            ? Math.max(0, desiredOrderAmount - activeAmount)
            : Math.min(remaining, maxOrderAmount);
        amount = Math.min(amount, terminalFreeForNewBuys);
        let targetOrderAmount = activeAmount + amount;
        resourceStatus.availableTerminalFree = terminalFreeForNewBuys;
        if (amount < minDeficit)
        {
            resourceStatus.reason = 'terminalFullOrReserved';
            continue;
        }
        let orderCost = amount * price;
        let fee = orderCost * 0.05;
        if (Game.market.credits < creditFloor + exposure + orderCost + fee)
        {
            resourceStatus.reason = 'credit reserve';
            continue;
        }
        if (exposure + orderCost > maxExposure)
        {
            resourceStatus.reason = 'order would exceed exposure';
            continue;
        }

        var addedOrderAmount = 0;
        if (activeOrder)
        {
            if (activeAmount < targetOrderAmount)
            {
                addedOrderAmount = amount;
                resourceStatus.action = Game.market.extendOrder(activeOrder.id, amount);
            }
            else
            {
                resourceStatus.action = 'active';
            }
        }
        else
        {
            addedOrderAmount = amount;
            resourceStatus.action = Game.market.createOrder({
                type: ORDER_BUY,
                resourceType: definition.resource,
                price: price,
                totalAmount: amount,
                roomName: room.name
            });
        }
        resourceStatus.price = price;
        resourceStatus.amount = amount;
        if (resourceStatus.action == OK && addedOrderAmount > 0)
        {
            exposure += addedOrderAmount * price;
            marketExposure.addPending(addedOrderAmount * price * 1.05);
            terminalFreeForNewBuys = Math.max(0, terminalFreeForNewBuys - addedOrderAmount);
        }
    }
    return status;
}

module.exports = {
    getEnergySink: getEnergySink,
    getLoadRequest: getLoadRequest,
    getOwnedStructures: getOwnedStructures,
    getResourceNeeds: getResourceNeeds,
    maintain: maintain
};
