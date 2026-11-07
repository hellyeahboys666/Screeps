var energyReserve = require('energy.reserve');

var DEFAULT_BUY_PRICE = 36.5;
var DEFAULT_MAX_ORDER_AMOUNT = 250000;
var DEFAULT_MIN_ORDER_DEFICIT = 10000;
var DEFAULT_CREDIT_FLOOR = 10000000;
var ORDER_ACTIVATION_RETRY_TICKS = 10000;

function isFiniteNumber(value)
{
    return typeof value == 'number' && isFinite(value);
}

function getMemoryNumber(memory, key, fallback)
{
    if (memory && isFiniteNumber(memory[key]))
    {
        return memory[key];
    }
    return fallback;
}

function getConfiguredNumber(spawn, roomKey, spawnKey, fallback)
{
    if (spawn && spawn.memory && isFiniteNumber(spawn.memory[spawnKey]))
    {
        return spawn.memory[spawnKey];
    }
    if (spawn && spawn.room && spawn.room.memory && isFiniteNumber(spawn.room.memory[roomKey]))
    {
        return spawn.room.memory[roomKey];
    }
    return fallback;
}

function getOrderRemaining(order)
{
    if (!order)
    {
        return 0;
    }
    if (isFiniteNumber(order.remainingAmount))
    {
        return Math.max(0, order.remainingAmount);
    }
    if (isFiniteNumber(order.amount))
    {
        return Math.max(0, order.amount);
    }
    return 0;
}

function getOpenBuyExposure()
{
    var exposure = 0;
    for (let id in Game.market.orders)
    {
        let order = Game.market.orders[id];
        if (order.type == ORDER_BUY)
        {
            exposure += getOrderRemaining(order) * order.price;
        }
    }
    return exposure;
}

function getOpenRoomEnergyBuyAmount(roomName)
{
    var amount = 0;
    for (let id in Game.market.orders)
    {
        let order = Game.market.orders[id];
        if (order.type == ORDER_BUY
            && order.resourceType == RESOURCE_ENERGY
            && order.roomName == roomName)
        {
            amount += getOrderRemaining(order);
        }
    }
    return amount;
}

function isEnabled(spawn)
{
    if (!spawn || !spawn.room || !spawn.room.terminal || !spawn.room.storage)
    {
        return false;
    }
    if (spawn.memory && spawn.memory.energyReserveMarketEnabled != undefined)
    {
        return spawn.memory.energyReserveMarketEnabled == true;
    }
    if (spawn.room.memory && spawn.room.memory.energyReserveMarketEnabled != undefined)
    {
        return spawn.room.memory.energyReserveMarketEnabled == true;
    }
    return energyReserve.isRcl6ReserveRoom(spawn.room);
}

function recordStatus(spawn, status)
{
    if (!spawn || !spawn.memory)
    {
        return;
    }
    spawn.memory.energyReserveStatus = status;
    spawn.memory.energyReserveTarget = status.target;
    spawn.memory.energyReserveStored = status.total;
    spawn.memory.energyReserveDeficit = status.deficit;
}

function maintain(spawn)
{
    if (!spawn || !spawn.room || !spawn.memory)
    {
        return;
    }

    var targetOverride = getConfiguredNumber(spawn,
        'energyReserveTarget',
        'energyReserveTarget',
        undefined);
    var reserve = energyReserve.getReserveStatus(spawn.room, targetOverride);
    var status = {
        updated: Game.time,
        room: spawn.room.name,
        enabled: isEnabled(spawn),
        target: reserve.target,
        total: reserve.total,
        deficit: reserve.deficit,
        storageEnergy: reserve.storageEnergy,
        terminalEnergy: reserve.terminalEnergy,
        reason: undefined
    };

    if (!status.enabled)
    {
        status.reason = 'disabled';
        recordStatus(spawn, status);
        return;
    }
    if (!spawn.room.terminal || !spawn.room.storage)
    {
        status.reason = 'missingStorageOrTerminal';
        recordStatus(spawn, status);
        return;
    }

    var activeBuyAmount = getOpenRoomEnergyBuyAmount(spawn.room.name);
    status.activeBuyAmount = activeBuyAmount;

    var minDeficit = Math.max(1, Math.floor(getConfiguredNumber(spawn,
        'energyReserveMinOrderDeficit',
        'energyReserveMinOrderDeficit',
        DEFAULT_MIN_ORDER_DEFICIT)));
    var needed = reserve.deficit - activeBuyAmount;
    status.orderNeed = Math.max(0, needed);
    status.minOrderDeficit = minDeficit;
    if (needed < minDeficit)
    {
        status.reason = 'covered';
        recordStatus(spawn, status);
        return;
    }

    var terminalFree = spawn.room.terminal.store.getFreeCapacity();
    var availableTerminalFree = terminalFree - activeBuyAmount;
    status.terminalFree = terminalFree;
    status.availableTerminalFree = Math.max(0, availableTerminalFree);
    if (availableTerminalFree < minDeficit)
    {
        status.reason = 'terminalFullOrReserved';
        recordStatus(spawn, status);
        return;
    }

    var price = getConfiguredNumber(spawn,
        'energyReserveBuyPrice',
        'energyReserveBuyPrice',
        DEFAULT_BUY_PRICE);
    price = Math.max(0, price);
    status.price = price;
    if (price <= 0)
    {
        status.reason = 'noPrice';
        recordStatus(spawn, status);
        return;
    }

    var maxOrderAmount = Math.max(1, Math.floor(getConfiguredNumber(spawn,
        'energyReserveMaxOrderAmount',
        'energyReserveMaxOrderAmount',
        DEFAULT_MAX_ORDER_AMOUNT)));
    var creditFloor = Math.max(0, getConfiguredNumber(spawn,
        'energyReserveCreditFloor',
        'energyReserveCreditFloor',
        DEFAULT_CREDIT_FLOOR));
    var openBuyExposure = getOpenBuyExposure();
    var spendable = Game.market.credits - creditFloor - openBuyExposure;
    var affordableAmount = Math.floor(spendable / (price * 1.05));
    var orderAmount = Math.min(Math.floor(needed), Math.floor(availableTerminalFree), maxOrderAmount, affordableAmount);

    status.maxOrderAmount = maxOrderAmount;
    status.creditFloor = creditFloor;
    status.openBuyExposure = Math.floor(openBuyExposure);
    status.credits = Math.floor(Game.market.credits);
    status.affordableAmount = Math.max(0, affordableAmount);
    status.orderAmount = Math.max(0, orderAmount);
    if (orderAmount < minDeficit)
    {
        status.reason = 'creditFloorOrTooSmall';
        recordStatus(spawn, status);
        return;
    }

    var lastCreateTick = spawn.memory.energyReserveLastOrderCreateTick;
    if (typeof lastCreateTick == 'number'
        && Game.time < lastCreateTick + ORDER_ACTIVATION_RETRY_TICKS)
    {
        status.reason = 'awaitingOrderActivation';
        status.retryAt = lastCreateTick + ORDER_ACTIVATION_RETRY_TICKS;
        recordStatus(spawn, status);
        return;
    }

    var result = Game.market.createOrder({
        type: ORDER_BUY,
        resourceType: RESOURCE_ENERGY,
        price: price,
        totalAmount: orderAmount,
        roomName: spawn.room.name
    });
    status.result = result;
    status.reason = result == OK ? 'created' : 'createFailed';
    if (result == OK)
    {
        spawn.memory.energyReserveLastOrderCreateTick = Game.time;
    }
    recordStatus(spawn, status);
}

module.exports = {
    maintain: maintain
};
