'use strict';
// Pure proposals only. A future executor must recheck ownership, rampart privacy, caps,
// site conflicts, hostiles and available maintenance before placing any of these sites.
const SIZE = 50, CELLS = 2500, INF = 1000000;
const VITAL = {spawn: 1, storage: 2, tower: 3, terminal: 4, link: 5, powerSpawn: 6, lab: 7, factory: 8, nuker: 9};
function index(pos) { return pos.y * SIZE + pos.x; }
function position(pos) { return pos && Number.isInteger(pos.x) && Number.isInteger(pos.y) && pos.x >= 0 && pos.x < SIZE && pos.y >= 0 && pos.y < SIZE; }
function range(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
function interior(x, y) { return x >= 2 && x <= 47 && y >= 2 && y <= 47; }
function pos(i) { return {x: i % SIZE, y: Math.floor(i / SIZE)}; }
function adjacent(i, visit) {
    const x = i % SIZE, y = Math.floor(i / SIZE);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE) visit(ny * SIZE + nx);
    }
}

// Independently re-prove the cut against ALL open border tiles, with diagonal moves.
// Existing ramparts are deliberately treated as passable: survey does not record
// isPublic and a public/foreign rampart cannot be credited as a sealed gate.
function exitFlood(passable, cut) {
    const seen = new Uint8Array(CELLS), queue = new Int32Array(CELLS);
    let head = 0, tail = 0;
    for (let i = 0; i < CELLS; i++) {
        const x = i % SIZE, y = Math.floor(i / SIZE);
        if (x !== 0 && x !== 49 && y !== 0 && y !== 49 || !passable[i] || cut.has(i)) continue;
        seen[i] = 1; queue[tail++] = i;
    }
    while (head < tail) {
        adjacent(queue[head++], n => {
            if (passable[n] && !cut.has(n) && !seen[n]) { seen[n] = 1; queue[tail++] = n; }
        });
    }
    return seen;
}

// Friendly creeps can walk through the proposed ramparts. Before budgeting a
// hostile separator, ensure the *existing* room has usable source/upgrade seats.
function accessBlocker(input, passable) {
    const reached = new Uint8Array(CELLS), queue = new Int32Array(CELLS);
    let head = 0, tail = 0;
    adjacent(index(input.anchor.pos), i => {
        if (passable[i] && !reached[i]) { reached[i] = 1; queue[tail++] = i; }
    });
    while (head < tail) adjacent(queue[head++], i => {
        if (passable[i] && !reached[i]) { reached[i] = 1; queue[tail++] = i; }
    });
    for (const source of input.sources) {
        let seat = false;
        adjacent(index(source.pos), i => { if (reached[i]) seat = true; });
        if (!seat) return 'perimeterUnsupported:noReachableSourceSeat:' + source.id;
    }
    for (let i = 0; i < CELLS; i++) {
        if (reached[i] && range(pos(i), input.controller.pos) <= 3) return null;
    }
    return 'perimeterUnsupported:noReachableUpgradePosition';
}

// Exact vertex minimum cut: split every traversable tile into in/out nodes; a
// legal rampart tile costs 1 and all other vertices/adjacency edges cost INF.
// Unit augmenting paths are bounded by maxCutTiles; no recursion or game API.
function minCut(passable, protectedCore, eligible, maxCutTiles) {
    const source = 2 * CELLS, sink = source + 1;
    const graph = Array.from({length: sink + 1}, () => []);
    function edge(from, to, capacity) {
        const forward = {to, cap: capacity, rev: graph[to].length};
        const backward = {to: from, cap: 0, rev: graph[from].length};
        graph[from].push(forward); graph[to].push(backward);
    }
    for (let i = 0; i < CELLS; i++) {
        if (!passable[i]) continue;
        const x = i % SIZE, y = Math.floor(i / SIZE);
        edge(2 * i, 2 * i + 1, eligible[i] ? 1 : INF);
        if (x === 0 || x === 49 || y === 0 || y === 49) edge(source, 2 * i, INF);
        if (protectedCore[i]) edge(2 * i + 1, sink, INF);
        adjacent(i, n => { if (passable[n]) edge(2 * i + 1, 2 * n, INF); });
    }
    let flow = 0;
    const previous = new Int32Array(sink + 1), via = new Int32Array(sink + 1);
    const queue = new Int32Array(sink + 1);
    while (true) {
        previous.fill(-1);
        previous[source] = source;
        let head = 0, tail = 0;
        queue[tail++] = source;
        while (head < tail && previous[sink] === -1) {
            const v = queue[head++];
            for (let e = 0; e < graph[v].length; e++) {
                const next = graph[v][e];
                if (!next.cap || previous[next.to] !== -1) continue;
                previous[next.to] = v; via[next.to] = e;
                queue[tail++] = next.to;
                if (next.to === sink) break;
            }
        }
        if (previous[sink] === -1) break;
        let amount = INF;
        for (let v = sink; v !== source; v = previous[v]) amount = Math.min(amount, graph[previous[v]][via[v]].cap);
        if (amount >= INF) return {reason: 'perimeterUnsupported:uncuttableIngress'};
        if (flow + amount > maxCutTiles) return {reason: 'perimeterUnsupported:cutBudgetExceeded'};
        for (let v = sink; v !== source; v = previous[v]) {
            const e = graph[previous[v]][via[v]];
            e.cap -= amount;
            graph[v][e.rev].cap += amount;
        }
        flow += amount;
    }
    // Residual source partition determines the cut, not a heuristic ring.
    const reached = new Uint8Array(sink + 1);
    reached[source] = 1;
    let head = 0, tail = 0;
    queue[tail++] = source;
    while (head < tail) {
        const v = queue[head++];
        for (const e of graph[v]) if (e.cap && !reached[e.to]) {
            reached[e.to] = 1; queue[tail++] = e.to;
        }
    }
    const cut = new Set();
    for (let i = 0; i < CELLS; i++) {
        if (eligible[i] && reached[2 * i] && !reached[2 * i + 1]) cut.add(i);
    }
    if (cut.size !== flow) return {reason: 'perimeterUnsupported:cutProofFailed'};
    const ingress = exitFlood(passable, cut);
    for (let i = 0; i < CELLS; i++) if (protectedCore[i] && ingress[i]) {
        return {reason: 'perimeterUnsupported:cutProofFailed'};
    }
    return {cut};
}

function planDefense(input, layout = [], options = {}) {
    if (!input || !input.eligible || !input.anchor || !position(input.anchor.pos)
        || !Array.isArray(input.terrain) || input.terrain.length !== CELLS
        || !input.terrain.every(v => v === 0 || v === 1)
        || !Array.isArray(input.structures) || !Array.isArray(input.sites)
        || !Array.isArray(input.spawns) || !Array.isArray(input.sources)
        || !Array.isArray(input.minerals) || !Array.isArray(layout) || !layout.every(e => e && position(e.pos))
        || !input.controller || !position(input.controller.pos)
        || !input.structures.concat(input.sites, input.spawns, input.sources, input.minerals).every(o => o && position(o.pos))
        || !input.spawns.some(s => s.my && s.type === 'spawn' && s.id === input.anchor.id
            && index(s.pos) === index(input.anchor.pos))) {
        return {valid: false, entries: [], blockers: ['invalidSnapshot'], perimeterSupported: false};
    }
    const structures = input.structures.concat(input.spawns);
    const sites = new Set(input.sites.map(o => index(o.pos)));
    const conflicting = new Set();
    for (const object of structures) {
        if (!object.my && object.type !== 'road' && object.type !== 'container' && object.type !== 'rampart') conflicting.add(index(object.pos));
    }
    const ramparts = new Set(input.structures.concat(input.sites).filter(o => o.type === 'rampart').map(o => index(o.pos)));
    const entries = [], placed = new Set(), blockers = [];
    const vitals = structures.concat(input.sites, layout.map(o => Object.assign({my: true}, o)));
    for (const object of vitals) {
        if (!object.my || !Object.prototype.hasOwnProperty.call(VITAL, object.type)) continue;
        const cell = index(object.pos);
        if (ramparts.has(cell) || placed.has(cell)) continue;
        if (object.pos.x === 0 || object.pos.x === 49 || object.pos.y === 0 || object.pos.y === 49) {
            blockers.push('vitalOverlayDeferred:' + object.id + ':exitEdge');
            continue;
        }
        if (input.terrain[cell] || conflicting.has(cell)) continue;
        entries.push({type: 'rampart', purpose: 'vitalOverlay', pos: pos(cell),
            priority: VITAL[object.type], requiresType: object.type});
        placed.add(cell);
    }
    entries.sort((a, b) => a.priority - b.priority || a.pos.y - b.pos.y || a.pos.x - b.pos.x);
    blockers.sort();
    const result = {valid: true, anchorId: input.anchor.id, entries, blockers, perimeterSupported: false};
    if (options.perimeter === false) return result;
    const maxCutTiles = options.maxCutTiles === undefined ? 60 : options.maxCutTiles;
    if (!Number.isInteger(maxCutTiles) || maxCutTiles < 1 || maxCutTiles > 100) {
        result.blockers.push('perimeterUnsupported:invalidCutBudget'); return result;
    }
    // Only built, actually impassable structures are credited as terrain barriers.
    // Sites and layout entries remain passable until construction finishes.
    const passable = new Uint8Array(CELLS);
    for (let i = 0; i < CELLS; i++) passable[i] = input.terrain[i] ? 0 : 1;
    for (const o of structures.concat(input.sources, input.minerals, [input.controller])) {
        if (o.type === 'road' || o.type === 'container' || o.type === 'rampart') continue;
        passable[index(o.pos)] = 0;
    }
    // Proposed hard structures are not barriers in the hostile proof (not built),
    // but must already be accounted for when validating eventual friendly access.
    const friendlyPassable = passable.slice();
    for (const e of layout) {
        if (e.type !== 'road' && e.type !== 'container' && e.type !== 'rampart') friendlyPassable[index(e.pos)] = 0;
    }
    const access = accessBlocker(input, friendlyPassable);
    if (access) { result.blockers.push(access); return result; }
    const core = new Uint8Array(CELLS), eligible = new Uint8Array(CELLS);
    // Every owned vital (not merely those near the anchor) must lie behind a
    // claimed perimeter. Widely scattered vitals may exceed the cut budget.
    const protectedVitals = vitals.filter(o => o.my && Object.prototype.hasOwnProperty.call(VITAL, o.type));
    for (let i = 0; i < CELLS; i++) {
        if (!passable[i]) continue;
        const p = pos(i);
        if (range(p, input.anchor.pos) <= 1 || protectedVitals.some(o => range(p, o.pos) <= 1)) core[i] = 1;
    }
    const reserved = new Set(layout.map(e => index(e.pos)));
    for (const o of input.structures.concat(input.sites, input.sources, input.minerals, [input.controller])) {
        if (o.type !== 'road' && o.type !== 'container') reserved.add(index(o.pos));
    }
    for (let i = 0; i < CELLS; i++) {
        const p = pos(i);
        eligible[i] = passable[i] && interior(p.x, p.y) && !core[i]
            && !reserved.has(i) && !sites.has(i) && !ramparts.has(i) ? 1 : 0;
    }
    const min = minCut(passable, core, eligible, maxCutTiles);
    if (min.reason) { result.blockers.push(min.reason); return result; }
    for (const i of min.cut) result.entries.push({type: 'rampart', purpose: 'perimeter', pos: pos(i), priority: 90});
    result.perimeterSupported = true;
    return result;
}
module.exports = {planDefense};
