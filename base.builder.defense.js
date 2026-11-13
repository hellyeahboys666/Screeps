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
const TILE_COST = 10, BUILT_TILE_COST = 40, BIG = 1 << 28, DISTANCE_WEIGHT = 12,
    EXTENSION_BUFFER = -1, CREDIT_DEPTH = 6,
    // Reusing a standing barrier near the base: a rampart still needs upkeep, a wall none.
    REUSE_TILE_COST = 4, WALL_TILE_COST = 1;
// The controller is not a base structure: it only needs its neighbours guarded
// (attackController/claim are range 1), which the controller modes below handle.
// Buffering it like a spawn dragged the wall out to wherever the controller sits.
const UNPROTECTED = new Set(['road', 'container', 'rampart', 'constructedWall', 'extractor', 'controller']);
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

// Hostile-reachable set from the exits (8-way, through open tiles not in `blocked`).
function exitReach(open, blocked) {
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
    return seen;
}

// Links that live with a source or the controller are satellites: each keeps its own
// shield rampart (vitalOverlay), but the wall does not detour to enclose them.
function satelliteLink(input, o) {
    return o.type === 'link' && (input.sources.some(s => range(s.pos, o.pos) <= 2)
        || range(input.controller.pos, o.pos) <= 2);
}

// controller: 'auto' (default) tries both and keeps the cheaper, true/'join' walls the
// controller's neighbours in with the base, 'seal' ramparts just the controller's open
// neighbours (attackController and claiming need range 1), false leaves it out.
function controllerMode(value) {
    if (value === true || value === 'join') return 'join';
    if (value === 'seal' || value === 'auto') return value;
    return false;
}

function planPerimeter(input, layout, options) {
    const budget = options.maxCutTiles === undefined ? 60 : options.maxCutTiles;
    if (!Number.isInteger(budget) || budget < 1 || budget > 150) return {reason: 'perimeterUnsupported:invalidCutBudget'};
    const terrainOpen = new Uint8Array(CELLS), built = new Uint8Array(CELLS);
    for (let i = 0; i < CELLS; i++) terrainOpen[i] = input.terrain[i] ? 0 : 1;
    for (const o of input.sources.concat(input.minerals, [input.controller])) terrainOpen[index(o.pos)] = 0;
    const existing = input.structures.concat(input.spawns);
    // Our ramparts and constructed walls are the only structural barriers. Near the base
    // (within creditDepth of the protected area) reusing one is cheap, so a standing
    // line is kept instead of rebuilding it a tile closer; a far line gets no discount
    // and is replaced by one inside full tower range.
    const barrierCost = new Map();
    for (const o of existing) {
        if (o.type === 'constructedWall') barrierCost.set(index(o.pos), WALL_TILE_COST);
        else if (o.type === 'rampart' && o.my && !barrierCost.has(index(o.pos))) barrierCost.set(index(o.pos), REUSE_TILE_COST);
    }
    const creditDepth = Number.isInteger(options.creditDepth) ? options.creditDepth : CREDIT_DEPTH;
    const reuseCost = Number.isFinite(options.reuseCost) ? options.reuseCost : null;
    const protect = existing.concat(input.sites, layout.map(o => Object.assign({my: true}, o)))
        .filter(o => o && o.my && !UNPROTECTED.has(o.type) && !satelliteLink(input, o));
    for (const o of existing.concat(input.sites, layout)) {
        if (o && o.type !== 'road' && o.type !== 'rampart') built[index(o.pos)] = 1;
    }
    const weight = options.distanceWeight === undefined ? DISTANCE_WEIGHT : options.distanceWeight;
    // Default: extensions stay outside the wall (extensionBuffer -1, Hivemind style) so
    // the ring hugs the key structures inside full tower range. 0..3 protects them too.
    const extensionBuffer = Number.isInteger(options.extensionBuffer) ? options.extensionBuffer : EXTENSION_BUFFER;
    const configs = options.perimeterConfigs || [
        {buffer: 3, controller: 'auto'}, {buffer: 3, controller: false},
        {buffer: 2, controller: 'auto'}, {buffer: 2, controller: false}, {buffer: 1, controller: false}];
    const ctrlNeighbors = [];
    adjacent(index(input.controller.pos), n => { if (terrainOpen[n]) ctrlNeighbors.push(n); });
    let lastReason = 'perimeterUnsupported:noConfiguration';
    for (const config of configs) {
        const mode = controllerMode(config.controller);
        const base = new Uint8Array(CELLS);
        const mark = (c, r) => {
            for (let y = Math.max(0, c.y - r); y <= Math.min(49, c.y + r); y++)
                for (let x = Math.max(0, c.x - r); x <= Math.min(49, c.x + r); x++) if (terrainOpen[y * 50 + x]) base[y * 50 + x] = 1;
        };
        for (const o of protect) {
            if (o.type === 'extension' && extensionBuffer < 0) continue;
            mark(o.pos, o.type === 'extension' ? Math.min(config.buffer, extensionBuffer) : config.buffer);
        }
        mark(input.anchor.pos, config.buffer);
        // Walking depth from a set of tiles over open terrain.
        const flood = seeds => {
            const depth = new Uint16Array(CELLS).fill(65535), queue = new Int32Array(CELLS);
            let h = 0, t = 0;
            for (let i = 0; i < CELLS; i++) if (seeds[i]) { depth[i] = 0; queue[t++] = i; }
            while (h < t) {
                const i = queue[h++], x = i % SIZE;
                for (const d of STEPS) {
                    const n = i + d;
                    if (n < 0 || n >= CELLS || Math.abs(n % SIZE - x) > 1 || !terrainOpen[n] || depth[n] !== 65535) continue;
                    depth[n] = depth[i] + 1; queue[t++] = n;
                }
            }
            return depth;
        };
        // Cost grows with depth from what the wall protects: a line hugging it (full
        // tower damage, short walks for defenders/repairers) beats a shorter one across
        // a distant choke point. Standing barriers near it are cheap to reuse.
        const costFrom = depth => {
            const cost = new Int32Array(CELLS);
            for (let i = 0; i < CELLS; i++) {
                const p = pos(i);
                if (!interior(p.x, p.y)) { cost[i] = BIG; continue; }
                if (barrierCost.has(i) && depth[i] <= creditDepth) {
                    cost[i] = reuseCost === null ? barrierCost.get(i) : reuseCost;
                    continue;
                }
                cost[i] = (built[i] ? BUILT_TILE_COST : TILE_COST) + Math.floor(Math.max(0, Math.min(depth[i], 200) - 1) * weight);
            }
            return cost;
        };
        const sealCost = i => barrierCost.has(i) ? (reuseCost === null ? barrierCost.get(i) : reuseCost)
            : built[i] ? BUILT_TILE_COST : TILE_COST;
        const candidates = [];
        let cutFound = false;
        if (mode === 'seal' || mode === 'auto' || mode === false) {
            // The base alone, priced by distance from the base (never from the controller,
            // so the cut has no reason to bulge out toward it).
            const cost = costFrom(flood(base));
            const r = maxFlowCut(terrainOpen, base, cost, budget);
            if (r.reason) lastReason = 'perimeterUnsupported:' + r.reason + ':b' + config.buffer;
            else {
                cutFound = true;
                let seal = [];
                const guarded = base.slice();
                if (mode !== false) {
                    // Then rampart the controller neighbours hostiles can still reach; their
                    // place is fixed by the controller, so distance does not price them.
                    const blocked = new Uint8Array(CELLS);
                    for (const i of r.cut) blocked[i] = 1;
                    const reach = exitReach(terrainOpen, blocked);
                    seal = ctrlNeighbors.filter(n => reach[n]);
                    for (const n of ctrlNeighbors) guarded[n] = 1;
                }
                const wall = r.cut.concat(seal);
                if (seal.every(n => interior(n % SIZE, (n - n % SIZE) / SIZE)) && provesSealed(terrainOpen, guarded, wall)) {
                    candidates.push({mode: mode === false ? false : 'seal', cut: r.cut, seal, wall,
                        price: r.cut.reduce((sum, i) => sum + cost[i], 0) + seal.reduce((sum, i) => sum + sealCost(i), 0)});
                }
            }
        }
        // Joining is only worth trying when the base wall leaves the controller outside.
        const sealed = candidates[0];
        if (mode === 'join' || (mode === 'auto' && (!sealed || sealed.seal.length > 0))) {
            // Walled in together: distance counts from the base or the controller.
            const core = base.slice();
            for (const n of ctrlNeighbors) core[n] = 1;
            const cost = costFrom(flood(core));
            const r = maxFlowCut(terrainOpen, core, cost, budget);
            if (r.reason) lastReason = 'perimeterUnsupported:' + r.reason + ':b' + config.buffer;
            else if ((cutFound = true) && provesSealed(terrainOpen, core, r.cut)) {
                candidates.push({mode: 'join', cut: r.cut, seal: [], wall: r.cut,
                    price: r.cut.reduce((sum, i) => sum + cost[i], 0)});
            }
        }
        // The cheaper wall wins; a tie goes to the seal (fewer ramparts by the controller).
        const chosen = candidates.sort((a, b) => a.price - b.price || (a.mode === 'seal' ? -1 : 1))[0];
        if (!chosen) { if (cutFound) lastReason = 'perimeterUnsupported:cutProofFailed'; continue; }
        if (chosen.wall.length > budget) { lastReason = 'perimeterUnsupported:overBudget:b' + config.buffer; continue; }
        const wallKeys = Array.from(new Set(chosen.wall)).sort((a, b) => a - b);
        return {cut: chosen.cut.filter(i => !barrierCost.has(i)), seal: chosen.seal.filter(i => !barrierCost.has(i)),
            config: Object.assign({}, config, {controller: chosen.mode}),
            credited: wallKeys.filter(i => barrierCost.has(i)), wallKeys};
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
    const addWall = (i, purpose) => {
        if (ramparts.has(i)) return;
        if (placed.has(i)) {
            // The wall crosses a structure's shield rampart (e.g. a source link not built
            // until RCL5-6): it becomes a wall rampart and no longer waits for the structure,
            // otherwise the wall would have a hole until then.
            const overlay = result.entries.find(e => e.purpose === 'vitalOverlay' && index(e.pos) === i);
            if (overlay) { overlay.purpose = purpose; delete overlay.requiresType; }
            return;
        }
        placed.add(i);
        result.entries.push({type: 'rampart', purpose, pos: pos(i), priority: 90});
    };
    for (const i of perimeter.cut) addWall(i, 'perimeter');
    // The controller's open neighbours, when sealing them beats walling the controller in.
    for (const i of perimeter.seal) addWall(i, 'controllerSeal');
    result.perimeterSupported = true;
    result.perimeter = {tiles: perimeter.cut.length, buffer: perimeter.config.buffer,
        controller: perimeter.config.controller, seal: perimeter.seal.length};
    result.barrierKeys = perimeter.credited;
    result.wallKeys = perimeter.wallKeys;
    result.perimeter.credited = perimeter.credited.length;
    return result;
}
module.exports = {planDefense, planPerimeter};
