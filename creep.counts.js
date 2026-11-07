/*
 * Automatic low-headcount economy profile for RCL7+.
 *
 * RCL7+ extensions have much higher capacity than RCL6, so routine workers
 * become markedly larger. Keeping RCL6-era headcounts wastes
 * energy, spawn time, and traffic on creeps that have little useful work.
 *
 * Per-spawn tuning remains available in autoByRCL mode:
 *
 *   // This legacy RCL7 name intentionally applies at both RCL7 and RCL8.
 *   spawn.memory.rcl7CreepCountScale = 0.5; // optional; default is 0.5
 *   spawn.memory.rcl7CreepCountTargets = { minUpgraders: 2, minLorries: 1 };
 *
 * The scale applies to routine economy roles, including local lorries. Explicit
 * target values are absolute and override scaling. A positive target always
 * keeps at least one creep; use an explicit target of 0 to disable a role.
 */

var DEFAULT_RCL7_CREEP_COUNT_SCALE = 0.5;
var RCL7_TARGET_KEYS = [
    'minLorries',
    'minBuilders',
    'minUpgraders',
    'minRepairers',
    'minCLinkers',
    'minBLinkers',
    'minExtractors'
];
// All routine economy roles scale down at RCL7+, but one positive target is
// retained for each role so basic logistics/link/controller coverage survives.
var RCL7_SCALABLE_TARGET_KEYS = RCL7_TARGET_KEYS.slice();

function getFiniteNumber(value)
{
    if (typeof value == 'number' && isFinite(value))
    {
        return value;
    }
    if (typeof value == 'string' && value.trim() != '')
    {
        var parsed = parseFloat(value);
        if (isFinite(parsed))
        {
            return parsed;
        }
    }
    return undefined;
}

function getRcl7CreepCountScale(value)
{
    var scale = getFiniteNumber(value);
    if (scale == undefined || scale < 0.1 || scale > 2)
    {
        return DEFAULT_RCL7_CREEP_COUNT_SCALE;
    }
    return scale;
}

function getNonNegativeInteger(value)
{
    var parsed = getFiniteNumber(value);
    if (parsed == undefined || parsed < 0)
    {
        return undefined;
    }
    return Math.min(50, Math.floor(parsed));
}

function cloneTargets(targets)
{
    var result = {};
    for (var i = 0; i < RCL7_TARGET_KEYS.length; i++)
    {
        var key = RCL7_TARGET_KEYS[i];
        result[key] = targets && typeof targets[key] == 'number' ? targets[key] : 0;
    }
    return result;
}

function applyRcl7CreepCountTargets(rcl, targets, options)
{
    var result = cloneTargets(targets);
    options = options || {};
    var scale = getRcl7CreepCountScale(options.scale);
    var overrides = options.targets && typeof options.targets == 'object' && !Array.isArray(options.targets)
        ? options.targets
        : {};

    // RCL6 and below retain the established bootstrap/mid-game target policy.
    if (rcl < 7)
    {
        return {targets: result, active: false, scale: scale, overrides: {}};
    }

    for (var i = 0; i < RCL7_SCALABLE_TARGET_KEYS.length; i++)
    {
        var targetKey = RCL7_SCALABLE_TARGET_KEYS[i];
        var target = result[targetKey];
        if (target > 0)
        {
            result[targetKey] = Math.max(1, Math.round(target * scale));
        }
    }

    var appliedOverrides = {};
    for (var j = 0; j < RCL7_TARGET_KEYS.length; j++)
    {
        var key = RCL7_TARGET_KEYS[j];
        var override = getNonNegativeInteger(overrides[key]);
        if (override != undefined)
        {
            result[key] = override;
            appliedOverrides[key] = override;
        }
    }

    return {targets: result, active: true, scale: scale, overrides: appliedOverrides};
}

module.exports = {
    DEFAULT_RCL7_CREEP_COUNT_SCALE: DEFAULT_RCL7_CREEP_COUNT_SCALE,
    RCL7_TARGET_KEYS: RCL7_TARGET_KEYS,
    getRcl7CreepCountScale: getRcl7CreepCountScale,
    applyRcl7CreepCountTargets: applyRcl7CreepCountTargets
};
