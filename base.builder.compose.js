// Pure composition; Screeps runtime passes in modules resolved by module name.
function positionKey(pos) { return pos.y * 50 + pos.x; }
function range(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
function passable(type) { return type === 'road' || type === 'container' || type === 'rampart'; }
function validateAccess(input, entries) {
    var blocked = new Set(input.structures.concat(input.sites, entries)
        .filter(function(o) { return !passable(o.type); }).map(function(o) { return positionKey(o.pos); }));
    for (var target of input.sources.concat(input.minerals || [], [input.controller])) blocked.add(positionKey(target.pos));
    var seen = new Uint8Array(2500), queue = [input.anchor.pos];
    seen[positionKey(input.anchor.pos)] = 1;
    for (var h = 0; h < queue.length; h++) {
        var p = queue[h];
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            var x = p.x + dx, y = p.y + dy;
            if (x < 1 || x > 48 || y < 1 || y > 48) continue;
            var i = y * 50 + x;
            if (seen[i] || input.terrain[i] || blocked.has(i)) continue;
            seen[i] = 1; queue.push({x: x, y: y});
        }
    }
    function seat(pos, radius) { return queue.some(function(p) { return range(p, pos) <= radius; }); }
    if (!input.sources.every(function(s) { return seat(s.pos, 1); })) return 'blockedSourceSeat';
    if (!seat(input.controller.pos, 3)) return 'blockedControllerSeat';
    var workers = entries.filter(function(e) {
        return ['storage','terminal','lab','link','spawn','tower',
            'factory','powerSpawn','observer','nuker'].indexOf(e.type) !== -1;
    });
    if (!workers.every(function(e) { return seat(e.pos, 1); })) return 'blockedWorkerStructure';
    return null;
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
        if (exclusive.has(key) || occupied.has(key) || input.terrain[key]) return 'occupiedSite';
        exclusive.add(key);
    }
    return null;
}
function compose(input, deps, options) {
    options = options || {};
    var core = deps.core.plan(input);
    if (!core.valid) return {valid: false, reason: 'invalidCore', entries: [], blockers: core.blockers, warnings: []};
    var warnings = [], critical = [];
    var advanced = deps.infrastructure.plan(input, core);
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
    var expansion = deps.expansion.planExpansion(input, base);
    var extraEntries = expansion.entries || [];
    warnings.push.apply(warnings, expansion.blockers || []);
    var extensions = deps.extensions.planExtensions(input, base.concat(extraEntries), options.extensionLimit);
    warnings.push.apply(warnings, extensions.blockers || []);
    var staged = base.concat(extraEntries, extensions.entries);
    var blocked = validateAccess(input, staged);
    while (blocked && extensions.entries.length) {
        extensions.entries.pop();
        staged = base.concat(extraEntries, extensions.entries);
        blocked = validateAccess(input, staged);
    }
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
    var defense = deps.defense.planDefense(input, staged,
        {perimeter: options.perimeter === true, maxCutTiles: options.maxCutTiles});
    warnings.push.apply(warnings, defense.blockers || []);
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
        perimeterSupported: !!defense.perimeterSupported
    };
}
module.exports = {compose: compose};
