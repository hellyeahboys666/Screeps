// Sells the room's own mineral from its terminal into existing BUY orders, keeping
// a reserve. An order is taken only if its price, minus the energy the deal costs
// (valued at the recent energy price), is still close to the recent market average,
// so stock isn't dumped into lowball bids or far-away rooms.
//
// Optional settings in Memory.mineralSell: keep (units kept in terminal+storage),
// minNetRatio (net price / average price), maxPerDeal, minPrice: {O: 20}.
// Memory.mineralSellEnabled = false or room.memory.mineralSellEnabled = false stops it.

var CHECK_INTERVAL = 50;
var DEFAULT_KEEP = 10000;
var DEFAULT_MIN_NET_RATIO = 0.85;
var DEFAULT_MAX_PER_DEAL = 20000;
var MIN_DEAL_AMOUNT = 100;
var PRICE_HISTORY_TICKS = 1000;
var priceCache = {};

function getSetting(key, fallback)
{
    var config = Memory.mineralSell;
    return config && typeof config[key] == 'number' && isFinite(config[key]) ? config[key] : fallback;
}

function getMinPrice(resource)
{
    var config = Memory.mineralSell;
    var price = config && config.minPrice && config.minPrice[resource];
    return typeof price == 'number' && isFinite(price) ? price : 0;
}

// Volume-weighted average over the market history (about two weeks).
function getAveragePrice(resource)
{
    var cached = priceCache[resource];
    if (cached && Game.time - cached.tick < PRICE_HISTORY_TICKS)
    {
        return cached.price;
    }
    var volume = 0;
    var value = 0;
    var history = Game.market.getHistory(resource) || [];
    for (let entry of history)
    {
        if (entry && entry.volume > 0 && isFinite(entry.avgPrice))
        {
            volume += entry.volume;
            value += entry.avgPrice * entry.volume;
        }
    }
    var price = volume > 0 ? value / volume : undefined;
    priceCache[resource] = {tick: Game.time, price: price};
    return price;
}

function chooseOrder(room, resource, sellable, minNet, minPrice, energyPrice)
{
    var terminalEnergy = room.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
    var best;
    for (let order of Game.market.getAllOrders({type: ORDER_BUY, resourceType: resource}))
    {
        if (!order || !order.roomName || Game.market.orders[order.id]
            || !(order.amount > 0) || order.price < minPrice)
        {
            continue;
        }
        var amount = Math.min(sellable, order.amount);
        var energy = Game.market.calcTransactionCost(amount, room.name, order.roomName);
        if (energy > terminalEnergy)
        {
            // The terminal pays the transfer energy up front; sell what it can afford.
            amount = Math.floor(amount * terminalEnergy / energy);
            if (amount < MIN_DEAL_AMOUNT)
            {
                continue;
            }
            energy = Game.market.calcTransactionCost(amount, room.name, order.roomName);
        }
        var net = order.price - energy / amount * energyPrice;
        if (net < minNet)
        {
            continue;
        }
        if (!best || net > best.net || (net == best.net && amount > best.amount))
        {
            best = {order: order, amount: amount, energy: energy, net: net};
        }
    }
    return best;
}

function maintain(room)
{
    var terminal = room && room.terminal;
    if (!terminal || !terminal.my
        || Memory.mineralSellEnabled === false || room.memory.mineralSellEnabled === false)
    {
        return;
    }
    if (Game.time < (room.memory.mineralSellNextCheck || 0))
    {
        return;
    }
    room.memory.mineralSellNextCheck = Game.time + CHECK_INTERVAL;
    var status = {tick: Game.time};
    room.memory.mineralSellStatus = status;

    var mineral = room.find(FIND_MINERALS)[0];
    if (!mineral)
    {
        status.reason = 'noMineral';
        return;
    }
    var resource = status.resource = mineral.mineralType;
    if (terminal.cooldown > 0)
    {
        status.reason = 'terminalCooldown';
        return;
    }
    var inTerminal = terminal.store.getUsedCapacity(resource);
    var stored = inTerminal + (room.storage ? room.storage.store.getUsedCapacity(resource) : 0);
    var sellable = Math.min(inTerminal, stored - getSetting('keep', DEFAULT_KEEP),
        getSetting('maxPerDeal', DEFAULT_MAX_PER_DEAL));
    status.stored = stored;
    status.sellable = Math.max(0, sellable);
    if (sellable < MIN_DEAL_AMOUNT)
    {
        status.reason = 'nothingToSell';
        return;
    }
    var average = getAveragePrice(resource);
    if (!average)
    {
        status.reason = 'noPriceHistory';
        return;
    }
    var minNet = average * getSetting('minNetRatio', DEFAULT_MIN_NET_RATIO);
    status.averagePrice = Math.round(average * 100) / 100;
    status.minNetPrice = Math.round(minNet * 100) / 100;

    var choice = chooseOrder(room, resource, sellable, minNet, getMinPrice(resource),
        getAveragePrice(RESOURCE_ENERGY) || 0);
    if (!choice)
    {
        status.reason = 'noBuyerAboveFloor';
        return;
    }
    var result = Game.market.deal(choice.order.id, choice.amount, room.name);
    status.reason = result == OK ? 'sold' : 'dealFailed';
    status.deal = {
        result: result,
        amount: choice.amount,
        price: choice.order.price,
        netPrice: Math.round(choice.net * 100) / 100,
        energy: choice.energy,
        to: choice.order.roomName
    };
    if (result == OK)
    {
        var sold = room.memory.mineralSold || (room.memory.mineralSold = {});
        var totals = sold[resource] || (sold[resource] = {amount: 0, credits: 0});
        totals.amount += choice.amount;
        totals.credits = Math.round(totals.credits + choice.amount * choice.order.price);
    }
}

module.exports = {
    maintain: maintain
};
