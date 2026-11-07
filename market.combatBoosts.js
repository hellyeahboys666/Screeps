var DEFAULT_STOCK_TARGET = (typeof LAB_MINERAL_CAPACITY == 'number' ? LAB_MINERAL_CAPACITY : 3000) * 2;
var DEFAULT_MIN_ORDER_DEFICIT = 300;
var DEFAULT_MAX_ORDER_AMOUNT = 6000;
var DEFAULT_CREDIT_FLOOR = 10000000;
var DEFAULT_MAX_OPEN_EXPOSURE = 15000000;
var PRICE_REPRICE_THRESHOLD = 0.001;

var COMBAT_BOOST_BUY_RESOURCES = [
    {
        key: 'combatTough',
        resource: RESOURCE_CATALYZED_GHODIUM_ALKALIDE,
        label: 'XGHO2',
        defaultMaxPrice: 1000
    },
    {
        key: 'combatHeal',
        resource: RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE,
        label: 'XLHO2',
        defaultMaxPrice: 700
    },
    {
        key: 'combatRanged',
        resource: RESOURCE_CATALYZED_KEANIUM_ALKALIDE,
        label: 'XKHO2',
        defaultMaxPrice: 700
    }
];

function isFiniteNumber(value)
{
    return typeof value == 'number' && isFinite(value);
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
    if (typeof Memory != 'undefined' && isFiniteNumber(Memory[roomKey]))
    {
        return Memory[roomKey];
    }
    return fallback;
}

function getConfiguredResourceNumber(spawn, mapKey, resourceType, fallback)
{
    if (spawn && spawn.memory && spawn.memory[mapKey]
        && isFiniteNumber(spawn.memory[mapKey][resourceType]))
    {
        return spawn.memory[mapKey][resourceType];
    }
    if (spawn && spawn.room && spawn.room.memory && spawn.room.memory[mapKey]
        && isFiniteNumber(spawn.room.memory[mapKey][resourceType]))
    {
        return spawn.room.memory[mapKey][resourceType];
    }
    if (typeof Memory != 'undefined' && Memory[mapKey]
        && isFiniteNumber(Memory[mapKey][resourceType]))
    {
        return Memory[mapKey][resourceType];
    }
    return fallback;
}

function roundPrice(price)
{
    return Math.max(0.001, Math.round(price * 1000) / 1000);
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

function getOrderId(order, fallbackId)
{
    if (!order)
    {
        return fallbackId;
    }
    return order.id || order._id || fallbackId;
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

function getOwnBuyOrders(roomName, resourceType)
{
    var orders = [];
    for (let id in Game.market.orders)
    {
        let order = Game.market.orders[id];
        if (order.type == ORDER_BUY
            && order.resourceType == resourceType
            && order.roomName == roomName
            && getOrderRemaining(order) > 0)
        {
            orders.push({id: getOrderId(order, id), order: order});
        }
    }
    orders.sort(function(a, b)
    {
        return b.order.price - a.order.price;
    });
    return orders;
}

function getOwnedLabsByConstructionOrder(room)
{
    var labs = room.find(FIND_MY_STRUCTURES,
    {
        filter: (s) => s.structureType == STRUCTURE_LAB
    });
    labs.sort(function(a, b)
    {
        if (a.id < b.id)
        {
            return -1;
        }
        if (a.id > b.id)
        {
            return 1;
        }
        return 0;
    });
    return labs;
}

function getRecentWeightedAverage(resourceType)
{
    try
    {
        var history = Game.market.getHistory(resourceType) || [];
        var totalVolume = 0;
        var totalValue = 0;
        var start = Math.max(0, history.length - 7);
        for (var i = start; i < history.length; i++)
        {
            var entry = history[i];
            if (!entry || !isFiniteNumber(entry.avgPrice) || !isFiniteNumber(entry.volume) || entry.volume <= 0)
            {
                continue;
            }
            totalVolume += entry.volume;
            totalValue += entry.avgPrice * entry.volume;
        }
        if (totalVolume > 0)
        {
            return totalValue / totalVolume;
        }
    }
    catch (e)
    {
    }
    return undefined;
}

function getBestOrderPrice(resourceType, type)
{
    try
    {
        var orders = Game.market.getAllOrders({type: type, resourceType: resourceType});
        var best = undefined;
        for (let order of orders)
        {
            if (!order || !isFiniteNumber(order.price) || getOrderRemaining(order) <= 0)
            {
                continue;
            }
            if (best == undefined
                || (type == ORDER_SELL && order.price < best)
                || (type == ORDER_BUY && order.price > best))
            {
                best = order.price;
            }
        }
        return best;
    }
    catch (e)
    {
    }
    return undefined;
}

function getDesiredBuyPrice(spawn, boost)
{
    var priceCap = getConfiguredResourceNumber(spawn,
        'combatBoostBuyPrices',
        boost.resource,
        boost.defaultMaxPrice);
    priceCap = Math.max(0, priceCap);
    var context = {
        maxPrice: priceCap,
        bestSell: undefined,
        bestBuy: undefined,
        recentAverage: undefined,
        price: 0
    };
    if (priceCap <= 0)
    {
        return context;
    }

    context.bestSell = getBestOrderPrice(boost.resource, ORDER_SELL);
    context.bestBuy = getBestOrderPrice(boost.resource, ORDER_BUY);
    context.recentAverage = getRecentWeightedAverage(boost.resource);

    var desired = priceCap;
    if (isFiniteNumber(context.bestSell) && context.bestSell > 0 && context.bestSell <= priceCap)
    {
        desired = context.bestSell;
    }
    else if (isFiniteNumber(context.recentAverage) && context.recentAverage > 0)
    {
        desired = Math.min(priceCap, context.recentAverage * 1.15);
    }

    if (isFiniteNumber(context.bestBuy) && context.bestBuy > 0)
    {
        desired = Math.min(priceCap, Math.max(desired, context.bestBuy + 0.001));
    }
    context.price = roundPrice(desired);
    return context;
}

function getStoredResource(room, resourceType, lab)
{
    var amount = 0;
    if (room.terminal)
    {
        amount += room.terminal.store.getUsedCapacity(resourceType);
    }
    if (room.storage)
    {
        amount += room.storage.store.getUsedCapacity(resourceType);
    }
    if (lab)
    {
        amount += lab.store.getUsedCapacity(resourceType);
    }
    return amount;
}

function isEnabled(spawn, labs)
{
    if (!spawn || !spawn.room || !spawn.room.terminal)
    {
        return false;
    }
    if (typeof Memory != 'undefined' && Memory.combatBoostMarketEnabled === false)
    {
        return false;
    }
    if (spawn.room.memory && spawn.room.memory.combatBoostMarketEnabled === false)
    {
        return false;
    }
    if (spawn.memory && spawn.memory.combatBoostMarketEnabled === false)
    {
        return false;
    }
    return labs.length >= COMBAT_BOOST_BUY_RESOURCES.length;
}

function recordStatus(spawn, status)
{
    if (!spawn || !spawn.memory)
    {
        return;
    }
    spawn.memory.combatBoostMarketStatus = status;
}

function getTerminalFreeForNewBuys(spawn)
{
    var terminalFree = spawn.room.terminal.store.getFreeCapacity();
    var openRoomBuyAmount = getOpenRoomBuyAmount(spawn.room.name);
    return Math.max(0, terminalFree - openRoomBuyAmount);
}

function getAffordableAmount(spawn, price)
{
    var creditFloor = Math.max(0, getConfiguredNumber(spawn,
        'combatBoostCreditFloor',
        'combatBoostCreditFloor',
        DEFAULT_CREDIT_FLOOR));
    var maxExposure = Math.max(0, getConfiguredNumber(spawn,
        'combatBoostMaxOpenExposure',
        'combatBoostMaxOpenExposure',
        DEFAULT_MAX_OPEN_EXPOSURE));
    var openExposure = getOpenBuyExposure();
    var spendableByCredits = Game.market.credits - creditFloor - openExposure;
    var spendableByExposure = maxExposure - openExposure;
    var spendable = Math.min(spendableByCredits, spendableByExposure);
    if (price <= 0 || spendable <= 0)
    {
        return {
            amount: 0,
            creditFloor: creditFloor,
            maxOpenExposure: maxExposure,
            openBuyExposure: Math.floor(openExposure),
            credits: Math.floor(Game.market.credits)
        };
    }
    return {
        amount: Math.floor(spendable / (price * 1.05)),
        creditFloor: creditFloor,
        maxOpenExposure: maxExposure,
        openBuyExposure: Math.floor(openExposure),
        credits: Math.floor(Game.market.credits)
    };
}

function changeOrderPriceSafely(orderEntry, price, affordability, status)
{
    var order = orderEntry.order;
    var remaining = getOrderRemaining(order);
    var extraExposure = Math.max(0, price - order.price) * remaining;
    status.priceChangeExtraExposure = Math.ceil(extraExposure);
    if (extraExposure > 0 && affordability.amount <= 0)
    {
        status.reason = 'creditFloorOrExposureLimit';
        return false;
    }
    status.result = Game.market.changeOrderPrice(orderEntry.id, price);
    status.reason = status.result == OK ? 'repriced' : 'repriceFailed';
    return true;
}

function maintainBoostResource(spawn, boost, lab, status)
{
    var target = Math.max(0, Math.floor(getConfiguredResourceNumber(spawn,
        'combatBoostStockTargets',
        boost.resource,
        getConfiguredNumber(spawn,
            'combatBoostStockTarget',
            'combatBoostStockTarget',
            DEFAULT_STOCK_TARGET))));
    var minOrderDeficit = Math.max(1, Math.floor(getConfiguredNumber(spawn,
        'combatBoostMinOrderDeficit',
        'combatBoostMinOrderDeficit',
        DEFAULT_MIN_ORDER_DEFICIT)));
    var maxOrderAmount = Math.max(1, Math.floor(getConfiguredNumber(spawn,
        'combatBoostMaxOrderAmount',
        'combatBoostMaxOrderAmount',
        DEFAULT_MAX_ORDER_AMOUNT)));
    var stock = getStoredResource(spawn.room, boost.resource, lab);
    var ownOrders = getOwnBuyOrders(spawn.room.name, boost.resource);
    var activeBuyAmount = 0;
    for (let orderEntry of ownOrders)
    {
        activeBuyAmount += getOrderRemaining(orderEntry.order);
    }

    status.target = target;
    status.stock = stock;
    status.labStored = lab ? lab.store.getUsedCapacity(boost.resource) : 0;
    status.terminalStored = spawn.room.terminal.store.getUsedCapacity(boost.resource);
    status.storageStored = spawn.room.storage ? spawn.room.storage.store.getUsedCapacity(boost.resource) : 0;
    status.activeBuyAmount = activeBuyAmount;
    status.minOrderDeficit = minOrderDeficit;
    status.maxOrderAmount = maxOrderAmount;
    status.deficit = Math.max(0, target - stock);

    if (target <= 0)
    {
        status.reason = 'targetDisabled';
        return;
    }
    if (stock >= target)
    {
        status.reason = 'stocked';
        if (ownOrders.length > 0 && !(spawn.memory && spawn.memory.combatBoostCancelSurplusOrders === false))
        {
            status.orderId = ownOrders[0].id;
            status.result = Game.market.cancelOrder(ownOrders[0].id);
            status.reason = status.result == OK ? 'cancelledSurplusOrder' : 'cancelSurplusFailed';
        }
        return;
    }

    var priceContext = getDesiredBuyPrice(spawn, boost);
    status.price = priceContext.price;
    status.maxPrice = priceContext.maxPrice;
    status.bestSell = priceContext.bestSell;
    status.bestBuy = priceContext.bestBuy;
    status.recentAverage = priceContext.recentAverage;
    if (priceContext.price <= 0)
    {
        status.reason = 'noPrice';
        return;
    }

    var bestOwnOrder = ownOrders.length > 0 ? ownOrders[0] : undefined;
    var affordability = getAffordableAmount(spawn, priceContext.price);
    status.creditFloor = affordability.creditFloor;
    status.maxOpenExposure = affordability.maxOpenExposure;
    status.openBuyExposure = affordability.openBuyExposure;
    status.credits = affordability.credits;
    status.affordableAmount = Math.max(0, affordability.amount);

    if (bestOwnOrder && Math.abs(bestOwnOrder.order.price - priceContext.price) >= PRICE_REPRICE_THRESHOLD)
    {
        status.orderId = bestOwnOrder.id;
        status.oldPrice = bestOwnOrder.order.price;
        changeOrderPriceSafely(bestOwnOrder, priceContext.price, affordability, status);
        return;
    }

    var remainingNeed = Math.max(0, target - stock - activeBuyAmount);
    status.orderNeed = remainingNeed;
    if (remainingNeed < minOrderDeficit)
    {
        status.reason = 'covered';
        return;
    }

    var terminalFree = getTerminalFreeForNewBuys(spawn);
    status.availableTerminalFree = terminalFree;
    if (terminalFree < minOrderDeficit)
    {
        status.reason = 'terminalFullOrReserved';
        return;
    }

    var orderAmount = Math.min(remainingNeed, terminalFree, maxOrderAmount, affordability.amount);
    orderAmount = Math.floor(orderAmount);
    status.orderAmount = Math.max(0, orderAmount);
    if (orderAmount < minOrderDeficit)
    {
        status.reason = 'creditFloorOrTooSmall';
        return;
    }

    if (bestOwnOrder)
    {
        status.orderId = bestOwnOrder.id;
        status.result = Game.market.extendOrder(bestOwnOrder.id, orderAmount);
        status.reason = status.result == OK ? 'extended' : 'extendFailed';
        return;
    }

    status.result = Game.market.createOrder({
        type: ORDER_BUY,
        resourceType: boost.resource,
        price: priceContext.price,
        totalAmount: orderAmount,
        roomName: spawn.room.name
    });
    status.reason = status.result == OK ? 'created' : 'createFailed';
}

function maintain(spawn)
{
    if (!spawn || !spawn.room || !spawn.memory)
    {
        return;
    }
    var labs = getOwnedLabsByConstructionOrder(spawn.room);
    var status = {
        updated: Game.time,
        room: spawn.room.name,
        enabled: isEnabled(spawn, labs),
        labCount: labs.length,
        targetPerResource: Math.max(0, Math.floor(getConfiguredNumber(spawn,
            'combatBoostStockTarget',
            'combatBoostStockTarget',
            DEFAULT_STOCK_TARGET))),
        resources: []
    };

    if (!spawn.room.terminal)
    {
        status.reason = 'missingTerminal';
        recordStatus(spawn, status);
        return;
    }
    if (!status.enabled)
    {
        status.reason = labs.length < COMBAT_BOOST_BUY_RESOURCES.length ? 'waitingForFirstThreeLabs' : 'disabled';
        recordStatus(spawn, status);
        return;
    }

    for (var i = 0; i < COMBAT_BOOST_BUY_RESOURCES.length; i++)
    {
        var boost = COMBAT_BOOST_BUY_RESOURCES[i];
        var lab = labs[i];
        var resourceStatus = {
            key: boost.key,
            resource: boost.resource,
            label: boost.label,
            labId: lab ? lab.id : undefined,
            x: lab ? lab.pos.x : undefined,
            y: lab ? lab.pos.y : undefined
        };
        maintainBoostResource(spawn, boost, lab, resourceStatus);
        status.resources.push(resourceStatus);
    }

    status.reason = 'checked';
    recordStatus(spawn, status);
}

module.exports = {
    maintain: maintain,
    getOwnedLabsByConstructionOrder: getOwnedLabsByConstructionOrder
};
