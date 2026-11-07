var DEFAULT_RCL6_TOTAL_ENERGY_TARGET = 300000;
var DEFAULT_STORAGE_BUFFER_TARGET = 50000;
var TERMINAL_REBALANCE_RESERVE_ENERGY = 20000;

function isFiniteNumber(value)
{
    return typeof value == 'number' && isFinite(value);
}

function getStoredEnergy(target)
{
    if (!target || !target.store)
    {
        return 0;
    }
    return target.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
}

function getTotalStoredEnergy(room)
{
    if (!room)
    {
        return 0;
    }
    return getStoredEnergy(room.storage) + getStoredEnergy(room.terminal);
}

function isRcl6ReserveRoom(room)
{
    return !!(room
        && room.storage
        && room.terminal
        && room.controller
        && room.controller.my
        && room.controller.level >= 6);
}

function getReserveTarget(room, overrideTarget)
{
    if (isFiniteNumber(overrideTarget))
    {
        return Math.max(0, Math.floor(overrideTarget));
    }
    if (room && room.memory && isFiniteNumber(room.memory.energyReserveTarget))
    {
        return Math.max(0, Math.floor(room.memory.energyReserveTarget));
    }
    if (isRcl6ReserveRoom(room))
    {
        return DEFAULT_RCL6_TOTAL_ENERGY_TARGET;
    }
    if (room && room.storage)
    {
        return DEFAULT_STORAGE_BUFFER_TARGET;
    }
    return 0;
}

function getReserveStatus(room, overrideTarget)
{
    var target = getReserveTarget(room, overrideTarget);
    var total = getTotalStoredEnergy(room);
    return {
        target: target,
        total: total,
        deficit: Math.max(0, target - total),
        storageEnergy: getStoredEnergy(room ? room.storage : undefined),
        terminalEnergy: getStoredEnergy(room ? room.terminal : undefined)
    };
}

function needsRoomEnergyReserve(room, overrideTarget)
{
    return !!(room
        && room.storage
        && room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        && getTotalStoredEnergy(room) < getReserveTarget(room, overrideTarget));
}

function getTerminalRebalanceReserve(room)
{
    if (room && room.memory && isFiniteNumber(room.memory.terminalRebalanceReserveEnergy))
    {
        return Math.max(0, Math.floor(room.memory.terminalRebalanceReserveEnergy));
    }
    return TERMINAL_REBALANCE_RESERVE_ENERGY;
}

module.exports = {
    DEFAULT_RCL6_TOTAL_ENERGY_TARGET: DEFAULT_RCL6_TOTAL_ENERGY_TARGET,
    DEFAULT_STORAGE_BUFFER_TARGET: DEFAULT_STORAGE_BUFFER_TARGET,
    TERMINAL_REBALANCE_RESERVE_ENERGY: TERMINAL_REBALANCE_RESERVE_ENERGY,
    getStoredEnergy: getStoredEnergy,
    getTotalStoredEnergy: getTotalStoredEnergy,
    getReserveTarget: getReserveTarget,
    getReserveStatus: getReserveStatus,
    needsRoomEnergyReserve: needsRoomEnergyReserve,
    getTerminalRebalanceReserve: getTerminalRebalanceReserve,
    isRcl6ReserveRoom: isRcl6ReserveRoom
};
