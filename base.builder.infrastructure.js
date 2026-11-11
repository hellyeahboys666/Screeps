'use strict';
const access = require('base.builder.access');
// Pure candidate planning: the caller, not this module, owns all construction decisions.
function valid(p) { return p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.x < 50 && p.y >= 0 && p.y < 50; }
function idx(p) { return p.y * 50 + p.x; }
function range(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
function interior(p) { return p.x >= 2 && p.x <= 47 && p.y >= 2 && p.y <= 47; }
function plan(input, seed = {entries: []}, limits, options = {}) {
    const invalid = {valid: false, entries: [], blockers: ['invalidSnapshot']};
    if (!input || !input.eligible || !input.anchor || !valid(input.anchor.pos)
        || !input.controller || !valid(input.controller.pos)
        || !Array.isArray(input.terrain) || input.terrain.length !== 2500
        || !['sources', 'minerals', 'structures', 'sites', 'spawns'].every(k => Array.isArray(input[k])
            && input[k].every(o => o && valid(o.pos)))
        || !seed || seed.valid === false || !Array.isArray(seed.entries)
        || !seed.entries.every(e => e && valid(e.pos))) return invalid;
    const entries = [], blockers = [], guard = access.create(input);
    const existing = input.structures.concat(input.sites);
    const fixed = existing.concat(input.spawns, input.sources,
        input.minerals, [input.controller], seed.entries);
    const taken = new Set(fixed.map(o => idx(o.pos)));
    const blocking = access.obstacles(input, seed.entries);
    const hub = access.hubOf(input, seed.entries);
    const flood = blocked => access.flood(input, blocked, hub);
    const onLane = access.laneOf(hub, options.layout);
    const lanePenalty = p => onLane(p.x, p.y) ? 1 : 0;
    const roomFor = (type, cap) => existing.concat(seed.entries, entries).filter(o => o.type === type).length < cap;
    const reachable = flood(blocking);
    const available = p => interior(p) && !input.terrain[idx(p)] && !taken.has(idx(p)) && reachable[idx(p)];
    const sharedSeat = (target, maxRange, link, reach = reachable, obstacles = blocking) => {
        for (let y = target.y - maxRange; y <= target.y + maxRange; y++) for (let x = target.x - maxRange; x <= target.x + maxRange; x++) {
            const p = {x, y};
            if (interior(p) && range(p, target) >= 1 && range(p, target) <= maxRange
                && range(p, link) <= 1 && reach[idx(p)] && !input.terrain[idx(p)]
                && !obstacles.has(idx(p))) return true;
        }
        return false;
    };
    const add = (type, purpose, p, priority) => {
        entries.push({type, purpose, pos: p, priority});
        taken.add(idx(p));
        if (type !== 'container') blocking.add(idx(p));
    };
    const chooseLink = (target, maxRange, excludeSources) => {
        const choices = [];
        for (let y = target.y - maxRange - 1; y <= target.y + maxRange + 1; y++)
            for (let x = target.x - maxRange - 1; x <= target.x + maxRange + 1; x++) {
                const p = {x, y};
                if (!available(p) || (excludeSources && sources.some(s => range(p, s.pos) <= 2))) continue;
                const nextBlocking = new Set(blocking); nextBlocking.add(idx(p));
                const after = flood(nextBlocking);
                if (!sharedSeat(target, maxRange, p, after, nextBlocking)) continue;
                if (guard.check(seed.entries.concat(entries, {type: 'link', pos: p}), after)) continue;
                if (entries.some(e => e.purpose.startsWith('sourceLink:') && !sources.some(s =>
                    e.purpose === 'sourceLink:' + s.id && sharedSeat(s.pos, 1, e.pos, after, nextBlocking)))) continue;
                if (entries.some(e => e.purpose === 'controllerLink'
                    && !sharedSeat(input.controller.pos, 3, e.pos, after, nextBlocking))) continue;
                choices.push(p);
            }
        choices.sort((a, b) => lanePenalty(a) - lanePenalty(b)
            || range(a, input.anchor.pos) - range(b, input.anchor.pos) || a.y - b.y || a.x - b.x);
        return choices[0];
    };
    const sources = input.sources.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (const source of sources) {
        if (existing.some(o => o.type === 'link' && o.my === true && range(o.pos, source.pos) <= 2
            && sharedSeat(source.pos, 1, o.pos))) continue;
        if (!roomFor('link', 6)) { blockers.push('sourceLinkCap:' + source.id); continue; }
        const choices = [];
        for (let y = source.pos.y - 2; y <= source.pos.y + 2; y++) for (let x = source.pos.x - 2; x <= source.pos.x + 2; x++) {
            const p = {x, y};
            if (available(p)) {
                const nextBlocking = new Set(blocking); nextBlocking.add(idx(p));
                const after = flood(nextBlocking);
                if (sharedSeat(source.pos, 1, p, after, nextBlocking)
                    && !guard.check(seed.entries.concat(entries, {type: 'link', pos: p}), after)) choices.push(p);
            }
        }
        choices.sort((a, b) => range(a, input.anchor.pos) - range(b, input.anchor.pos) || a.y - b.y || a.x - b.x);
        if (choices.length) add('link', 'sourceLink:' + source.id, choices[0], 50);
        else blockers.push('noSharedSourceLinkSeat:' + source.id);
    }
    const usedSourceLinks = new Set(existing.filter(o => o.type === 'link' && o.my === true && sources.some(s =>
        range(o.pos, s.pos) <= 2 && sharedSeat(s.pos, 1, o.pos))).map(o => idx(o.pos)));
    const availableLinks = existing.filter(o => o.type === 'link' && o.my === true && !usedSourceLinks.has(idx(o.pos)));
    const hasController = availableLinks.some(o => sharedSeat(input.controller.pos, 3, o.pos));
    if (!hasController && roomFor('link', 6)) {
        const p = chooseLink(input.controller.pos, 3, true);
        if (p) add('link', 'controllerLink', p, 55);
        else blockers.push('noControllerLinkSeat');
    }
    const storage = existing.concat(seed.entries).find(o => o.type === 'storage');
    if (!storage) blockers.push('noStorageForBaseLink');
    else {
        const hasBase = availableLinks.some(o => sharedSeat(storage.pos, 1, o.pos)
            && range(o.pos, input.controller.pos) > 4);
        if (!hasBase && roomFor('link', 6)) {
            const p = chooseLink(storage.pos, 1, true);
            if (p) add('link', 'baseLink', p, 60);
            else blockers.push('noBaseLinkSeat');
        }
    }
    const terminalPresent = existing.filter(o => o.type === 'terminal');
    if (terminalPresent.some(o => o.my === false)) blockers.push('incompatibleExistingTerminal');
    else if (!terminalPresent.length) {
        if (!storage) blockers.push('noStorageForTerminal');
        else {
            const choices = [];
            for (let y = storage.pos.y - 1; y <= storage.pos.y + 1; y++)
                for (let x = storage.pos.x - 1; x <= storage.pos.x + 1; x++) {
                    const p = {x, y};
                    if (!available(p) || range(p, storage.pos) !== 1) continue;
                    const nextBlocking = new Set(blocking); nextBlocking.add(idx(p));
                    const after = flood(nextBlocking);
                    if (guard.check(seed.entries.concat(entries, {type: 'terminal', pos: p}), after)) continue;
                    if (entries.some(e => e.purpose === 'baseLink'
                        && !sharedSeat(storage.pos, 1, e.pos, after, nextBlocking))) continue;
                    if (entries.some(e => e.purpose === 'controllerLink'
                        && !sharedSeat(input.controller.pos, 3, e.pos, after, nextBlocking))) continue;
                    if (entries.some(e => e.purpose.startsWith('sourceLink:') && !sources.some(s =>
                        e.purpose === 'sourceLink:' + s.id && sharedSeat(s.pos, 1, e.pos, after, nextBlocking)))) continue;
                    choices.push(p);
                }
            choices.sort((a, b) => lanePenalty(a) - lanePenalty(b)
                || range(a, input.anchor.pos) - range(b, input.anchor.pos) || a.y - b.y || a.x - b.x);
            if (choices.length) add('terminal', 'coreTerminal', choices[0], 75);
            else blockers.push('noTerminalNearStorage');
        }
    }
    for (const mineral of input.minerals.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
        const nearby = existing.concat(seed.entries).some(o => o.type === 'container'
            && range(o.pos, mineral.pos) === 1 && reachable[idx(o.pos)]);
        if (!nearby && roomFor('container', 5)) {
            const seats = [];
            for (let y = mineral.pos.y - 1; y <= mineral.pos.y + 1; y++)
                for (let x = mineral.pos.x - 1; x <= mineral.pos.x + 1; x++) {
                    const p = {x, y};
                    if (available(p) && range(p, mineral.pos) === 1
                        && !guard.check(seed.entries.concat(entries, {type: 'container', pos: p}))) seats.push(p);
                }
            seats.sort((a, b) => range(a, input.anchor.pos) - range(b, input.anchor.pos) || a.y - b.y || a.x - b.x);
            if (seats.length) add('container', 'mineralContainer:' + mineral.id, seats[0], 65);
            else blockers.push('noMineralContainerSeat:' + mineral.id);
        }
        const occupants = existing.concat(seed.entries).filter(o => idx(o.pos) === idx(mineral.pos));
        if (occupants.some(o => o.type !== 'extractor')) blockers.push('mineralOccupied:' + mineral.id);
        else if (!occupants.length && roomFor('extractor', 1)
            && !blockers.includes('noMineralContainerSeat:' + mineral.id)) {
            entries.push({type: 'extractor', purpose: 'mineralExtractor:' + mineral.id,
                pos: {x: mineral.pos.x, y: mineral.pos.y}, priority: 70});
        }
    }
    const labs = existing.concat(seed.entries).filter(o => o.type === 'lab');
    // Reserve only the labs the policy will build (2 inputs + outputs).
    const labLimit = limits && Number.isInteger(limits.lab) ? Math.min(10, limits.lab) : 10;
    const outputsWanted = Math.max(0, labLimit - 2);
    if (labs.length > 10 || labs.some(o => o.my === false)) blockers.push('incompatibleExistingLabs');
    else if (labLimit < 1 || labs.length >= labLimit) { /* nothing more to reserve */ }
    else {
        const locked = labs.map(o => o.pos).sort((a, b) => a.y - b.y || a.x - b.x);
        const free = [];
        for (let y = 2; y <= 47; y++) for (let x = 2; x <= 47; x++) {
            const p = {x, y};
            if (available(p) && sources.every(s => range(p, s.pos) > 2)
                && range(p, input.controller.pos) > 3) free.push(p);
        }
        const score = p => range(p, input.anchor.pos) * 10 + (storage ? range(p, storage.pos) : 0) + lanePenalty(p) * 40;
        free.sort((a, b) => score(a) - score(b) || a.y - b.y || a.x - b.x);
        // Existing labs are immutable: all must fit in the same ten positions.
        const inputs = locked.concat(locked.length ? free.filter(p => locked.some(l => range(p, l) <= 2)) : free);
        const freeTiles = new Set(free.map(idx));
        const byPosition = new Map(inputs.map((p, i) => [idx(p), i]));
        let selected;
        // Prefer input pairs with room for a full ten-lab cluster, so raising the
        // lab cap later can extend the same cluster; reserve only what the cap
        // builds. Fall back to a cluster that fits just the capped count.
        for (const room of outputsWanted < 8 ? [8, outputsWanted] : [8]) {
        outer: for (let i = 0; i < inputs.length; i++) {
            const a = inputs[i];
            for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
                const b = {x: a.x + dx, y: a.y + dy};
                if (!valid(b)) continue;
                const j = byPosition.get(idx(b));
                if (j === undefined || j <= i) continue;
                const existingOutputs = locked.filter(p => idx(p) !== idx(a) && idx(p) !== idx(b));
                if (existingOutputs.length > outputsWanted || existingOutputs.some(p => range(p, a) > 2 || range(p, b) > 2)) continue;
                const options = [];
                for (let y = Math.max(a.y - 2, b.y - 2); y <= Math.min(a.y + 2, b.y + 2); y++)
                    for (let x = Math.max(a.x - 2, b.x - 2); x <= Math.min(a.x + 2, b.x + 2); x++) {
                        const p = {x, y};
                        if (freeTiles.has(idx(p)) && idx(p) !== idx(a) && idx(p) !== idx(b)) options.push(p);
                    }
                options.sort((p, q) => score(p) - score(q) || p.y - q.y || p.x - q.x);
                if (existingOutputs.length + options.length < room) continue;
                const outputs = existingOutputs.concat(options.slice(0, outputsWanted - existingOutputs.length));
                const cluster = [a, b].concat(outputs);
                const withCluster = new Set(blocking);
                for (const p of cluster) withCluster.add(idx(p));
                const after = flood(withCluster);
                // Cluster seats must remain usable without counting the spawn
                // tile, and must not consume other workers' shared link seats.
                if (guard.check(seed.entries.concat(entries, cluster.map(pos => ({type: 'lab', pos}))), after)) continue;
                selected = {a, b, outputs};
                break outer;
            }
        }
        if (selected) break;
        }
        if (!selected) blockers.push('noFeasibleLabCluster');
        else {
            // A cap of 1-2 labs (boosting only) builds just the input positions.
            const ins = [selected.a, selected.b].slice(0, Math.max(1, Math.min(2, labLimit)));
            for (const p of ins) if (!locked.some(l => idx(l) === idx(p))) add('lab', 'labInput', p, 85);
            for (const p of selected.outputs) if (!locked.some(l => idx(l) === idx(p))) add('lab', 'labOutput', p, 90);
        }
    }
    return {valid: blockers.length === 0, anchorId: input.anchor.id, entries, blockers};
}
module.exports = {plan};
