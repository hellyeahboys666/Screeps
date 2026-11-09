// Pure composition; Screeps runtime passes in modules resolved by module name.
var access = require('base.builder.access');
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
    // Reserve connectors to future storage/spawns before extensions can occupy
    // their approaches. Previously the last two spawns had no road targets.
    var extraRoads = deps.paths.connectRoads(input, base.concat(extraEntries));
    if (extraRoads.blockers.length) warnings.push.apply(warnings, extraRoads.blockers);
    base = base.concat(extraRoads.entries);
    var extensions = deps.extensions.planExtensions(input, base.concat(extraEntries), options.extensionLimit);
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
