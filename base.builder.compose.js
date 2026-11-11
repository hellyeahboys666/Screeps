// Pure composition; Screeps runtime passes in modules resolved by module name.
var access = require('base.builder.access');
var towers = require('base.builder.towers');
function positionKey(pos) { return pos.y * 50 + pos.x; }
function validateAccess(input, entries) {
    return access.create(input).check(entries);
}
function overlapping(entries, input) {
    var exclusive = new Set(), occupied = new Set(input.structures.concat(input.sites)
        .map(function(o) { return positionKey(o.pos); }));
    for (var e of entries) {
        var p = e.pos;
        if (!p || !Number.isInteger(p.x) || !Number.isInteger(p.y)
            || p.x < 0 || p.x > 49 || p.y < 0 || p.y > 49) return 'invalidPosition';
        var key = positionKey(p);
        if (e.type === 'rampart' || e.type === 'extractor') continue;
        var roadOverlay = e.type === 'road' && input.structures.concat(input.sites).filter(function(o) {
            return positionKey(o.pos) === key;
        }).every(function(o) { return o.type === 'rampart' || o.type === 'container'; });
        if (exclusive.has(key) || (occupied.has(key) && !roadOverlay) || input.terrain[key]) return 'occupiedSite';
        exclusive.add(key);
    }
    return null;
}
function composeLayout(input, deps, options) {
    options = options || {};
    var core = deps.core.plan(input, options.limits, {layout: options.extensionLayout});
    if (!core.valid) return {valid: false, reason: 'invalidCore', entries: [], blockers: core.blockers, warnings: []};
    var warnings = [], critical = [];
    var advanced = deps.infrastructure.plan(input, core, options.limits, {layout: options.extensionLayout});
    var infraEntries = advanced.entries || [];
    warnings.push.apply(warnings, advanced.blockers || []);
    var roads = deps.paths.connectRoads(input, core.entries.concat(infraEntries));
    if (roads.blockers.length) {
        // Advanced candidates must never jeopardize vital bootstrap logistics.
        warnings.push.apply(warnings, roads.blockers);
        infraEntries = [];
        roads = deps.paths.connectRoads(input, core.entries);
    }
    if (roads.blockers.length) critical.push.apply(critical, roads.blockers);
    var base = core.entries.concat(infraEntries, roads.entries);
    // Drop advanced infrastructure that blocks access before extensions are
    // planned around it; otherwise every extension gets popped for nothing.
    var infraBlocked = infraEntries.length ? validateAccess(input, base) : null;
    if (infraBlocked) {
        warnings.push('advancedAccessDeferred:' + infraBlocked);
        infraEntries = [];
        roads = deps.paths.connectRoads(input, core.entries);
        base = core.entries.concat(roads.entries);
    }
    var expansion = deps.expansion.planExpansion(input, base, options.limits, {layout: options.extensionLayout});
    var extraEntries = expansion.entries || [];
    warnings.push.apply(warnings, expansion.blockers || []);
    // Reserve connectors to future storage/spawns before extensions can occupy
    // their approaches. Previously the last two spawns had no road targets.
    var extraRoads = deps.paths.connectRoads(input, base.concat(extraEntries));
    if (extraRoads.blockers.length) warnings.push.apply(warnings, extraRoads.blockers);
    base = base.concat(extraRoads.entries);
    var extensions = deps.extensions.planExtensions(input, base.concat(extraEntries),
        options.limits && Number.isInteger(options.limits.extension)
            ? Math.min(options.extensionLimit || 60, options.limits.extension) : options.extensionLimit,
        {layout: options.extensionLayout});
    warnings.push.apply(warnings, extensions.blockers || []);
    var staged = base.concat(extraEntries, extensions.entries);
    var blocked = validateAccess(input, staged);
    // Extensions preserve access candidate-by-candidate; never discard an
    // arbitrary suffix to compensate for an earlier inaccessible cluster.
    if (blocked && extraEntries.length) {
        warnings.push('expansionAccessDeferred:' + blocked);
        extraEntries = [];
        staged = base.concat(extensions.entries);
        blocked = validateAccess(input, staged);
    }
    if (blocked && infraEntries.length) {
        warnings.push('advancedAccessDeferred:' + blocked);
        infraEntries = [];
        roads = deps.paths.connectRoads(input, core.entries);
        staged = core.entries.concat(roads.entries);
        blocked = validateAccess(input, staged);
    }
    if (blocked) critical.push(blocked);
    var defenseOptions = {perimeter: options.perimeter === true, maxCutTiles: options.maxCutTiles,
        distanceWeight: options.distanceWeight, perimeterConfigs: options.perimeterConfigs,
        extensionBuffer: options.extensionBuffer};
    var defense = deps.defense.planDefense(input, staged, defenseOptions);
    // With a perimeter, re-place the planned (unbuilt) towers to maximise the damage
    // on the weakest rampart, then re-plan the defense around the moved towers.
    var towerPlan = null;
    if (defense.perimeterSupported && options.placeTowers !== false) {
        var cutKeys = (defense.entries || []).filter(function(e) { return e.purpose === 'perimeter'; })
            .map(function(e) { return e.pos.y * 50 + e.pos.x; });
        // Keep the extension layout's walking lanes clear: grid lanes, or the
        // off-colour checkerboard tiles.
        var hubPos = access.hubOf(input, staged);
        var isLane = options.extensionLayout === 'checker'
            ? (hubPos ? function(x, y) { return ((x + y) & 1) === ((hubPos.x + hubPos.y) & 1); } : null)
            : access.laneOf(hubPos, options.extensionLayout);
        towerPlan = towers.placeTowers(input, staged, cutKeys, {barrierKeys: defense.barrierKeys, isLane: isLane});
        if (towerPlan.moved && !validateAccess(input, towerPlan.entries)) {
            var retry = deps.defense.planDefense(input, towerPlan.entries, defenseOptions);
            if (retry.perimeterSupported) { staged = towerPlan.entries; defense = retry; }
            else towerPlan = null;
        }
    }
    warnings.push.apply(warnings, defense.blockers || []);
    // Defenders and repairers must reach every perimeter rampart from the storage
    // side of the base (a walkable tile next to it, inside the wall).
    var perimeterEntries = (defense.entries || []).filter(function(e) { return e.purpose === 'perimeter'; });
    if (perimeterEntries.length) {
        var reach = access.flood(input, access.obstacles(input, staged), access.hubOf(input, staged));
        var unreachable = perimeterEntries.filter(function(e) { return !access.seat(reach, e.pos, 1); }).length;
        if (unreachable) warnings.push('perimeterRampartUnreachable:' + unreachable);
    }
    var entries = staged.concat(defense.entries || []);
    var collision = overlapping(entries, input);
    if (collision) critical.push(collision);
    // Preserve priority ordering across room resets and independent module revisions.
    entries.sort(function(a, b) {
        return a.priority - b.priority || a.pos.y - b.pos.y || a.pos.x - b.pos.x
            || String(a.purpose).localeCompare(String(b.purpose));
    });
    return {
        valid: !critical.length, anchorId: input.anchor.id,
        entries: critical.length ? [] : entries,
        blockers: critical, warnings: warnings,
        perimeterSupported: !!defense.perimeterSupported,
        perimeter: defense.perimeter ? Object.assign({}, defense.perimeter, towerPlan && towerPlan.moved
            ? {towersMoved: towerPlan.moved, minDamageBefore: towerPlan.before, minDamage: towerPlan.minDamage} : {}) : null
    };
}
// Mean walking steps from the storage to the extensions' nearest free neighbour.
function extensionWalk(input, plan) {
    var built = plan.entries.filter(function(e) { return e.type !== 'rampart'; });
    var hub = access.hubOf(input, built);
    var exts = built.filter(function(e) { return e.type === 'extension'; });
    if (!hub || !exts.length) return Infinity;
    var dist = access.walkDistance(input, access.obstacles(input, built), hub), total = 0;
    for (var e of exts) {
        var best = 65535;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
            var i = (e.pos.y + dy) * 50 + e.pos.x + dx;
            if ((dx || dy) && i >= 0 && i < 2500 && dist[i] < best) best = dist[i];
        }
        total += best;
    }
    return total / exts.length;
}
// extensionLayout 'grid' | 'checker' | 'auto' (default): auto plans both and keeps
// the valid plan whose extensions are the shorter walk from the storage
// (the grid wins in open rooms; the checkerboard in cramped ones).
function compose(input, deps, options) {
    options = options || {};
    var layout = options.extensionLayout || 'auto';
    if (layout !== 'auto') return composeLayout(input, deps, options);
    var best = null;
    for (var candidate of ['grid', 'checker']) {
        var plan = composeLayout(input, deps, Object.assign({}, options, {extensionLayout: candidate}));
        if (!plan.valid) { if (!best) best = plan; continue; }
        plan.layout = candidate;
        plan.extensionWalk = Math.round(extensionWalk(input, plan) * 10) / 10;
        if (!best || !best.valid || plan.extensionWalk < best.extensionWalk - 0.2) best = plan;
    }
    return best;
}
module.exports = {compose: compose};
