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


// ---------------------------------------------------------------------------
// Perimeter planning: weighted minimum vertex cut (Dinic max-flow).
//
// Hostile model: attackers can walk on every non-wall tile and can destroy any
// structure, so ONLY terrain walls, our existing ramparts and constructed walls
// are barriers. The protected core is every tile within `buffer` of a base
// structure (extensions included): with buffer 3 a ranged attacker standing
// outside the wall cannot reach any of them. Optionally the controller's
// neighbours are protected too (attackController needs range 1).
// Rampart tiles must be 2..47 (structures cannot be built next to exits).
// Each candidate tile costs TILE_COST; a tile already holding a structure costs
// more (a rampart over it is legal but empty tiles and roads are preferred).
// Configurations are tried from strongest to weakest; the first whose cut fits
// the tile budget wins.
// ---------------------------------------------------------------------------
const TILE_COST = 10, BUILT_TILE_COST = 14, BIG = 1 << 28, DISTANCE_WEIGHT = 0.5;
const UNPROTECTED = new Set(['road', 'container', 'rampart', 'constructedWall', 'extractor']);
const STEPS = [-51, -50, -49, -1, 1, 49, 50, 51];

function maxFlowCut(open, core, cost, budget) {
    // Node 2i = tile in, 2i+1 = tile out, S = 5000, T = 5001.
    const S = 2 * CELLS, T = S + 1, N = T + 1;
    const MAXE = CELLS * 24;
    const to = new Int32Array(MAXE), cap = new Int32Array(MAXE), next = new Int32Array(MAXE);
    const first = new Int32Array(N).fill(-1);
    let m = 0;
    function add(a, b, c) {
        to[m] = b; cap[m] = c; next[m] = first[a]; first[a] = m++;
        to[m] = a; cap[m] = 0; next[m] = first[b]; first[b] = m++;
    }
    for (let i = 0; i < CELLS; i++) {
        if (!open[i]) continue;
        const x = i % SIZE, y = (i - x) / SIZE;
        add(2 * i, 2 * i + 1, core[i] ? BIG : cost[i]);
        if (x === 0 || x === 49 || y === 0 || y === 49) add(S, 2 * i, BIG);
        if (core[i]) add(2 * i + 1, T, BIG);
        for (const d of STEPS) {
            const n = i + d, nx = n % SIZE;
            if (n < 0 || n >= CELLS || Math.abs(nx - x) > 1 || !open[n]) continue;
            add(2 * i + 1, 2 * n, BIG);
        }
    }
    const level = new Int32Array(N), iter = new Int32Array(N), queue = new Int32Array(N);
    function bfs() {
        level.fill(-1); level[S] = 0;
        let h = 0, t = 0; queue[t++] = S;
        while (h < t) {
            const v = queue[h++];
            for (let e = first[v]; e !== -1; e = next[e]) if (cap[e] > 0 && level[to[e]] < 0) {
                level[to[e]] = level[v] + 1; queue[t++] = to[e];
            }
        }
        return level[T] >= 0;
    }
    // Iterative DFS (no recursion: Screeps call stack is shallow).
    const stackV = new Int32Array(N), stackE = new Int32Array(N);
    function augment() {
        let pushed = 0;
        while (true) {
            let depth = 0; stackV[0] = S;
            let found = false;
            while (depth >= 0) {
                const v = stackV[depth];
                if (v === T) { found = true; break; }
                let advanced = false;
                for (; iter[v] !== -1; iter[v] = next[iter[v]]) {
                    const e = iter[v];
                    if (cap[e] > 0 && level[to[e]] === level[v] + 1) {
                        stackE[depth] = e; stackV[++depth] = to[e]; advanced = true; break;
                    }
                }
                if (!advanced) { level[v] = -1; depth--; if (depth >= 0) iter[stackV[depth]] = next[iter[stackV[depth]]]; }
            }
            if (!found) return pushed;
            let f = BIG;
            for (let k = 0; k < depth; k++) f = Math.min(f, cap[stackE[k]]);
            for (let k = 0; k < depth; k++) { cap[stackE[k]] -= f; cap[stackE[k] ^ 1] += f; }
            pushed += f;
            if (pushed >= BIG) return pushed;
        }
    }
    let flow = 0;
    while (bfs()) {
        for (let v = 0; v < N; v++) iter[v] = first[v];
        flow += augment();
        if (flow >= BIG) return {reason: 'uncuttable'};
        if (flow > budget * (BUILT_TILE_COST + 30)) return {reason: 'overBudget'};
    }
    // Source side of the residual graph; cut = tiles whose in-node is reached but out-node is not.
    const seen = new Uint8Array(N);
    let h = 0, t = 0; queue[t++] = S; seen[S] = 1;
    while (h < t) {
        const v = queue[h++];
        for (let e = first[v]; e !== -1; e = next[e]) if (cap[e] > 0 && !seen[to[e]]) { seen[to[e]] = 1; queue[t++] = to[e]; }
    }
    const cut = [];
    for (let i = 0; i < CELLS; i++) if (open[i] && seen[2 * i] && !seen[2 * i + 1]) cut.push(i);
    return {cut, flow};
}

// Independent proof: no open tile reachable from an exit (moving 8-way and not
// through cut tiles) may be a core tile.
function provesSealed(open, core, cut) {
    const blocked = new Uint8Array(CELLS);
    for (const i of cut) blocked[i] = 1;
    const seen = new Uint8Array(CELLS), queue = new Int32Array(CELLS);
    let h = 0, t = 0;
    for (let i = 0; i < CELLS; i++) {
        const x = i % SIZE, y = (i - x) / SIZE;
        if ((x === 0 || x === 49 || y === 0 || y === 49) && open[i] && !blocked[i]) { seen[i] = 1; queue[t++] = i; }
    }
    while (h < t) {
        const i = queue[h++], x = i % SIZE;
        for (const d of STEPS) {
            const n = i + d;
            if (n < 0 || n >= CELLS || Math.abs(n % SIZE - x) > 1 || !open[n] || blocked[n] || seen[n]) continue;
            seen[n] = 1; queue[t++] = n;
        }
    }
    for (let i = 0; i < CELLS; i++) if (core[i] && seen[i]) return false;
    return true;
}

function planPerimeter(input, layout, options) {
    const budget = options.maxCutTiles === undefined ? 60 : options.maxCutTiles;
    if (!Number.isInteger(budget) || budget < 1 || budget > 150) return {reason: 'perimeterUnsupported:invalidCutBudget'};
    const open = new Uint8Array(CELLS), built = new Uint8Array(CELLS);
    for (let i = 0; i < CELLS; i++) open[i] = input.terrain[i] ? 0 : 1;
    for (const o of input.sources.concat(input.minerals, [input.controller])) open[index(o.pos)] = 0;
    const existing = input.structures.concat(input.spawns);
    for (const o of existing) {
        // Our ramparts and any constructed walls are the only structural barriers.
        if (o.type === 'constructedWall' || (o.type === 'rampart' && o.my)) open[index(o.pos)] = 0;
    }
    const protect = existing.concat(input.sites, layout.map(o => Object.assign({my: true}, o)))
        .filter(o => o && o.my && !UNPROTECTED.has(o.type)
            // Source links live with their source; walling a source in is optional.
            && !(o.type === 'link' && input.sources.some(s => range(s.pos, o.pos) <= 2)));
    for (const o of existing.concat(input.sites, layout)) {
        if (o && o.type !== 'road' && o.type !== 'rampart') built[index(o.pos)] = 1;
    }
    // Distance penalty: ramparts far from the base get weaker tower support and a
    // longer walk for defenders/repairers, so a slightly longer line close to
    // the base beats a short one across a distant choke point.
    const hub = (existing.concat(layout).find(o => o && o.type === 'storage') || input.anchor).pos;
    const weight = options.distanceWeight === undefined ? DISTANCE_WEIGHT : options.distanceWeight;
    const cost = new Int32Array(CELLS);
    for (let i = 0; i < CELLS; i++) {
        const p = pos(i);
        const far = Math.max(0, range(p, hub) - 8);
        cost[i] = interior(p.x, p.y) ? (built[i] ? BUILT_TILE_COST : TILE_COST) + Math.floor(far * weight) : BIG;
    }
    const configs = options.perimeterConfigs || [
        {buffer: 3, controller: true}, {buffer: 3, controller: false},
        {buffer: 2, controller: true}, {buffer: 2, controller: false}, {buffer: 1, controller: false}];
    let lastReason = 'perimeterUnsupported:noConfiguration';
    for (const config of configs) {
        const core = new Uint8Array(CELLS);
        const mark = (c, r) => {
            for (let y = Math.max(0, c.y - r); y <= Math.min(49, c.y + r); y++)
                for (let x = Math.max(0, c.x - r); x <= Math.min(49, c.x + r); x++) if (open[y * 50 + x]) core[y * 50 + x] = 1;
        };
        for (const o of protect) mark(o.pos, config.buffer);
        mark(input.anchor.pos, config.buffer);
        if (config.controller) mark(input.controller.pos, 1);
        const result = maxFlowCut(open, core, cost, budget);
        if (result.reason) { lastReason = 'perimeterUnsupported:' + result.reason + ':b' + config.buffer; continue; }
        if (result.cut.length > budget) { lastReason = 'perimeterUnsupported:overBudget:b' + config.buffer; continue; }
        if (!provesSealed(open, core, result.cut)) { lastReason = 'perimeterUnsupported:cutProofFailed'; continue; }
        return {cut: result.cut, config};
    }
    return {reason: lastReason};
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
    if (options.perimeter === false || options.perimeter === undefined) return result;
    const friendlyPassable = new Uint8Array(CELLS);
    for (let i = 0; i < CELLS; i++) friendlyPassable[i] = input.terrain[i] ? 0 : 1;
    for (const o of structures.concat(input.sources, input.minerals, [input.controller], layout)) {
        if (o.type === 'road' || o.type === 'container' || o.type === 'rampart') continue;
        friendlyPassable[index(o.pos)] = 0;
    }
    const access = accessBlocker(input, friendlyPassable);
    if (access) { result.blockers.push(access); return result; }
    const perimeter = planPerimeter(input, layout, options);
    if (perimeter.reason) { result.blockers.push(perimeter.reason); return result; }
    for (const i of perimeter.cut) {
        if (placed.has(i) || ramparts.has(i)) continue;
        result.entries.push({type: 'rampart', purpose: 'perimeter', pos: pos(i), priority: 90});
    }
    result.perimeterSupported = true;
    result.perimeter = {tiles: perimeter.cut.length, buffer: perimeter.config.buffer, controller: perimeter.config.controller};
    return result;
}
module.exports = {planDefense, planPerimeter};
